// Accept / repair / reject decision engine.  A score is not a decision: this
// module turns measured scores and per-mode verdicts into one explainable
// action, names the failure modes and thresholds that drove it, and prices the
// work against the GPU seconds actually left.
const REROLL = 'reroll-adjusted-seed', REJECT = 'reject-and-reframe';

// estimatedSeconds are per five-second 1024x576 shot.  Every number states
// where it came from; none is guessed.
//
// `fixes` must cover the failure-mode ids that quality-detectors.mjs actually
// emits (its FAILURE_MODES keys, snake_case) as well as the camelCase spellings
// callers use by hand.  Matching is case/separator-insensitive, so an id is
// only listed once per spelling that does not already normalise to another
// entry.  quality-gate.test.mjs asserts the two catalogues stay aligned: an
// unlisted mode escalates to a 1568 s re-roll, which is the expensive failure.
export const REPAIR_STRATEGIES = Object.freeze([
  { id: 'trim-to-best-window', label: 'Trim to the best window', fixes: ['terminal_detail_decay', 'detail_collapse', 'terminalDetailCollapse', 'tailDegradation', 'endFrameCorruption'], cost: 'cheap', method: 'ffmpeg-trim', preservesOriginal: true, stage: 1, estimatedSeconds: 2, basis: 'measured on this box, three runs: 1.671/1.875/2.022 s to re-encode the 110-frame trim window of VYREALM_ANIME_HERO_5S.mp4 (libx264 crf 18 preset medium)' },
  { id: 'deflicker', label: 'Deflicker pass', fixes: ['temporal_flicker', 'luminanceFlicker'], cost: 'cheap', method: 'ffmpeg-deflicker', preservesOriginal: true, stage: 2, estimatedSeconds: 3, basis: 'measured on this box, three runs: 2.822/2.361/2.771 s for deflicker=mode=pm:size=5 over all 121 frames of VYREALM_ANIME_HERO_5S.mp4' },
  { id: 'colour-stabilise', label: 'Colour stabilise', fixes: ['colour_drift', 'colour_oversaturation', 'colourDrift', 'oversaturation', 'chromaClipping'], cost: 'cheap', method: 'ffmpeg-eq-correction', preservesOriginal: true, stage: 3, estimatedSeconds: 2, basis: 'measured on this box, three runs: 1.743/1.749/2.063 s for an eq+hqdn3d pass over all 121 frames of VYREALM_ANIME_HERO_5S.mp4' },
  { id: 'rife-interpolate', label: 'RIFE frame interpolation', fixes: ['motion_roughness', 'motionStutter', 'lowMotionSmoothness', 'steppedCadence', 'duplicateFrames'], cost: 'moderate', method: 'rife-v4.6-ncnn-vulkan', preservesOriginal: true, stage: 4, estimatedSeconds: 105, basis: 'derived (314.336 / 3 = 104.8): the one measured RIFE job took 314.336 s to deliver three 5 s shots at 1920x1080/60 (docs/LOCAL_INTERPOLATION_2026-09-07.md)' },
  { id: 'realesrgan-upscale', label: 'Real-ESRGAN upscale', fixes: ['encode_blocking', 'softness', 'lowImagingQuality', 'blockiness'], cost: 'expensive', method: 'real-esrgan-x4', preservesOriginal: false, stage: 5, estimatedSeconds: 1078, basis: 'measured: 1077.676 s to enhance a 5 s 1024x576 source to 3840x2160 (docs/LOCAL_NEURAL_RESEARCH_2026-09-07.md)' },
  { id: REROLL, label: 'Re-roll with an adjusted seed and prompt', fixes: ['motion_stall', 'dead_footage', 'morphing_geometry', 'scene_drift', 'vae_chunk_seam', 'motionStall', 'subjectMorphing', 'identityDrift'], cost: 'expensive', method: 'wan2.2-ti2v-5b-regenerate', preservesOriginal: false, stage: 6, estimatedSeconds: 1568, basis: 'the project compute anchor of 1568 s for 121 frames at 1024x576 / 20 steps, taken from the brief and not re-measured here.  OPTIMISTIC: the three logged local runs were 1838.020/1716.804/1413.336 s (mean 1656.05), so a budget that only just clears 1568 s can still overrun' },
  { id: REJECT, label: 'Reject and reframe the shot spec', fixes: ['face_at_distance', 'garbled_text', 'off_bucket_resolution', 'promptInfeasible', 'motionStall', 'subjectMorphing', 'identityDrift'], cost: 'cheap', method: 'shot-spec-rewrite', preservesOriginal: false, stage: 7, estimatedSeconds: 0, basis: 'no GPU work: the shot spec is rewritten before anything is generated' },
].map(s => Object.freeze({ ...s, fixes: Object.freeze(s.fixes) })));

const BY_ID = new Map(REPAIR_STRATEGIES.map(s => [s.id, s]));
const key = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Everything that works on the delivered file.  Membership follows from the
// strategy, not from a stage number that drifts when one is inserted.
const POST_PASS = REPAIR_STRATEGIES.filter(s => s.id !== REROLL && s.id !== REJECT);
const REPAIRABLE = new Set(POST_PASS.flatMap(s => s.fixes.map(key)));
// Shot-spec defects.  A re-roll regenerates the same impossible spec and fails
// again, so these go straight to reframe whatever the budget says: a face
// narrower than one latent token and an off-bucket resolution are geometry, not
// luck (quality-detectors.mjs FAILURE_MODES, "Prevention only").
const REFRAME_ONLY = new Set(['face_at_distance', 'garbled_text', 'off_bucket_resolution', 'promptInfeasible'].map(key));
const FAILED = new Set(['fail', 'failed', 'failing', 'reject', 'rejected', 'critical']);
const PASSED = new Set(['pass', 'passed', 'ok', 'warn', 'warning']);
// Measured on the only shot with a per-frame series: in QC_ANIME_HERO_5S.json
// the last frame at or above the floor is index 109 of 121, i.e. 11 frames from
// the end.  Used only when no per-frame sharpness is supplied.
const TAIL_TRIM_FRAMES = 11;
// PROVISIONAL POLICY, not a measurement.  The detector's own fail threshold for
// terminal decay is minOverMedian 0.55; this floor is stricter because a trim
// costs 2 s.  On the measured shot it keeps frames 0-109 (4.583 s of 5.042 s);
// 0.75 would keep 112, 0.90 would keep 106.  Tune it against operator review.
const SHARPNESS_FLOOR = 0.85;
// PROVISIONAL POLICY: never hand back less than 60% of a shot.  Beyond that the
// edit is a different shot and the director should re-roll or reframe instead.
const MIN_KEPT_FRACTION = 0.6;

export function repairStrategy(id) {
  const strategy = BY_ID.get(String(id));
  if (!strategy) throw new Error(`QUALITY_GATE_UNKNOWN_STRATEGY: ${id}`);
  return strategy;
}

function normaliseVerdicts(verdicts) {
  if (verdicts == null) return [];
  const rows = Array.isArray(verdicts)
    ? verdicts
    : typeof verdicts === 'object'
      ? Object.entries(verdicts).map(([mode, v]) => (v && typeof v === 'object' ? { mode, ...v } : { mode, status: v }))
      : null;
  if (!rows) throw new Error('QUALITY_GATE_INVALID_VERDICTS');
  return rows.map(row => {
    if (!row || typeof row !== 'object') throw new Error('QUALITY_GATE_INVALID_VERDICTS');
    const mode = row.mode ?? row.id ?? row.failureMode ?? row.failureModeId;
    if (!mode) throw new Error('QUALITY_GATE_VERDICT_MODE_REQUIRED');
    const raw = String(row.status ?? row.verdict ?? '').toLowerCase();
    // An unrecognised status means "I do not know", and the unsafe direction is
    // to read that as pass and ship the shot.  Say so with a code instead.
    if (raw && !FAILED.has(raw) && !PASSED.has(raw)) throw new Error(`QUALITY_GATE_UNKNOWN_VERDICT_STATUS: ${raw}`);
    const severity = String(row.severity ?? '').toLowerCase();
    if (!raw && !severity && row.failed === undefined && row.passed === undefined) throw new Error(`QUALITY_GATE_VERDICT_STATUS_REQUIRED: ${mode}`);
    const failed = FAILED.has(raw) || severity === 'critical' || row.failed === true || row.passed === false;
    const status = raw || (failed ? 'fail' : 'pass');
    return {
      mode: String(mode), status, failed,
      severity: row.severity ?? null,
      metric: row.metric ?? null,
      value: Number.isFinite(Number(row.value)) ? Number(row.value) : null,
      threshold: Number.isFinite(Number(row.threshold)) ? Number(row.threshold) : null,
      comparison: row.comparison ?? null,
    };
  });
}

const strategiesFor = mode => POST_PASS.filter(s => s.fixes.some(f => key(f) === key(mode)));
const crossing = f => `${f.mode}${f.metric ? ` (${f.metric} ${f.value ?? 'unmeasured'} vs threshold ${f.threshold ?? 'unset'})` : f.value != null ? ` (${f.value} vs threshold ${f.threshold ?? 'unset'})` : ''}`;
// No budget at all means unbounded.  A budget that was supplied but cannot be
// read is an error, not unbounded: silently promoting a typo to Infinity is how
// a 1568 s re-roll gets approved against 300 s of GPU time.
const budgetSeconds = budget => {
  if (budget == null) return Infinity;
  const raw = typeof budget === 'number' ? budget : budget?.gpuSecondsRemaining ?? budget?.gpuSeconds ?? budget?.remainingSeconds;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`QUALITY_GATE_INVALID_BUDGET: expected a number or { gpuSecondsRemaining }, got ${JSON.stringify(budget)}`);
  return Math.max(0, n);
};
const say = seconds => (seconds === Infinity ? 'an unbounded' : `${seconds} s`);
const listScores = scores => Object.entries(scores || {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => `${k} ${Number(v)}`).join(', ');
const total = list => list.reduce((sum, s) => sum + s.estimatedSeconds, 0);

export function decideAction({ scores = {}, verdicts = [], budget } = {}) {
  if (scores && typeof scores !== 'object') throw new Error('QUALITY_GATE_INVALID_SCORES');
  const rows = normaliseVerdicts(verdicts);
  const failures = rows.filter(r => r.failed);
  const remaining = budgetSeconds(budget);
  const decide = (action, strategies, reasoning) => ({
    action, strategies: strategies.map(s => s.id), reasoning,
    estimatedCostSeconds: total(strategies),
    failures, budgetSecondsRemaining: remaining === Infinity ? null : remaining,
  });

  if (!failures.length) {
    const measured = listScores(scores);
    return decide('accept', [], `accept: no failure mode crossed its threshold${rows.length ? ` across ${rows.length} checked mode(s)` : ''}.${measured ? ` Scores: ${measured}.` : ''}`);
  }

  const named = failures.map(crossing).join('; ');
  // A shot-spec defect outranks everything: regenerating it reproduces it.
  const reframeOnly = failures.filter(f => REFRAME_ONLY.has(key(f.mode)));
  if (reframeOnly.length) {
    return decide('reject', [repairStrategy(REJECT)], `reject: ${named}. ${reframeOnly.map(f => f.mode).join(', ')} is a shot-spec defect that a re-roll would reproduce, so the spec is rewritten instead of spending GPU time.`);
  }

  // Catastrophic means a failing mode with no post-pass repair -- not a count.
  // Three cheap failures are still cheap: the measured VYREALM_ANIME_HERO_5S
  // shot fails terminal_detail_decay, colour_oversaturation and colour_drift at
  // once and is fully repaired for 4 s, and it is a shot the operator shipped.
  const unrepairable = failures.filter(f => !REPAIRABLE.has(key(f.mode)));
  if (unrepairable.length) {
    const reroll = repairStrategy(REROLL);
    if (remaining >= reroll.estimatedSeconds) {
      return decide('reroll', [reroll], `reroll: ${named}. No post-pass repair recovers ${unrepairable.map(f => f.mode).join(', ')}, and the ${reroll.estimatedSeconds} s re-roll fits ${say(remaining)} GPU budget.`);
    }
    return decide('reject', [repairStrategy(REJECT)], `reject: ${named}. A re-roll is the only fix and costs ${reroll.estimatedSeconds} s against ${say(remaining)} GPU budget left, so the shot is rejected for reframing instead.`);
  }

  const chosen = [];
  for (const failure of failures) for (const strategy of strategiesFor(failure.mode)) if (!chosen.includes(strategy)) chosen.push(strategy);
  chosen.sort((a, b) => a.stage - b.stage);
  let fitted = chosen.filter(s => s.estimatedSeconds <= remaining);
  let dropped = chosen.filter(s => !fitted.includes(s));
  while (total(fitted) > remaining && fitted.length) { dropped = [...dropped, fitted[fitted.length - 1]]; fitted = fitted.slice(0, -1); }
  if (!fitted.length) {
    return decide('reject', [repairStrategy(REJECT)], `reject: ${named}. Every repair for those modes (${chosen.map(s => s.id).join(', ')}) costs more than the ${say(remaining)} of GPU budget left.`);
  }
  const note = dropped.length ? ` Tight budget (${say(remaining)} left): dropped ${dropped.map(s => `${s.cost} ${s.id}`).join(', ')} and kept the cheaper repairs.` : '';
  return decide('repair', fitted, `repair: ${named}. Applying ${fitted.map(s => `${s.id} (${s.cost}, ${s.estimatedSeconds} s)`).join(' then ')}.${note}`);
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// ponytail: tail-only window.  Every measured Wan2.2 shot degrades at the end,
// never at the head; add head detection only when a measured shot shows it.
function trimWindow(metrics) {
  const perFrame = metrics?.sharpnessPerFrame || metrics?.laplacianVariancePerFrame || metrics?.perFrame?.sharpness;
  const frames = num(metrics?.frameCount) ?? num(metrics?.source?.frames) ?? (Array.isArray(perFrame) ? perFrame.length : null);
  const fps = num(metrics?.fps) ?? num(metrics?.source?.fps);
  if (!frames || frames < 4) return { parameters: { fps }, diagnostics: [{ code: 'METRICS_MISSING', message: 'frameCount or a per-frame sharpness series is required to pick a trim window.' }] };
  const floor = Math.max(2, Math.ceil(frames * MIN_KEPT_FRACTION));
  let endFrame = frames - 1 - TAIL_TRIM_FRAMES, basis = `fixed ${TAIL_TRIM_FRAMES}-frame tail trim; no per-frame sharpness supplied`;
  if (Array.isArray(perFrame) && perFrame.length >= 8 && perFrame.every(v => Number.isFinite(Number(v)))) {
    const values = perFrame.map(Number), limit = median(values) * SHARPNESS_FLOOR;
    let i = values.length - 1;
    while (i > 0 && values[i] < limit) i -= 1;
    endFrame = i; basis = `last frame at or above ${SHARPNESS_FLOOR} of the shot's median sharpness`;
  }
  endFrame = Math.max(floor - 1, Math.min(endFrame, frames - 1));
  const kept = endFrame + 1;
  return {
    parameters: { startFrame: 0, endFrame, keptFrames: kept, droppedFrames: frames - kept, fps, keptSeconds: fps ? Number((kept / fps).toFixed(3)) : null, basis },
    diagnostics: kept === frames ? [{ code: 'TRIM_NOT_NEEDED', message: 'The supplied sharpness series never falls below the floor, so the window keeps every frame.' }] : [],
  };
}

// `metrics` is either a flat bag or the probe JSON from quality-detectors.mjs,
// which nests the frame geometry under `source`.
function parametersFor(strategy, metrics) {
  const fps = num(metrics?.fps) ?? num(metrics?.source?.fps);
  const width = num(metrics?.width) ?? num(metrics?.source?.width);
  const height = num(metrics?.height) ?? num(metrics?.source?.height);
  if (strategy.id === 'trim-to-best-window') return trimWindow(metrics);
  // ponytail: fixed deflicker window.  The filter needs no measurement from us;
  // size it per shot only if a measured clip ever needs a different window.
  if (strategy.id === 'deflicker') return { parameters: { window: 5, ffmpegFilter: 'deflicker=mode=pm:size=5', flickerScore: num(metrics?.temporalFlicker?.vbenchFlickerScore) }, diagnostics: [] };
  if (strategy.id === 'colour-stabilise') {
    const start = num(metrics?.saturationStart) ?? num(metrics?.saturation?.start) ?? num(metrics?.saturationMean?.first);
    const end = num(metrics?.saturationEnd) ?? num(metrics?.saturation?.end) ?? num(metrics?.saturationMean?.last);
    // The current probe (quality-detectors.mjs) does NOT emit these: it reports
    // artefacts.saturationExtremeFrac and colourDrift.endMinusStart, neither of
    // which is a mean saturation.  Deriving a gain from channel deltas would be
    // a guess, so the step comes back not-ready and names what it needs.
    if (start === null || end === null || end === 0) return { parameters: { referenceFrame: 0 }, diagnostics: [{ code: 'METRICS_MISSING', message: 'saturationStart and saturationEnd (mean HSV S of the first and last frame) are required to size the colour correction; the probe does not emit them yet.' }] };
    // ponytail: constant gain back to the opening frame.  A per-frame ramp is
    // the upgrade if a measured shot ever drifts non-linearly.
    const correction = Number((start / end).toFixed(3));
    return { parameters: { referenceFrame: 0, saturationStart: start, saturationEnd: end, correction, clippedFraction: num(metrics?.clippedFraction), ffmpegFilter: `eq=saturation=${correction}` }, diagnostics: [] };
  }
  if (strategy.id === 'rife-interpolate') {
    if (!fps) return { parameters: { model: 'rife-v4.6' }, diagnostics: [{ code: 'METRICS_MISSING', message: 'fps is required to set the interpolation target.' }] };
    return { parameters: { model: 'rife-v4.6', factor: 2, sourceFps: fps, targetFps: fps * 2 }, diagnostics: [] };
  }
  if (strategy.id === 'realesrgan-upscale') {
    if (!width || !height) return { parameters: { model: 'realesrgan-x4plus' }, diagnostics: [{ code: 'METRICS_MISSING', message: 'width and height are required to size the upscale.' }] };
    const scale = width >= 1280 ? 2 : 4;
    return { parameters: { model: 'realesrgan-x4plus', scale, sourceWidth: width, sourceHeight: height, targetWidth: width * scale, targetHeight: height * scale }, diagnostics: [] };
  }
  // 20 steps is the step count the 1568 s anchor was measured at, not a taste choice.
  if (strategy.id === REROLL) return { parameters: { seedOffset: 1, steps: num(metrics?.steps) ?? 20, frames: num(metrics?.frameCount) ?? num(metrics?.source?.frames), promptAdjustments: ['single subject', 'one verb of action', 'named light source'] }, diagnostics: [] };
  return { parameters: { reason: 'no post-pass repair recovers the failing modes' }, diagnostics: [] };
}

export function planShotRepair({ metrics = {}, scores = {}, verdicts = [] } = {}) {
  if (metrics && typeof metrics !== 'object') throw new Error('QUALITY_GATE_INVALID_METRICS');
  const failures = normaliseVerdicts(verdicts).filter(r => r.failed);
  const steps = [];
  for (const failure of failures) {
    const matches = strategiesFor(failure.mode);
    // Fall back the same way decideAction does, or the plan contradicts the
    // decision: a shot-spec defect is reframed, everything else re-rolled.
    const fallback = REFRAME_ONLY.has(key(failure.mode)) ? REJECT : REROLL;
    for (const strategy of (matches.length ? matches : [repairStrategy(fallback)])) {
      const existing = steps.find(step => step.strategy === strategy.id);
      if (existing) { if (!existing.fixes.includes(failure.mode)) existing.fixes.push(failure.mode); continue; }
      const { parameters, diagnostics } = parametersFor(strategy, metrics);
      steps.push({ strategy: strategy.id, label: strategy.label, method: strategy.method, cost: strategy.cost, preservesOriginal: strategy.preservesOriginal, estimatedSeconds: strategy.estimatedSeconds, stage: strategy.stage, fixes: [failure.mode], parameters, diagnostics, ready: diagnostics.length === 0 });
    }
  }
  steps.sort((a, b) => a.stage - b.stage);
  return steps.map((step, index) => ({ order: index + 1, ...step, scoresAtPlanning: { ...scores } }));
}

export function gateEvidence({ decision, scores = {}, thresholds = {}, now = Date.now() } = {}) {
  if (!decision || typeof decision !== 'object') throw new Error('QUALITY_GATE_DECISION_REQUIRED');
  if (!['accept', 'repair', 'reroll', 'reject'].includes(decision.action)) throw new Error(`QUALITY_GATE_INVALID_ACTION: ${decision.action}`);
  if (!Array.isArray(decision.strategies)) throw new Error('QUALITY_GATE_INVALID_STRATEGIES');
  const strategies = decision.strategies.map(id => repairStrategy(id));
  const failures = (decision.failures || []).map(f => ({ ...f, threshold: f.threshold ?? num(thresholds?.[f.metric]) ?? num(thresholds?.[f.mode]) }));
  return {
    schemaVersion: 1,
    action: decision.action,
    reasoning: decision.reasoning ?? null,
    strategies: strategies.map(s => ({ id: s.id, label: s.label, cost: s.cost, method: s.method, preservesOriginal: s.preservesOriginal, estimatedSeconds: s.estimatedSeconds, basis: s.basis })),
    estimatedCostSeconds: decision.estimatedCostSeconds ?? total(strategies),
    budgetSecondsRemaining: decision.budgetSecondsRemaining ?? null,
    failureModes: failures.map(f => f.mode),
    thresholdsCrossed: failures.map(f => ({ mode: f.mode, metric: f.metric, value: f.value, threshold: f.threshold ?? null, comparison: f.comparison })),
    scores: { ...scores },
    thresholds: { ...thresholds },
    recordedAt: new Date(now).toISOString(),
    unmeasured: ['subject performance', 'prompt adherence', 'audience taste'],
  };
}
