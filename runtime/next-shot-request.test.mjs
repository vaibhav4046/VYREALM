import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNextShotInput } from './next-shot-request.mjs';

const fixture = () => ({request:{expectedRevision:7,brief:'A detailed chariot on the plain',seed:3},project:{id:'film',revision:7},sourceJob:{id:'approved',project_id:'film',status:'succeeded',type:'generation-test'},receipt:{provenance:{generationStatus:'generated',evidenceHash:'proof',outputHash:'delivery',keyframe:{outputHash:'keyframe',promptId:'original-provider-prompt'}},review:{verdict:'passed',outputHash:'delivery'}},jobsDir:'jobs'});
test('default preserves the locked keyframe and appends without replacing the timeline',()=>{
 const f=fixture(),input=prepareNextShotInput(f);
 assert.equal(input.sourceMode,'locked-keyframe'); assert.equal(input.append,true);
 assert.equal(input.reference.sha256,'keyframe'); assert.equal(input.prerequisiteJobId,'approved');
});
test('fresh independent shot invokes a new keyframe while retaining its passed prerequisite',()=>{
 const f=fixture();f.request.sourceMode='new-keyframe';const input=prepareNextShotInput(f);
 assert.equal(input.sourceMode,'new-keyframe'); assert.equal(input.append,true);
 assert.equal(input.prerequisiteJobId,'approved');assert.equal('reference' in input,false);
});
test('both routes reject unreviewed, imported, failed and cross-project prerequisites',()=>{
 for(const sourceMode of ['locked-keyframe','new-keyframe'])for(const mutation of [f=>f.sourceJob.project_id='other',f=>f.sourceJob.status='failed',f=>f.sourceJob.type='render',f=>f.receipt.review.verdict='rejected',f=>f.receipt.provenance.generationStatus='imported']){
  const f=fixture();f.request.sourceMode=sourceMode;mutation(f);assert.throws(()=>prepareNextShotInput(f),{code:'REVIEWED_REFERENCE_REQUIRED'});
 }
});
test('unknown modes and stale review bytes cannot create a new shot',()=>{
 const f=fixture();f.request.sourceMode='automatic-fallback';assert.throws(()=>prepareNextShotInput(f),{code:'SHOT_SOURCE_MODE_INVALID'});
 f.request.sourceMode='new-keyframe';f.receipt.review.outputHash='old-source';assert.throws(()=>prepareNextShotInput(f),{code:'REFERENCE_REVIEW_STALE'});
});
test('version and prompt constraints are enforced without mutating the project',()=>{
 const f=fixture(),before=structuredClone(f.project);f.request.expectedRevision=6;
 assert.throws(()=>prepareNextShotInput(f),{code:'PROJECT_CHANGED'});assert.deepEqual(f.project,before);
 f.request.expectedRevision=7;f.request.brief=' ';assert.throws(()=>prepareNextShotInput(f),{code:'SHOT_BRIEF_INVALID'});
});
