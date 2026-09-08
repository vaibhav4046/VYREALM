import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBenchmarkArgs, acquireQualificationLease } from './benchmark-ltx-shot.mjs';

const source='12345678-1234-1234-1234-123456789012';
test('qualification requires an explicit reviewed source and defaults to read-only inspection', () => {
  assert.throws(()=>parseBenchmarkArgs([]),/Explicitly select/);
  const options = parseBenchmarkArgs(['--source-job',source]);
  assert.equal(options.run, false);
  assert.equal(options.sourceJobId, source);
  assert.equal(options.profile, 'draft-512');
  assert.equal(options.queuePolicy, 'idle');
  assert.equal(options.tiledDecode, false);
});
test('only bounded explicit benchmark options enable inference', () => {
  const options = parseBenchmarkArgs(['--source-job',source,'--run', '--profile', 'comparison-1024', '--queue-policy', 'fifo', '--tiled-decode','--prompt-file','motion.txt','--seed','42']);
  assert.equal(options.run, true); assert.equal(options.profile, 'comparison-1024');
  assert.equal(options.queuePolicy, 'fifo'); assert.equal(options.tiledDecode, true);
  assert.equal(options.seed,42);assert.equal(options.promptFile,'motion.txt');
  for (const args of [['--profile','4k'],['--queue-policy','parallel'],['--source-job','../escape'],['--seed','-1'],['--workflow','evil.json']]) assert.throws(() => parseBenchmarkArgs(['--source-job',source,...args]));
});
test('qualification waits for the existing GPU owner, stops on request, and bounds lease wait', async () => {
  let attempts = 0, waiting = 0;
  const release = () => {};
  const lease = await acquireQualificationLease({ owner: 'fixture', acquire: async () => { if (++attempts < 3) throw Error('GPU_LEASE_BUSY'); return release; }, onWait: () => waiting++, pollIntervalMs: 1, timeoutMs: 1000 });
  assert.equal(lease, release); assert.equal(attempts, 3); assert.equal(waiting, 2);
  await assert.rejects(acquireQualificationLease({ owner: 'fixture', isStopped: () => true, acquire: () => assert.fail('stopped job cannot acquire GPU') }), /LTX_STOP_REQUESTED/);
  await assert.rejects(acquireQualificationLease({ owner: 'fixture', acquire: async () => { throw Error('GPU_LEASE_BUSY'); }, pollIntervalMs: 1, timeoutMs: 2 }), /LTX_LEASE_TIMEOUT/);
});
