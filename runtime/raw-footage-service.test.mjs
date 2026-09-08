import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRawFootageService } from './raw-footage-service.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),exec=promisify(execFile),ffmpeg=path.join(root,'workers/tools/ffmpeg.exe');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixtureWorker({jobRoot,request,onProgress}){
  const video=path.join(jobRoot,'edited.mp4'),width=request.aspect==='9:16'?1080:1920,height=request.aspect==='9:16'?1920:1080;
  await exec(ffmpeg,['-v','error','-i',request.sourceAssets[0].path,'-t',String(request.durationSeconds),'-vf',`scale=${width}:${height}`,'-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-r','24','-c:a','aac','-ar','48000','-ac','2',video],{windowsHide:true,timeout:30000});
  const outputHash=hash(await fs.readFile(video));
  const result={schemaVersion:1,kind:'raw-footage-edit',validated:true,status:'review_required',sourceMethod:'local-raw-footage-edit',outputs:{video:'edited.mp4'},timeline:[{id:'cut-1',assetId:request.sourceAssets[0].id,kind:'video',trimStart:0,duration:request.durationSeconds}],durationSeconds:request.durationSeconds,width,height,fps:24,provenance:{generationStatus:'edited',outputHash,promptPlan:request.editPlan,sources:request.sourceAssets.map(source=>({assetId:source.id,sha256:source.sha256}))},captionsAvailable:false,captionsStatus:'unavailable',diagnostics:[{code:'WHISPER_UNAVAILABLE',message:'No local transcription runtime in this isolated fixture.'}]};
  await fs.writeFile(path.join(jobRoot,'result.json'),JSON.stringify(result));onProgress?.({type:'progress',progress:0.9,stage:'CPU fixture encoded'});return result;
}
async function fixture(t,dependencies={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-raw-service-')),mediaDir=path.join(dataDir,'media'),jobsDir=path.join(dataDir,'jobs');await fs.mkdir(mediaDir);await fs.mkdir(jobsDir);
  const db=new DatabaseSync(path.join(dataDir,'vyrelum.sqlite'));db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT,PRIMARY KEY(project_id,revision));CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)');
  const original={name:'Original creator project',timeline:[{id:'old',assetId:'retained',duration:3}],latestOutput:{videoAssetId:'retained',status:'reviewed'},script:'Preserve this script',soundtrack:{assetId:'previous-narration',gain:1},audioTracks:[{assetId:'previous-rain',gain:0.5}],settings:{colorGrade:{contrast:1.3,saturation:1.2,gamma:0.9},fit:'contain'}};
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-1',1,JSON.stringify(original),'old','old');db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run('project-1',1,JSON.stringify(original),'old');
  const source=path.join(mediaDir,'source-1.mp4');await exec(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-threads','1','-c:a','aac',source],{windowsHide:true,timeout:30000});
  db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run('source-1','project-1',JSON.stringify({name:'Uploaded test source.mp4',mime:'video/mp4',kind:'video'}),source,'old');
  const dep={startWorker:async args=>({completion:fixtureWorker(args).then(()=>({exitCode:0})),cancel:async()=>{}}),...dependencies};
  const service=await createRawFootageService({db,dataDir,jobsDir,mediaDir,root,dependencies:dep});t.after(async()=>{await service.close();db.close();if(path.dirname(dataDir)===path.resolve(os.tmpdir())&&path.basename(dataDir).startsWith('vyrealm-raw-service-'))await fs.rm(dataDir,{recursive:true,force:true});});return {service,db,dataDir,jobsDir,mediaDir,source,original,dependencies:dep};
}
const input={projectId:'project-1',expectedRevision:1,brief:'Edit my uploaded footage into a short vertical reel.',assetIds:['source-1'],durationSeconds:2,aspect:'9:16',captionsEnabled:true};
async function terminal(service){for(let n=0;n<1000;n++){const state=await service.state('project-1');if(['review_required','blocked','failed','cancelled','rejected','succeeded'].includes(state.job?.status))return state;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Raw fixture did not settle');}

test('raw footage creates a durable plan, renders a real MP4, and restores an editable source timeline',async t=>{
  const f=await fixture(t),started=await f.service.start(input);assert.equal(started.project.revision,2);assert.equal(started.job.type,'raw-footage-edit');assert.equal(started.job.input.productionRun,true);assert.equal(started.job.input.runKind,'raw-footage');assert.deepEqual(started.project.latestOutput,f.original.latestOutput);
  const done=await terminal(f.service);assert.equal(done.job.status,'review_required',done.job.error);assert.equal(done.job.output.provenance.generationStatus,'edited');assert.equal(done.job.output.reviewRequired,true);assert.equal(done.project.timeline[0].assetId,'source-1');assert.equal(done.project.timeline[0].trimStart,0);assert.equal(done.project.script,f.original.script);assert.equal(done.project.latestOutput.status,'review_required');assert.equal(done.project.transcript.length,0);assert.equal(done.project.captionsEnabled,false);assert.equal(done.job.output.verification.ok,true);assert.match(done.job.output.provenance.outputHash,/^[a-f0-9]{64}$/);assert.equal(done.project.soundtrack,null);assert.deepEqual(done.project.audioTracks,[]);assert.equal(done.project.settings.colorGrade,null);assert.equal(done.project.settings.fit,'cover');assert.equal(done.project.durationSeconds,2);assert.equal(done.project.rawFootagePlan.renderProfile.captionStyle,'minimal-lower');assert.deepEqual(done.project.latestOutput.diagnostics,done.job.output.diagnostics);assert.deepEqual(JSON.parse(f.db.prepare('SELECT document FROM project_revisions WHERE revision=1').get().document).soundtrack,f.original.soundtrack);
  assert.equal(f.db.prepare('SELECT count(*) n FROM project_revisions').get().n,3);assert.ok(done.job.output.diagnostics.some(d=>d.code==='WHISPER_UNAVAILABLE'));assert.equal(JSON.parse(await fs.readFile(path.join(f.jobsDir,done.job.id,'request.json'),'utf8')).sourceAssets[0].sha256,hash(await fs.readFile(f.source)));
});

test('stale revisions, arbitrary paths, short sources, and other-project media fail before a worker starts',async t=>{
  const f=await fixture(t,{startWorker:()=>assert.fail('worker invoked')});await assert.rejects(f.service.start({...input,expectedRevision:2}),{code:'RAW_REVISION_CONFLICT'});await assert.rejects(f.service.start({...input,sourcePath:f.source}),{code:'RAW_REQUEST'});await assert.rejects(f.service.start({...input,durationSeconds:20}),{code:'RAW_SOURCE_TOO_SHORT'});f.db.prepare('UPDATE assets SET project_id=?').run('other-project');await assert.rejects(f.service.start(input),{code:'RAW_SOURCE_UNAVAILABLE'});assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision,1);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});

test('registered model outputs and rejected assets cannot silently become uploaded raw footage',async t=>{
  const f=await fixture(t,{startWorker:()=>assert.fail('worker invoked')});f.db.prepare('UPDATE assets SET document=?').run(JSON.stringify({mime:'video/mp4',kind:'video',jobId:'rejected-generation',review:{verdict:'rejected'}}));await assert.rejects(f.service.start(input),{code:'RAW_SOURCE_NOT_UPLOAD'});
});

test('review checks the saved and registered MP4 hash, and rejected outputs cannot be reapproved',async t=>{
  const f=await fixture(t);await f.service.start(input);const done=await terminal(f.service),job=done.job,outputHash=job.output.provenance.outputHash;
  await assert.rejects(f.service.review({jobId:job.id,expectedOutputHash:'0'.repeat(64),verdict:'passed',notes:'Wrong file'}),{code:'RAW_OUTPUT_MISMATCH'});
  const approved=await f.service.review({jobId:job.id,expectedOutputHash:outputHash,verdict:'passed',notes:'Isolated CPU test fixture; verified cuts and actual audio.'});assert.equal(approved.job.status,'succeeded');assert.equal(approved.project.latestOutput.status,'reviewed');
  const rejected=await f.service.review({jobId:job.id,expectedOutputHash:outputHash,verdict:'rejected',notes:'Revoke fixture review.'});assert.equal(rejected.job.status,'rejected');assert.equal(rejected.project.latestOutput.status,'rejected');await assert.rejects(f.service.review({jobId:job.id,expectedOutputHash:outputHash,verdict:'passed',notes:'Cannot revive rejected output'}),{code:'RAW_REJECTED_OUTPUT'});
});

test('a later project edit retains the new movie without overwriting the current timeline or output',async t=>{
  let finish,ready;const produced=new Promise(resolve=>{ready=resolve;});const f=await fixture(t,{startWorker:async args=>({completion:(async()=>{await fixtureWorker(args);ready();await new Promise(resolve=>{finish=resolve;});return {exitCode:0};})(),cancel:async()=>finish?.()})});await f.service.start(input);await produced;
  const row=f.db.prepare('SELECT * FROM projects').get(),doc=JSON.parse(row.document);doc.userCorrection='Keep this correction';f.db.prepare('UPDATE projects SET revision=?,document=? WHERE id=?').run(row.revision+1,JSON.stringify(doc),row.id);finish();const done=await terminal(f.service);assert.equal(done.job.status,'review_required');assert.equal(done.job.output.promoted,false);assert.equal(done.project.userCorrection,doc.userCorrection);assert.deepEqual(done.project.timeline,f.original.timeline);assert.deepEqual(done.project.latestOutput,f.original.latestOutput);await assert.rejects(f.service.review({jobId:done.job.id,expectedOutputHash:done.job.output.provenance.outputHash,verdict:'passed',notes:'Stale movie'}),{code:'RAW_PROJECT_CHANGED'});
});

test('single CPU worker cancellation completes without registering a movie',async t=>{
  let finish;const f=await fixture(t,{startWorker:async()=>({completion:new Promise(resolve=>{finish=resolve;}),cancel:async()=>finish({exitCode:1})})});const started=await f.service.start(input);for(let n=0;n<100&&!finish;n++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(finish);await assert.rejects(f.service.start({...input,expectedRevision:2}),{code:'RAW_BUSY'});await f.service.cancel(started.job.id);assert.equal((await terminal(f.service)).job.status,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,1);
});

test('worker paths and changed sources are rejected before asset registration',async t=>{
  const f=await fixture(t,{startWorker:async args=>({completion:(async()=>{const result=await fixtureWorker(args);result.outputs.video='../foreign.mp4';await fs.writeFile(path.join(args.jobRoot,'result.json'),JSON.stringify(result));return {exitCode:0};})(),cancel:async()=>{}})});await f.service.start(input);const done=await terminal(f.service);assert.equal(done.job.status,'blocked');assert.match(done.job.error,/RAW_OUTPUT_PATH/);assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,1);
});

test('startup recovery changes only interrupted raw service jobs and does not rerender',async t=>{
  const f=await fixture(t);await f.service.close();const insert=f.db.prepare('INSERT INTO jobs(id,project_id,type,status,input,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');insert.run('owned','project-1','raw-footage-edit','running',JSON.stringify({serviceOwner:'raw-footage-service-v1'}),'now','now');insert.run('foreign','project-1','render','running','{}','now','now');const recovered=await createRawFootageService({...f,root,dependencies:{startWorker:()=>assert.fail('worker')}});assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get('owned').status,'failed');assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get('foreign').status,'running');await recovered.close();
});

test('default real CPU worker completes the product receipt and its approved MP4 can reopen',async t=>{
  const f=await fixture(t,{startWorker:undefined});const started=await f.service.start({...input,brief:'Edit my uploaded footage into a short horizontal reel.',aspect:'16:9',captionsEnabled:false});const done=await terminal(f.service);assert.equal(done.job.status,'review_required',done.job.error);assert.equal(done.job.output.width,1920);assert.equal(done.job.output.height,1080);assert.equal(done.job.output.captionsStatus,'disabled');assert.equal(done.job.output.provenance.mediaGenerationModelInvoked,false);assert.equal(done.job.output.verification.checks.fullDecode.ok,true);assert.equal(done.project.latestOutput.audioStatus,'original-audio');assert.equal(done.project.latestOutput.audioNormalization,'peak-limit-short-clip');assert.equal(done.project.rawFootagePlan.renderProfile.audioNormalization,'peak-limit-short-clip');
  const reviewed=await f.service.review({jobId:started.job.id,expectedOutputHash:done.job.output.provenance.outputHash,verdict:'passed',notes:'Isolated CPU test bars only; real worker receipt and download bytes verified.'});assert.equal(reviewed.job.status,'succeeded');await f.service.close();const reopened=await createRawFootageService({...f,root,dependencies:f.dependencies});assert.equal((await reopened.state('project-1')).project.timeline[0].assetId,'source-1');assert.equal((await reopened.state('project-1')).job.status,'succeeded');await reopened.close();
});

test('bounded worker timeout cancels its child and never publishes a completed state',async t=>{
  let finish;const f=await fixture(t,{maxRuntimeMs:25,startWorker:async()=>({completion:new Promise(resolve=>{finish=resolve;}),cancel:async()=>finish({exitCode:1})})});await f.service.start(input);const done=await terminal(f.service);assert.equal(done.job.status,'blocked');assert.match(done.job.error,/RAW_TIMEOUT/);assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,1);
});

test('a saved explicit range overrides duration hints and survives verification without replanning',async t=>{
  const f=await fixture(t,{startWorker:undefined});const started=await f.service.start({...input,brief:'source 1 from 1s to 2s; horizontal; fit',durationSeconds:20,captionsEnabled:false});assert.equal(started.project.rawFootagePlan.durationSeconds,1);assert.equal(started.project.rawFootagePlan.aspect,'16:9');assert.equal(started.project.rawFootagePlan.cuts[0].trimStart,1);
  const request=JSON.parse(await fs.readFile(path.join(f.jobsDir,started.job.id,'request.json'),'utf8'));assert.equal(request.durationSeconds,20);assert.equal(request.editPlan.durationSeconds,1);assert.equal(request.editPlan.framing,'fit');const done=await terminal(f.service);assert.equal(done.job.status,'review_required',done.job.error);assert.equal(done.project.durationSeconds,1);assert.equal(done.project.settings.framing,'fit');assert.equal(done.project.settings.fit,'contain');assert.equal(done.project.settings.audioTargetLUFS,-16);assert.equal(done.project.settings.captionStyle,'minimal-lower');assert.equal(done.project.timeline[0].trimStart,1);assert.equal(done.job.output.provenance.promptPlan.durationSeconds,1);
  const reviewed=await f.service.review({jobId:started.job.id,expectedOutputHash:done.job.output.provenance.outputHash,verdict:'passed',notes:'Isolated source-range fixture; persisted immutable explicit cut verified.'});assert.equal(reviewed.job.status,'succeeded');
});
