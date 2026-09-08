import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { canonicalKeyframeStore, validateKeyframeRequest, produceLocalKeyframe, verifyOwnedGeneratedKeyframe } from '../runtime/keyframe-production.mjs';
import { WAN_MODELS, wanWorkflow } from '../runtime/neural-production.mjs';
import { createComfyUIProvider } from '../runtime/providers/comfyui.mjs';
import { acquireQualificationLease } from './benchmark-ltx-shot.mjs';

const now = () => new Date().toISOString();
const emit = value => console.log(JSON.stringify(value));
const fail = (code,message) => {throw Object.assign(new Error(`${code}: ${message}`),{code});};
export function parseKeyframeArgs(args) {
  const {values:v}=parseArgs({args,strict:true,allowPositionals:false,options:{run:{type:'boolean',default:false},'data-dir':{type:'string'},'request-file':{type:'string'},'review-job':{type:'string'},verdict:{type:'string'},'notes-file':{type:'string'},'expected-output-hash':{type:'string'}}});
  if (v['review-job']) {if (v.run || v['request-file'] || !/^[a-f0-9-]{36}$/i.test(v['review-job']) || !['passed','rejected'].includes(v.verdict) || !v['notes-file'] || !/^[a-f0-9]{64}$/.test(v['expected-output-hash'] || '')) fail('KEYFRAME_REVIEW_ARGUMENTS','Review needs an existing job, verdict, notes file and exact PNG hash');}
  else if (!v['request-file'] || v.verdict || v['notes-file'] || v['expected-output-hash']) fail('KEYFRAME_ARGUMENTS','Provide --request-file; --run explicitly enables local inference');
  return {run:v.run,dataDir:v['data-dir'] || process.env.VYRELUM_DATA_DIR || join(process.env.APPDATA || join(homedir(),'.local','state'),'vyrelum','data'),requestFile:v['request-file'],reviewJobId:v['review-job'],verdict:v.verdict,notesFile:v['notes-file'],expectedHash:v['expected-output-hash']};
}
export async function reviewGeneratedKeyframe({dataDir,reviewJobId,verdict,notesFile,expectedHash}) {
  const paths=await canonicalKeyframeStore(dataDir),db=new DatabaseSync(paths.databasePath);
  db.exec('PRAGMA busy_timeout=5000');
  try {
    const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(reviewJobId), stored=job && JSON.parse(job.output || 'null');
    if (!job || job.type!=='generation-keyframe' || !stored) fail('KEYFRAME_REVIEW_JOB','Only a completed generated-keyframe job can be reviewed');
    const notes=(await readFile(notesFile,'utf8')).trim();
    if (!notes || notes.length>4000 || !['passed','rejected'].includes(verdict)) fail('KEYFRAME_REVIEW_NOTES','Write bounded visual inspection notes');
    const verified=await verifyOwnedGeneratedKeyframe({...paths,sourceJobId:job.id,projectId:job.project_id,expectedHash,requireReview:false,db});
    const review={verdict,notes,outputHash:expectedHash,evidenceHash:verified.evidenceHash,mediaKind:'image',reviewer:'operator-visual-review',reviewedAt:now(),scope:'Casting, costume, setting, composition and visible defects in the exact still; no video or automated realism score'};
    const receipt={...verified.receipt,review,status:verdict==='passed'?'reviewed':'rejected',provenance:{...verified.receipt.provenance,semanticQuality:verdict==='passed'?'operator-reviewed':'rejected'}};
    db.exec('BEGIN IMMEDIATE');
    try {
      if(db.prepare('SELECT output FROM jobs WHERE id=?').get(job.id)?.output!==job.output) fail('KEYFRAME_REVIEW_CHANGED','Job changed during inspection');
      await writeFile(join(paths.jobsDir,job.id,'result.json'),JSON.stringify(receipt,null,2));
      db.prepare('UPDATE jobs SET status=?,stage=?,output=?,updated_at=? WHERE id=?').run(verdict==='passed'?'succeeded':'rejected',verdict==='passed'?'Generated still visually approved':'Generated still rejected',JSON.stringify({...receipt,assets:stored.assets}),now(),job.id);
      db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');throw error;}
    return {jobId:job.id,status:verdict,outputHash:expectedHash,review};
  } finally {db.close();}
}
export async function runKeyframe(options) {
  if(options.reviewJobId) return reviewGeneratedKeyframe(options);
  const request=validateKeyframeRequest(JSON.parse(await readFile(options.requestFile,'utf8'))),paths=await canonicalKeyframeStore(options.dataDir),db=new DatabaseSync(paths.databasePath);
  db.exec('PRAGMA busy_timeout=5000');
  let release,jobId,stopping=false;
  const provider=createComfyUIProvider();
  const stop=()=>{stopping=true; if(jobId) void readFile(join(paths.jobsDir,jobId,'keyframe','provider.jsonl'),'utf8').then(async raw=>{const event=raw.trim().split('\n').filter(Boolean).map(JSON.parse).find(x=>x.event==='submitted');if(event?.promptId)await provider.cancel(event.promptId);}).catch(()=>{});};
  try {
    const project=db.prepare('SELECT revision FROM projects WHERE id=?').get(request.projectId);
    if(project?.revision!==request.expectedRevision) fail('KEYFRAME_PROJECT_REVISION','Project changed; refresh the exact revision before submission');
    const health=await provider.health_check();
    if(!health.available) fail('KEYFRAME_PROVIDER_UNAVAILABLE',health.reason || 'Local ComfyUI is unavailable');
    const workflow=wanWorkflow({...request,frames:1,prefix:'vyrealm/preflight/keyframe'}),installed=Object.values(health.installedModels || {}).flat();
    const missingModels=Object.values(WAN_MODELS).filter(name=>!installed.includes(name)),missingNodes=[...new Set(Object.values(workflow).map(node=>node.class_type))].filter(name=>!health.nodes?.includes(name));
    if(missingModels.length || missingNodes.length) fail('KEYFRAME_DEPENDENCIES_MISSING',JSON.stringify({missingModels,missingNodes}));
    const disk=await statfs(paths.jobsDir),freeBytes=Number(disk.bavail)*Number(disk.bsize);
    if(freeBytes<512*1024**2) fail('KEYFRAME_DISK_SPACE','512 MiB free job storage is required');
    if(!options.run)return{status:'ready',modelInvoked:false,request,models:WAN_MODELS,freeDiskGb:freeBytes/1024**3};
    jobId=randomUUID();const jobRoot=join(paths.jobsDir,jobId);
    await mkdir(jobRoot,{recursive:false});await writeFile(join(jobRoot,'request.json'),JSON.stringify(request,null,2),{flag:'wx'});
    const created=now();db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(jobId,request.projectId,request.expectedRevision,'generation-keyframe','running',0,'Waiting for shared local GPU',JSON.stringify(request),created,created);
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    emit({jobId,status:'waiting_for_gpu',projectId:request.projectId,outputDirectory:jobRoot});
    release=await acquireQualificationLease({owner:`generation-keyframe:${jobId}`,isStopped:()=>stopping,onWait:timing=>{db.prepare('UPDATE jobs SET stage=?,updated_at=? WHERE id=?').run(`Waiting for shared GPU (${timing.elapsedSeconds}s)`,now(),jobId);}});
    await release.registerChild(process.pid);
    if(stopping)fail('KEYFRAME_STOPPED','Stopped before model invocation');
    const receipt=await produceLocalKeyframe({jobRoot,request,provider,onProgress:progress=>{if(stopping)fail('KEYFRAME_STOPPED','Stopped; no output promoted');if(db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId)?.status!=='running'){stop();fail('KEYFRAME_JOB_CHANGED','Job state changed; stopping owned prompt');}db.prepare('UPDATE jobs SET stage=?,progress=?,updated_at=? WHERE id=?').run(progress.stage || 'Generating local still',Math.max(0,Math.min(1,Number(progress.progress)||0.1)),now(),jobId);emit({jobId,...progress});}});
    if(stopping)fail('KEYFRAME_STOPPED','Stopped before registration');
    const assetId=randomUUID(),bytes=await readFile(join(jobRoot,receipt.outputs.image)),assetPath=join(paths.mediaDir,`${assetId}-generated-keyframe.png`);
    await writeFile(assetPath,bytes,{flag:'wx'});
    db.exec('BEGIN IMMEDIATE');
    try{if(db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId)?.status!=='running')fail('KEYFRAME_JOB_CHANGED','Job changed before registration');db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(assetId,request.projectId,JSON.stringify({name:'generated-keyframe.png',mime:'image/png',size:bytes.length,kind:'image',jobId,sourceMethod:'local-generated-keyframe',outputHash:receipt.provenance.outputHash}),assetPath,now());db.prepare("UPDATE jobs SET status='review_required',progress=1,stage='Generated still requires casting review',output=?,updated_at=? WHERE id=?").run(JSON.stringify({...receipt,assets:{image:assetId}}),now(),jobId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    return{jobId,status:'review_required',image:join(jobRoot,receipt.outputs.image),assetId,outputHash:receipt.provenance.outputHash,modelInvoked:true,provenance:receipt.provenance};
  }catch(error){if(jobId){const receipt={status:'blocked',validated:false,code:error.code || 'KEYFRAME_FAILED',diagnostics:[{message:error.message}]};await writeFile(join(paths.jobsDir,jobId,'failure.json'),JSON.stringify(receipt,null,2));db.prepare("UPDATE jobs SET status='blocked',stage='Keyframe production stopped',error=?,updated_at=? WHERE id=?").run(error.message,now(),jobId);error.jobId=jobId;}throw error;}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);if(release)await release();db.close();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{emit(await runKeyframe(parseKeyframeArgs(process.argv.slice(2))));}catch(error){emit({status:'blocked',code:error.code || 'KEYFRAME_FAILED',message:error.message,jobId:error.jobId || null});process.exitCode=1;}}
