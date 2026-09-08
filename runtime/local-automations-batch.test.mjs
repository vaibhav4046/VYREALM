import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createLocalAutomations, LOCAL_AUTOMATION_PENDING_LIMIT, summarizeLocalAutomations } from './local-automations.mjs';

const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
async function fixture(t,overrides={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-batch-queue-')),db=new DatabaseSync(path.join(directory,'fixture.sqlite')),source=path.join(directory,'source.bin');await fs.writeFile(source,'QUEUE FIXTURE ONLY: not renderable or approved media');
 db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)');
 let now=Date.parse('2026-09-08T09:00:00Z'),scheduler;const calls={dispatch:[],cancel:[]};
 function addProject(id,duration=30){db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(id,1,JSON.stringify({brief:'Isolated scheduled edit',timeline:[{id:'clip',assetId:`source-${id}`,duration,trimStart:0,kind:'video'}]}),'old','old');db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(`source-${id}`,id,JSON.stringify({mime:'video/mp4'}),source,'old');}
 addProject('project-1');
 const config={db,clock:()=>now,dispatchRender:async id=>{calls.dispatch.push(id);db.prepare("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=? AND status='queued'").run(id);},cancelJob:async id=>{calls.cancel.push(id);db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id);},prepareCreatorPack:async()=>assert.fail('Queue fixture must not prepare media'),verifyOutput:async()=>assert.fail('Queue fixture must not verify invented media'),...overrides};
 const setup=extra=>scheduler=createLocalAutomations({...config,...extra});setup();
 t.after(async()=>{await scheduler.close();db.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
 return{db,calls,addProject,setup,get scheduler(){return scheduler;},advanceClock:ms=>now+=ms,create:(projectId='project-1',extra={})=>scheduler.create({name:`Render ${projectId}`,projectId,expectedRevision:1,...extra})};
}
test('pending admission is capped at 64; request replay still succeeds at capacity and cancel frees one slot',async t=>{
 const f=await fixture(t);assert.equal(LOCAL_AUTOMATION_PENDING_LIMIT,64);const first=f.create('project-1',{requestId:'first-request'});
 for(let i=2;i<=65;i++)f.addProject(`project-${i}`);for(let i=2;i<=64;i++)f.create(`project-${i}`);
 assert.throws(()=>f.create('project-65'),{code:'AUTOMATION_QUEUE_FULL'});assert.equal(f.scheduler.list().length,64);assert.equal(f.create('project-1',{requestId:'first-request'}).id,first.id);
 await f.scheduler.cancel(first.id);assert.equal(f.create('project-65').status,'scheduled');assert.equal(f.scheduler.summary().pending,64);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});
test('new request IDs cannot enqueue duplicate pending work at one saved project revision',async t=>{
 const f=await fixture(t),first=f.create('project-1',{requestId:'original-request'});
 for(const extra of [{requestId:'double-click'},{name:'Same edit renamed'},{scheduledAt:'2026-09-09T09:00:00Z'}])assert.throws(()=>f.create('project-1',extra),{code:'AUTOMATION_PROJECT_CONFLICT'});
 assert.equal(f.create('project-1',{requestId:'original-request'}).id,first.id);assert.equal(f.scheduler.list().length,1);await f.scheduler.cancel(first.id);assert.equal(f.create('project-1',{requestId:'new-run'}).status,'scheduled');
});
test('50 short and 10 long-form saved edits stay serial across concurrent ticks and reload, with zero invented completions',async t=>{
 const f=await fixture(t);for(let i=1;i<=60;i++){const id=`batch-${i}`;f.addProject(id,i<=50?30:600);f.create(id,{requestId:`batch-request-${i}`});}
 await Promise.all(Array.from({length:25},()=>f.scheduler.tick()));assert.equal(f.calls.dispatch.length,1);assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE status='running'").get().n,1);
 await f.scheduler.close();f.setup();await Promise.all(Array.from({length:25},()=>f.scheduler.recover()));assert.equal(f.calls.dispatch.length,1,'reload must not redispatch a running owned job');
 for(let i=0;i<60;i++){
  const active=f.scheduler.list().find(a=>a.status==='running');assert.ok(active);f.db.prepare("UPDATE jobs SET status='failed',error='intentional queue fixture end' WHERE id=?").run(active.jobId);await f.scheduler.tick();await f.scheduler.tick();assert.ok(f.db.prepare("SELECT count(*) n FROM jobs WHERE status='running'").get().n<=1);
 }
 assert.equal(f.calls.dispatch.length,60);const counts=f.scheduler.summary();assert.equal(counts.total,60);assert.equal(counts.failed,60);assert.equal(counts.readyForReview,0);assert.equal(counts.pending,0);assert.equal(counts.publishedByAutomation,0);
});
test('repeated cancellation joins one worker-stop call rather than racing repeated stops',async t=>{
 const f=await fixture(t),entered=defer(),release=defer();await f.scheduler.close();f.setup({cancelJob:async id=>{f.calls.cancel.push(id);entered.resolve();await release.promise;f.db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id);}});
 const a=f.create();await f.scheduler.tick();const first=f.scheduler.cancel(a.id);await entered.promise;const others=Array.from({length:20},()=>f.scheduler.cancel(a.id));const whilePending=f.scheduler.get(a.id).status;release.resolve();await Promise.all([first,...others]);assert.equal(whilePending,'cancelling');assert.equal(f.scheduler.get(a.id).status,'cancelled');assert.equal(f.calls.cancel.length,1);
});
test('an explicit user cancel wins over an earlier automatic project-change pause',async t=>{
 const f=await fixture(t),entered=defer(),release=defer();await f.scheduler.close();f.setup({cancelJob:async id=>{f.calls.cancel.push(id);entered.resolve();await release.promise;f.db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id);}});
 const a=f.create();await f.scheduler.tick();f.db.prepare('UPDATE projects SET revision=2 WHERE id=?').run('project-1');const ticking=f.scheduler.tick();await entered.promise;const cancelling=f.scheduler.cancel(a.id);release.resolve();await Promise.all([ticking,cancelling]);assert.equal(f.calls.cancel.length,1);assert.equal(f.scheduler.get(a.id).status,'cancelled');assert.equal(f.scheduler.get(a.id).diagnostic.code,'AUTOMATION_CANCELLED');
});
test('transient stop failures retry at bounded intervals and never claim cancellation before worker confirmation',async t=>{
 const f=await fixture(t);await f.scheduler.close();f.setup({cancelJob:async id=>{f.calls.cancel.push(id);if(f.calls.cancel.length<3)throw Object.assign(new Error('Worker stop temporarily unavailable'),{code:'STOP_TRANSIENT'});f.db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id);}});
 const a=f.create();await f.scheduler.tick();await f.scheduler.cancel(a.id);assert.equal(f.scheduler.get(a.id).status,'cancelling');for(let i=0;i<10;i++)await f.scheduler.tick();assert.equal(f.calls.cancel.length,1);
 f.advanceClock(5000);await f.scheduler.tick();assert.equal(f.calls.cancel.length,2);assert.equal(f.scheduler.get(a.id).status,'cancelling');f.advanceClock(5000);await f.scheduler.tick();assert.equal(f.calls.cancel.length,3);assert.equal(f.scheduler.get(a.id).status,'cancelled');
});
test('permanent stop failure remains honestly cancelling and holds the queue after three attempts',async t=>{
 const f=await fixture(t,{cancelJob:async()=>{throw Object.assign(new Error('No stop confirmation'),{code:'STOP_TRANSIENT'});}}),a=f.create();f.addProject('other');f.create('other');await f.scheduler.tick();const active=f.scheduler.list().find(x=>x.status==='running');await f.scheduler.cancel(active.id);
 for(let i=0;i<20;i++){f.advanceClock(5000);await f.scheduler.tick();}assert.equal(f.scheduler.get(active.id).status,'cancelling');assert.equal(f.scheduler.get(active.id).output.cancelAttempts,3);assert.equal(f.calls.dispatch.length,1);assert.equal(f.scheduler.summary().readyForReview,0);
});
test('summary refuses ready-for-review labels without matching technical and draft evidence',()=>{
 const base={status:'needs-review',output:{sha256:'a'.repeat(64),videoAssetId:'video',verification:{ok:true,playable:true,fullDecode:true,sha256:'a'.repeat(64)},creatorPack:{jobId:'pack',sourceAssetId:'video',sourceHash:'a'.repeat(64),status:'draft',published:false}}};
 const counts=summarizeLocalAutomations([base,{status:'scheduled'}, {status:'running'}, {status:'needs-review',output:{}}, {status:'failed'}, {status:'cancelled'}]);assert.equal(counts.total,6);assert.equal(counts.pending,2);assert.equal(counts.readyForReview,1);assert.equal(counts.unverifiedReviewStates,1);assert.equal(counts.publishedByAutomation,0);
});
test('loopback HTTP fixture recovers a lost admission response without admitting a second workflow',async t=>{
 const f=await fixture(t);let dropped=false;
 // Test transport around the real runtime API; this is not a running VYREALM
 // server, provider, media worker or a new production endpoint.
 const server=createServer(async(req,res)=>{try{let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text||'{}');let value;
  if(req.method==='POST'&&req.url==='/api/automations'){value=f.scheduler.create(input);if(!dropped){dropped=true;return res.destroy();}res.statusCode=201;}
  else if(req.method==='GET'&&req.url==='/api/automations')value=f.scheduler.list();
  else{res.statusCode=404;value={error:'Fixture route unavailable'};}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
 }catch(error){res.statusCode=/CONFLICT/.test(error.code||'')?409:400;res.setHeader('content-type','application/json');res.end(JSON.stringify({code:error.code,error:error.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const url=`http://127.0.0.1:${server.address().port}/api/automations`,input={name:'HTTP response replay',projectId:'project-1',expectedRevision:1,requestId:'logical-submission'};
 const post=body=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
 await assert.rejects(post(input));assert.equal(f.scheduler.list().length,1);const id=f.scheduler.list()[0].id;f.db.prepare('UPDATE projects SET revision=2 WHERE id=?').run('project-1');
 const responses=await Promise.all(Array.from({length:12},()=>post(input)));for(const response of responses){assert.equal(response.status,201);assert.equal((await response.json()).id,id);}
 const conflict=await post({...input,name:'Different logical request'});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'AUTOMATION_REQUEST_CONFLICT');assert.equal((await(await fetch(url)).json()).length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});
