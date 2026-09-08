/**
 * Render a plan, then measure what came out of it.
 *
 * This module owns no rendering, no probing and no scoring of its own. It is
 * the seam between four modules that already work:
 *
 *   format-render.mjs     renderPlan   -> the mp4 and its receipt
 *   quality-detectors.mjs probeVideo   -> pixel metrics OF THE RENDERED FILE
 *   quality-detectors.mjs scoreVideo   -> named verdicts against thresholds
 *   quality-gate.mjs      decideAction -> accept / repair / reroll / reject
 *
 * The point of the seam: the metrics are read off the DELIVERED file, not off
 * the source shots. A clip that was clean before compositing can pick up
 * blocking from the concat re-encode or lose its tail to a time extension, and
 * a score taken upstream would never see it.
 *
 * Scoring is best-effort by construction. A missing python, a broken probe or a
 * metric the probe stopped emitting must NOT turn a finished video into a
 * failure: the render is the deliverable, the score is the claim about it. When
 * the claim cannot be made, this returns scores: null plus a diagnostic that
 * says so in words, and the caller still gets the video.
 */

import {
  DEFAULT_PROBE_SCRIPT,
  DEFAULT_PYTHON,
  DEFAULT_THRESHOLDS,
  probeVideo,
  qualityEvidence,
  scoreVideo,
} from './quality-detectors.mjs';
import { decideAction, gateEvidence } from './quality-gate.mjs';
import { renderPlan } from './format-render.mjs';

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const round4 = n => Math.round(n * 1e4) / 1e4;

/**
 * scoreVideo's per-mode reasons already carry metric, value and both threshold
 * numbers; decideAction accepts exactly that shape. Passing the rich rows
 * rather than a bare {mode: 'fail'} map is what puts the crossing numbers into
 * the decision's own reasoning string, so the decision explains itself.
 */
const verdictRows = scores => Object.values(scores.reasons).map(r => ({
  mode: r.modeId,
  status: r.verdict,
  metric: r.metric,
  value: r.value,
  // The fail line is the one that produced a 'fail' status; the warn line is
  // recorded alongside it in the quality evidence.
  threshold: r.fail,
  comparison: r.better === 'higher' ? '>=' : '<=',
}));

/**
 * Render one plan and score the file it produced.
 *
 * `renderFn` / `probeFn` / `scoreFn` exist so the composition can be tested
 * without a GPU, an FFmpeg or a python: they default to the real modules and
 * nothing else in the codebase overrides them.
 *
 * Returns { render, metrics, scores, verdicts, decision, evidence, scored,
 * thresholds, diagnostics }. A render failure throws -- there is nothing to
 * score and nothing to ship. A SCORING failure does not.
 */
export async function renderAndScore({
  plan,
  shotLibrary,
  output,
  workDir,
  captionText = null,
  audioSources = null,
  allowExtension = false,
  thresholds = DEFAULT_THRESHOLDS,
  python = DEFAULT_PYTHON,
  probeScript = DEFAULT_PROBE_SCRIPT,
  skipScoring = false,
  budget,
  renderFn = renderPlan,
  probeFn = probeVideo,
  scoreFn = scoreVideo,
} = {}) {
  const render = await renderFn({ plan, shotLibrary, output, workDir, allowExtension, captionText, audioSources });
  if (!render?.output) throw fail('RENDER_RECEIPT_INVALID', 'renderPlan returned no output path; there is no file to score');

  const result = {
    schemaVersion: 1,
    render,
    metrics: null,
    scores: null,
    verdicts: null,
    decision: null,
    thresholds,
    scored: false,
    // Wall clock for the probe and the scoring, measured rather than estimated:
    // this is the price of the guarantee, and a caller deciding whether to
    // enable scoring on a hundred-video batch needs the real number.
    scoreMs: null,
    diagnostics: [],
    evidence: null,
  };

  if (skipScoring) {
    result.diagnostics.push({
      code: 'SCORING_SKIPPED',
      stage: 'probe',
      message: 'Scoring was not requested (skipScoring), so this video is delivered unmeasured. The render receipt stands; no quality claim is made about it.',
    });
    result.evidence = scoredEvidence(result);
    return result;
  }

  const started = Date.now();
  try {
    result.metrics = await probeFn(render.output, { python, script: probeScript });
    const scores = scoreFn(result.metrics, thresholds);
    result.scores = scores;
    result.verdicts = scores.verdicts;
    result.decision = decideAction({ scores: scores.scores, verdicts: verdictRows(scores), budget });
    result.scored = true;
  } catch (error) {
    // Deliberately swallowed: a working video with no score beats no video.
    // The failure is recorded in words rather than dropped, so a reader can
    // tell "this passed" from "nobody looked".
    result.diagnostics.push({
      code: 'SCORING_UNAVAILABLE',
      // Which half broke: the probe never ran, or it ran and the scoring of
      // its output did. They have different fixes.
      stage: result.metrics ? 'score' : 'probe',
      message: `The video rendered; scoring did not run, so no quality claim is made about it. ${error?.code ? `${error.code}: ` : ''}${String(error?.message ?? error).slice(0, 600)}`,
    });
  }
  result.scoreMs = Date.now() - started;

  result.evidence = scoredEvidence(result);
  return result;
}

/**
 * Aggregate a batch. `worstModes` counts NON-PASSING verdicts (fail and warn)
 * per failure mode across the scored videos, which is the number a reader
 * actually wants: which defect keeps coming back. It is deliberately not
 * scores.worst, whose fallback names the weakest mode even on a clean clip and
 * would report a defect where there is none.
 */
export function summariseBatch(results) {
  if (!Array.isArray(results)) throw fail('BATCH_INPUT_INVALID', 'summariseBatch needs an array of renderAndScore results');

  const scored = results.filter(r => r?.scored && r.scores);
  const worstModes = {};
  const decisions = {};
  for (const r of scored) {
    for (const [mode, verdict] of Object.entries(r.scores.verdicts ?? {})) {
      if (verdict === 'pass') continue;
      worstModes[mode] = (worstModes[mode] ?? 0) + 1;
    }
  }
  for (const r of results) {
    const action = r?.decision?.action;
    if (action) decisions[action] = (decisions[action] ?? 0) + 1;
  }

  return {
    count: results.length,
    scored: scored.length,
    unscored: results.length - scored.length,
    // null, not 0: an unmeasured batch has no mean, and 0 would read as "every
    // video scored zero", which is the opposite of what happened.
    meanOverall: scored.length
      ? round4(scored.reduce((sum, r) => sum + r.scores.overall, 0) / scored.length)
      : null,
    worstModes: Object.fromEntries(
      Object.entries(worstModes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    ),
    decisions,
  };
}

/**
 * The auditable record for one scored video: what was rendered, what was
 * measured on it, what verdict each measurement produced, what was decided, and
 * the thresholds that produced the verdicts. The thresholds are the part that
 * makes it auditable -- a verdict without its cut point is an opinion.
 *
 * The raw probe metrics are NOT embedded. They carry per-frame arrays running
 * to megabytes per clip; the values that drove each verdict are in
 * quality.modes[].value with their thresholds beside them, which is what a
 * reader needs to check the call.
 */
export function scoredEvidence(result) {
  if (!result?.render?.output) throw fail('EVIDENCE_INPUT_INVALID', 'scoredEvidence needs a renderAndScore result with a render receipt');
  const thresholds = result.thresholds ?? DEFAULT_THRESHOLDS;
  return {
    schemaVersion: 1,
    kind: 'vyrealm.scored-render.evidence',
    generatedAt: new Date().toISOString(),
    output: result.render.output,
    scored: Boolean(result.scored && result.scores),
    render: result.render,
    quality: result.scores && result.metrics
      ? qualityEvidence({ path: result.render.output, metrics: result.metrics, scores: result.scores })
      : null,
    gate: result.decision
      ? gateEvidence({ decision: result.decision, scores: result.scores.scores, thresholds })
      : null,
    // Repeated at the top level on purpose: an unscored video has no gate
    // section, and a reader still needs to see which bar it was going to be
    // held to.
    thresholds,
    diagnostics: result.diagnostics ?? [],
    caveat: 'The score measures the DELIVERED file, including compositing and encoding, not the source shots. Thresholds are provisional and calibrated on two locally generated clips; each mode carries its own calibratedOn and confidence.',
  };
}
