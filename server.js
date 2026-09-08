import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { extname, join, normalize, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ReleaseStore, hashOutput } from './publishing/index.js';
import { createYouTubeService } from './publishing/youtube-service.mjs';
import { inspectCapabilities } from './capabilities/registry.mjs';
import { acquireGpuLease } from './runtime/inference-harness.mjs';
import { detectHardware } from './runtime/hardware-profile.mjs';
import { createProviderRegistry } from './runtime/providers/registry.mjs';
import { inspectModelRouter } from './runtime/model-router.mjs';
import { inspectGenerationProviders, preflightGeneration } from './runtime/generation-gate.mjs';
import { ensureManagedComfyUI, stopManagedComfyUI } from './runtime/managed-comfyui.mjs';
import { createComfyUIProvider } from './runtime/providers/comfyui.mjs';
import { streamLocalMedia } from './runtime/media-stream.mjs';
import { prepareTimedCaptions } from './runtime/timed-captions.mjs';
import { acquireEngineOwnership } from './runtime/engine-ownership.mjs';
import { SMOKE_PROMPT } from './runtime/neural-production.mjs';
import { inspectInterpolationRuntime, validateInterpolationSource, renderInputIdentity } from './runtime/frame-interpolation.mjs';
import { buildViralVariants } from './runtime/viral-variants.mjs';
import { FORMATS, FORMAT_IDS, PLATFORM_SPECS, countVariants, validateAllFormats } from './runtime/format-library.mjs';
import { validateAllPresets } from './runtime/format-presets.mjs';
import { initializeFlagshipCatalogue, selectFlagship, listFlagships, removeFlagship } from './runtime/flagship-catalogue.mjs';
import { applyGeneratedShot } from './runtime/apply-generated-shot.mjs';
import { validateNarrationCues } from './runtime/narration-cues.mjs';
import { verifyReviewTarget } from './runtime/verify-review-target.mjs';
import { prepareNextShotInput } from './runtime/next-shot-request.mjs';
import { projectStorePaths } from './runtime/project-store-paths.mjs';
import { readCatalogueSelection, setCatalogueSelection } from './runtime/catalogue-selection.mjs';
import { readConversation, sendConversation, saveCharacter, listStudioSessions, createStudioSession } from './runtime/studio-conversation.mjs';
import { prepareRecipeProject, createRecipeProject } from './runtime/recipe-project.mjs';
import { inspectCreatorWorkflows, saveCreatorWorkflowPlan } from './runtime/creator-workflow.mjs';
import { validateResearchPlan, runProjectResearch, commitProjectResearch } from './runtime/project-research.mjs';
import { createCinematicKeyframeService } from './runtime/cinematic-keyframe-service.mjs';
import { createRawFootageService } from './runtime/raw-footage-service.mjs';
import { buildCreatorPack } from './runtime/creator-pack.mjs';

// Desktop builds keep immutable application files separate from writable
// per-user data. Development defaults remain rooted at the current project.
const root=process.env.VYRELUM_ROOT||process.cwd();
const {dataDir,mediaDir,jobsDir,databasePath}=await projectStorePaths(process.env.VYRELUM_DATA_DIR||join(root,'data'));
const releaseEngineOwnership=await acquireEngineOwnership(dataDir);
const db=new DatabaseSync(databasePath);
initializeFlagshipCatalogue(db);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_revisions (project_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id, revision)); CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT, document TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT, revision INTEGER, type TEXT NOT NULL, status TEXT NOT NULL, progress REAL, stage TEXT, input TEXT, output TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
for(const project of db.prepare('SELECT id,revision,document,created_at FROM projects').all()) db.prepare('INSERT OR IGNORE INTO project_revisions VALUES (?,?,?,?)').run(project.id,project.revision,project.document,project.created_at);
const token=randomUUID(), children=new Map(), now=()=>new Date().toISOString(); let gpuLease=null;
const providerRegistry=createProviderRegistry();
const youtubeService=await createYouTubeService({dataDir,mediaDir,db});
const cinematicService=await createCinematicKeyframeService({db,dataDir,jobsDir,mediaDir,root});
const rawFootageService=await createRawFootageService({db,dataDir,jobsDir,mediaDir,root});
let creatorPackRunning=false;
db.prepare("UPDATE jobs SET status='failed',stage='Interrupted; prepare the creator pack again',error='CREATOR_PACK_INTERRUPTED' WHERE type='creator-pack' AND status IN ('queued','running')").run();
async function prepareCreatorPack(projectId,input){
 if(creatorPackRunning)throw Object.assign(Error('A creator pack is being prepared. Wait for it to finish.'),{code:'CREATOR_PACK_BUSY'});
 const row=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
 if(!row||input.expectedRevision!==row.revision||Object.keys(input).some(key=>key!=='expectedRevision'))throw Object.assign(Error('Open the current saved project revision first.'),{code:'CREATOR_PACK_REVISION'});
 const project=pdoc(row),sourceId=project.latestOutput?.videoAssetId,source=sourceId&&db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(sourceId,projectId);
 if(!source||['blocked','rejected'].includes(project.latestOutput?.status))throw Object.assign(Error('Render a playable edit first. Rejected outputs cannot become creator packs.'),{code:'CREATOR_PACK_SOURCE'});
 creatorPackRunning=true;const id=randomUUID(),time=now(),jobRoot=join(jobsDir,id);
 db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,projectId,row.revision,'creator-pack','running',0,'Preparing thumbnail and draft creator materials',JSON.stringify({sourceAssetId:sourceId,progressUnit:'percent'}),1,time,time);
 try{
  const pack=await buildCreatorPack({project,videoPath:source.path,outputDir:jobRoot,ffmpeg:process.env.VYRELUM_FFMPEG||join(root,'workers/tools',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),ffprobe:process.env.VYRELUM_FFPROBE||join(root,'workers/tools',process.platform==='win32'?'ffprobe.exe':'ffprobe')});
  const assetIds={},registered=[];
  for(const [key,name]of Object.entries(pack.outputs)){if(name!==basename(name))throw Error('Invalid creator pack output name');const file=join(jobRoot,name),info=await stat(file),assetId=randomUUID();assetIds[key]=assetId;registered.push({id:assetId,file,document:{name,mime:key==='thumbnail'?'image/png':key==='manifest'?'application/json':'text/markdown',size:info.size,kind:key==='thumbnail'?'image':'file',jobId:id,provenance:{generationStatus:'edited',sourceMethod:'local-creator-pack',sourceAssetId:sourceId,sourceHash:pack.source.sha256,status:'draft'}}});}
  const latest=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId),attached=latest.revision===row.revision,receipt={...pack,assets:assetIds,jobId:id,sourceAssetId:sourceId,projectRevision:row.revision,attached};
  db.exec('BEGIN IMMEDIATE');try{for(const asset of registered)db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(asset.id,projectId,JSON.stringify(asset.document),asset.file,now());
   if(attached){const next={...json(Buffer.from(latest.document)),creatorPack:receipt},revision=latest.revision+1;db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(revision,JSON.stringify(next),now(),projectId);db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(projectId,revision,JSON.stringify(next),now());}
   db.prepare("UPDATE jobs SET status='succeeded',progress=100,stage='Creator pack saved · copy is a draft, nothing published',output=?,updated_at=? WHERE id=?").run(JSON.stringify(receipt),now(),id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return{project:pdoc(db.prepare('SELECT * FROM projects WHERE id=?').get(projectId)),pack:receipt,job:jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id))};
 }catch(error){db.prepare("UPDATE jobs SET status='failed',stage='Creator pack needs attention',error=?,updated_at=? WHERE id=?").run(String(error.message).slice(0,1600),now(),id);throw error;}finally{creatorPackRunning=false;}
}
const formatCatalogue={schemaVersion:1,draftCreation:true,validatedFormats:validateAllFormats().length,variantCount:countVariants(),presets:validateAllPresets(),platforms:Object.entries(PLATFORM_SPECS).map(([id,spec])=>({id,label:spec.label,canvas:spec.canvas,safeArea:spec.safeArea,safeAreaConfidence:spec.safeAreaConfidence})),formats:FORMAT_IDS.map(id=>{const format=FORMATS[id];return{id,label:format.label,niche:format.niche,platforms:format.platforms,seconds:format.seconds,hook:format.hook,captions:format.captions,audio:format.audio,grade:format.grade,pacing:format.pacing,beatCount:format.beats.length};})};
const execFileAsync=promisify(execFile), cancelling=new Set();
const researchControllers=new Map();
function cancelResearchJob(id){
  const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  if(!row||row.type!=='research')return null;
  if(['queued','running','staging','validating','cancelling'].includes(row.status)){
    researchControllers.get(id)?.abort();
    db.prepare("UPDATE jobs SET status='cancelled',stage='Research cancelled; source snapshots retained',error=NULL,updated_at=? WHERE id=?").run(now(),id);
  }
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
}
async function runResearchJob(id,plan){
  const controller=new AbortController();researchControllers.set(id,controller);
  try{
    await runProjectResearch({plan,jobsDir,jobId:id,onlineAuthorized:true,signal:controller.signal,onProgress:event=>{
      const progress=Number.isFinite(event.progress)?Math.max(0,Math.min(95,event.progress)):0;
      db.prepare("UPDATE jobs SET stage=?,progress=?,updated_at=? WHERE id=? AND status='running'").run(String(event.stage||'Reading public sources').slice(0,180),progress,now(),id);
    }});
    if(controller.signal.aborted||db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status==='cancelled')return;
    await commitProjectResearch({db,jobsDir,jobId:id});
  }catch(error){
    if(controller.signal.aborted||db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status==='cancelled'){cancelResearchJob(id);return;}
    const code=typeof error.code==='string'&&error.code.startsWith('RESEARCH_')?error.code:'RESEARCH_FAILED';
    const status=['RESEARCH_NO_SOURCES','RESEARCH_REVISION_CONFLICT','RESEARCH_PRIVATE_ADDRESS'].includes(code)?'blocked':'failed';
    db.prepare("UPDATE jobs SET status=?,stage=?,error=?,updated_at=? WHERE id=? AND status='running'").run(status,status==='blocked'?'Research blocked; source evidence retained':'Research failed; no brief applied',`${code}: ${String(error.message||'Research failed').replace(/^RESEARCH_[A-Z_]+:\s*/, '').slice(0,1500)}`,now(),id);
  }finally{researchControllers.delete(id);}
}
async function terminateProcessTree(child){
  if(!child?.pid)return;
  if(process.platform==='win32'){try{await execFileAsync('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,timeout:10000});}catch{} return;}
  try{process.kill(-child.pid,'SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}
}
async function cancelOwnedProviderJob(id){
  const provider=createComfyUIProvider();
  for(const stage of ['motion','keyframe']){
    try{
      const events=(await readFile(join(jobsDir,id,stage,'provider.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
      const submitted=events.find(e=>e.event==='submitted');
      if(submitted?.promptId)await provider.cancel(submitted.promptId);
    }catch(error){if(error.code!=='ENOENT')console.error('Provider cancellation:',error.message);}
  }
}
async function stopEngine(){
  await rawFootageService.close();
  await cinematicService.close();
  await youtubeService.close();
  for(const id of researchControllers.keys())cancelResearchJob(id);
  for(const [id,child] of children){await cancelOwnedProviderJob(id);await terminateProcessTree(child);}
  await stopManagedComfyUI();await releaseEngineOwnership();process.exit(0);
}
process.once('SIGTERM',()=>void stopEngine());process.once('SIGINT',()=>void stopEngine());
process.on('message',message=>{if(message?.type==='shutdown')void stopEngine();});
// A control-plane restart cannot safely resume an in-flight worker. Preserve
// all prior artifacts and make the boundary visible for an explicit retry.
db.prepare("UPDATE jobs SET status='failed',stage='interrupted',error='Control plane restarted before worker completion',updated_at=? WHERE status IN ('running','staging','validating','cancelling')").run(now());
const releaseStore=new ReleaseStore({filePath:join(dataDir,'releases.json')});
const send=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(value));};
const readBody=async req=>{const c=[];for await(const x of req)c.push(x);return Buffer.concat(c)};const json=b=>{try{return JSON.parse(b.toString()||'{}')}catch{return {}}};
// Historical demo records may point at the old purple primitive scene. Keep
// those files for provenance, but prevent them from appearing as cinematic
// success in the current UI or automation receipts.
for (const row of db.prepare('SELECT id,document FROM projects').all()) {
  const d = json(Buffer.from(row.document));
  if (d.latestOutput?.jobId && !d.latestOutput.provenance) {
    const job = db.prepare('SELECT output FROM jobs WHERE id=?').get(d.latestOutput.jobId);
    if (job?.output) {
      try {
        const output = json(Buffer.from(job.output));
        const sourceMethod = String(output.sourceMethod || '');
        d.latestOutput.provenance = output.provenance || { generationStatus: sourceMethod.includes('bundled') ? 'fallback' : sourceMethod.includes('uploaded') || sourceMethod.includes('local-media') ? 'imported' : d.latestOutput.status === 'blocked' ? 'blocked' : 'unknown', sourceMethod: sourceMethod || null };
      } catch { /* retain the project when an old receipt is malformed */ }
    }
  }
  // A playable file without an in-job provenance receipt is not evidence of
  // VYREALM generation. Keep it available for history, but block it from
  // being presented as a trusted render until the project is rerun.
  const generationStatus = String(d.latestOutput?.provenance?.generationStatus || '');
  if (d.latestOutput && !['generated', 'imported', 'edited', 'upscaled', 'fallback', 'blocked'].includes(generationStatus)) {
    d.latestOutput = {
      ...d.latestOutput,
      status: 'blocked',
      provenance: { ...(d.latestOutput.provenance || {}), generationStatus: 'blocked', sourceMethod: d.latestOutput.provenance?.sourceMethod || 'unknown-legacy' },
      diagnostics: [{ code: 'MISSING_PROVENANCE', message: 'This output has no VYREALM in-job provenance receipt; rerun with a qualified local provider or an explicitly labelled source.' }]
    };
  }
  if (d.scene?.id === 'violet-product' && d.latestOutput && d.latestOutput.status !== 'blocked') {
    d.latestOutput = { ...d.latestOutput, status: 'blocked', diagnostics: [{ code: 'LEGACY_PRIMITIVE_OUTPUT', message: 'Legacy primitive render retained for history; rerun with an asset-first source.' }] };
  }
  if (JSON.stringify(d) !== row.document) db.prepare('UPDATE projects SET document=?,updated_at=? WHERE id=?').run(JSON.stringify(d), now(), row.id);
}
const pdoc=r=>({...json(Buffer.from(r.document)),id:r.id,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at});const adoc=r=>({...json(Buffer.from(r.document)),id:r.id,projectId:r.project_id,url:`/media/${r.id}`});const jdoc=r=>({...json(Buffer.from(r.input||'{}')),id:r.id,projectId:r.project_id,revision:r.revision,type:r.type,status:r.status,progress:r.progress,stage:r.stage,output:r.output?json(Buffer.from(r.output)):null,error:r.error,attempts:r.attempts,createdAt:r.created_at,updatedAt:r.updated_at});
function auth(req,res){const o=req.headers.origin;if(o&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))return send(res,403,{error:'Origin not allowed'}),false;const got=req.headers['x-vyrelum-token']||req.headers.cookie?.match(/vyrelum_token=([^;]+)/)?.[1];if(got!==token)return send(res,401,{error:'Session required'}),false;return true;}
async function runJob(id){
  if(db.prepare("SELECT 1 FROM jobs WHERE type='raw-footage-edit' AND status IN ('queued','running','validating','cancelling')").get()){setTimeout(()=>void runJob(id),500);return;}
  if(db.prepare('SELECT type FROM jobs WHERE id=?').get(id)?.type==='youtube-upload')return youtubeService.runJob(id);
  const r=db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if(!r||r.status!=='queued') return;
  const script=r.type==='scene'||r.type==='render'?join(root,'workers','render.mjs'):r.type==='direct'?join(root,'runtime','director.mjs'):r.type==='produce'?join(root,'workers','produce.mjs'):['generation-test','generation-shot'].includes(r.type)?join(root,'workers','neural.mjs'):r.type==='enhance'?join(root,'workers','enhance.mjs'):r.type==='interpolate'?join(root,'workers','interpolate.mjs'):r.type==='runtime-setup'?join(root,'workers','runtime-setup.mjs'):r.type==='sound-design'?join(root,'workers','sound-design.mjs'):r.type==='voiceover'||r.type==='transcribe'?join(root,'workers','audio.mjs'):null;
  if(!script||!existsSync(script)){db.prepare("UPDATE jobs SET status='blocked',stage='capability unavailable',error=?,updated_at=? WHERE id=?").run('No qualified worker is installed for this operation',now(),id);return;}
  if(gpuLease&&gpuLease!==id){setTimeout(()=>void runJob(id),500);return;} gpuLease=id;
  let releaseFileLease;
  try { releaseFileLease = await acquireGpuLease(id); } catch (error) {
    gpuLease = null;
    if (error.message === 'GPU_LEASE_BUSY') { setTimeout(() => void runJob(id), 500); return; }
    db.prepare("UPDATE jobs SET status='blocked',stage='gpu lease unavailable',error=?,updated_at=? WHERE id=?").run(error.message, now(), id);
    return;
  }
  const out=join(jobsDir,id); await mkdir(out,{recursive:true});
  const beforeStart=db.prepare('SELECT status FROM jobs WHERE id=?').get(id);
  if(!beforeStart||beforeStart.status!=='queued'){gpuLease=null;try{await releaseFileLease();}catch{}if(beforeStart?.status==='cancelling'){cancelling.delete(id);db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE id=?").run(now(),id);}return;}
  const raw=json(Buffer.from(r.input||'{}')); let inputData=raw;
  if(r.type==='interpolate')await stopManagedComfyUI();
  if(['generation-test','generation-shot'].includes(r.type)){
    db.prepare("UPDATE jobs SET stage='starting local video runtime',updated_at=? WHERE id=?").run(now(),id);
    try {
      const managed=await ensureManagedComfyUI();
      if(managed.status!=='ready') throw Object.assign(new Error(managed.message),{code:managed.code});
      const gate=await preflightGeneration({root});
      if(gate.status!=='ready') throw Object.assign(new Error(gate.message),{code:gate.code});
      inputData={brief:raw.brief||SMOKE_PROMPT,seed:Number.isSafeInteger(raw.seed)?raw.seed:7092026,frames:121,steps:20,reference:raw.reference,append:raw.append===true,projectId:r.project_id,revision:r.revision};
    } catch(error) {
      db.prepare("UPDATE jobs SET status='blocked',stage='local generation blocked',error=?,output=?,updated_at=? WHERE id=?").run(`${error.code||'LOCAL_RUNTIME_FAILED'}: ${error.message}`,JSON.stringify({status:'blocked',provenance:{generationStatus:'blocked'},diagnostics:[{code:error.code||'LOCAL_RUNTIME_FAILED',message:error.message}]}),now(),id);
      gpuLease=null;await releaseFileLease();return;
    }
  }
  if((r.type==='direct'||r.type==='produce')&&r.project_id){
    const pr=db.prepare('SELECT * FROM projects WHERE id=?').get(r.project_id);
    if(pr){
      const d=json(Buffer.from(pr.document));
      const productAsset=d.productAssetId&&db.prepare('SELECT path FROM assets WHERE id=?').get(d.productAssetId);
      const productMode=(raw.mode||d.mode)==='product';
      const timelineDuration=(d.timeline||[]).reduce((n,c)=>n+Number(c.duration||0),0);
      const projectShots=Array.isArray(d.timeline)?d.timeline.map((clip,index)=>{const asset=clip.assetId&&db.prepare('SELECT path FROM assets WHERE id=?').get(clip.assetId);return asset?{id:clip.id||`shot-${index+1}`,path:asset.path,asset:asset.path.split(/[\\/]/).pop(),caption:clip.caption||'',duration:Number(clip.duration||5),subject:clip.subject||'source subject',environment:clip.environment||'source environment',foreground:clip.foreground||'source foreground',background:clip.background||'source background',lighting:clip.lighting||'source lighting',camera:clip.camera||'editorial camera'}:null;}).filter(Boolean):[];
      inputData={...raw,mode:raw.mode||d.mode,sampleId:raw.sampleId||d.sampleId||null,shots:raw.shots||projectShots,productTemplate:raw.productTemplate||d.productTemplate,productCamera:raw.productCamera||d.productCamera,productAssetPath:raw.productAssetPath||productAsset?.path,brief:raw.brief||d.brief,projectId:r.project_id,revision:r.revision||pr.revision,durationSeconds:r.type==='produce'?(productMode?Math.max(3,Math.min(60,Number(d.durationSeconds)||15)):Math.max(15,Math.min(600,timelineDuration||15))):Math.max(4,Math.min(60,timelineDuration||12)),fps:d.settings?.fps||24,width:r.type==='produce'?(productMode?Number(d.settings?.width)||1080:Math.max(1920,d.settings?.width||1920)):d.settings?.width||640,height:r.type==='produce'?(productMode?Number(d.settings?.height)||1920:Math.max(1080,d.settings?.height||1080)):d.settings?.height||360};
    }
  }
  if((r.type==='scene'||r.type==='render')){const pr=r.project_id&&db.prepare('SELECT * FROM projects WHERE id=?').get(r.project_id);const d=pr?json(Buffer.from(pr.document)):{};
    if(r.type==='render'&&Array.isArray(d.timeline)&&d.timeline.length){const missing=d.timeline.filter(clip=>!clip.assetId||!db.prepare('SELECT 1 FROM assets WHERE id=?').get(clip.assetId)).map(clip=>clip.assetId||clip.id);if(missing.length){db.prepare("UPDATE jobs SET status='blocked',stage='timeline asset unavailable',error=?,updated_at=? WHERE id=?").run(`Missing timeline assets: ${missing.join(', ')}`,now(),id);gpuLease=null;try{await releaseFileLease?.();}catch{}return;}const clips=d.timeline.map(clip=>{const asset=db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId);const metadata=json(Buffer.from(asset.document)),sourceJob=metadata.jobId&&db.prepare('SELECT type,output FROM jobs WHERE id=?').get(metadata.jobId),receipt=sourceJob?.output?json(Buffer.from(sourceJob.output)):null;return {...clip,path:asset.path,provenance:receipt?.provenance||{generationStatus:'imported',sourceMethod:'user-media'},sourceJobType:sourceJob?.type||null,sourceReviewed:receipt?.review?.verdict==='passed',...(d.captionsEnabled===false?{caption:''}:{})};}); inputData={schemaVersion:1,kind:'timeline',projectId:r.project_id,revision:r.revision||pr?.revision||1,settings:d.settings||{fps:24,width:640,height:360},timeline:{clips,...(d.captionsEnabled!==false&&Array.isArray(d.transcript)&&d.transcript.length?{captions:d.transcript}: {})},soundtrack:d.soundtrack?.assetId&&db.prepare('SELECT * FROM assets WHERE id=?').get(d.soundtrack.assetId)?{...d.soundtrack,path:db.prepare('SELECT path FROM assets WHERE id=?').get(d.soundtrack.assetId).path}:undefined};}
    else if(d.mode==='abstract')inputData={schemaVersion:1,kind:'scene',projectId:r.project_id,revision:r.revision||pr?.revision||1,scene:d.scene&&d.scene.objects?.length?d.scene:json(await readFile(join(root,'workers','default-scene.json'))).scene};
    else {db.prepare("UPDATE jobs SET status='blocked',stage='source media required',error=?,updated_at=? WHERE id=?").run('BLOCKED_NEURAL_GENERATION: Generate a local shot or import media before rendering. Primitive scenes require an explicit abstract project.',now(),id);gpuLease=null;await releaseFileLease();return;}}
  if(inputData.kind==='timeline'){
    try{
      if(inputData.timeline.clips.some(clip=>['generation-test','generation-shot','enhance','interpolate'].includes(clip.sourceJobType)&&!clip.sourceReviewed))throw new Error('VISUAL_REVIEW_REQUIRED: Inspect and review every generated, enhanced or interpolated source shot before assembling this edit');
      const d=json(Buffer.from(db.prepare('SELECT document FROM projects WHERE id=?').get(r.project_id).document));
      if(!Array.isArray(d.audioTracks||[])||(d.audioTracks||[]).length>16)throw new Error('Use at most 16 local audio layers');
      inputData.audioTracks=(d.audioTracks||[]).map(track=>{const asset=db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(track.assetId,r.project_id);if(!asset||! /^(audio|video)\//.test(json(Buffer.from(asset.document)).mime||''))throw new Error('Audio layer is not a project audio/video asset');return{...track,path:asset.path};});
    }catch(error){db.prepare("UPDATE jobs SET status='blocked',stage='audio layer unavailable',error=?,updated_at=? WHERE id=?").run(error.message,now(),id);gpuLease=null;await releaseFileLease();return;}
  }
  const input=join(out,'request.json'); await writeFile(input,JSON.stringify(inputData,null,2));
  if(db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status!=='queued'){gpuLease=null;await releaseFileLease();return;}
  db.prepare("UPDATE jobs SET status='running',stage='worker started',attempts=attempts+1,updated_at=? WHERE id=?").run(now(),id);
  if(db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status==='cancelling'){gpuLease=null;await releaseFileLease();db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE id=?").run(now(),id);return;}
  const child=spawn(process.execPath,[script,'--input',input,'--output',out],{cwd:root,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']}); let workerStderr=''; child.stderr?.on('data',x=>{workerStderr=(workerStderr+x.toString()).slice(-6000)}); children.set(id,child);
  let stdoutBuffer='';
  child.stdout.on('data',chunk=>{stdoutBuffer+=chunk.toString();let lineEnd;while((lineEnd=stdoutBuffer.indexOf('\n'))>=0){const line=stdoutBuffer.slice(0,lineEnd);stdoutBuffer=stdoutBuffer.slice(lineEnd+1);try{const event=JSON.parse(line);if(event.progressEvent){const elapsed=Number.isFinite(event.elapsedSeconds)?` (${event.elapsedSeconds}s)`:'';db.prepare("UPDATE jobs SET stage=?,progress=COALESCE(?,progress),updated_at=? WHERE id=? AND status='running'").run(String(event.stage||'running').slice(0,180)+elapsed,Number.isFinite(event.progress)?event.progress:null,now(),id);}}catch{}}if(stdoutBuffer.length>100000)stdoutBuffer=stdoutBuffer.slice(-100000);});
  const registration=releaseFileLease.registerChild(child.pid);
  child.on('exit',async code=>{
    try{await registration;}catch{} children.delete(id); gpuLease=null; try{await releaseFileLease?.();}catch{} const result=join(out,'result.json');
    const wasCancelled=cancelling.has(id); cancelling.delete(id);
    if(wasCancelled){db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',error=NULL,updated_at=? WHERE id=?").run(now(),id);return;}
    if(code===0&&existsSync(result)){
      const val=json(await readFile(result));
      if(val?.validated!==false&&val?.status!=='blocked'){
        const created={};
        const currentJob=db.prepare('SELECT status,revision,project_id FROM jobs WHERE id=?').get(id);
        const currentProject=currentJob?.project_id?db.prepare('SELECT revision FROM projects WHERE id=?').get(currentJob.project_id):null;
        const canPromote=Boolean(currentJob&&currentJob.status!=='cancelled'&&currentJob.status!=='cancelling'&&(!currentProject||Number(currentProject.revision)===Number(r.revision||currentProject.revision)));
        for(const [kind,rel] of Object.entries(val.outputs||{})){
          if(!['video','sourceVideo','poster','blend','glb','captions','quality','audio'].includes(kind)||typeof rel!=='string'||rel!==basename(rel)) continue;
          const src=join(out,rel); if(!existsSync(src)) continue;
          const aid=randomUUID(),dest=join(mediaDir,aid+'-'+basename(rel)),bytes=await readFile(src); await writeFile(dest,bytes);
          const mime=kind==='video'||kind==='sourceVideo'?'video/mp4':kind==='poster'?'image/png':kind==='audio'?'audio/wav':kind==='blend'?'application/x-blend':kind==='captions'?'text/plain':kind==='quality'?'application/json':'model/gltf-binary';
          db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(aid,canPromote?r.project_id:null,JSON.stringify({name:basename(rel),mime,size:bytes.length,kind,jobId:id,projectRevisionMatch:canPromote}),dest,now()); created[kind]=aid;
        }
        if(r.project_id&&canPromote){
          const pr=db.prepare('SELECT * FROM projects WHERE id=?').get(r.project_id);
          if(pr){
            const d=json(Buffer.from(pr.document));
            if((r.type==='direct'||r.type==='produce') && Array.isArray(val.scenes)){
              const shots=val.scenes.flatMap(scene=>(scene.shots||[]).map(shot=>({...shot,sceneId:shot.sceneId||scene.id})));
              d.title=val.title||d.title; d.treatment=val.treatment||d.treatment; d.script=val.treatment||d.script;
              d.scenes=val.scenes; d.shots=shots; d.operations=val.operations||[]; d.directorEvidence=val.modelEvidence||null;
              if(shots.length) d.timeline=shots.map(shot=>({id:shot.id,kind:'shot',duration:Number(shot.durationFrames||0)/(Number(val.fps)||24),trimStart:Number(shot.startFrame||0)/(Number(val.fps)||24),caption:shot.caption||'',prompt:shot.prompt||'',route:shot.route||'scene3d',sceneId:shot.sceneId||null}));
            }
            if((r.type==='produce'||r.type==='direct')&&Array.isArray(val.timeline)&&val.timeline.length){
              d.timeline=val.timeline;
              // A produced film is immediately editable: point each planned shot at
              // the promoted source render so a later "Render edit" can trim,
              // caption and remix it through the same canonical timeline worker.
              if(r.type==='produce'&&created.sourceVideo) d.timeline=d.timeline.map(shot=>({...shot,kind:'video',assetId:created.sourceVideo}));
            }
            if((r.type==='direct'||r.type==='produce')&&val.scene) d.scene=val.scene;
            if(r.type==='scene'&&val.scene) d.scene=val.scene;
            if(['generation-test','generation-shot'].includes(r.type)&&created.sourceVideo){d.timeline=[...(raw.append?(d.timeline||[]):[]),{id:randomUUID(),kind:'video',assetId:created.sourceVideo,duration:val.durationSeconds,trimStart:0,caption:'',provenance:val.provenance}];d.settings=raw.append?d.settings:{...d.settings,width:1920,height:1080,fps:24};d.mode='cinematic';d.sampleId=null;}
            if(r.type==='enhance'&&created.video){d.timeline=(d.timeline||[]).map(clip=>clip.assetId===raw.sourceAssetId?{...clip,kind:'video',assetId:created.video,sourceAssetId:raw.sourceAssetId,provenance:val.provenance}:clip);d.settings={...d.settings,width:3840,height:2160,fps:24};}
            const editedProvenance={generationStatus:'edited',sourceMethod:'local-timeline-edit',sources:(d.timeline||[]).map(c=>({assetId:c.assetId,provenance:c.provenance||null}))};
            if(r.type==='voiceover'&&created.audio){d.soundtrack={assetId:created.audio,gain:1,muted:false};d.latestAudio={assetId:created.audio,jobId:id,status:val.status,provenance:val.provenance};}
            else if(r.type==='sound-design'&&created.audio){d.audioTracks=[...(d.audioTracks||[]),{id:randomUUID(),assetId:created.audio,name:val.evidence?.preset==='epic-dawn-v1'?'Epic dawn · original sound':'Rain & tension',start:0,gain:0.7,muted:false,provenance:val.provenance}];d.latestSoundDesign={assetId:created.audio,jobId:id,evidence:val.evidence,provenance:val.provenance};}
            else if(r.type==='transcribe'){d.transcript=val.segments;d.transcriptSource={assetId:raw.assetId,jobId:id,provenance:val.provenance};d.captionsEnabled=true;}
            else if(created.video)d.latestOutput={videoAssetId:created.video||null,posterAssetId:created.poster||null,qualityAssetId:created.quality||null,status:val.status||'verified',jobId:id,provenance:val.provenance||(inputData.kind==='timeline'?editedProvenance:{generationStatus:'fallback',sourceMethod:'explicit-scene-composition'}),verification:val.verification||null};
            const nextRevision=pr.revision+1,updated=now(),nextDocument=JSON.stringify(d);
            db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(nextRevision,nextDocument,updated,r.project_id);db.prepare('INSERT OR REPLACE INTO project_revisions VALUES (?,?,?,?)').run(r.project_id,nextRevision,nextDocument,updated);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
          }
        }
        const output={...val,assets:created,promoted:canPromote,diagnostics:canPromote?(val.status==='review_required'?['VISUAL_REVIEW_REQUIRED']:[]):['STALE_PROJECT_REVISION_OUTPUT_RETAINED']}; const terminalStatus=val.status==='review_required'?'review_required':'succeeded'; db.prepare("UPDATE jobs SET status=?,progress=1,stage=?,output=?,updated_at=? WHERE id=?").run(terminalStatus,terminalStatus==='review_required'?(['voiceover','transcribe','sound-design'].includes(r.type)?'local audio complete; review pronunciation and timing':'technical render complete; visual review required'):(canPromote?'validated':'validated; output retained without promotion'),JSON.stringify(output),now(),id); return;
      }
    }
    if(existsSync(result)){const val=json(await readFile(result));if(val?.status==='blocked'){
      const diagnostic=(val.diagnostics||val.modelEvidence?.routeDiagnostics||[]).map(x=>typeof x==='string'?x:(x.code||x.reason||x.message)).filter(Boolean).join('; ')||'Requested capability is not qualified';
      if(r.project_id&&!['voiceover','transcribe','sound-design','interpolate'].includes(r.type)){const pr=db.prepare('SELECT * FROM projects WHERE id=?').get(r.project_id);if(pr){const d=json(Buffer.from(pr.document));d.latestOutput={...d.latestOutput,status:'blocked',jobId:id,provenance:val.provenance||{generationStatus:'blocked'},diagnostics:val.diagnostics||[diagnostic]};const updated=now(),nextRevision=pr.revision+1,nextDocument=JSON.stringify(d);db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(nextRevision,nextDocument,updated,r.project_id);db.prepare('INSERT OR REPLACE INTO project_revisions VALUES (?,?,?,?)').run(r.project_id,nextRevision,nextDocument,updated);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}}}}
      db.prepare("UPDATE jobs SET status='blocked',stage='capability unavailable',error=?,output=?,updated_at=? WHERE id=?").run(diagnostic,JSON.stringify(val),now(),id);return;}}
    db.prepare("UPDATE jobs SET status='failed',stage='worker failed',error=?,updated_at=? WHERE id=?").run(`Worker exited ${code}${workerStderr?`: ${workerStderr.trim().slice(-1500)}`:''}`,now(),id);
  });
}async function api(req,res,path){
 if(path==='/api/session'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json','set-cookie':`vyrelum_token=${token}; HttpOnly; SameSite=Strict`});return res.end(JSON.stringify({token,mode:'local'}));}if(!auth(req,res))return;
 if(path.startsWith('/api/youtube/')){
   let body={};
   if(req.method==='POST'){
     const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)return send(res,413,{code:'YOUTUBE_REQUEST_TOO_LARGE',error:'YouTube request exceeds 64 KiB'});chunks.push(chunk);}
     try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{return send(res,400,{code:'YOUTUBE_INVALID_REQUEST',error:'A valid JSON request is required'});}
   }
   const result=await youtubeService.handle({pathname:path,method:req.method,body,searchParams:new URL(req.url,'http://localhost').searchParams});
   if(path==='/api/youtube/upload'&&result.status===202)void runJob(result.body.id);
   return send(res,result.status,result.body);
 }
 const youtubeJobControl=path.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)\/(cancel|retry)$/);
 if(youtubeJobControl&&req.method==='POST'&&db.prepare('SELECT type FROM jobs WHERE id=?').get(youtubeJobControl[1])?.type==='creator-pack')return send(res,409,{code:'CREATOR_PACK_CONTROL',error:'Thumbnail extraction is a short local operation. To retry, prepare a new creator pack from the saved project; generic render controls do not apply.'});
 if(youtubeJobControl&&req.method==='POST'&&db.prepare('SELECT type FROM jobs WHERE id=?').get(youtubeJobControl[1])?.type==='youtube-upload'){
   try{return send(res,200,await youtubeService[youtubeJobControl[2]](youtubeJobControl[1]));}catch(error){return send(res,409,{code:error.code||'YOUTUBE_JOB_CONTROL_FAILED',error:error.message});}
 }
 if(path==='/api/state'&&req.method==='GET'){const [capabilityState,hardware,flagships]=await Promise.all([inspectCapabilities({root}),detectHardware(),listFlagships({db})]);return send(res,200,{projects:db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(pdoc),assets:db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all().map(adoc),jobs:db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all().map(jdoc),flagships,catalogueSelection:readCatalogueSelection(db),features:{independentKeyframes:true,reviewHashBinding:true},capabilities:capabilityState.capabilities,hardware,formatCatalogue,capabilityCatalogue:{schemaVersion:capabilityState.schemaVersion,attribution:capabilityState.attribution,screenedReferences:capabilityState.screenedReferences}});}
 const conversationPath=path.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/conversation$/);
 const creatorPackPath=path.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/creator-pack$/);
 if(creatorPackPath&&req.method==='POST'){try{return send(res,201,await prepareCreatorPack(creatorPackPath[1],json(await readBody(req))));}catch(error){return send(res,409,{error:error.message,code:error.code||'CREATOR_PACK_FAILED'});}}

 const productionPath=path.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/production-run$/);
 if(productionPath&&['GET','POST'].includes(req.method)){
   try{
     if(req.method==='GET'){const raw=await rawFootageService.state(productionPath[1]);return send(res,200,raw.job?raw:await cinematicService.state(productionPath[1]));}
     const input=json(await readBody(req));
     if(Object.keys(input).some(key=>!['expectedRevision','brief','sessionId','sourceMode'].includes(key))||input.sessionId!==undefined&&(typeof input.sessionId!=='string'||!input.sessionId))return send(res,400,{error:'Provide a brief and saved project revision.'});
     if(!listStudioSessions(db,productionPath[1]).some(session=>session.id===(input.sessionId||'main')))return send(res,404,{error:'Conversation not found in this project.'});
     if(typeof input.brief!=='string'||!input.brief.trim()||input.brief.length>6000)return send(res,400,{error:'Describe the intended edit in 1–6000 characters.'});
     if(input.sourceMode!==undefined&&!['uploaded-media','local-generation'].includes(input.sourceMode))return send(res,400,{error:'Choose uploaded-media or explicit local-generation.'});
     const localGeneration=input.sourceMode==='local-generation',durationMatch=input.brief.match(/\b(\d+(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s)\b/i);
     const result=localGeneration?await cinematicService.start({projectId:productionPath[1],expectedRevision:input.expectedRevision,brief:input.brief}):await rawFootageService.start({projectId:productionPath[1],expectedRevision:input.expectedRevision,brief:input.brief,durationSeconds:durationMatch?Number(durationMatch[1]):20,aspect:/\b(landscape|horizontal|16:9)\b/i.test(input.brief)?'16:9':'9:16',captionsEnabled:! /\b(?:no|without)\s+(?:speech\s+)?(?:captions?|subtitles?)\b/i.test(input.brief)});
     try{result.turn=await sendConversation({db,projectId:productionPath[1],input:{id:result.job.id,sessionId:input.sessionId||'main',expectedRevision:result.project.revision,text:input.brief,useLocalModel:false},reply:async()=>({source:'local-production',text:localGeneration?'Your trailer direction is saved. VYREALM is preparing one original local casting image. Check the character and costume before animation. The six-shot film is not rendered yet.':'Your edit is queued from the saved source ranges and framing. Unsupported instructions are disclosed in its report. The video, original-audio status and review controls will appear here.',actions:['characters','storyboard','jobs'],productionJobId:result.job.id})});}catch(error){result.conversationDiagnostic=error.code||'CHAT_SAVE_FAILED';}
     return send(res,202,result);
   }catch(error){return send(res,error.status||(/CONFLICT|BUSY|REVIEW/.test(error.code||'')?409:400),{error:error.message,code:error.code||'PRODUCTION_START_FAILED'});}
 }
 const productionAction=path.match(/^\/api\/production-runs\/([a-zA-Z0-9-]+)\/(review|cancel)$/);
 if(productionAction&&req.method==='POST'){
   try{const input=json(await readBody(req));return send(res,200,productionAction[2]==='review'?await (db.prepare('SELECT type FROM jobs WHERE id=?').get(productionAction[1])?.type==='raw-footage-edit'?rawFootageService:cinematicService).review({...input,jobId:productionAction[1]}):await (db.prepare('SELECT type FROM jobs WHERE id=?').get(productionAction[1])?.type==='raw-footage-edit'?rawFootageService:cinematicService).cancel(productionAction[1]));}
   catch(error){return send(res,error.status||409,{error:error.message,code:error.code||'PRODUCTION_ACTION_FAILED'});}
 }
 const sessionsPath=path.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/conversations$/);
 if(sessionsPath&&['GET','POST'].includes(req.method)){
   try{return send(res,req.method==='GET'?200:201,req.method==='GET'?{sessions:listStudioSessions(db,sessionsPath[1])}:createStudioSession(db,sessionsPath[1],json(await readBody(req)).title));}
   catch(error){return send(res,error.status||500,{error:error.message,code:error.code||'CHAT_SESSION_FAILED'});}
 }
 if(conversationPath&&['GET','POST'].includes(req.method)){
   try{return send(res,200,req.method==='GET'?{turns:readConversation(db,conversationPath[1],new URL(req.url,'http://localhost').searchParams.get('sessionId')||'main')}:await sendConversation({db,projectId:conversationPath[1],input:json(await readBody(req))}));}
   catch(error){return send(res,error.status||500,{error:error.message,code:error.code||'CHAT_FAILED'});}
 }
 if(path==='/api/creator/workflows'&&req.method==='GET')return send(res,200,await inspectCreatorWorkflows({root,runtimeDirectory:process.env.VYRELUM_RUNTIME_DIR||join(dataDir,'runtime')}));
 if(path==='/api/creator/workflows/plan'&&req.method==='POST'){
   try{const input=json(await readBody(req)),catalogue=await inspectCreatorWorkflows({root,runtimeDirectory:process.env.VYRELUM_RUNTIME_DIR||join(dataDir,'runtime')});return send(res,201,saveCreatorWorkflowPlan({db,input,capabilities:catalogue.capabilities}));}
   catch(error){const status=error.code==='CREATOR_PROJECT_NOT_FOUND'?404:error.code==='CREATOR_REVISION_CONFLICT'?409:error.code==='CREATOR_INPUT_INVALID'||error.code==='CREATOR_ASSET_INVALID'?400:500;return send(res,status,{error:error.message,code:error.code||'CREATOR_PLAN_SAVE_FAILED'});}
 }
 const researchPath=path.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/research$/);
 if(researchPath&&req.method==='POST'){
   try{
     const chunks=[];let size=0;
     for await(const chunk of req){size+=chunk.length;if(size>8192)return send(res,413,{error:'Research request exceeds 8 KiB',code:'RESEARCH_REQUEST_SIZE'});chunks.push(chunk);}
     let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,{error:'A JSON research request is required',code:'RESEARCH_PLAN'});}
     if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['expectedRevision','query','sourceUrls','onlineAuthorized'].includes(key)))return send(res,400,{error:'Use expectedRevision, query, optional sourceUrls and onlineAuthorized:true',code:'RESEARCH_PLAN'});
     if(input.onlineAuthorized!==true)return send(res,400,{error:'Research requires an explicit online action',code:'RESEARCH_ONLINE_AUTHORIZATION'});
     const {onlineAuthorized,...fields}=input,plan=validateResearchPlan({projectId:researchPath[1],...fields});
     if(researchControllers.size)return send(res,409,{error:'One public-source research job is already running. Wait or cancel it before starting another.',code:'RESEARCH_BUSY'});
     db.exec('BEGIN IMMEDIATE');let id;
     try{
       const project=db.prepare('SELECT * FROM projects WHERE id=?').get(plan.projectId);
       if(!project){db.exec('ROLLBACK');return send(res,404,{error:'Project not found',code:'RESEARCH_PROJECT_MISSING'});}
       if(project.revision!==plan.expectedRevision){db.exec('ROLLBACK');return send(res,409,{error:'Project changed; refresh before researching',code:'RESEARCH_REVISION_CONFLICT',project:pdoc(project)});}
       if(db.prepare("SELECT id FROM jobs WHERE type='research' AND status IN ('queued','running','cancelling')").get()){db.exec('ROLLBACK');return send(res,409,{error:'A research job is already active',code:'RESEARCH_BUSY'});}
       id=randomUUID();const t=now();
       db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,plan.projectId,plan.expectedRevision,'research','running',0,'Research accepted; fetching public sources',JSON.stringify(plan),1,t,t);
       db.exec('COMMIT');
     }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
     void runResearchJob(id,plan);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
   }catch(error){return send(res,error.code?.startsWith('RESEARCH_')?400:500,{error:error.message,code:error.code||'RESEARCH_FAILED'});}
 }
 const researchCancelPath=path.match(/^\/api\/research\/([a-zA-Z0-9-]+)\/cancel$/);
 if(researchCancelPath&&req.method==='POST'){
   const job=cancelResearchJob(researchCancelPath[1]);return job?send(res,200,jdoc(job)):send(res,404,{error:'Research job not found',code:'RESEARCH_JOB_MISSING'});
 }

 const productionControl=path.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)\/(cancel|retry)$/);
 if(productionControl&&req.method==='POST'){
   const controlled=db.prepare('SELECT type,input FROM jobs WHERE id=?').get(productionControl[1]);
   if(controlled&&json(Buffer.from(controlled.input||'{}')).productionRun){
     if(productionControl[2]==='retry')return send(res,409,{code:'PRODUCTION_NEW_DIRECTION_REQUIRED',error:'Send the corrected brief through Produce video. Prior outputs are retained.'});
     const service=controlled.type==='raw-footage-edit'?rawFootageService:cinematicService;return send(res,200,await service.cancel(productionControl[1]));
   }
 }
 const researchGenericControl=path.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)\/(cancel|retry)$/);
 if(researchGenericControl&&req.method==='POST'&&db.prepare('SELECT type FROM jobs WHERE id=?').get(researchGenericControl[1])?.type==='research'){
   if(researchGenericControl[2]==='cancel')return send(res,200,jdoc(cancelResearchJob(researchGenericControl[1])));
   return send(res,409,{error:'Research receipts are immutable. Submit a new explicit research action against the current project revision; generic Retry cannot rerun research.',code:'RESEARCH_RESUBMIT_REQUIRED'});
 }
 const characterPath=path.match(/^\/api\/projects\/([a-zA-Z0-9-]+)\/characters$/);
 if(characterPath&&req.method==='POST'){
   try{return send(res,200,saveCharacter({db,projectId:characterPath[1],input:json(await readBody(req))}));}
   catch(error){return send(res,error.status||500,{error:error.message,code:error.code||'CHARACTER_SAVE_FAILED'});}
 }
 if(path==='/api/catalog/flagships'&&req.method==='GET')return send(res,200,{entries:await listFlagships({db})});
 if(path==='/api/catalog/selection'&&req.method==='GET')return send(res,200,readCatalogueSelection(db));
 if(path==='/api/catalog/selection'&&req.method==='PUT'){
   try{return send(res,200,setCatalogueSelection(db,json(await readBody(req))));}
   catch(error){return send(res,400,{error:error.message,code:error.code||'CATALOGUE_SELECTION_INVALID'});}
 }
 if(path==='/api/catalog/flagships'&&req.method==='POST'){
   const x=json(await readBody(req));
   if(typeof x.projectId!=='string'||!Number.isSafeInteger(x.expectedRevision)||Object.keys(x).some(key=>!['projectId','expectedRevision','title','description'].includes(key)))return send(res,400,{error:'Select a saved project revision; caller output paths and review evidence are not accepted'});
   try{return send(res,201,await selectFlagship({db,jobsDir,mediaDir,ffmpeg:process.env.VYRELUM_FFMPEG||join(root,'workers','tools',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),ffprobe:process.env.VYRELUM_FFPROBE||join(root,'workers','tools',process.platform==='win32'?'ffprobe.exe':'ffprobe'),...x}));}
   catch(error){if(error.code?.startsWith('FLAGSHIP_'))return send(res,409,{error:error.message,code:error.code});throw error;}
 }
 const flagshipPath=path.match(/^\/api\/catalog\/flagships\/([a-zA-Z0-9-]+)$/);if(flagshipPath&&req.method==='DELETE')return send(res,200,removeFlagship({db,id:flagshipPath[1]}));
 if(path==='/api/hardware'&&req.method==='GET') return send(res,200,await detectHardware());
 if(path==='/api/runtime/status'&&req.method==='GET'){
   const runtimeDir=process.env.VYRELUM_RUNTIME_DIR||join(dataDir,'runtime');let config=null,enhancement=null;
   try{config=json(await readFile(join(runtimeDir,'comfyui.json')));}catch{}
   try{enhancement=json(await readFile(join(runtimeDir,'enhancement.json')));}catch{}
   const interpolation=await inspectInterpolationRuntime({runtimeDir});
   return send(res,200,{dataDirectory:dataDir,runtimeDirectory:config?.root||null,registered:Boolean(config?.enabled),enhancementRegistered:Boolean(enhancement),interpolation:{status:interpolation.status,code:interpolation.code,message:interpolation.message,device:interpolation.device},generation:await preflightGeneration({root}),setupCommand:'npm run setup:neural',offline:true});
 }
 if(path==='/api/runtime/start'&&req.method==='POST')return send(res,200,await ensureManagedComfyUI());
 if(path==='/api/providers'&&req.method==='GET') { const providers=await providerRegistry.inspect(); return send(res,200,{providers, models:await inspectModelRouter({ providers }), generationGate:await inspectGenerationProviders({root})}); }
 if(path==='/api/generation/preflight'&&req.method==='GET') return send(res,200,await preflightGeneration({root}));
 if(['/api/audio/voiceover','/api/audio/transcribe'].includes(path)&&req.method==='POST'){
   const x=json(await readBody(req)),project=x.projectId&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);
   if(!project)return send(res,404,{error:'Project not found'});
   if(x.expectedRevision!==project.revision)return send(res,409,{error:'Project changed; save or refresh before starting audio'});
   const operation=path.endsWith('voiceover')?'voiceover':'transcribe',input={operation,projectId:project.id,revision:project.revision};
   if(operation==='voiceover'){if(typeof x.text!=='string'||!x.text.trim()||x.text.length>5000)return send(res,400,{error:'Narration requires 1–5000 characters'});input.text=x.text.trim();}
   if(operation==='voiceover'&&x.cues!=null){try{input.cues=validateNarrationCues({cues:x.cues,durationSeconds:x.durationSeconds,text:input.text});input.durationSeconds=x.durationSeconds;}catch(error){return send(res,400,{error:error.message});}}
   if(operation==='transcribe'){const asset=typeof x.assetId==='string'&&db.prepare('SELECT * FROM assets WHERE id=?').get(x.assetId);if(!asset||asset.project_id!==project.id||!/^audio\/|^video\//.test(json(Buffer.from(asset.document)).mime||''))return send(res,400,{error:'Select an audio or video asset from this project'});input.assetId=asset.id;input.inputPath=asset.path;}
   const config=join(process.env.VYRELUM_RUNTIME_DIR||join(dataDir,'runtime'),'audio.json');
   if(!existsSync(config))return send(res,409,{error:'Local Piper/Whisper models are not installed. Import recorded narration or install the offline audio runtime.',code:'LOCAL_AUDIO_UNAVAILABLE'});
   const id=randomUUID(),t=now();db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,project.id,project.revision,operation,'queued',0,'queued for local audio',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
 }
 if(path==='/api/generation/review'&&req.method==='POST'){
   const x=json(await readBody(req)),job=typeof x.jobId==='string'&&db.prepare('SELECT * FROM jobs WHERE id=?').get(x.jobId);
   if(!job||!job.output)return send(res,404,{error:'Rendered job not found'});
   if(!['review_required','rejected','succeeded'].includes(job.status)||!['passed','rejected'].includes(x.verdict)||typeof x.notes!=='string'||!x.notes.trim()||x.notes.length>4000)return send(res,400,{error:'A completed render, review verdict and inspection notes are required'});
   let output=json(Buffer.from(job.output));if(!output.outputs?.video||!output.provenance?.outputHash)return send(res,409,{error:'This job has no hashed video to review'});
   let checked;
   try{checked=await verifyReviewTarget({db,jobsDir,mediaDir,job,output,expectedOutputHash:x.expectedOutputHash,ffmpeg:join(root,'workers/tools/ffmpeg.exe'),ffprobe:join(root,'workers/tools/ffprobe.exe')});output=checked.output;}
   catch(error){return send(res,409,{error:error.message,code:error.code||'REVIEW_TARGET_FAILED'});}
   const review={verdict:x.verdict,notes:x.notes,reviewer:'operator-visual-review',reviewedAt:now(),outputHash:output.provenance.outputHash,scope:'visual inspection; no automated realism score'};
   output.review=review;output.provenance.semanticQuality=x.verdict==='passed'?'operator-reviewed':'rejected';output.status=x.verdict==='passed'?'reviewed':'rejected';
   await writeFile(join(jobsDir,job.id,'visual-review.json'),JSON.stringify(review,null,2));
   const receiptPath=join(jobsDir,job.id,'result.json'),receipt=checked.receipt;receipt.review=review;receipt.provenance=output.provenance;await writeFile(receiptPath,JSON.stringify(receipt,null,2));
   const pr=job.project_id&&db.prepare('SELECT * FROM projects WHERE id=?').get(job.project_id),d=pr?json(Buffer.from(pr.document)):null,t=now();
   db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE jobs SET status=?,stage=?,output=?,updated_at=? WHERE id=?').run(x.verdict==='passed'?'succeeded':'rejected',x.verdict==='passed'?'operator review recorded':'visual review rejected',JSON.stringify(output),t,job.id);if(d?.latestOutput?.jobId===job.id){d.latestOutput={...d.latestOutput,status:output.status,provenance:output.provenance,review};const next=pr.revision+1,document=JSON.stringify(d);db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(next,document,t,pr.id);db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(pr.id,next,document,t);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   return send(res,200,{review,jobId:job.id});
 }
 if(path==='/api/audio/sound-design'&&req.method==='POST'){
   const x=json(await readBody(req)),project=typeof x.projectId==='string'&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);
   if(!project)return send(res,404,{error:'Project not found'});
   if(x.expectedRevision!==project.revision)return send(res,409,{error:'Project changed; refresh before creating sound design'});
   const document=json(Buffer.from(project.document)),durationSeconds=(document.timeline||[]).reduce((n,c)=>n+Number(c.duration||0),0);
   if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>90||(document.audioTracks||[]).length>=16)return send(res,400,{error:'Use a 1–90 second edit with fewer than 16 audio layers'});
   const footsteps=x.footsteps||[];
   if(x.preset!=null&&!['rain-tension-v1','epic-dawn-v1'].includes(x.preset))return send(res,400,{error:'Choose rain-tension-v1 or epic-dawn-v1'});
   if(x.cues!=null&&(!Array.isArray(x.cues)||x.cues.length>128)||x.quietWindows!=null&&(!Array.isArray(x.quietWindows)||x.quietWindows.length>16))return send(res,400,{error:'Sound cue limits exceeded'});
   if(!Array.isArray(footsteps)||footsteps.length>120||footsteps.some(t=>!Number.isFinite(t)||t<0||t>=durationSeconds)||[x.shelterAt,x.climaxAt].some(t=>t!=null&&(!Number.isFinite(t)||t<0||t>=durationSeconds)))return send(res,400,{error:'Sound events must fall inside the timeline'});
   const id=randomUUID(),t=now(),input={projectId:project.id,revision:project.revision,durationSeconds,seed:Number.isSafeInteger(x.seed)?x.seed:713,footsteps,shelterAt:x.shelterAt,climaxAt:x.climaxAt,preset:x.preset,cues:x.cues,quietWindows:x.quietWindows};
   db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,project.id,project.revision,'sound-design','queued',0,'queued for original sound synthesis',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
 }
 if(path==='/api/runtime/setup'&&req.method==='POST'){
   const x=json(await readBody(req));
   if(!['install','verify','install-interpolation'].includes(x.mode)||x.mode!=='verify'&&(typeof x.installDirectory!=='string'||x.installDirectory.length>1000))return send(res,400,{error:'Choose install with a local folder, or verify the registered runtime'});
   if(db.prepare("SELECT id FROM jobs WHERE type='runtime-setup' AND status IN ('queued','running','cancelling')").get())return send(res,409,{error:'Runtime setup is already queued or running'});
   const id=randomUUID(),t=now(),input={mode:x.mode,installDirectory:x.installDirectory};
   db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,null,null,'runtime-setup','queued',0,'queued for runtime setup',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
 }
 if(path==='/api/video/interpolate'&&req.method==='POST'){
   const x=json(await readBody(req)),project=typeof x.projectId==='string'&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);
   if(!project)return send(res,404,{error:'Project not found'});
   if(x.expectedRevision!==project.revision)return send(res,409,{error:'Project changed; save or refresh before interpolating'});
   if(!['auto','cpu'].includes(x.device||'auto')||Object.keys(x).some(k=>!['projectId','expectedRevision','device'].includes(k)))return send(res,400,{error:'Use a project revision and auto or cpu device; caller source paths are not accepted'});
   if(db.prepare("SELECT id FROM jobs WHERE project_id=? AND type='interpolate' AND status IN ('queued','running','cancelling')").get(project.id))return send(res,409,{error:'An interpolation export is already in progress'});
   const document=json(Buffer.from(project.document));
   let sourceJob=document.latestOutput?.jobId&&db.prepare('SELECT * FROM jobs WHERE id=? AND project_id=?').get(document.latestOutput.jobId,project.id),receipt=sourceJob?.output?json(Buffer.from(sourceJob.output)):null,reuse=null;
   if(sourceJob?.type==='interpolate'&&receipt?.review?.verdict==='rejected'){
     reuse={...receipt.interpolation,jobId:sourceJob.id,sourceHash:receipt.provenance.sourceHash,workflowHash:receipt.provenance.workflowHash};
     sourceJob=db.prepare('SELECT * FROM jobs WHERE id=? AND project_id=?').get(receipt.provenance.sourceJobId,project.id);receipt=sourceJob?.output?json(Buffer.from(sourceJob.output)):null;
   }
   try{validateInterpolationSource(receipt);}catch(error){return send(res,409,{error:error.message});}
   if(sourceJob.type==='interpolate')return send(res,409,{error:'This delivery is already interpolated. Re-render the edited timeline before another interpolation'});
   if(sourceJob.type==='render'){
     const snapshot=db.prepare('SELECT document FROM project_revisions WHERE project_id=? AND revision=?').get(project.id,sourceJob.revision);
     if(!snapshot||renderInputIdentity(json(Buffer.from(snapshot.document)))!==renderInputIdentity(document))return send(res,409,{error:'EDIT_CHANGED_SINCE_EXPORT: Render and review the saved timeline changes before interpolating'});
   }
   const assetId=receipt.assets?.video,sourceAsset=assetId&&db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(assetId,project.id);
   if(!sourceAsset||json(Buffer.from(sourceAsset.document)).jobId!==sourceJob.id||!reuse&&assetId!==document.latestOutput.videoAssetId)return send(res,409,{error:'OWNED_EXPORT_REQUIRED: A reviewed video from this project is required'});
   let cutFrames=[];
   if(receipt.kind==='timeline'){
     const fps=Number(receipt.provenance.fps);let cursor=0;
     cutFrames=(receipt.cache?.clips||[]).slice(0,-1).map(clip=>{cursor+=Number(clip.duration);return Math.round(cursor*fps);});
     if(!Array.isArray(receipt.cache?.clips)||!receipt.cache.clips.length||cutFrames.some(n=>!Number.isSafeInteger(n)))return send(res,409,{error:'SOURCE_EDIT_BOUNDARIES_MISSING: Re-render the timeline to record shot boundaries'});
   }
   const runtime=await inspectInterpolationRuntime();if(runtime.status!=='ready')return send(res,409,{error:runtime.message,code:runtime.code});
   let captionSrt='';if(typeof receipt.outputs?.captions==='string'&&receipt.outputs.captions===basename(receipt.outputs.captions))captionSrt=await readFile(join(jobsDir,sourceJob.id,receipt.outputs.captions),'utf8');
   const id=randomUUID(),t=now(),input={projectId:project.id,revision:project.revision,sourceAssetId:assetId,sourcePath:sourceAsset.path,sourceJobId:sourceJob.id,sourceReceipt:receipt,cutFrames,captionSrt,reuse,device:x.device||'auto'};
   db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,project.id,project.revision,'interpolate','queued',0,'queued for local RIFE interpolation',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
 }
 if(path==='/api/generation/enhance'&&req.method==='POST'){
   const x=json(await readBody(req)),project=x.projectId&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);
   if(!project)return send(res,404,{error:'Project not found'});
   if(x.expectedRevision&&x.expectedRevision!==project.revision)return send(res,409,{error:'Project changed; refresh before enhancing'});
   const document=json(Buffer.from(project.document)),sourceJob=document.latestOutput?.jobId&&db.prepare('SELECT * FROM jobs WHERE id=?').get(document.latestOutput.jobId);
   const receipt=sourceJob?.output?json(Buffer.from(sourceJob.output)):null;
   if(!receipt?.provenance?.evidenceHash||document.latestOutput?.status==='rejected')return send(res,409,{error:'A verified local generation source is required. Rejected footage cannot be enhanced into an accepted result.'});
   const sourceAssetId=receipt.assets?.sourceVideo;
   if(!sourceAssetId||!document.timeline?.some(clip=>clip.assetId===sourceAssetId))return send(res,409,{error:'The generated source must be in the timeline before enhancing its shot'});
   const sourceName=receipt.outputs?.sourceVideo;
   if(typeof sourceName!=='string'||sourceName!==basename(sourceName))return send(res,409,{error:'Verified generated source path is missing'});
   const id=randomUUID(),t=now(),input={type:'enhance',projectId:project.id,revision:project.revision,sourceAssetId,sourcePath:join(jobsDir,sourceJob.id,sourceName),receiptPath:join(jobsDir,sourceJob.id,'result.json')};
   db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,project.id,project.revision,'enhance','queued',0,'queued for tiled enhancement',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
 }
 if(path==='/api/generation/smoke-test'&&req.method==='POST') {
   const x=json(await readBody(req));let project=x.projectId&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);
   if(x.projectId&&!project)return send(res,404,{error:'Project not found'});
   if(db.prepare("SELECT id FROM jobs WHERE type='generation-test' AND status IN ('queued','running','cancelling')").get())return send(res,409,{error:'A local generation test is already queued or running. View its progress in Jobs.'});
   if(!project){const pid=randomUUID(),t=now(),doc={name:'Night Market · Local generation test',brief:x.brief||SMOKE_PROMPT,mode:'cinematic',timeline:[],settings:{width:1920,height:1080,fps:24},latestOutput:null};db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(pid,1,JSON.stringify(doc),t,t);db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(pid,1,JSON.stringify(doc),t);project=db.prepare('SELECT * FROM projects WHERE id=?').get(pid);}
   const id=randomUUID(),t=now(),input={type:'generation-test',projectId:project.id,brief:String(x.brief||SMOKE_PROMPT).slice(0,6000),seed:Number.isSafeInteger(x.seed)?x.seed:7092026,revision:project.revision};
   db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,project.id,project.revision,'generation-test','queued',0,'queued for local inference',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
 }
 if(path==='/api/generation/shot'&&req.method==='POST'){
   const x=json(await readBody(req)),project=typeof x.projectId==='string'&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);
   if(!project)return send(res,404,{error:'Project not found'});
   if(x.expectedRevision!==project.revision)return send(res,409,{error:'Project changed; save or refresh before generating the next shot'});
   if(db.prepare("SELECT id FROM jobs WHERE project_id=? AND type IN ('generation-test','generation-shot') AND status IN ('queued','running','cancelling')").get(project.id))return send(res,409,{error:'This project already has a generation job in progress'});
   if(typeof x.brief!=='string'||!x.brief.trim()||x.brief.length>6000)return send(res,400,{error:'Describe the next shot in 1–6000 characters'});
   const sourceJob=typeof x.referenceJobId==='string'&&db.prepare('SELECT * FROM jobs WHERE id=? AND project_id=?').get(x.referenceJobId,project.id);
   let result=sourceJob?.output?json(Buffer.from(sourceJob.output)):null,input;
   try{
     input=prepareNextShotInput({request:x,project,sourceJob,receipt:result,jobsDir});
     const checked=await verifyReviewTarget({db,jobsDir,mediaDir,job:sourceJob,output:result});result=checked.output;
     input=prepareNextShotInput({request:x,project,sourceJob,receipt:result,jobsDir});
     if(input.reference&&!existsSync(input.reference.path))throw new Error('The original generated reference keyframe is missing');
   }catch(error){return send(res,error.code==='SHOT_SOURCE_MODE_INVALID'?400:409,{error:error.message,code:error.code||'REVIEWED_REFERENCE_REQUIRED'});}
   // Verification is asynchronous: recheck the revision and queue before writing.
   if(db.prepare('SELECT revision FROM projects WHERE id=?').get(project.id)?.revision!==project.revision||db.prepare("SELECT id FROM jobs WHERE project_id=? AND type IN ('generation-test','generation-shot') AND status IN ('queued','running','cancelling')").get(project.id))return send(res,409,{error:'The project or generation queue changed; refresh before starting the shot'});
   const id=randomUUID(),t=now();
   db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,project.id,project.revision,'generation-shot','queued',0,input.sourceMode==='new-keyframe'?'queued for a new independent keyframe':'queued with locked character keyframe',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));
 }
 if(path==='/api/releases'&&req.method==='GET') return send(res,200,await releaseStore.list());
 if(path==='/api/releases'&&req.method==='POST'){
   try{
     const x=json(await readBody(req)), pr=x.projectId&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);
     if(!pr) return send(res,400,{error:'Project with a rendered output is required'});
     const doc=json(Buffer.from(pr.document)), aid=doc.latestOutput?.videoAssetId&&db.prepare('SELECT * FROM assets WHERE id=?').get(doc.latestOutput.videoAssetId);
     if(!aid) return send(res,400,{error:'Render a video before preparing a release package'});
     const asset=json(Buffer.from(aid.document)), release=await releaseStore.create({project:{id:pr.id,revision:String(pr.revision)},output:{path:aid.path,sha256:await hashOutput(aid.path),mimeType:asset.mime},metadata:{channelId:x.channelId,title:x.title,description:x.description||doc.brief||'',tags:x.tags||[],privacyStatus:x.privacyStatus||'private',...(x.publishAt?{publishAt:x.publishAt}:{})},channel:{id:x.channelId,title:x.channelTitle||''},aiDisclosure:{containsSyntheticMedia:Boolean(x.containsSyntheticMedia),rationale:x.aiRationale||''},rightsLedger:Array.isArray(x.rightsLedger)?x.rightsLedger:[],captions:Array.isArray(x.captions)?x.captions:[],thumbnail:null});
     return send(res,201,release);
   }catch(e){return send(res,400,{error:e.message,code:e.code||'INVALID_RELEASE',details:e.details||{}});}
 }
 if(['/api/formats/preview','/api/formats/draft'].includes(path)&&req.method==='POST'){
   try{const input=json(await readBody(req));return path.endsWith('/preview')?send(res,200,prepareRecipeProject(input)):send(res,201,createRecipeProject({db,input}));}
   catch(error){return send(res,error.code==='RECIPE_DRAFT_INVALID'?400:500,{error:error.message,code:error.code||'RECIPE_DRAFT_SAVE_FAILED'});}
 }
 if(path==='/api/projects/import'&&req.method==='POST'){
   try{
     const x=json(await readBody(req)),src=x.project||x,id=randomUUID(),t=now(),doc={...src};
     delete doc.id;delete doc.revision;delete doc.createdAt;delete doc.updatedAt;
     if(Object.hasOwn(doc,'researchEvidence')){
       doc.importedResearchEvidence={status:'imported-unverified',sourceMethod:'imported-project-bundle',importedAt:t,entries:doc.researchEvidence};
       delete doc.researchEvidence;
     }
     if(doc.creatorPack){doc.importedCreatorPackEvidence={status:'imported-unverified',sourceMethod:'imported-project-bundle',importedAt:t,value:doc.creatorPack};delete doc.creatorPack;}
     const importedAssets=Array.isArray(x.assets)?x.assets:[], map=new Map(), created=[];
     if(importedAssets.some(asset=>typeof asset.data!=='string'||asset.data.length>70_000_000))throw new Error('INCOMPLETE_PROJECT_BUNDLE: Every asset must contain embedded media; nothing was imported');
     const embeddedIds=new Set(importedAssets.map(asset=>asset.id));
     const referencedIds=[...(doc.timeline||[]).map(c=>c.assetId),doc.soundtrack?.assetId,...(doc.audioTracks||[]).map(c=>c.assetId),doc.productAssetId].filter(Boolean);
     if(referencedIds.some(aid=>!embeddedIds.has(aid)))throw new Error('INCOMPLETE_PROJECT_BUNDLE: A timeline or audio source is missing');
     for(const asset of importedAssets){
       if(typeof asset.data!=='string'||asset.data.length>70_000_000) continue;
       const aid=randomUUID(),name=basename(asset.name||'imported-asset.bin'),bytes=Buffer.from(asset.data,'base64'),file=join(mediaDir,aid+'-'+name);
       await writeFile(file,bytes); const meta={name,mime:asset.mime||'application/octet-stream',size:bytes.length,kind:asset.kind||String(asset.mime||'file').split('/')[0]||'file'};
       db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(aid,id,JSON.stringify(meta),file,t); map.set(asset.id,aid); created.push({...meta,id:aid,projectId:id,url:`/media/${aid}`});
     }
     if(Array.isArray(doc.timeline)) doc.timeline=doc.timeline.map(c=>({...c,assetId:map.get(c.assetId),sourceAssetId:map.get(c.sourceAssetId)||null,provenance:{generationStatus:'imported',sourceMethod:'imported-project-bundle',upstream:c.provenance||null}}));
     if(doc.soundtrack?.assetId) doc.soundtrack={...doc.soundtrack,assetId:map.get(doc.soundtrack.assetId)||doc.soundtrack.assetId};
     if(Array.isArray(doc.audioTracks))doc.audioTracks=doc.audioTracks.map(track=>({...track,assetId:map.get(track.assetId),provenance:{generationStatus:'imported',sourceMethod:'imported-project-bundle',upstream:track.provenance||null}}));
     for(const key of ['latestAudio','latestSoundDesign','transcriptSource'])if(doc[key])doc[key]={...doc[key],assetId:map.get(doc[key].assetId)||null,jobId:null,provenance:{generationStatus:'imported',sourceMethod:'imported-project-bundle',upstream:doc[key].provenance||null}};
     if(doc.productAssetId)doc.productAssetId=map.get(doc.productAssetId);
     if(doc.latestOutput) doc.latestOutput={...doc.latestOutput,jobId:null,provenance:{generationStatus:'imported',sourceMethod:'imported-project-bundle',upstream:doc.latestOutput.provenance||null},videoAssetId:map.get(doc.latestOutput.videoAssetId)||null,posterAssetId:map.get(doc.latestOutput.posterAssetId)||null,sceneAssetId:map.get(doc.latestOutput.sceneAssetId)||null};
     doc.assets=created;doc.importedHistory={sourceProjectId:src.id||null,sourceRevision:src.revision||null,importedAt:t,revisions:Array.isArray(x.revisions)?x.revisions:[]};
     db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(id,1,JSON.stringify(doc),t,t);db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(id,1,JSON.stringify(doc),t);
     return send(res,201,{...doc,id,revision:1,createdAt:t,updatedAt:t,assets:created,importDiagnostics:created.length<importedAssets.length?['Some assets had no embedded data and were omitted']:[]});
   }catch(e){return send(res,400,{error:e.message});}
 }
  if(path.startsWith('/api/projects/')&&path.endsWith('/export')&&req.method==='GET'){
    const id=path.split('/')[3],r=db.prepare('SELECT * FROM projects WHERE id=?').get(id); if(!r)return send(res,404,{error:'Project not found'});
    const rows=db.prepare('SELECT * FROM assets WHERE project_id=?').all(id),files=await Promise.all(rows.map(async row=>({row,info:await stat(row.path)})));
    if(files.some(f=>f.info.size>50_000_000)||files.reduce((sum,f)=>sum+f.info.size,0)>300_000_000)return send(res,413,{error:'PORTABLE_JSON_LIMIT: Keep individual assets under 50 MB and total media under 300 MB for JSON export. Original project files remain saved; no incomplete bundle was exported.'});
    const assets=await Promise.all(files.map(async({row})=>({...adoc(row),data:(await readFile(row.path)).toString('base64')})));
    return send(res,200,{schema:'vyrelum.project',schemaVersion:1,project:pdoc(r),revisions:db.prepare('SELECT revision,document,created_at AS createdAt FROM project_revisions WHERE project_id=? ORDER BY revision').all(id).map(x=>({...x,document:json(Buffer.from(x.document))})),assets});
  }
  if(path==='/api/projects'&&req.method==='POST'){const x=json(await readBody(req)),id=randomUUID(),t=now(),doc={name:x.name||'Untitled project',brief:x.brief||'',mode:x.mode||'cinematic',sampleId:x.sampleId||null,productTemplate:x.productTemplate||null,productCamera:x.productCamera||null,productAssetId:x.productAssetId||null,durationSeconds:x.durationSeconds||null,timeline:x.timeline||[],scene:x.scene||{objects:[],lights:[],camera:{position:[0,0,3],target:[0,0,0]}},settings:x.settings||{fps:24,width:640,height:360},assets:x.assets||[],latestOutput:null};db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(id,1,JSON.stringify(doc),t,t);db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(id,1,JSON.stringify(doc),t);return send(res,201,{...doc,id,revision:1,createdAt:t,updatedAt:t});}
  const vm=path.match(/^\/api\/projects\/([^/]+)\/variations$/);if(vm&&req.method==='POST'){const r=db.prepare('SELECT * FROM projects WHERE id=?').get(vm[1]);if(!r)return send(res,404,{error:'Project not found'});const x=json(await readBody(req));if(x.expectedRevision&&Number(x.expectedRevision)!==r.revision)return send(res,409,{error:'Revision conflict',project:pdoc(r)});const current=json(Buffer.from(r.document)),result=buildViralVariants({brief:current.brief||current.name,count:x.count||120,format:x.format,platform:x.platform}),t=now(),nextRevision=r.revision+1,nextDocument=JSON.stringify({...current,variations:result.variants,variationCount:result.count,variationSource:result.source,variationResearchBasis:result.researchBasis,variationDisclaimer:result.disclaimer});db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(nextRevision,nextDocument,t,vm[1]);db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(vm[1],nextRevision,nextDocument,t);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{} throw error;}return send(res,200,{...pdoc(db.prepare('SELECT * FROM projects WHERE id=?').get(vm[1])),variations:result.variants,variationCount:result.count});}
  const pm=path.match(/^\/api\/projects\/([^/]+)$/);if(pm&&req.method==='GET'){const r=db.prepare('SELECT * FROM projects WHERE id=?').get(pm[1]);return r?send(res,200,pdoc(r)):send(res,404,{error:'Project not found'});}if(pm&&req.method==='PATCH'){const r=db.prepare('SELECT * FROM projects WHERE id=?').get(pm[1]);if(!r)return send(res,404,{error:'Project not found'});const x=json(await readBody(req)),patch=x.patch||x;if(x.expectedRevision&&Number(x.expectedRevision)!==r.revision)return send(res,409,{error:'Revision conflict',project:pdoc(r)});delete patch.expectedRevision;if(['id','revision','createdAt','updatedAt','latestOutput','latestAudio','latestSoundDesign','transcriptSource','directorEvidence','researchEvidence','rawFootageProduction','rawFootagePlan','cinematicProduction','creatorPack'].some(key=>Object.hasOwn(patch,key)))return send(res,400,{error:'Generation and research evidence fields are managed by workers, not project edits'});if(Object.hasOwn(patch,'transcript')){try{prepareTimedCaptions(patch.transcript,(patch.timeline||json(Buffer.from(r.document)).timeline||[]).reduce((sum,clip)=>sum+Number(clip.duration||0),0));}catch(error){return send(res,400,{error:error.message});}}const t=now(),nextRevision=r.revision+1,nextDocument=JSON.stringify({...json(Buffer.from(r.document)),...patch});db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(nextRevision,nextDocument,t,pm[1]);db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(pm[1],nextRevision,nextDocument,t);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{} throw error;}return send(res,200,pdoc(db.prepare('SELECT * FROM projects WHERE id=?').get(pm[1])));}
  if(path==='/api/jobs'&&req.method==='POST'){const x=json(await readBody(req)),allowed=new Set(['direct','scene','render','produce']);if(!allowed.has(x.type||'render'))return send(res,400,{error:'Unsupported job type'});const project=x.projectId&&db.prepare('SELECT * FROM projects WHERE id=?').get(x.projectId);if(x.projectId&&!project)return send(res,404,{error:'Project not found'});if(project&&x.expectedRevision&&Number(x.expectedRevision)!==Number(project.revision))return send(res,409,{error:'Revision conflict',project:pdoc(project)});const id=randomUUID(),t=now(),revision=project?.revision||x.revision||null,input={...x,revision};delete input.expectedRevision;db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,x.projectId||null,revision,x.type||'render','queued',0,'queued',JSON.stringify(input),t,t);void runJob(id);return send(res,202,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));}if(path==='/api/jobs'&&req.method==='GET')return send(res,200,db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all().map(jdoc));
 const jm=path.match(/^\/api\/jobs\/([^/]+)(?:\/(cancel|retry))?$/);if(jm&&jm[2]==='cancel'&&req.method==='POST'){const id=jm[1],row=db.prepare('SELECT status,type FROM jobs WHERE id=?').get(id);if(!row)return send(res,404,{error:'Job not found'});if(row.type==='ltx-qualification')return send(res,409,{code:'QUALIFICATION_RUNNER_CONTROL_REQUIRED',error:'This experimental job is owned by the qualification runner. Use its --stop-job command; generic Cancel cannot control that process.'});if(['queued','running','staging','validating'].includes(row.status)){cancelling.add(id);db.prepare("UPDATE jobs SET status='cancelling',stage='cancellation requested',updated_at=? WHERE id=?").run(now(),id);await cancelOwnedProviderJob(id);await terminateProcessTree(children.get(id));if(!children.has(id))db.prepare("UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=? WHERE id=?").run(now(),id);}return send(res,200,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)));}
 if(jm&&jm[2]==='retry'&&req.method==='POST'){
   const retryJob=db.prepare('SELECT id,type FROM jobs WHERE id=?').get(jm[1]);
   if(!retryJob)return send(res,404,{error:'Job not found'});
   if(retryJob.type==='ltx-qualification')return send(res,409,{code:'QUALIFICATION_RUNNER_CONTROL_REQUIRED',error:'Rerun this experimental profile through the qualification runner. Generic Retry has no qualified LTX worker and cannot run this job.'});
   // Preserve the original revision, input, receipts and provider prompt IDs.
   // A stale retry may retain an output but cannot replace a newer project edit.
   const changed=db.prepare("UPDATE jobs SET status='queued',progress=0,stage='retry queued',error=NULL,updated_at=? WHERE id=? AND (status IN ('failed','cancelled') OR (status='blocked' AND type IN ('generation-test','generation-shot')))").run(now(),jm[1]);
   if(!changed.changes)return send(res,409,{error:'Only failed, cancelled, or blocked neural generation jobs can be retried'});
   void runJob(jm[1]);return send(res,200,jdoc(db.prepare('SELECT * FROM jobs WHERE id=?').get(jm[1])));
 }
 if(path==='/api/generation/apply-retained'&&req.method==='POST'){
   const x=json(await readBody(req));
   try{return send(res,200,applyGeneratedShot({db,projectId:x.projectId,expectedRevision:x.expectedRevision,jobId:x.jobId,append:true}));}
   catch(error){return send(res,409,{error:error.message,code:error.code||'APPLY_GENERATED_FAILED'});}
 }
 if(jm&&req.method==='GET'){const r=db.prepare('SELECT * FROM jobs WHERE id=?').get(jm[1]);return r?send(res,200,jdoc(r)):send(res,404,{error:'Job not found'});}
 if(path==='/api/assets'&&req.method==='POST'){const b=await readBody(req),id=randomUUID(),name=decodeURIComponent(req.headers['x-filename']||'asset.bin'),projectId=req.headers['x-project-id']||null,file=join(mediaDir,id+'-'+basename(name)),t=now(),doc={name,mime:req.headers['content-type']||'application/octet-stream',size:b.length,kind:(req.headers['content-type']||'').split('/')[0]||'file'};await writeFile(file,b);db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(id,projectId,JSON.stringify(doc),file,t);if(projectId&&doc.kind==='image'){const pr=db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);if(pr){const d=json(Buffer.from(pr.document));if(d.mode==='product'&&!d.productAssetId){const next={...d,productAssetId:id};db.prepare('UPDATE projects SET document=?,updated_at=? WHERE id=?').run(JSON.stringify(next),t,projectId);}}}return send(res,201,adoc(db.prepare('SELECT * FROM assets WHERE id=?').get(id)));}
 return send(res,404,{error:'Unknown route'});
}
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.jpg':'image/jpeg','.png':'image/png'};
 const publicFiles=new Set(['/','/index.html','/app.js','/studio-chat.js','/cinematic-studio.js','/timeline-editor.js','/youtube-settings.js','/styles.css']);
 createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/'))return api(req,res,u.pathname).catch(error=>send(res,500,{error:error.message,code:'LOCAL_API_FAILED'}));if(u.pathname.startsWith('/media/')){const o=req.headers.origin;if(o&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)){res.writeHead(403);return res.end()};const r=db.prepare('SELECT * FROM assets WHERE id=?').get(u.pathname.split('/')[2]);if(!r)return res.writeHead(404).end();return streamLocalMedia(req,res,r.path,json(Buffer.from(r.document)).mime);}if(req.method!=='GET'||!publicFiles.has(u.pathname))return res.writeHead(404).end();const p=normalize(join(root,u.pathname==='/'?'index.html':u.pathname));if(!p.startsWith(root)||!existsSync(p))return res.writeHead(404).end();res.writeHead(200,{'content-type':mime[extname(p)]||'application/octet-stream'});createReadStream(p).pipe(res)}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`VYRELUM local control plane listening on http://localhost:${process.env.PORT||4173}`));



for(const pending of db.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at").all())void runJob(pending.id);
