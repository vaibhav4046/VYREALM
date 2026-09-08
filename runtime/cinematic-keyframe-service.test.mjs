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
import { createCinematicKeyframeService } from './cinematic-keyframe-service.mjs';
import { wanWorkflow, WAN_MODELS } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';
import { verifyKeyframeEvidence, verifyOwnedGeneratedKeyframe } from './keyframe-production.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));const exec=promisify(execFile),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function emittedFixture({jobRoot,request,onProgress}) {
 // CPU test bars prove only service evidence mechanics. They never enter the user's store or catalogue.
 const stage=path.join(jobRoot,'keyframe');await fs.mkdir(path.join(stage,'frames'),{recursive:true});const image=path.join(stage,'frames','00000.png');
 await exec(path.join(root,'workers/tools/ffmpeg.exe'),['-v','error','-f','lavfi','-i',`testsrc2=s=${request.width}x${request.height}`,'-frames:v','1','-threads','1',image],{windowsHide:true,timeout:30000});
 const workflow=wanWorkflow({...request,frames:1,prefix:`vyrealm/${path.basename(jobRoot)}/keyframe`}),workflowHash=hashJson(workflow),promptId='fixture-owned-prompt',descriptor={filename:'keyframe_00001_.png',subfolder:`vyrealm/${path.basename(jobRoot)}`,type:'output'},bytes=await fs.readFile(image),outputHash=sha(bytes);
 await fs.writeFile(path.join(stage,'workflow.json'),JSON.stringify(workflow));await fs.writeFile(path.join(stage,'history.json'),JSON.stringify({prompt:[0,promptId,workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[descriptor]}}}));await fs.writeFile(path.join(stage,'provider.jsonl'),['submitted','completed'].map(event=>JSON.stringify({event,promptId,workflowHash})).join('\n'));await fs.writeFile(path.join(stage,'frames.json'),JSON.stringify([{index:0,path:'frames/00000.png',sha256:outputHash,providerOutput:descriptor}]));
 const evidence=await verifyKeyframeEvidence({jobRoot,request});const receipt={schemaVersion:1,kind:'generated-keyframe',status:'review_required',validated:true,sourceMethod:'local-generated-keyframe',provenance:{status:'generated',generationStatus:'generated',mediaKind:'image',providerId:'comfyui-local',modelId:WAN_MODELS.diffusion,promptId,workflowHash,evidenceHash:evidence.evidenceHash,outputHash,seed:request.seed,prompt:request.prompt,negativePrompt:request.negativePrompt,sourceResolution:{width:request.width,height:request.height},keyframe:{promptId,outputHash},semanticQuality:'unreviewed'},verification:{ok:true},outputs:{image:'keyframe/frames/00000.png'}};await fs.writeFile(path.join(jobRoot,'result.json'),JSON.stringify(receipt));onProgress?.({stage:'Fixture complete',progress:1});
}
async function fixture(t,overrides={}) {
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-cinematic-service-')),jobsDir=path.join(dataDir,'jobs'),mediaDir=path.join(dataDir,'media');await fs.mkdir(jobsDir);await fs.mkdir(mediaDir);const db=new DatabaseSync(path.join(dataDir,'vyrelum.sqlite'));
 db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT,PRIMARY KEY(project_id,revision));CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)');
 const original={name:'My existing film',timeline:[{assetId:'retained-old-video',duration:5}],latestOutput:{videoAssetId:'retained-old-video',status:'reviewed'},characters:[],brief:'Old direction'};db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-1',1,JSON.stringify(original),'old','old');db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run('project-1',1,JSON.stringify(original),'old');
 const events=[];const dependencies={preflight:async()=>({available:true,freeDiskBytes:1024**3}),acquireLease:async()=>{events.push('lease');const release=async()=>events.push('released');release.registerChild=async()=>events.push('registered');return release;},startWorker:async args=>({pid:process.pid,completion:emittedFixture(args).then(()=>({exitCode:0})),cancel:async()=>events.push('cancelled-child')}),cancelProvider:async()=>events.push('cancelled-provider'),...overrides};
 const service=await createCinematicKeyframeService({db,dataDir,jobsDir,mediaDir,root,dependencies});t.after(async()=>{await service.close();db.close();if(path.dirname(dataDir)===path.resolve(os.tmpdir())&&path.basename(dataDir).startsWith('vyrealm-cinematic-service-'))await fs.rm(dataDir,{recursive:true,force:true});});
 return {service,db,dataDir,jobsDir,mediaDir,original,events};
}
async function terminal(service){for(let i=0;i<300;i++){const result=await service.state('project-1');if(['review_required','blocked','failed','cancelled','rejected','succeeded'].includes(result.job?.status))return result;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Fixture job did not settle');}
const input={projectId:'project-1',expectedRevision:1,brief:'Create an accurate Mahabharata trailer, Arjuna and Krishna between two armies at Kurukshetra.'};

test('product start saves its own direction and one image job while preserving completed film/history',async t=>{
 const f=await fixture(t);const started=await f.service.start(input);assert.equal(started.project.revision,2);assert.equal(started.job.type,'generation-keyframe');assert.equal(started.job.productionRun,true);assert.equal(started.job.input.productionRun,true);
 assert.deepEqual(started.project.latestOutput,f.original.latestOutput);assert.deepEqual(started.project.timeline,f.original.timeline);assert.equal(started.project.productionPlan.renderable,false);
 const final=await terminal(f.service);assert.equal(final.job.status,'review_required');assert.equal(final.job.output.reviewRequired,true);assert.ok(final.job.output.assetId);assert.equal(final.job.output.provenance.mediaKind,'image');assert.equal(final.job.progress,100);
 const request=JSON.parse(await fs.readFile(path.join(f.jobsDir,started.job.id,'request.json'),'utf8'));assert.equal(request.productionRun,undefined);assert.equal(request.width,1024);assert.equal(request.height,576);assert.equal(request.steps,20);
 assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,1);assert.ok(f.events.indexOf('released')>f.events.indexOf('registered'));
});

test('invalid or stale requests do not edit the project or invoke a worker',async t=>{
 const f=await fixture(t,{startWorker:()=>assert.fail('worker')});await assert.rejects(f.service.start({...input,expectedRevision:2}),{code:'CINEMATIC_REVISION_CONFLICT'});await assert.rejects(f.service.start({...input,brief:'A modern smartphone advertisement'}));await assert.rejects(f.service.start({...input,prompt:'arbitrary external prompt'}),{code:'CINEMATIC_REQUEST'});assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision,1);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});

test('missing local provider blocks with a diagnostic and never substitutes geometry',async t=>{
 const f=await fixture(t,{preflight:async()=>{throw Object.assign(new Error('No qualified local model installed'),{code:'KEYFRAME_PROVIDER_UNAVAILABLE'});},startWorker:()=>assert.fail('worker')});await f.service.start(input);const state=await terminal(f.service);assert.equal(state.job.status,'blocked');assert.match(state.job.error,/KEYFRAME_PROVIDER_UNAVAILABLE/);assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,0);assert.deepEqual(state.project.latestOutput,f.original.latestOutput);
});

test('approval binds actual PNG and receipt; rejected casting is never admitted as a reusable reference',async t=>{
 const f=await fixture(t);await f.service.start(input);const result=await terminal(f.service),job=result.job,hash=job.output.provenance.outputHash;
 await assert.rejects(f.service.review({jobId:job.id,expectedOutputHash:'0'.repeat(64),verdict:'passed',notes:'Wrong hash'}));
 const approved=await f.service.review({jobId:job.id,expectedOutputHash:hash,verdict:'passed',notes:'CPU evidence fixture only; mechanics checked, not a production casting assessment.'});assert.equal(approved.job.status,'succeeded');assert.equal(approved.job.output.reviewRequired,false);
 const verified=await verifyOwnedGeneratedKeyframe({jobsDir:f.jobsDir,mediaDir:f.mediaDir,db:f.db,sourceJobId:job.id,projectId:'project-1',expectedHash:hash});assert.equal(verified.outputHash,hash);
 const rejected=await f.service.review({jobId:job.id,expectedOutputHash:hash,verdict:'rejected',notes:'Revoke this test image; never use it for production.'});assert.equal(rejected.job.status,'rejected');assert.equal(rejected.project.characters.find(c=>/arjuna/i.test(c.name)).faceReference.status,'rejected');
 await assert.rejects(f.service.review({jobId:job.id,expectedOutputHash:hash,verdict:'passed',notes:'Cannot undo rejection'}),{code:'CINEMATIC_REJECTED_REFERENCE'});await assert.rejects(verifyOwnedGeneratedKeyframe({jobsDir:f.jobsDir,mediaDir:f.mediaDir,db:f.db,sourceJobId:job.id,projectId:'project-1',expectedHash:hash}));
});

test('cancel waits for its child and releases the lease; another project is never animated',async t=>{
 let finish;const f=await fixture(t,{startWorker:async()=>({pid:process.pid,completion:new Promise(resolve=>{finish=resolve;}),cancel:async()=>finish({exitCode:1})})});const started=await f.service.start(input);for(let i=0;i<50&&!finish;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(finish);await f.service.cancel(started.job.id);const final=await terminal(f.service);assert.equal(final.job.status,'cancelled');assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,0);assert.ok(f.events.includes('released'));
});

test('cancel identifies its exact queued workflow even if submission logging was interrupted',async t=>{
 const f=await fixture(t);const jobRoot=path.join(f.jobsDir,'owned-job');await fs.mkdir(jobRoot);const request={projectId:'project-1',expectedRevision:1,prompt:'Original Arjuna casting',negativePrompt:'test exclusion',seed:1,width:1024,height:576,steps:20,queuePolicy:'idle'};await fs.writeFile(path.join(jobRoot,'request.json'),JSON.stringify(request));
 const workflow=wanWorkflow({...request,frames:1,prefix:'vyrealm/owned-job/keyframe'}),foreign=wanWorkflow({...request,frames:1,prefix:'vyrealm/foreign-job/keyframe'}),cancelled=[];
 const provider={baseUrl:'http://127.0.0.1:8188',fetch:async()=>new Response(JSON.stringify({queue_running:[[1,'foreign-prompt',foreign]],queue_pending:[[2,'owned-unlogged-prompt',workflow]]})),cancel:async id=>cancelled.push(id)};
 const {cancelOwnedCinematicPrompt}=await import('./cinematic-keyframe-service.mjs');await cancelOwnedCinematicPrompt({jobRoot,provider});assert.deepEqual(cancelled,['owned-unlogged-prompt']);
});

test('revision changes retain the image but cannot approve it as the current character reference',async t=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});let generated;const ready=new Promise(resolve=>{generated=resolve;});
 const f=await fixture(t,{startWorker:async args=>({pid:process.pid,completion:(async()=>{await emittedFixture(args);generated();await pending;return {exitCode:0};})(),cancel:async()=>release()})});await f.service.start(input);await ready;
 const row=f.db.prepare('SELECT * FROM projects').get(),document=JSON.parse(row.document);document.userNote='Keep this later creative change';f.db.prepare('UPDATE projects SET revision=?,document=? WHERE id=?').run(row.revision+1,JSON.stringify(document),row.id);release();const result=await terminal(f.service);
 assert.equal(result.job.status,'review_required');assert.equal(result.job.output.promoted,false);assert.equal(result.project.userNote,document.userNote);
 await assert.rejects(f.service.review({jobId:result.job.id,expectedOutputHash:result.job.output.provenance.outputHash,verdict:'passed',notes:'Cannot approve stale direction'}),{code:'CINEMATIC_PROJECT_CHANGED'});
});

test('startup recovery affects only product-owned interrupted jobs and never starts inference',async t=>{
 const f=await fixture(t);await f.service.close();const insert=f.db.prepare('INSERT INTO jobs(id,project_id,type,status,input,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
 insert.run('interrupted-owned','project-1','generation-keyframe','running',JSON.stringify({serviceOwner:'cinematic-keyframe-service-v1',productionRun:true}),'now','now');insert.run('foreign-keyframe','project-1','generation-keyframe','running','{}','now','now');const cancelled=[];
 const recovered=await createCinematicKeyframeService({...f,root,dependencies:{cancelProvider:async id=>cancelled.push(id),startWorker:()=>assert.fail('inference')}});assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get('interrupted-owned').status,'failed');assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get('foreign-keyframe').status,'running');assert.deepEqual(cancelled,['interrupted-owned']);await recovered.close();
});
