// Named failure-mode verdicts over the cheap pixel probe in scripts/qc/probe_metrics.py.
//
// The probe measures. This module decides, and shows its working: every verdict
// carries the metric path it read, the value it read, and the two threshold
// numbers that produced the call. A bare score with no provenance is a taste
// claim wearing a number's clothes, and thresholds here are calibrated on two
// clips, so they must never be mistaken for settled.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PROBE_SCRIPT = resolve(HERE, '..', 'scripts', 'qc', 'probe_metrics.py');
export const DEFAULT_PYTHON = process.env.VYREALM_PYTHON
  || 'D:\\VYREALM-runtime\\bootstrap-qualification\\full-install\\VYREALM-local-video-v1\\venv\\Scripts\\python.exe';

// Local research these entries are drawn from; used as sourceUrl for findings
// that exist nowhere else, so nobody mistakes a local measurement for literature.
const TAXONOMY_DOC = 'docs/research/AI_VIDEO_FAILURE_TAXONOMY.md';
const METRICS_DOC = 'docs/research/VIDEO_QUALITY_METRICS.md';

const mode = (id, o) => [id, Object.freeze({ id, ...o })];

/**
 * The catalogue. `detectable` means detectable from decoded pixels on this box
 * with no neural net; a mode can be undetectable and still be worth naming,
 * because prevention at prompt-compile time is the cheapest repair there is.
 */
export const FAILURE_MODES = Object.freeze(Object.fromEntries([
  mode('temporal_flicker', {
    label: 'Temporal flicker',
    description: 'Whole-frame luminance and colour jitter between consecutive frames with no corresponding motion. VBench computes this as mean(absdiff(f, f+1)) wrapped as (255-x)/255; we reproduce it exactly. Read jointly with dynamic degree: a dead clip scores well on flicker precisely because nothing moves.',
    detectable: true,
    preventable: false,
    repairable: true,
    repairStrategy: 'ffmpeg deflicker post-pass; re-roll only when severe, since detection reliability here justifies the 26-minute cost.',
    sourceUrl: 'https://arxiv.org/abs/2311.17982',
  }),
  mode('motion_stall', {
    label: 'Motion stall / duplicated frames',
    description: 'A run of consecutive frame pairs whose difference is below the near-duplicate threshold: the sampler stopped producing new content. The Wan vendor negative prompt spends three of its twenty-eight slots on static output, which is the model authors naming their own most common failure.',
    detectable: true,
    preventable: true,
    repairable: false,
    repairStrategy: 'Re-roll. This is one of only two conditions that justify a 26-minute regeneration; trimming leaves a visibly frozen clip.',
    sourceUrl: 'https://arxiv.org/abs/2503.20314',
  }),
  mode('dead_footage', {
    label: 'Dead footage (motion below spec)',
    description: 'Top-5% optical flow so low the shot is static in all but name. VBench calls a clip dynamic when enough pairs exceed 6.0 at 256px min-dimension. Polarity is intent-dependent: a deliberate locked-off shot is not a defect, so this must be gated against the shot spec, not applied blind.',
    detectable: true,
    preventable: true,
    repairable: false,
    repairStrategy: 'Re-roll with ambient environmental motion (rain, smoke, foliage) added to the prompt, which satisfies the anti-static terms at zero anatomy risk.',
    sourceUrl: 'https://arxiv.org/abs/2311.17982',
  }),
  mode('detail_collapse', {
    label: 'Single-frame detail collapse',
    description: 'Laplacian variance falls off a step in one frame while the frame difference stays unremarkable. Measured on VYREALM_RAINLINE_TRAILER_1080P.mp4: frame 34 to 35 loses 4.03x its detail at an rgbMae of 4.58, a larger detail event than the hard cut between two unrelated shots, and invisible to every frame-difference metric including VBench flicker. Discriminator: a large drop with a HIGH co-indexed frame difference is a cut or a camera move, not a model failure.',
    detectable: true,
    preventable: false,
    repairable: true,
    repairStrategy: 'Trim to the stable prefix, which is nearly free, before considering a re-roll.',
    sourceUrl: METRICS_DOC,
  }),
  mode('terminal_detail_decay', {
    label: 'Terminal detail decay (A7)',
    description: 'Native-resolution Laplacian variance decays monotonically over roughly the last 15 frames of every Wan2.2 shot measured, ending at 50.4% of the shot median on VYREALM_ANIME_HERO_5S.mp4 (last/first ratios 0.507, 0.494, 0.213 across the three trailer shots). H.264 rate control, luminance and motion blur were each ruled out by measurement; the decay is scale-dependent and vanishes on downscale, localising it to the finest spatial band. Root cause (VAE decode tail vs latent drift) remains UNVERIFIED.',
    detectable: true,
    preventable: false,
    repairable: true,
    repairStrategy: 'Trim or crossfade the last ~12 frames of every shot. Costs seconds against a 26-minute re-roll and is correct regardless of which root cause holds.',
    sourceUrl: TAXONOMY_DOC,
  }),
  mode('morphing_geometry', {
    label: 'Non-rigid morphing',
    description: 'Frames share texture but no single homography explains them: ORB matches survive Lowe ratio but fail RANSAC. High match ratio with low inlier ratio is the signature diffusion failure, and it is invisible to frame differencing. Rainline shot 2 measured 0.809 inliers against 0.951 for shots 1 and 3.',
    detectable: true,
    preventable: true,
    repairable: false,
    repairStrategy: 'Shorten the shot. Drift is superlinear in frame count, so two 61-frame shots cost the same compute as one 121-frame shot and are materially more stable.',
    sourceUrl: METRICS_DOC,
  }),
  mode('scene_drift', {
    label: 'Scene / subject drift from frame one',
    description: 'Colour-histogram correlation against the first frame decaying over the clip: the shot walks away from what it started as. A histogram proxy, not identity: real identity consistency needs ArcFace or DINO, and VBench-2.0 measures the best hosted models at 69.51-78.57% on it, so this failure is universal rather than local.',
    detectable: true,
    preventable: true,
    repairable: false,
    repairStrategy: 'Shorten the shot, or trim to the stable prefix. Prevention beats repair here.',
    sourceUrl: 'https://arxiv.org/abs/2503.21755',
  }),
  mode('motion_roughness', {
    label: 'Motion roughness',
    description: 'VBench motion smoothness drops every other frame, rebuilds it with the AMT interpolation network and scores (255-MAE)/255. We keep the wrapper and swap AMT for a linear blend, so the residual is half the discrete second time-derivative of the pixel. A proxy, named as one.',
    detectable: true,
    preventable: false,
    repairable: true,
    repairStrategy: 'Frame interpolation pass; otherwise re-roll. Named alongside subject consistency as one of the two leading indicators of quantisation damage.',
    sourceUrl: 'https://arxiv.org/abs/2311.17982',
  }),
  mode('colour_oversaturation', {
    label: 'Colour oversaturation',
    description: 'Fraction of pixels at chroma clip (HSV S >= 250). Imagen attributes this to high classifier-free-guidance weight producing highly saturated and unnatural images. Already present in our output: 15.575% of pixels at S >= 250 on VYREALM_ANIME_HERO_5S.mp4, with mean HSV saturation climbing +13.53 over five seconds. The taxonomy also quotes 13.645% for the same clip; that is the STRICTER S == 255 fraction and is not what this metric reads. Cheapest detector and cheapest repair in the whole taxonomy.',
    detectable: true,
    preventable: true,
    repairable: true,
    repairStrategy: 'Per-shot colour normalisation to a common target in ffmpeg; prevent by finding the CFG oversaturation knee with a sweep.',
    sourceUrl: 'https://arxiv.org/abs/2205.11487',
  }),
  mode('colour_drift', {
    label: 'Per-channel colour drift',
    description: 'Channel means sliding apart over the clip. The anime shot drains red at -3.02 levels/sec against -0.07 on blue, a channel-spread drift of 2.95 against rainline\'s 0.186. Quantified defect, invisible to thumbnail inspection.',
    detectable: true,
    preventable: false,
    repairable: true,
    repairStrategy: 'Per-shot colour normalisation, plus colour and exposure match across known cut boundaries taken from the edit list.',
    sourceUrl: METRICS_DOC,
  }),
  mode('stepped_cadence', {
    label: 'Stepped motion (animating on twos)',
    description: 'Period-2 structure in the frame-difference series: strong negative lag-1 and positive lag-2 autocorrelation with a large even/odd split. Measured reliable (anime lag1 -0.813 / lag2 +0.875 / alternation 2.63; rainline lag1 +0.815 / alternation 1.11) but POLARITY IS INTENT-DEPENDENT: hand-drawn anime is conventionally animated on twos, and the same signature in live-action is a defect. Gate this against shot intent or not at all.',
    detectable: true,
    preventable: false,
    repairable: true,
    repairStrategy: 'Frame interpolation if the intent was smooth motion; leave alone if the intent was anime.',
    sourceUrl: METRICS_DOC,
  }),
  mode('encode_blocking', {
    label: 'Encode blocking',
    description: 'Gradient energy on the 8x8 transform grid against gradient energy off it. Measures the ENCODER, not the generator, so it is only meaningful while quality is scored on the mp4; once raw PNG frames are retained through QC this metric should read flat. Single-clip separation, no replication: telemetry, not a gate.',
    detectable: true,
    preventable: true,
    repairable: true,
    repairStrategy: 'Re-encode from retained raw frames at a higher bitrate. Encode artifacts are only repairable from source, which is the argument for keeping PNGs until QC passes.',
    sourceUrl: METRICS_DOC,
  }),
  // --- documented but not gated by pixel metrics ---
  mode('vae_chunk_seam', {
    label: 'VAE chunk seam',
    description: 'Wan\'s VAE encodes and decodes at most 4 frames per chunk, and a wrong cache order or chunking produces temporal seams every 4 frames. A stride-4 periodicity test on the de-medianed frame-difference series would be a high-precision detector; the probe does not emit one yet, so this is catalogued and ungated.',
    detectable: false,
    preventable: false,
    repairable: false,
    repairStrategy: 'None implemented. Add a stride-4 periodicity term to the probe before claiming detection.',
    sourceUrl: 'https://arxiv.org/abs/2503.20314',
  }),
  mode('face_at_distance', {
    label: 'Face below latent resolution',
    description: 'Wan2.2-TI2V-5B compresses 16x16 spatially, and patchify brings the total to about 32x. At 1024x576 a 32-pixel-wide face is ONE latent token wide and cannot be represented at all. A hard geometric precondition, not a taste judgment, and checkable from the shot spec before spending 1568 seconds.',
    detectable: false,
    preventable: true,
    repairable: false,
    repairStrategy: 'Pre-flight shot-spec validator: reject any composition implying a face narrower than 32 pixels. Prevention only.',
    sourceUrl: 'https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B',
  }),
  mode('garbled_text', {
    label: 'Garbled on-screen text',
    description: 'Generated signage, screens, books and shopfronts come out as illegible glyph soup. ByteDance names text rendering as a remaining weakness of its own model. Detecting it needs OCR we do not have installed, and the correct move is refusal at prompt-compile time rather than detection after the fact.',
    detectable: false,
    preventable: true,
    repairable: true,
    repairStrategy: 'Refuse the prompt construction; composite all in-piece text in post, never generate it.',
    sourceUrl: TAXONOMY_DOC,
  }),
  mode('off_bucket_resolution', {
    label: 'Off-bucket resolution',
    description: 'We generate at 1024x576 while the model card names 1280x704 as the 720P bucket, so we run at 65.5% of native latent capacity (576 tokens against 880) before Q4 touches anything. Off-bucket generation is out of distribution under aspect-ratio bucketing practice. Whether Wan2.2 actually degrades at 1024x576 is UNVERIFIED and is a cheap same-seed A/B.',
    detectable: false,
    preventable: true,
    repairable: false,
    repairStrategy: 'Pre-flight validator: warn on any resolution that is not 1280x704 or 704x1280. Milliseconds, saves a 1568-second run.',
    sourceUrl: 'https://arxiv.org/abs/2410.13720',
  }),
]));

/**
 * Provisional thresholds. Every entry carries where it was calibrated and how
 * much to trust it, because a caller reading `fail: 2.5` with no context will
 * treat it as a law rather than as two clips' worth of evidence. VBench's own
 * cut points are leaderboard-relative and FETV measured automatic metrics
 * correlating poorly with human judgment, so these gate obvious defects only.
 *
 * `warn` and `fail` are on the metric's own scale. Whichever of the two is
 * larger tells you the direction: no separate polarity field can drift out of
 * sync with the numbers.
 */
const threshold = (metric, warn, failAt, calibratedOn, confidence, note) =>
  Object.freeze({ metric, warn, fail: failAt, calibratedOn, confidence, note });

export const DEFAULT_THRESHOLDS = Object.freeze({
  temporal_flicker: threshold('temporalFlicker.vbenchFlickerScore', 0.97, 0.93,
    'VYREALM_ANIME_HERO_5S.mp4 0.9803 (accepted); VYREALM_RAINLINE_TRAILER_1080P.mp4 shot 2 0.9030 (bad on every axis), shots 1/3 0.9814/0.9771',
    'medium', 'Confounded with motion: apply only when flowTop5Pct mean is below about 5, else morphing_geometry carries the signal.'),
  motion_stall: threshold('stall.longestStallRun', 2, 4,
    'Both sample clips measured 0 exact and 0 near-duplicate pairs, longest run 0; thresholds set from the failure definition, not from an observed positive',
    'low', 'No positive example in our corpus yet. Detection reliability is near-perfect by construction; the CUT POINT is the guess.'),
  dead_footage: threshold('dynamicDegree.flowTop5Pct.mean', 2.0, 0.8,
    'VYREALM_ANIME_HERO_5S.mp4 3.188 (VBench calls it static: 24 moving pairs against 30 required); rainline shots 3.61 / 17.03 / 2.41',
    'low', 'Intent-dependent. Only meaningful when the shot spec asked for motion; a locked-off shot must not be scored against this.'),
  detail_collapse: threshold('sharpness.maxSingleFrameDropRatio', 1.6, 2.5,
    'VYREALM_ANIME_HERO_5S.mp4 1.235 (clean); VYREALM_RAINLINE_TRAILER_1080P.mp4 4.026 at frame 35, the global maximum across all 360 frames and a genuine generative collapse',
    'high', 'Highest-confidence threshold measured. Refine with the co-indexed frame difference: a big drop with rgbMae above the shot median is a cut or camera move, not a model failure.'),
  terminal_detail_decay: threshold('sharpness.minOverMedian', 0.75, 0.55,
    'VYREALM_ANIME_HERO_5S.mp4 0.504 (696.8 / 1382.3); the same tail ramp appears in all four Wan2.2 shots measured',
    'medium', 'Expected to fire on every current Wan2.2 shot. That is the finding, not a miscalibration: the repair is a free tail trim.'),
  morphing_geometry: threshold('stability.orbHomographyInlierRatio.mean', 0.92, 0.85,
    'VYREALM_ANIME_HERO_5S.mp4 0.954 (min 0.808); rainline shots 0.951 / 0.809 / 0.951, with 0.809 the shot every other metric also condemns',
    'medium', 'Unanimous with five other metrics on which rainline shot is broken, which is why it survives despite single-clip calibration.'),
  scene_drift: threshold('stability.histCorrFirstFrame.min', 0.75, 0.55,
    'VYREALM_ANIME_HERO_5S.mp4 min 0.8132, mean 0.8939',
    'low', 'Histogram proxy for a dimension that properly needs an embedding model. torch does not load on this box (WinError 1455), so the real detector is unavailable, not merely expensive.'),
  motion_roughness: threshold('motionSmoothness.blendSmoothnessProxy', 0.96, 0.92,
    'VYREALM_ANIME_HERO_5S.mp4 0.98215 (blend reconstruction MAE mean 4.55, max 7.04)',
    'low', 'Linear-blend stand-in for AMT. Ranks synthetic flicker below a synthetic pan in the probe self-check, which is the only ordering claim it has earned.'),
  colour_oversaturation: threshold('artefacts.saturationExtremeFrac.mean', 0.05, 0.12,
    'VYREALM_ANIME_HERO_5S.mp4 saturationExtremeFrac mean 0.15575, max 0.17833, with mean HSV saturation climbing +13.53 over the clip. The 0.13645 / 0.15744 pair quoted in the taxonomy is the stricter S == 255 fraction, a DIFFERENT quantity from the S >= 250 metric gated here, and must not be read as this metric\'s calibration.',
    'medium', 'Fires on our current output by design: the oversaturation is real and measured. Set the permanent fix with a CFG sweep, not by moving this number.'),
  colour_drift: threshold('colourDrift.maxChannelSpreadDrift', 1.0, 2.5,
    'VYREALM_ANIME_HERO_5S.mp4 2.95 (red -3.02 levels/sec against blue -0.07); VYREALM_RAINLINE_TRAILER_1080P.mp4 0.186',
    'low', 'Two clips, one separation. Telemetry to collect across about 30 human-labelled shots before hardening.'),
  stepped_cadence: threshold('cadence.rgbMaeAlternationRatio', 1.8, 3.0,
    'VYREALM_ANIME_HERO_5S.mp4 2.6344 (lag1 -0.813, lag2 +0.875, flow alternation 5.27); VYREALM_RAINLINE_TRAILER_1080P.mp4 1.11 as a clean negative control',
    'intent-dependent', 'Measurement is reliable, the VERDICT is not: animating on twos is correct craft for anime. Drop this mode from the thresholds for anime shots rather than trusting the number.'),
  encode_blocking: threshold('artefacts.blockinessRatio.mean', 1.2, 1.4,
    'VYREALM_RAINLINE_TRAILER_1080P.mp4 shots 1.146 / 1.265 / 1.132',
    'low', 'Measures the encoder, not the generator. Single-clip separation with no replication; collect, do not enforce.'),
});

// --------------------------------------------------------------------------
// probe
// --------------------------------------------------------------------------

/**
 * Run the python pixel probe and return its raw metrics JSON.
 * Throws PROBE_FAILED carrying python's stderr; never approximates.
 */
export async function probeVideo(path, { python = DEFAULT_PYTHON, script = DEFAULT_PROBE_SCRIPT, timeout = 900000, signal } = {}) {
  if (!path || typeof path !== 'string') throw fail('PROBE_FAILED', 'A video path is required');
  let stdout, stderr = '';
  try {
    ({ stdout, stderr } = await exec(python, [script, resolve(path)], { windowsHide: true, timeout, signal, maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    // The probe reports its own coded failures as JSON on stdout with exit 2.
    const coded = parseProbeError(error.stdout);
    if (coded) throw fail('PROBE_FAILED', `${coded.code}: ${coded.message}`, { probeCode: coded.code, stderr: String(error.stderr || '') });
    throw fail('PROBE_FAILED', `${python} ${script} failed: ${String(error.stderr || error.message).slice(-4000)}`, { stderr: String(error.stderr || ''), cause: error });
  }
  let metrics;
  try { metrics = JSON.parse(stdout); } catch { throw fail('PROBE_FAILED', `probe emitted unparseable output: ${String(stdout).slice(0, 400)}`, { stderr }); }
  // Already parsed; re-parsing a multi-megabyte per-frame blob to read one field would be silly.
  if (metrics?.error?.code) throw fail('PROBE_FAILED', `${metrics.error.code}: ${metrics.error.message}`, { probeCode: metrics.error.code, stderr });
  if (!metrics?.source?.frames) throw fail('PROBE_FAILED', 'probe returned no frame count', { stderr });
  return metrics;
}

function parseProbeError(text) {
  if (!text) return null;
  try { const j = JSON.parse(text); return j?.error?.code ? j.error : null; } catch { return null; }
}

// --------------------------------------------------------------------------
// scoring
// --------------------------------------------------------------------------

const round4 = n => Math.round(n * 1e4) / 1e4;
const readPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * Piecewise, monotone, bounded, and continuous at both knots.
 *   t = 0 at the fail line, t = 1 at the warn line.
 *   t <= 0  -> 0.3 / (1 - t)      approaches 0, never negative
 *   0 < t <= 1 -> 0.3 + 0.4 * t   the warn band
 *   t > 1   -> 0.7 + 0.3(1 - 1/t) approaches 1, never exceeds it
 * The score orders clips; the VERDICT is the decision and is returned
 * explicitly. Do not re-derive the verdict from the score: the score is
 * rounded to 4dp, so a value a hair either side of a knot rounds onto it
 * (1.5999 against warn 1.6 scores 0.7 and passes; 2.4999 against fail 2.5
 * scores 0.3 and warns). Exact at the knots, ambiguous within 1e-4 of them.
 */
function scoreOne(value, warn, failAt) {
  const t = (value - failAt) / (warn - failAt);
  if (t <= 0) return { t, score: round4(0.3 / (1 - t)), verdict: 'fail' };
  if (t <= 1) return { t, score: round4(0.3 + 0.4 * t), verdict: 'warn' };
  return { t, score: round4(0.7 + 0.3 * (1 - 1 / t)), verdict: 'pass' };
}

/**
 * Turn raw probe metrics into named verdicts.
 * Pure: the same metrics and thresholds always give the same result.
 * Returns { scores, verdicts, reasons, overall, mean, worst }, where `reasons`
 * is the provenance for every entry in `scores` -- which metric, what value,
 * which two threshold numbers, and how well calibrated they are.
 */
export function scoreVideo(metrics, thresholds = DEFAULT_THRESHOLDS) {
  if (!metrics || typeof metrics !== 'object') throw fail('METRICS_INVALID', 'scoreVideo needs the probe metrics object');
  const ids = Object.keys(thresholds || {});
  if (!ids.length) throw fail('NO_THRESHOLDS', 'At least one failure-mode threshold is required');

  const scores = {}, verdicts = {}, reasons = {};
  for (const id of ids) {
    const catalogue = FAILURE_MODES[id];
    if (!catalogue) throw fail('UNKNOWN_FAILURE_MODE', `No failure mode "${id}" in the catalogue; known: ${Object.keys(FAILURE_MODES).join(', ')}`);
    // A mode the catalogue calls undetectable has no pixel evidence behind it,
    // so any threshold pointed at one would manufacture a verdict from an
    // unrelated metric. Refuse rather than let the boolean be decorative.
    if (!catalogue.detectable) throw fail('MODE_NOT_DETECTABLE', `Failure mode "${id}" is catalogued detectable:false; it is prevention-only and cannot be gated on pixel metrics`, { modeId: id });
    const t = thresholds[id];
    if (!t || typeof t.metric !== 'string' || !Number.isFinite(t.warn) || !Number.isFinite(t.fail)) throw fail('THRESHOLD_INVALID', `Threshold for "${id}" needs metric, warn and fail`);
    if (!t.calibratedOn || !t.confidence) throw fail('THRESHOLD_UNCALIBRATED', `Threshold for "${id}" must declare calibratedOn and confidence; provisional numbers may not travel anonymously`);
    if (t.warn === t.fail) throw fail('THRESHOLD_DEGENERATE', `Threshold for "${id}" has warn === fail (${t.warn}); there is no band to score in`);

    const value = readPath(metrics, t.metric);
    if (value === undefined || value === null) throw fail('METRIC_MISSING', `Metric "${t.metric}" required by "${id}" is absent from the probe output`, { modeId: id, metric: t.metric });
    if (typeof value !== 'number' || !Number.isFinite(value)) throw fail('METRIC_NOT_NUMERIC', `Metric "${t.metric}" required by "${id}" is ${JSON.stringify(value)}, not a finite number`, { modeId: id, metric: t.metric });

    const { score, verdict, t: normalised } = scoreOne(value, t.warn, t.fail);
    scores[id] = score;
    verdicts[id] = verdict;
    reasons[id] = Object.freeze({
      modeId: id,
      label: catalogue.label,
      verdict,
      score,
      metric: t.metric,
      value,
      warn: t.warn,
      fail: t.fail,
      better: t.warn > t.fail ? 'higher' : 'lower',
      normalised: round4(normalised),
      explanation: `${t.metric} = ${value} (${t.warn > t.fail ? 'higher' : 'lower'} is better); warn at ${t.warn}, fail at ${t.fail} => ${verdict}`,
      calibratedOn: t.calibratedOn,
      confidence: t.confidence,
      note: t.note || null,
      sourceUrl: catalogue.sourceUrl,
    });
  }

  const ranked = ids.slice().sort((a, b) => scores[a] - scores[b] || a.localeCompare(b));
  const offenders = ranked.filter(id => verdicts[id] !== 'pass');
  return {
    scores,
    verdicts,
    reasons,
    // Weakest link, not an average: a clip with one broken axis is broken. The
    // mean is reported alongside so nobody has to recompute it.
    overall: round4(Math.min(...ids.map(id => scores[id]))),
    mean: round4(ids.reduce((s, id) => s + scores[id], 0) / ids.length),
    worst: offenders.length ? offenders : ranked.slice(0, 1),
  };
}

// --------------------------------------------------------------------------
// evidence
// --------------------------------------------------------------------------

/**
 * The shippable artifact: the measurements that justified shipping a clip,
 * written next to it. No hosted vendor publishes such a number for any output
 * -- the Sora 2 system card contains zero output-quality metrics, only safety
 * classifier scores -- so this file is the product, not a log.
 */
export function qualityEvidence({ path, metrics, scores, script = DEFAULT_PROBE_SCRIPT } = {}) {
  if (!metrics?.source) throw fail('EVIDENCE_INPUT_INVALID', 'qualityEvidence needs the probe metrics object');
  if (!scores?.scores || !scores.verdicts || !scores.reasons) throw fail('EVIDENCE_INPUT_INVALID', 'qualityEvidence needs the full scoreVideo result, not a bare score map');
  const s = metrics.source;
  return {
    schemaVersion: 1,
    kind: 'vyrealm.quality.evidence',
    generatedAt: new Date().toISOString(),
    video: {
      path: path || s.path || null,
      frames: s.frames,
      fps: s.fps,
      durationSec: s.durationSec,
      width: s.width,
      height: s.height,
    },
    // The script that actually produced these metrics. probeVideo takes a
    // `script` override, so hard-coding the default here would have the
    // evidence file name a probe that never ran.
    probe: { script, metricsSchemaVersion: metrics.schemaVersion ?? null, framePairs: s.framePairs ?? null },
    overall: scores.overall,
    mean: scores.mean,
    worst: scores.worst,
    verdict: Object.values(scores.verdicts).includes('fail') ? 'fail' : Object.values(scores.verdicts).includes('warn') ? 'warn' : 'pass',
    // Every mode carries its own provenance; there are no bare numbers here.
    modes: Object.keys(scores.scores).sort().map(id => ({
      ...scores.reasons[id],
      detectable: FAILURE_MODES[id].detectable,
      preventable: FAILURE_MODES[id].preventable,
      repairable: FAILURE_MODES[id].repairable,
      repairStrategy: FAILURE_MODES[id].repairStrategy,
    })),
    caveat: 'Thresholds are provisional, calibrated on two locally generated clips, and gate obvious defects only. They are not a taste model, and automatic metrics correlate poorly with human judgment (arXiv:2311.01813). Each mode carries its own calibratedOn and confidence.',
  };
}
