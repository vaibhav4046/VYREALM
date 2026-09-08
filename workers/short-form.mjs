import { advanceProductionRun } from '../runtime/short-form-production.mjs';

/** In-process durable-job worker. The server supplies its canonical run store
 * and per-run lock; this is not a separate provider CLI or hidden GPU process.
 * Invoke on creation, job completion, or exact-hash review completion. */
export function createShortFormWorker(host) {
  if (typeof host?.loadRun !== 'function' || typeof host?.withRunLock !== 'function') throw new Error('PRODUCTION_HOST_REQUIRED: loadRun and withRunLock must use the canonical store');
  return async function tick(runId) {
    return host.withRunLock(runId, async () => {
      let state = await host.loadRun(runId);
      if (!state || state.id !== runId) throw new Error('PRODUCTION_RUN_NOT_FOUND');
      // Complete a stage and enqueue its successor, without polling, sleeping,
      // holding a lock through inference, or creating an unbounded retry loop.
      for (let step = 0; step < 3; step++) {
        const prior = JSON.stringify(state);
        state = await advanceProductionRun(state, host);
        if (state.status !== 'ready' || JSON.stringify(state) === prior) break;
      }
      return state;
    });
  };
}
