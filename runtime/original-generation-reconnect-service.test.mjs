import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createOriginalGenerationService } from './original-generation-service.mjs';
import { runOriginalWithReconnect, writeOriginalWorkerFailure } from './original-generation-monitor.mjs';
import { wanWorkflow } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';

const input={projectId:'project-1',expectedRevision:1,brief:'An original ceramic cup with steam.',seed:7};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function fixture(t,{maxReconnects=2,workerTimeoutMs,staleError=false}={}){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-service-monitor-')),jobsDir=path.join(dataDir,'jobs'),mediaDir=path.join(dataDir,'media');await fs.mkdir(jobsDir);await fs.mkdir(mediaDir);
 const db=new DatabaseSync(path.join(dataDir,'vyrelum.sqlite'));db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT,PRIMARY KEY(project_id,revision));CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)');
 const document=JSON.stringify({name:'Isolated lease test',brief:'Overall project description',timeline:[]});db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(input.projectId,1,document,'old','old');db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run(input.projectId,1,document,'old');
 const events=[],paused=deferred(),resume=deferred();let submissions=0,outputs=0,held=false,workerArgs;
 const dependencies={workerTimeoutMs,preflight:async()=>({available:true}),acquireLease:async()=>{assert.equal(held,false);held=true;events.push('lease-acquired');const release=async()=>{held=false;events.push('lease-released');};release.registerChild=async()=>{};return release;},cancelProvider:async id=>events.push(`cancel:${id}`),startWorker:async args=>{
  workerArgs=args;let calls=0;
  const provider={generate_video:async()=>{submissions++;return{promptId:'retained-prompt'};},fetch:async()=>{throw new Error('No network is used by this fixture');}};
  const completion=runOriginalWithReconnect({...args,provider,maxReconnects,wait:async()=>{paused.resolve();await resume.promise;},produce:async({provider})=>{
   calls++;if(calls===1){await provider.generate_video();const workflow=wanWorkflow({...args.request,frames:1,prefix:`vyrealm/${path.basename(args.jobRoot)}/keyframe`});await fs.mkdir(path.join(args.jobRoot,'keyframe'));await fs.writeFile(path.join(args.jobRoot,'keyframe/workflow.json'),JSON.stringify(workflow));await fs.writeFile(path.join(args.jobRoot,'keyframe/provider.jsonl'),JSON.stringify({event:'submitted',promptId:'retained-prompt',workflowHash:hashJson(workflow)})+'\n');throw Object.assign(new Error('status polling lost'),{code:'PROVIDER_POLL_UNAVAILABLE'});}
   outputs++;return{descriptorFixtureOnly:true};
  }}).then(()=>({exitCode:1,error:'Intentional end of monitor fixture; no media was produced or accepted.'})).catch(async error=>{await writeOriginalWorkerFailure({...args,runId:staleError?'different-run-id':args.runId,error});return{exitCode:1,error:'Untrusted stderr mentions PROVIDER_POLL_UNAVAILABLE but does not classify recovery.'};});
  return{pid:process.pid,completion,cancel:async()=>{resume.resolve();await completion;}};
 }};
 const service=await createOriginalGenerationService({db,dataDir,jobsDir,mediaDir,dependencies});
 t.after(async()=>{resume.resolve();await service.close();db.close();assert.equal(path.dirname(dataDir),path.resolve(os.tmpdir()));await fs.rm(dataDir,{recursive:true,force:true});});
 return{service,db,events,paused,resume,jobsDir,counts:()=>({submissions,outputs,held}),worker:()=>workerArgs};
}
async function terminal(service){for(let i=0;i<500;i++){const s=service.state(input.projectId);if(s.job&&!['queued','running','validating','cancelling'].includes(s.job.status))return s;await new Promise(r=>setTimeout(r,5));}assert.fail('Fixture did not settle');}

test('service holds one GPU lease and active job while worker reconnects; no duplicate admission or premature cancellation',async t=>{
 const f=await fixture(t),admission=await f.service.start(input);await f.paused.promise;
 assert.deepEqual(f.counts(),{submissions:1,outputs:0,held:true});assert.equal(f.service.state(input.projectId).job.status,'running');assert.equal(f.events.filter(x=>x.startsWith('cancel:')).length,0);assert.equal(f.db.prepare('SELECT attempts FROM jobs WHERE id=?').get(admission.job.id).attempts,1);
 const originalDeadline=f.worker().deadlineAt;assert.equal(originalDeadline-f.worker().startedAt,20*60000);
 await assert.rejects(f.service.start({...input,expectedRevision:2}),{code:'ORIGINAL_BUSY'});assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,1);
 f.resume.resolve();const finished=await terminal(f.service);assert.equal(finished.job.status,'blocked','the descriptor fixture is deliberately not accepted as a film');assert.deepEqual(f.counts(),{submissions:1,outputs:1,held:false});assert.equal(f.worker().deadlineAt,originalDeadline);assert.equal(f.events.filter(x=>x==='lease-released').length,1);
});
for(const action of ['cancel','close'])test(`explicit service ${action} during reconnect stops the owned prompt and releases its lease`,async t=>{
 const f=await fixture(t),started=await f.service.start(input);await f.paused.promise;
 if(action==='cancel')await f.service.cancel(started.job.id);else await f.service.close();
 const s=await terminal(f.service);assert.equal(s.job.status,'cancelled');assert.equal(s.job.output,null);assert.deepEqual(f.counts(),{submissions:1,outputs:0,held:false});assert.ok(f.events.includes(`cancel:${started.job.id}`));assert.equal(f.events.filter(x=>x==='lease-released').length,1);
});
test('the original service deadline expires during reconnect without a fresh timeout or another inference',async t=>{
 const f=await fixture(t,{workerTimeoutMs:500});await f.service.start(input);await f.paused.promise;const s=await terminal(f.service);
 assert.equal(s.job.status,'blocked');assert.match(s.job.error,/ORIGINAL_TIMEOUT/);assert.equal(f.worker().deadlineAt-f.worker().startedAt,500);assert.deepEqual(f.counts(),{submissions:1,outputs:0,held:false});
});
test('bounded exhaustion preserves the structured diagnostic; stale worker reports cannot choose an error code',async t=>{
 for(const staleError of [false,true]){const f=await fixture(t,{maxReconnects:0,staleError});await f.service.start(input);const s=await terminal(f.service);assert.equal(s.job.status,'blocked');assert.match(s.job.error,staleError?/^ORIGINAL_WORKER_FAILED:/:/^ORIGINAL_MONITOR_EXHAUSTED:/);assert.equal(s.job.output,null);assert.deepEqual(f.counts(),{submissions:1,outputs:0,held:false});}
});
