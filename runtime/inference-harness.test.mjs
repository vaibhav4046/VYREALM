import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = await mkdtemp(path.join(tmpdir(), 'vyrelum-harness-'));
process.env.VYRELUM_RUNTIME_DIR = root;
process.env.VYRELUM_GPU_LEASE_DIR = root;
const api = await import('./inference-harness.mjs');
const moduleUrl = new URL('./inference-harness.mjs', import.meta.url).href;
function contender(hold = false) {
  return spawn(process.execPath, ['--input-type=module', '-e', `import {acquireGpuLease} from ${JSON.stringify(moduleUrl)}; try { const release = await acquireGpuLease('child'); console.log('acquired'); ${hold ? 'setInterval(()=>{},1000);' : 'await release();'} } catch(e) { console.log(e.message); process.exitCode=2; }`], { env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function result(child) { let out=''; child.stdout.on('data', x=>out+=x); const [code] = await once(child,'exit'); return {code,out}; }
try {
  const release = await api.acquireGpuLease('parent', {ttlMs: 1});
  await new Promise(r=>setTimeout(r, 20));
  const blocked = await Promise.all(Array.from({length: 8},()=>result(contender())));
  assert.ok(blocked.every(x=>x.code===2 && x.out.includes('GPU_LEASE_BUSY')));
  await release(); await release();
  assert.equal((await result(contender())).code, 0);
  const killed = contender(true);
  await once(killed.stdout, 'data');
  const exited = once(killed, 'exit'); killed.kill(); await exited;
  assert.equal((await result(contender())).code, 0, 'OS must release lock after process death');
  assert.equal(api.cacheKey({b:2,a:1}), api.cacheKey({a:1,b:2}));
  assert.notEqual(api.cacheKey({a:1},{model:'one'}),api.cacheKey({a:1},{model:'two'}));
  assert.notEqual(api.cacheKey({a:1},{version:1}),api.cacheKey({a:1},{version:2}));
  assert.equal(api.capabilityRoute({ route:'neural-video', hardware:{ profile:{ id:'STANDARD_LOCAL', blockedRoutes:['neural-video'] } }, capabilities:{'neural-video':true} }).reason, 'INSUFFICIENT_HARDWARE_PROFILE');
  await Promise.all(Array.from({length:32},(_,i)=>api.writePlanCache({brief:'same'}, {i,large:'a'.repeat(10000)}, {model:'qualified'})));
  const cached = await api.readPlanCache({brief:'same'}, {model:'qualified'});
  assert.equal(cached.large.length,10000);
  assert.ok(Number.isInteger(cached.i));
  assert.equal(await api.readPlanCache({brief:'same'}, {model:'different'}),null);
  assert.ok((await readdir(path.join(root,'plan-cache'))).every(n=>!n.includes('.tmp-')));
  assert.throws(()=>api.cacheKey({x:undefined}), /CACHE_INPUT_MUST_BE_JSON/);
  console.log('PASS: concurrent lease exclusion, live lease non-expiry, crash recovery, canonical model/version cache, 32 concurrent atomic writes');
} finally { await rm(root,{recursive:true,force:true}); }
