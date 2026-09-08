// Admission only: this module never starts, changes, cancels or retries a job.
// A GPU lease does not account for CPU offload/RAM used by neural generation.
export const ACTIVE_NEURAL_JOB_TYPES = Object.freeze([
  'generation-keyframe', 'generation-shot', 'generation-test', 'ltx-qualification',
]);
export const ACTIVE_HEAVY_JOB_STATUSES = Object.freeze([
  'queued', 'running', 'staging', 'validating', 'cancelling',
]);

export function listActiveNeuralJobs(db) {
  const types = ACTIVE_NEURAL_JOB_TYPES.map(() => '?').join(',');
  const statuses = ACTIVE_HEAVY_JOB_STATUSES.map(() => '?').join(',');
  return db.prepare(`SELECT id AS jobId, project_id AS projectId, type, status FROM jobs WHERE type IN (${types}) AND status IN (${statuses}) ORDER BY created_at ASC, id ASC`)
    .all(...ACTIVE_NEURAL_JOB_TYPES, ...ACTIVE_HEAVY_JOB_STATUSES)
    .map(row => ({ jobId: row.jobId, projectId: row.projectId, type: row.type, status: row.status }));
}

export function assertNoActiveNeuralJobs(db, { operation = 'Heavy local work' } = {}) {
  const blockingJobs = listActiveNeuralJobs(db);
  if (!blockingJobs.length) return;
  const first = blockingJobs[0];
  const label = typeof operation === 'string' && operation.length <= 100 ? operation : 'Heavy local work';
  throw Object.assign(new Error(`${label} must wait for neural job ${first.jobId} (${first.type}, ${first.status}) to finish or be cancelled. Editing, saving and playback remain available.`), {
    code: 'HEAVY_WORK_BUSY', jobId: first.jobId, jobType: first.type, blockingJobs,
  });
}
