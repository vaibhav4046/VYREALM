// Finishing pipeline: interpolate, upscale, grade, encode.
//
// The chain that lifts a 768x512 LTX clip toward something postable. It exists
// to do one thing honestly: a finished 1080p file whose pixels came from a
// 768x512 generation is an UPSCALED 768x512 clip, and every artefact this
// module emits says so. `nativeResolution` always carries the true source
// size, `deliveryMethod` always names the method AND the source resolution
// ("lanczos-from-768x512"), and finishingEvidence() will not write
// generationStatus "generated" for a clip whose delivered frame is larger than
// the one the model produced.
//
// Every duration here is one of three things and which one is always stated:
//   MEASURED      a run recorded in this repo (TASKS.md, docs/LOCAL_*.md)
//   EXTRAPOLATED  arithmetic from one of those anchors, rate shown
//   UNVERIFIED    an assumption that drives a number, named where it is used
//
// Sits below runtime/quality-gate.mjs (which decides WHETHER to repair) and
// beside runtime/frame-interpolation.mjs (which is the audited RIFE executor;
// this module plans and prices RIFE, it does not re-implement it).

import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const MP = (w, h) => (w * h) / 1e6;
const round = (n, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

const DEFAULT_FFMPEG = process.env.VYRELUM_FFMPEG || join(APP, 'workers/tools/ffmpeg.exe');
const DEFAULT_FFPROBE = process.env.VYRELUM_FFPROBE || join(APP, 'workers/tools/ffprobe.exe');

// Verified present on this box on 2026-09-08: rife-ncnn-vulkan.exe is 6,974,464
// bytes, matching the entry in runtime/interpolation.lock.json, and the
// Real-ESRGAN binary and x4plus model sit where runtime/enhancement.lock.json
// says. Neither is executed by this module; the paths exist so a plan can name
// the tool it is pricing and a refusal can name what to run instead.
const TOOL_PATHS = Object.freeze({
  ffmpeg: DEFAULT_FFMPEG,
  'rife-ncnn-vulkan': process.env.VYREALM_RIFE || 'D:\\VYREALM-runtime\\rife-qualification\\runtime\\rife-ncnn-vulkan.exe',
  'realesrgan-ncnn-vulkan': process.env.VYREALM_REALESRGAN || 'D:\\VYREALM-runtime\\enhancement\\realesrgan-20220424\\realesrgan-ncnn-vulkan.exe',
});

// --------------------------------------------------------------------------
// measured anchors
// --------------------------------------------------------------------------

export const ANCHORS = Object.freeze({
  // docs/LOCAL_INTERPOLATION_2026-09-07.md: job f6714a87, 314.336 s, three
  // 300-frame segments at 1920x1080/60 from a 15 s 1080p source. The repair
  // pass reused verified frames and took 46.564 s, which is why a re-run of an
  // already-interpolated shot must never be priced at the first-pass rate.
  rife: Object.freeze({
    seconds: 314.336, outputFrames: 900, width: 1920, height: 1080, sourceSeconds: 15, targetFps: 60,
    cachedRepairSeconds: 46.564,
    source: 'docs/LOCAL_INTERPOLATION_2026-09-07.md',
  }),
  // TASKS.md: "Real-ESRGAN enhancement of first shot | UHD 3840 x 2160, 120
  // frames | 1077.676 s". Input was the 5 s 1024x576 shot (quality-gate.mjs
  // realesrgan-upscale basis, docs/LOCAL_NEURAL_RESEARCH_2026-09-07.md).
  realesrgan: Object.freeze({
    seconds: 1077.676, inputFrames: 120, width: 1024, height: 576, outWidth: 3840, outHeight: 2160, sourceSeconds: 5,
    source: 'TASKS.md + docs/LOCAL_NEURAL_RESEARCH_2026-09-07.md',
  }),
  // The project's FFmpeg composite anchor: a 15 s 1080x1920 cut, ~11 s idle on
  // the 12-core reference box, up to 220 s under GPU contention (20x). The
  // anchor's frame rate was never recorded, so these rates are per SOURCE
  // SECOND and per output megapixel with no frame-count term: a 60 fps encode
  // costs more than this model says. UNVERIFIED, and the direction is known.
  //
  // MEASURED against this model on 2026-09-08, finishing the same 3.88 s
  // 768x512 LTX shot to 1920x1080 twice against a projected 8.4 s:
  //   idle-ish:   4.825 + 4.460 + 4.979 = 14.264 s  (1.70x the projection)
  //   contended: 13.012 + 12.028 + 7.693 = 32.733 s (3.90x), with local LTX
  //              generation running on the same box
  // Two reasons, both real: per-invocation FFmpeg startup and libx264 lookahead
  // do not scale with duration, and the contention spread this anchor already
  // records applies to finishing too. Treat projections as a floor, not a
  // forecast, and see projectedSecondsUnderContention for the other end.
  ffmpeg: Object.freeze({
    seconds: 11, sourceSeconds: 15, width: 1080, height: 1920, cores: 12, contendedSeconds: 220,
    source: 'project compute anchors (capability-tiers.mjs MEASURED.composite)',
  }),
});

const RIFE_RATE = ANCHORS.rife.seconds / (ANCHORS.rife.outputFrames * MP(ANCHORS.rife.width, ANCHORS.rife.height));
const ESRGAN_RATE = ANCHORS.realesrgan.seconds / (ANCHORS.realesrgan.inputFrames * MP(ANCHORS.realesrgan.width, ANCHORS.realesrgan.height));
const FFMPEG_RATE = ANCHORS.ffmpeg.seconds / (ANCHORS.ffmpeg.sourceSeconds * MP(ANCHORS.ffmpeg.width, ANCHORS.ffmpeg.height));
export const CONTENTION_MULTIPLIER = round(ANCHORS.ffmpeg.contendedSeconds / ANCHORS.ffmpeg.seconds, 2);

// Lanczos beyond 4x is mush with a resolution number stapled to it. The cap is
// POLICY, chosen to match the one real neural upscaler on disk (Real-ESRGAN
// x4plus): past this factor the honest answer is "use the model or deliver
// smaller", never "resample harder".
const MAX_UPSCALE_FACTOR = 4;
const SCALE_MODES = Object.freeze(['lanczos', 'bicubic', 'bilinear', 'spline', 'neighbor']);
const even = n => Math.max(2, Math.floor(n / 2) * 2);

// CHOSEN, not measured. Half a second is wider than any container-vs-stream
// duration disagreement seen on these clips (the LTX shots are 97 frames at 25
// fps = 3.88 s exactly, and ffprobe agrees to 4 dp) and narrow enough that a
// dropped or looped second cannot pass as a rounding difference. It is the
// guard that stops a time-extended file being receipted as the same clip.
const DURATION_DRIFT_TOLERANCE_SECONDS = 0.5;

// Grade and encode constants are CHOSEN look/delivery defaults with no measured
// basis in this repo: contrast 1.04 / saturation 0.96 pull back LTX's slight
// oversaturation by eye, hqdn3d=1.5:1.5:6:6 is FFmpeg's own documented mild
// preset, crf 18 keeps intermediates above the crf 20 delivery so the chain
// does not compound its own compression, and 2 s GOP / 192k AAC are common
// platform delivery defaults. None of them is a measurement; they are settings.
const GRADE_DEFAULTS = Object.freeze({ contrast: 1.04, saturation: 0.96, gamma: 1.0, denoise: true });
const INTERMEDIATE_CRF = 18;
const DELIVERY = Object.freeze({ codec: 'libx264', crf: 20, preset: 'medium', profile: 'high', pixelFormat: 'yuv420p', gopSeconds: 2, audioCodec: 'aac', audioBitrate: '192k' });

// --------------------------------------------------------------------------
// the catalogue
// --------------------------------------------------------------------------

const costModel = (unit, basis, seconds) => Object.freeze({ unit, basis, seconds });

/**
 * The finishing chain, declared in execution order. Order is load-bearing:
 * interpolation runs BEFORE upscaling because runtime/frame-interpolation.mjs
 * refuses any source above 1920x1080 ("Interpolate at 1080p or lower before a
 * separate 4K enhancement"), and it also makes the RIFE pass cheap.
 *
 * `provenanceLabel` is what the step does to the truth of the output, and it is
 * the field the evidence writer reads. "upscaled" and "interpolated" are not
 * decoration: they are the reason a receipt can never claim native 4K.
 */
export const FINISHING_STEPS = Object.freeze([
  Object.freeze({
    id: 'rife-interpolate',
    label: 'RIFE frame interpolation',
    tool: 'rife-ncnn-vulkan',
    fixes: Object.freeze(['motion_roughness', 'motionStutter', 'lowMotionSmoothness', 'steppedCadence', 'duplicateFrames']),
    costModel: costModel(
      'seconds per output frame megapixel',
      'EXTRAPOLATED from the measured RIFE job (' + ANCHORS.rife.seconds + ' s for ' + ANCHORS.rife.outputFrames + ' output frames at ' +
        ANCHORS.rife.width + 'x' + ANCHORS.rife.height + ', ' + ANCHORS.rife.source + '): ' + round(RIFE_RATE, 5) +
        ' s per output-frame-megapixel. A cached repair of an already-interpolated shot took ' + ANCHORS.rife.cachedRepairSeconds +
        ' s and is not priced here. Linearity in frames and pixels is UNVERIFIED; one job is one point.',
      ({ sourceSeconds, width, height, outFps }) => RIFE_RATE * (sourceSeconds * outFps) * MP(width, height)),
    preservesOriginal: true,
    provenanceLabel: 'interpolated',
  }),
  Object.freeze({
    id: 'realesrgan-upscale',
    label: 'Real-ESRGAN x4 upscale',
    tool: 'realesrgan-ncnn-vulkan',
    fixes: Object.freeze(['encode_blocking', 'softness', 'lowImagingQuality', 'blockiness']),
    costModel: costModel(
      'seconds per input frame megapixel',
      'EXTRAPOLATED from the measured enhancement run (' + ANCHORS.realesrgan.seconds + ' s for ' + ANCHORS.realesrgan.inputFrames +
        ' frames at ' + ANCHORS.realesrgan.width + 'x' + ANCHORS.realesrgan.height + ' to ' + ANCHORS.realesrgan.outWidth + 'x' +
        ANCHORS.realesrgan.outHeight + ', ' + ANCHORS.realesrgan.source + '): ' + round(ESRGAN_RATE, 4) +
        ' s per input-frame-megapixel. The x4 factor is fixed by the model, so cost tracks INPUT pixels.',
      ({ sourceSeconds, fps, width, height }) => ESRGAN_RATE * (sourceSeconds * fps) * MP(width, height)),
    preservesOriginal: false,
    provenanceLabel: 'upscaled',
  }),
  Object.freeze({
    id: 'lanczos-scale',
    label: 'Lanczos resize to delivery frame',
    tool: 'ffmpeg',
    fixes: Object.freeze(['delivery_resolution_mismatch']),
    costModel: costModel(
      'seconds per source second per output megapixel',
      'EXTRAPOLATED from the FFmpeg composite anchor (' + ANCHORS.ffmpeg.seconds + ' s for a ' + ANCHORS.ffmpeg.sourceSeconds + ' s ' +
        ANCHORS.ffmpeg.width + 'x' + ANCHORS.ffmpeg.height + ' cut, ' + ANCHORS.ffmpeg.source + '): ' + round(FFMPEG_RATE, 4) +
        ' s per source-second-megapixel, idle. The anchor is a whole composite, so this over-prices a single filter pass; under GPU ' +
        'contention the same anchor reached ' + ANCHORS.ffmpeg.contendedSeconds + ' s (' + CONTENTION_MULTIPLIER + 'x).',
      ({ sourceSeconds, outWidth, outHeight }) => FFMPEG_RATE * sourceSeconds * MP(outWidth, outHeight)),
    preservesOriginal: false,
    provenanceLabel: 'upscaled',
  }),
  Object.freeze({
    id: 'grade',
    label: 'Colour grade and denoise',
    tool: 'ffmpeg',
    fixes: Object.freeze(['colour_oversaturation', 'colour_drift']),
    costModel: costModel(
      'seconds per source second per output megapixel',
      'EXTRAPOLATED from the same FFmpeg composite anchor at ' + round(FFMPEG_RATE, 4) + ' s per source-second-megapixel, idle.',
      ({ sourceSeconds, outWidth, outHeight }) => FFMPEG_RATE * sourceSeconds * MP(outWidth, outHeight)),
    preservesOriginal: false,
    provenanceLabel: 'graded',
  }),
  Object.freeze({
    id: 'encode-delivery',
    label: 'Encode to platform delivery spec',
    tool: 'ffmpeg',
    fixes: Object.freeze(['delivery_spec_mismatch']),
    costModel: costModel(
      'seconds per source second per output megapixel',
      'EXTRAPOLATED from the same FFmpeg composite anchor at ' + round(FFMPEG_RATE, 4) + ' s per source-second-megapixel, idle. ' +
        'The anchor frame rate was never recorded, so a 60 fps delivery costs more than this says.',
      ({ sourceSeconds, outWidth, outHeight }) => FFMPEG_RATE * sourceSeconds * MP(outWidth, outHeight)),
    preservesOriginal: false,
    provenanceLabel: 'encoded',
  }),
]);

const BY_ID = new Map(FINISHING_STEPS.map(s => [s.id, s]));
// Only these may be dropped to fit a budget. Scaling to the delivery frame and
// encoding to spec are the deliverable; dropping them produces a file nobody
// asked for rather than a cheaper version of the one they did.
const OPTIONAL = new Set(['rife-interpolate', 'realesrgan-upscale', 'grade']);

export function finishingStep(id) {
  const step = BY_ID.get(id);
  if (!step) throw fail('UNKNOWN_FINISHING_STEP', `No finishing step "${id}"; known: ${[...BY_ID.keys()].join(', ')}`);
  return step;
}

// --------------------------------------------------------------------------
// scale filter
// --------------------------------------------------------------------------

// 16384 is the H.264 level maximum frame dimension, the ceiling any of these
// steps could actually encode; it is a validation bound, not a measurement.
const positiveInt = (name, value) => {
  if (!Number.isInteger(value) || value <= 0 || value > 16384) {
    throw fail('SCALE_DIMENSIONS_INVALID', `${name} must be a positive integer up to 16384, got ${JSON.stringify(value)}`, { field: name, value });
  }
};

/** The linear factor actually applied to the pixels when fitting inside the target frame. */
export function scaleFactor({ fromWidth, fromHeight, toWidth, toHeight }) {
  return Math.min(toWidth / fromWidth, toHeight / fromHeight);
}

/**
 * FFmpeg filter chain that fits the source inside the delivery frame and pads
 * the remainder. It never distorts: force_original_aspect_ratio=decrease keeps
 * the source geometry and the pad fills what is left, so a 3:2 generation in a
 * 16:9 frame gets bars, not stretched faces.
 *
 * Refuses an upscale beyond MAX_UPSCALE_FACTOR with UPSCALE_FACTOR_UNSUPPORTED
 * rather than emitting a filter that produces expensive mush.
 */
export function buildScaleFilter({ fromWidth, fromHeight, toWidth, toHeight, mode = 'lanczos' } = {}) {
  positiveInt('fromWidth', fromWidth); positiveInt('fromHeight', fromHeight);
  positiveInt('toWidth', toWidth); positiveInt('toHeight', toHeight);
  if (!SCALE_MODES.includes(mode)) throw fail('SCALE_MODE_UNSUPPORTED', `Scale mode "${mode}" is not one of ${SCALE_MODES.join(', ')}`, { mode });
  const factor = scaleFactor({ fromWidth, fromHeight, toWidth, toHeight });
  if (factor > MAX_UPSCALE_FACTOR) {
    throw fail('UPSCALE_FACTOR_UNSUPPORTED',
      `${fromWidth}x${fromHeight} to ${toWidth}x${toHeight} is a ${round(factor)}x upscale; lanczos is capped at ${MAX_UPSCALE_FACTOR}x. ` +
      'Run realesrgan-upscale first or deliver at a smaller frame.',
      { factor: round(factor, 4), maxFactor: MAX_UPSCALE_FACTOR, suggestion: 'realesrgan-upscale' });
  }
  // force_divisible_by=2 keeps the fitted size legal for yuv420p; setsar=1
  // stops a non-square source SAR quietly re-stretching what we just fitted.
  return `scale=${toWidth}:${toHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=${mode},` +
    `pad=${toWidth}:${toHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

// --------------------------------------------------------------------------
// planning
// --------------------------------------------------------------------------

const readClip = (o, what) => {
  if (!o || typeof o !== 'object') throw fail('PLAN_INPUT_INVALID', `planFinishing needs a ${what} object`);
  positiveInt(`${what}.width`, o.width); positiveInt(`${what}.height`, o.height);
  return o;
};

const methodTag = (step, params) =>
  step.id === 'lanczos-scale' ? (params.mode || 'lanczos') : step.id === 'realesrgan-upscale' ? 'realesrgan-x4' : step.id;

/**
 * How the delivered resolution was reached, always ending in the TRUE source
 * size: "lanczos-from-768x512", "realesrgan-x4+lanczos-from-768x512", or
 * "native-768x512" when nothing touched the frame. A bare "4K" is exactly the
 * claim this string exists to make impossible.
 */
function deliveryMethodFor(resolutionSteps, nativeWidth, nativeHeight) {
  const from = `${nativeWidth}x${nativeHeight}`;
  return resolutionSteps.length ? `${resolutionSteps.join('+')}-from-${from}` : `native-${from}`;
}

function compose(source, target, selection) {
  const sourceSeconds = Number(source.durationSeconds);
  let cur = { width: source.width, height: source.height, fps: Number(source.fps) };
  const steps = [], notes = [], resolutionTags = [];
  let effectiveTarget = { width: target.width, height: target.height, fps: Number(target.fps) || cur.fps };

  for (const catalogue of FINISHING_STEPS) {
    if (!selection.has(catalogue.id)) continue;
    const from = { ...cur };
    let params = {}, to = { ...cur };

    if (catalogue.id === 'rife-interpolate') {
      params = { targetFps: effectiveTarget.fps, model: 'rife-v4.6' };
      to = { ...cur, fps: effectiveTarget.fps };
    } else if (catalogue.id === 'realesrgan-upscale') {
      params = { model: 'realesrgan-x4plus', factor: 4 };
      to = { ...cur, width: cur.width * 4, height: cur.height * 4 };
      resolutionTags.push(methodTag(catalogue, params));
    } else if (catalogue.id === 'lanczos-scale') {
      // Cap the delivery frame at what lanczos may legally reach from here,
      // preserving the requested frame's aspect. Better a named smaller
      // delivery than a 4K file whose pixels are a 4.2x resample.
      const factor = scaleFactor({ fromWidth: cur.width, fromHeight: cur.height, toWidth: effectiveTarget.width, toHeight: effectiveTarget.height });
      if (factor > MAX_UPSCALE_FACTOR) {
        const k = factor / MAX_UPSCALE_FACTOR;
        const capped = { width: even(effectiveTarget.width / k), height: even(effectiveTarget.height / k) };
        notes.push({
          code: 'TARGET_RESOLUTION_UNREACHABLE',
          message: `${effectiveTarget.width}x${effectiveTarget.height} is a ${round(factor)}x upscale from ${cur.width}x${cur.height}, past the ${MAX_UPSCALE_FACTOR}x lanczos cap. ` +
            `Planned ${capped.width}x${capped.height} instead; add realesrgan-upscale to reach the requested frame.`,
        });
        effectiveTarget = { ...effectiveTarget, ...capped };
      }
      if (cur.width === effectiveTarget.width && cur.height === effectiveTarget.height) continue;
      params = { toWidth: effectiveTarget.width, toHeight: effectiveTarget.height, mode: 'lanczos' };
      params.filter = buildScaleFilter({ fromWidth: cur.width, fromHeight: cur.height, toWidth: params.toWidth, toHeight: params.toHeight, mode: params.mode });
      to = { ...cur, width: effectiveTarget.width, height: effectiveTarget.height };
      resolutionTags.push(methodTag(catalogue, params));
    } else if (catalogue.id === 'grade') {
      params = { ...GRADE_DEFAULTS };
    } else {
      params = { ...DELIVERY, faststart: true, fps: effectiveTarget.fps || null };
    }

    const projectedSeconds = round(catalogue.costModel.seconds({
      sourceSeconds, fps: from.fps, width: from.width, height: from.height,
      outWidth: to.width, outHeight: to.height, outFps: to.fps,
    }), 1);
    steps.push({
      id: catalogue.id, label: catalogue.label, tool: catalogue.tool, provenanceLabel: catalogue.provenanceLabel,
      params, from, to, projectedSeconds, basis: catalogue.costModel.basis,
    });
    cur = to;
  }

  const projectedSeconds = round(steps.reduce((s, x) => s + x.projectedSeconds, 0), 1);
  return { steps, notes, projectedSeconds, effectiveTarget, delivered: cur, deliveryMethod: deliveryMethodFor(resolutionTags, source.width, source.height) };
}

/**
 * Choose the finishing chain that fits the budget, and say what did not fit.
 *
 * Everything the budget forces out lands in `dropped` with a code and the cost
 * that excluded it: a plan that silently omits the upscale is a plan that lies
 * about why the output is small.
 */
export function planFinishing({ source, target, availableTools = ['ffmpeg'], budgetSeconds = Infinity } = {}) {
  readClip(source, 'source'); readClip(target, 'target');
  if (!(Number(source.durationSeconds) > 0)) throw fail('PLAN_INPUT_INVALID', 'source.durationSeconds must be a positive number; cost cannot be projected without it');
  if (!(Number(source.fps) > 0)) throw fail('PLAN_INPUT_INVALID', 'source.fps must be a positive number');
  if (budgetSeconds !== Infinity && !(Number.isFinite(budgetSeconds) && budgetSeconds >= 0)) throw fail('PLAN_INPUT_INVALID', 'budgetSeconds must be a non-negative number or Infinity');
  const tools = new Set(availableTools);
  if (!tools.has('ffmpeg')) throw fail('TOOL_UNAVAILABLE', 'ffmpeg is required for every finishing plan');

  const selection = new Set(FINISHING_STEPS.map(s => s.id));
  const dropped = [];
  const drop = (id, code, reason) => { if (selection.delete(id)) dropped.push({ id, code, reason }); };

  const needsFps = Number(target.fps) > 0 && Number(target.fps) > Number(source.fps);
  if (!needsFps) drop('rife-interpolate', 'NOT_REQUIRED', `Target fps ${target.fps ?? '(unset)'} does not exceed the source ${source.fps} fps`);
  else if (!tools.has('rife-ncnn-vulkan')) drop('rife-interpolate', 'TOOL_UNAVAILABLE', `rife-ncnn-vulkan was not offered in availableTools (expected at ${TOOL_PATHS['rife-ncnn-vulkan']})`);
  else if (source.width * source.height > 1920 * 1080) drop('rife-interpolate', 'INTERPOLATION_RESOLUTION_UNQUALIFIED', 'runtime/frame-interpolation.mjs refuses sources above 1920x1080; interpolate before upscaling');

  const wanted = scaleFactor({ fromWidth: source.width, fromHeight: source.height, toWidth: target.width, toHeight: target.height });
  if (wanted <= 1) drop('realesrgan-upscale', 'NOT_REQUIRED', `Delivery frame is not larger than the ${source.width}x${source.height} source (${round(wanted)}x)`);
  else if (!tools.has('realesrgan-ncnn-vulkan')) drop('realesrgan-upscale', 'TOOL_UNAVAILABLE', `realesrgan-ncnn-vulkan was not offered in availableTools (expected at ${TOOL_PATHS['realesrgan-ncnn-vulkan']})`);

  // Trim to budget: most expensive optional step first, recomposing each time
  // because dropping the upscale changes what the resize and encode then cost.
  let plan = compose(source, target, selection);
  while (plan.projectedSeconds > budgetSeconds) {
    const candidates = plan.steps.filter(s => OPTIONAL.has(s.id)).sort((a, b) => b.projectedSeconds - a.projectedSeconds);
    if (!candidates.length) break;
    const victim = candidates[0];
    selection.delete(victim.id);
    dropped.push({
      id: victim.id, code: 'OVER_BUDGET', projectedSeconds: victim.projectedSeconds,
      reason: `Projected ${victim.projectedSeconds} s would not fit the ${budgetSeconds} s budget (chain projected ${plan.projectedSeconds} s)`,
    });
    plan = compose(source, target, selection);
  }

  const withinBudget = plan.projectedSeconds <= budgetSeconds;
  const notes = [...plan.notes];
  // A 60 fps delivery spec with no interpolation step is reached by FFmpeg's
  // -r, which DUPLICATES frames. MEASURED through this exact path on
  // 2026-09-08: a 97-frame 25 fps shot came out 233 frames at 60 fps with no
  // new imagery in it. Naming it here is the plan-side half of the receipt's
  // fpsMethod; without this note the chain quietly promises smooth motion.
  if (Number(target.fps) > 0 && Number(target.fps) > Number(source.fps) && !plan.steps.some(s => s.id === 'rife-interpolate')) {
    notes.push({
      code: 'FPS_TARGET_WITHOUT_INTERPOLATION',
      message: `encode-delivery will reach ${target.fps} fps from ${source.fps} fps by duplicating frames, not by generating in-between ones. ` +
        'Add rife-interpolate (runtime/frame-interpolation.mjs) for real in-betweens, or deliver at the source frame rate.',
    });
  }
  if (!withinBudget) {
    notes.push({
      code: 'BUDGET_EXCEEDED',
      message: `The required steps alone project ${plan.projectedSeconds} s against a ${budgetSeconds} s budget. Nothing further can be dropped without failing to deliver.`,
    });
  }

  return {
    schemaVersion: 1,
    kind: 'vyrealm.finishing.plan',
    source: { width: source.width, height: source.height, fps: Number(source.fps), durationSeconds: Number(source.durationSeconds) },
    target: { width: target.width, height: target.height, fps: Number(target.fps) || null },
    effectiveTarget: plan.effectiveTarget,
    projectedDelivery: plan.delivered,
    steps: plan.steps,
    dropped,
    projectedSeconds: plan.projectedSeconds,
    projectedSecondsUnderContention: round(plan.projectedSeconds * CONTENTION_MULTIPLIER, 1),
    budgetSeconds,
    withinBudget,
    // Projected, not measured. finish() replaces this with the same string
    // rebuilt from what ffprobe actually reports.
    deliveryMethod: plan.deliveryMethod,
    nativeResolution: { width: source.width, height: source.height },
    notes,
    caveat: 'Projections extrapolate from single measured runs (see each step basis). Contention figures apply the measured 11 s / 220 s composite spread.',
  };
}

// --------------------------------------------------------------------------
// execution
// --------------------------------------------------------------------------

async function probeClip(path, ffprobe) {
  const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames,duration:format=duration', '-of', 'json', path];
  let stdout;
  try { ({ stdout } = await exec(ffprobe, args, { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) { throw fail('PROBE_FAILED', `ffprobe could not read ${path}: ${String(error.stderr || error.message).slice(-500)}`, { path }); }
  let probe;
  try { probe = JSON.parse(stdout); } catch { throw fail('PROBE_FAILED', `ffprobe emitted unparseable output for ${path}`, { path }); }
  const v = probe.streams?.[0];
  if (!v?.width) throw fail('PROBE_FAILED', `${path} has no readable video stream`, { path });
  const [n, d] = String(v.avg_frame_rate || '0/1').split('/').map(Number);
  const durationSeconds = Number(v.duration) || Number(probe.format?.duration) || 0;
  let frames = Number(v.nb_frames);
  if (!Number.isFinite(frames) || frames <= 0) {
    // Only decode when the container did not carry the count. On these clips
    // that costs seconds, and a guessed frame count is not a measurement.
    const counted = await exec(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path], { windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024 });
    frames = Number(String(counted.stdout).trim());
  }
  return { width: v.width, height: v.height, fps: d ? round(n / d, 4) : 0, durationSeconds: round(durationSeconds, 4), frames: Number.isFinite(frames) ? frames : null };
}

function ffmpegArgs(step, params, input, output, measured) {
  const common = ['-v', 'error', '-y', '-i', input];
  if (step.id === 'lanczos-scale') {
    // Rebuilt from the MEASURED input every time, never taken from params: a
    // filter string a plan built against different source dimensions would
    // carry that plan's 4x cap check, not this file's, and a stale one really
    // does resample 768x512 to 3840x2160 (verified before this line existed).
    const filter = buildScaleFilter({ fromWidth: measured.width, fromHeight: measured.height, toWidth: params.toWidth, toHeight: params.toHeight, mode: params.mode || 'lanczos' });
    return [...common, '-vf', filter, '-c:v', 'libx264', '-preset', params.preset || DELIVERY.preset, '-crf', String(params.crf ?? INTERMEDIATE_CRF), '-pix_fmt', 'yuv420p', '-c:a', 'copy', output];
  }
  if (step.id === 'grade') {
    const eq = `eq=contrast=${params.contrast ?? GRADE_DEFAULTS.contrast}:brightness=${params.brightness ?? 0}:saturation=${params.saturation ?? GRADE_DEFAULTS.saturation}:gamma=${params.gamma ?? GRADE_DEFAULTS.gamma}`;
    return [...common, '-vf', params.denoise === false ? eq : `${eq},hqdn3d=1.5:1.5:6:6`, '-c:v', 'libx264', '-preset', params.preset || DELIVERY.preset, '-crf', String(params.crf ?? INTERMEDIATE_CRF), '-pix_fmt', 'yuv420p', '-c:a', 'copy', output];
  }
  if (step.id === 'encode-delivery') {
    const fps = Number(params.fps) > 0 ? Number(params.fps) : measured.fps;
    const args = [...common, '-c:v', params.codec || DELIVERY.codec, '-preset', params.preset || DELIVERY.preset, '-crf', String(params.crf ?? DELIVERY.crf),
      '-profile:v', params.profile || DELIVERY.profile, '-pix_fmt', params.pixelFormat || DELIVERY.pixelFormat,
      '-g', String(Math.max(1, Math.round((fps || measured.fps || 24) * (params.gopSeconds ?? DELIVERY.gopSeconds))))];
    if (Number(params.fps) > 0) args.push('-r', String(params.fps));
    if (params.maxrate) args.push('-maxrate', String(params.maxrate), '-bufsize', String(params.bufsize || params.maxrate));
    args.push('-c:a', params.audioCodec || DELIVERY.audioCodec, '-b:a', params.audioBitrate || DELIVERY.audioBitrate);
    if (params.faststart !== false) args.push('-movflags', '+faststart');
    return [...args, output];
  }
  throw fail('FINISHING_STEP_NOT_FFMPEG', `Step "${step.id}" is not an FFmpeg step`, { stepId: step.id });
}

/**
 * Run the FFmpeg half of a finishing chain and measure what came out.
 *
 * Neural steps (RIFE, Real-ESRGAN) are planned and priced here but NOT executed
 * here: RIFE already has an audited executor in runtime/frame-interpolation.mjs
 * with hash-pinned runtime verification, disk-space checks and a synthesized-
 * frame assertion, and a second half-implementation would be a worse one that
 * still writes a receipt. Passing such a step throws
 * NEURAL_STEP_NOT_EXECUTED_HERE rather than skipping it, because a skipped
 * upscale that still produced a receipt is exactly the lie this module exists
 * to prevent.
 * ponytail: FFmpeg-only executor. Run the neural steps through their own
 * modules and feed the result back in as `source` when a chain needs both.
 *
 * Every resolution, duration and fps in the receipt is read back from ffprobe
 * after the fact. Nothing is copied from the plan.
 */
export async function finish({ source, output, steps, workDir, origin = null, ffmpeg = DEFAULT_FFMPEG, ffprobe = DEFAULT_FFPROBE, onProgress = () => {} } = {}) {
  if (!source || typeof source !== 'string') throw fail('FINISH_INPUT_INVALID', 'finish needs a source path');
  if (!output || typeof output !== 'string') throw fail('FINISH_INPUT_INVALID', 'finish needs an output path');
  // NTFS is case-insensitive, so a lowercase drive letter is the same file and
  // ffmpeg -y would eat the input.
  const samePath = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
  if (samePath(source, output)) throw fail('FINISH_INPUT_INVALID', 'source and output must be different files');
  if (origin) {
    positiveInt('origin.width', origin.width); positiveInt('origin.height', origin.height);
  }
  if (!Array.isArray(steps) || !steps.length) throw fail('FINISH_INPUT_INVALID', 'finish needs at least one step');
  if (!workDir) throw fail('FINISH_INPUT_INVALID', 'finish needs a workDir for intermediates');
  await stat(source).catch(() => { throw fail('FINISH_SOURCE_MISSING', `Source clip not found: ${source}`, { source }); });

  const resolved = steps.map(s => {
    const catalogue = finishingStep(typeof s === 'string' ? s : s.id);
    if (catalogue.tool !== 'ffmpeg') {
      throw fail('NEURAL_STEP_NOT_EXECUTED_HERE',
        `Step "${catalogue.id}" runs ${catalogue.tool}, which finish() does not execute. ` +
        (catalogue.id === 'rife-interpolate'
          ? 'Use interpolateVideo() in runtime/frame-interpolation.mjs and pass its output back in as the source.'
          : `Run ${TOOL_PATHS[catalogue.tool]} separately and pass its output back in as the source.`),
        { stepId: catalogue.id, tool: catalogue.tool });
    }
    return { catalogue, params: (typeof s === 'string' ? {} : s.params) || {} };
  });

  await mkdir(workDir, { recursive: true });
  await mkdir(dirname(resolve(output)), { recursive: true });
  const sourceMeasured = await probeClip(source, ffprobe);

  let input = source, measured = sourceMeasured;
  const executed = [], resolutionTags = [];
  const started = Date.now();

  for (let i = 0; i < resolved.length; i++) {
    const { catalogue, params } = resolved[i];
    const last = i === resolved.length - 1;
    const destination = last ? resolve(output) : join(workDir, `step-${i}-${catalogue.id}.mp4`);
    onProgress({ stage: catalogue.label, stepId: catalogue.id, index: i, total: resolved.length, elapsedSeconds: round((Date.now() - started) / 1000, 1) });
    const args = ffmpegArgs(catalogue, params, input, destination, measured);
    const at = process.hrtime.bigint();
    try { await exec(ffmpeg, args, { windowsHide: true, timeout: 3600000, maxBuffer: 8 * 1024 * 1024 }); }
    catch (error) { throw fail('FFMPEG_FAILED', `${catalogue.id} failed: ${String(error.stderr || error.message).slice(-1500)}`, { stepId: catalogue.id, args }); }
    const seconds = round(Number(process.hrtime.bigint() - at) / 1e9, 3);
    const before = measured;
    measured = await probeClip(destination, ffprobe);
    if (measured.width !== before.width || measured.height !== before.height) resolutionTags.push(methodTag(catalogue, params));
    executed.push({
      id: catalogue.id, label: catalogue.label, tool: catalogue.tool, provenanceLabel: catalogue.provenanceLabel, params, seconds,
      from: { width: before.width, height: before.height, fps: before.fps },
      to: { width: measured.width, height: measured.height, fps: measured.fps },
      outputPath: destination,
    });
    input = destination;
  }

  const outputMeasured = measured;
  const durationDrift = Math.abs(outputMeasured.durationSeconds - sourceMeasured.durationSeconds);
  if (durationDrift > 0.5) {
    throw fail('FINISH_OUTPUT_VERIFICATION_FAILED',
      `Output duration ${outputMeasured.durationSeconds} s drifted ${round(durationDrift)} s from the ${sourceMeasured.durationSeconds} s source`,
      { sourceMeasured, outputMeasured });
  }
  const factor = round(Math.min(outputMeasured.width / sourceMeasured.width, outputMeasured.height / sourceMeasured.height), 4);

  return {
    schemaVersion: 1,
    kind: 'vyrealm.finishing.receipt',
    generatedAt: new Date().toISOString(),
    // MEASURED by ffprobe before the first step and after the last. The plan's
    // intentions do not appear in this object.
    source: { path: resolve(source), ...sourceMeasured },
    output: { path: resolve(output), ...outputMeasured },
    nativeResolution: { width: sourceMeasured.width, height: sourceMeasured.height },
    deliveryResolution: { width: outputMeasured.width, height: outputMeasured.height },
    deliveryMethod: deliveryMethodFor(resolutionTags, sourceMeasured.width, sourceMeasured.height),
    fpsMethod: outputMeasured.fps === sourceMeasured.fps ? `native-${sourceMeasured.fps}fps`
      : executed.some(s => s.provenanceLabel === 'interpolated') ? `interpolated-${outputMeasured.fps}fps-from-${sourceMeasured.fps}fps`
        : `resampled-${outputMeasured.fps}fps-from-${sourceMeasured.fps}fps`,
    upscaled: outputMeasured.width > sourceMeasured.width || outputMeasured.height > sourceMeasured.height,
    upscaleFactor: factor,
    interpolated: executed.some(s => s.provenanceLabel === 'interpolated'),
    steps: executed,
    totalSeconds: round(executed.reduce((s, x) => s + x.seconds, 0), 3),
    tool: { ffmpeg, ffprobe },
    caveat: 'Resampling is not generation. The delivered frame is a resize of ' +
      `${sourceMeasured.width}x${sourceMeasured.height}; no detail below that scale was ever generated.`,
  };
}

// --------------------------------------------------------------------------
// evidence
// --------------------------------------------------------------------------

/**
 * The shippable artifact. Its whole job is that `nativeResolution` and
 * `generationStatus` travel with the file: a 1080p delivery finished from a
 * 768x512 generation reads "upscaled" and carries 768x512, forever.
 *
 * When a clip was both interpolated and upscaled, the status reports
 * "upscaled": resolution is the claim people misread, so it wins the single
 * status field, and `interpolated` is carried alongside as its own boolean
 * rather than being lost.
 */
export function finishingEvidence(receipt) {
  if (!receipt?.source?.width || !receipt?.output?.width) throw fail('EVIDENCE_INPUT_INVALID', 'finishingEvidence needs a finish() receipt with measured source and output');
  if (!Array.isArray(receipt.steps)) throw fail('EVIDENCE_INPUT_INVALID', 'finishingEvidence needs the receipt steps');
  if (!receipt.deliveryMethod) throw fail('EVIDENCE_INPUT_INVALID', 'finishingEvidence needs a deliveryMethod naming how the delivered resolution was reached');

  const native = { width: receipt.source.width, height: receipt.source.height };
  const delivery = receipt.deliveryResolution || { width: receipt.output.width, height: receipt.output.height };
  // Measured, not declared: a step catalogue label cannot make a clip upscaled,
  // and cannot stop it being upscaled either.
  const upscaled = delivery.width > native.width || delivery.height > native.height;
  const interpolated = Boolean(receipt.interpolated) || receipt.steps.some(s => s.provenanceLabel === 'interpolated');

  return {
    schemaVersion: 1,
    kind: 'vyrealm.finishing.evidence',
    generatedAt: new Date().toISOString(),
    generationStatus: upscaled ? 'upscaled' : interpolated ? 'interpolated' : 'generated',
    nativeResolution: { ...native, label: `${native.width}x${native.height}` },
    deliveryResolution: { ...delivery, label: `${delivery.width}x${delivery.height}` },
    deliveryMethod: receipt.deliveryMethod,
    nativeFps: receipt.source.fps ?? null,
    deliveryFps: receipt.output.fps ?? null,
    fpsMethod: receipt.fpsMethod || null,
    upscaled,
    upscaleFactor: receipt.upscaleFactor ?? round(Math.min(delivery.width / native.width, delivery.height / native.height), 4),
    interpolated,
    durationSeconds: receipt.output.durationSeconds ?? null,
    frames: receipt.output.frames ?? null,
    steps: receipt.steps.map(s => ({ id: s.id, tool: s.tool, provenanceLabel: s.provenanceLabel, seconds: s.seconds ?? null })),
    totalSeconds: receipt.totalSeconds ?? null,
    caveat: upscaled
      ? `Upscaled delivery. The model generated ${native.width}x${native.height}; ${delivery.width}x${delivery.height} was reached by ${receipt.deliveryMethod}. No detail finer than the native frame was generated, and this file must never be described as native ${delivery.height}p.`
      : interpolated
        ? `Interpolated delivery at native ${native.width}x${native.height}. In-between frames are synthesized, not generated by the video model.`
        : `Native delivery at ${native.width}x${native.height}. No resampling or interpolation was applied.`,
  };
}
