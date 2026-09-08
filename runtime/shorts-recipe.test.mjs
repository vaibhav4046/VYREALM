import test from 'node:test';
import assert from 'node:assert/strict';
import { planShorts, validateShortsRecipe } from './shorts-recipe.mjs';
const assets=Array.from({length:4},(_,i)=>({id:`a${i}`,kind:'video',description:`Original motion ${i}`,durationSeconds:5,review:'unreviewed'}));
const plan={schemaVersion:1,sourceMode:'existing-footage',title:'Footsteps',promise:'Someone is following.',payoff:'The sound continues after she stops.',continuity:'Same woman and wet jacket.',durationSeconds:20,
  shots:assets.map((a,i)=>({assetId:a.id,inPoint:0,durationSeconds:5,role:i===0?'hook':i===3?'payoff':'progression',action:'She turns toward the sound.',narration:'The footsteps continued.'}))};
test('source selection rejects insufficient, rejected, overlapping or still-image footage',()=>{
  assert.equal(validateShortsRecipe(plan,assets).checks.noTimeExtension,true);
  assert.throws(()=>validateShortsRecipe(plan,assets.map((a,i)=>i? a:{...a,review:'rejected'})),/non-rejected/);
  assert.throws(()=>validateShortsRecipe(plan,assets.map(a=>({...a,durationSeconds:4}))),/real footage/);
  assert.throws(()=>validateShortsRecipe({...plan,shots:plan.shots.map(s=>({...s,assetId:'a0'}))},assets),/Overlapping/);
  assert.throws(()=>validateShortsRecipe(plan,assets.map(a=>({...a,kind:'image'}))),/video footage/);
});
test('fresh request refuses reuse without calling the model',async()=>{
  await assert.rejects(()=>planShorts({brief:'Generate new footage',assets,fetchImpl:()=>{throw new Error('must not call');}}),/Fresh generation/);
});
test('local product planner returns checked original manifest without invented fallback',async()=>{
  let posted;
  const result=await planShorts({brief:'Edit my footage into a thriller',sourceMode:'existing-footage',assets,fetchImpl:async(_url,opts)=>{posted=JSON.parse(opts.body);return{ok:true,json:async()=>({response:JSON.stringify(plan)})};}});
  assert.equal(result.shots.length,4);assert.equal(result.planning.provider,'ollama-local');assert.equal(posted.format,'json');
  await assert.rejects(()=>planShorts({brief:'Edit footage',sourceMode:'existing-footage',assets,fetchImpl:async()=>({ok:true,json:async()=>({response:'not json'})})}),/invalid JSON/);
});
