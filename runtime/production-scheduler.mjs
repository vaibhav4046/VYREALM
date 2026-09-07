/**
 * Produce several videos at once, correctly, on ONE GPU.
 *
 * The honest engineering, and the reason this module exists:
 *
 *   - Neural sampling SERIALISES. One process holds the card. On this box a
 *     Wan2.2 TI2V-5B Q4 run peaks at 5.85 GiB of a 6 GB card, so a second
 *     sampler does not fit, and on any single-GPU machine a second sampler
 *     would only time-slice the same silicon. runtime/inference-harness.mjs
 *     enforces that with an OS-backed exclusive lease.
 *   - FFmpeg composites are CPU-bound. They never touch the lease and run
 *     BESIDE the sampler.
 *
 * So several videos are in flight concurrently even though only one is ever
 * sampling. This module schedules exactly that shape, measures what it
 * actually achieved from real timestamps, and refuses to guess at a cost it
 * has not been given.
 *
 * It EXTENDS runtime/hardware-profile.mjs: tiers are derived from
 * HARDWARE_PROFILES rather than redefined here, so a profile that blocks the
 * neural-video route gets zero neural slots and says so.
 */

import os from 'node:os';
import { HARDWARE_PROFILES } from './hardware-profile.mjs';

const NEURAL_ROUTE = 'neural-video';
const KINDS = Object.freeze(['neural', 'composite']);

function coded(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}

// Strict on purpose. Number(null), Number(''), Number(false) and Number([]) are
// all 0, so a permissive Number() check turns a MISSING value into a confident
// zero - which is exactly how a SQLite NULL estimate becomes a fabricated
// "0 ms" cost. Only a real number, or a non-empty string that parses as one,
// counts as a number here; everything else is absent and must be refused
// upstream rather than defaulted.
const finite = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const round = value => Math.round(value * 1000) / 1000;

/* ------------------------------------------------------------------ *
 * Measured costs.  Every number below traces to a real run on this
 * machine (RTX 3050 Laptop 6 GB VRAM, 16 GB RAM, 12-core i5-12450HX).
 * Nothing here is projected; anything derived says so in its basis.
 * ------------------------------------------------------------------ */

export const MEASURED_NEURAL_RUNS = Object.freeze({
  'Wan2.2-TI2V-5B-Q4_K_M.gguf': Object.freeze({
    id: 'wan2.2-ti2v-5b-q4',
    frames: 121,
    width: 1024,
    height: 576,
    totalMs: 1568000,
    peakVramGiB: 5.85,
    basis: 'measured on this box: 121 frames at 1024x576 in 1568 s (~13.0 s/frame), peak 5.85 GiB VRAM. OPTIMISTIC: runtime/quality-gate.mjs records three logged local runs of the same anchor at 1838.020/1716.804/1413.336 s (mean 1656.05 s), so pass safetyFactor > 1 for a budget that must not overrun.'
  }),
  'ltxv-2b-0.9.8-distilled-q8_0.gguf': Object.freeze({
    id: 'ltx-2b-distilled-q8',
    frames: 97,
    width: 768,
    height: 512,
    totalMs: 196000,
    steps: 8,
    cfg: 1.0,
    basis: 'measured on this box: 97 frames at 768x512 in 196 s (~2.0 s/frame), 8 steps, cfg 1.0; the model fits entirely in 6 GB VRAM.'
  })
});

export const MEASURED_COMPOSITE = Object.freeze({
  outputSeconds: 15,
  width: 1080,
  height: 1920,
  totalMs: 11000,
  basis: 'measured on this box: FFmpeg composite render of a 15 s 1080x1920 cut in ~11 s, CPU only.'
});

// Short ids resolve to the same record as the installed filename.
const NEURAL_BY_KEY = new Map();
for (const [file, run] of Object.entries(MEASURED_NEURAL_RUNS)) {
  NEURAL_BY_KEY.set(file, { ...run, file });
  NEURAL_BY_KEY.set(run.id, { ...run, file });
}

/* ------------------------------------------------------------------ *
 * Tiers
 * ------------------------------------------------------------------ */

// POLICY, NOT A MEASUREMENT.  One FFmpeg process is already multi-threaded, so
// running one composite per core thrashes rather than scales; the 11 s measured
// composite was a single process on an otherwise idle box.  These caps are a
// deliberately conservative starting point - measure your own mix and pass
// compositeConcurrency to override.
const COMPOSITE_CAP = Object.freeze({
  RENDER_ONLY: 2,
  LOW_VRAM_LOCAL: 2,
  STANDARD_LOCAL: 4,
  CREATOR_LOCAL: 6
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Build a scheduler tier from a hardware profile id (or a profile object from
 * classifyHardware/detectHardware).  Neural concurrency is 1 wherever the
 * profile allows neural video at all, and 0 where it does not: one GPU is one
 * sampler, whatever the card.  Both limits are overridable knobs.
 */
export function schedulerTier(profile, { cpus = os.cpus().length, compositeConcurrency, neuralConcurrency } = {}) {
  const id = typeof profile === 'string' ? profile : profile?.id;
  const known = HARDWARE_PROFILES[id];
  if (!known) throw coded('SCHEDULER_TIER_UNKNOWN_PROFILE', String(id ?? 'undefined'));
  const blocked = (profile?.blockedRoutes ?? known.blockedRoutes).includes(NEURAL_ROUTE);
  // Policy formula: roughly one composite per three cores, capped per profile.
  const cap = COMPOSITE_CAP[id] ?? 2;
  const composite = compositeConcurrency ?? clamp(Math.round((finite(cpus) ?? 1) / 3), 1, cap);
  const neural = neuralConcurrency ?? (blocked ? 0 : 1);
  return normaliseTier({
    id,
    label: known.label,
    neuralConcurrency: neural,
    compositeConcurrency: composite,
    basis: `neuralConcurrency ${neural}: ${blocked ? `profile ${id} blocks the ${NEURAL_ROUTE} route` : 'one GPU samples one job at a time (measured: Wan2.2 TI2V-5B Q4 peaks at 5.85 GiB of this 6 GB card)'}. compositeConcurrency ${composite}: POLICY (UNVERIFIED) from ${cpus} logical cores, capped at ${cap} for profile ${id}; FFmpeg is already multi-threaded.`
  });
}

function normaliseTier(tier) {
  if (typeof tier === 'string') return schedulerTier(tier);
  if (!tier || typeof tier !== 'object') throw coded('SCHEDULER_TIER_REQUIRED', 'pass a tier object or a hardware profile id');
  const neural = finite(tier.neuralConcurrency);
  const composite = finite(tier.compositeConcurrency);
  if (neural === null || neural < 0 || !Number.isInteger(neural)) throw coded('SCHEDULER_TIER_INVALID', `neuralConcurrency must be a non-negative integer, got ${tier.neuralConcurrency}`);
  if (composite === null || composite < 1 || !Number.isInteger(composite)) throw coded('SCHEDULER_TIER_INVALID', `compositeConcurrency must be a positive integer, got ${tier.compositeConcurrency}`);
  return Object.freeze({
    id: tier.id ?? 'custom',
    label: tier.label ?? tier.id ?? 'custom tier',
    neuralConcurrency: neural,
    compositeConcurrency: composite,
    basis: tier.basis ?? 'caller-supplied tier'
  });
}

/* ------------------------------------------------------------------ *
 * Cost estimation
 * ------------------------------------------------------------------ */

/** Resolve one job's projected cost, or refuse to invent one. */
export function estimateJobMs(job) {
  const given = finite(job?.estimatedMs);
  if (given !== null) {
    if (given < 0) throw coded('SCHEDULER_ESTIMATE_NEGATIVE', String(job.id));
    return { ms: given, basis: 'caller-supplied estimatedMs' };
  }
  if (job?.kind === 'neural') {
    const run = NEURAL_BY_KEY.get(String(job.model ?? ''));
    const frames = finite(job.frames);
    if (!run || frames === null) {
      throw coded('SCHEDULER_ESTIMATE_UNKNOWN_COST', `job ${job?.id}: supply estimatedMs, or model (one of ${Object.keys(MEASURED_NEURAL_RUNS).join(', ')}) plus frames`);
    }
    const perFrame = run.totalMs / run.frames;
    const offSpec = (finite(job.width) ?? run.width) !== run.width || (finite(job.height) ?? run.height) !== run.height;
    return {
      ms: frames * perFrame,
      basis: `${run.basis}${offSpec ? ` EXTRAPOLATED: requested ${job.width}x${job.height} differs from the measured ${run.width}x${run.height}; per-frame cost at another resolution is UNVERIFIED.` : ''}`
    };
  }
  if (job?.kind === 'composite') {
    const seconds = finite(job.seconds);
    if (seconds === null) throw coded('SCHEDULER_ESTIMATE_UNKNOWN_COST', `job ${job?.id}: supply estimatedMs or seconds`);
    const perSecond = MEASURED_COMPOSITE.totalMs / MEASURED_COMPOSITE.outputSeconds;
    const offSpec = seconds !== MEASURED_COMPOSITE.outputSeconds
      || (finite(job.width) ?? MEASURED_COMPOSITE.width) !== MEASURED_COMPOSITE.width
      || (finite(job.height) ?? MEASURED_COMPOSITE.height) !== MEASURED_COMPOSITE.height;
    return {
      ms: seconds * perSecond,
      basis: `${MEASURED_COMPOSITE.basis}${offSpec ? ' EXTRAPOLATED: scaled linearly with output seconds from that single measurement; other lengths and canvases are UNVERIFIED.' : ''}`
    };
  }
  throw coded('SCHEDULER_JOB_KIND_INVALID', `job ${job?.id}: kind must be one of ${KINDS.join(', ')}`);
}

// Greedy earliest-free-slot in priority order: the same thing the worker pool
// below actually does once durations are known, so the projection and the run
// share one policy rather than two that drift.
function laneFinishMs(costsInOrder, slots) {
  if (!costsInOrder.length) return 0;
  const free = new Array(slots).fill(0);
  for (const ms of costsInOrder) {
    let pick = 0;
    for (let i = 1; i < slots; i++) if (free[i] < free[pick]) pick = i;
    free[pick] += ms;
  }
  return Math.max(...free);
}

const byPriority = (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.seq - b.seq;

/**
 * Projected wall clock for a batch, before anything runs - for a UI progress
 * bar.  safetyFactor is a calibration knob, not a correction: the measured
 * anchors are single runs and a real box drifts.
 */
export function estimateSchedule(jobs, tier, { safetyFactor = 1 } = {}) {
  if (!Array.isArray(jobs)) throw coded('SCHEDULER_JOBS_REQUIRED', 'estimateSchedule expects an array of jobs');
  const t = normaliseTier(tier);
  const factor = finite(safetyFactor);
  if (factor === null || factor <= 0) throw coded('SCHEDULER_SAFETY_FACTOR_INVALID', String(safetyFactor));

  const priced = jobs.map((job, seq) => {
    const { ms, basis } = estimateJobMs(job);
    return { id: job.id, kind: job.kind, priority: finite(job.priority) ?? 0, seq, estimatedMs: round(ms * factor), basis };
  });
  const lane = kind => priced.filter(j => j.kind === kind).sort(byPriority).map(j => j.estimatedMs);
  const neural = lane('neural');
  if (neural.length && t.neuralConcurrency < 1) throw coded('SCHEDULER_NEURAL_UNSUPPORTED', `tier ${t.id} has no neural slots: ${t.basis}`);

  const neuralLaneMs = laneFinishMs(neural, t.neuralConcurrency);
  const compositeLaneMs = laneFinishMs(lane('composite'), t.compositeConcurrency);
  const serialMs = priced.reduce((sum, j) => sum + j.estimatedMs, 0);
  return {
    schemaVersion: 1,
    tier: t,
    safetyFactor: factor,
    // The lanes are independent: composites never wait on the GPU, so the
    // batch finishes when the slower lane does, not when their sum does.
    projectedWallMs: round(Math.max(neuralLaneMs, compositeLaneMs)),
    neuralLaneMs: round(neuralLaneMs),
    compositeLaneMs: round(compositeLaneMs),
    serialMs: round(serialMs),
    jobs: priced.map(({ seq, ...rest }) => rest),
    note: 'Projection only. Excludes process startup, model load from a cold disk cache, lease contention with other VYREALM workspaces, and any queueing behind work this scheduler cannot see.'
  };
}

/* ------------------------------------------------------------------ *
 * The scheduler
 * ------------------------------------------------------------------ */

function normaliseLease(gpuLease) {
  if (typeof gpuLease === 'function') return gpuLease;
  if (typeof gpuLease?.acquire === 'function') return owner => gpuLease.acquire(owner);
  if (gpuLease != null) throw coded('SCHEDULER_GPU_LEASE_INVALID', 'gpuLease must be an acquire function or { acquire }');
  // Lazily loaded so an injected lease costs nothing and tests never touch
  // node:sqlite or the real on-disk lease.
  return async owner => (await import('./inference-harness.mjs')).acquireGpuLease(owner);
}

function describeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, code: error.code ?? null };
  return { name: 'NonError', message: String(error), code: null };
}

const isAbort = error => error?.name === 'AbortError' || error?.code === 'ABORT_ERR';

/** Peak simultaneous intervals. Ends sort before starts, so touching intervals do not count as overlapping. */
function peakOverlap(entries) {
  const events = [];
  for (const entry of entries) {
    events.push([entry.startedMs, 1], [entry.endedMs, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  let peak = 0;
  for (const [, delta] of events) {
    live += delta;
    if (live > peak) peak = live;
  }
  return peak;
}

export function createScheduler({ tier, gpuLease, signal: defaultSignal } = {}) {
  const t = normaliseTier(tier);
  const acquire = normaliseLease(gpuLease);
  const jobs = [];
  const ids = new Set();
  let state = 'open';

  const submit = job => {
    if (state !== 'open') throw coded('SCHEDULER_CLOSED', `cannot submit after run() (state ${state})`);
    if (!job || typeof job !== 'object') throw coded('SCHEDULER_JOB_INVALID', 'job must be an object');
    const id = String(job.id ?? '');
    if (!id) throw coded('SCHEDULER_JOB_ID_REQUIRED');
    if (ids.has(id)) throw coded('SCHEDULER_JOB_ID_DUPLICATE', id);
    if (!KINDS.includes(job.kind)) throw coded('SCHEDULER_JOB_KIND_INVALID', `job ${id}: kind must be one of ${KINDS.join(', ')}`);
    if (typeof job.run !== 'function') throw coded('SCHEDULER_JOB_RUN_REQUIRED', id);
    if (job.kind === 'neural' && t.neuralConcurrency < 1) throw coded('SCHEDULER_NEURAL_UNSUPPORTED', `tier ${t.id} has no neural slots: ${t.basis}`);
    const priority = finite(job.priority) ?? 0;
    ids.add(id);
    const record = Object.freeze({ id, kind: job.kind, run: job.run, priority, seq: jobs.length });
    jobs.push(record);
    return record;
  };

  const run = async ({ signal = defaultSignal } = {}) => {
    if (state !== 'open') throw coded('SCHEDULER_ALREADY_RUN', `run() is single-use (state ${state})`);
    state = 'running';
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    const now = () => round(performance.now() - t0);
    const results = new Map();
    const timeline = [];
    let leaseErrors = 0;

    const runOne = async job => {
      let release = null;
      let leaseError = null;
      let heldLease = false;
      let started = now();
      try {
        // The lease is taken inside the try so a busy lease is recorded like
        // any other failure, but the timed window opens only once it is held:
        // a timeline interval is the exclusive GPU window, not the wait for
        // it. Composites never come here at all.
        if (job.kind === 'neural') {
          release = await acquire(job.id);
          heldLease = true;
          started = now();
        }
        const value = await job.run({ signal, lease: release, job });
        results.set(job.id, { id: job.id, kind: job.kind, priority: job.priority, status: 'completed', value, error: null });
      } catch (error) {
        const cancelled = Boolean(signal?.aborted) && isAbort(error);
        results.set(job.id, { id: job.id, kind: job.kind, priority: job.priority, status: cancelled ? 'cancelled' : 'failed', value: null, error: describeError(error) });
      } finally {
        if (release) {
          // A release that fails leaves the GPU lease held; that breaks every
          // later job, so it is counted and attached rather than swallowed.
          try { await release(); } catch (error) { leaseError = describeError(error); leaseErrors++; }
        }
        // A neural job that never got the lease never occupied the card, so its
        // window is marked and excluded from gpuBusyMs below: otherwise the
        // wait for a busy GPU would be reported as time the GPU was working.
        // It stays on the timeline (it did burn a worker slot and it did fail)
        // and stays in the neural overlap count, which can only over-report a
        // breach, never hide one.
        const entry = { id: job.id, kind: job.kind, startedMs: started, endedMs: now() };
        if (job.kind === 'neural' && !heldLease) entry.leaseAcquireFailed = true;
        timeline.push(leaseError ? { ...entry, leaseError } : entry);
      }
    };

    // One worker pool per kind. The pools are independent, which is the whole
    // point: composites keep the CPU busy while the single sampler works.
    const lane = (kind, slots) => {
      const queue = jobs.filter(j => j.kind === kind).sort(byPriority);
      let next = 0;
      const worker = async () => {
        while (next < queue.length) {
          if (signal?.aborted) return; // pending work is left for the sweep below
          await runOne(queue[next++]);
        }
      };
      return Array.from({ length: Math.min(slots, queue.length) }, worker);
    };

    // One job throwing must not kill the run: runOne never rejects, so this
    // settles only when every started job has finished or failed.
    await Promise.all([...lane('neural', t.neuralConcurrency), ...lane('composite', t.compositeConcurrency)]);
    const wallMs = now();
    state = 'done';

    const abortReason = signal?.aborted ? describeError(signal.reason ?? coded('SCHEDULER_CANCELLED', 'aborted by caller')) : null;
    for (const job of jobs) {
      if (results.has(job.id)) continue;
      results.set(job.id, { id: job.id, kind: job.kind, priority: job.priority, status: 'cancelled', value: null, error: abortReason ?? describeError(coded('SCHEDULER_CANCELLED', 'never started')) });
    }

    timeline.sort((a, b) => a.startedMs - b.startedMs || a.endedMs - b.endedMs);
    const ordered = jobs.map(job => results.get(job.id));
    const count = status => ordered.filter(r => r.status === status).length;
    const kindOf = kind => timeline.filter(e => e.kind === kind);
    const busy = entries => round(entries.reduce((sum, e) => sum + (e.endedMs - e.startedMs), 0));

    return {
      results: ordered,
      timeline,
      stats: {
        startedAt,
        wallMs,
        total: jobs.length,
        completed: count('completed'),
        failed: count('failed'),
        cancelled: count('cancelled'),
        leaseErrors,
        gpuBusyMs: busy(kindOf('neural').filter(e => !e.leaseAcquireFailed)),
        jobBusyMs: busy(timeline),
        concurrency: {
          neural: { limit: t.neuralConcurrency, achieved: peakOverlap(kindOf('neural')) },
          composite: { limit: t.compositeConcurrency, achieved: peakOverlap(kindOf('composite')) },
          achieved: peakOverlap(timeline)
        }
      },
      tier: t
    };
  };

  return { tier: t, submit, run, get size() { return jobs.length; }, get state() { return state; } };
}

/**
 * Evidence for a completed run: schemaVersion 1, real measured timings, and
 * the concurrency ACTUALLY achieved - recomputed here from the recorded
 * timestamps rather than copied from a counter that trusts itself, so the
 * numbers can be checked against the timeline they came from.
 */
export function schedulerEvidence(result) {
  const timeline = result?.timeline;
  const stats = result?.stats;
  if (!Array.isArray(timeline) || !stats) throw coded('SCHEDULER_EVIDENCE_INVALID_RESULT', 'pass the object returned by scheduler.run()');
  const tier = normaliseTier(result.tier ?? { neuralConcurrency: stats.concurrency?.neural?.limit, compositeConcurrency: stats.concurrency?.composite?.limit });
  const of = kind => timeline.filter(e => e.kind === kind);
  const neural = peakOverlap(of('neural'));
  const composite = peakOverlap(of('composite'));

  const violations = [];
  if (neural > tier.neuralConcurrency) violations.push({ code: 'NEURAL_CONCURRENCY_EXCEEDED', limit: tier.neuralConcurrency, achieved: neural });
  if (composite > tier.compositeConcurrency) violations.push({ code: 'COMPOSITE_CONCURRENCY_EXCEEDED', limit: tier.compositeConcurrency, achieved: composite });
  if (stats.leaseErrors > 0) violations.push({ code: 'GPU_LEASE_RELEASE_FAILED', count: stats.leaseErrors });

  const wallMs = finite(stats.wallMs) ?? 0;
  return {
    schemaVersion: 1,
    startedAt: stats.startedAt ?? null,
    tier: { id: tier.id, neuralConcurrency: tier.neuralConcurrency, compositeConcurrency: tier.compositeConcurrency },
    wallMs,
    jobs: { total: stats.total, completed: stats.completed, failed: stats.failed, cancelled: stats.cancelled },
    concurrency: {
      neural: { limit: tier.neuralConcurrency, achieved: neural },
      composite: { limit: tier.compositeConcurrency, achieved: composite },
      // In flight at once across both kinds: the number that says several
      // videos were being produced concurrently on one GPU.
      inFlight: peakOverlap(timeline)
    },
    gpuBusyMs: stats.gpuBusyMs,
    gpuUtilisation: wallMs > 0 ? round(stats.gpuBusyMs / wallMs) : null,
    // What the same work would have cost strictly one job at a time. Both
    // sides are measured; neither is projected.
    serialisedMs: stats.jobBusyMs,
    speedupVsSerial: wallMs > 0 ? round(stats.jobBusyMs / wallMs) : null,
    violations,
    timeline,
    basis: 'measured with performance.now() during the run; concurrency recomputed from the recorded start/end timestamps. No projected numbers.'
  };
}
