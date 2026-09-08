import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionRun, advanceProductionRun } from './short-form-production.mjs';

const H = 'a'.repeat(64), WRONG = 'b'.repeat(64);
const input = { projectId: 'p', expectedRevision: 9, brief: 'A woman hears footsteps after she stops running.', durationSeconds: 20,
  runId: 'run', shots: Array.from({length:4},(_,i)=>({id:`s${i}`,prompt:`Distinct shot ${i}`,narration:'The footsteps continued.',seed:i})) };
function host() {
  const calls = [], saved = [], jobs = new Map(), approvals = new Map();
  const queue = stage => async request => {
    calls.push({stage,request}); const jobId = request.idempotencyKey;
    jobs.set(jobId, {jobId, projectId:'p',status:'running',outputHash:H,assetId:`asset-${jobId}`,durationSeconds:5,executionMs:100,revision:10});
    return {jobId,revision:10};
  };
  return {calls,saved,jobs,approvals, adapters:{queueKeyframe:queue('keyframe'),queueMotion:queue('motion'),queueAudio:queue('audio'),queueRender:queue('render'),
    saveRun:async state=>saved.push(structuredClone(state)),inspectJob:async({jobId})=>jobs.get(jobId),verifyReview:async({jobId})=>approvals.get(jobId)}};
}
test('validates exact distinct-shot duration and short/trailer bounds',()=>{
  assert.equal(createProductionRun(input).shots.length,4);
  assert.throws(()=>createProductionRun({...input,durationSeconds:21}),/five-second/);
  assert.throws(()=>createProductionRun({...input,durationSeconds:120}),/five-second/);
  assert.throws(()=>createProductionRun({...input,shots:input.shots.map(s=>({...s,id:'same'}))}),/unique/);
});
test('queue intent is durable before provider call and pending job prevents duplicates',async()=>{
  const h=host();let state=createProductionRun(input);
  const queue=h.adapters.queueKeyframe;h.adapters.queueKeyframe=async request=>{assert.equal(h.saved.at(-1).status,'queuing');return queue(request);};
  state=await advanceProductionRun(state,h.adapters);state=await advanceProductionRun(state,h.adapters);
  assert.equal(h.calls.length,1);assert.equal(state.pending.jobId,'run:keyframe:s0');
});
test('technical success cannot animate an unreviewed or differently hashed image',async()=>{
  const h=host();let state=await advanceProductionRun(createProductionRun(input),h.adapters);
  h.jobs.get(state.pending.jobId).status='succeeded';
  state=await advanceProductionRun(state,h.adapters);assert.equal(state.status,'review-required');
  h.approvals.set(state.pending.jobId,{verdict:'passed',outputHash:WRONG});
  state=await advanceProductionRun(state,h.adapters);assert.equal(state.stage,'keyframe');assert.equal(h.calls.length,1);
  h.approvals.set(state.pending.jobId,{verdict:'passed',outputHash:H});
  state=await advanceProductionRun(state,h.adapters);assert.equal(state.stage,'motion');
  state=await advanceProductionRun(state,h.adapters);assert.equal(h.calls.at(-1).request.referenceHash,H);assert.equal(h.calls.at(-1).request.referenceJobId,'run:keyframe:s0');
});
test('adopts first casting job without submitting another and verifies ownership',async()=>{
  const h=host();const state=createProductionRun({...input,firstKeyframe:{shotId:'s0',jobId:'cast'}});
  h.jobs.set('cast',{jobId:'cast',projectId:'other',status:'succeeded',outputHash:H});
  await assert.rejects(()=>advanceProductionRun(state,h.adapters),/does not belong/);
  h.jobs.set('cast',{jobId:'cast',projectId:'p',status:'succeeded',outputHash:H});h.approvals.set('cast',{verdict:'passed',outputHash:H});
  const next=await advanceProductionRun(state,h.adapters);assert.equal(next.stage,'motion');assert.equal(h.calls.length,0);assert.deepEqual(next.timings.missingExecutionTimings,['cast']);
});
test('rejection is terminal and never silently resubmits',async()=>{
  const h=host();let state=await advanceProductionRun(createProductionRun(input),h.adapters);
  h.jobs.get(state.pending.jobId).status='rejected';state=await advanceProductionRun(state,h.adapters);
  state=await advanceProductionRun(state,h.adapters);assert.equal(state.status,'rejected');assert.equal(h.calls.length,1);
});
test('restart after queue acknowledgement loss reuses exact idempotency key',async()=>{
  const h=host();let saves=0;const save=h.adapters.saveRun;
  h.adapters.saveRun=async state=>{await save(state);if(++saves===2)throw new Error('disk failure');};
  await assert.rejects(()=>advanceProductionRun(createProductionRun(input),h.adapters),/disk failure/);
  const persistedIntent=h.saved[0];h.adapters.saveRun=save;
  await advanceProductionRun(persistedIntent,h.adapters);
  assert.equal(h.calls[0].request.idempotencyKey,h.calls[1].request.idempotencyKey);
});
test('full host-adapter journey checks every visual output and delivers separate timings',async()=>{
  const h=host();let state=createProductionRun(input);let count=0;
  while(state.status!=='completed'&&count++<40){
    state=await advanceProductionRun(state,h.adapters);
    if(state.pending){const job=h.jobs.get(state.pending.jobId);job.status='succeeded';h.approvals.set(job.jobId,{verdict:'passed',outputHash:H});}
  }
  assert.equal(state.status,'completed');assert.equal(state.completedShots.length,4);
  assert.equal(h.calls.length,10);assert.equal(state.timings.keyframeMs,400);assert.equal(state.timings.motionMs,400);assert.equal(state.timings.audioMs,100);assert.equal(state.timings.assemblyMs,100);
  const render=h.calls.at(-1).request;assert.equal(render.width,1080);assert.equal(render.height,1920);assert.equal(render.allowExtension,false);
  assert.equal(h.calls.find(c=>c.stage==='audio').request.cues.at(-1).end,20);
});
test('fresh production never accepts short motion or absent media asset',async()=>{
  const h=host();let state=createProductionRun(input);
  state.stage='motion';state.reference={jobId:'reference',outputHash:H};state=await advanceProductionRun(state,h.adapters);
  const job=h.jobs.get(state.pending.jobId);job.status='succeeded';job.durationSeconds=4;h.approvals.set(job.jobId,{verdict:'passed',outputHash:H});
  await assert.rejects(()=>advanceProductionRun(state,h.adapters),/five-second/);
});
