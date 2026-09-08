import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { acquireGpuLease } from './inference-harness.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),exec=promisify(execFile);
const ffmpeg=path.join(root,'workers/tools',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'vyrealm-automation-http-')),data=path.join(dir,'data'),gpu=path.join(dir,'gpu');let child,db,token,logs='',lease;
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const base=`http://127.0.0.1:${port}`;
 const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,'exit');if(child.connected)child.send({type:'shutdown'});const timer=setTimeout(()=>child.kill(),5000);await exited;clearTimeout(timer);}};
 const start=async()=>{
  logs='';child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,PORT:String(port),VYRELUM_ROOT:root,VYRELUM_DATA_DIR:data,VYRELUM_RUNTIME_DIR:path.join(dir,'runtime'),VYRELUM_GPU_LEASE_DIR:gpu,OLLAMA_HOST:'http://127.0.0.1:1'}});
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error(`Isolated app start timed out: ${logs}`)),15000);child.stdout.on('data',chunk=>{logs=(logs+chunk).slice(-12000);if(logs.includes('local control plane listening')){clearTimeout(timer);yes();}});child.stderr.on('data',chunk=>logs=(logs+chunk).slice(-12000));child.once('error',error=>{clearTimeout(timer);no(error);});child.once('exit',code=>{clearTimeout(timer);no(Error(`Isolated server exited ${code}: ${logs}`));});});
  token=(await(await fetch(base+'/api/session')).json()).token;
 };
 t.after(async()=>{await lease?.();await stop();db?.close();if(path.dirname(dir)===path.resolve(tmpdir())&&path.basename(dir).startsWith('vyrealm-automation-http-'))await rm(dir,{recursive:true,force:true});});
 await start();db=new DatabaseSync(path.join(data,'vyrelum.sqlite'));
 const api=async(route,method='GET',body,headers={})=>{const response=await fetch(base+route,{method,headers:{'content-type':'application/json','X-Vyrelum-Token':token,...headers},...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});return{status:response.status,body:await response.json()};};
 async function waitFor(id,predicate,timeout=25000){const began=Date.now();let latest;while(Date.now()-began<timeout){latest=(await api('/api/automations')).body.find(item=>item.id===id);if(predicate(latest))return latest;await pause(120);}throw Error(`Automation did not reach expected state: ${JSON.stringify(latest)}\n${logs}`);}
 return{dir,data,gpu,db,base,api,start,stop,waitFor,get logs(){return logs;},async hold(){lease=await acquireGpuLease('isolated-http-fixture',{root:gpu});},async release(){await lease?.();lease=null;}};
}

test('actual local automation HTTP journey uses one durable render and needs human review',{timeout:60000,skip:!existsSync(ffmpeg)},async t=>{
 const f=await fixture(t),source=path.join(f.dir,'source.mp4');
 await exec(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-y',source],{windowsHide:true});
 const created=await f.api('/api/projects','POST',{name:'Automation HTTP fixture',brief:'An original CPU test edit, never a catalogue film.',captionsEnabled:false,settings:{width:160,height:90,fps:24}});assert.equal(created.status,201);let project=created.body;
 const upload=await f.api('/api/assets','POST',await readFile(source),{'content-type':'video/mp4','x-filename':'source.mp4','x-project-id':project.id});assert.equal(upload.status,201);
 await t.test('streamed imports reject overlap and retain exact bytes without orphan partials',async()=>{
  const session=await(await fetch(f.base+'/api/session')).json();let release;const gate=new Promise(resolve=>release=resolve);
  const body=(async function*(){yield Buffer.from('a');await gate;yield Buffer.from('b');})();
  const headers={'x-vyrelum-token':session.token,'content-type':'application/octet-stream','x-filename':'stream-proof.bin','x-project-id':project.id};
  const first=fetch(f.base+'/api/assets',{method:'POST',headers,body,duplex:'half'});
  try{let partial=false;for(let n=0;n<100;n++){partial=(await readdir(path.join(f.data,'media'))).some(name=>name.endsWith('.upload.partial'));if(partial)break;await pause(10);}assert.ok(partial,'the first upload is actually open');
   const overlap=await f.api('/api/assets','POST',Buffer.from('c'),{'content-type':'application/octet-stream','x-filename':'overlap.bin','x-project-id':project.id});assert.equal(overlap.status,409);assert.equal(overlap.body.code,'MEDIA_UPLOAD_BUSY');
  }finally{release();}
  const response=await first;assert.equal(response.status,201);const asset=await response.json();assert.equal(asset.size,2);const actual=await fetch(f.base+'/media/'+asset.id);assert.equal(await actual.text(),'ab');
  assert.equal((await readdir(path.join(f.data,'media'))).filter(name=>name.endsWith('.upload.partial')).length,0);
 });
 project=(await f.api(`/api/projects/${project.id}`,'PATCH',{expectedRevision:project.revision,patch:{timeline:[{id:'clip-one',assetId:upload.body.id,kind:'video',trimStart:0,duration:1,caption:''}]}})).body;
 let automation,request;
 await t.test('strict requests and generic-job ownership inputs are rejected before work',async()=>{
  assert.equal((await f.api('/api/automations','POST',{name:'Bad',projectId:project.id,expectedRevision:project.revision,publish:true})).status,400);
  assert.equal((await f.api('/api/automations','POST',{name:'Stale',projectId:project.id,expectedRevision:99})).status,409);
  for(const extra of [{automationId:'forged'},{projectSnapshot:project}])assert.equal((await f.api('/api/jobs','POST',{type:'render',projectId:project.id,expectedRevision:project.revision,...extra})).body.code,'LOCAL_AUTOMATION_INTERNAL_INPUT');
  assert.equal((await f.api('/api/jobs')).body.length,0);
 });
 await t.test('queued work survives restart and ambiguous submission replay without a duplicate job',async()=>{
  await f.hold();request={requestId:crypto.randomUUID(),name:'Render and prepare drafts',projectId:project.id,expectedRevision:project.revision};const response=await f.api('/api/automations','POST',request);assert.equal(response.status,201,JSON.stringify(response.body));automation=response.body;
  await f.waitFor(automation.id,item=>item?.status==='running'&&item.jobId);const initial=(await f.api('/api/automations')).body.find(item=>item.id===automation.id);const jobId=initial.jobId;
  assert.equal((await f.api(`/api/jobs/${jobId}`)).body.status,'queued');await f.stop();await f.start();
  const replay=await f.api('/api/automations','POST',request);assert.equal(replay.status,201);assert.equal(replay.body.id,automation.id);assert.equal(replay.body.jobId,jobId);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM jobs WHERE type='render'").get().n,1);
  const jobs=(await f.api('/api/jobs')).body;assert.ok(jobs.every(item=>!Object.hasOwn(item,'automationId')&&!Object.hasOwn(item,'projectSnapshot')));
  for(const control of ['cancel','retry'])assert.equal((await f.api(`/api/jobs/${jobId}/${control}`,'POST',{})).body.code,'LOCAL_AUTOMATION_CONTROL');
  await f.release();
 });
 await t.test('real render, complete decode and creator materials finish as needs-review',async()=>{
  const result=await f.waitFor(automation.id,item=>['needs-review','failed','paused','cancelled'].includes(item?.status));assert.equal(result.status,'needs-review',JSON.stringify(result));
  assert.equal(result.output.verification.fullDecode,true);assert.equal(result.output.creatorPack.status,'draft');assert.equal(result.output.creatorPack.published,false);
  const summary=await f.api('/api/automations/summary');assert.equal(summary.status,200);assert.equal(summary.body.readyForReview,1);assert.equal(summary.body.publishedByAutomation,0);
  project=(await f.api(`/api/projects/${project.id}`)).body;assert.equal(project.latestOutput.videoAssetId,result.output.videoAssetId);assert.ok(['verified','review_required'].includes(project.latestOutput.status));assert.equal(project.latestOutput.review,undefined);assert.equal(project.creatorPack.jobId,result.output.creatorPack.jobId);
  const download=await fetch(f.base+`/media/${result.output.videoAssetId}`),bytes=Buffer.from(await download.arrayBuffer());assert.equal(download.status,200);assert.ok(bytes.length>1000);assert.equal(sha(bytes),result.output.sha256);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM jobs WHERE type='render'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) AS n FROM jobs WHERE type='creator-pack'").get().n,1);
  assert.equal(f.db.prepare("SELECT attempts FROM jobs WHERE type='render'").get().attempts,1);
 });
 await t.test('reopen preserves the review gate and requestId conflict cannot schedule another render',async()=>{
  await f.stop();await f.start();const replay=await f.api('/api/automations','POST',request);assert.equal(replay.status,201);assert.equal(replay.body.id,automation.id);assert.equal(replay.body.status,'needs-review');
  const conflict=await f.api('/api/automations','POST',{...request,name:'Changed logical request'});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'AUTOMATION_REQUEST_CONFLICT');
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM jobs WHERE type='render'").get().n,1);
 });
 await t.test('cancelled future automation never creates a job',async()=>{
  const future=await f.api('/api/automations','POST',{name:'Pending only',projectId:project.id,expectedRevision:project.revision,scheduledAt:new Date(Date.now()+3600000).toISOString()});assert.equal(future.status,201);
  const cancelled=await f.api(`/api/automations/${future.body.id}/cancel`,'POST',{});assert.equal(cancelled.status,200);assert.equal(cancelled.body.status,'cancelled');assert.equal(cancelled.body.jobId,null);
  assert.equal((await f.api(`/api/automations/${future.body.id}/cancel`,'POST',{publish:true})).status,400);
 });
 await t.test('saved-edit batch HTTP admission is durable, bounded and does not claim rendered media',async()=>{
  const requestId=crypto.randomUUID(),batchRequest={requestId,name:'Saved edit batch fixture',scheduledAt:new Date(Date.now()+3600000).toISOString(),entries:[{projectId:project.id,expectedRevision:project.revision}]};
  assert.equal((await f.api('/api/automation-batches','POST',{...batchRequest,generate:true})).status,400);
  assert.equal((await f.api('/api/automation-batches?limit=0')).status,400);
  const created=await f.api('/api/automation-batches','POST',batchRequest);assert.equal(created.status,201,JSON.stringify(created.body));const batch=created.body;
  assert.equal(batch.kind,'saved-edit-render-batch');assert.equal(batch.counts.requested,1);assert.equal(batch.counts.accepted,1);assert.equal(batch.counts.readyForReview,0);assert.equal(batch.counts.pending,1);
  const entry=batch.entries[0];assert.equal(entry.automation.jobId,null);assert.equal(entry.automation.output?.videoAssetId,undefined);assert.equal(entry.automation.output?.sha256,undefined);
  assert.equal((await f.api('/api/automation-batches/'+batch.id)).body.id,batch.id);
  assert.ok((await f.api('/api/automation-batches?limit=1')).body.batches.some(row=>row.id===batch.id));
  await f.stop();await f.start();
  const replay=await f.api('/api/automation-batches','POST',batchRequest);assert.equal(replay.body.id,batch.id);assert.equal(replay.body.entries[0].automationId,entry.automationId);
  assert.equal((await f.api('/api/automation-batches','POST',{...batchRequest,name:'Changed request'})).status,409);
  assert.equal((await f.api('/api/automation-batches/no-such-batch')).status,404);
  assert.equal((await f.api('/api/automations/'+entry.automationId+'/cancel','POST',{})).status,200);
  assert.equal((await f.api('/api/automation-batches/'+batch.id)).body.counts.readyForReview,0);
 });
 await t.test('edits while waiting for a worker pause instead of rendering newer content',async()=>{
  await f.hold();const response=await f.api('/api/automations','POST',{name:'Stale queued source',projectId:project.id,expectedRevision:project.revision});assert.equal(response.status,201);
  await f.waitFor(response.body.id,item=>item?.status==='running');project=(await f.api(`/api/projects/${project.id}`,'PATCH',{expectedRevision:project.revision,patch:{name:'User edit retained'}})).body;await f.release();
  const result=await f.waitFor(response.body.id,item=>['paused','failed'].includes(item?.status));assert.equal(result.status,'paused',JSON.stringify(result));assert.equal(result.diagnostic.code,'AUTOMATION_PROJECT_CHANGED');
  const saved=(await f.api(`/api/projects/${project.id}`)).body;assert.equal(saved.name,'User edit retained');assert.equal(saved.latestOutput.jobId,project.latestOutput.jobId);assert.equal(f.db.prepare('SELECT attempts FROM jobs WHERE id=?').get(result.jobId).attempts,0);
 });
});
