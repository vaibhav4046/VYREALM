import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FILM_STRUCTURES,
  FILM_RENDER_RATE,
  MIN_BEAT_SECONDS,
  planFilm,
  estimateFilmRender,
  filmEvidence,
  assembleFilm
} from './film-assembler.mjs';
import { CAMERA_MOVES, PACING } from './format-library.mjs';
import { probeDurationSeconds, DEFAULT_FFMPEG, DEFAULT_FFPROBE } from './format-render.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const EPS = 1e-6;

/** A pool of `count` identical-length clips, ids shot-00.. */
const pool = (count, seconds) =>
  Array.from({ length: count }, (_, i) => ({ id: `shot-${String(i).padStart(2, '0')}`, durationSeconds: seconds }));

const allBeats = plan => plan.acts.flatMap(act => act.beats);

/* ------------------------------------------------------------------ */
/* Structure vocabulary                                                */
/* ------------------------------------------------------------------ */

test('at least four structures are declared and frozen', () => {
  const ids = Object.keys(FILM_STRUCTURES);
  assert.ok(ids.length >= 4, `expected 4+ structures, got ${ids.length}`);
  for (const wanted of ['three-act', 'documentary-chapters', 'montage-essay', 'anime-vignette']) {
    assert.ok(ids.includes(wanted), `missing structure ${wanted}`);
  }
  assert.ok(Object.isFrozen(FILM_STRUCTURES));
  for (const spec of Object.values(FILM_STRUCTURES)) {
    assert.ok(Object.isFrozen(spec), `${spec.id} must be frozen`);
    assert.ok(Object.isFrozen(spec.acts), `${spec.id} acts must be frozen`);
  }
});

test('act proportions sum to 1 for every structure', () => {
  for (const [id, spec] of Object.entries(FILM_STRUCTURES)) {
    const sum = spec.acts.reduce((n, act) => n + act.proportion, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${id} proportions sum to ${sum}, not 1`);
    for (const act of spec.acts) {
      assert.ok(act.proportion > 0, `${id} act ${act.name} has a non-positive proportion`);
      assert.ok(act.name && typeof act.name === 'string', `${id} act needs a name`);
      assert.ok(PACING[act.pacing], `${id} act ${act.name} uses unknown pacing ${act.pacing}`);
      assert.ok(act.energy >= 0 && act.energy <= 1, `${id} act ${act.name} energy out of 0-1`);
    }
  }
});

test('every planned motion exists in the camera vocabulary', () => {
  for (const id of Object.keys(FILM_STRUCTURES)) {
    const plan = planFilm({ structure: id, targetSeconds: 300, shots: pool(12, 8) });
    for (const beat of allBeats(plan)) {
      assert.ok(CAMERA_MOVES[beat.motion], `${id} planned unknown motion ${beat.motion}`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Tiling                                                              */
/* ------------------------------------------------------------------ */

test('beats tile each act exactly, and acts tile the film exactly', () => {
  for (const id of Object.keys(FILM_STRUCTURES)) {
    for (const target of [180, 300, 437.5, 600]) {
      const plan = planFilm({ structure: id, targetSeconds: target, shots: pool(16, 9) });

      let expectedStart = 0;
      for (const act of plan.acts) {
        assert.ok(Math.abs(act.startSeconds - expectedStart) < EPS,
          `${id}@${target}s: act ${act.name} starts at ${act.startSeconds}, expected ${expectedStart}`);

        const summed = act.beats.reduce((n, beat) => n + beat.durationSeconds, 0);
        assert.ok(Math.abs(summed - act.durationSeconds) < EPS,
          `${id}@${target}s: act ${act.name} beats sum to ${summed}, act is ${act.durationSeconds}`);

        let cursor = act.startSeconds;
        for (const beat of act.beats) {
          assert.ok(Math.abs(beat.startSeconds - cursor) < EPS,
            `${id}@${target}s: beat at ${beat.startSeconds} leaves a gap or overlap (expected ${cursor})`);
          assert.ok(beat.durationSeconds > 0, 'a beat must have positive duration');
          cursor += beat.durationSeconds;
        }
        assert.ok(Math.abs(cursor - (act.startSeconds + act.durationSeconds)) < EPS,
          `${id}@${target}s: act ${act.name} beats end at ${cursor}, act ends at ${act.startSeconds + act.durationSeconds}`);
        expectedStart += act.durationSeconds;
      }

      assert.ok(Math.abs(plan.totalSeconds - target) < EPS,
        `${id}@${target}s: film totals ${plan.totalSeconds}`);
    }
  }
});

test('a fast act cuts shorter than a slow act', () => {
  // montage-essay: accumulation is dynamic (22 cuts/min), landing is calm (8).
  const plan = planFilm({ structure: 'montage-essay', targetSeconds: 400, shots: pool(20, 30) });
  const mean = name => {
    const act = plan.acts.find(a => a.name === name);
    return act.durationSeconds / act.beats.length;
  };
  assert.ok(mean('turn') < mean('accumulation'), `chaotic turn (${mean('turn')}s) must cut shorter than dynamic accumulation (${mean('accumulation')}s)`);
  assert.ok(mean('accumulation') < mean('landing'), `dynamic accumulation (${mean('accumulation')}s) must cut shorter than calm landing (${mean('landing')}s)`);
});

/* ------------------------------------------------------------------ */
/* Source honesty                                                      */
/* ------------------------------------------------------------------ */

test('a beat never exceeds the clip behind it', () => {
  const shots = [
    { id: 'tiny', durationSeconds: 1.2 },
    { id: 'short', durationSeconds: 0.9 },
    { id: 'mid', durationSeconds: 6 },
    { id: 'trimmed', durationSeconds: 8, inPoint: 5.5 }
  ];
  const usable = new Map(shots.map(s => [s.id, s.durationSeconds - (s.inPoint ?? 0)]));
  // calm acts want 7.5s beats; nothing in this pool can supply that.
  const plan = planFilm({ structure: 'anime-vignette', targetSeconds: 240, shots });
  for (const beat of allBeats(plan)) {
    assert.ok(beat.durationSeconds <= usable.get(beat.shotId) + 1e-9,
      `beat on ${beat.shotId} runs ${beat.durationSeconds}s from ${usable.get(beat.shotId)}s of footage`);
  }
});

test('a shot with no measured duration is refused, not guessed', () => {
  assert.throws(
    () => planFilm({ structure: 'three-act', targetSeconds: 200, shots: [{ id: 'mystery' }] }),
    /FILM_SHOT_DURATION_UNKNOWN/
  );
  assert.throws(
    () => planFilm({ structure: 'three-act', targetSeconds: 200, shots: [{ id: 'zero', durationSeconds: 0 }] }),
    /FILM_SHOT_DURATION_UNKNOWN/
  );
});

test('a pool with nothing long enough to cut is refused', () => {
  assert.throws(
    () => planFilm({ structure: 'three-act', targetSeconds: 200, shots: [{ id: 'blink', durationSeconds: 0.2 }] }),
    /FILM_POOL_TOO_SHORT/
  );
});

test('an unknown structure is refused', () => {
  assert.throws(
    () => planFilm({ structure: 'five-act-opera', targetSeconds: 200, shots: pool(4, 6) }),
    /FILM_STRUCTURE_UNKNOWN/
  );
});

/* ------------------------------------------------------------------ */
/* Cooldown                                                            */
/* ------------------------------------------------------------------ */

/** Smallest gap between two appearances of the same clip, in seconds. */
function smallestReuseGap(plan) {
  const lastEnd = new Map();
  let smallest = Infinity;
  for (const beat of allBeats(plan)) {
    const previous = lastEnd.get(beat.shotId);
    if (previous !== undefined) smallest = Math.min(smallest, beat.startSeconds - previous);
    lastEnd.set(beat.shotId, beat.startSeconds + beat.durationSeconds);
  }
  return smallest;
}

test('no clip repeats inside the cooldown when the pool is large enough', () => {
  const cooldownSeconds = 45;
  // Three long clips among twenty-one short ones. Without a cooldown the
  // planner leans on the three that can fill a 7.5s calm beat and repeats them
  // every few seconds; the cooldown is what forces it off them. A pool of
  // uniform clips would pass this test even with the cooldown deleted.
  const shots = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `long-${i}`, durationSeconds: 12 })),
    ...Array.from({ length: 21 }, (_, i) => ({ id: `short-${i}`, durationSeconds: 2 }))
  ];
  const args = { structure: 'documentary-chapters', targetSeconds: 300, shots };

  const plan = planFilm({ ...args, cooldownSeconds });
  assert.equal(plan.shotUsage.forcedRepetitionCount, 0, plan.shotUsage.note);
  assert.equal(plan.shotUsage.poolTooSmall, false);

  const lastEnd = new Map();
  for (const beat of allBeats(plan)) {
    const previous = lastEnd.get(beat.shotId);
    if (previous !== undefined) {
      const gap = beat.startSeconds - previous;
      assert.ok(gap >= cooldownSeconds - EPS,
        `${beat.shotId} came back after ${gap.toFixed(2)}s, cooldown is ${cooldownSeconds}s`);
    }
    lastEnd.set(beat.shotId, beat.startSeconds + beat.durationSeconds);
  }

  // Proof that the assertion above is discriminating: the same pool without a
  // cooldown reuses a clip well inside the window.
  const uncooled = planFilm({ ...args, cooldownSeconds: 0 });
  assert.ok(smallestReuseGap(uncooled) < cooldownSeconds,
    `this pool must violate the window when the cooldown is off, got ${smallestReuseGap(uncooled)}s`);
});

test('a tiny pool reports forced repetition rather than hiding it', () => {
  const cooldownSeconds = 45;
  const plan = planFilm({
    structure: 'three-act',
    targetSeconds: 120,
    shots: pool(2, 5),
    cooldownSeconds
  });

  const forcedBeats = allBeats(plan).filter(beat => beat.forcedRepeat);
  assert.ok(forcedBeats.length > 0, 'a 2-clip pool cannot honour a 45s cooldown across 120s');
  assert.equal(plan.shotUsage.forcedRepetitionCount, forcedBeats.length,
    'every forced beat must appear in shotUsage.forcedRepetitions');
  assert.equal(plan.shotUsage.poolTooSmall, true);
  assert.match(plan.shotUsage.note, /cooldown/);

  for (const entry of plan.shotUsage.forcedRepetitions) {
    assert.ok(entry.shotId && entry.actName, 'a forced repetition names its clip and act');
    assert.equal(entry.cooldownSeconds, cooldownSeconds);
    assert.ok(entry.gapSeconds === null || entry.gapSeconds < cooldownSeconds,
      `a forced repetition must be inside the cooldown, got ${entry.gapSeconds}s`);
  }

  // The film is still cut, and still tiles.
  assert.ok(Math.abs(plan.totalSeconds - 120) < EPS);
});

test('a zero cooldown never reports a forced repetition', () => {
  const plan = planFilm({ structure: 'three-act', targetSeconds: 120, shots: pool(2, 5), cooldownSeconds: 0 });
  assert.equal(plan.shotUsage.forcedRepetitionCount, 0);
});

/* ------------------------------------------------------------------ */
/* Estimate                                                            */
/* ------------------------------------------------------------------ */

test('estimateFilmRender scales linearly and states its basis', () => {
  const shots = pool(20, 12);
  const short = planFilm({ structure: 'three-act', targetSeconds: 200, shots });
  const long = planFilm({ structure: 'three-act', targetSeconds: 400, shots });

  const a = estimateFilmRender(short);
  const b = estimateFilmRender(long);

  assert.ok(Math.abs(b.projectedSeconds - 2 * a.projectedSeconds) < 0.01,
    `400s projects ${b.projectedSeconds}s, 200s projects ${a.projectedSeconds}s; must be linear`);
  assert.ok(Math.abs(a.projectedSeconds - 200 * (11 / 15)) < 0.01,
    `200s must project 200 * 11/15 = ${(200 * 11 / 15).toFixed(3)}s, got ${a.projectedSeconds}`);

  assert.equal(a.rate.idleSecondsPerOutputSecond, 11 / 15);
  assert.match(a.rate.basis, /15s/);
  assert.match(a.rate.basis, /11s/);
  assert.match(a.rate.basis, /220s/);
  assert.ok(a.contendedSeconds > a.projectedSeconds, 'contended must be slower than idle');
  assert.equal(FILM_RENDER_RATE.contendedSecondsPerOutputSecond, 220 / 15);
  assert.ok(a.beats > 0 && a.beats === allBeats(short).length);
});

test('estimateFilmRender refuses a plan it cannot measure', () => {
  assert.throws(() => estimateFilmRender({ totalSeconds: 0 }), /FILM_PLAN_INVALID/);
  assert.throws(() => estimateFilmRender(null), /FILM_PLAN_INVALID/);
});

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

test('filmEvidence reports reuse counts, forced repeats and act sources', () => {
  const plan = planFilm({
    structure: 'montage-essay',
    targetSeconds: 200,
    shots: pool(4, 6),
    title: 'Basalt',
    narration: ['one', 'two', 'three', 'four']
  });
  const evidence = filmEvidence(plan);

  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.title, 'Basalt');
  assert.equal(evidence.beats, allBeats(plan).length);

  const counted = Object.values(evidence.shotReuseCounts).reduce((n, uses) => n + uses, 0);
  assert.equal(counted, evidence.beats, 'reuse counts must account for every beat');

  assert.equal(evidence.forcedRepetitionCount, allBeats(plan).filter(b => b.forcedRepeat).length);
  assert.equal(evidence.actSources.length, plan.acts.length);
  for (const [index, source] of evidence.actSources.entries()) {
    const act = plan.acts[index];
    assert.equal(source.act, act.name);
    assert.equal(source.beats, act.beats.length);
    assert.deepEqual(source.shotIds, [...new Set(act.beats.map(b => b.shotId))]);
  }
  assert.equal(plan.acts[1].narration, 'two', 'narration lines land on their act');
});

/* ------------------------------------------------------------------ */
/* Integration: assemble a short film from real clips                  */
/* ------------------------------------------------------------------ */

const shotsDir = join(root, 'outputs/shots');
const clips = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter(name => name.endsWith('.mp4')).sort()
  : [];
const toolsReady = existsSync(DEFAULT_FFMPEG) && existsSync(DEFAULT_FFPROBE);
const skipIntegration = clips.length < 3
  ? `needs 3+ clips in outputs/shots, found ${clips.length}`
  : !toolsReady
    ? 'ffmpeg/ffprobe not present in workers/tools'
    : false;

test('assembles a short film from real clips and the output measures what was planned',
  { skip: skipIntegration, timeout: 900_000 }, async t => {
    const shots = [];
    const shotLibrary = {};
    const unreadable = [];
    for (const file of clips) {
      const path = join(shotsDir, file);
      const id = file.replace(/\.mp4$/, '');
      // The generator writes into this directory while tests run; a clip that
      // is still half-written is skipped, not guessed at.
      let durationSeconds;
      try {
        durationSeconds = await probeDurationSeconds(path);
      } catch {
        unreadable.push(file);
        continue;
      }
      shots.push({ id, durationSeconds });
      shotLibrary[id] = { path };
    }
    if (shots.length < 3) {
      t.skip(`needs 3+ probeable clips, got ${shots.length} (unreadable: ${unreadable.join(', ') || 'none'})`);
      return;
    }

    const plan = planFilm({
      structure: 'montage-essay',
      targetSeconds: 30,
      shots,
      title: 'Integration cut',
      // 640x360 keeps the check honest about timing without paying 1080p.
      canvas: { width: 640, height: 360, fps: 24 }
    });

    for (const beat of allBeats(plan)) {
      const source = shots.find(s => s.id === beat.shotId);
      assert.ok(beat.durationSeconds <= source.durationSeconds + 1e-9,
        `${beat.shotId}: planned ${beat.durationSeconds}s from a ${source.durationSeconds}s clip`);
      assert.ok(beat.durationSeconds >= MIN_BEAT_SECONDS - 1e-9 || beat.durationSeconds > 0);
    }

    const workDir = await mkdtemp(join(tmpdir(), 'vyrealm-film-'));
    const output = join(workDir, 'film.mp4');
    try {
      const result = await assembleFilm(plan, { shotLibrary, output, workDir: join(workDir, 'beats') });

      assert.ok(existsSync(output), 'the film must exist on disk');
      assert.equal(result.measured.width, 640);
      assert.equal(result.measured.height, 360);
      assert.ok(Math.abs(result.measured.seconds - plan.totalSeconds) < 0.25,
        `measured ${result.measured.seconds}s against a planned ${plan.totalSeconds}s (drift ${result.driftSeconds}s)`);
      assert.equal(result.beats, allBeats(plan).length);
      assert.equal(result.transitions.rendered, 'hard-cut');
      assert.equal(result.evidence.schemaVersion, 1);

      console.log(`[integration] ${clips.length} clips -> ${plan.totalSeconds}s planned, ` +
        `${result.measured.seconds}s measured, ${result.beats} beats, ${result.renderMs}ms ffmpeg ` +
        `(projected ${estimateFilmRender(plan).projectedSeconds}s)`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
