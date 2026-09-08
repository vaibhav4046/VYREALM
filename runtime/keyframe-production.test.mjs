import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateKeyframeRequest,verifyKeyframeEvidence,verifyOwnedGeneratedKeyframe } from './keyframe-production.mjs';
import { wanWorkflow,WAN_MODELS } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';
import { verifyOwnedLtxReference } from './ltx-production.mjs';
import { parseKeyframeArgs,reviewGeneratedKeyframe } from '../scripts/generate-keyframe.mjs';
const exec=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const request={projectId:'fixture-project',expectedRevision:1,prompt:'Original character casting study',seed:1,width:512,height:288,steps:8,queuePolicy:'fifo'};

async function fixture(t,overrides={}){
  const sample={...request,...overrides};
  const dataDir=await mkdtemp(join(tmpdir(),'vyrealm-keyframe-cpu-')),jobsDir=join(dataDir,'jobs'),mediaDir=join(dataDir,'media'),sourceJobId=randomUUID(),jobRoot=join(jobsDir,sourceJobId),stageRoot=join(jobRoot,'keyframe');
  await mkdir(join(stageRoot,'frames'),{recursive:true});await mkdir(mediaDir);
  t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const imagePath=join(stageRoot,'frames','00000.png');
  // Actual CPU PNG decoding fixture. These test bars are never submitted as
  // production imagery, model output, or catalogue media.
  await exec('workers/tools/ffmpeg.exe',['-v','error','-f','lavfi','-i','testsrc2=s=512x288','-frames:v','1','-threads','1',imagePath],{windowsHide:true,timeout:30000});
  const bytes=await readFile(imagePath),outputHash=sha(bytes),workflow=wanWorkflow({...sample,frames:1,prefix:`vyrealm/${sourceJobId}/keyframe`}),workflowHash=hashJson(workflow),promptId='cpu-fixture-prompt';
  const descriptor={filename:'keyframe_00001_.png',subfolder:`vyrealm/${sourceJobId}`,type:'output'};
  await writeFile(join(jobRoot,'request.json'),JSON.stringify(validateKeyframeRequest(sample)));
  await writeFile(join(stageRoot,'workflow.json'),JSON.stringify(workflow));
  await writeFile(join(stageRoot,'history.json'),JSON.stringify({prompt:[0,promptId,workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[descriptor]}}}));
  await writeFile(join(stageRoot,'provider.jsonl'),['submitted','completed'].map(event=>JSON.stringify({event,promptId,workflowHash})).join('\n'));
  await writeFile(join(stageRoot,'frames.json'),JSON.stringify([{index:0,path:'frames/00000.png',sha256:outputHash,providerOutput:descriptor}]));
  const evidence=await verifyKeyframeEvidence({jobRoot,request:sample});
  const provenance={status:'generated',generationStatus:'generated',mediaKind:'image',providerId:'comfyui-local',modelId:WAN_MODELS.diffusion,outputHash,evidenceHash:evidence.evidenceHash,workflowHash,promptId,prompt:sample.prompt,seed:sample.seed,...(sample.negativePrompt===undefined?{}:{negativePrompt:sample.negativePrompt}),keyframe:{promptId,outputHash}};
  const receipt={kind:'generated-keyframe',validated:true,verification:{ok:true},provenance,outputs:{image:'keyframe/frames/00000.png'}};
  await writeFile(join(jobRoot,'result.json'),JSON.stringify(receipt));
  const databasePath=join(dataDir,'vyrelum.sqlite'),db=new DatabaseSync(databasePath);
  db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,type TEXT,status TEXT,output TEXT,stage TEXT,updated_at TEXT); CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);');
  const assetPath=join(mediaDir,'fixture.png');await writeFile(assetPath,bytes);
  const stored={...receipt,assets:{image:'fixture-asset'}};
  db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)').run(sourceJobId,request.projectId,'generation-keyframe','review_required',JSON.stringify(stored),'fixture','now');
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run('fixture-asset',request.projectId,JSON.stringify({jobId:sourceJobId}),assetPath,'now');db.close();
  return{dataDir,jobsDir,mediaDir,sourceJobId,jobRoot,stageRoot,receipt,stored,projectId:request.projectId,expectedHash:outputHash,imagePath,promptId,databasePath,evidence,assetPath};
}

test('keyframe profile and CLI require explicit project, input, and review hash',()=>{
  assert.equal(validateKeyframeRequest(request).kind,'generation-keyframe');
  for(const change of [{width:3840},{steps:1},{seed:-1},{frames:121},{prompt:''},{negativePrompt:''},{negativePrompt:'x'.repeat(2001)},{negativePrompt:[]},{queuePolicy:'parallel'},{expectedRevision:0},{kind:'imported'}])assert.throws(()=>validateKeyframeRequest({...request,...change}),/KEYFRAME_/);
  assert.equal(parseKeyframeArgs(['--request-file','fixture.json']).run,false);
  assert.throws(()=>parseKeyframeArgs([]),/KEYFRAME_/);
  assert.throws(()=>parseKeyframeArgs(['--review-job',randomUUID(),'--verdict','passed']),/KEYFRAME_/);
});
test('custom casting exclusions are hash-bound and cannot change after generation',async t=>{
  const negativePrompt='beard, moustache, facial hair, topknot, hair bun, segmented armour';
  const f=await fixture(t,{negativePrompt});
  assert.equal((await verifyOwnedGeneratedKeyframe({...f,requireReview:false})).request.negativePrompt,negativePrompt);
  const graph=JSON.parse(await readFile(join(f.stageRoot,'workflow.json'),'utf8'));
  assert.ok(graph['6'].inputs.text.endsWith(negativePrompt));
  const saved=JSON.parse(await readFile(join(f.jobRoot,'request.json'),'utf8'));saved.negativePrompt='different exclusions';
  await writeFile(join(f.jobRoot,'request.json'),JSON.stringify(saved));
  await assert.rejects(verifyOwnedGeneratedKeyframe({...f,requireReview:false}),/KEYFRAME_WORKFLOW/);
});
test('actual PNG decode, sampler ownership, provider logs and byte integrity are required',async t=>{
  const f=await fixture(t);
  assert.equal(f.evidence.decodedFrames,1);
  await assert.rejects(verifyOwnedGeneratedKeyframe(f),/KEYFRAME_REVIEW/);
  assert.equal((await verifyOwnedGeneratedKeyframe({...f,requireReview:false})).sha256,f.expectedHash);
  const graph=JSON.parse(await readFile(join(f.stageRoot,'workflow.json'),'utf8'));graph['10'].inputs.images=['7',0];await writeFile(join(f.stageRoot,'workflow.json'),JSON.stringify(graph));
  await assert.rejects(verifyOwnedGeneratedKeyframe({...f,requireReview:false}),/KEYFRAME_WORKFLOW/);
});
test('hash-bound CPU still review admits the separate LTX branch and changed pixels revoke it',async t=>{
  const f=await fixture(t),notesFile=join(f.dataDir,'notes.txt');await writeFile(notesFile,'CPU evidence fixture review only; never catalogue content.');
  const reviewed=await reviewGeneratedKeyframe({dataDir:f.dataDir,reviewJobId:f.sourceJobId,verdict:'passed',notesFile,expectedHash:f.expectedHash});
  assert.equal(reviewed.review.mediaKind,'image');
  const db=new DatabaseSync(f.databasePath);try{assert.equal((await verifyOwnedGeneratedKeyframe({...f,db})).sha256,f.expectedHash);}finally{db.close();}
  const reference={path:f.imagePath,sourceJobId:f.sourceJobId,sha256:f.expectedHash,promptId:f.promptId};
  assert.equal((await verifyOwnedLtxReference({jobsDir:f.jobsDir,projectId:f.projectId,reference})).sha256,f.expectedHash);
  await writeFile(f.imagePath,'changed pixels');
  await assert.rejects(verifyOwnedLtxReference({jobsDir:f.jobsDir,projectId:f.projectId,reference}),/KEYFRAME_OUTPUT_HASH/);
});
test('rejected casting, cross-project source and replaced served asset cannot become approved references',async t=>{
  const f=await fixture(t),notesFile=join(f.dataDir,'notes.txt');await writeFile(notesFile,'Casting rejected in CPU evidence fixture.');
  await reviewGeneratedKeyframe({dataDir:f.dataDir,reviewJobId:f.sourceJobId,verdict:'rejected',notesFile,expectedHash:f.expectedHash});
  await assert.rejects(verifyOwnedGeneratedKeyframe(f),/KEYFRAME_REVIEW/);
  await assert.rejects(verifyOwnedGeneratedKeyframe({...f,requireReview:false,projectId:'other'}),/KEYFRAME_PROJECT/);
  await writeFile(f.assetPath,'replaced served bytes');const db=new DatabaseSync(f.databasePath);
  try{await assert.rejects(verifyOwnedGeneratedKeyframe({...f,db,requireReview:false}),/KEYFRAME_ASSET/);}finally{db.close();}
});
test('missing provider completion and imported receipt fail even with an image review label',async t=>{
  const f=await fixture(t);await writeFile(join(f.stageRoot,'provider.jsonl'),'');
  await assert.rejects(verifyOwnedGeneratedKeyframe({...f,requireReview:false}),/KEYFRAME_PROVIDER_LOG/);
  f.receipt.provenance.generationStatus='imported';await writeFile(join(f.jobRoot,'result.json'),JSON.stringify(f.receipt));
  await assert.rejects(verifyOwnedGeneratedKeyframe({...f,requireReview:false}),/KEYFRAME_RECEIPT/);
});
