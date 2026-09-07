import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeSoundDesign } from './sound-design.mjs';

test('original sound synthesis is reproducible, bounded and event-sensitive',()=>{
 const args={durationSeconds:2,seed:12,footsteps:[0.6,1.2],shelterAt:1.5,climaxAt:1.6};
 const result=synthesizeSoundDesign(args),again=synthesizeSoundDesign(args),bed=synthesizeSoundDesign({...args,footsteps:[]});
 assert.deepEqual(result.wave,again.wave);assert.equal(result.wave.readUInt32LE(24),48000);assert.equal(result.wave.readUInt32LE(40),2*48000*4);assert.equal(result.evidence.neuralModelInvoked,false);
 assert.deepEqual(result.wave.subarray(44,44+24000*4),bed.wave.subarray(44,44+24000*4),'unchanged ambience before first event');
 assert.notDeepEqual(result.wave.subarray(44+30000*4,44+32000*4),bed.wave.subarray(44+30000*4,44+32000*4),'footstep must audibly change its scheduled range');
 assert.throws(()=>synthesizeSoundDesign({...args,footsteps:[3]}),/OUTSIDE/);
});
