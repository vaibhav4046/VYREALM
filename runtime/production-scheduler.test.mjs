import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

import {
  createScheduler,
  estimateSchedule,
  estimateJobMs,
  schedulerEvidence,
  schedulerTier,
  MEASURED_NEURAL_RUNS,
  MEASURED_COMPOSITE
} from './production-scheduler.mjs';

// Async stubs only. Nothing in this file touches a GPU, ComfyUI, FFmpeg or the
// real on-disk lease: the point is to prove the SCHEDULING is correct, which is
// exactly the part a real 26-minute Wan2.2 run cannot be used to test.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** An injected acquire/release pair with the same shape as acquireGpuLease. */
function fakeLease() {
  const state = { held: 0, peak: 0, acquires: 0, releases: 0, owners: [] };
  const acquire = async owner => {
    state.acquires++;
    state.owners.push(owner);
    state.held++;
    state.peak = Math.max(state.peak, state.held);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      state.held--;
      state.releases++;
    };
  };
  return { acquire, state };
}

/** A live-occupancy probe, independent of anything the module records. */
function probe() {
  const live = new Map();
  const peak = new Map();
  return {
    peak,
    async occupy(kind, ms) {
      const n = (live.get(kind) ?? 0) + 1;
      live.set(kind, n);
      peak.set(kind, Math.max(peak.get(kind) ?? 0, n));
      try { await sleep(ms); } finally { live.set(kind, live.get(kind) - 1); }
      return `${kind}-done`;
    }
  };
}

const overlaps = (a, b) => a.startedMs < b.endedMs && b.startedMs < a.endedMs;
const entry = (timeline, id) => timeline.find(e => e.id === id);
const tier = (neural, composite) => ({ id: 'test', neuralConcurrency: neural, compositeConcurrency: composite });

test('two neural jobs never overlap: only one sampler can hold the GPU', async () => {
  const lease = fakeLease();
  const scheduler = createScheduler({ tier: tier(1, 4), gpuLease: lease.acquire });
  const p = probe();
  for (const id of ['neural-a', 'neural-b', 'neural-c']) {
    scheduler.submit({ id, kind: 'neural', run: () => p.occupy('neural', 25) });
  }

  const result = await scheduler.run();
  assert.equal(result.stats.completed, 3);
  assert.equal(p.peak.get('neural'), 1, 'two neural stubs were live at the same time');

  const neural = result.timeline.filter(e => e.kind === 'neural');
  assert.equal(neural.length, 3);
  for (const a of neural) {
    for (const b of neural) {
      if (a.id !== b.id) assert.ok(!overlaps(a, b), `${a.id} overlaps ${b.id}: ${JSON.stringify([a, b])}`);
    }
  }
  // The lease is taken and given back exactly once per neural job, never twice
  // at a time - a leak here would wedge every later run on the real lease.
  assert.equal(lease.state.acquires, 3);
  assert.equal(lease.state.releases, 3);
  assert.equal(lease.state.peak, 1);
  assert.deepEqual(lease.state.owners, ['neural-a', 'neural-b', 'neural-c']);
});

test('composites do overlap each other, because they are CPU work', async () => {
  const scheduler = createScheduler({ tier: tier(1, 3), gpuLease: fakeLease().acquire });
  const p = probe();
  for (const id of ['cut-a', 'cut-b', 'cut-c']) {
    scheduler.submit({ id, kind: 'composite', run: () => p.occupy('composite', 40) });
  }

  const result = await scheduler.run();
  assert.equal(p.peak.get('composite'), 3, 'composites did not actually run at the same time');
  assert.ok(overlaps(entry(result.timeline, 'cut-a'), entry(result.timeline, 'cut-b')), 'timeline shows no composite overlap');
  assert.equal(result.stats.concurrency.composite.achieved, 3);
  // Three 40 ms composites in parallel must beat 120 ms of serial work.
  assert.ok(result.stats.wallMs < 110, `wall ${result.stats.wallMs} ms suggests they serialised`);
});

test('composites overlap neural work: several videos are in flight on one GPU', async () => {
  const scheduler = createScheduler({ tier: tier(1, 2), gpuLease: fakeLease().acquire });
  scheduler.submit({ id: 'sample', kind: 'neural', run: () => sleep(120) });
  scheduler.submit({ id: 'cut-a', kind: 'composite', run: () => sleep(30) });
  scheduler.submit({ id: 'cut-b', kind: 'composite', run: () => sleep(30) });

  const result = await scheduler.run();
  const sample = entry(result.timeline, 'sample');
  const composites = result.timeline.filter(e => e.kind === 'composite');
  assert.ok(composites.every(c => overlaps(c, sample)), 'composites did not run beside the sampler');

  const evidence = schedulerEvidence(result);
  assert.equal(evidence.concurrency.neural.achieved, 1);
  assert.equal(evidence.concurrency.inFlight, 3, 'three jobs should have been in flight at once');
});

test('a throwing job is recorded and does not stop the others', async () => {
  const scheduler = createScheduler({ tier: tier(1, 2), gpuLease: fakeLease().acquire });
  const boom = Object.assign(new Error('ffmpeg exited 1'), { code: 'COMPOSITE_FAILED' });
  scheduler.submit({ id: 'ok-1', kind: 'composite', run: async () => 'one' });
  scheduler.submit({ id: 'bad', kind: 'composite', run: async () => { throw boom; } });
  scheduler.submit({ id: 'ok-2', kind: 'composite', run: async () => 'two' });
  scheduler.submit({ id: 'bad-neural', kind: 'neural', run: async () => { throw new Error('cuda oom'); } });
  scheduler.submit({ id: 'ok-neural', kind: 'neural', run: async () => 'sampled' });

  const result = await scheduler.run();
  const by = Object.fromEntries(result.results.map(r => [r.id, r]));
  assert.equal(by.bad.status, 'failed');
  assert.equal(by.bad.error.code, 'COMPOSITE_FAILED');
  assert.equal(by.bad.error.message, 'ffmpeg exited 1');
  assert.equal(by['bad-neural'].status, 'failed');
  assert.equal(by['ok-2'].value, 'two');
  assert.equal(by['ok-neural'].value, 'sampled');
  assert.equal(result.stats.completed, 3);
  assert.equal(result.stats.failed, 2);
  assert.equal(result.stats.cancelled, 0);
  // A failed job still occupied the machine, so it is still on the timeline.
  assert.equal(result.timeline.length, 5);
});

test('a failed neural job still gives the GPU back', async () => {
  const lease = fakeLease();
  const scheduler = createScheduler({ tier: tier(1, 1), gpuLease: lease });
  scheduler.submit({ id: 'boom', kind: 'neural', run: async () => { throw new Error('cuda oom'); } });
  scheduler.submit({ id: 'after', kind: 'neural', run: async () => 'sampled' });

  const result = await scheduler.run();
  assert.equal(lease.state.held, 0, 'lease leaked after a failure');
  assert.equal(lease.state.releases, 2);
  assert.equal(result.results.find(r => r.id === 'after').status, 'completed');
});

test('cancellation stops pending work and reports cancelled versus completed', async () => {
  const controller = new AbortController();
  const scheduler = createScheduler({ tier: tier(1, 1), gpuLease: fakeLease().acquire });
  scheduler.submit({
    id: 'cut-0',
    kind: 'composite',
    run: async () => { await sleep(10); controller.abort(); return 'done'; }
  });
  for (let i = 1; i < 5; i++) {
    scheduler.submit({ id: `cut-${i}`, kind: 'composite', run: async () => { await sleep(10); return 'done'; } });
  }

  const result = await scheduler.run({ signal: controller.signal });
  const status = Object.fromEntries(result.results.map(r => [r.id, r.status]));
  assert.equal(status['cut-0'], 'completed');
  assert.equal(result.stats.completed + result.stats.cancelled, 5);
  assert.ok(result.stats.cancelled >= 3, `expected pending work to be cancelled, got ${JSON.stringify(status)}`);

  // Cancelled work never ran, so it must not appear on the measured timeline,
  // and it must carry a reason rather than a silent null.
  const cancelled = result.results.filter(r => r.status === 'cancelled');
  for (const r of cancelled) {
    assert.equal(entry(result.timeline, r.id), undefined, `${r.id} was cancelled but has a timeline entry`);
    assert.ok(r.error.message, `${r.id} was cancelled without a reason`);
  }
  assert.equal(result.timeline.length, result.stats.completed);
});

test('an already-aborted signal runs nothing and says so', async () => {
  const lease = fakeLease();
  const scheduler = createScheduler({ tier: tier(1, 2), gpuLease: lease.acquire, signal: AbortSignal.abort() });
  scheduler.submit({ id: 'never', kind: 'neural', run: async () => { throw new Error('must not run'); } });
  scheduler.submit({ id: 'also-never', kind: 'composite', run: async () => { throw new Error('must not run'); } });

  const result = await scheduler.run();
  assert.equal(result.stats.cancelled, 2);
  assert.equal(result.timeline.length, 0);
  assert.equal(lease.state.acquires, 0, 'the GPU must not be taken for cancelled work');
});

test('a job that aborts mid-flight is cancelled, not failed', async () => {
  const controller = new AbortController();
  const scheduler = createScheduler({ tier: tier(1, 2), gpuLease: fakeLease().acquire, signal: controller.signal });
  scheduler.submit({
    id: 'long-cut',
    kind: 'composite',
    run: async ({ signal }) => {
      controller.abort();
      signal.throwIfAborted();
    }
  });

  const result = await scheduler.run();
  assert.equal(result.results[0].status, 'cancelled');
  assert.equal(result.results[0].error.name, 'AbortError');
});

test('concurrency never exceeds the tier limits under load', async () => {
  const limits = tier(1, 3);
  const lease = fakeLease();
  const scheduler = createScheduler({ tier: limits, gpuLease: lease.acquire });
  const p = probe();
  for (let i = 0; i < 4; i++) scheduler.submit({ id: `n-${i}`, kind: 'neural', run: () => p.occupy('neural', 8) });
  for (let i = 0; i < 9; i++) scheduler.submit({ id: `c-${i}`, kind: 'composite', run: () => p.occupy('composite', 8) });

  const result = await scheduler.run();
  assert.equal(result.stats.completed, 13);
  assert.ok(p.peak.get('neural') <= limits.neuralConcurrency, `neural peak ${p.peak.get('neural')}`);
  assert.ok(p.peak.get('composite') <= limits.compositeConcurrency, `composite peak ${p.peak.get('composite')}`);
  assert.equal(p.peak.get('composite'), 3, 'the composite lane never reached its limit, so this proves nothing');
  assert.ok(lease.state.peak <= 1);

  const evidence = schedulerEvidence(result);
  assert.equal(evidence.schemaVersion, 1);
  assert.deepEqual(evidence.violations, []);
  assert.ok(evidence.concurrency.neural.achieved <= 1);
  assert.ok(evidence.concurrency.composite.achieved <= 3);
});

test('priority decides order within a lane', async () => {
  const scheduler = createScheduler({ tier: tier(1, 1), gpuLease: fakeLease().acquire });
  const order = [];
  scheduler.submit({ id: 'low', kind: 'composite', priority: 0, run: async () => { order.push('low'); } });
  scheduler.submit({ id: 'urgent', kind: 'composite', priority: 10, run: async () => { order.push('urgent'); } });
  scheduler.submit({ id: 'mid', kind: 'composite', priority: 5, run: async () => { order.push('mid'); } });

  await scheduler.run();
  assert.deepEqual(order, ['urgent', 'mid', 'low']);
});

test('estimateSchedule lands within a sane factor of a deterministic stub run', async () => {
  // Deterministic stubs: each job sleeps exactly as long as it is priced at.
  const spec = [
    { id: 'n-1', kind: 'neural', estimatedMs: 80 },
    { id: 'n-2', kind: 'neural', estimatedMs: 80 },
    { id: 'c-1', kind: 'composite', estimatedMs: 50 },
    { id: 'c-2', kind: 'composite', estimatedMs: 50 },
    { id: 'c-3', kind: 'composite', estimatedMs: 50 }
  ];
  const limits = tier(1, 3);
  const estimate = estimateSchedule(spec, limits);

  // Two serialised 80 ms neural jobs; three 50 ms composites beside them.
  assert.equal(estimate.projectedWallMs, 160);
  assert.equal(estimate.neuralLaneMs, 160);
  assert.equal(estimate.compositeLaneMs, 50);
  assert.equal(estimate.serialMs, 310);

  const scheduler = createScheduler({ tier: limits, gpuLease: fakeLease().acquire });
  for (const job of spec) scheduler.submit({ ...job, run: () => sleep(job.estimatedMs) });
  const result = await scheduler.run();

  const ratio = result.stats.wallMs / estimate.projectedWallMs;
  assert.ok(ratio > 0.9 && ratio < 2, `projected ${estimate.projectedWallMs} ms vs measured ${result.stats.wallMs} ms (ratio ${ratio.toFixed(2)})`);

  const evidence = schedulerEvidence(result);
  assert.ok(evidence.speedupVsSerial > 1.2, `measured serialised ${evidence.serialisedMs} ms in ${evidence.wallMs} ms wall`);
  assert.ok(evidence.gpuUtilisation > 0.8, `GPU idle for most of the run: ${evidence.gpuUtilisation}`);
});

test('estimateSchedule prices measured models and refuses to guess anything else', () => {
  const wan = estimateJobMs({ id: 'a', kind: 'neural', model: 'Wan2.2-TI2V-5B-Q4_K_M.gguf', frames: 121 });
  assert.equal(Math.round(wan.ms), 1568000, 'the 121-frame Wan2.2 anchor must price at its measured 1568 s');
  const ltx = estimateJobMs({ id: 'b', kind: 'ne' + 'ural', model: 'ltx-2b-distilled-q8', frames: 97 });
  assert.equal(Math.round(ltx.ms), 196000);
  const cut = estimateJobMs({ id: 'c', kind: 'composite', seconds: 15 });
  assert.equal(Math.round(cut.ms), 11000);
  assert.ok(!cut.basis.includes('EXTRAPOLATED'), 'the measured 15 s cut is not an extrapolation');

  // Off the measured point: still priced, but labelled.
  const longer = estimateJobMs({ id: 'd', kind: 'composite', seconds: 30 });
  assert.equal(Math.round(longer.ms), 22000);
  assert.ok(longer.basis.includes('EXTRAPOLATED'));
  const offRes = estimateJobMs({ id: 'e', kind: 'neural', model: 'ltx-2b-distilled-q8', frames: 97, width: 1024, height: 576 });
  assert.ok(offRes.basis.includes('EXTRAPOLATED'));

  // No estimate, no measured basis: a coded refusal, not a made-up number.
  assert.throws(() => estimateJobMs({ id: 'f', kind: 'neural', frames: 121 }), e => e.code === 'SCHEDULER_ESTIMATE_UNKNOWN_COST');
  assert.throws(() => estimateJobMs({ id: 'g', kind: 'composite' }), e => e.code === 'SCHEDULER_ESTIMATE_UNKNOWN_COST');
  assert.throws(() => estimateJobMs({ id: 'h', kind: 'audio', estimatedMs: undefined }), e => e.code === 'SCHEDULER_JOB_KIND_INVALID');

  // A whole batch, priced from measurements alone.
  const batch = estimateSchedule([
    { id: 'shot-1', kind: 'neural', model: 'ltxv-2b-0.9.8-distilled-q8_0.gguf', frames: 97 },
    { id: 'shot-2', kind: 'neural', model: 'ltxv-2b-0.9.8-distilled-q8_0.gguf', frames: 97 },
    { id: 'cut-1', kind: 'composite', seconds: 15 }
  ], tier(1, 2));
  assert.equal(Math.round(batch.projectedWallMs), 392000);
  assert.equal(Math.round(batch.serialMs), 403000);
  assert.equal(batch.schemaVersion, 1);

  // safetyFactor is a knob, not a hidden correction.
  assert.equal(Math.round(estimateSchedule(spec1(), tier(1, 1), { safetyFactor: 1.1 }).projectedWallMs), 110);
  function spec1() { return [{ id: 'x', kind: 'composite', estimatedMs: 100 }]; }
});

test('tiers extend the hardware profiles instead of redefining them', () => {
  const creator = schedulerTier('CREATOR_LOCAL', { cpus: 12 });
  assert.equal(creator.neuralConcurrency, 1, 'one GPU is one sampler, however large the card');
  assert.equal(creator.compositeConcurrency, 4);

  const thisBox = schedulerTier('STANDARD_LOCAL', { cpus: 12 });
  assert.equal(thisBox.neuralConcurrency, 0, 'STANDARD_LOCAL blocks the neural-video route in hardware-profile.mjs');
  assert.ok(thisBox.basis.includes('blocks the neural-video route'));

  // A tier with no neural slots refuses neural work outright rather than
  // quietly queueing something that can never run.
  const scheduler = createScheduler({ tier: thisBox, gpuLease: fakeLease().acquire });
  assert.throws(() => scheduler.submit({ id: 'n', kind: 'neural', run: async () => {} }), e => e.code === 'SCHEDULER_NEURAL_UNSUPPORTED');
  assert.throws(() => estimateSchedule([{ id: 'n', kind: 'neural', estimatedMs: 1 }], thisBox), e => e.code === 'SCHEDULER_NEURAL_UNSUPPORTED');

  assert.throws(() => schedulerTier('NO_SUCH_PROFILE'), e => e.code === 'SCHEDULER_TIER_UNKNOWN_PROFILE');
  assert.throws(() => createScheduler({ tier: { neuralConcurrency: 1, compositeConcurrency: 0 } }), e => e.code === 'SCHEDULER_TIER_INVALID');
  assert.throws(() => createScheduler({}), e => e.code === 'SCHEDULER_TIER_REQUIRED');
  assert.throws(() => createScheduler({ tier: tier(1, 1), gpuLease: 'nope' }), e => e.code === 'SCHEDULER_GPU_LEASE_INVALID');
});

test('submission and run are validated with coded errors', async () => {
  const scheduler = createScheduler({ tier: tier(1, 2), gpuLease: fakeLease().acquire });
  assert.throws(() => scheduler.submit({ kind: 'neural', run: async () => {} }), e => e.code === 'SCHEDULER_JOB_ID_REQUIRED');
  assert.throws(() => scheduler.submit({ id: 'a', kind: 'audio', run: async () => {} }), e => e.code === 'SCHEDULER_JOB_KIND_INVALID');
  assert.throws(() => scheduler.submit({ id: 'a', kind: 'neural' }), e => e.code === 'SCHEDULER_JOB_RUN_REQUIRED');
  scheduler.submit({ id: 'a', kind: 'neural', run: async () => 'ok' });
  assert.throws(() => scheduler.submit({ id: 'a', kind: 'composite', run: async () => {} }), e => e.code === 'SCHEDULER_JOB_ID_DUPLICATE');
  assert.equal(scheduler.size, 1);

  await scheduler.run();
  assert.equal(scheduler.state, 'done');
  assert.throws(() => scheduler.submit({ id: 'b', kind: 'composite', run: async () => {} }), e => e.code === 'SCHEDULER_CLOSED');
  await assert.rejects(scheduler.run(), e => e.code === 'SCHEDULER_ALREADY_RUN');
  assert.throws(() => schedulerEvidence({}), e => e.code === 'SCHEDULER_EVIDENCE_INVALID_RESULT');
});

test('a lease that cannot be released is reported, never swallowed', async () => {
  const scheduler = createScheduler({
    tier: tier(1, 1),
    gpuLease: async () => async () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); }
  });
  scheduler.submit({ id: 'n', kind: 'neural', run: async () => 'sampled' });

  const result = await scheduler.run();
  assert.equal(result.results[0].status, 'completed', 'the shot did render; only the lease handback failed');
  assert.equal(result.stats.leaseErrors, 1);
  assert.equal(entry(result.timeline, 'n').leaseError.code, 'EBUSY');
  assert.deepEqual(schedulerEvidence(result).violations, [{ code: 'GPU_LEASE_RELEASE_FAILED', count: 1 }]);
});

test('a busy GPU lease fails one job without killing the batch', async () => {
  let first = true;
  const scheduler = createScheduler({
    tier: tier(1, 1),
    gpuLease: async () => {
      if (first) { first = false; throw Object.assign(new Error('GPU_LEASE_BUSY'), { code: 'GPU_LEASE_BUSY' }); }
      return async () => {};
    }
  });
  scheduler.submit({ id: 'blocked', kind: 'neural', run: async () => 'never' });
  scheduler.submit({ id: 'later', kind: 'neural', run: async () => 'sampled' });

  const result = await scheduler.run();
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[0].error.code, 'GPU_LEASE_BUSY');
  assert.equal(result.results[1].value, 'sampled');
});

test('evidence counts real overlap, not back-to-back jobs, and names a breach', () => {
  const of = timeline => schedulerEvidence({
    timeline,
    tier: tier(1, 2),
    stats: { startedAt: null, wallMs: 30, total: timeline.length, completed: timeline.length, failed: 0, cancelled: 0, leaseErrors: 0, gpuBusyMs: 20, jobBusyMs: 20 }
  });

  // Two neural jobs that touch at the handover are SERIAL, not concurrent.
  // Getting this wrong reports a correct single-GPU run as a violation.
  const back2back = of([
    { id: 'a', kind: 'neural', startedMs: 0, endedMs: 10 },
    { id: 'b', kind: 'neural', startedMs: 10, endedMs: 20 }
  ]);
  assert.equal(back2back.concurrency.neural.achieved, 1);
  assert.deepEqual(back2back.violations, []);

  // A real one-millisecond overlap is a violation and must be named.
  const breach = of([
    { id: 'a', kind: 'neural', startedMs: 0, endedMs: 10 },
    { id: 'b', kind: 'neural', startedMs: 9, endedMs: 20 }
  ]);
  assert.equal(breach.concurrency.neural.achieved, 2);
  assert.deepEqual(breach.violations, [{ code: 'NEURAL_CONCURRENCY_EXCEEDED', limit: 1, achieved: 2 }]);
});

test('the measured anchors are the numbers this module prices with', () => {
  const wan = MEASURED_NEURAL_RUNS['Wan2.2-TI2V-5B-Q4_K_M.gguf'];
  assert.equal(wan.totalMs / wan.frames / 1000, 1568 / 121);
  assert.ok(wan.basis.includes('measured on this box'));
  assert.equal(wan.peakVramGiB, 5.85);
  const ltx = MEASURED_NEURAL_RUNS['ltxv-2b-0.9.8-distilled-q8_0.gguf'];
  assert.equal(ltx.totalMs / ltx.frames / 1000, 196 / 97);
  assert.equal(MEASURED_COMPOSITE.totalMs / MEASURED_COMPOSITE.outputSeconds, 11000 / 15);
});

/* ------------------------------------------------------------------ *
 * Adversarial pass: each of these was written to BREAK a guard the
 * module claims to have, not to confirm one.
 * ------------------------------------------------------------------ */

test('a missing estimate is refused, never silently priced at zero', () => {
  // Number(null), Number(''), Number(false) and Number([]) are all 0. A
  // permissive numeric check therefore turns a SQLite NULL - the normal shape
  // of "no estimate stored yet" - into a confident "0 ms", which is a
  // fabricated measurement wearing a measured basis string.
  const absentValues = [null, '', '   ', false, true, [], {}, NaN, 'soon'];
  for (const absent of absentValues) {
    const label = `${typeof absent}:${JSON.stringify(absent) ?? String(absent)}`;
    assert.throws(
      () => estimateJobMs({ id: 'x', kind: 'composite', estimatedMs: absent }),
      e => e.code === 'SCHEDULER_ESTIMATE_UNKNOWN_COST',
      `estimatedMs ${label} was priced instead of refused`
    );
    assert.throws(
      () => estimateJobMs({ id: 'y', kind: 'composite', seconds: absent }),
      e => e.code === 'SCHEDULER_ESTIMATE_UNKNOWN_COST',
      `seconds ${label} was priced instead of refused`
    );
    assert.throws(
      () => estimateJobMs({ id: 'z', kind: 'neural', model: 'ltx-2b-distilled-q8', frames: absent }),
      e => e.code === 'SCHEDULER_ESTIMATE_UNKNOWN_COST',
      `frames ${label} was priced instead of refused`
    );
  }

  // A batch of rows that carry no priceable cost must refuse, not project 0 ms.
  assert.throws(
    () => estimateSchedule([{ id: 'a', kind: 'composite', estimatedMs: null }], tier(1, 2)),
    e => e.code === 'SCHEDULER_ESTIMATE_UNKNOWN_COST'
  );

  // A null estimate alongside a real measured basis falls THROUGH to the
  // measurement rather than short-circuiting at zero.
  const fellThrough = estimateJobMs({ id: 'shot', kind: 'neural', estimatedMs: null, model: 'ltx-2b-distilled-q8', frames: 97 });
  assert.equal(Math.round(fellThrough.ms), 196000, 'a null estimate must fall through to the measured basis, not price at 0');
  assert.ok(typeof fellThrough.basis === 'string' && fellThrough.basis.trim().length > 0, 'an estimate retains its evidence and limitations');
  assert.doesNotMatch(fellThrough.basis, /fits entirely in 6 GB VRAM/);

  // An absent canvas is not an off-spec canvas: it must not be labelled as an
  // extrapolation away from the measured point it actually sits on.
  const cut = estimateJobMs({ id: 'c', kind: 'composite', seconds: 15, width: null, height: null });
  assert.equal(Math.round(cut.ms), 11000);
  assert.ok(!cut.basis.includes('EXTRAPOLATED'), 'an absent canvas was read as an off-spec canvas');

  // Zero and numeric strings are still legitimate estimates.
  assert.equal(estimateJobMs({ id: 'free', kind: 'composite', estimatedMs: 0 }).ms, 0);
  assert.equal(estimateJobMs({ id: 'str', kind: 'composite', estimatedMs: '250' }).ms, 250);
});

test('a tier with a missing limit is a coded error, not a silent zero', () => {
  // neuralConcurrency:null used to coerce to 0, producing a "valid" tier that
  // silently refused every neural job it was handed.
  assert.throws(() => createScheduler({ tier: { neuralConcurrency: null, compositeConcurrency: 2 } }), e => e.code === 'SCHEDULER_TIER_INVALID');
  assert.throws(() => createScheduler({ tier: { neuralConcurrency: 1, compositeConcurrency: null } }), e => e.code === 'SCHEDULER_TIER_INVALID');
  assert.throws(() => createScheduler({ tier: { neuralConcurrency: '', compositeConcurrency: 2 } }), e => e.code === 'SCHEDULER_TIER_INVALID');
  assert.throws(() => createScheduler({ tier: { neuralConcurrency: 1.5, compositeConcurrency: 2 } }), e => e.code === 'SCHEDULER_TIER_INVALID');
  assert.throws(() => estimateSchedule([], tier(1, 1), { safetyFactor: null }), e => e.code === 'SCHEDULER_SAFETY_FACTOR_INVALID');
});

test('a failed lease acquire is not billed as GPU-busy time', async () => {
  let first = true;
  const scheduler = createScheduler({
    tier: tier(1, 1),
    gpuLease: async () => {
      if (first) { first = false; await sleep(40); throw Object.assign(new Error('GPU_LEASE_BUSY'), { code: 'GPU_LEASE_BUSY' }); }
      return async () => {};
    }
  });
  scheduler.submit({ id: 'blocked', kind: 'neural', run: async () => 'never' });
  scheduler.submit({ id: 'later', kind: 'neural', run: () => sleep(20) });

  const result = await scheduler.run();
  assert.equal(entry(result.timeline, 'blocked').leaseAcquireFailed, true);
  assert.equal(entry(result.timeline, 'later').leaseAcquireFailed, undefined);
  // 40 ms spent waiting for a card that was busy is not 40 ms of GPU work.
  assert.ok(result.stats.gpuBusyMs < 40, `gpuBusyMs ${result.stats.gpuBusyMs} billed the failed wait as GPU time`);
  assert.ok(result.stats.gpuBusyMs >= 15, `gpuBusyMs ${result.stats.gpuBusyMs} lost the real sampling window`);
  assert.ok(result.stats.wallMs >= 55, `wall ${result.stats.wallMs} ms: the wait did not actually happen`);
  // jobBusyMs still counts it: the job did occupy a worker slot.
  assert.ok(result.stats.jobBusyMs > result.stats.gpuBusyMs);
});

test('the OS lease, not the tier, is what keeps two samplers off one card', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vyrealm-scheduler-lease-'));
  process.env.VYRELUM_GPU_LEASE_DIR = dir;
  try {
    // A DELIBERATELY misconfigured tier claiming four samplers fit on one card,
    // with NO injected lease - so this is the only test that exercises the real
    // default path, acquireGpuLease from inference-harness.mjs, which every
    // other test stubs out. If the tier were the only guard, four neural jobs
    // would sample at once.
    const scheduler = createScheduler({ tier: { id: 'misconfigured', neuralConcurrency: 4, compositeConcurrency: 1 } });
    for (let i = 0; i < 4; i++) scheduler.submit({ id: `sampler-${i}`, kind: 'neural', run: () => sleep(80) });

    const result = await scheduler.run();
    const held = result.timeline.filter(e => !e.leaseAcquireFailed);
    assert.equal(held.length, 1, `${held.length} jobs reached the card at once: ${JSON.stringify(result.timeline)}`);
    assert.equal(result.stats.completed, 1);
    assert.equal(result.stats.failed, 3);
    for (const r of result.results.filter(r => r.status === 'failed')) {
      assert.match(r.error.message, /GPU_LEASE_BUSY/, `expected a busy-lease refusal, got ${r.error.message}`);
    }
    // Honest limitation, pinned so it cannot rot into a surprise: the tier
    // claimed 4 and the run achieved 1, so evidence raises NO violation - 1 is
    // within a limit of 4. The tier is a budget; the lease is the guard.
    assert.deepEqual(schedulerEvidence(result).violations, []);
    assert.equal(schedulerEvidence(result).concurrency.neural.limit, 4);
  } finally {
    delete process.env.VYRELUM_GPU_LEASE_DIR;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
