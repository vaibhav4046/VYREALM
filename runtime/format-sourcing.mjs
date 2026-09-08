/**
 * VYREALM source extension planner.
 *
 * A format beat can ask for 105 seconds while the shot behind it is 15 seconds
 * long. FFmpeg answers that quietly: `-t 105` past the end of a file returns
 * 15 seconds of video and exit code 0, so the plan claims a duration the
 * output never had. This module turns that shortfall into a decision instead
 * of an accident.
 *
 * Four real editing techniques cover a shortfall, and every one of them is
 * declared in provenance so the extra screen time is never passed off as
 * original footage:
 *   none      the source already covers the beat
 *   slow      a setpts ramp, capped because heavy slow-mo reads as broken
 *   pingpong  forward then reversed; seamless, doubles usable length per cycle
 *   loop      repeat the segment, hard cut at the seam
 *   refuse    the shortfall is too large to cover honestly
 *
 * Everything here is pure arithmetic and string building. Nothing in this file
 * spawns FFmpeg, so the maths is testable without a binary.
 *
 * FILTER CONTRACT: buildExtensionFilter returns a `-filter_complex` BODY. The
 * first filter takes the implicit input and the last filter emits the implicit
 * output, so a caller can use it as `-filter_complex "<fragment>"` or splice it
 * between its own labels. pingpong needs internal labels (split/reverse/concat)
 * and therefore cannot be a plain `-vf` chain, so every strategy uses the same
 * filter_complex contract rather than two shapes the caller has to tell apart.
 *
 * FRAMES, NOT SECONDS: loop and pingpong replay whole frames, so a segment is
 * worth floor(seconds * fps) frames and not a hair more. Planning in seconds and
 * rendering in frames is how a 17-cycle plan lands a frame short of its own beat
 * (measured: a 0.24s source at 30fps produced 3.967s of a 4.000s beat). Pass fps
 * to planSourceExtension and the cycle count is chosen in frames; without it the
 * plan is seconds-only and buildExtensionFilter throws EXTENSION_CANNOT_COVER
 * rather than emitting a graph that runs short. The residual for none/slow is
 * under one frame and is not corrected, because a partial frame cannot be shown.
 *
 * MEMORY CEILING, stated plainly: `loop` buffers `size` decoded frames and
 * `reverse` buffers the entire segment. At 1080x1920 yuv420p a frame is ~3.1 MB,
 * so a 15s segment at 30fps is ~1.4 GB of RAM. Keep extended segments short, or
 * move to the concat demuxer / `-stream_loop` if that ceiling is ever hit.
 */

/** Beyond this many repeats the result stops reading as an edit and starts reading as a stall. */
export const MAX_CYCLES = 100;

/**
 * Below this, reversing produces a visible vibration rather than a move, so a
 * hard-cut loop is the more honest choice.
 */
export const MIN_PINGPONG_SECONDS = 0.5;

export const EXTENSION_STRATEGIES = Object.freeze(['none', 'slow', 'pingpong', 'loop', 'refuse']);

/**
 * libavfilter declares the loop filter's `size` as INT16_MAX, so a longer
 * segment aborts the render with "Error applying option 'size' to filter
 * 'loop': Result too large". Better to say that here than at render time.
 */
export const LOOP_SIZE_MAX = 32767;

const EPSILON = 1e-6;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

const round3 = value => Number(value.toFixed(3));

function assertPositive(value, code, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw fail(code, `${label} must be a finite positive number, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Whole frames a segment can actually replay. Floor, not round: rounding up
 * credits a partial frame that no filter can emit, and loop/pingpong multiply
 * that lie by the cycle count.
 */
function segmentFrameCount(availableSeconds, fps) {
  return Math.max(1, Math.floor(availableSeconds * fps + EPSILON));
}

/**
 * Output seconds a strategy yields BEFORE the final trim.
 *
 * cycles means total plays for 'loop' and forward+reverse pairs for 'pingpong'.
 * A refused plan covers nothing; the source's own length lives in sourceSeconds.
 */
function coverageSeconds(strategy, cycles, slowFactor, availableSeconds) {
  switch (strategy) {
    case 'none': return availableSeconds;
    case 'slow': return availableSeconds * slowFactor;
    case 'loop': return availableSeconds * cycles;
    case 'pingpong': return availableSeconds * 2 * cycles;
    case 'refuse': return 0;
    default: throw fail('UNKNOWN_EXTENSION_STRATEGY', `${strategy} is not one of ${EXTENSION_STRATEGIES.join(', ')}`);
  }
}

/**
 * Decide how a short source can honestly fill a long beat.
 *
 * Returns the required shape plus sourceSeconds/neededSeconds, so the result is
 * self-contained enough for extensionProvenance() to disclose it without the
 * caller having to carry the inputs alongside.
 */
export function planSourceExtension({ availableSeconds, neededSeconds, strategy = 'auto', maxSlowFactor = 2, fps } = {}) {
  assertPositive(availableSeconds, 'INVALID_AVAILABLE_SECONDS', 'availableSeconds');
  assertPositive(neededSeconds, 'INVALID_NEEDED_SECONDS', 'neededSeconds');
  if (fps !== undefined) assertPositive(fps, 'INVALID_FPS', 'fps');
  if (typeof maxSlowFactor !== 'number' || !Number.isFinite(maxSlowFactor) || maxSlowFactor < 1) {
    throw fail('INVALID_MAX_SLOW_FACTOR', `maxSlowFactor must be a finite number >= 1, got ${JSON.stringify(maxSlowFactor)}`);
  }
  if (strategy !== 'auto' && !EXTENSION_STRATEGIES.includes(strategy)) {
    throw fail('UNKNOWN_EXTENSION_STRATEGY', `${JSON.stringify(strategy)} is not one of auto, ${EXTENSION_STRATEGIES.join(', ')}`);
  }

  // What one pass of the source is really worth. With fps that is whole frames;
  // without it, seconds, and the frame check falls to buildExtensionFilter.
  const unitSeconds = fps === undefined ? availableSeconds : segmentFrameCount(availableSeconds, fps) / fps;
  const ratio = neededSeconds / unitSeconds;

  let picked = strategy;
  if (strategy === 'auto') {
    if (ratio <= 1 + EPSILON) picked = 'none';
    // Slow first: a PTS ramp has no seam at all, so it beats a cut whenever the
    // stretch stays inside the cap. Past the cap it stops looking like a choice.
    else if (ratio <= maxSlowFactor + EPSILON) picked = 'slow';
    else picked = unitSeconds >= MIN_PINGPONG_SECONDS ? 'pingpong' : 'loop';
  }

  let cycles = 1;
  let slowFactor = 1;
  if (picked === 'slow') {
    // Ceil so the stretch never lands a hair short of the beat, then clamp:
    // slowFactor must never exceed the cap, even when the caller asked for slow
    // explicitly on a shortfall slow cannot cover.
    slowFactor = Math.min(maxSlowFactor, Math.ceil(ratio * 1e4) / 1e4);
  } else if (picked === 'loop') {
    cycles = Math.max(1, Math.ceil(ratio - EPSILON));
  } else if (picked === 'pingpong') {
    cycles = Math.max(1, Math.ceil(ratio / 2 - EPSILON));
  } else if (picked === 'refuse') {
    cycles = 0;
  }

  if (picked !== 'refuse' && cycles > MAX_CYCLES) {
    if (strategy === 'auto') {
      picked = 'refuse';
      cycles = 0;
      slowFactor = 1;
    } else {
      // An explicitly requested strategy keeps its name but is capped; the
      // shortfall then shows up as honest:false rather than as a quiet trim.
      cycles = MAX_CYCLES;
    }
  }

  const covered = coverageSeconds(picked, cycles, slowFactor, unitSeconds);
  const honest = picked !== 'refuse' && covered + EPSILON >= neededSeconds;

  return {
    strategy: picked,
    cycles,
    slowFactor: Number(slowFactor.toFixed(4)),
    coveredSeconds: round3(covered),
    honest,
    reason: explain({ picked, requested: strategy, honest, cycles, slowFactor, maxSlowFactor, ratio, covered, availableSeconds, neededSeconds }),
    sourceSeconds: round3(availableSeconds),
    neededSeconds: round3(neededSeconds)
  };
}

function explain({ picked, requested, honest, cycles, slowFactor, maxSlowFactor, ratio, covered, availableSeconds, neededSeconds }) {
  const a = round3(availableSeconds);
  const n = round3(neededSeconds);
  if (picked === 'refuse') {
    // Only the auto ladder refuses on the cycle cap. Saying so for a caller who
    // asked for 'refuse' outright would invent a reason that was never applied.
    return requested === 'refuse'
      ? `'refuse' was requested for a ${n}s beat from ${a}s of source; nothing was extended`
      : `a ${n}s beat needs ${ratio.toFixed(2)}x of ${a}s of source; that is more than ${MAX_CYCLES} cycles, which no longer reads as an edit`;
  }
  if (!honest) {
    return `strategy '${picked}' covers only ${round3(covered)}s of the ${n}s needed; ${round3(neededSeconds - covered)}s would be missing`;
  }
  switch (picked) {
    case 'none': return `${a}s of source covers the ${n}s beat; no extension needed`;
    case 'slow': return `${slowFactor.toFixed(4)}x slow ramp stretches ${a}s to ${round3(covered)}s (cap ${maxSlowFactor}x)`;
    case 'pingpong': return `${cycles} forward+reverse cycle${cycles === 1 ? '' : 's'} stretch ${a}s to ${round3(covered)}s`;
    default: return `${cycles} plays of ${a}s cover ${round3(covered)}s`;
  }
}

/**
 * Build the FFmpeg filter_complex body that realises an extension plan.
 *
 * Refuses rather than approximates: a plan that cannot reach neededSeconds
 * throws, because a filter that quietly runs short is the exact bug this module
 * exists to kill.
 */
export function buildExtensionFilter({ strategy, cycles = 1, slowFactor = 1, availableSeconds, neededSeconds, fps } = {}) {
  if (!EXTENSION_STRATEGIES.includes(strategy)) {
    throw fail('UNKNOWN_EXTENSION_STRATEGY', `${JSON.stringify(strategy)} is not one of ${EXTENSION_STRATEGIES.join(', ')}`);
  }
  if (strategy === 'refuse') {
    throw fail('EXTENSION_REFUSED', 'a refused plan has no honest filter; pick a longer source or a shorter beat');
  }
  assertPositive(availableSeconds, 'INVALID_AVAILABLE_SECONDS', 'availableSeconds');
  assertPositive(neededSeconds, 'INVALID_NEEDED_SECONDS', 'neededSeconds');
  assertPositive(fps, 'INVALID_FPS', 'fps');
  if (!Number.isInteger(cycles) || cycles < 1) {
    throw fail('INVALID_CYCLES', `cycles must be an integer >= 1, got ${JSON.stringify(cycles)}`);
  }
  // A factor below 1 speeds footage up. 'slow' must never quietly do that: the
  // provenance note would describe a slow ramp over sped-up frames.
  if (typeof slowFactor !== 'number' || !Number.isFinite(slowFactor) || slowFactor < 1) {
    throw fail('INVALID_SLOW_FACTOR', `slowFactor must be a finite number >= 1, got ${JSON.stringify(slowFactor)}`);
  }

  const segmentFrames = segmentFrameCount(availableSeconds, fps);
  // loop and pingpong replay whole frames, so their real unit is the frame
  // count, not the measured seconds. Checking in seconds is what let a plan
  // build a graph that ran a frame short of its own beat.
  const replaysFrames = strategy === 'loop' || strategy === 'pingpong';
  const unitSeconds = replaysFrames ? segmentFrames / fps : availableSeconds;
  const covered = coverageSeconds(strategy, cycles, slowFactor, unitSeconds);
  if (covered + EPSILON < neededSeconds) {
    const quantised = replaysFrames && unitSeconds + EPSILON < availableSeconds
      ? `; ${segmentFrames} whole frames at ${fps}fps is ${round3(unitSeconds)}s, not ${round3(availableSeconds)}s — pass fps to planSourceExtension so cycles are counted in frames`
      : '';
    throw fail('EXTENSION_CANNOT_COVER',
      `${strategy} with cycles=${cycles} slowFactor=${slowFactor} covers ${round3(covered)}s of the ${round3(neededSeconds)}s needed${quantised}`);
  }

  // Every fragment ends here, so the output is exactly the beat length no
  // matter how much surplus the strategy produced.
  const trim = `trim=start=0:duration=${neededSeconds.toFixed(3)},setpts=PTS-STARTPTS`;

  if (strategy === 'none') return `fps=${fps},${trim}`;

  if (strategy === 'slow') {
    // setpts stretches the timeline but creates no frames, so fps= afterwards
    // duplicates frames back onto a constant rate. Nothing is interpolated here
    // and nothing pretends to be; see frame-interpolation.mjs for that.
    return ['setpts=PTS-STARTPTS', `setpts=${slowFactor.toFixed(4)}*PTS`, `fps=${fps}`, trim].join(',');
  }

  if (strategy === 'loop') {
    // PTS: loop replays buffered frames with their ORIGINAL timestamps, so the
    // stream is non-monotonic until it is regenerated from the frame index.
    return [
      `fps=${fps}`,
      loopFilter(cycles, segmentFrames),
      'setpts=N/FRAME_RATE/TB',
      trim
    ].join(',');
  }

  // pingpong: split the same frames into a forward and a reversed pass. Motion
  // is continuous through the turn and through each seam, at the cost of one
  // held frame at both (measured order for a 6-frame source, 2 cycles:
  // 0 1 2 3 4 5 5 4 3 2 1 0 0 1 2 3 4 5 5 4 3 2 1 0).
  const tail = ['[vx0][vxr]concat=n=2:v=1:a=0'];
  if (cycles > 1) {
    // One ping-pong unit is two passes of the same frame count, so its length
    // is exactly twice the segment rather than a re-rounded duration.
    tail.push(loopFilter(cycles, segmentFrames * 2));
  }
  tail.push('setpts=N/FRAME_RATE/TB', trim);
  return [
    `fps=${fps},split=2[vx0][vx1]`,
    '[vx1]reverse,setpts=PTS-STARTPTS[vxr]',
    tail.join(',')
  ].join(';');
}

/**
 * TRAP: the loop filter counts FRAMES, not seconds, and `loop=N` is the number
 * of EXTRA plays, so N = cycles - 1. Passing seconds as `size` (or cycles as
 * `loop`) is the classic way to get a clip that stops early.
 */
function loopFilter(cycles, frames) {
  if (frames > LOOP_SIZE_MAX) {
    throw fail('EXTENSION_SEGMENT_TOO_LONG',
      `the loop filter buffers at most ${LOOP_SIZE_MAX} frames and this segment is ${frames}; shorten the source or the beat`);
  }
  return `loop=loop=${cycles - 1}:size=${frames}:start=0`;
}

const TECHNIQUE = Object.freeze({
  none: 'not time-manipulated',
  slow: 'slowed with a PTS ramp (frames duplicated, not interpolated)',
  pingpong: 'played forward and then reversed',
  loop: 'repeated, with a hard cut at each seam',
  refuse: 'refused'
});

/**
 * Disclose what an extension plan actually did to the footage.
 *
 * syntheticSeconds is screen time that no original frame backs. It is stated
 * whether or not anyone asks, because the whole point of extending a clip is
 * that the result no longer matches the source's real length.
 *
 * It is measured against what the plan can actually put on screen, never against
 * what was asked for: a refused plan makes no footage at all, and a plan that
 * falls short makes less than the beat. Reporting the beat length for either
 * would be inventing footage inside the evidence object.
 */
export function extensionProvenance(plan) {
  if (!plan || typeof plan !== 'object') {
    throw fail('INVALID_EXTENSION_PLAN', `expected a planSourceExtension() result, got ${JSON.stringify(plan)}`);
  }
  const { strategy, cycles = 0, slowFactor = 1, sourceSeconds, neededSeconds, coveredSeconds } = plan;
  if (!EXTENSION_STRATEGIES.includes(strategy)) {
    throw fail('UNKNOWN_EXTENSION_STRATEGY', `${JSON.stringify(strategy)} is not one of ${EXTENSION_STRATEGIES.join(', ')}`);
  }
  assertPositive(sourceSeconds, 'INVALID_EXTENSION_PLAN', 'plan.sourceSeconds');
  assertPositive(neededSeconds, 'INVALID_EXTENSION_PLAN', 'plan.neededSeconds');

  const source = round3(sourceSeconds);
  const needed = round3(neededSeconds);
  // The filter trims to the beat, so screen time is whatever the strategy
  // reached, capped there. A plan without coveredSeconds is taken at its word.
  const produced = strategy === 'refuse' ? 0 : Math.min(coveredSeconds ?? neededSeconds, neededSeconds);
  const onScreen = round3(produced);
  const syntheticSeconds = round3(Math.max(0, produced - sourceSeconds));
  const missing = round3(Math.max(0, neededSeconds - produced));

  let note;
  if (strategy === 'refuse') {
    note = `Refused: ${needed}s cannot be covered from ${source}s of source without misrepresenting the result. No footage was extended.`;
  } else if (syntheticSeconds === 0) {
    note = `All ${onScreen}s on screen is original footage from a ${source}s source; no time manipulation was applied.`;
  } else {
    const count = strategy === 'slow' ? `${slowFactor}x` : `${cycles} cycle${cycles === 1 ? '' : 's'}`;
    note = `Only the first ${source}s is original footage. The remaining ${syntheticSeconds}s of the ${onScreen}s on screen is time-manipulated, not original footage: the source is ${TECHNIQUE[strategy]} (${count}).`;
  }
  if (strategy !== 'refuse' && missing > 0) {
    note += ` This does not fill the ${needed}s beat: ${missing}s is missing.`;
  }

  return { schemaVersion: 1, strategy, cycles, slowFactor, syntheticSeconds, sourceSeconds: source, note };
}
