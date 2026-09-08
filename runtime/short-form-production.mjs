import { createHash, randomUUID } from 'node:crypto';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, name, maximum) => { if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('PRODUCTION_INPUT', `${name} is required`); return value.trim(); };
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const terminalFailure = new Set(['failed', 'blocked', 'cancelled', 'rejected']);

/** Durable fresh-footage workflow. The host owns SQLite, GPU scheduling and
 * actual providers through adapters; this module cannot bypass those gates. */
export function createProductionRun({ projectId, expectedRevision, brief, format = 'short', durationSeconds = 30, shots, firstKeyframe = null, runId = randomUUID(), now = new Date().toISOString() } = {}) {
  text(projectId, 'projectId', 200); text(brief, 'brief', 6000);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !['short', 'trailer'].includes(format)) fail('PRODUCTION_INPUT', 'A saved revision and short/trailer format are required');
  const maximum = format === 'short' ? 30 : 180;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 20 || durationSeconds > maximum || durationSeconds % 5 || !Array.isArray(shots) || shots.length !== durationSeconds / 5) fail('PRODUCTION_DURATION', 'Use distinct five-second shots totaling the requested 20–30 second Short or up to 180 second trailer');
  const seen = new Set();
  const normalized = shots.map((shot, index) => {
    const id = text(shot.id, 'shot id', 80);
    if (seen.has(id)) fail('PRODUCTION_SHOT_ID', 'Shot IDs must be unique'); seen.add(id);
    if (!Number.isSafeInteger(shot.seed) || shot.seed < 0) fail('PRODUCTION_SEED', 'Each shot needs a stable seed');
    const prompt = text(shot.prompt, 'shot prompt', 6000), narration = text(shot.narration, 'shot narration', 250);
    if (narration.split(/\s+/).length > 14) fail('PRODUCTION_NARRATION', 'Keep each five-second narration cue under fifteen words; actual speech fit is checked by Piper');
    return { id, prompt, negativePrompt: String(shot.negativePrompt || '').slice(0, 3000), narration, seed: shot.seed, durationSeconds: 5, start: index * 5 };
  });
  const request = { projectId, brief, format, durationSeconds, shots: normalized };
  if (firstKeyframe && (firstKeyframe.shotId !== normalized[0].id || typeof firstKeyframe.jobId !== 'string' || !firstKeyframe.jobId)) fail('PRODUCTION_FIRST_KEYFRAME', 'An adopted keyframe must identify the first shot and a durable job');
  return { schemaVersion: 1, id: text(runId, 'run id', 200), ...request, requestHash: hash(request), expectedRevision,
    sourceMode: 'fresh-generation', continuityStatus: 'requires-cross-shot-visual-review', stage: 'keyframe', shotIndex: 0, status: firstKeyframe ? 'running' : 'ready',
    pending: firstKeyframe ? { jobId: firstKeyframe.jobId, stage: 'keyframe', adopted: true, queuedAt: null } : null,
    completedShots: [], jobs: [], createdAt: now, updatedAt: now, timings: { keyframeMs: 0, motionMs: 0, audioMs: 0, assemblyMs: 0, missingExecutionTimings: [] }, events: [] };
}

function requestFor(state) {
  const shot = state.shots[state.shotIndex];
  const common = { runId: state.id, projectId: state.projectId, expectedRevision: state.expectedRevision,
    idempotencyKey: `${state.id}:${state.stage}:${shot?.id || 'film'}` };
  if (state.stage === 'keyframe') return { ...common, shotId: shot.id, prompt: shot.prompt, negativePrompt: shot.negativePrompt, seed: shot.seed };
  if (state.stage === 'motion') return { ...common, shotId: shot.id, prompt: shot.prompt, seed: shot.seed, durationSeconds: 5,
    referenceJobId: state.reference.jobId, referenceHash: state.reference.outputHash };
  if (state.stage === 'audio') return { ...common, durationSeconds: state.durationSeconds,
    text: state.shots.map(shot => shot.narration).join(' '), cues: state.shots.map(shot => ({ start: shot.start, end: shot.start + 5, text: shot.narration })),
    brief: state.brief, shots: state.completedShots };
  if (state.stage === 'render') return { ...common, durationSeconds: state.durationSeconds, width: state.format === 'short' ? 1080 : 1920,
    height: state.format === 'short' ? 1920 : 1080, fps: 24, shots: state.completedShots, audioJobId: state.audio.jobId,
    audioHash: state.audio.outputHash, captionsFromSpeech: true, allowExtension: false };
  fail('PRODUCTION_STAGE', 'Unknown production stage');
}

/** Advance once under the host's run lock. REQUIRED host guarantees:
 * - saveRun persists before acknowledgement; queue methods deduplicate keys.
 * - inspectJob verifies project ownership; verifyReview checks durable review,
 *   exact output bytes and registered asset, using existing review gates.
 * - queues preserve revision conflicts and the single-GPU lease.
 * A crash after enqueue but before save retries the SAME idempotency key.
 */
export async function advanceProductionRun(input, adapters, { now = new Date().toISOString() } = {}) {
  if (input?.schemaVersion !== 1 || input.sourceMode !== 'fresh-generation') fail('PRODUCTION_STATE', 'A fresh production run is required');
  for (const key of ['saveRun', 'inspectJob', 'verifyReview']) if (typeof adapters?.[key] !== 'function') fail('PRODUCTION_ADAPTER', `${key} adapter is required`);
  const state = structuredClone(input);
  if (['completed', 'failed', 'rejected', 'cancelled'].includes(state.status)) return state;
  const save = async (event, details = {}) => { state.updatedAt = now; state.events.push({ at: now, event, ...details }); await adapters.saveRun(state); return state; };
  if (!state.pending) {
    const request = requestFor(state), method = { keyframe: 'queueKeyframe', motion: 'queueMotion', audio: 'queueAudio', render: 'queueRender' }[state.stage];
    if (typeof adapters[method] !== 'function') fail('PRODUCTION_ADAPTER', `${method} adapter is not connected`);
    // Persist the queue intent first. Do not swallow revision/GPU/provider errors.
    state.status = 'queuing'; await save('queue-intent', { stage: state.stage, key: request.idempotencyKey });
    const job = await adapters[method](request);
    if (!job?.jobId) fail('PRODUCTION_JOB', 'Queue adapter did not return a durable job ID');
    state.pending = { jobId: job.jobId, stage: state.stage, idempotencyKey: request.idempotencyKey, queuedAt: now };
    if (Number.isSafeInteger(job.revision)) state.expectedRevision = job.revision;
    state.status = 'running'; return save('job-queued', { jobId: job.jobId, stage: state.stage });
  }
  const job = await adapters.inspectJob({ projectId: state.projectId, jobId: state.pending.jobId });
  if (!job || job.jobId !== state.pending.jobId || job.projectId !== state.projectId) fail('PRODUCTION_JOB_OWNERSHIP', 'The inspected job does not belong to this run and project');
  if (terminalFailure.has(job.status)) { state.status = job.status === 'rejected' ? 'rejected' : 'failed'; state.diagnostic = job.diagnostic || job.status; return save('job-stopped', { jobId: job.jobId, status: job.status }); }
  if (!['succeeded', 'review_required'].includes(job.status)) return state;
  if (!validHash(job.outputHash)) fail('PRODUCTION_OUTPUT_HASH', 'A completed stage must have an exact output hash');
  // All visual media pauses for real review; an automated technical pass is not acceptance.
  if (['keyframe', 'motion', 'render'].includes(state.stage)) {
    const review = await adapters.verifyReview({ projectId: state.projectId, jobId: job.jobId, expectedOutputHash: job.outputHash, stage: state.stage });
    if (review?.verdict === 'rejected') { state.status = 'rejected'; return save('visual-rejected', { jobId: job.jobId, outputHash: job.outputHash }); }
    if (review?.verdict !== 'passed' || review.outputHash !== job.outputHash) {
      if (state.status === 'review-required' && state.reviewTarget?.outputHash === job.outputHash) return state;
      state.status = 'review-required'; state.reviewTarget = { jobId: job.jobId, outputHash: job.outputHash, stage: state.stage };
      return save('visual-review-required', state.reviewTarget);
    }
  }
  const entry = { jobId: job.jobId, outputHash: job.outputHash, stage: state.stage, assetId: job.assetId || null, executionMs: Number.isFinite(job.executionMs) && job.executionMs >= 0 ? job.executionMs : null };
  if (entry.executionMs === null) state.timings.missingExecutionTimings.push(job.jobId);
  else state.timings[{ keyframe: 'keyframeMs', motion: 'motionMs', audio: 'audioMs', render: 'assemblyMs' }[state.stage]] += entry.executionMs;
  state.jobs.push(entry); state.pending = null; delete state.reviewTarget;
  if (Number.isSafeInteger(job.revision)) state.expectedRevision = job.revision;
  if (state.stage === 'keyframe') { state.reference = entry; state.stage = 'motion'; }
  else if (state.stage === 'motion') {
    if (!job.assetId || job.durationSeconds !== 5) fail('PRODUCTION_MOTION_DURATION', 'The motion stage must provide a registered five-second clip');
    state.completedShots.push({ ...entry, shotId: state.shots[state.shotIndex].id, durationSeconds: 5, reference: state.reference });
    state.shotIndex++; delete state.reference;
    state.stage = state.shotIndex < state.shots.length ? 'keyframe' : 'audio';
  } else if (state.stage === 'audio') { state.audio = entry; state.stage = 'render'; }
  else { state.output = entry; state.status = 'completed'; return save('production-completed', { outputHash: job.outputHash }); }
  state.status = 'ready'; return save('stage-completed', { jobId: job.jobId, nextStage: state.stage });
}
