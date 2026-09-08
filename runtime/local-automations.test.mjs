import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createLocalAutomations, createLocalAutomationVerifier, localAutomationJobId } from './local-automations.mjs';
import { buildCreatorPack } from './creator-pack.mjs';

const exec = promisify(execFile), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const tools = path.resolve('workers/tools'), ffmpeg = path.join(tools,process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ffprobe = path.join(tools,process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(),'vyrealm-local-automation-'));
  const db = new DatabaseSync(path.join(dir,'fixture.sqlite'));
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT,PRIMARY KEY(project_id,revision));
    CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);
    CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);`);
  const stamp='2026-09-08T12:00:00.000Z', source = path.join(dir,'source.mp4'); await writeFile(source,'fixture bytes; never a playable-video claim');
  const doc = { title:'Local automation fixture',brief:'Original test footage edit',timeline:[{id:'clip-1',assetId:'source-1',kind:'video',trimStart:0,duration:1}],settings:{width:160,height:90,fps:24} };
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-1',1,JSON.stringify(doc),stamp,stamp);
  db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run('source-1','project-1',JSON.stringify({mime:'video/mp4',name:'Source'}),source,stamp);
  const calls={dispatch:[],pack:[],cancel:[],verify:[]}; let now=Date.parse(stamp), automation;
  const project = () => { const row=db.prepare('SELECT * FROM projects WHERE id=?').get('project-1'); return {...JSON.parse(row.document),id:row.id,revision:row.revision}; };
  const updateProject = changes => { const current=project(),next={...current,...changes}; delete next.id; delete next.revision; db.prepare('UPDATE projects SET revision=?,document=? WHERE id=?').run(current.revision+1,JSON.stringify(next),'project-1'); return project(); };
  const getJob = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  async function completeRender(id, extra = {}) {
    const bytes=await readFile(source), video=path.join(dir,'render.mp4'); await writeFile(video,bytes); const hash=sha(bytes);
    db.prepare('INSERT OR REPLACE INTO assets VALUES(?,?,?,?,?)').run('render-1','project-1',JSON.stringify({mime:'video/mp4',jobId:id}),video,stamp);
    const receipt={status:'review_required',promoted:true,provenance:{generationStatus:'edited',sourceMethod:'local-timeline-edit',outputHash:hash},...extra};
    db.prepare("UPDATE jobs SET status='review_required',output=? WHERE id=?").run(JSON.stringify(receipt),id);
    updateProject({latestOutput:{jobId:id,videoAssetId:'render-1',status:'review_required',provenance:receipt.provenance}});
    return receipt;
  }
  async function pack(projectId,input,internal) {
    calls.pack.push(internal.jobId); const current=project(),latest=current.latestOutput, hash=latest.provenance.outputHash;
    db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(internal.jobId,projectId,current.revision,'creator-pack','running',0,'Preparing',JSON.stringify({automationId:internal.automationId}),null,null,1,stamp,stamp);
    const files={manifest:path.join(dir,'pack.json'),draft:path.join(dir,'draft.md'),thumbnail:path.join(dir,'thumbnail.png')};
    const receipt={kind:'creator-pack',status:'draft',attached:true,jobId:internal.jobId,sourceAssetId:latest.videoAssetId,projectRevision:input.expectedRevision,project:{id:projectId,revision:input.expectedRevision},source:{sha256:hash},thumbnail:{sha256:sha('thumbnail fixture')},assets:{manifest:'pack-manifest',draft:'pack-draft',thumbnail:'pack-thumbnail'}};
    await writeFile(files.manifest,JSON.stringify(receipt));await writeFile(files.draft,'Draft only');await writeFile(files.thumbnail,'thumbnail fixture');
    for(const [kind,file] of Object.entries(files)) db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(receipt.assets[kind],projectId,JSON.stringify({jobId:internal.jobId}),file,stamp);
    db.prepare("UPDATE jobs SET status='succeeded',output=? WHERE id=?").run(JSON.stringify(receipt),internal.jobId); updateProject({creatorPack:receipt});
    return {project:project(),pack:receipt};
  }
  const config={db,clock:()=>now,dispatchRender:async id=>{calls.dispatch.push(id);db.prepare("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=? AND status='queued'").run(id);},prepareCreatorPack:pack,cancelJob:async id=>{calls.cancel.push(id);db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id);},verifyOutput:async evidence=>{calls.verify.push(evidence.asset.id);return {ok:true,playable:true,fullDecode:true,sha256:evidence.expectedHash,method:'TEST DOUBLE ONLY'};},...overrides};
  const setup=extra=>{automation=createLocalAutomations({...config,...extra});return automation;}; setup();
  t.after(async()=>{await automation.close();db.close();if(path.dirname(dir)===path.resolve(tmpdir())&&path.basename(dir).startsWith('vyrealm-local-automation-'))await rm(dir,{recursive:true,force:true});});
  return {dir,db,source,calls,project,updateProject,completeRender,pack,getJob,config,setup,get scheduler(){return automation;},setNow:value=>now=Date.parse(value),create:extra=>automation.create({name:'Render saved edit',projectId:'project-1',expectedRevision:project().revision,...extra})};
}

test('admission accepts only an existing saved media timeline and timezone-aware schedule',async t=>{
  const f=await fixture(t);
  for(const input of [{expectedRevision:99},{scheduledAt:'2026-09-08 14:00'},{videoPath:'C:/private.mp4'},{publish:true},{name:''}]) assert.throws(()=>f.create(input));
  f.updateProject({timeline:[{assetId:'foreign',duration:1}]});assert.throws(()=>f.create(),{code:'AUTOMATION_TIMELINE'});
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM jobs').get().n,0);
});
test('future automation waits, then concurrent ticks insert and dispatch exactly one saved-revision job',async t=>{
  const f=await fixture(t), a=f.create({scheduledAt:'2026-09-08T13:00:00Z'});
  assert.equal(await f.scheduler.tick(),null);assert.equal(f.calls.dispatch.length,0);
  f.setNow('2026-09-08T13:00:00Z');await Promise.all(Array.from({length:12},()=>f.scheduler.tick()));
  assert.equal(f.calls.dispatch.length,1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
  const j=f.getJob(f.scheduler.get(a.id).jobId);assert.equal(j.id,localAutomationJobId(a.id,'render'));assert.equal(j.revision,1);assert.deepEqual(JSON.parse(j.input).projectSnapshot.timeline,f.project().timeline);
});
test('request replay after a lost response and changed render revision returns the original automation',async t=>{
  const f=await fixture(t), input={requestId:crypto.randomUUID(),expectedRevision:1},a=f.create(input);await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);await f.scheduler.tick();
  await f.scheduler.close();f.setup();const replay=f.create(input);assert.equal(replay.id,a.id);assert.equal(replay.status,'needs-review');assert.equal(f.scheduler.list().length,1);assert.equal(f.db.prepare("SELECT count(*) AS n FROM jobs WHERE type='render'").get().n,1);
});
test('reuse of one requestId for different logical inputs is a conflict',async t=>{
  const f=await fixture(t), requestId=crypto.randomUUID();f.create({requestId});assert.throws(()=>f.create({requestId,name:'Different request'}),{code:'AUTOMATION_REQUEST_CONFLICT'});assert.equal(f.scheduler.list().length,1);
});
test('a second scheduler cannot concurrently dispatch against the same database handle',async t=>{
  const f=await fixture(t);assert.throws(()=>createLocalAutomations(f.config),{code:'AUTOMATION_SCHEDULER_ACTIVE'});
});
test('durable scheduler ownership prevents a second SQLite connection from double-dispatching',async t=>{
  const f=await fixture(t), other=new DatabaseSync(path.join(f.dir,'fixture.sqlite'));
  try { assert.throws(()=>createLocalAutomations({...f.config,db:other}),{code:'AUTOMATION_SCHEDULER_ACTIVE'}); assert.equal(f.db.prepare('SELECT owner_pid FROM local_automation_scheduler').get().owner_pid,process.pid); }
  finally { other.close(); }
});
test('a dead scheduler owner can be recovered without expiring a live long-running render',async t=>{
  const f=await fixture(t);await f.scheduler.close();const child=spawnSync(process.execPath,['-e','process.exit(0)'],{windowsHide:true});assert.equal(child.status,0);
  f.db.prepare('INSERT INTO local_automation_scheduler VALUES(1,?,?)').run(child.pid,'dead-process-owner');f.setup();assert.equal(f.db.prepare('SELECT owner_pid FROM local_automation_scheduler').get().owner_pid,process.pid);
});
test('restart reuses the same queued job and leaves running jobs with their existing owner',async t=>{
  const f=await fixture(t,{dispatchRender:async()=>{}}), a=f.create();await f.scheduler.tick();const id=f.scheduler.get(a.id).jobId;
  await f.scheduler.close();f.setup();await f.scheduler.recover();assert.equal(f.scheduler.get(a.id).jobId,id);assert.equal(f.db.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
  f.db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(id);await f.scheduler.close();f.setup();await f.scheduler.recover();assert.equal(f.calls.dispatch.length,0);
});
test('project changes before due time pause without creating a job',async t=>{
  const f=await fixture(t), a=f.create();f.updateProject({title:'User revision'});await f.scheduler.tick();
  assert.equal(f.scheduler.get(a.id).status,'paused');assert.equal(f.scheduler.get(a.id).diagnostic.code,'AUTOMATION_PROJECT_CHANGED');assert.equal(f.calls.dispatch.length,0);
});
test('project changes while rendering cancel only the owned job and retain user changes',async t=>{
  const f=await fixture(t), a=f.create();await f.scheduler.tick();const id=f.scheduler.get(a.id).jobId;f.updateProject({title:'Keep this edit'});await f.scheduler.tick();
  assert.equal(f.scheduler.get(a.id).status,'paused');assert.deepEqual(f.calls.cancel,[id]);assert.equal(f.project().title,'Keep this edit');assert.equal(f.calls.pack.length,0);
});
test('a worker revision guard that already blocked a stale render becomes a precise project-change pause',async t=>{
  const f=await fixture(t), a=f.create();await f.scheduler.tick();f.updateProject({title:'Newer edit'});f.db.prepare("UPDATE jobs SET status='blocked',error='AUTOMATION_PROJECT_CHANGED' WHERE id=?").run(f.scheduler.get(a.id).jobId);await f.scheduler.tick();
  assert.equal(f.scheduler.get(a.id).status,'paused');assert.equal(f.scheduler.get(a.id).diagnostic.code,'AUTOMATION_PROJECT_CHANGED');assert.equal(f.calls.pack.length,0);
});
test('one automation dispatches at a time until the active workflow reaches review',async t=>{
  const f=await fixture(t), a=f.create(), other={...f.project(),timeline:[{id:'other-clip',assetId:'source-2',duration:1,kind:'video'}]};
  f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-2',1,JSON.stringify(other),'old','old');f.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run('source-2','project-2',JSON.stringify({mime:'video/mp4'}),f.source,'old');
  const b=f.scheduler.create({name:'Second saved project',projectId:'project-2',expectedRevision:1,scheduledAt:'2026-09-08T12:01:00Z'});f.setNow('2026-09-08T12:01:00Z');await f.scheduler.tick();await f.scheduler.tick();assert.equal(f.calls.dispatch.length,1);
  const active=f.scheduler.list().find(item=>item.status==='running');await f.completeRender(active.jobId);await f.scheduler.tick();assert.equal(f.scheduler.get(active.id).status,'needs-review');
  await f.scheduler.tick();assert.equal(active.id,a.id);assert.equal(f.scheduler.get(b.id).status,'running');assert.equal(f.calls.dispatch.length,2);
});
test('failed, blocked, cancelled and rejected jobs cannot produce creator materials',async t=>{
  for(const status of ['failed','blocked','cancelled','rejected'])await t.test(status,async t=>{
    const f=await fixture(t), a=f.create();await f.scheduler.tick();f.db.prepare('UPDATE jobs SET status=?,error=? WHERE id=?').run(status,'Fixture failure',f.scheduler.get(a.id).jobId);await f.scheduler.tick();
    assert.equal(f.scheduler.get(a.id).status,'failed');assert.match(f.scheduler.get(a.id).diagnostic.message,new RegExp(status));assert.equal(f.calls.pack.length,0);
  });
});
test('success labels without promoted owned video or actual bytes fail',async t=>{
  const f=await fixture(t), a=f.create();await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId,{promoted:false});await f.scheduler.tick();
  assert.equal(f.scheduler.get(a.id).diagnostic.code,'AUTOMATION_OUTPUT_EVIDENCE');assert.equal(f.calls.verify.length,0);assert.equal(f.calls.pack.length,0);
});
test('tampered output and partial verification cannot report ready for review',async t=>{
  await t.test('tampered bytes',async t=>{const f=await fixture(t), a=f.create();await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);await writeFile(path.join(f.dir,'render.mp4'),'different');await f.scheduler.tick();assert.equal(f.scheduler.get(a.id).diagnostic.code,'AUTOMATION_OUTPUT_HASH');assert.equal(f.calls.pack.length,0);});
  await t.test('no full decode',async t=>{const f=await fixture(t,{verifyOutput:async e=>({ok:true,playable:true,sha256:e.expectedHash})}),a=f.create();await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);await f.scheduler.tick();assert.equal(f.scheduler.get(a.id).diagnostic.code,'AUTOMATION_VIDEO_UNVERIFIED');assert.equal(f.calls.pack.length,0);});
});
test('an edit during asynchronous verification pauses before creator-pack dispatch',async t=>{
  let release;const wait=new Promise(resolve=>release=resolve);let entered;
  const started=new Promise(resolve=>entered=resolve), f=await fixture(t,{verifyOutput:async e=>{entered();await wait;return{ok:true,playable:true,fullDecode:true,sha256:e.expectedHash};}}), a=f.create();
  await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);const tick=f.scheduler.tick();await started;f.updateProject({title:'Edited during validation'});release();await tick;
  assert.equal(f.scheduler.get(a.id).status,'paused');assert.equal(f.calls.pack.length,0);
});
test('creator pack must match the verified source, manifest and actual thumbnail bytes',async t=>{
  const f=await fixture(t);await f.scheduler.close();f.setup({prepareCreatorPack:async(...args)=>{await f.pack(...args);await writeFile(path.join(f.dir,'thumbnail.png'),'tampered');}});
  const a=f.create();await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);await f.scheduler.tick();
  assert.equal(f.scheduler.get(a.id).status,'failed');assert.equal(f.scheduler.get(a.id).diagnostic.code,'AUTOMATION_PACK_EVIDENCE');
});
test('restart after a completed creator pack consumes its receipt without duplicate dispatch',async t=>{
  const f=await fixture(t), a=f.create();await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);await f.scheduler.tick();assert.equal(f.scheduler.get(a.id).status,'needs-review');
  f.db.prepare("UPDATE local_automations SET status='running',step='creator-pack' WHERE id=?").run(a.id);
  await f.scheduler.close();f.setup();await f.scheduler.recover();assert.equal(f.scheduler.get(a.id).status,'needs-review');assert.equal(f.calls.pack.length,1);assert.equal(f.calls.dispatch.length,1);assert.equal(f.project().latestOutput.status,'review_required');assert.equal(f.scheduler.get(a.id).output.creatorPack.published,false);
});
test('pending cancellation creates no job; active cancellation waits for actual worker confirmation',async t=>{
  const f=await fixture(t,{cancelJob:async()=>{throw Object.assign(Error('Worker still stopping'),{code:'STOP_PENDING'});}}), pending=f.create();await f.scheduler.cancel(pending.id);assert.equal(f.scheduler.get(pending.id).status,'cancelled');assert.equal(f.calls.dispatch.length,0);
  const active=f.create();await f.scheduler.tick();const id=f.scheduler.get(active.id).jobId;await f.scheduler.cancel(active.id);assert.equal(f.scheduler.get(active.id).status,'cancelling');assert.equal(f.getJob(id).status,'running');
  f.db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(id);await f.scheduler.tick();assert.equal(f.scheduler.get(active.id).status,'cancelled');assert.equal(f.calls.pack.length,0);
});
test('forged ownership cannot cancel or reuse an unrelated job',async t=>{
  const f=await fixture(t), a=f.create();await f.scheduler.tick();const id=f.scheduler.get(a.id).jobId;f.db.prepare('UPDATE jobs SET input=? WHERE id=?').run(JSON.stringify({automationId:'someone-else'}),id);
  await assert.rejects(f.scheduler.cancel(a.id),{code:'AUTOMATION_JOB_OWNERSHIP'});assert.equal(f.getJob(id).status,'running');assert.equal(f.calls.cancel.length,0);assert.equal(f.scheduler.get(a.id).status,'running');
});
test('a failed dispatch cannot leave its queued job free to run later on restart',async t=>{
  const f=await fixture(t,{dispatchRender:async()=>{throw Object.assign(Error('Worker failed to start'),{code:'SPAWN_FAILED'});}}),a=f.create();await f.scheduler.tick();
  const status=f.scheduler.get(a.id);assert.equal(status.status,'failed');assert.equal(status.diagnostic.code,'SPAWN_FAILED');assert.equal(f.getJob(status.jobId).status,'cancelled');
});
test('cancel during creator-pack preparation waits for the actual job and never advances to review',async t=>{
  let release,entered;const waiting=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);const f=await fixture(t);await f.scheduler.close();
  f.setup({cancelJob:async()=>{throw Object.assign(Error('Creator pack finishes its current CPU operation'),{code:'CREATOR_PACK_CONTROL'});},prepareCreatorPack:async(projectId,input,internal)=>{
    const stamp='2026-09-08T12:00:00Z';f.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(internal.jobId,projectId,input.expectedRevision,'creator-pack','running',0,'CPU operation',JSON.stringify({automationId:internal.automationId}),null,null,1,stamp,stamp);entered();await waiting;
    f.db.prepare("UPDATE jobs SET status='succeeded',output='{}' WHERE id=?").run(internal.jobId);
  }});
  const a=f.create();await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);const tick=f.scheduler.tick();await started;await f.scheduler.cancel(a.id);
  assert.equal(f.scheduler.get(a.id).status,'cancelling');assert.equal(f.getJob(f.scheduler.get(a.id).jobId).status,'running');release();await tick;await f.scheduler.tick();
  assert.equal(f.scheduler.get(a.id).status,'cancelled');assert.equal(f.project().latestOutput.status,'review_required');
});
test('real CPU MP4 decode and creator-pack receipt complete only to needs-review', {timeout:45000,skip:!existsSync(ffmpeg)||!existsSync(ffprobe)},async t=>{
  const f=await fixture(t);await exec(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-y',f.source],{windowsHide:true});
  const verifier=createLocalAutomationVerifier({ffmpeg,ffprobe});await f.scheduler.close();f.setup({verifyOutput:verifier,prepareCreatorPack:async(projectId,input,internal)=>{
    const current=f.project(),video=f.db.prepare('SELECT * FROM assets WHERE id=?').get(current.latestOutput.videoAssetId);
    f.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(internal.jobId,projectId,current.revision,'creator-pack','running',0,'Preparing',JSON.stringify({automationId:internal.automationId}),null,null,1,current.createdAt||'',current.createdAt||'');
    const pack=await buildCreatorPack({project:current,videoPath:video.path,outputDir:path.join(f.dir,'real-pack'),ffmpeg,ffprobe}),assets={};
    for(const [kind,name]of Object.entries(pack.outputs)){assets[kind]=`real-${kind}`;f.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(assets[kind],projectId,JSON.stringify({jobId:internal.jobId}),path.join(f.dir,'real-pack',name),'');}
    const receipt={...pack,assets,jobId:internal.jobId,sourceAssetId:video.id,projectRevision:input.expectedRevision,attached:true};
    f.db.prepare("UPDATE jobs SET status='succeeded',output=? WHERE id=?").run(JSON.stringify(receipt),internal.jobId);f.updateProject({creatorPack:receipt});
  }});
  const a=f.create();await f.scheduler.tick();await f.completeRender(f.scheduler.get(a.id).jobId);await f.scheduler.tick();const result=f.scheduler.get(a.id);
  assert.equal(result.status,'needs-review',JSON.stringify(result.diagnostic));assert.equal(result.output.verification.fullDecode,true);assert.equal(result.output.verification.method,'ffprobe-and-full-ffmpeg-decode');assert.equal(f.project().latestOutput.status,'review_required');assert.equal(result.output.creatorPack.published,false);
  const corrupt=path.join(f.dir,'corrupt.mp4');await writeFile(corrupt,'not a video');await assert.rejects(verifier({asset:{path:corrupt},project:f.project(),expectedHash:sha('not a video')}),{code:'AUTOMATION_VIDEO_INVALID'});
});
