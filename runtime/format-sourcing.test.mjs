import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planSourceExtension,
  buildExtensionFilter,
  extensionProvenance,
  MAX_CYCLES,
  MIN_PINGPONG_SECONDS
} from './format-sourcing.mjs';

/* ------------------------------------------------------------------ */
/* Strategy selection                                                  */
/* ------------------------------------------------------------------ */

test('a source that already covers the beat needs no extension', () => {
  const exact = planSourceExtension({ availableSeconds: 15, neededSeconds: 15 });
  assert.equal(exact.strategy, 'none');
  assert.equal(exact.cycles, 1);
  assert.equal(exact.slowFactor, 1);
  assert.equal(exact.honest, true);

  const surplus = planSourceExtension({ availableSeconds: 40, neededSeconds: 15 });
  assert.equal(surplus.strategy, 'none');
  assert.equal(surplus.honest, true);
});

test('a 2x shortfall is covered by slowing, not by a seam', () => {
  const plan = planSourceExtension({ availableSeconds: 15, neededSeconds: 30 });
  assert.equal(plan.strategy, 'slow');
  assert.equal(plan.slowFactor, 2);
  assert.equal(plan.cycles, 1);
  assert.equal(plan.honest, true);
  assert.ok(plan.coveredSeconds + 1e-3 >= 30, `covered ${plan.coveredSeconds} must reach 30`);
});

test('a non-integer stretch inside the cap still picks slow and still covers', () => {
  const plan = planSourceExtension({ availableSeconds: 15, neededSeconds: 25 });
  assert.equal(plan.strategy, 'slow');
  assert.ok(plan.slowFactor <= 2, `slowFactor ${plan.slowFactor} must respect the cap`);
  assert.ok(plan.coveredSeconds + 1e-3 >= 25, `covered ${plan.coveredSeconds} must reach 25`);
  assert.equal(plan.honest, true);
});

test('a 10x shortfall is past the slow cap and goes to pingpong', () => {
  const plan = planSourceExtension({ availableSeconds: 3, neededSeconds: 30 });
  assert.equal(plan.strategy, 'pingpong');
  // 10x / 2 seconds per cycle = 5 forward+reverse cycles.
  assert.equal(plan.cycles, 5);
  assert.equal(plan.coveredSeconds, 30);
  assert.equal(plan.honest, true);
});

test('the real bug: a 105s beat from a 15s clip is planned, not silently truncated', () => {
  const plan = planSourceExtension({ availableSeconds: 15, neededSeconds: 105 });
  assert.equal(plan.strategy, 'pingpong');
  assert.equal(plan.cycles, 4); // 4 x 30s = 120s, trimmed back to 105s
  assert.equal(plan.honest, true);
  assert.ok(plan.coveredSeconds >= 105, `covered ${plan.coveredSeconds}`);
});

test('a source too short to reverse cleanly loops instead of pingponging', () => {
  const tiny = planSourceExtension({ availableSeconds: 0.2, neededSeconds: 4 });
  assert.equal(tiny.strategy, 'loop');
  assert.equal(tiny.cycles, 20);
  assert.equal(tiny.honest, true);

  const justBigEnough = planSourceExtension({ availableSeconds: MIN_PINGPONG_SECONDS, neededSeconds: 10 });
  assert.equal(justBigEnough.strategy, 'pingpong');
});

test('an absurd need is refused rather than approximated', () => {
  const plan = planSourceExtension({ availableSeconds: 1, neededSeconds: 600 });
  assert.equal(plan.strategy, 'refuse');
  assert.equal(plan.honest, false);
  assert.equal(plan.coveredSeconds, 0);
  assert.match(plan.reason, /more than 100 cycles/);
});

test('the refusal threshold sits exactly where MAX_CYCLES says it does', () => {
  // pingpong covers 2s of beat per cycle from a 1s source.
  const atCap = planSourceExtension({ availableSeconds: 1, neededSeconds: 2 * MAX_CYCLES });
  assert.equal(atCap.strategy, 'pingpong');
  assert.equal(atCap.cycles, MAX_CYCLES);
  assert.equal(atCap.honest, true);

  const overCap = planSourceExtension({ availableSeconds: 1, neededSeconds: 2 * MAX_CYCLES + 1 });
  assert.equal(overCap.strategy, 'refuse');
  assert.equal(overCap.honest, false);
});

test('a raised slow cap moves the boundary between slow and pingpong', () => {
  const capped = planSourceExtension({ availableSeconds: 10, neededSeconds: 30 });
  assert.equal(capped.strategy, 'pingpong');

  const generous = planSourceExtension({ availableSeconds: 10, neededSeconds: 30, maxSlowFactor: 3 });
  assert.equal(generous.strategy, 'slow');
  assert.equal(generous.slowFactor, 3);
});

test('slowFactor never exceeds maxSlowFactor, whatever is asked for', () => {
  for (const maxSlowFactor of [1, 1.25, 2, 2.5, 4]) {
    for (const neededSeconds of [1, 5, 12, 37, 240, 999]) {
      for (const strategy of ['auto', 'slow']) {
        const plan = planSourceExtension({ availableSeconds: 6, neededSeconds, strategy, maxSlowFactor });
        assert.ok(
          plan.slowFactor <= maxSlowFactor + 1e-9,
          `${strategy} need=${neededSeconds} cap=${maxSlowFactor} produced slowFactor ${plan.slowFactor}`
        );
      }
    }
  }
});

test('an explicit strategy that cannot cover is reported dishonest, never trimmed quietly', () => {
  const noExtension = planSourceExtension({ availableSeconds: 15, neededSeconds: 105, strategy: 'none' });
  assert.equal(noExtension.strategy, 'none');
  assert.equal(noExtension.honest, false);
  assert.equal(noExtension.coveredSeconds, 15);
  assert.match(noExtension.reason, /90s would be missing/);

  const cappedSlow = planSourceExtension({ availableSeconds: 15, neededSeconds: 105, strategy: 'slow' });
  assert.equal(cappedSlow.slowFactor, 2);
  assert.equal(cappedSlow.honest, false);
});

test('bad inputs throw coded errors instead of guessing', () => {
  const codeOf = fn => { try { fn(); return null; } catch (error) { return error.code; } };
  assert.equal(codeOf(() => planSourceExtension({ availableSeconds: 0, neededSeconds: 10 })), 'INVALID_AVAILABLE_SECONDS');
  assert.equal(codeOf(() => planSourceExtension({ availableSeconds: 10, neededSeconds: -1 })), 'INVALID_NEEDED_SECONDS');
  assert.equal(codeOf(() => planSourceExtension({ availableSeconds: 10, neededSeconds: NaN })), 'INVALID_NEEDED_SECONDS');
  assert.equal(codeOf(() => planSourceExtension({ availableSeconds: 10, neededSeconds: 20, maxSlowFactor: 0.5 })), 'INVALID_MAX_SLOW_FACTOR');
  assert.equal(codeOf(() => planSourceExtension({ availableSeconds: 10, neededSeconds: 20, strategy: 'morph' })), 'UNKNOWN_EXTENSION_STRATEGY');
});

/* ------------------------------------------------------------------ */
/* Filter construction                                                 */
/* ------------------------------------------------------------------ */

const filterFor = (overrides = {}) => buildExtensionFilter({ fps: 30, ...overrides });

test('every honest plan produces a filter trimmed to exactly the beat length', () => {
  const cases = [
    { availableSeconds: 15, neededSeconds: 15 },
    { availableSeconds: 15, neededSeconds: 30 },
    { availableSeconds: 3, neededSeconds: 30 },
    { availableSeconds: 0.2, neededSeconds: 4 },
    { availableSeconds: 15, neededSeconds: 105 }
  ];
  for (const input of cases) {
    const plan = planSourceExtension(input);
    assert.equal(plan.honest, true, `${JSON.stringify(input)} should be coverable`);
    const filter = filterFor({ ...plan, availableSeconds: input.availableSeconds, neededSeconds: input.neededSeconds });
    assert.ok(
      filter.includes(`trim=start=0:duration=${input.neededSeconds.toFixed(3)}`),
      `${plan.strategy} must trim to ${input.neededSeconds}s, got: ${filter}`
    );
    assert.ok(filter.trimEnd().endsWith('setpts=PTS-STARTPTS'), `${plan.strategy} must rebase PTS after the trim`);
  }
});

test('loop frame maths: size is FRAMES of the segment and loop is one fewer than cycles', () => {
  // 2s source, 7s beat -> 4 plays (8s) trimmed back to 7s.
  const plan = planSourceExtension({ availableSeconds: 2, neededSeconds: 7, strategy: 'loop' });
  assert.equal(plan.cycles, 4);
  assert.equal(plan.honest, true);

  for (const [fps, expectedSize] of [[24, 48], [30, 60], [60, 120]]) {
    const filter = buildExtensionFilter({ ...plan, availableSeconds: 2, neededSeconds: 7, fps });
    assert.ok(
      filter.includes(`loop=loop=3:size=${expectedSize}:start=0`),
      `at ${fps}fps a 2s segment is ${expectedSize} frames; got: ${filter}`
    );
    assert.ok(filter.startsWith(`fps=${fps},`), 'rate conversion must precede the frame-count maths');
    assert.ok(filter.includes('setpts=N/FRAME_RATE/TB'), 'looped frames need regenerated timestamps');
  }
});

test('loop frame maths handles a fractional segment length at each rate', () => {
  // 1.5s at 24fps is 36 frames, at 30fps 45, at 60fps 90.
  for (const [fps, expectedSize] of [[24, 36], [30, 45], [60, 90]]) {
    const filter = buildExtensionFilter({
      strategy: 'loop', cycles: 3, slowFactor: 1, availableSeconds: 1.5, neededSeconds: 4, fps
    });
    assert.ok(filter.includes(`size=${expectedSize}:`), `1.5s at ${fps}fps is ${expectedSize} frames; got: ${filter}`);
  }
});

test('pingpong covered-seconds maths: each cycle is two passes of the source', () => {
  for (const [availableSeconds, neededSeconds, cycles] of [[3, 30, 5], [15, 105, 4], [4, 8, 1], [4, 9, 2]]) {
    const plan = planSourceExtension({ availableSeconds, neededSeconds, strategy: 'pingpong' });
    assert.equal(plan.cycles, cycles, `${availableSeconds}s -> ${neededSeconds}s`);
    assert.equal(plan.coveredSeconds, availableSeconds * 2 * cycles);
    assert.ok(plan.coveredSeconds + 1e-9 >= neededSeconds, 'a pingpong plan must reach the beat');
  }
});

test('a pingpong filter splits, reverses and concatenates', () => {
  const filter = filterFor({ strategy: 'pingpong', cycles: 1, availableSeconds: 4, neededSeconds: 8 });
  assert.ok(filter.includes('split=2[vx0][vx1]'), `must split: ${filter}`);
  assert.ok(filter.includes('[vx1]reverse'), `must reverse one branch: ${filter}`);
  assert.ok(filter.includes('concat=n=2:v=1:a=0'), `must concat both branches: ${filter}`);
  assert.ok(!filter.includes('loop=loop='), 'a single cycle needs no loop filter');

  const multi = filterFor({ strategy: 'pingpong', cycles: 4, availableSeconds: 15, neededSeconds: 105 });
  // One ping-pong unit is 15s forward + 15s reversed = 900 frames at 30fps,
  // repeated 3 extra times for 4 cycles.
  assert.ok(multi.includes('loop=loop=3:size=900:start=0'), `multi-cycle pingpong loops the unit: ${multi}`);
});

test('a slow filter ramps PTS by the factor and restores a constant rate', () => {
  const filter = filterFor({ strategy: 'slow', slowFactor: 2, availableSeconds: 15, neededSeconds: 30 });
  assert.ok(filter.includes('setpts=2.0000*PTS'), `must ramp PTS: ${filter}`);
  assert.ok(filter.indexOf('setpts=2.0000*PTS') < filter.indexOf('fps=30'), 'fps must follow the ramp, or the stretch is undone');
});

test('a filter is refused whenever it could not honestly reach the beat', () => {
  const codeOf = fn => { try { fn(); return null; } catch (error) { return error.code; } };
  assert.equal(codeOf(() => filterFor({ strategy: 'refuse', availableSeconds: 1, neededSeconds: 600 })), 'EXTENSION_REFUSED');
  assert.equal(codeOf(() => filterFor({ strategy: 'none', availableSeconds: 15, neededSeconds: 105 })), 'EXTENSION_CANNOT_COVER');
  assert.equal(codeOf(() => filterFor({ strategy: 'loop', cycles: 2, availableSeconds: 15, neededSeconds: 105 })), 'EXTENSION_CANNOT_COVER');
  assert.equal(codeOf(() => filterFor({ strategy: 'slow', slowFactor: 2, availableSeconds: 15, neededSeconds: 105 })), 'EXTENSION_CANNOT_COVER');
  assert.equal(codeOf(() => buildExtensionFilter({ strategy: 'loop', cycles: 2, availableSeconds: 5, neededSeconds: 8, fps: 0 })), 'INVALID_FPS');
  assert.equal(codeOf(() => filterFor({ strategy: 'loop', cycles: 1.5, availableSeconds: 5, neededSeconds: 5 })), 'INVALID_CYCLES');
  assert.equal(codeOf(() => filterFor({ strategy: 'ken-burns', availableSeconds: 5, neededSeconds: 5 })), 'UNKNOWN_EXTENSION_STRATEGY');
});

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

test('provenance always discloses how much screen time is synthetic', () => {
  const cases = [
    { availableSeconds: 15, neededSeconds: 15, synthetic: 0 },
    { availableSeconds: 15, neededSeconds: 30, synthetic: 15 },
    { availableSeconds: 3, neededSeconds: 30, synthetic: 27 },
    { availableSeconds: 0.2, neededSeconds: 4, synthetic: 3.8 },
    { availableSeconds: 15, neededSeconds: 105, synthetic: 90 },
    // A refusal produces no footage at all, so none of it can be synthetic.
    { availableSeconds: 1, neededSeconds: 600, synthetic: 0 }
  ];
  for (const { availableSeconds, neededSeconds, synthetic } of cases) {
    const plan = planSourceExtension({ availableSeconds, neededSeconds });
    const provenance = extensionProvenance(plan);
    assert.equal(provenance.schemaVersion, 1);
    assert.equal(provenance.strategy, plan.strategy);
    assert.equal(provenance.sourceSeconds, availableSeconds);
    assert.equal(provenance.syntheticSeconds, synthetic, `${availableSeconds}s -> ${neededSeconds}s`);
    // The note must carry the numbers, not merely exist.
    assert.match(provenance.note, new RegExp(`\\b${availableSeconds}s\\b`), `note must state the source length: ${provenance.note}`);
    if (synthetic > 0) assert.match(provenance.note, new RegExp(`\\b${synthetic}s\\b`), `note must state the synthetic seconds: ${provenance.note}`);
  }
});

test('provenance never counts screen time a plan cannot actually produce', () => {
  // The trim caps at the beat, so a plan that falls short puts LESS on screen
  // than the beat asks for. Reporting the beat length would invent footage.
  const shortfall = extensionProvenance(planSourceExtension({ availableSeconds: 15, neededSeconds: 105, strategy: 'none' }));
  assert.equal(shortfall.syntheticSeconds, 0, 'a plan that extends nothing has no synthetic seconds');
  assert.doesNotMatch(shortfall.note, /90s of the 105s on screen/, 'the missing 90s was never on screen');
  assert.match(shortfall.note, /does not fill the 105s beat: 90s is missing/);

  const cappedSlow = extensionProvenance(planSourceExtension({ availableSeconds: 15, neededSeconds: 105, strategy: 'slow' }));
  assert.equal(cappedSlow.syntheticSeconds, 15, '2x of 15s puts 30s on screen, half of it stretched');
  assert.match(cappedSlow.note, /of the 30s on screen/);
  assert.match(cappedSlow.note, /75s is missing/);
});

test('the note names the manipulation and refuses to call extended time original', () => {
  const extended = extensionProvenance(planSourceExtension({ availableSeconds: 15, neededSeconds: 105 }));
  assert.match(extended.note, /time-manipulated, not original footage/);
  assert.match(extended.note, /Only the first 15s is original footage/);
  assert.match(extended.note, /forward and then reversed/);

  const slowed = extensionProvenance(planSourceExtension({ availableSeconds: 15, neededSeconds: 30 }));
  assert.match(slowed.note, /time-manipulated, not original footage/);
  assert.match(slowed.note, /not interpolated/);

  const looped = extensionProvenance(planSourceExtension({ availableSeconds: 0.2, neededSeconds: 4 }));
  assert.match(looped.note, /hard cut at each seam/);
});

test('provenance for an unextended beat claims nothing extra', () => {
  const provenance = extensionProvenance(planSourceExtension({ availableSeconds: 20, neededSeconds: 20 }));
  assert.equal(provenance.strategy, 'none');
  assert.equal(provenance.syntheticSeconds, 0);
  assert.match(provenance.note, /All 20s on screen is original footage/);
  assert.doesNotMatch(provenance.note, /time-manipulated, not original/);
});

test('provenance for a refusal says nothing was extended', () => {
  const provenance = extensionProvenance(planSourceExtension({ availableSeconds: 1, neededSeconds: 600 }));
  assert.equal(provenance.strategy, 'refuse');
  assert.equal(provenance.cycles, 0);
  assert.match(provenance.note, /Refused/);
  assert.match(provenance.note, /No footage was extended/);
});

test('provenance rejects anything that is not an extension plan', () => {
  const codeOf = fn => { try { fn(); return null; } catch (error) { return error.code; } };
  assert.equal(codeOf(() => extensionProvenance(null)), 'INVALID_EXTENSION_PLAN');
  assert.equal(codeOf(() => extensionProvenance({ strategy: 'loop' })), 'INVALID_EXTENSION_PLAN');
  assert.equal(codeOf(() => extensionProvenance({ strategy: 'warp', sourceSeconds: 1, neededSeconds: 2 })), 'UNKNOWN_EXTENSION_STRATEGY');
});

/* ------------------------------------------------------------------ */
/* Frames vs seconds                                                   */
/* ------------------------------------------------------------------ */

test('cycles are counted in frames when fps is known, so a plan cannot land short', () => {
  const fps = 30;
  // 0.24s at 30fps is 7 whole frames (0.2333s), not 7.2. Planning the cycle
  // count in seconds credits 0.24s a cycle, and the rendered graph then comes
  // out a frame short of its own beat (measured: 119 frames of 120).
  const inSeconds = planSourceExtension({ availableSeconds: 0.24, neededSeconds: 4, strategy: 'loop' });
  assert.equal(inSeconds.cycles, 17);
  assert.throws(
    () => buildExtensionFilter({ ...inSeconds, availableSeconds: 0.24, neededSeconds: 4, fps }),
    error => error.code === 'EXTENSION_CANNOT_COVER',
    'a seconds-only plan that cannot cover in frames must throw, never emit a short graph'
  );

  const inFrames = planSourceExtension({ availableSeconds: 0.24, neededSeconds: 4, strategy: 'loop', fps });
  assert.equal(inFrames.cycles, 18, '18 x 7 frames = 126 frames, the first count that reaches 120');
  const filter = buildExtensionFilter({ ...inFrames, availableSeconds: 0.24, neededSeconds: 4, fps });
  assert.ok(filter.includes('loop=loop=17:size=7:start=0'), `size must be whole frames: ${filter}`);
  assert.ok(Math.round(inFrames.coveredSeconds * fps) >= 4 * fps, `covered ${inFrames.coveredSeconds}s must reach 120 frames`);
});

test('every fps-aware plan builds a filter, at source lengths that are not whole frames', () => {
  const fps = 30;
  for (const availableSeconds of [0.11, 0.24, 0.37, 0.51, 0.74, 1.02, 2.02, 3.33, 7.77]) {
    for (const neededSeconds of [4, 9, 30, 105]) {
      const plan = planSourceExtension({ availableSeconds, neededSeconds, fps });
      if (!plan.honest) {
        assert.equal(plan.strategy, 'refuse', `${availableSeconds}s -> ${neededSeconds}s went dishonest without refusing`);
        continue;
      }
      const filter = buildExtensionFilter({ ...plan, availableSeconds, neededSeconds, fps });
      assert.ok(
        filter.includes(`trim=start=0:duration=${neededSeconds.toFixed(3)}`),
        `${availableSeconds}s -> ${neededSeconds}s: ${filter}`
      );
    }
  }
});

test('a segment past the loop filter frame ceiling is refused, not handed to ffmpeg', () => {
  const codeOf = fn => { try { fn(); return null; } catch (error) { return error.code; } };
  // libavfilter caps loop's `size` at INT16_MAX; past it ffmpeg aborts the run
  // with "Error applying option 'size' to filter 'loop': Result too large".
  assert.equal(
    codeOf(() => buildExtensionFilter({ strategy: 'loop', cycles: 2, slowFactor: 1, availableSeconds: 1100, neededSeconds: 2000, fps: 30 })),
    'EXTENSION_SEGMENT_TOO_LONG'
  );
  // pingpong buffers two passes, so it hits the same ceiling at half the length.
  assert.equal(
    codeOf(() => buildExtensionFilter({ strategy: 'pingpong', cycles: 2, slowFactor: 1, availableSeconds: 600, neededSeconds: 1200, fps: 30 })),
    'EXTENSION_SEGMENT_TOO_LONG'
  );
  const insideCeiling = buildExtensionFilter({ strategy: 'loop', cycles: 2, slowFactor: 1, availableSeconds: 1092, neededSeconds: 2000, fps: 30 });
  assert.ok(insideCeiling.includes('size=32760'), insideCeiling);
});

test('a slow filter refuses a factor that would speed the footage up', () => {
  const codeOf = fn => { try { fn(); return null; } catch (error) { return error.code; } };
  // 0.5 is a 2x speed-up, and provenance would still call it a slow ramp.
  assert.equal(codeOf(() => buildExtensionFilter({ strategy: 'slow', slowFactor: 0.5, availableSeconds: 10, neededSeconds: 4, fps: 30 })), 'INVALID_SLOW_FACTOR');
  assert.ok(buildExtensionFilter({ strategy: 'slow', slowFactor: 1, availableSeconds: 10, neededSeconds: 4, fps: 30 }).includes('setpts=1.0000*PTS'));
});

test('a refusal gives the reason that actually applied', () => {
  assert.match(planSourceExtension({ availableSeconds: 1, neededSeconds: 600 }).reason, /more than 100 cycles/);

  const asked = planSourceExtension({ availableSeconds: 15, neededSeconds: 20, strategy: 'refuse' });
  assert.equal(asked.strategy, 'refuse');
  assert.doesNotMatch(asked.reason, /more than 100 cycles/, '1.33x was never a cycle-cap refusal');
  assert.match(asked.reason, /'refuse' was requested/);
});
