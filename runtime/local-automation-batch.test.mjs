import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLocalAutomations } from './local-automations.mjs';
import { createLocalAutomationBatches, validateLocalAutomationBatch, localAutomationBatchEntryRequestId } from './local-automation-batch.mjs';

async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-batch-admission-')),file=path.join(directory,'fixture.sqlite');let db=new DatabaseSync(file),automations,batches,now=Date.parse('2026-09-08T10:00:00Z'),dispatches=0;
 db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)');
 function start(override){automations=createLocalAutomations({db,clock:()=>now,dispatchRender:async id=>{dispatches++;db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);},prepareCreatorPack:async()=>assert.fail('Admission never prepares media'),cancelJob:async id=>db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id),verifyOutput:async()=>assert.fail('Admission never verifies fixture media')});batches=createLocalAutomationBatches({db,automations:override?.(automations)||automations,clock:()=>now});}
 start();
 function project(id,revision=1,timeline=true){db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(id,revision,JSON.stringify({name:id,timeline:timeline?[{assetId:`asset-${id}`,duration:30,trimStart:0}]:[]}),'old','old');db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(`asset-${id}`,id,JSON.stringify({mime:'video/mp4'}),path.join(directory,'unrenderable-protocol-fixture.bin'),'old');}
 const request=(ids=['p1'],extra={})=>({requestId:'batch-request',name:'Saved edit batch',entries:ids.map(projectId=>({projectId,expectedRevision:1})),...extra});
 async function reopen(override){await automations.close();db.close();db=new DatabaseSync(file);start(override);}
 t.after(async()=>{await automations.close();db.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
 return{get db(){return db;},get automations(){return automations;},get batches(){return batches;},get dispatches(){return dispatches;},project,request,reopen,advance:ms=>now+=ms};
}

test('strict validation rejects the entire malformed batch before any durable admission',async t=>{
 const f=await fixture(t);f.project('p1');
 const cases=[{},f.request([],{}),f.request(['p1','p1']),f.request(['p1'],{requestId:'../secret'}),f.request(['p1'],{count:100}),f.request(['p1'],{scheduledAt:'tomorrow'}),f.request(['p1'],{entries:[{projectId:'p1',expectedRevision:1,prompt:'generate a film'}]}),f.request(['p1'],{entries:[{projectId:'p1',expectedRevision:1},{projectId:'p2',expectedRevision:0}]}),f.request(Array.from({length:65},(_,i)=>`p${i}`))];
 for(const input of cases)assert.throws(()=>f.batches.create(input),e=>/^AUTOMATION_BATCH_(REQUEST|LIMIT|DUPLICATE|SCHEDULE)$/.test(e.code));
 assert.equal(f.automations.list().length,0);assert.equal(f.batches.list().batches.length,0);assert.equal(f.dispatches,0);
});

test('canonical validation and derived entry keys are stable, bounded and sensitive to ownership',()=>{
 const input={requestId:'logical',name:'  Release edits  ',scheduledAt:'2026-09-08T11:00:00+01:00',entries:[{projectId:'p1',expectedRevision:1}]};
 const value=validateLocalAutomationBatch(input);assert.equal(value.name,'Release edits');assert.equal(value.scheduledAt,'2026-09-08T10:00:00.000Z');assert.ok(value.entries[0].name.includes('Release edits'));
 const a=localAutomationBatchEntryRequestId('batch-a','p1',1);assert.equal(a,localAutomationBatchEntryRequestId('batch-a','p1',1));assert.ok(a.length<=120);assert.notEqual(a,localAutomationBatchEntryRequestId('batch-a','p1',2));assert.notEqual(a,localAutomationBatchEntryRequestId('batch-b','p1',1));
});

test('60 distinct saved edits admit once, create no jobs or media, and report zero ready outputs',async t=>{
 const f=await fixture(t),ids=Array.from({length:60},(_,i)=>`saved-${i}`);for(const id of ids)f.project(id);
 const batch=f.batches.create(f.request(ids));assert.equal(batch.kind,'saved-edit-render-batch');assert.equal(batch.admissionStatus,'complete');assert.equal(batch.status,'in-progress');assert.equal(batch.counts.requested,60);assert.equal(batch.counts.accepted,60);assert.equal(batch.counts.pending,60);assert.equal(batch.counts.readyForReview,0);assert.equal(batch.counts.publishedByAutomation,0);
 for(let i=0;i<12;i++)assert.equal(f.batches.create(f.request(ids)).id,batch.id);assert.equal(f.automations.list().length,60);assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);assert.equal(f.dispatches,0);
 await Promise.all(Array.from({length:20},()=>f.automations.tick()));assert.equal(f.dispatches,1);assert.equal(f.batches.get(batch.id).counts.running,1);assert.equal(f.batches.get(batch.id).counts.scheduled,59);
});

test('same request survives restart and advanced revisions; changed content conflicts without extra admissions',async t=>{
 const f=await fixture(t);f.project('p1');f.project('p2');const input=f.request(['p1','p2']),first=f.batches.create(input);
 f.db.prepare('UPDATE projects SET revision=3').run();await f.reopen();assert.equal(f.batches.create(input).id,first.id);assert.equal(f.automations.list().length,2);
 for(const changed of [{...input,name:'Different'},{...input,entries:[...input.entries].reverse()},{...input,scheduledAt:'2026-09-09T12:00:00Z'}])assert.throws(()=>f.batches.create(changed),{code:'AUTOMATION_BATCH_REQUEST_CONFLICT'});
 assert.equal(f.batches.list().batches.length,1);assert.equal(f.dispatches,0);
});

test('partial eligibility rejection is explicit and never creates missing projects or retries final rejections',async t=>{
 const f=await fixture(t);f.project('good');f.project('stale',2);f.project('empty',1,false);
 const input=f.request(['good','stale','empty','missing']),batch=f.batches.create(input);assert.equal(batch.admissionStatus,'complete');assert.equal(batch.partialAdmission,true);assert.equal(batch.counts.accepted,1);assert.equal(batch.counts.rejected,3);assert.equal(batch.counts.admissionPending,0);assert.equal(batch.entries.find(e=>e.projectId==='stale').diagnostic.code,'AUTOMATION_REVISION');assert.equal(batch.entries.find(e=>e.projectId==='empty').diagnostic.code,'AUTOMATION_TIMELINE');
 f.project('missing');assert.equal(f.batches.create(input).counts.accepted,1,'rejected entries require a corrected new batch request');assert.equal(f.db.prepare('SELECT count(*) n FROM projects').get().n,4);
});

test('shared queue capacity and prior pending edits reject entries without adopting another workflow',async t=>{
 const f=await fixture(t);for(let i=0;i<65;i++)f.project(`p${i}`);for(let i=0;i<63;i++)f.automations.create({name:`Prior ${i}`,projectId:`p${i}`,expectedRevision:1});
 const b=f.batches.create(f.request(['p0','p63','p64']));assert.equal(b.counts.accepted,1);assert.equal(b.counts.rejected,2);assert.equal(b.entries[0].diagnostic.code,'AUTOMATION_PROJECT_CONFLICT');assert.equal(b.entries[2].diagnostic.code,'AUTOMATION_QUEUE_FULL');assert.equal(f.automations.list().length,64);assert.equal(b.entries[0].automationId,null);
});

test('crash after underlying admission retains pending entry; restart resolves its exact request without duplicate',async t=>{
 const f=await fixture(t);f.project('p1');f.project('p2');let interrupted=false;
 await f.reopen(service=>({...service,create:input=>{const result=service.create(input);if(!interrupted){interrupted=true;throw Object.assign(new Error('Response lost after SQLite commit'),{code:'SIMULATED_INTERRUPTION'});}return result;}}));
 const input=f.request(['p1','p2']),batch=f.batches.create(input);assert.equal(batch.admissionStatus,'interrupted');assert.equal(batch.counts.admissionPending,2);assert.equal(batch.counts.accepted,0);assert.equal(f.automations.list().length,1);
 const original=f.automations.list()[0].id;f.db.prepare("UPDATE projects SET revision=2 WHERE id='p1'").run();await f.reopen();f.batches.get(batch.id);f.batches.list();assert.equal(f.automations.list().length,1,'read views do not resume interrupted admission');const recovered=f.batches.recover();assert.equal(recovered.remaining,0);const replay=f.batches.get(batch.id);assert.equal(replay.admissionStatus,'complete');assert.equal(replay.entries[0].automationId,original);assert.equal(replay.counts.accepted,2);assert.equal(f.automations.list().length,2);assert.equal(f.dispatches,0);
});

test('read views resolve failure/cancel/revision pauses and refuse unverified or cross-linked completion claims',async t=>{
 const f=await fixture(t);for(const id of ['p1','p2','p3','p4'])f.project(id);const b=f.batches.create(f.request(['p1','p2','p3','p4'])),ids=b.entries.map(e=>e.automationId);
 f.db.prepare("UPDATE local_automations SET status='failed' WHERE id=?").run(ids[0]);await f.automations.cancel(ids[1]);f.db.prepare("UPDATE local_automations SET status='paused' WHERE id=?").run(ids[2]);f.db.prepare("UPDATE local_automations SET status='needs-review',output='{}' WHERE id=?").run(ids[3]);
 const current=f.batches.get(b.id);assert.equal(current.status,'attention-required');assert.equal(current.counts.failed,1);assert.equal(current.counts.cancelled,1);assert.equal(current.counts.paused,1);assert.equal(current.counts.unverifiedReviewStates,1);assert.equal(current.counts.readyForReview,0);
 f.db.prepare('UPDATE local_automation_requests SET automation_id=? WHERE automation_id=?').run(ids[1],ids[3]);const broken=f.batches.get(b.id);assert.equal(broken.counts.missingAutomations,1);assert.equal(broken.entries[3].automation,null);assert.equal(broken.entries[3].diagnostic.code,'AUTOMATION_BATCH_ENTRY_EVIDENCE');
});

test('ready-for-review counts require the existing hash-bound full-decode and creator-pack receipt',async t=>{
 const f=await fixture(t);f.project('p1');const b=f.batches.create(f.request()),id=b.entries[0].automationId;
 // Receipt-contract fixture only. No MP4 or creative acceptance is claimed.
 const output={sha256:'a'.repeat(64),videoAssetId:'video-owned',verification:{ok:true,playable:true,fullDecode:true,sha256:'a'.repeat(64)},creatorPack:{jobId:'pack-owned',sourceAssetId:'video-owned',sourceHash:'a'.repeat(64),status:'draft',published:false}};
 f.db.prepare("UPDATE local_automations SET status='needs-review',output=? WHERE id=?").run(JSON.stringify(output),id);assert.equal(f.batches.get(b.id).counts.readyForReview,1);assert.equal(f.batches.get(b.id).status,'needs-review');
 output.creatorPack.sourceHash='b'.repeat(64);f.db.prepare('UPDATE local_automations SET output=? WHERE id=?').run(JSON.stringify(output),id);assert.equal(f.batches.get(b.id).counts.readyForReview,0);
});

test('bounded pagination is stable at equal timestamps and get/list never dispatch or resume admission',async t=>{
 const f=await fixture(t);for(let i=0;i<5;i++){f.project(`p${i}`);f.batches.create(f.request([`p${i}`],{requestId:`req-${i}`}));}
 const first=f.batches.list({limit:2}),second=f.batches.list({limit:2,before:first.nextCursor}),third=f.batches.list({limit:2,before:second.nextCursor});const ids=[...first.batches,...second.batches,...third.batches].map(b=>b.id);assert.equal(new Set(ids).size,5);assert.equal(third.nextCursor,null);assert.equal(f.batches.get('unknown'),null);assert.equal(f.dispatches,0);
 for(const options of [{limit:0},{limit:101},{limit:2,other:true},{before:'../outside'}])assert.throws(()=>f.batches.list(options),{code:'AUTOMATION_BATCH_REQUEST'});
});

test('saved batch or entry mutation prevents any further admission during recovery',async t=>{
 for(const tamper of ['request','entry']){
  const f=await fixture(t);f.project('p1');f.project('p2');await f.reopen(service=>({...service,create:()=>{throw Error('Fixture simulates unavailable service');}}));const batch=f.batches.create(f.request(['p1','p2']));assert.equal(batch.admissionStatus,'interrupted');
  if(tamper==='request')f.db.prepare("UPDATE local_automation_batches SET input_hash=? WHERE id=?").run('a'.repeat(64),batch.id);
  else f.db.prepare("UPDATE local_automation_batch_entries SET project_id='foreign' WHERE batch_id=? AND position=0").run(batch.id);
  await f.reopen();assert.throws(()=>f.batches.recover(),{code:'AUTOMATION_BATCH_EVIDENCE'});assert.equal(f.automations.list().length,0);assert.equal(f.dispatches,0);
 }
});

test('future scheduling uses the shared scheduler and cancellation remains per owned automation',async t=>{
 const f=await fixture(t);f.project('p1');f.project('p2');const b=f.batches.create(f.request(['p1','p2'],{scheduledAt:'2026-09-08T11:00:00Z'}));await f.automations.tick();assert.equal(f.dispatches,0);
 await f.automations.cancel(b.entries[0].automationId);assert.equal(f.batches.get(b.id).counts.cancelled,1);assert.equal(f.batches.get(b.id).counts.pending,1);f.advance(3600000);await f.automations.tick();assert.equal(f.dispatches,1);assert.equal(f.batches.get(b.id).counts.running,1);
});
