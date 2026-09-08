import test from 'node:test';
import assert from 'node:assert/strict';
import { planRawPrompt } from './raw-footage-plan.mjs';
const sources=[{id:'a',durationSeconds:10},{id:'b',durationSeconds:8}];
test('explicit source ranges preserve written order and framing',()=>{
 const p=planRawPrompt({brief:'source 2 from 1s to 4s, then source 1 from 5s to 8s; portrait; fit',durationSeconds:20,aspect:'16:9'},sources);
 assert.deepEqual(p.ranges,[{assetId:'b',start:1,duration:3},{assetId:'a',start:5,duration:3}]);
 assert.equal(p.durationSeconds,6);assert.equal(p.aspect,'9:16');assert.equal(p.framing,'fit');
});
test('duration and single-source range syntax',()=>{
 const p=planRawPrompt({brief:'from 2s to 6s; duration 4 seconds; landscape; crop right'},[sources[0]]);
 assert.equal(p.durationSeconds,4);assert.equal(p.framing,'crop-right');assert.equal(p.ranges[0].start,2);
});
test('invalid, ambiguous and overlapping ranges cannot silently fall back',()=>{
 for(const brief of ['source 3 from 0s to 2s','source 1 from 9s to 12s','source 1 from 3s to 2s','from 0s to 2s','source 1 from 0s to 3s; source 1 from 2s to 4s','source 1 from 0s to 2s; duration 4 seconds','source 1 from bananas to 3s','do not crop; portrait'])
  assert.throws(()=>planRawPrompt({brief},sources),e=>e.code==='RAW_PROMPT_INVALID',brief);
});
test('unsupported creative actions are disclosed and fallback is explicit',()=>{
 const p=planRawPrompt({brief:'Make it cinematic; add music and titles',durationSeconds:5},sources);
 assert.equal(p.mode,'chronological');assert.ok(p.diagnostics.some(d=>d.code==='RAW_PROMPT_UNSUPPORTED'));
 assert.ok(p.diagnostics.some(d=>d.code==='RAW_PROMPT_REMAINDER'));
});
