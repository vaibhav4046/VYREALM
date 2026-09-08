import { readFile, stat, appendFile, writeFile, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashJson } from './generation-gate.mjs';
import { wanWorkflow } from './neural-production.mjs';
import { validateKeyframeRequest } from './keyframe-production.mjs';
import { ORIGINAL_GENERATION_OWNER, originalMotionEngine, reviewedMotionWorkflow, validateReviewedMotionRequest } from './reviewed-keyframe-motion.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,200}$/.test(value);
const validate=(kind,value)=>kind==='keyframe'?validateKeyframeRequest(value):validateReviewedMotionRequest(value);
async function boundedText(file,max=2*1024**2){if((await stat(file)).size>max)fail('ORIGINAL_MONITOR_TARGET','Owned monitor evidence is too large.');return readFile(file,'utf8');}
const json=async file=>JSON.parse(await boundedText(file));

/** Resolve the exact submitted graph from owned files. No HTTP or inference. */
export async function readOriginalMonitorTarget({jobRoot,kind,request}){
 try{
  if(!['keyframe','motion'].includes(kind))fail('ORIGINAL_MONITOR_TARGET','Unknown owned stage.');
  const saved=validate(kind,await json(join(jobRoot,kind==='keyframe'?'request.json':'motion-request.json')));
  if(hashJson(saved)!==hashJson(validate(kind,request)))fail('ORIGINAL_MONITOR_TARGET','The durable request changed during monitoring.');
  const workflow=await json(join(jobRoot,kind,'workflow.json'));let expected;
  if(kind==='keyframe')expected=wanWorkflow({...saved,frames:1,prefix:`vyrealm/${basename(jobRoot)}/keyframe`});
  else{
   const checkpoint=await json(join(jobRoot,'generation-checkpoint.json'));
   if(!/^vyrealm\/[a-f0-9-]{36}$/.test(checkpoint.namespace||'')||!workflow['11']?.inputs?.image)fail('ORIGINAL_MONITOR_TARGET','The owned motion namespace or input image is missing.');
   expected=reviewedMotionWorkflow({request:saved,imageName:workflow['11'].inputs.image,prefix:`${checkpoint.namespace}/motion`});
  }
  const workflowHash=hashJson(expected);if(hashJson(workflow)!==workflowHash)fail('ORIGINAL_MONITOR_TARGET','The retained workflow no longer matches this request.');
  const submissions=(await boundedText(join(jobRoot,kind,'provider.jsonl'))).trim().split('\n').filter(Boolean).map(JSON.parse).filter(e=>e.event==='submitted');
  if(submissions.length!==1||submissions[0].workflowHash!==workflowHash||!validId(submissions[0].promptId))fail('ORIGINAL_MONITOR_TARGET','A single exact owned provider submission is required for reconnection.');
  return{serviceOwner:ORIGINAL_GENERATION_OWNER,jobId:basename(jobRoot),projectId:request.projectId,kind,requestHash:hashJson(request),workflowHash,promptId:submissions[0].promptId,...(validId(submissions[0].clientId)?{clientId:submissions[0].clientId}:{})};
 }catch(error){if(error.code==='ORIGINAL_MONITOR_TARGET')throw error;fail('ORIGINAL_MONITOR_TARGET','The owned request, workflow or submission log is missing or invalid; no new inference was submitted.');}
}
const delay=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Object.assign(new Error('Monitoring interrupted'),{code:'ORIGINAL_CANCELLED'}));}signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});

/** Remains inside one worker and one outer GPU lease. Only lost polling retries.
 * After the first submission, the retry provider cannot submit any new graph. */
export async function runOriginalWithReconnect({jobRoot,kind,request,provider,produce,onProgress=()=>{},signal,deadlineAt,runId,clock=Date.now,wait=delay,maxReconnects=8}){
 const remaining=()=>deadlineAt-clock(),maximum=(kind==='keyframe'||originalMotionEngine(request)==='ltx-draft-512'?20:90)*60000;
 if(!['keyframe','motion'].includes(kind)||!Number.isFinite(deadlineAt)||remaining()>maximum+1000||!Number.isInteger(maxReconnects)||maxReconnects<0||maxReconnects>8||!validId(runId))fail('ORIGINAL_MONITOR_INPUT','A bounded original worker invocation is required.');
 const expired=new AbortController(),timer=setTimeout(()=>expired.abort(),Math.max(1,remaining())),combined=signal?AbortSignal.any([signal,expired.signal]):expired.signal;
 const stopped=()=>{if(signal?.aborted)fail('ORIGINAL_CANCELLED','Original generation was explicitly cancelled.');if(expired.signal.aborted||remaining()<=0)fail('ORIGINAL_TIMEOUT','The original generation deadline elapsed; reconnecting did not extend it.');};
 const interruptible=promise=>new Promise((resolve,reject)=>{const abort=()=>{try{stopped();}catch(e){reject(e);}};combined.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>combined.removeEventListener('abort',abort));if(combined.aborted)abort();});
 let target=null,reconnects=0;
 try{
  while(true){
   stopped();if(target&&hashJson(await readOriginalMonitorTarget({jobRoot,kind,request}))!==hashJson(target))fail('ORIGINAL_MONITOR_TARGET','The recorded provider prompt changed during reconnection.');
   const guarded=Object.assign(Object.create(provider),{generate_video:async(...args)=>{stopped();if(target)fail('ORIGINAL_RECONNECT_RESUBMISSION_BLOCKED','Reconnection may only observe the retained prompt; a new inference submission was refused.');return provider.generate_video(...args);},fetch:async(url,options={})=>{
    stopped();if(target){const u=new URL(url);if(u.pathname.startsWith('/history/')&&decodeURIComponent(u.pathname.slice('/history/'.length))!==target.promptId)fail('ORIGINAL_MONITOR_TARGET','Reconnection attempted to inspect a different provider prompt.');}
    return provider.fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,combined]):combined});
   }});
   try{const result=await interruptible(Promise.resolve().then(()=>produce({provider:guarded,remainingMs:remaining(),reconnecting:!!target})));stopped();return result;}
   catch(error){
    stopped();if(error.code!=='PROVIDER_POLL_UNAVAILABLE')throw error;
    const observed=await readOriginalMonitorTarget({jobRoot,kind,request});if(target&&hashJson(observed)!==hashJson(target))fail('ORIGINAL_MONITOR_TARGET','The provider prompt changed before recovery.');target=observed;
    if(reconnects>=maxReconnects)fail('ORIGINAL_MONITOR_EXHAUSTED',`Provider status remained unavailable after ${maxReconnects} bounded reconnects to the same prompt. No replacement inference was submitted.`);
    reconnects++;const pause=Math.min(60000,15000*2**(reconnects-1),Math.max(0,remaining()));
    await appendFile(join(jobRoot,'monitor-reconnect.jsonl'),JSON.stringify({...target,runId,event:'reconnect',attempt:reconnects,maxReconnects,deadlineAt,delayMs:pause,timestamp:new Date().toISOString()})+'\n');
    onProgress({stage:`Reconnecting to the retained ${kind} prompt (${reconnects}/${maxReconnects}); generation was not cancelled or resubmitted`,promptId:target.promptId,reconnecting:true});
    await interruptible(wait(pause,combined));stopped();
   }
  }
 }finally{clearTimeout(timer);}
}

/** Worker/service error protocol: no stderr substring decides retry policy. */
export async function writeOriginalWorkerFailure({jobRoot,kind,request,runId,error}){
 const value={schemaVersion:1,serviceOwner:ORIGINAL_GENERATION_OWNER,jobId:basename(jobRoot),projectId:request.projectId,kind,requestHash:hashJson(request),runId,workerPid:process.pid,code:/^[A-Z][A-Z0-9_]{0,95}$/.test(error.code||'')?error.code:'ORIGINAL_WORKER_FAILED',message:String(error.message||'Worker failed').slice(-1800),timestamp:new Date().toISOString()},file=join(jobRoot,'worker-error.json'),temporary=`${file}.${randomUUID()}.tmp`;
 await writeFile(temporary,JSON.stringify(value,null,2),{flag:'wx'});await rename(temporary,file);return value;
}
export async function readOriginalWorkerFailure({jobRoot,kind,request,runId,workerPid}){
 try{const value=await json(join(jobRoot,'worker-error.json'));return value.schemaVersion===1&&value.serviceOwner===ORIGINAL_GENERATION_OWNER&&value.jobId===basename(jobRoot)&&value.projectId===request.projectId&&value.kind===kind&&value.requestHash===hashJson(request)&&value.runId===runId&&(!workerPid||value.workerPid===workerPid)&&/^[A-Z][A-Z0-9_]{0,95}$/.test(value.code||'')&&typeof value.message==='string'&&value.message.length<=1800?value:null;}catch{return null;}
}

export function recordOriginalMonitoring(receipt,{kind,runId,startedAt,deadlineAt,reconnects,finishedAt=Date.now()}){
 const result={...receipt,provenance:{...receipt.provenance},monitoring:{runId,startedAt,deadlineAt,reconnects,elapsedMs:Math.max(0,finishedAt-startedAt)}};
 if(kind==='keyframe')result.provenance.renderTimeMs=result.monitoring.elapsedMs;
 if(kind==='motion'&&reconnects>0){
  // The inner producer's in-memory sampler restarts on reconnect. Its observed
  // maximum is not a trustworthy peak for the entire original operation.
  result.provenance={...result.provenance,vramPeakGb:null,vramMeasurementStatus:'incomplete-after-monitor-reconnect',...(result.provenance.source?{source:{...result.provenance.source,vramPeakGb:null,vramMeasurementStatus:'incomplete-after-monitor-reconnect'}}:{})};
  result.diagnostics=[...(receipt.diagnostics||[]),{code:'VRAM_PEAK_INCOMPLETE',message:'Provider monitoring reconnected during this job. Full-job peak VRAM was not retained; it is reported as unavailable.'}];
 }
 return result;
}
