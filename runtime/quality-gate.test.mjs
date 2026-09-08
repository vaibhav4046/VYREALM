import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPAIR_STRATEGIES, repairStrategy, decideAction, planShotRepair, gateEvidence } from './quality-gate.mjs';
import { FAILURE_MODES, scoreVideo } from './quality-detectors.mjs';

const AMPLE = { gpuSecondsRemaining: 6000 };
const TIGHT = { gpuSecondsRemaining: 300 };
const KNOWN_MODES = new Set(REPAIR_STRATEGIES.flatMap(s => s.fixes));
const verdict = (mode, over) => ({ mode, status: 'fail', ...over });

// The real probe output for the real locally generated shot: 121 frames of
// measured Laplacian variance, not a hand-drawn curve.  An earlier version of
// this file hard-coded a smooth monotone ramp and called it measured; the
// actual tail is not monotone (it recovers at frames 111, 113, 115 and 118),
// and a synthetic ramp cannot exercise that.
const PROBE = JSON.parse(readFileSync(new URL('../outputs/desktop/QC_ANIME_HERO_5S.json', import.meta.url), 'utf8'));
const sharpnessSeries = () => PROBE.perFrame.sharpness;

test('the strategy catalogue is frozen and every strategy names what it fixes', () => {
  assert.ok(Object.isFrozen(REPAIR_STRATEGIES));
  for (const strategy of REPAIR_STRATEGIES) {
    assert.ok(Object.isFrozen(strategy));
    assert.ok(strategy.fixes.length > 0, `${strategy.id} fixes nothing`);
    assert.ok(['cheap', 'moderate', 'expensive'].includes(strategy.cost));
    assert.equal(typeof strategy.method, 'string');
    assert.equal(typeof strategy.preservesOriginal, 'boolean');
  }
  assert.throws(() => { REPAIR_STRATEGIES[0].cost = 'free'; }, TypeError);
});

test('a clean shot accepts and the accept is still recorded with its scores', () => {
  const scores = { motionSmoothness: 0.98, imagingQuality: 0.81, colourStability: 0.97 };
  const decision = decideAction({ scores, verdicts: [{ mode: 'motionStutter', status: 'pass' }, { mode: 'softness', status: 'pass' }], budget: AMPLE });
  assert.equal(decision.action, 'accept');
  assert.deepEqual(decision.strategies, []);
  assert.equal(decision.estimatedCostSeconds, 0);
  const evidence = gateEvidence({ decision, scores, thresholds: { motionSmoothness: 0.9 } });
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.action, 'accept');
  assert.deepEqual(evidence.failureModes, []);
  assert.deepEqual(evidence.thresholdsCrossed, []);
  assert.deepEqual(evidence.scores, scores);
  assert.equal(evidence.thresholds.motionSmoothness, 0.9);
  assert.match(evidence.reasoning, /motionSmoothness 0.98/);
});

test('a stuttery shot routes to RIFE interpolation with a real target fps', () => {
  const verdicts = [verdict('motionStutter', { metric: 'motionSmoothness', value: 0.71, threshold: 0.9, comparison: 'lt' })];
  const decision = decideAction({ scores: { motionSmoothness: 0.71 }, verdicts, budget: AMPLE });
  assert.equal(decision.action, 'repair');
  assert.deepEqual(decision.strategies, ['rife-interpolate']);
  assert.equal(decision.estimatedCostSeconds, repairStrategy('rife-interpolate').estimatedSeconds);
  const [step] = planShotRepair({ metrics: { fps: 24, frameCount: 121, width: 1024, height: 576 }, verdicts });
  assert.equal(step.strategy, 'rife-interpolate');
  assert.equal(step.parameters.targetFps, 48);
  assert.equal(step.parameters.model, 'rife-v4.6');
  assert.equal(step.ready, true);
});

test('a soft shot routes to Real-ESRGAN upscale sized from the measured frame', () => {
  const verdicts = [verdict('softness', { metric: 'imagingQuality', value: 0.31, threshold: 0.55, comparison: 'lt' })];
  const decision = decideAction({ scores: { imagingQuality: 0.31 }, verdicts, budget: AMPLE });
  assert.equal(decision.action, 'repair');
  assert.deepEqual(decision.strategies, ['realesrgan-upscale']);
  const [step] = planShotRepair({ metrics: { fps: 24, frameCount: 121, width: 1024, height: 576 }, verdicts });
  assert.equal(step.strategy, 'realesrgan-upscale');
  assert.equal(step.parameters.scale, 4);
  assert.equal(step.parameters.targetWidth, 4096);
  assert.equal(step.preservesOriginal, false);
});

test('a shot degrading only in its last second trims to the best window', () => {
  const verdicts = [verdict('terminal_detail_decay', { metric: 'sharpness.minOverMedian', value: 0.5041, threshold: 0.55, comparison: 'lt' })];
  const decision = decideAction({ scores: { imagingQuality: 0.68 }, verdicts, budget: TIGHT });
  assert.equal(decision.action, 'repair');
  assert.deepEqual(decision.strategies, ['trim-to-best-window']);
  assert.equal(decision.estimatedCostSeconds, 2);
  const [step] = planShotRepair({ metrics: { fps: 24, frameCount: 121, sharpnessPerFrame: sharpnessSeries() }, verdicts });
  assert.equal(step.strategy, 'trim-to-best-window');
  assert.equal(step.parameters.startFrame, 0);
  // Frame 109 measures 1178.99, ratio 0.853 of the 1382.327 median, and is the
  // last frame at or above the 0.85 floor.  110 and 111 (0.822, 0.847) sit just
  // under it, which is exactly the non-monotone case a smooth fake would hide.
  assert.equal(step.parameters.endFrame, 109);
  assert.equal(step.parameters.keptFrames, 110);
  assert.equal(step.parameters.droppedFrames, 11);
  assert.equal(step.parameters.keptSeconds, 4.583);
  assert.equal(step.ready, true);
  const series = sharpnessSeries(), median = PROBE.sharpness.median;
  assert.ok(series[109] >= median * 0.85 && series[110] < median * 0.85, 'the trim window must sit on the measured crossing');
});

test('the trim window is driven by the probe JSON as the detector emits it', () => {
  // No flattening by hand: frames, fps and the series all come from the nested
  // probe output, so a caller can pass what quality-detectors.mjs produced.
  const [step] = planShotRepair({ metrics: PROBE, verdicts: [verdict('terminal_detail_decay')] });
  assert.equal(step.parameters.endFrame, 109);
  assert.equal(step.parameters.keptFrames, 110);
  assert.equal(step.parameters.fps, 24);
  assert.equal(step.parameters.keptSeconds, 4.583);
  assert.equal(step.ready, true);
});

test('with no per-frame series the trim falls back to the measured 11-frame tail', () => {
  const [step] = planShotRepair({ metrics: { fps: 24, frameCount: 121 }, verdicts: [verdict('terminal_detail_decay')] });
  assert.equal(step.parameters.endFrame, 109);
  assert.equal(step.parameters.droppedFrames, 11);
  // The fallback must equal what the per-frame rule found on the measured shot,
  // or it is a number with no origin.
  const [measured] = planShotRepair({ metrics: PROBE, verdicts: [verdict('terminal_detail_decay')] });
  assert.equal(step.parameters.droppedFrames, measured.parameters.droppedFrames);
  const [blind] = planShotRepair({ metrics: {}, verdicts: [verdict('terminal_detail_decay')] });
  assert.equal(blind.ready, false);
  assert.equal(blind.diagnostics[0].code, 'METRICS_MISSING');
});

test('a catastrophic shot re-rolls on ample budget and is rejected on a tight one', () => {
  const verdicts = [
    verdict('motionStall', { metric: 'flowTop5Pct', value: 0.18, threshold: 1.5, comparison: 'lt' }),
    verdict('temporalFlicker', { metric: 'flickerScore', value: 0.84, threshold: 0.95, comparison: 'lt' }),
  ];
  const rolled = decideAction({ scores: { motionSmoothness: 0.42 }, verdicts, budget: AMPLE });
  assert.equal(rolled.action, 'reroll');
  assert.deepEqual(rolled.strategies, ['reroll-adjusted-seed']);
  assert.equal(rolled.estimatedCostSeconds, 1568);
  const rejected = decideAction({ scores: { motionSmoothness: 0.42 }, verdicts, budget: TIGHT });
  assert.equal(rejected.action, 'reject');
  assert.deepEqual(rejected.strategies, ['reject-and-reframe']);
  assert.equal(rejected.estimatedCostSeconds, 0);
  assert.match(rejected.reasoning, /1568 s against 300 s/);
  const evidence = gateEvidence({ decision: rejected, scores: { motionSmoothness: 0.42 }, thresholds: { flowTop5Pct: 1.5 } });
  assert.deepEqual(evidence.failureModes, ['motionStall', 'temporalFlicker']);
  assert.equal(evidence.thresholdsCrossed[0].value, 0.18);
  assert.equal(evidence.budgetSecondsRemaining, 300);
});

test('a tight budget keeps the cheap repair, drops the expensive one, and says so', () => {
  const verdicts = [
    verdict('colourDrift', { metric: 'saturationSlope', value: 3.02, threshold: 1.0, comparison: 'gt' }),
    verdict('softness', { metric: 'imagingQuality', value: 0.4, threshold: 0.55, comparison: 'lt' }),
  ];
  const decision = decideAction({ verdicts, budget: TIGHT });
  assert.equal(decision.action, 'repair');
  assert.deepEqual(decision.strategies, ['colour-stabilise']);
  assert.match(decision.reasoning, /Tight budget \(300 s left\): dropped expensive realesrgan-upscale/);
  const ample = decideAction({ verdicts, budget: AMPLE });
  assert.deepEqual(ample.strategies, ['colour-stabilise', 'realesrgan-upscale']);
  assert.equal(ample.estimatedCostSeconds, 1080);
});

test('every decision names the real failure modes and the thresholds it crossed', () => {
  const cases = [
    { verdicts: [], budget: AMPLE },
    { verdicts: [verdict('motionStutter', { metric: 'motionSmoothness', value: 0.71, threshold: 0.9 })], budget: AMPLE },
    { verdicts: [verdict('softness', { metric: 'imagingQuality', value: 0.31, threshold: 0.55 })], budget: AMPLE },
    { verdicts: [verdict('terminalDetailCollapse', { metric: 'tailSharpnessRatio', value: 0.5, threshold: 0.85 })], budget: TIGHT },
    { verdicts: [verdict('motionStall', { metric: 'flowTop5Pct', value: 0.18, threshold: 1.5 })], budget: AMPLE },
    { verdicts: [verdict('motionStall', { metric: 'flowTop5Pct', value: 0.18, threshold: 1.5 })], budget: { gpuSecondsRemaining: 10 } },
  ];
  for (const input of cases) {
    const decision = decideAction({ scores: { imagingQuality: 0.5 }, ...input });
    assert.equal(typeof decision.reasoning, 'string');
    assert.ok(decision.reasoning.startsWith(`${decision.action}: `), decision.reasoning);
    for (const failing of input.verdicts) {
      assert.ok(KNOWN_MODES.has(failing.mode), `${failing.mode} is not in the strategy catalogue`);
      assert.ok(decision.reasoning.includes(failing.mode), decision.reasoning);
      assert.ok(decision.reasoning.includes(String(failing.threshold)), decision.reasoning);
    }
    for (const id of decision.strategies) assert.ok(repairStrategy(id));
    const evidence = gateEvidence({ decision, scores: { imagingQuality: 0.5 } });
    assert.deepEqual(evidence.failureModes, input.verdicts.map(v => v.mode));
    assert.equal(evidence.estimatedCostSeconds, decision.estimatedCostSeconds);
  }
});

test('unknown strategy ids throw instead of being silently priced at zero', () => {
  assert.throws(() => repairStrategy('magic-fixer'), /QUALITY_GATE_UNKNOWN_STRATEGY: magic-fixer/);
  assert.throws(() => repairStrategy(undefined), /QUALITY_GATE_UNKNOWN_STRATEGY/);
  assert.throws(() => gateEvidence({ decision: { action: 'repair', strategies: ['rife-interpolate', 'magic-fixer'] } }), /QUALITY_GATE_UNKNOWN_STRATEGY: magic-fixer/);
  assert.throws(() => gateEvidence({ decision: { action: 'improve', strategies: [] } }), /QUALITY_GATE_INVALID_ACTION: improve/);
  assert.throws(() => gateEvidence({}), /QUALITY_GATE_DECISION_REQUIRED/);
  assert.throws(() => decideAction({ verdicts: [{ status: 'fail' }] }), /QUALITY_GATE_VERDICT_MODE_REQUIRED/);
  assert.throws(() => decideAction({ verdicts: 'stuttery' }), /QUALITY_GATE_INVALID_VERDICTS/);
  assert.throws(() => decideAction({ scores: 'good', verdicts: [] }), /QUALITY_GATE_INVALID_SCORES/);
  assert.throws(() => planShotRepair({ metrics: 'sharp' }), /QUALITY_GATE_INVALID_METRICS/);
});

test('a repair step that cannot be parameterised says so rather than guessing', () => {
  // The probe emits saturationExtremeFrac and per-channel drift, not a mean HSV
  // S for the first and last frame, so the colour correction has no size.  That
  // must surface as a coded diagnostic, never as an invented gain of 1.0.
  const [step] = planShotRepair({ metrics: PROBE, verdicts: [verdict('colour_oversaturation')] });
  assert.equal(step.strategy, 'colour-stabilise');
  assert.equal(step.ready, false);
  assert.equal(step.diagnostics[0].code, 'METRICS_MISSING');
  assert.equal(step.parameters.correction, undefined);
  // Given the measured saturation means from the taxonomy it does compute one.
  const [sized] = planShotRepair({ metrics: { saturationStart: 96.03, saturationEnd: 109.56 }, verdicts: [verdict('colour_oversaturation')] });
  assert.equal(sized.ready, true);
  assert.equal(sized.parameters.correction, 0.877);
  assert.equal(sized.parameters.ffmpegFilter, 'eq=saturation=0.877');
});

test('the plan and the decision never disagree about the fallback', () => {
  for (const mode of ['face_at_distance', 'motion_stall']) {
    const verdicts = [verdict(mode)];
    const decision = decideAction({ verdicts, budget: AMPLE });
    const [step] = planShotRepair({ metrics: PROBE, verdicts });
    assert.ok(decision.strategies.includes(step.strategy), `${mode}: decision ${decision.strategies} vs plan ${step.strategy}`);
  }
});

test('every failure mode the detector can emit is routed by this gate', () => {
  // The defect this catches: the gate spoke camelCase invented here while
  // quality-detectors.mjs emits snake_case catalogue ids, so terminal_detail_decay,
  // colour_oversaturation, detail_collapse, motion_roughness and encode_blocking
  // all fell through to "unrepairable" and ordered a 1568 s re-roll.
  const routed = new Set(REPAIR_STRATEGIES.flatMap(s => s.fixes).map(f => f.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const unrouted = Object.keys(FAILURE_MODES).filter(id => !routed.has(id.replace(/[^a-z0-9]/g, '')));
  assert.deepEqual(unrouted, [], `unrouted detector modes escalate to a 1568 s re-roll: ${unrouted.join(', ')}`);
});

test('a mode the detector calls repairable is repaired, not re-rolled', () => {
  const rerollCost = repairStrategy('reroll-adjusted-seed').estimatedSeconds;
  for (const [id, mode] of Object.entries(FAILURE_MODES)) {
    if (!mode.repairable || !mode.detectable) continue;
    const decision = decideAction({ verdicts: [verdict(id)], budget: AMPLE });
    assert.equal(decision.action, 'repair', `${id} is repairable per the detector catalogue but the gate said ${decision.action}`);
    assert.ok(decision.strategies.length, `${id} repaired with no strategy named`);
    assert.ok(decision.estimatedCostSeconds < rerollCost, `${id} costs ${decision.estimatedCostSeconds} s, no cheaper than a re-roll`);
  }
});

test('the real measured shot is repaired for seconds instead of re-rolled for 1568', () => {
  // End to end on real data: the probe JSON for VYREALM_ANIME_HERO_5S.mp4 through
  // the real scorer, into the gate.  This shot is one the operator reviewed and
  // shipped, and it fails three modes at once; a count-based catastrophe rule
  // turned it into a 26-minute regeneration.
  const scored = scoreVideo(PROBE);
  const failing = Object.entries(scored.verdicts).filter(([, v]) => v === 'fail').map(([id]) => id);
  assert.deepEqual(failing.sort(), ['colour_drift', 'colour_oversaturation', 'terminal_detail_decay']);
  const decision = decideAction({ scores: scored.scores, verdicts: scored.verdicts, budget: AMPLE });
  assert.equal(decision.action, 'repair');
  assert.deepEqual(decision.strategies, ['trim-to-best-window', 'colour-stabilise']);
  assert.equal(decision.estimatedCostSeconds, 4);
  for (const id of failing) assert.ok(decision.reasoning.includes(id), decision.reasoning);
  const evidence = gateEvidence({ decision, scores: scored.scores });
  assert.deepEqual(evidence.failureModes.sort(), failing);
  assert.equal(evidence.estimatedCostSeconds, 4);
});

test('three cheap failures stay cheap: catastrophe is unrepairability, not a count', () => {
  const verdicts = ['terminal_detail_decay', 'colour_drift', 'motion_roughness'].map(m => verdict(m));
  const decision = decideAction({ verdicts, budget: AMPLE });
  assert.equal(decision.action, 'repair');
  assert.deepEqual(decision.strategies, ['trim-to-best-window', 'colour-stabilise', 'rife-interpolate']);
  assert.equal(decision.estimatedCostSeconds, 109);
  // One unrepairable mode alone is still catastrophic.
  assert.equal(decideAction({ verdicts: [verdict('motion_stall')], budget: AMPLE }).action, 'reroll');
});

test('a shot-spec defect is reframed even when the budget could afford a re-roll', () => {
  for (const mode of ['face_at_distance', 'off_bucket_resolution', 'garbled_text', 'promptInfeasible']) {
    const decision = decideAction({ verdicts: [verdict(mode)], budget: AMPLE });
    assert.equal(decision.action, 'reject', `${mode} must not buy a re-roll of the same impossible spec`);
    assert.deepEqual(decision.strategies, ['reject-and-reframe']);
    assert.equal(decision.estimatedCostSeconds, 0);
    assert.match(decision.reasoning, /re-roll would reproduce/);
  }
});

test('an unreadable verdict status or budget throws instead of being read as pass', () => {
  assert.throws(() => decideAction({ verdicts: [{ mode: 'softness', status: 'dodgy' }] }), /QUALITY_GATE_UNKNOWN_VERDICT_STATUS: dodgy/);
  assert.throws(() => decideAction({ verdicts: [{ mode: 'softness' }] }), /QUALITY_GATE_VERDICT_STATUS_REQUIRED: softness/);
  assert.throws(() => decideAction({ verdicts: [verdict('softness')], budget: { gpuBudget: 300 } }), /QUALITY_GATE_INVALID_BUDGET/);
  assert.throws(() => decideAction({ verdicts: [verdict('softness')], budget: { gpuSecondsRemaining: 'plenty' } }), /QUALITY_GATE_INVALID_BUDGET/);
  // A warn is a real detector verdict and is not a failure.
  assert.equal(decideAction({ verdicts: { stepped_cadence: 'warn' }, budget: AMPLE }).action, 'accept');
  // No budget at all is unbounded, and says so rather than inventing a number.
  const unbounded = decideAction({ verdicts: [verdict('motion_stall')] });
  assert.equal(unbounded.action, 'reroll');
  assert.equal(unbounded.budgetSecondsRemaining, null);
});

test('verdicts survive map form, id aliases and snake_case mode names', () => {
  const mapped = decideAction({ verdicts: { motionStutter: 'fail', softness: 'pass' }, budget: AMPLE });
  assert.deepEqual(mapped.strategies, ['rife-interpolate']);
  const aliased = decideAction({ verdicts: [{ id: 'terminal_detail_collapse', severity: 'critical' }], budget: AMPLE });
  assert.deepEqual(aliased.strategies, ['trim-to-best-window']);
  assert.equal(decideAction({ verdicts: [{ mode: 'softness', passed: false }], budget: AMPLE }).action, 'repair');
});
