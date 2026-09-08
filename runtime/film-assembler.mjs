/**
 * Assemble many short generated clips into one long-form film.
 *
 * The format engine (format-library + format-render) handles 10-60s pieces,
 * where every beat is hand-authored and the shot pool is small enough that
 * repetition is not a problem. Three to ten minutes is a different problem:
 * a 5-minute film at dynamic pacing is over a hundred cuts drawn from a
 * handful of ~4s LTX clips, so the questions are shot ORDERING, act pacing,
 * and not showing the viewer a clip they saw twelve seconds ago.
 *
 * This module plans that. It generates no pixels and writes no filter code:
 * rendering is delegated to format-render.renderPlan, which owns the camera
 * and grade maths.
 *
 * Two honesty rules drive the design:
 *   1. A beat never runs longer than the footage actually behind it. Real
 *      durations are supplied by the caller (measured, not assumed) and
 *      planFilm refuses a shot that arrives without one.
 *   2. When the pool is too small to honour the repeat cooldown, the film is
 *      still cut, but every forced repetition is named in shotUsage. A film
 *      that quietly recycles the same six clips looks like a bug to the
 *      viewer and like success to the log.
 */

import { GRADES, PACING } from './format-library.mjs';
import { renderPlan, DEFAULT_FFMPEG, DEFAULT_FFPROBE } from './format-render.mjs';

/** Shortest beat worth cutting. Below this a beat reads as a glitch. */
export const MIN_BEAT_SECONDS = 0.5;

/** Default gap before a clip may appear again, in seconds of film time. */
export const DEFAULT_COOLDOWN_SECONDS = 45;

/** Long-form canvas. Overridable; 1920x1080 at 24fps matches the YouTube spec. */
export const DEFAULT_CANVAS = Object.freeze({ width: 1920, height: 1080, fps: 24 });

/** The band of durations this module is designed for. Outside it, it still plans. */
export const DESIGN_RANGE_SECONDS = Object.freeze({ min: 180, max: 600 });

const freezeStructure = s => Object.freeze({ ...s, acts: Object.freeze(s.acts.map(a => Object.freeze(a))) });

/**
 * Narrative structures. `proportion` values sum to 1 within each structure;
 * `pacing` keys are format-library PACING ids (cutsPerMinute drives beat
 * length); `energy` is 0-1 and drives camera aggression and transitions.
 */
export const FILM_STRUCTURES = Object.freeze({
  'three-act': freezeStructure({
    id: 'three-act',
    label: 'Three act',
    grade: 'film-vintage',
    acts: [
      { name: 'setup', proportion: 0.25, pacing: 'calm', energy: 0.35 },
      { name: 'confrontation', proportion: 0.5, pacing: 'dynamic', energy: 0.75 },
      { name: 'resolution', proportion: 0.25, pacing: 'calm', energy: 0.45 }
    ]
  }),
  'documentary-chapters': freezeStructure({
    id: 'documentary-chapters',
    label: 'Documentary chapters',
    grade: 'neutral',
    acts: [
      { name: 'cold-open', proportion: 0.1, pacing: 'dynamic', energy: 0.6 },
      { name: 'chapter-one', proportion: 0.28, pacing: 'calm', energy: 0.35 },
      { name: 'chapter-two', proportion: 0.28, pacing: 'calm', energy: 0.45 },
      { name: 'chapter-three', proportion: 0.22, pacing: 'dynamic', energy: 0.6 },
      { name: 'coda', proportion: 0.12, pacing: 'calm', energy: 0.25 }
    ]
  }),
  'montage-essay': freezeStructure({
    id: 'montage-essay',
    label: 'Montage essay',
    grade: 'high-contrast-noir',
    acts: [
      { name: 'statement', proportion: 0.15, pacing: 'dynamic', energy: 0.6 },
      { name: 'accumulation', proportion: 0.45, pacing: 'dynamic', energy: 0.8 },
      { name: 'turn', proportion: 0.25, pacing: 'chaotic', energy: 0.95 },
      { name: 'landing', proportion: 0.15, pacing: 'calm', energy: 0.3 }
    ]
  }),
  'anime-vignette': freezeStructure({
    id: 'anime-vignette',
    label: 'Anime vignette',
    grade: 'anime-flat',
    acts: [
      { name: 'establish', proportion: 0.2, pacing: 'calm', energy: 0.3 },
      { name: 'drift', proportion: 0.35, pacing: 'calm', energy: 0.45 },
      { name: 'surge', proportion: 0.3, pacing: 'chaotic', energy: 0.9 },
      { name: 'afterglow', proportion: 0.15, pacing: 'calm', energy: 0.2 }
    ]
  })
});

/** Camera vocabulary per energy band. All ids exist in format-library CAMERA_MOVES. */
const MOTION_LADDER = Object.freeze({
  calm: Object.freeze(['hold', 'slow-push', 'drift', 'slow-pan', 'tilt-up', 'pull-out']),
  steady: Object.freeze(['push-in', 'truck-left', 'parallax', 'crane', 'truck-right', 'orbit']),
  hot: Object.freeze(['crash-zoom', 'macro-push', 'snap', 'shake', 'orbit-reverse', 'handheld'])
});

const round3 = value => Math.round(value * 1000) / 1000;

function coded(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function energyBand(energy) {
  if (energy < 0.4) return 'calm';
  if (energy < 0.75) return 'steady';
  return 'hot';
}

/**
 * Normalise the supplied pool. A shot without a real, positive duration is
 * refused rather than guessed at: the whole point is that a beat can never
 * outrun its source.
 */
function readPool(shots) {
  if (!Array.isArray(shots) || shots.length === 0) {
    throw coded('FILM_POOL_EMPTY', 'planFilm needs at least one shot with a measured duration');
  }
  const seen = new Set();
  const pool = [];
  const unusable = [];
  for (const [index, shot] of shots.entries()) {
    const id = shot?.id;
    if (!id || typeof id !== 'string') {
      throw coded('FILM_SHOT_ID_MISSING', `shot at index ${index} has no id`);
    }
    if (seen.has(id)) throw coded('FILM_SHOT_DUPLICATE', `shot id ${id} appears twice in the pool`);
    seen.add(id);
    const total = Number(shot.durationSeconds);
    if (!Number.isFinite(total) || total <= 0) {
      throw coded('FILM_SHOT_DURATION_UNKNOWN',
        `shot ${id} has no measured durationSeconds; probe the file (format-render.probeDurationSeconds) rather than assuming a length`,
        { shotId: id });
    }
    const inPoint = Number(shot.inPoint ?? 0);
    if (!Number.isFinite(inPoint) || inPoint < 0) {
      throw coded('FILM_SHOT_INPOINT_INVALID', `shot ${id} has an invalid inPoint ${shot.inPoint}`, { shotId: id });
    }
    // Floor, never round: a rounded-up duration would claim a millisecond of
    // footage the file does not contain.
    const usableSeconds = Math.floor((total - inPoint) * 1000) / 1000;
    if (usableSeconds < MIN_BEAT_SECONDS) {
      unusable.push({ shotId: id, durationSeconds: total, inPoint, usableSeconds, reason: `under the ${MIN_BEAT_SECONDS}s minimum beat` });
      continue;
    }
    pool.push({ id, index: pool.length, durationSeconds: total, inPoint, usableSeconds });
  }
  if (pool.length === 0) {
    throw coded('FILM_POOL_TOO_SHORT', `no supplied shot holds ${MIN_BEAT_SECONDS}s of usable footage`, { unusable });
  }
  return { pool, unusable };
}

/**
 * Pick the next clip. Preference order among clips past their cooldown:
 * one long enough to fill the beat, then least used, then longest off screen,
 * then pool order. Deterministic: same inputs, same cut.
 */
function chooseShot(pool, usage, atSeconds, cooldownSeconds, nominalSeconds) {
  const gapOf = shot => {
    const used = usage.get(shot.id);
    return used ? atSeconds - used.lastEndSeconds : Infinity;
  };
  const rank = (a, b) => {
    const coversA = a.usableSeconds + 1e-9 >= nominalSeconds;
    const coversB = b.usableSeconds + 1e-9 >= nominalSeconds;
    if (coversA !== coversB) return coversA ? -1 : 1;
    const usesA = usage.get(a.id)?.uses ?? 0;
    const usesB = usage.get(b.id)?.uses ?? 0;
    if (usesA !== usesB) return usesA - usesB;
    const gapA = gapOf(a);
    const gapB = gapOf(b);
    if (gapA !== gapB) return gapB - gapA;
    return a.index - b.index;
  };
  const eligible = pool.filter(shot => gapOf(shot) >= cooldownSeconds);
  if (eligible.length > 0) return { shot: eligible.sort(rank)[0], forced: false, gapSeconds: null };
  const shot = [...pool].sort(rank)[0];
  const gap = gapOf(shot);
  return { shot, forced: true, gapSeconds: Number.isFinite(gap) ? round3(gap) : null };
}

/**
 * Plan a long-form film: act structure, shot order, beat timings.
 *
 * Beats tile each act exactly (the final beat of an act absorbs the rounding
 * remainder) and no beat exceeds the usable footage behind its clip.
 */
export function planFilm({
  structure,
  targetSeconds,
  shots,
  title = 'Untitled film',
  narration = null,
  cooldownSeconds = DEFAULT_COOLDOWN_SECONDS,
  canvas = DEFAULT_CANVAS,
  grade = null
} = {}) {
  const spec = FILM_STRUCTURES[structure];
  if (!spec) {
    throw coded('FILM_STRUCTURE_UNKNOWN', `unknown structure ${structure}; known: ${Object.keys(FILM_STRUCTURES).join(', ')}`);
  }
  const total = Number(targetSeconds);
  if (!Number.isFinite(total) || total <= 0) {
    throw coded('FILM_TARGET_INVALID', `targetSeconds must be a positive number, got ${targetSeconds}`);
  }
  const cooldown = Number(cooldownSeconds);
  if (!Number.isFinite(cooldown) || cooldown < 0) {
    throw coded('FILM_COOLDOWN_INVALID', `cooldownSeconds must be >= 0, got ${cooldownSeconds}`);
  }
  const gradeId = grade ?? spec.grade;
  if (!GRADES[gradeId]) throw coded('FILM_GRADE_UNKNOWN', `unknown grade ${gradeId}`);

  const { pool, unusable } = readPool(shots);
  const lines = narration == null
    ? []
    : Array.isArray(narration)
      ? narration.map(line => String(line))
      : String(narration).split('\n').filter(Boolean);

  const usage = new Map();
  const forcedRepetitions = [];
  const acts = [];
  let cursor = 0;
  let cumulative = 0;
  let filmBeatIndex = 0;

  for (const [actIndex, actSpec] of spec.acts.entries()) {
    const pacing = PACING[actSpec.pacing];
    if (!pacing) throw coded('FILM_PACING_UNKNOWN', `structure ${structure} act ${actSpec.name} uses unknown pacing ${actSpec.pacing}`);
    cumulative += actSpec.proportion;
    // The last act absorbs rounding so the acts tile the film exactly.
    const actEnd = actIndex === spec.acts.length - 1 ? total : round3(total * cumulative);
    const actStart = cursor;
    const beatTarget = 60 / pacing.cutsPerMinute;
    const ladder = MOTION_LADDER[energyBand(actSpec.energy)];
    const beats = [];

    while (actEnd - cursor > 1e-6) {
      if (beats.length > 20000) throw coded('FILM_BEAT_RUNAWAY', `act ${actSpec.name} did not converge`);
      const remaining = actEnd - cursor;
      const nominal = Math.min(beatTarget, remaining);
      const { shot, forced, gapSeconds } = chooseShot(pool, usage, cursor, cooldown, nominal);
      let duration = Math.min(nominal, shot.usableSeconds);

      // Avoid leaving a sub-minimum sliver behind: swallow it when the clip is
      // long enough, otherwise give it back so the tail beat is real.
      const leftover = remaining - duration;
      if (leftover > 1e-9 && leftover < MIN_BEAT_SECONDS) {
        if (shot.usableSeconds + 1e-9 >= remaining) duration = remaining;
        else if (duration - MIN_BEAT_SECONDS >= MIN_BEAT_SECONDS) duration -= MIN_BEAT_SECONDS;
      }
      duration = Math.min(round3(duration), shot.usableSeconds);
      if (remaining - duration < 1e-6) duration = remaining; // exact tile of the act
      if (!(duration > 1e-9)) throw coded('FILM_BEAT_DEGENERATE', `act ${actSpec.name} produced a zero-length beat`);

      const transition = filmBeatIndex === 0
        ? 'fade-in'
        : beats.length === 0
          ? (actSpec.energy >= 0.7 ? 'cut' : 'dissolve')
          : 'cut';

      beats.push({
        shotId: shot.id,
        startSeconds: round3(cursor),
        durationSeconds: round3(duration),
        motion: ladder[filmBeatIndex % ladder.length],
        grade: gradeId,
        transition,
        forcedRepeat: forced,
        sourceUsableSeconds: shot.usableSeconds
      });

      if (forced) {
        forcedRepetitions.push({
          shotId: shot.id,
          actName: actSpec.name,
          atSeconds: round3(cursor),
          gapSeconds,
          cooldownSeconds: cooldown,
          reason: `only ${pool.length} usable clip${pool.length === 1 ? '' : 's'} in the pool; every one was inside the ${cooldown}s cooldown`
        });
      }

      const prior = usage.get(shot.id) ?? { uses: 0, totalSeconds: 0, acts: [], firstUseSeconds: round3(cursor), forced: 0 };
      usage.set(shot.id, {
        uses: prior.uses + 1,
        totalSeconds: round3(prior.totalSeconds + duration),
        acts: prior.acts.includes(actSpec.name) ? prior.acts : [...prior.acts, actSpec.name],
        firstUseSeconds: prior.firstUseSeconds,
        lastEndSeconds: cursor + duration,
        forced: prior.forced + (forced ? 1 : 0)
      });

      cursor += duration;
      filmBeatIndex += 1;
    }

    acts.push({
      name: actSpec.name,
      startSeconds: round3(actStart),
      durationSeconds: round3(actEnd - actStart),
      pacing: actSpec.pacing,
      cutsPerMinute: pacing.cutsPerMinute,
      energy: actSpec.energy,
      narration: lines[actIndex] ?? null,
      beats
    });
    cursor = actEnd;
  }

  const shotUsage = {
    cooldownSeconds: cooldown,
    poolSize: pool.length,
    beats: filmBeatIndex,
    shots: pool.map(shot => {
      const used = usage.get(shot.id);
      return {
        shotId: shot.id,
        usableSeconds: shot.usableSeconds,
        uses: used?.uses ?? 0,
        screenSeconds: used?.totalSeconds ?? 0,
        forcedUses: used?.forced ?? 0,
        acts: used?.acts ?? []
      };
    }),
    unusedShots: pool.filter(shot => !usage.has(shot.id)).map(shot => shot.id),
    unusableShots: unusable,
    forcedRepetitions,
    forcedRepetitionCount: forcedRepetitions.length,
    poolTooSmall: forcedRepetitions.length > 0,
    note: forcedRepetitions.length
      ? `${forcedRepetitions.length} of ${filmBeatIndex} beats repeat a clip inside the ${cooldown}s cooldown because the pool holds only ${pool.length} usable clips. Generate more shots to clear this.`
      : `No clip repeats inside the ${cooldown}s cooldown.`
  };

  return {
    schemaVersion: 1,
    title: String(title),
    structure: spec.id,
    structureLabel: spec.label,
    grade: gradeId,
    canvas,
    requestedSeconds: total,
    totalSeconds: round3(acts.reduce((sum, act) => sum + act.durationSeconds, 0)),
    withinDesignRange: total >= DESIGN_RANGE_SECONDS.min && total <= DESIGN_RANGE_SECONDS.max,
    designRangeSeconds: DESIGN_RANGE_SECONDS,
    narration: lines.length ? lines : null,
    acts,
    shotUsage
  };
}

/**
 * Measured render rate. FFmpeg composited a 15s 1080x1920 cut in ~11s on an
 * idle machine and took up to 220s for the same work under GPU contention.
 * Both figures are per second of OUTPUT; there is no measurement of per-beat
 * process overhead, so none is invented here.
 */
export const FILM_RENDER_RATE = Object.freeze({
  idleSecondsPerOutputSecond: 11 / 15,
  contendedSecondsPerOutputSecond: 220 / 15,
  basis: 'measured: FFmpeg composite of a 15s 1080x1920 cut = ~11s idle, up to 220s under GPU contention',
  caveat: 'Per-beat process startup is not measured and is not modelled. A cut with many short beats will run over the idle projection.'
});

/** Projected FFmpeg seconds for a plan, linear in output duration. */
export function estimateFilmRender(plan) {
  const seconds = Number(plan?.totalSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw coded('FILM_PLAN_INVALID', 'estimateFilmRender needs a plan with a positive totalSeconds');
  }
  const beats = (plan.acts ?? []).reduce((n, act) => n + act.beats.length, 0);
  return {
    schemaVersion: 1,
    totalSeconds: seconds,
    beats,
    projectedSeconds: round3(seconds * FILM_RENDER_RATE.idleSecondsPerOutputSecond),
    contendedSeconds: round3(seconds * FILM_RENDER_RATE.contendedSecondsPerOutputSecond),
    rate: FILM_RENDER_RATE,
    model: 'projectedSeconds = totalSeconds * 11/15, from the measured 15s-cut composite'
  };
}

/** Evidence record: what the film is made of and where it had to repeat itself. */
export function filmEvidence(plan) {
  if (!plan?.acts) throw coded('FILM_PLAN_INVALID', 'filmEvidence needs a plan from planFilm');
  const reuse = {};
  for (const shot of plan.shotUsage.shots) reuse[shot.shotId] = shot.uses;
  return {
    schemaVersion: 1,
    title: plan.title,
    structure: plan.structure,
    totalSeconds: plan.totalSeconds,
    beats: plan.acts.reduce((n, act) => n + act.beats.length, 0),
    poolSize: plan.shotUsage.poolSize,
    cooldownSeconds: plan.shotUsage.cooldownSeconds,
    shotReuseCounts: reuse,
    unusedShots: plan.shotUsage.unusedShots,
    forcedRepetitions: plan.shotUsage.forcedRepetitions,
    forcedRepetitionCount: plan.shotUsage.forcedRepetitionCount,
    actSources: plan.acts.map(act => ({
      act: act.name,
      startSeconds: act.startSeconds,
      durationSeconds: act.durationSeconds,
      beats: act.beats.length,
      shotIds: [...new Set(act.beats.map(beat => beat.shotId))],
      forcedRepeats: act.beats.filter(beat => beat.forcedRepeat).length
    })),
    sourceMethod: 'composited-from-existing-footage',
    note: plan.shotUsage.note
  };
}

/**
 * Render a planned film. The beat-then-concat pass, the camera/grade filter
 * maths and the footage-supply check all belong to format-render.renderPlan;
 * this only flattens the act structure into the timeline it expects.
 */
export async function assembleFilm(plan, {
  shotLibrary,
  output,
  workDir,
  ffmpeg = DEFAULT_FFMPEG,
  ffprobe = DEFAULT_FFPROBE,
  onProgress = () => {},
  allowExtension = false
} = {}) {
  if (!plan?.acts?.length) throw coded('FILM_PLAN_INVALID', 'assembleFilm needs a plan from planFilm');
  if (!shotLibrary) throw coded('FILM_LIBRARY_MISSING', 'assembleFilm needs a shotLibrary mapping shotId -> { path, inPoint }');
  if (!output || !workDir) throw coded('FILM_OUTPUT_MISSING', 'assembleFilm needs both output and workDir paths');

  const timeline = [];
  for (const act of plan.acts) {
    for (const [index, beat] of act.beats.entries()) {
      timeline.push({
        index: timeline.length,
        role: `${act.name}#${index}`,
        act: act.name,
        startSeconds: beat.startSeconds,
        durationSeconds: beat.durationSeconds,
        shotRole: beat.shotId,
        motion: beat.motion,
        route: 'composite'
      });
    }
  }

  const renderable = {
    schemaVersion: 1,
    formatId: `film/${plan.structure}`,
    formatLabel: plan.title,
    platform: 'long-form',
    canvas: plan.canvas,
    durationSeconds: plan.totalSeconds,
    grade: { id: plan.grade, ...GRADES[plan.grade] },
    captionStyle: { id: 'none' },
    timeline
  };

  const result = await renderPlan({
    plan: renderable,
    shotLibrary,
    output,
    workDir,
    ffmpeg,
    ffprobe,
    allowExtension,
    onProgress: event => onProgress({ ...event, act: timeline[event.index]?.act ?? null })
  });

  // renderPlan cuts hard. Declared dissolves and fades are plan intent, not
  // rendered pixels, so they are reported rather than implied.
  const nonCut = plan.acts.flatMap(act => act.beats).filter(beat => beat.transition !== 'cut');

  return {
    ...result,
    schemaVersion: 1,
    title: plan.title,
    structure: plan.structure,
    acts: plan.acts.map(act => ({ name: act.name, beats: act.beats.length, durationSeconds: act.durationSeconds })),
    plannedSeconds: plan.totalSeconds,
    driftSeconds: round3(result.measured.seconds - plan.totalSeconds),
    beats: timeline.length,
    transitions: {
      rendered: 'hard-cut',
      declaredNonCut: nonCut.length,
      kinds: [...new Set(nonCut.map(beat => beat.transition))],
      note: 'Transitions are declared in the plan but renderPlan concatenates hard cuts; no dissolve or fade was rendered.'
    },
    evidence: filmEvidence(plan)
  };
}
