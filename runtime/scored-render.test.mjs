import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderAndScore, summariseBatch, scoredEvidence } from './scored-render.mjs';
import { DEFAULT_PROBE_SCRIPT, DEFAULT_PYTHON, DEFAULT_THRESHOLDS, scoreVideo } from './quality-detectors.mjs';
import { buildProductionPlan } from './format-library.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// --------------------------------------------------------------------------
// fixtures
//
// Only the two I/O boundaries are stubbed: the renderer and the python probe.
// scoreVideo and decideAction run for real against a SUBSET of the shipped
// thresholds, so these tests exercise the actual scoring and the actual gate
// rather than a mock of them. Every metric value below is a number that appears
// in quality-detectors.mjs's own calibration notes; none is invented.
// --------------------------------------------------------------------------

const THRESHOLDS = Object.freeze({
  detail_collapse: DEFAULT_THRESHOLDS.detail_collapse,
  colour_oversaturation: DEFAULT_THRESHOLDS.colour_oversaturation,
  morphing_geometry: DEFAULT_THRESHOLDS.morphing_geometry,
});

const metricsFor = ({ dropRatio, saturation, inliers }) => ({
  schemaVersion: 1,
  source: { path: 'stub.mp4', frames: 121, fps: 24, durationSec: 5.042, width: 1024, height: 576, framePairs: 120 },
  sharpness: { maxSingleFrameDropRatio: dropRatio },
  artefacts: { saturationExtremeFrac: { mean: saturation } },
  stability: { orbHomographyInlierRatio: { mean: inliers } },
});

// VYREALM_ANIME_HERO_5S.mp4 on its clean axes.
const CLEAN = metricsFor({ dropRatio: 1.235, saturation: 0.02, inliers: 0.954 });
// VYREALM_RAINLINE_TRAILER_1080P.mp4 frame 35: a genuine generative collapse,
// repairable by a trim.
const COLLAPSED = metricsFor({ dropRatio: 4.026, saturation: 0.02, inliers: 0.954 });
// Rainline shot 2: morphing, which no post-pass repair recovers.
const MORPHING = metricsFor({ dropRatio: 1.235, saturation: 0.02, inliers: 0.809 });

const receipt = (output = 'C:/out/clip.mp4') => ({
  schemaVersion: 1,
  output,
  formatId: 'satisfying-loop',
  platform: 'tiktok',
  requestedSeconds: 8,
  measured: { width: 1080, height: 1920, fps: 30, frames: 240, seconds: 8 },
  beats: 2,
  renderMs: 11000,
});

/** Records what it was handed, so the composition can be asserted on. */
function stubs({ metrics = CLEAN, probeError = null, output = 'C:/out/clip.mp4' } = {}) {
  const calls = { render: [], probe: [], score: [] };
  return {
    calls,
    renderFn: async args => { calls.render.push(args); return receipt(output); },
    probeFn: async (path, options) => {
      calls.probe.push({ path, options });
      if (probeError) throw probeError;
      return metrics;
    },
    scoreFn: (m, t) => { calls.score.push({ metrics: m, thresholds: t }); return scoreVideo(m, t); },
  };
}

const base = { plan: { formatId: 'satisfying-loop' }, shotLibrary: {}, output: 'C:/out/clip.mp4', workDir: 'C:/work', thresholds: THRESHOLDS };

// --------------------------------------------------------------------------
// composition
// --------------------------------------------------------------------------

test('renders, then probes the RENDERED file, then scores, then decides', async () => {
  const s = stubs();
  const result = await renderAndScore({ ...base, captionText: 'hook', allowExtension: true, ...s });

  assert.equal(s.calls.render.length, 1, 'renderPlan is called exactly once');
  assert.equal(s.calls.render[0].captionText, 'hook', 'caption text is passed through to the renderer');
  assert.equal(s.calls.render[0].allowExtension, true, 'allowExtension is passed through to the renderer');

  assert.equal(s.calls.probe.length, 1, 'the probe is called exactly once');
  assert.equal(s.calls.probe[0].path, 'C:/out/clip.mp4',
    'the probe must read the file the renderer wrote, not the source shots');
  assert.equal(s.calls.probe[0].options.python, DEFAULT_PYTHON);
  assert.equal(s.calls.probe[0].options.script, DEFAULT_PROBE_SCRIPT);

  assert.equal(s.calls.score.length, 1);
  assert.equal(s.calls.score[0].metrics, CLEAN, 'scoreVideo scores the probe output');
  assert.equal(s.calls.score[0].thresholds, THRESHOLDS, 'the supplied thresholds reach the scorer');

  assert.equal(result.scored, true);
  assert.equal(result.render.measured.frames, 240, 'the render receipt survives scoring');
  assert.deepEqual(Object.keys(result.verdicts).sort(), ['colour_oversaturation', 'detail_collapse', 'morphing_geometry']);
  assert.equal(result.decision.action, 'accept', 'a clean clip is accepted');
  assert.ok(result.scores.overall > 0.7, `a clean clip scores above the warn knee, got ${result.scores.overall}`);
  assert.equal(result.diagnostics.length, 0);
});

test('a repairable failure reaches the gate with its crossing numbers', async () => {
  const result = await renderAndScore({ ...base, ...stubs({ metrics: COLLAPSED }) });
  assert.equal(result.verdicts.detail_collapse, 'fail');
  assert.equal(result.decision.action, 'repair');
  assert.deepEqual(result.decision.strategies, ['trim-to-best-window']);
  const crossed = result.decision.failures.find(f => f.mode === 'detail_collapse');
  assert.equal(crossed.metric, 'sharpness.maxSingleFrameDropRatio',
    'the decision must name the metric it read, not just the mode');
  assert.equal(crossed.value, 4.026);
});

test('an unrepairable failure re-rolls when the GPU budget covers it, rejects when it does not', async () => {
  const rolled = await renderAndScore({ ...base, ...stubs({ metrics: MORPHING }), budget: 2000 });
  assert.equal(rolled.decision.action, 'reroll');

  const rejected = await renderAndScore({ ...base, ...stubs({ metrics: MORPHING }), budget: 60 });
  assert.equal(rejected.decision.action, 'reject', '1568 s of re-roll does not fit 60 s of budget');
});

// --------------------------------------------------------------------------
// scoring is best-effort; rendering is not
// --------------------------------------------------------------------------

test('a probe failure yields an unscored result, not a thrown render', async () => {
  const probeError = Object.assign(new Error('python.exe not found'), { code: 'PROBE_FAILED' });
  const result = await renderAndScore({ ...base, ...stubs({ probeError }) });

  assert.equal(result.scored, false);
  assert.equal(result.scores, null, 'scores must be null, never a guess');
  assert.equal(result.verdicts, null);
  assert.equal(result.decision, null, 'no decision is better than a fabricated accept');
  assert.equal(result.render.output, 'C:/out/clip.mp4', 'the video is still delivered');

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, 'SCORING_UNAVAILABLE');
  assert.equal(result.diagnostics[0].stage, 'probe');
  assert.match(result.diagnostics[0].message, /python\.exe not found/, 'the real cause is quoted, not paraphrased');
});

test('a scoring failure after a successful probe keeps the metrics and says which half broke', async () => {
  const s = stubs({ metrics: { source: { frames: 121 } } }); // no metric paths at all
  const result = await renderAndScore({ ...base, ...s, scoreFn: undefined });

  assert.equal(result.scored, false);
  assert.equal(result.scores, null);
  assert.ok(result.metrics, 'the measurement that DID happen is kept');
  assert.equal(result.diagnostics[0].stage, 'score');
  assert.match(result.diagnostics[0].message, /METRIC_MISSING/);
});

test('skipScoring delivers the render unmeasured and never touches the probe', async () => {
  const s = stubs();
  const result = await renderAndScore({ ...base, ...s, skipScoring: true });
  assert.equal(s.calls.probe.length, 0, 'the fast path must not pay for a probe');
  assert.equal(result.scored, false);
  assert.equal(result.scores, null);
  assert.equal(result.diagnostics[0].code, 'SCORING_SKIPPED');
});

// --------------------------------------------------------------------------
// evidence
// --------------------------------------------------------------------------

test('evidence carries the thresholds that produced the verdicts', async () => {
  const result = await renderAndScore({ ...base, ...stubs({ metrics: COLLAPSED }) });
  const e = result.evidence;

  assert.equal(e.schemaVersion, 1);
  assert.equal(e.scored, true);
  assert.equal(e.output, 'C:/out/clip.mp4');
  assert.equal(e.render.renderMs, 11000, 'the render receipt is part of the record');

  assert.deepEqual(Object.keys(e.thresholds).sort(), ['colour_oversaturation', 'detail_collapse', 'morphing_geometry']);
  assert.equal(e.thresholds.detail_collapse.warn, 1.6);
  assert.equal(e.thresholds.detail_collapse.fail, 2.5);
  assert.ok(e.thresholds.detail_collapse.calibratedOn, 'a threshold must not travel without its calibration');

  const mode = e.quality.modes.find(m => m.modeId === 'detail_collapse');
  assert.equal(mode.value, 4.026, 'the measured value sits next to the threshold it crossed');
  assert.equal(mode.warn, 1.6);
  assert.equal(mode.fail, 2.5);

  assert.equal(e.gate.action, 'repair');
  assert.deepEqual(e.gate.failureModes, ['detail_collapse']);
  assert.equal(e.gate.thresholds.detail_collapse.fail, 2.5);
  // No megabyte per-frame arrays: the audit needs the values that decided, not
  // the whole probe dump.
  assert.equal(e.metrics, undefined);

  assert.equal(scoredEvidence(result).thresholds, result.thresholds, 'scoredEvidence is callable on its own');
});

test('unscored evidence still records the bar the video was going to be held to', async () => {
  const result = await renderAndScore({ ...base, ...stubs(), skipScoring: true });
  assert.equal(result.evidence.scored, false);
  assert.equal(result.evidence.quality, null);
  assert.equal(result.evidence.gate, null);
  assert.equal(result.evidence.thresholds.detail_collapse.fail, 2.5);
  assert.equal(result.evidence.diagnostics[0].code, 'SCORING_SKIPPED');
});

test('scoredEvidence refuses input with no render receipt', () => {
  const isCode = code => error => error.code === code;
  assert.throws(() => scoredEvidence({ scores: {} }), isCode('EVIDENCE_INPUT_INVALID'));
  assert.throws(() => scoredEvidence(null), isCode('EVIDENCE_INPUT_INVALID'));
});

// --------------------------------------------------------------------------
// batch summary
// --------------------------------------------------------------------------

test('summariseBatch counts, averages and tallies over a mixed batch', async () => {
  const results = [
    await renderAndScore({ ...base, ...stubs({ metrics: CLEAN }) }),
    await renderAndScore({ ...base, ...stubs({ metrics: COLLAPSED }) }),
    await renderAndScore({ ...base, ...stubs({ metrics: MORPHING }), budget: 2000 }),
    await renderAndScore({ ...base, ...stubs(), skipScoring: true }),
  ];
  const summary = summariseBatch(results);

  assert.equal(summary.count, 4);
  assert.equal(summary.scored, 3);
  assert.equal(summary.unscored, 1);

  const overalls = results.filter(r => r.scored).map(r => r.scores.overall);
  const expected = Math.round((overalls.reduce((a, b) => a + b, 0) / 3) * 1e4) / 1e4;
  assert.equal(summary.meanOverall, expected, 'the mean is over the SCORED videos only');
  assert.ok(summary.meanOverall < Math.max(...overalls) && summary.meanOverall > Math.min(...overalls));

  assert.deepEqual(summary.worstModes, { detail_collapse: 1, morphing_geometry: 1 },
    'only non-passing verdicts are counted, one per video that showed them');
  assert.deepEqual(summary.decisions, { accept: 1, repair: 1, reroll: 1 },
    'the unscored video contributes no decision');
});

test('an all-unscored batch reports no mean rather than a zero', async () => {
  const results = [
    await renderAndScore({ ...base, ...stubs(), skipScoring: true }),
    await renderAndScore({ ...base, ...stubs({ probeError: new Error('probe died') }) }),
  ];
  const summary = summariseBatch(results);
  assert.deepEqual(summary, { count: 2, scored: 0, unscored: 2, meanOverall: null, worstModes: {}, decisions: {} });
});

test('an empty batch summarises to zeroes with no mean', () => {
  assert.deepEqual(summariseBatch([]), { count: 0, scored: 0, unscored: 0, meanOverall: null, worstModes: {}, decisions: {} });
  assert.throws(() => summariseBatch(null), error => error.code === 'BATCH_INPUT_INVALID');
});

// --------------------------------------------------------------------------
// integration: one real render, one real probe
// --------------------------------------------------------------------------

test('integration: renders a real plan from outputs/shots and scores the file', { timeout: 900000 }, async t => {
  const shotsDir = join(root, 'outputs/shots');
  // Shots are generated on this box while the batch runs, so a file may exist
  // and still be a partial write. 64 KB is well under the smallest complete
  // 97-frame LTX clip (302 KB) and well over a truncated header.
  const shot = ['ocean-cliff', 'forest-light', 'desert-monolith', 'neon-alley', 'snow-pines', 'vinyl-spin']
    .map(id => join(shotsDir, `${id}.mp4`))
    .find(p => existsSync(p) && statSync(p).size > 65536);

  if (!shot) return t.skip(`no complete shot in ${shotsDir}; generate one with the LTX pipeline first (97 frames at 768x512 takes 196 s)`);
  if (!existsSync(DEFAULT_PYTHON)) return t.skip(`python not installed at ${DEFAULT_PYTHON}; set VYREALM_PYTHON to score locally`);
  if (!existsSync(DEFAULT_PROBE_SCRIPT)) return t.skip(`probe script missing at ${DEFAULT_PROBE_SCRIPT}`);
  const ffmpeg = join(root, 'workers/tools/ffmpeg.exe');
  if (!existsSync(ffmpeg)) return t.skip(`ffmpeg missing at ${ffmpeg}`);

  const outDir = join(root, 'outputs/.test-scored-render');
  const output = join(outDir, 'integration.mp4');
  await rm(outDir, { recursive: true, force: true });

  // satisfying-loop is the shortest format in the library: 8 s, two beats, one
  // shot role. Its 4 s beats exceed a 97-frame/25fps source, so allowExtension
  // is on and the render honestly declares the synthetic seconds.
  const plan = buildProductionPlan({
    formatId: 'satisfying-loop',
    platform: 'square-feed',
    brief: 'scored-render integration test',
    shots: { loop: { assetId: 'loop' } },
  });
  assert.equal(plan.renderable, true);

  const started = Date.now();
  const result = await renderAndScore({
    plan,
    shotLibrary: { loop: { path: shot, inPoint: 0 } },
    output,
    workDir: join(outDir, 'work'),
    allowExtension: true,
    thresholds: THRESHOLDS,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  try {
    assert.ok(existsSync(output), 'a real file was written');
    assert.ok(result.render.measured.frames > 0, 'the render receipt measured real frames');
    assert.equal(result.render.measured.width, plan.canvas.width);

    if (!result.scored) {
      // A working video with no score is the documented outcome, not a failure.
      assert.equal(result.diagnostics[0].code, 'SCORING_UNAVAILABLE');
      assert.equal(result.evidence.scored, false);
      console.log(`integration: rendered in ${elapsed}s, UNSCORED - ${result.diagnostics[0].message}`);
      return;
    }

    assert.ok(result.scores.overall > 0 && result.scores.overall <= 1, `overall in (0,1], got ${result.scores.overall}`);
    assert.ok(['accept', 'repair', 'reroll', 'reject'].includes(result.decision.action));
    assert.equal(result.evidence.quality.video.frames, result.metrics.source.frames);
    assert.equal(result.evidence.thresholds.detail_collapse.fail, 2.5);
    console.log(`integration: ${elapsed}s, ${result.render.measured.width}x${result.render.measured.height} ${result.render.measured.seconds}s, overall ${result.scores.overall}, ${result.decision.action}, worst ${result.scores.worst.join(', ')}`);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
