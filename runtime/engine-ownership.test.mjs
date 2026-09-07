import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireEngineOwnership } from './engine-ownership.mjs';

test('one engine owns a store; independent stores and released ownership work',async()=>{
  const a=await mkdtemp(join(tmpdir(),'vyrealm-owner-a-')),b=await mkdtemp(join(tmpdir(),'vyrealm-owner-b-'));
  const releaseA=await acquireEngineOwnership(a),releaseB=await acquireEngineOwnership(b);
  try { await assert.rejects(acquireEngineOwnership(a),e=>e.code==='ENGINE_STORE_IN_USE'); }
  finally { await releaseA(); await releaseB(); }
  const releaseAgain=await acquireEngineOwnership(a);await releaseAgain();await releaseAgain();
});
