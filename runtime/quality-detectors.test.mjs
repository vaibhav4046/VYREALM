import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FAILURE_MODES, DEFAULT_THRESHOLDS, DEFAULT_PYTHON, DEFAULT_PROBE_SCRIPT,
  scoreVideo, probeVideo, qualityEvidence,
} from './quality-detectors.mjs';

// --- synthetic metric objects: no video, no python, no pixels ---------------

const setPath = (obj, path, value) => {
  const keys = path.split('.');
  let node = obj;
  for (const k of keys.slice(0, -1)) node = node[k] ??= {};
  node[keys.at(-1)] = value;
  return obj;
};

// A metrics blob that satisfies every default threshold at its pass anchor,
// then overridden per test. `step` is one warn-to-fail band, signed so that
// adding it always moves in the good direction whatever the metric's polarity.
const band = t => t.warn - t.fail;
const anchor = (t, where) => where === 'pass' ? t.warn + band(t) : where === 'warn' ? t.warn : t.fail;

const metricsWith = (overrides = {}) => {
  const m = { schemaVersion: 1, source: { frames: 121, fps: 24, durationSec: 5.0417, width: 1024, height: 576, framePairs: 120 } };
  for (const [id, t] of Object.entries(DEFAULT_THRESHOLDS)) setPath(m, t.metric, anchor(t, 'pass'));
  for (const [path, value] of Object.entries(overrides)) setPath(m, path, value);
  return m;
};

// --- catalogue -------------------------------------------------------------

test('FAILURE_MODES is frozen and every entry is fully described', () => {
  assert.ok(Object.isFrozen(FAILURE_MODES));
  assert.ok(Object.keys(FAILURE_MODES).length >= 12);
  for (const [id, mode] of Object.entries(FAILURE_MODES)) {
    assert.ok(Object.isFrozen(mode), `${id} entry must be frozen`);
    assert.equal(mode.id, id, `${id} must be keyed by its own id`);
    for (const key of ['label', 'description', 'repairStrategy', 'sourceUrl']) {
      assert.equal(typeof mode[key], 'string', `${id}.${key} must be a string`);
      assert.ok(mode[key].length > 8, `${id}.${key} must say something`);
    }
    for (const key of ['detectable', 'preventable', 'repairable']) {
      assert.equal(typeof mode[key], 'boolean', `${id}.${key} must be a boolean`);
    }
  }
});

test('the catalogue keeps modes that pixels cannot detect, and says so', () => {
  const undetectable = Object.values(FAILURE_MODES).filter(m => !m.detectable);
  assert.ok(undetectable.length >= 3, 'prevention-only failure modes must still be catalogued');
  for (const mode of undetectable) assert.equal(DEFAULT_THRESHOLDS[mode.id], undefined, `${mode.id} is not detectable so it must not be gated`);
});

// --- thresholds ------------------------------------------------------------

test('every threshold carries its own calibration metadata', () => {
  assert.ok(Object.isFrozen(DEFAULT_THRESHOLDS));
  for (const [id, t] of Object.entries(DEFAULT_THRESHOLDS)) {
    assert.ok(FAILURE_MODES[id], `threshold ${id} must name a catalogued failure mode`);
    assert.equal(typeof t.metric, 'string');
    assert.ok(Number.isFinite(t.warn) && Number.isFinite(t.fail), `${id} needs numeric warn and fail`);
    assert.notEqual(t.warn, t.fail, `${id} needs a band between warn and fail`);
    assert.equal(typeof t.calibratedOn, 'string');
    assert.ok(t.calibratedOn.length > 20, `${id}.calibratedOn must name the clips it came from`);
    assert.ok(['high', 'medium', 'low', 'intent-dependent'].includes(t.confidence), `${id}.confidence is ${t.confidence}`);
  }
});

// --- scoring ---------------------------------------------------------------

test('every mode returns pass, warn and fail at its own anchors', () => {
  for (const [id, t] of Object.entries(DEFAULT_THRESHOLDS)) {
    for (const where of ['pass', 'warn', 'fail']) {
      const result = scoreVideo(metricsWith({ [t.metric]: anchor(t, where) }), { [id]: t });
      assert.equal(result.verdicts[id], where, `${id} at ${where} anchor ${anchor(t, where)} gave ${result.verdicts[id]}`);
    }
  }
});

test('scores are monotone in the metric and bounded to 0..1', () => {
  const t = DEFAULT_THRESHOLDS.detail_collapse; // higher is worse: warn 1.6, fail 2.5
  const at = v => scoreVideo(metricsWith({ [t.metric]: v }), { detail_collapse: t }).scores.detail_collapse;
  const series = [0.5, 1.0, 1.5, 1.6, 2.0, 2.5, 4.0, 40].map(at);
  for (let i = 1; i < series.length; i++) assert.ok(series[i] <= series[i - 1], `score must not rise as the defect worsens: ${series}`);
  for (const s of series) assert.ok(s >= 0 && s <= 1, `score ${s} out of range`);
  assert.ok(at(40) < 0.05, 'a catastrophic value should approach zero');
  assert.ok(at(0.5) > 0.85, 'a clean value should approach one');
});

test('the same metrics always give the same scores', () => {
  const metrics = metricsWith({ 'temporalFlicker.vbenchFlickerScore': 0.9412, 'sharpness.minOverMedian': 0.61 });
  assert.deepEqual(scoreVideo(metrics), scoreVideo(metrics));
  assert.deepEqual(scoreVideo(structuredClone(metrics)), scoreVideo(metrics));
});

test('every verdict names the metric and the thresholds that produced it', () => {
  const result = scoreVideo(metricsWith({ 'artefacts.saturationExtremeFrac.mean': 0.15575 }));
  for (const id of Object.keys(result.scores)) {
    const why = result.reasons[id];
    assert.ok(why, `${id} has a score with no provenance`);
    assert.equal(why.metric, DEFAULT_THRESHOLDS[id].metric);
    assert.equal(why.warn, DEFAULT_THRESHOLDS[id].warn);
    assert.equal(why.fail, DEFAULT_THRESHOLDS[id].fail);
    assert.equal(why.verdict, result.verdicts[id]);
    assert.equal(why.score, result.scores[id]);
    assert.ok(why.explanation.includes(why.metric) && why.explanation.includes(String(why.value)));
    assert.ok(why.calibratedOn && why.confidence, `${id} provenance must carry calibration`);
  }
  // The measured oversaturation of our own current output is a fail, not a shrug.
  // 0.15575 is what this metric (HSV S >= 250) actually reads on the anime clip;
  // the 0.13645 in the taxonomy is the stricter S == 255 fraction and belongs to
  // a different quantity. MEASURED below pins the real one against the real file.
  assert.equal(result.verdicts.colour_oversaturation, 'fail');
  assert.match(result.reasons.colour_oversaturation.explanation, /0\.15575/);
});

test('the verdict is authoritative; the rounded score ties at the knots', () => {
  const t = DEFAULT_THRESHOLDS.detail_collapse; // warn 1.6, fail 2.5, higher is worse
  const at = v => scoreVideo(metricsWith({ [t.metric]: v }), { detail_collapse: t });
  // Exactly on a knot the score is the knot value and the verdict is the harsher side.
  assert.deepEqual([at(1.6).scores.detail_collapse, at(1.6).verdicts.detail_collapse], [0.7, 'warn']);
  assert.deepEqual([at(2.5).scores.detail_collapse, at(2.5).verdicts.detail_collapse], [0.3, 'fail']);
  // A hair to the good side rounds ONTO the knot while the verdict moves. Anyone
  // re-deriving a verdict from the score alone gets this pair wrong, which is why
  // scoreVideo returns verdicts explicitly.
  assert.deepEqual([at(1.5999).scores.detail_collapse, at(1.5999).verdicts.detail_collapse], [0.7, 'pass']);
  assert.deepEqual([at(2.4999).scores.detail_collapse, at(2.4999).verdicts.detail_collapse], [0.3, 'warn']);
});

test('overall is the worst mode and worst lists the offenders worst-first', () => {
  const result = scoreVideo(metricsWith({
    'sharpness.maxSingleFrameDropRatio': 4.026,   // fail
    'sharpness.minOverMedian': 0.70,              // warn
  }));
  assert.equal(result.overall, Math.min(...Object.values(result.scores)));
  assert.equal(result.worst[0], 'detail_collapse');
  assert.deepEqual(result.worst, ['detail_collapse', 'terminal_detail_decay']);
  assert.ok(result.mean > result.overall);
});

test('worst still names something when every mode passes', () => {
  const clean = scoreVideo(metricsWith());
  assert.deepEqual(Object.values(clean.verdicts).filter(v => v !== 'pass'), []);
  assert.equal(clean.worst.length, 1);
  assert.equal(clean.scores[clean.worst[0]], clean.overall);
});

// --- coded failures --------------------------------------------------------

test('an unknown failure mode throws instead of scoring it', () => {
  assert.throws(
    () => scoreVideo(metricsWith(), { imaginary_mode: { metric: 'temporalFlicker.vbenchFlickerScore', warn: 0.9, fail: 0.8, calibratedOn: 'nothing at all, invented', confidence: 'low' } }),
    e => e.code === 'UNKNOWN_FAILURE_MODE' && /imaginary_mode/.test(e.message));
});

test('a mode the catalogue calls undetectable cannot be gated', () => {
  const undetectable = Object.values(FAILURE_MODES).find(m => !m.detectable);
  assert.throws(
    () => scoreVideo(metricsWith(), {
      [undetectable.id]: {
        metric: 'temporalFlicker.vbenchFlickerScore', warn: 0.97, fail: 0.93,
        calibratedOn: 'nothing: this metric has no bearing on this mode', confidence: 'low',
      },
    }),
    e => e.code === 'MODE_NOT_DETECTABLE' && e.modeId === undetectable.id);
});

test('a threshold with no calibration metadata throws', () => {
  const naked = { metric: 'temporalFlicker.vbenchFlickerScore', warn: 0.97, fail: 0.93 };
  assert.throws(() => scoreVideo(metricsWith(), { temporal_flicker: naked }), e => e.code === 'THRESHOLD_UNCALIBRATED');
  assert.throws(() => scoreVideo(metricsWith(), { temporal_flicker: { ...naked, warn: 0.93, calibratedOn: 'two clips, both of them ours', confidence: 'low' } }), e => e.code === 'THRESHOLD_DEGENERATE');
});

test('a missing or non-numeric metric throws rather than scoring a guess', () => {
  const missing = metricsWith();
  delete missing.sharpness.minOverMedian;
  assert.throws(() => scoreVideo(missing), e => e.code === 'METRIC_MISSING' && e.metric === 'sharpness.minOverMedian');
  assert.throws(() => scoreVideo(metricsWith({ 'sharpness.minOverMedian': null })), e => e.code === 'METRIC_MISSING');
  assert.throws(() => scoreVideo(metricsWith({ 'sharpness.minOverMedian': 'quite good' })), e => e.code === 'METRIC_NOT_NUMERIC');
  assert.throws(() => scoreVideo(metricsWith({ 'sharpness.minOverMedian': NaN })), e => e.code === 'METRIC_NOT_NUMERIC');
  assert.throws(() => scoreVideo(null), e => e.code === 'METRICS_INVALID');
  assert.throws(() => scoreVideo(metricsWith(), {}), e => e.code === 'NO_THRESHOLDS');
});

// --- evidence --------------------------------------------------------------

test('quality evidence is schema 1 and every number carries provenance', () => {
  const metrics = metricsWith({ 'sharpness.minOverMedian': 0.504 });
  const scores = scoreVideo(metrics);
  const evidence = qualityEvidence({ path: 'C:\\clips\\shot.mp4', metrics, scores });
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.video.path, 'C:\\clips\\shot.mp4');
  assert.equal(evidence.video.frames, 121);
  assert.equal(evidence.overall, scores.overall);
  assert.equal(evidence.verdict, 'fail');
  assert.equal(evidence.modes.length, Object.keys(DEFAULT_THRESHOLDS).length);
  for (const mode of evidence.modes) {
    for (const key of ['metric', 'value', 'warn', 'fail', 'verdict', 'score', 'calibratedOn', 'confidence', 'explanation', 'repairStrategy', 'sourceUrl']) {
      assert.notEqual(mode[key], undefined, `${mode.modeId}.${key} missing from evidence`);
    }
  }
  assert.match(evidence.caveat, /provisional/);
  // The evidence names the probe that actually ran, not whichever is the default.
  assert.equal(evidence.probe.script, DEFAULT_PROBE_SCRIPT);
  assert.equal(qualityEvidence({ metrics, scores, script: 'D:\\other\\probe.py' }).probe.script, 'D:\\other\\probe.py');
  assert.ok(JSON.parse(JSON.stringify(evidence)), 'evidence must serialise');
});

test('evidence refuses a bare score map', () => {
  assert.throws(() => qualityEvidence({ metrics: metricsWith(), scores: { detail_collapse: 0.9 } }), e => e.code === 'EVIDENCE_INPUT_INVALID');
  assert.throws(() => qualityEvidence({ metrics: null, scores: scoreVideo(metricsWith()) }), e => e.code === 'EVIDENCE_INPUT_INVALID');
});

// --- integration: one real clip, real pixels -------------------------------

const SAMPLE = resolve(process.env.VYREALM_QC_SAMPLE || 'outputs/desktop/VYREALM_ANIME_HERO_5S.mp4');

// What the probe actually reads off SAMPLE. Two full probe runs on 2026-09-07
// were bit-for-bit identical (ORB/RANSAC included), so these are pins, not
// wishes. They exist so the numbers quoted in DEFAULT_THRESHOLDS[*].calibratedOn
// are checked by a test instead of by a reader's goodwill: if a metric's
// DEFINITION drifts, the value moves by percent and this fails loudly rather
// than the provenance string going quietly stale. This is exactly how the
// colour_oversaturation entry was caught quoting 0.13645 (the S == 255 fraction)
// for a metric that thresholds at S >= 250 and reads 0.15575 on this clip.
const MEASURED = {
  'temporalFlicker.vbenchFlickerScore': 0.980259172859275,
  'motionSmoothness.blendSmoothnessProxy': 0.9821497198592,
  'dynamicDegree.flowTop5Pct.mean': 3.1881007578223945,
  'stability.orbHomographyInlierRatio.mean': 0.9540442238314566,
  'stability.histCorrFirstFrame.min': 0.81317974973303,
  'stall.longestStallRun': 0,
  'sharpness.maxSingleFrameDropRatio': 1.2349735097599819,
  'sharpness.minOverMedian': 0.5041058561728763,
  'artefacts.saturationExtremeFrac.mean': 0.1557500189438777,
  'artefacts.blockinessRatio.mean': 1.0517109775346172,
  'colourDrift.maxChannelSpreadDrift': 2.953029174556607,
  'cadence.rgbMaeAlternationRatio': 2.6344243325614234,
};

test('probes a real generated clip end to end', { timeout: 600000 }, async t => {
  if (!existsSync(DEFAULT_PYTHON)) return t.skip(`python not available at ${DEFAULT_PYTHON}; set VYREALM_PYTHON to run this test`);
  if (!existsSync(DEFAULT_PROBE_SCRIPT)) return t.skip(`probe script missing at ${DEFAULT_PROBE_SCRIPT}`);
  if (!existsSync(SAMPLE)) return t.skip(`sample clip missing at ${SAMPLE}; set VYREALM_QC_SAMPLE to run this test`);

  const metrics = await probeVideo(SAMPLE);
  assert.equal(metrics.schemaVersion, 1);
  assert.equal(metrics.source.frames, 121);
  assert.equal(metrics.source.width, 1024);
  assert.equal(metrics.source.height, 576);
  assert.ok(Math.abs(metrics.source.fps - 24) < 0.01, `fps was ${metrics.source.fps}`);

  const flicker = metrics.temporalFlicker.vbenchFlickerScore;
  assert.ok(flicker > 0 && flicker < 1, `flicker score ${flicker} must be a real fraction`);
  assert.ok(metrics.sharpness.laplacianVar.mean > 0, 'sharpness must be measured, not defaulted');
  assert.ok(metrics.dynamicDegree.flowTop5Pct.mean > 0, 'optical flow must be measured');
  assert.equal(metrics.perFrame.sharpness.length, 121);

  const scores = scoreVideo(metrics);
  const read = path => path.split('.').reduce((o, k) => o?.[k], metrics);

  // Every metric a default threshold gates must be pinned, or a calibration
  // number could rot unnoticed on an ungated axis.
  assert.deepEqual(
    Object.values(DEFAULT_THRESHOLDS).map(t => t.metric).filter(m => !(m in MEASURED)), [],
    'every gated metric needs a measured pin');
  for (const [path, expected] of Object.entries(MEASURED)) {
    const actual = read(path);
    assert.equal(typeof actual, 'number', `${path} is ${actual}, not a number`);
    assert.ok(Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-6),
      `${path} measured ${actual} but is pinned at ${expected}; if the metric changed on purpose, re-measure and update the calibratedOn strings too`);
  }

  for (const id of Object.keys(DEFAULT_THRESHOLDS)) {
    assert.ok(['pass', 'warn', 'fail'].includes(scores.verdicts[id]), `${id} produced no verdict`);
    // The reported value is the one actually in the probe output, not a default.
    assert.equal(scores.reasons[id].value, read(DEFAULT_THRESHOLDS[id].metric), `${id} reported a value the probe did not produce`);
    assert.ok(Number.isFinite(scores.reasons[id].value), `${id} scored on a non-number`);
  }
  assert.ok(scores.overall >= 0 && scores.overall <= 1);
  assert.ok(scores.worst.length >= 1);

  const evidence = qualityEvidence({ path: SAMPLE, metrics, scores });
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.video.frames, 121);
  assert.ok(['pass', 'warn', 'fail'].includes(evidence.verdict));

  // Printed, not asserted: these are the numbers this clip actually produced.
  console.log(`  ${evidence.verdict} overall=${scores.overall} mean=${scores.mean} worst=${scores.worst.join(', ')}`);
  for (const id of scores.worst) console.log(`    ${id}: ${scores.reasons[id].explanation}`);
});

test('probe failures carry a code and python stderr', { timeout: 120000 }, async t => {
  if (!existsSync(DEFAULT_PYTHON)) return t.skip('python not available');
  await assert.rejects(
    () => probeVideo('C:\\definitely\\not\\a\\video.mp4'),
    e => e.code === 'PROBE_FAILED' && e.probeCode === 'VYQC_FILE_NOT_FOUND');
  await assert.rejects(() => probeVideo(''), e => e.code === 'PROBE_FAILED');
});
