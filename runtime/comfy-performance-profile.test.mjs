import test from 'node:test';
import assert from 'node:assert/strict';
import {comfyLaunchProfile} from './comfy-performance-profile.mjs';
const supported='cache_group.add_argument("--cache-ram", help="active and inactive-cache/pin threshold")';
test('default reproduces original launch flags and does not silently enable caching',()=>{
 assert.deepEqual(comfyLaunchProfile().args,['--listen','127.0.0.1','--port','8188','--lowvram','--disable-dynamic-vram','--disable-smart-memory','--cache-none','--disable-api-nodes','--disable-all-custom-nodes','--whitelist-custom-nodes','ComfyUI-GGUF','--disable-auto-launch','--reserve-vram','1','--disable-async-offload','--use-pytorch-cross-attention']);
});
test('candidate adds both4GiB thresholds while retaining oneGPU/offload/local-only controls',()=>{
 const candidate=comfyLaunchProfile({profile:'ram-pressure-4gb',totalRamBytes:16*1024**3,cliSource:supported});
 assert.deepEqual(candidate.cacheArgs,['--cache-ram','4','4']);assert.ok(!candidate.args.includes('--cache-none'));
 for(const flag of ['--lowvram','--disable-smart-memory','--disable-dynamic-vram','--reserve-vram','--disable-api-nodes','--disable-all-custom-nodes'])assert.ok(candidate.args.includes(flag));
 assert.equal(candidate.qualification,'unmeasured');assert.equal(candidate.measuredSpeedup,null);assert.equal(candidate.memoryLimitClaim,false);
});
test('unsupported flags, insufficientRAM and missingCLI capability fail closed',()=>{
 for(const change of [{profile:'fastest'},{profile:{}},{profile:'ram-pressure-4gb',totalRamBytes:8*1024**3,cliSource:supported},{profile:'ram-pressure-4gb',totalRamBytes:16*1024**3,cliSource:'--cache-lru'}])assert.throws(()=>comfyLaunchProfile(change),/COMFY_/);
});
