import { promises as fs, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMahabharataDirection } from './mahabharata-direction.mjs';
import { validateKeyframeRequest, verifyKeyframeEvidence, verifyOwnedGeneratedKeyframe } from './keyframe-production.mjs';
import { wanWorkflow, WAN_MODELS } from './neural-production.mjs';
import { acquireGpuLease } from './inference-harness.mjs';
import { ensureManagedComfyUI } from './managed-comfyui.mjs';
import { createComfyUIProvider } from './providers/comfyui.mjs';
import { hashJson } from './generation-gate.mjs';

const OWNER='cinematic-keyframe-service-v1';
const ACTIVE=['queued','running','staging','validating','cancelling'];
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const now=()=>new Date().toISOString();
const projectDoc=row=>row?{...parse(row.document),id:row.id,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at}:null;
const jobDoc=row=>row?{...parse(row.input),input:parse(row.input),id:row.id,projectId:row.project_id,revision:row.revision,type:row.type,status:row.status,progress:row.progress||0,progressUnit:'percent',stage:row.stage,error:row.error,output:row.output?parse(row.output):null,attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at}:null;
const stopped=signal=>{if(signal?.aborted)fail('CINEMATIC_CANCELLED','Casting generation was cancelled. Existing films were retained.');};
function bounded(promise,signal){if(signal.aborted)return Promise.reject(Object.assign(new Error('Casting generation cancelled'),{code:'CINEMATIC_CANCELLED'}));return new Promise((resolve,reject)=>{const cancel=()=>reject(Object.assign(new Error('Casting generation cancelled'),{code:'CINEMATIC_CANCELLED'}));signal.addEventListener('abort',cancel,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});}
async function pause(ms,signal){return bounded(new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();}),signal);}
function atomicJSON(file,value){const temp=`${file}.${crypto.randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify(value,null,2),{flag:'wx'});renameSync(temp,file);}

export async function preflightCinematicKeyframe({request,jobsDir,dataDir,provider=createComfyUIProvider()}) {
  const managed=await ensureManagedComfyUI({runtimeDir:process.env.VYRELUM_RUNTIME_DIR||path.join(dataDir,'runtime'),provider});
  if(managed.status!=='ready')fail(managed.code||'KEYFRAME_PROVIDER_UNAVAILABLE',managed.message||'Install or repair the local ComfyUI runtime in Settings.');
  const health=managed.health||await provider.health_check();
  if(!health.available)fail('KEYFRAME_PROVIDER_UNAVAILABLE',health.reason||'The local ComfyUI provider is unavailable.');
  const workflow=wanWorkflow({...request,frames:1,prefix:'vyrealm/preflight/keyframe'}),installed=Object.values(health.installedModels||{}).flat();
  const missingModels=Object.values(WAN_MODELS).filter(name=>!installed.includes(name)),missingNodes=[...new Set(Object.values(workflow).map(node=>node.class_type))].filter(name=>!health.nodes?.includes(name));
  if(missingModels.length||missingNodes.length)fail('KEYFRAME_DEPENDENCIES_MISSING',`Missing local dependencies: ${[...missingModels,...missingNodes].join(', ')}`);
  const cuda=health.system?.devices?.find(device=>device.type==='cuda');
  if(!cuda)fail('KEYFRAME_CUDA_UNQUALIFIED','This local Wan keyframe profile requires the qualified CUDA runtime. No untested CPU or macOS route was substituted.');
  const disk=await fs.statfs(jobsDir),freeDiskBytes=Number(disk.bavail)*Number(disk.bsize);
  if(freeDiskBytes<512*1024**2)fail('KEYFRAME_DISK_SPACE','At least 512 MiB of free job storage is required.');
  return {available:true,providerId:'comfyui-local',models:WAN_MODELS,device:cuda.name,vramBytes:Number(cuda.vram_total)||null,freeDiskBytes,profile:{width:1024,height:576,steps:20,frames:1}};
}

export async function cancelOwnedCinematicPrompt({jobRoot,provider=createComfyUIProvider()}){
  const request=validateKeyframeRequest(JSON.parse(await fs.readFile(path.join(jobRoot,'request.json'),'utf8'))),workflow=wanWorkflow({...request,frames:1,prefix:`vyrealm/${path.basename(jobRoot)}/keyframe`}),expectedHash=hashJson(workflow);
  const response=await provider.fetch(`${provider.baseUrl}/queue`,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)fail('CINEMATIC_CANCEL_UNCONFIRMED','The provider queue could not be inspected; no unrelated prompt was interrupted.');
  const queue=await response.json();if(!Array.isArray(queue.queue_running)||!Array.isArray(queue.queue_pending))fail('CINEMATIC_CANCEL_UNCONFIRMED','Provider queue ownership could not be verified.');
  const owned=[...queue.queue_running,...queue.queue_pending].filter(entry=>Array.isArray(entry)&&typeof entry[1]==='string'&&entry[2]&&hashJson(entry[2])===expectedHash);
  for(const entry of owned)await provider.cancel(entry[1]);
  return {ownedPromptIds:owned.map(entry=>entry[1]),status:owned.length?'cancellation-requested':'not-active'};
}

async function startKeyframeWorker({root,jobRoot,onProgress}) {
  const script=path.join(root,'workers','cinematic-keyframe.mjs');
  const child=spawn(process.execPath,[script,'--job-root',jobRoot],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}});
  let stderr='',pending='';
  const completion=new Promise(resolve=>{
    child.once('error',error=>resolve({exitCode:1,error:`Worker start failed (${error.code||'unknown'}).`}));
    child.stdout.on('data',chunk=>{pending+=chunk.toString();if(pending.length>65536)pending=pending.slice(-65536);let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);try{const event=JSON.parse(line);if(event.type==='progress')onProgress(event);}catch{}}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-3000);});
    child.once('close',exitCode=>resolve({exitCode,error:stderr}));
  });
  return {pid:child.pid,completion,async cancel(){if(child.exitCode===null)child.kill();await completion;}};
}

/** Product-owned direction → one generated casting still. No animation is submitted here. */
export async function createCinematicKeyframeService({db,dataDir,jobsDir,mediaDir,root=fileURLToPath(new URL('..',import.meta.url)),dependencies={}}) {
  const build=dependencies.buildDirection||buildMahabharataDirection,preflight=dependencies.preflight||preflightCinematicKeyframe,acquire=dependencies.acquireLease||acquireGpuLease,startWorker=dependencies.startWorker||startKeyframeWorker;
  const verify=dependencies.verifyEvidence||verifyKeyframeEvidence,verifyOwned=dependencies.verifyOwned||verifyOwnedGeneratedKeyframe;
  const running=new Map();let starting=false,closing=false;
  await fs.mkdir(jobsDir,{recursive:true});await fs.mkdir(mediaDir,{recursive:true});
  const getJob=id=>db.prepare('SELECT * FROM jobs WHERE id=?').get(id),getProject=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  const isOwned=row=>row?.type==='generation-keyframe'&&parse(row.input).serviceOwner===OWNER;
  function stage(id,status,message,progress){db.prepare('UPDATE jobs SET status=?,stage=?,progress=?,updated_at=? WHERE id=?').run(status,message,Math.max(0,Math.min(100,progress||0)),now(),id);}
  async function cancelProvider(id){
    if(dependencies.cancelProvider)return dependencies.cancelProvider(id);
    const job=getJob(id);if(!isOwned(job))return;
    try{await cancelOwnedCinematicPrompt({jobRoot:path.join(jobsDir,id)});}
    catch(error){if(error.code!=='ENOENT')await fs.writeFile(path.join(jobsDir,id,'cancellation-diagnostic.json'),JSON.stringify({code:'OWNED_PROVIDER_CANCEL_UNCONFIRMED',message:'The exact owned prompt could not be confirmed cancelled; the provider queue must become idle before another generation.'})).catch(()=>{});}
  }
  // A restart never trusts a half-written output or launches another sample automatically.
  for(const row of db.prepare("SELECT * FROM jobs WHERE type='generation-keyframe' AND status IN ('queued','running','staging','validating','cancelling')").all())if(isOwned(row)){
    await cancelProvider(row.id);db.prepare("UPDATE jobs SET status='failed',stage='interrupted; retained evidence requires a new production request',error=?,updated_at=? WHERE id=?").run('CINEMATIC_RESTART_RECOVERY: The application restarted before casting review. No image was approved or reused.',now(),row.id);
  }
  function saveProject(row,document){const revision=row.revision+1,time=now(),text=JSON.stringify(document);const result=db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=? AND revision=? AND document=?').run(revision,text,time,row.id,row.revision,row.document);if(!result.changes)fail('CINEMATIC_REVISION_CONFLICT','The project changed during this operation. Completed work was retained.');db.prepare('INSERT INTO project_revisions(project_id,revision,document,created_at) VALUES(?,?,?,?)').run(row.id,revision,text,time);return revision;}
  async function waitForLease(id,signal){const deadline=Date.now()+600000;while(true){stopped(signal);try{return await acquire(`cinematic-keyframe:${id}`);}catch(error){if(error.message!=='GPU_LEASE_BUSY')throw error;if(Date.now()>=deadline)fail('CINEMATIC_GPU_WAIT_TIMEOUT','The shared GPU remained busy for ten minutes. No competing generation was submitted.');stage(id,'queued','Waiting for the shared GPU; existing work retained',2);await pause(1000,signal);}}}
  async function run(id){
    const row=getJob(id);if(!isOwned(row)||row.status!=='queued'||closing)return;
    const control={controller:new AbortController(),worker:null,release:null,cancellation:null,done:null};running.set(id,control);
    control.done=(async()=>{
      let timer;
      try{
        const input=parse(row.input),request=validateKeyframeRequest(JSON.parse(await fs.readFile(path.join(jobsDir,id,'request.json'),'utf8'))),jobRoot=path.join(jobsDir,id);stage(id,'running','Checking the installed local image model',3);
        const preflightResult=await bounded(preflight({request,jobsDir,dataDir}),control.controller.signal);await fs.writeFile(path.join(jobRoot,'preflight.json'),JSON.stringify(preflightResult,null,2));stopped(control.controller.signal);
        control.release=await waitForLease(id,control.controller.signal);stopped(control.controller.signal);
        stage(id,'running','Generating Arjuna casting image locally; animation awaits review',8);db.prepare('UPDATE jobs SET attempts=attempts+1 WHERE id=?').run(id);
        timer=setTimeout(()=>{control.timeout=true;void cancel(id);},20*60000);timer.unref?.();
        control.worker=await startWorker({root,jobRoot,request,signal:control.controller.signal,onProgress:event=>{if(control.controller.signal.aborted)return;const current=getJob(id);if(!current||!ACTIVE.includes(current.status))return;const elapsed=Number(event.elapsedSeconds)||0;stage(id,'running',event.stage||'Generating local casting image',Math.min(88,Math.max(8,Number(event.progress)>0?Number(event.progress)*85:8+elapsed/150*60)));}});
        if(control.worker.pid)await control.release.registerChild?.(control.worker.pid);
        stopped(control.controller.signal);const exit=await control.worker.completion;stopped(control.controller.signal);
        if(exit?.exitCode!==0)fail('CINEMATIC_WORKER_FAILED',`The owned keyframe worker stopped before verified output.${exit?.error?' '+String(exit.error).slice(-1500):''}`);
        stage(id,'validating','Verifying owned provider log, workflow, PNG and hash',92);
        const receipt=JSON.parse(await fs.readFile(path.join(jobRoot,'result.json'),'utf8')),evidence=await verify({jobRoot,request,ffmpeg:path.join(root,'workers/tools/ffmpeg.exe'),ffprobe:path.join(root,'workers/tools/ffprobe.exe')});stopped(control.controller.signal);
        if(receipt.kind!=='generated-keyframe'||receipt.status!=='review_required'||receipt.validated!==true||receipt.provenance?.outputHash!==evidence.outputHash||receipt.provenance?.evidenceHash!==evidence.evidenceHash||receipt.provenance?.providerId!=='comfyui-local'||receipt.provenance?.mediaKind!=='image')fail('CINEMATIC_EVIDENCE_MISMATCH','The local image receipt did not match its provider evidence. No reference was approved.');
        const assetId=crypto.randomUUID(),assetPath=path.join(mediaDir,`${assetId}-arjuna-casting.png`);await fs.writeFile(assetPath,evidence.bytes,{flag:'wx'});stopped(control.controller.signal);
        const project=getProject(row.project_id),document=parse(project?.document),promoted=project?.revision===request.expectedRevision&&document.cinematicProduction?.jobId===id;
        db.exec('BEGIN IMMEDIATE');try{
          if(!ACTIVE.includes(getJob(id)?.status))fail('CINEMATIC_JOB_CHANGED','The job changed before image registration.');
          let registeredRevision=project?.revision;
          db.prepare('INSERT INTO assets(id,project_id,document,path,created_at) VALUES(?,?,?,?,?)').run(assetId,row.project_id,JSON.stringify({name:'Arjuna · casting candidate.png',mime:'image/png',kind:'image',size:evidence.bytes.length,jobId:id,sourceMethod:'local-generated-keyframe',outputHash:evidence.outputHash,projectRevisionMatch:promoted}),assetPath,now());
          if(promoted){document.cinematicProduction={...document.cinematicProduction,status:'review_required',assetId,outputHash:evidence.outputHash};document.productionPlan={...document.productionPlan,castCandidate:{...document.productionPlan.castCandidate,referenceStatus:'review_required',assetId,outputHash:evidence.outputHash}};registeredRevision=saveProject(project,document);}
          const output={...receipt,assetId,assets:{image:assetId},reviewRequired:true,promoted,registeredRevision,directionHash:input.directionHash,sourceMethod:'local-generated-keyframe',diagnostics:[...(receipt.diagnostics||[]),...(!promoted?[{code:'PROJECT_CHANGED_IMAGE_RETAINED',message:'Project direction changed during generation; this image was retained but cannot become its current reference.'}]:[])]};
          db.prepare("UPDATE jobs SET status='review_required',progress=100,stage='Review Arjuna casting before any animation',output=?,updated_at=? WHERE id=?").run(JSON.stringify(output),now(),id);db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
      }catch(error){const code=control.timeout?'CINEMATIC_TIMEOUT':error.code||'CINEMATIC_FAILED',cancelled=control.controller.signal.aborted&&!control.timeout;await cancelProvider(id);if(control.worker)await control.worker.cancel().catch(()=>{});const message=`${code}: ${control.timeout?'The bounded casting job timed out. No animation or reference was approved.':error.message}`;await fs.writeFile(path.join(jobsDir,id,'failure.json'),JSON.stringify({status:cancelled?'cancelled':'blocked',code,message,modelOutputApproved:false},null,2)).catch(()=>{});db.prepare('UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=?').run(cancelled?'cancelled':'blocked',cancelled?'Casting cancelled; earlier work retained':'Casting blocked; inspect the local model diagnostic',message,now(),id);}
      finally{clearTimeout(timer);if(control.release)await control.release();running.delete(id);}
    })();
    return control.done;
  }
  async function start(input){
    if(!input||Object.keys(input).some(key=>!['projectId','expectedRevision','brief'].includes(key))||typeof input.brief!=='string'||!input.brief.trim()||input.brief.length>6000||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!/^[a-zA-Z0-9-]+$/.test(input.projectId||''))fail('CINEMATIC_REQUEST','An existing project, exact revision and a Mahabharata brief are required.');
    if(closing||starting||running.size)fail('CINEMATIC_BUSY','One casting generation is already active. Wait for review or cancel it before starting another.');starting=true;
    try{
      const project=getProject(input.projectId);if(!project)fail('CINEMATIC_PROJECT_NOT_FOUND','Project not found.');if(project.revision!==input.expectedRevision)fail('CINEMATIC_REVISION_CONFLICT','The project changed. Refresh before producing.');
      const direction=build({brief:input.brief.trim(),durationSeconds:30,seed:crypto.randomInt(0,2147483647)}),candidate=direction.castCandidate;
      const id=crypto.randomUUID(),revision=project.revision+1,request=validateKeyframeRequest({projectId:input.projectId,expectedRevision:revision,prompt:candidate.prompt,negativePrompt:candidate.negativePrompt,seed:candidate.seed,width:1024,height:576,steps:20,queuePolicy:'idle'}),directionHash=hashJson(direction),jobRoot=path.join(jobsDir,id);
      await fs.mkdir(jobRoot,{recursive:false});await fs.writeFile(path.join(jobRoot,'request.json'),JSON.stringify(request,null,2),{flag:'wx'});await fs.writeFile(path.join(jobRoot,'direction.json'),JSON.stringify(direction,null,2),{flag:'wx'});
      const old=parse(project.document),characters=[...direction.characters.map(character=>({...character,referenceAssetId:null})),...(Array.isArray(old.characters)?old.characters:[]).filter(character=>!direction.characters.some(next=>next.id===character.id||next.name.toLowerCase()===String(character.name).toLowerCase()))];
      const document={...old,brief:input.brief.trim(),script:direction.script,narration:direction.narration,characters,productionPlan:{...direction.productionPlan,castCandidate:candidate,sourceMethod:'builtin-editorial-recipe',authorship:direction.authorship},cinematicProduction:{serviceOwner:OWNER,recipeId:direction.recipeId,jobId:id,directionHash,planRevision:revision,status:'queued',animationStarted:false},settings:{...(old.settings||{}),...direction.settings}};
      const storedInput={...request,productionRun:true,serviceOwner:OWNER,directionHash,recipeId:direction.recipeId,castCharacterId:direction.characters.find(character=>/arjuna/i.test(character.name))?.id,sourceMethod:'builtin-editorial-recipe',estimatedSeconds:150,estimateBasis:'estimate excluding queue and model load; actual duration is measured'};
      db.exec('BEGIN IMMEDIATE');try{saveProject(project,document);db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.projectId,revision,'generation-keyframe','queued',0,'Direction saved; preparing one local casting image',JSON.stringify(storedInput),now(),now());db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
      const result={project:projectDoc(getProject(input.projectId)),job:jobDoc(getJob(id))};void run(id);return result;
    }finally{starting=false;}
  }
  async function state(projectId){const project=getProject(projectId);if(!project)fail('CINEMATIC_PROJECT_NOT_FOUND','Project not found.');const jobs=db.prepare("SELECT * FROM jobs WHERE project_id=? AND type='generation-keyframe' ORDER BY created_at DESC").all(projectId);return {project:projectDoc(project),job:jobDoc(jobs.find(isOwned)),plan:parse(project.document).productionPlan||null};}
  async function review(input){
    if(!input||Object.keys(input).some(key=>!['jobId','expectedOutputHash','verdict','notes'].includes(key))||!/^[a-f0-9]{64}$/.test(input.expectedOutputHash||'')||!['passed','rejected'].includes(input.verdict)||typeof input.notes!=='string'||!input.notes.trim()||input.notes.length>4000)fail('CINEMATIC_REVIEW_INPUT','Review needs the exact image hash, verdict and bounded inspection notes.');
    const job=getJob(input.jobId);if(!isOwned(job)||!job.output||!['review_required','succeeded','rejected'].includes(job.status))fail('CINEMATIC_REVIEW_JOB','Only a completed product-owned casting image can be reviewed.');if(job.status==='rejected'&&input.verdict==='passed')fail('CINEMATIC_REJECTED_REFERENCE','Rejected casting cannot be approved or reused. Produce a new candidate.');
    const stored=parse(job.output),project=getProject(job.project_id),document=parse(project?.document),current=stored.promoted&&document.cinematicProduction?.jobId===job.id&&project?.revision===stored.registeredRevision;
    if(input.verdict==='passed'&&!current)fail('CINEMATIC_PROJECT_CHANGED','The project direction changed after this image. Inspect a newly produced casting candidate.');
    const verified=await verifyOwned({jobsDir,mediaDir,db,sourceJobId:job.id,projectId:job.project_id,expectedHash:input.expectedOutputHash,requireReview:false,ffmpeg:path.join(root,'workers/tools/ffmpeg.exe'),ffprobe:path.join(root,'workers/tools/ffprobe.exe')});
    const decision={verdict:input.verdict,notes:input.notes.trim(),outputHash:input.expectedOutputHash,evidenceHash:verified.evidenceHash,mediaKind:'image',reviewer:'operator-visual-review',reviewedAt:now(),scope:'Casting, costume, setting, composition and visible defects in this still; no video realism or ethnicity classification'};
    const receipt={...verified.receipt,review:decision,status:input.verdict==='passed'?'reviewed':'rejected',provenance:{...verified.receipt.provenance,semanticQuality:input.verdict==='passed'?'operator-reviewed':'rejected'}},receiptPath=path.join(jobsDir,job.id,'result.json');
    db.exec('BEGIN IMMEDIATE');try{
      if(getJob(job.id)?.output!==job.output)fail('CINEMATIC_REVIEW_CHANGED','The casting review changed concurrently. Refresh before reviewing.');let revision=stored.registeredRevision;
      if(current){const approved=input.verdict==='passed';document.characters=(document.characters||[]).map(character=>character.id===parse(job.input).castCharacterId?{...character,referenceAssetId:approved?stored.assetId:null,faceReference:{status:approved?'approved':'rejected',assetId:approved?stored.assetId:null,outputHash:input.expectedOutputHash,sourceJobId:job.id,evidenceHash:verified.evidenceHash}}:character);document.cinematicProduction={...document.cinematicProduction,status:approved?'casting-approved':'casting-rejected',animationStarted:false};document.productionPlan={...document.productionPlan,castCandidate:{...document.productionPlan.castCandidate,referenceStatus:approved?'approved':'rejected',assetId:approved?stored.assetId:null,outputHash:input.expectedOutputHash}};revision=saveProject(project,document);}
      atomicJSON(receiptPath,receipt);atomicJSON(path.join(jobsDir,job.id,'visual-review.json'),decision);
      const output={...stored,...receipt,registeredRevision:revision,reviewRequired:false};db.prepare('UPDATE jobs SET status=?,stage=?,output=?,updated_at=? WHERE id=?').run(input.verdict==='passed'?'succeeded':'rejected',input.verdict==='passed'?'Casting image approved; animation has not started':'Casting rejected; new candidate required',JSON.stringify(output),now(),job.id);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');atomicJSON(receiptPath,verified.receipt);throw error;}
    return {project:projectDoc(getProject(job.project_id)),job:jobDoc(getJob(job.id)),review:decision};
  }
  async function cancel(id){const job=getJob(id);if(!isOwned(job))fail('CINEMATIC_JOB_NOT_FOUND','Product-owned casting job not found.');const control=running.get(id);if(!control)return jobDoc(job);if(!control.cancellation){control.controller.abort();stage(id,'cancelling','Stopping only this owned casting prompt',job.progress);control.cancellation=(async()=>{await cancelProvider(id);await control.worker?.cancel();await control.done;})();}await control.cancellation;return jobDoc(getJob(id));}
  async function close(){closing=true;await Promise.allSettled([...running.keys()].map(cancel));}
  return {start,state,review,cancel,close};
}
