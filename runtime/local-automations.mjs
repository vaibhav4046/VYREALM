import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyMedia } from './media-verifier.mjs';

const exec = promisify(execFile), hashes = /^[a-f0-9]{64}$/;
const pending = new Set(['queued', 'running', 'staging', 'validating', 'cancelling']);
const successful = new Set(['succeeded', 'review_required']);
const coordinators = new WeakMap();
const parse = value => value ? JSON.parse(value) : null;
const failure = (code, message) => Object.assign(new Error(message), { code });
const reject = (code, message) => { throw failure(code, message); };
const hashFile = async file => { const hash = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
const boundedError = error => ({ code: String(error.code || 'LOCAL_AUTOMATION_FAILED').slice(0,100), message: String(error.message || error).slice(0,1600) });
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
const processAlive = pid => { try { process.kill(pid,0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
export const LOCAL_AUTOMATION_PENDING_LIMIT = 64;
const STOP_RETRY_MS = 5000, STOP_ATTEMPT_LIMIT = 3;
export function summarizeLocalAutomations(runs) {
  const result={total:runs.length,scheduled:0,running:0,cancelling:0,paused:0,failed:0,cancelled:0,readyForReview:0,unverifiedReviewStates:0,pending:0,pendingLimit:LOCAL_AUTOMATION_PENDING_LIMIT,publishedByAutomation:0};
  for(const run of runs){
    if(['scheduled','running','cancelling','paused','failed','cancelled'].includes(run.status))result[run.status]++;
    if(['scheduled','running','cancelling'].includes(run.status))result.pending++;
    if(run.status==='needs-review'){
      const o=run.output,v=o?.verification,p=o?.creatorPack;
      if(hashes.test(o?.sha256||'')&&identifier(o.videoAssetId)&&v?.ok===true&&v.playable===true&&v.fullDecode===true&&v.sha256===o.sha256&&identifier(p?.jobId)&&p.sourceAssetId===o.videoAssetId&&p.sourceHash===o.sha256&&p.status==='draft'&&p.published===false)result.readyForReview++;
      else result.unverifiedReviewStates++;
    }
  }
  return result;
}

export function localAutomationJobId(automationId, step) {
  if (!identifier(automationId) || !['render', 'creator-pack'].includes(step)) reject('AUTOMATION_ID', 'Invalid automation or step.');
  const hex = crypto.createHash('sha256').update(`vyrealm-local-automation-v1:${automationId}:${step}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

/** CPU verification of the entire output, not a simulated completion or a creative-quality score. */
export function createLocalAutomationVerifier({ ffmpeg, ffprobe, timeoutMs = 600000 } = {}) {
  for (const executable of [ffmpeg, ffprobe]) if (typeof executable !== 'string' || !path.isAbsolute(executable)) reject('AUTOMATION_VERIFIER', 'Absolute local FFmpeg and FFprobe executables are required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) reject('AUTOMATION_VERIFIER', 'Decode timeout must be between one second and one hour.');
  return async ({ asset, project, expectedHash }) => {
    const settings = project.settings || {}, fps = Number(settings.fps) || 24;
    const durationSeconds = project.timeline.reduce((total,clip) => total+Math.max(1,Math.round(clip.duration*fps))/fps,0);
    const report = await verifyMedia({ videoPath: asset.path, ffmpeg, ffprobe, expected: { width: settings.width, height: settings.height, fps: settings.fps, durationSeconds } });
    if (!report.ok) reject('AUTOMATION_VIDEO_INVALID', report.diagnostics.map(item => item.message).join('; '));
    await exec(ffmpeg, ['-v','error','-xerror','-i',asset.path,'-map','0:v:0','-map','0:a?','-threads','1','-f','null','-'], { windowsHide:true, timeout:timeoutMs, maxBuffer:1024*1024 });
    const sha256 = await hashFile(asset.path);
    if (sha256 !== expectedHash) reject('AUTOMATION_OUTPUT_CHANGED', 'Video bytes changed during the decode check.');
    return { ok:true, playable:true, fullDecode:true, sha256, checks:report.checks, method:'ffprobe-and-full-ffmpeg-decode' };
  };
}

/**
 * Durable render → creator materials → human review. Uses the canonical DB.
 * The host owns worker processes; dispatchRender must use job.input.projectSnapshot
 * and recheck the revision after any GPU wait. prepareCreatorPack must honor its
 * deterministic internal jobId. Neither callback may approve or publish a result.
 * Call recover() after the host's interrupted-job recovery, then tick periodically.
 */
export function createLocalAutomations({ db, dispatchRender, prepareCreatorPack, cancelJob, verifyOutput, clock = () => Date.now() } = {}) {
  for (const [name, value] of Object.entries({ dispatchRender, prepareCreatorPack, cancelJob, verifyOutput, clock })) if (typeof value !== 'function') reject('AUTOMATION_CONFIG', `${name} must be provided.`);
  if (!db?.prepare || !db?.exec) reject('AUTOMATION_CONFIG', 'The canonical SQLite database is required.');
  if (coordinators.has(db)) reject('AUTOMATION_SCHEDULER_ACTIVE', 'This database already has a local automation scheduler.');
  db.exec(`CREATE TABLE IF NOT EXISTS local_automations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, project_id TEXT NOT NULL,
    expected_revision INTEGER NOT NULL, scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL, step TEXT NOT NULL, job_id TEXT,
    output TEXT NOT NULL, diagnostic TEXT, snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS local_automations_due ON local_automations(status,scheduled_at);
  CREATE TABLE IF NOT EXISTS local_automation_scheduler (singleton INTEGER PRIMARY KEY CHECK(singleton=1),owner_pid INTEGER NOT NULL,owner_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS local_automation_requests (request_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,automation_id TEXT NOT NULL);`);
  const owner = crypto.randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT * FROM local_automation_scheduler WHERE singleton=1').get();
    if (previous && processAlive(previous.owner_pid)) reject('AUTOMATION_SCHEDULER_ACTIVE', 'Another running control plane owns this database’s local automation scheduler.');
    db.prepare('INSERT OR REPLACE INTO local_automation_scheduler VALUES(1,?,?)').run(process.pid,owner);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  let flight = null, closed = false;
  const dispatched = new Set(), stopFlights = new Map();
  coordinators.set(db, true);
  const time = () => { const stamp = new Date(clock()); if (!Number.isFinite(stamp.getTime())) reject('AUTOMATION_CLOCK', 'Invalid local clock.'); return stamp.toISOString(); };
  const row = id => db.prepare('SELECT * FROM local_automations WHERE id=?').get(id);
  const job = id => id && db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const projectRow = id => db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  const view = item => item ? { id:item.id, name:item.name, projectId:item.project_id, expectedRevision:item.expected_revision, scheduledAt:item.scheduled_at, status:item.status, step:item.step, jobId:item.job_id, output:parse(item.output), diagnostic:parse(item.diagnostic), createdAt:item.created_at, updatedAt:item.updated_at } : null;
  const transaction = action => { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const save = (id, changes) => {
    const current = row(id); if (!current) reject('AUTOMATION_NOT_FOUND', 'Local automation not found.');
    const next = { ...current, ...changes, updated_at:time() };
    db.prepare('UPDATE local_automations SET status=?,step=?,job_id=?,output=?,diagnostic=?,updated_at=? WHERE id=?').run(next.status,next.step,next.job_id,next.output,next.diagnostic,next.updated_at,id);
    return row(id);
  };
  const finish = (id, status, diagnostic) => save(id, { status, diagnostic:diagnostic ? JSON.stringify(diagnostic) : null });
  const ownJob = (automation, currentJob, type) => {
    const input = parse(currentJob?.input);
    if (!currentJob || currentJob.id !== localAutomationJobId(automation.id,type) || currentJob.project_id !== automation.project_id || currentJob.type !== type || input?.automationId !== automation.id) reject('AUTOMATION_JOB_OWNERSHIP', 'The recorded job does not belong to this automation.');
    return currentJob;
  };
  const sameRevision = (automation, revision) => projectRow(automation.project_id)?.revision === revision;
  async function requestStop(automation, target, diagnostic) {
    automation=row(automation.id);
    if(!['scheduled','running','cancelling'].includes(automation.status))return automation;
    const currentJob = job(automation.job_id);
    if (currentJob && pending.has(currentJob.status)) ownJob(automation,currentJob,automation.step === 'creator-pack' ? 'creator-pack' : 'render');
    const prior=parse(automation.output),priorDiagnostic=parse(automation.diagnostic);
    // A later explicit user cancellation takes precedence over an automatic
    // pause/failure. A stale async stop must not write its older outcome back.
    if(automation.status==='cancelling'&&(prior.afterCancel==='cancelled'||target!=='cancelled')){target=prior.afterCancel||target;diagnostic=priorDiagnostic||diagnostic;}
    else if(automation.status==='cancelling'&&priorDiagnostic?.cancellation)diagnostic={...diagnostic,cancellation:priorDiagnostic.cancellation};
    const output = { ...prior, afterCancel:target };
    save(automation.id, { status:'cancelling', output:JSON.stringify(output), diagnostic:JSON.stringify(diagnostic) });
    if(stopFlights.has(automation.id))return stopFlights.get(automation.id);
    const finishStopped=()=>{const latest=row(automation.id);if(latest.status!=='cancelling')return latest;return finish(latest.id,parse(latest.output).afterCancel||'cancelled',parse(latest.diagnostic));};
    if (!currentJob || !pending.has(currentJob.status)) return finishStopped();
    if((output.cancelAttempts||0)>=STOP_ATTEMPT_LIMIT||Number(output.nextCancelAttemptAt)>clock())return row(automation.id);
    const operation=(async()=>{
      if(currentJob.status==='queued')db.prepare("UPDATE jobs SET status='cancelled',stage='Local automation cancelled before dispatch',updated_at=? WHERE id=? AND status='queued'").run(time(),currentJob.id);
      else{
        const latest=row(automation.id),attempts=(parse(latest.output).cancelAttempts||0)+1;
        save(latest.id,{output:JSON.stringify({...parse(latest.output),cancelAttempts:attempts,nextCancelAttemptAt:clock()+STOP_RETRY_MS})});
        try{await cancelJob(currentJob.id);}
        catch(error){const current=row(automation.id),base=parse(current.diagnostic)||diagnostic;save(current.id,{diagnostic:JSON.stringify({...base,cancellation:boundedError(error),message:`${base.message.split(' Waiting for the owned job')[0]} Waiting for the owned job to stop; cancellation is unconfirmed.${attempts>=STOP_ATTEMPT_LIMIT?' Three automatic stop attempts were exhausted; the queue remains held.':''}`.slice(0,1600)})});}
      }
      if(!pending.has(job(currentJob.id)?.status))return finishStopped();
      return row(automation.id);
    })().finally(()=>stopFlights.delete(automation.id));
    stopFlights.set(automation.id,operation);return operation;
  }
  async function pause(automation) {
    return requestStop(automation,'paused',{ code:'AUTOMATION_PROJECT_CHANGED', message:`Project revision changed from the saved automation revision. No newer edits will be overwritten. Create a new automation for the revised project.` });
  }
  function create(input) {
    if (closed) reject('AUTOMATION_CLOSED', 'Scheduler is closed.');
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['name','projectId','expectedRevision','scheduledAt','requestId'].includes(key))) reject('AUTOMATION_REQUEST', 'Only name, projectId, expectedRevision, scheduledAt and an optional requestId are accepted.');
    if (!identifier(input.projectId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160 || /[\u0000-\u001f]/.test(input.name)) reject('AUTOMATION_REQUEST', 'A saved project, revision and bounded name are required.');
    if (input.scheduledAt !== undefined && (typeof input.scheduledAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.scheduledAt) || !Number.isFinite(Date.parse(input.scheduledAt)))) reject('AUTOMATION_SCHEDULE', 'Use an ISO timestamp with an explicit timezone.');
    if (input.requestId !== undefined && !identifier(input.requestId)) reject('AUTOMATION_REQUEST', 'requestId must be a bounded identifier.');
    const inputHash = crypto.createHash('sha256').update(JSON.stringify({name:input.name.trim(),projectId:input.projectId,expectedRevision:input.expectedRevision,scheduledAt:input.scheduledAt?new Date(input.scheduledAt).toISOString():null})).digest('hex');
    return transaction(() => {
      if (input.requestId) {
        const prior = db.prepare('SELECT * FROM local_automation_requests WHERE request_id=?').get(input.requestId);
        if (prior) {
          if (prior.input_hash !== inputHash) reject('AUTOMATION_REQUEST_CONFLICT', 'This requestId already belongs to a different automation request. Use a new requestId for changed inputs.');
          const existing = row(prior.automation_id);
          if (!existing) reject('AUTOMATION_REQUEST_EVIDENCE', 'The saved idempotency record has no matching automation.');
          return view(existing);
        }
      }
      const duplicate=db.prepare("SELECT id FROM local_automations WHERE project_id=? AND expected_revision=? AND status IN ('scheduled','running','cancelling') LIMIT 1").get(input.projectId,input.expectedRevision);
      if(duplicate)reject('AUTOMATION_PROJECT_CONFLICT',`This saved project revision already has pending automation ${duplicate.id}. Inspect or cancel that workflow before starting another; use separate saved projects for distinct batch outputs.`);
      if(db.prepare("SELECT count(*) AS n FROM local_automations WHERE status IN ('scheduled','running','cancelling')").get().n>=LOCAL_AUTOMATION_PENDING_LIMIT)reject('AUTOMATION_QUEUE_FULL',`The local queue already contains ${LOCAL_AUTOMATION_PENDING_LIMIT} pending workflows. Let work finish or cancel pending items before adding more.`);
      const saved = projectRow(input.projectId);
      if (!saved || saved.revision !== input.expectedRevision) reject('AUTOMATION_REVISION', 'Save and reload the current project before scheduling it.');
      const snapshot = parse(saved.document);
      if (!Array.isArray(snapshot.timeline) || !snapshot.timeline.length || snapshot.timeline.length > 64) reject('AUTOMATION_TIMELINE', 'A saved timeline containing 1–64 media clips is required.');
      for (const clip of snapshot.timeline) {
        const asset = identifier(clip.assetId) && db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(clip.assetId,input.projectId);
        if (!asset || !/^(video|image)\//.test(parse(asset.document)?.mime || '') || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 3600 || (clip.trimStart !== undefined && (!Number.isFinite(clip.trimStart) || clip.trimStart < 0 || clip.trimStart > 3600))) reject('AUTOMATION_TIMELINE', 'Every clip needs available project media, positive duration and valid source trim.');
      }
      if (snapshot.timeline.reduce((sum,clip) => sum+clip.duration,0) > 21600) reject('AUTOMATION_TIMELINE', 'The renderer supports timelines up to six hours.');
      if (saved.document.length > 2*1024*1024) reject('AUTOMATION_SNAPSHOT', 'Saved project snapshot exceeds the 2 MiB scheduler limit.');
      const id = crypto.randomUUID(), stamp = time(), at = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : stamp;
      const output = { renderJobId:localAutomationJobId(id,'render'), creatorPackJobId:localAutomationJobId(id,'creator-pack') };
      db.prepare('INSERT INTO local_automations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.name.trim(),input.projectId,input.expectedRevision,at,'scheduled','waiting',null,JSON.stringify(output),null,saved.document,stamp,stamp);
      if (input.requestId) db.prepare('INSERT INTO local_automation_requests VALUES(?,?,?)').run(input.requestId,inputHash,id);
      return view(row(id));
    });
  }
  function queueRender(automation) {
    return transaction(() => {
      const current = row(automation.id);
      if (current.status !== 'scheduled') return current;
      if (!sameRevision(current,current.expected_revision)) return finish(current.id,'paused',{ code:'AUTOMATION_PROJECT_CHANGED', message:'The saved project changed before its scheduled render. Create a new automation for the revised project.' });
      const id = parse(current.output).renderJobId, stamp = time();
      const input = { type:'render', projectId:current.project_id, revision:current.expected_revision, expectedRevision:current.expected_revision, automationId:current.id, projectSnapshot:parse(current.snapshot) };
      db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,current.project_id,current.expected_revision,'render','queued',0,'Local automation: render queued',JSON.stringify(input),0,stamp,stamp);
      return save(current.id,{ status:'running', step:'render', job_id:id });
    });
  }
  function ownedVideo(automation) {
    const sourceJob = ownJob(automation,job(parse(automation.output).renderJobId),'render'), receipt = parse(sourceJob.output);
    const project = projectRow(automation.project_id), document = parse(project?.document), latest = document?.latestOutput;
    const asset = latest?.videoAssetId && db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(latest.videoAssetId,automation.project_id);
    const sha256 = receipt?.provenance?.outputHash;
    if (sourceJob.revision !== automation.expected_revision || !successful.has(sourceJob.status) || receipt?.promoted !== true || latest?.jobId !== sourceJob.id || !asset || parse(asset.document)?.jobId !== sourceJob.id || !/^video\//.test(parse(asset.document)?.mime || '') || !hashes.test(sha256 || '') || latest?.provenance?.outputHash !== sha256 || ['blocked','rejected'].includes(latest?.status)) reject('AUTOMATION_OUTPUT_EVIDENCE', 'The render has no matching, promoted, hash-bound video owned by this project.');
    return { asset, job:sourceJob, project:{...document,id:project.id,revision:project.revision}, expectedHash:sha256 };
  }
  async function inspectOutput(automation) {
    const evidence = ownedVideo(automation), info = await lstat(evidence.asset.path);
    if (!path.isAbsolute(evidence.asset.path) || info.isSymbolicLink() || !info.isFile() || info.size <= 0 || await hashFile(evidence.asset.path) !== evidence.expectedHash) reject('AUTOMATION_OUTPUT_HASH', 'The owned video is missing or its bytes do not match its render receipt.');
    const report = await verifyOutput(evidence);
    if (!report || report.ok !== true || report.playable !== true || report.fullDecode !== true || report.sha256 !== evidence.expectedHash) reject('AUTOMATION_VIDEO_UNVERIFIED', 'The actual output has not passed full-file playback verification.');
    if (await hashFile(evidence.asset.path) !== evidence.expectedHash) reject('AUTOMATION_OUTPUT_CHANGED', 'The output changed after verification.');
    return { videoAssetId:evidence.asset.id, sha256:evidence.expectedHash, verification:report, postRenderRevision:evidence.project.revision };
  }
  async function inspectPack(automation) {
    const state = parse(automation.output), packJob = ownJob(automation,job(state.creatorPackJobId),'creator-pack'), receipt = parse(packJob.output);
    const saved = projectRow(automation.project_id), current = parse(saved?.document);
    if (packJob.status !== 'succeeded' || receipt?.kind !== 'creator-pack' || receipt?.attached !== true || receipt?.jobId !== packJob.id || receipt?.sourceAssetId !== state.videoAssetId || receipt?.source?.sha256 !== state.sha256 || receipt?.projectRevision !== state.postRenderRevision || current?.creatorPack?.jobId !== packJob.id || current?.creatorPack?.source?.sha256 !== state.sha256) reject('AUTOMATION_PACK_EVIDENCE', 'Creator materials lack a matching attached receipt for this verified video.');
    for (const kind of ['manifest','draft','thumbnail']) {
      const id = receipt.assets?.[kind]?.id || receipt.assets?.[kind], asset = identifier(id) && db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(id,automation.project_id);
      const info = asset && await lstat(asset.path);
      if (!asset || parse(asset.document)?.jobId !== packJob.id || !info.isFile() || info.isSymbolicLink() || info.size <= 0) reject('AUTOMATION_PACK_ASSET', `The saved creator-pack ${kind} file is missing or belongs to another job.`);
      if (kind === 'manifest') {
        if (info.size > 2*1024*1024) reject('AUTOMATION_PACK_ASSET', 'Creator-pack manifest exceeds its size limit.');
        const manifest = JSON.parse(await readFile(asset.path,'utf8'));
        if (manifest.kind !== 'creator-pack' || manifest.source?.sha256 !== state.sha256 || manifest.project?.id !== automation.project_id || manifest.project?.revision !== state.postRenderRevision) reject('AUTOMATION_PACK_EVIDENCE', 'The creator-pack manifest does not match this output and revision.');
      }
      if (kind === 'thumbnail' && (!hashes.test(receipt.thumbnail?.sha256 || '') || await hashFile(asset.path) !== receipt.thumbnail.sha256)) reject('AUTOMATION_PACK_EVIDENCE', 'The thumbnail bytes do not match the creator-pack receipt.');
    }
    const source = db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(state.videoAssetId,automation.project_id);
    if (!source || await hashFile(source.path) !== state.sha256) reject('AUTOMATION_OUTPUT_CHANGED', 'Verified video bytes changed while creator materials were prepared.');
    return { jobId:packJob.id, assets:receipt.assets, sourceAssetId:state.videoAssetId, sourceHash:state.sha256, status:'draft', published:false };
  }
  async function advance(initial) {
    let automation = row(initial.id);
    if (automation.status === 'scheduled') automation = queueRender(automation);
    if (automation.status === 'cancelling') {
      if (!pending.has(job(automation.job_id)?.status)) finish(automation.id,parse(automation.output).afterCancel || 'cancelled',parse(automation.diagnostic));
      else if(parse(automation.diagnostic)?.cancellation&&(parse(automation.output).cancelAttempts||0)<STOP_ATTEMPT_LIMIT&&Number(parse(automation.output).nextCancelAttemptAt||0)<=clock())await requestStop(automation,parse(automation.output).afterCancel||'cancelled',parse(automation.diagnostic));
      return view(row(automation.id));
    }
    if (automation.status !== 'running') return view(automation);
    const state = parse(automation.output), currentJob = job(automation.job_id);
    if (automation.step === 'render') {
      ownJob(automation,currentJob,'render');
      if (pending.has(currentJob.status)) {
        if (!sameRevision(automation,automation.expected_revision)) return view(await pause(automation));
        if (currentJob.status === 'queued' && !dispatched.has(currentJob.id)) { dispatched.add(currentJob.id); await dispatchRender(currentJob.id); }
        return view(row(automation.id));
      }
      if (!successful.has(currentJob.status) && !sameRevision(automation,automation.expected_revision)) return view(await pause(automation));
      if (!successful.has(currentJob.status)) reject('AUTOMATION_RENDER_FAILED', `Render ${currentJob.status}: ${currentJob.error || currentJob.stage || 'No playable output.'}`);
      if (!sameRevision(automation,automation.expected_revision+1)) return view(await pause(automation));
      automation = save(automation.id,{ step:'verify' });
    }
    if (automation.step === 'verify') {
      if (!sameRevision(automation,automation.expected_revision+1)) return view(await pause(automation));
      const verified = await inspectOutput(automation);
      automation = row(automation.id);
      if (automation.status !== 'running') return view(automation);
      if (!sameRevision(automation,automation.expected_revision+1)) return view(await pause(automation));
      automation = save(automation.id,{ step:'creator-pack', job_id:state.creatorPackJobId, output:JSON.stringify({...state,...verified}) });
    }
    if (automation.step === 'creator-pack') {
      const currentState = parse(automation.output), existing = job(currentState.creatorPackJobId);
      if (!existing) {
        if (!sameRevision(automation,currentState.postRenderRevision)) return view(await pause(automation));
        await prepareCreatorPack(automation.project_id,{ expectedRevision:currentState.postRenderRevision },{ jobId:currentState.creatorPackJobId, automationId:automation.id });
        automation = row(automation.id);
        if (automation.status !== 'running') return view(automation);
      }
      const packJob = ownJob(automation,job(currentState.creatorPackJobId),'creator-pack');
      if (pending.has(packJob.status)) {
        if (!sameRevision(automation,currentState.postRenderRevision)) return view(await pause(automation));
        return view(automation);
      }
      if (packJob.status !== 'succeeded' && !sameRevision(automation,currentState.postRenderRevision)) return view(await pause(automation));
      if (packJob.status !== 'succeeded') reject('AUTOMATION_PACK_FAILED', `Creator pack ${packJob.status}: ${packJob.error || packJob.stage || 'No receipt.'}`);
      if (!sameRevision(automation,currentState.postRenderRevision+1)) return view(await pause(automation));
      const pack = await inspectPack(automation);
      automation = row(automation.id);
      if (automation.status !== 'running') return view(automation);
      if (!sameRevision(automation,currentState.postRenderRevision+1)) return view(await pause(automation));
      return view(save(automation.id,{ status:'needs-review', step:'review', output:JSON.stringify({...currentState,creatorPack:pack}), diagnostic:null }));
    }
    return view(row(automation.id));
  }
  function tick() {
    if (closed) return Promise.resolve(null);
    if (flight) return flight;
    flight = (async () => {
      for(const id of dispatched)if(!pending.has(job(id)?.status))dispatched.delete(id);
      const next = db.prepare("SELECT * FROM local_automations WHERE status IN ('running','cancelling') OR (status='scheduled' AND scheduled_at<=?) ORDER BY CASE WHEN status='scheduled' THEN 1 ELSE 0 END,scheduled_at,created_at,id LIMIT 1").get(time());
      if (!next) return null;
      try { return await advance(next); }
      catch (error) {
        const latest = row(next.id);
        if (latest?.status === 'cancelling') return view(latest);
        const currentJob = job(latest?.job_id), diagnostic = boundedError(error);
        if (pending.has(currentJob?.status) && error.code !== 'AUTOMATION_JOB_OWNERSHIP') {
          try { return view(await requestStop(latest,'failed',diagnostic)); }
          catch (stopError) { return view(finish(next.id,'failed',boundedError(stopError))); }
        }
        return view(finish(next.id,'failed',diagnostic));
      }
    })().finally(() => { flight = null; });
    return flight;
  }
  async function cancel(id) {
    const automation = row(id);
    if (!automation) reject('AUTOMATION_NOT_FOUND', 'Local automation not found.');
    if (['cancelled','failed','needs-review','paused'].includes(automation.status)) return view(automation);
    return view(await requestStop(automation,'cancelled',{code:'AUTOMATION_CANCELLED',message:'Local automation cancellation requested. Completed files and project history are retained.'}));
  }
  return {
    create, get:id => view(row(id)), list:() => db.prepare('SELECT * FROM local_automations ORDER BY created_at DESC,id').all().map(view), summary:()=>summarizeLocalAutomations(db.prepare('SELECT * FROM local_automations').all().map(view)), tick,
    recover:tick, cancel,
    async close() { if (closed) return; closed = true; await flight; await Promise.allSettled([...stopFlights.values()]); db.prepare('DELETE FROM local_automation_scheduler WHERE owner_id=?').run(owner); coordinators.delete(db); },
  };
}
