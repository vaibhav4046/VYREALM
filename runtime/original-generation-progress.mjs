import { readFile, appendFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { hashJson } from './generation-gate.mjs';
import { readOriginalMonitorTarget } from './original-generation-monitor.mjs';

const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,200}$/.test(value);
const safe=(callback,value)=>{try{callback(value);}catch{/* Optional telemetry cannot fail model production. */}};
const inputError=()=>Object.assign(new Error('Progress requires the exact owned prompt, client, graph and bounded loopback endpoint.'),{code:'ORIGINAL_PROGRESS_INPUT'});

/** @typedef {{promptId:string,clientId:string,workflowHash:string}} ProgressTarget */
/** Read-only ComfyUI events. Percentages are pipeline-stage weights, not an ETA.
 * HTTP history and output validation remain the only completion authorities.
 * Binary previews and prompt-less reconnect messages are deliberately ignored. */
export function createOriginalProgressListener({baseUrl,kind,target,workflow,deadlineAt,onProgress=()=>{},onTelemetry=()=>{},signal,WebSocketImpl=globalThis.WebSocket,clock=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,maxReconnects=8}){
 let url;try{url=new URL(baseUrl);}catch{throw inputError();}
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||!['keyframe','motion'].includes(kind)||!validId(target?.promptId)||!validId(target?.clientId)||target.workflowHash!==hashJson(workflow)||!Number.isFinite(deadlineAt)||deadlineAt-clock()>(kind==='keyframe'?20:90)*60000+1000||!Number.isInteger(maxReconnects)||maxReconnects<0||maxReconnects>8||typeof WebSocketImpl!=='function')throw inputError();
 url.protocol='ws:';url.pathname='/ws';url.search=new URLSearchParams({clientId:target.clientId}).toString();url.hash='';
 const classes=new Map(Object.entries(workflow).map(([id,node])=>[id,node.class_type])),steps=workflow['8']?.class_type==='SamplerCustom'?workflow['14']?.inputs?.steps:workflow['8']?.inputs?.steps,label=kind==='motion'?'Motion':'Keyframe';
 let closed=false,socket,handlers,openTimer,reconnectTimer,deadlineTimer,reconnects=0,last,rank=0,lastProgress=0;
 const timer=(fn,ms)=>{const id=setTimer(fn,ms);id?.unref?.();return id;};
 function detach(){if(openTimer!==undefined)clearTimer(openTimer);openTimer=undefined;if(socket&&handlers)for(const[type,fn]of Object.entries(handlers))socket.removeEventListener(type,fn);const old=socket;socket=undefined;handlers=undefined;try{old?.close();}catch{}}
 function close(){if(closed)return;closed=true;detach();if(reconnectTimer!==undefined)clearTimer(reconnectTimer);if(deadlineTimer!==undefined)clearTimer(deadlineTimer);reconnectTimer=deadlineTimer=undefined;signal?.removeEventListener('abort',close);}
 function emit(event,sourceType){
  const value={...event,promptId:target.promptId,progressBasis:'pipeline-stage',providerProgress:true,observedAt:new Date(clock()).toISOString()};
  if(Number.isFinite(value.progress)){lastProgress=Math.max(lastProgress,Math.min(0.83,value.progress));value.progress=lastProgress;}
  safe(onProgress,value);safe(onTelemetry,{...value,event:sourceType,workflowHash:target.workflowHash});return value;
 }
 function unavailable(){emit({stage:`${label}: progress events unavailable${last?`; last observed ${last.stage}`:''}; HTTP status monitoring continues`,...(last?{progress:last.progress}:{}),progressAvailable:false},'unavailable');}
 function lost(){
  if(closed)return;detach();unavailable();
  if(reconnects>=maxReconnects||clock()>=deadlineAt){close();return;}
  const delay=Math.min(60000,15000*2**reconnects);reconnects++;
  if(clock()+delay>=deadlineAt){close();return;}
  reconnectTimer=timer(()=>{reconnectTimer=undefined;connect();},delay);
 }
 function message(event){
  if(closed||typeof event.data!=='string'||event.data.length>65536)return;let value;try{value=JSON.parse(event.data);}catch{return;}
  const data=value?.data;if(!data||data.prompt_id!==target.promptId)return;
  if(['execution_success','execution_error','execution_interrupted'].includes(value.type)||value.type==='executing'&&data.node===null){
   emit({stage:value.type==='execution_error'||value.type==='execution_interrupted'?`${label}: provider reported an interruption; checking owned HTTP history`:`${label}: Verifying provider history and generated outputs`,progress:value.type==='execution_success'||data.node===null?0.83:lastProgress,progressAvailable:true},value.type);close();return;
  }
  if(!['executing','progress'].includes(value.type)||typeof data.node!=='string'||!classes.has(data.node))return;
  const nodeType=classes.get(data.node);let stage,progress,nodeRank;
  if(['UnetLoaderGGUF','CLIPLoaderGGUF','VAELoader','ModelSamplingSD3','ModelSamplingLTXV','LoadImage'].includes(nodeType)){nodeRank=1;stage='Loading local model or reference';progress=0.05;}
  else if(nodeType==='CLIPTextEncode'){nodeRank=2;stage='Encoding shot direction locally';progress=0.12;}
  else if(['Wan22ImageToVideoLatent','LTXVImgToVideo'].includes(nodeType)){nodeRank=3;stage='Preparing image-conditioned latent';progress=0.22;}
  else if(['KSampler','SamplerCustom'].includes(nodeType)){nodeRank=4;stage='Sampling locally';progress=0.25;}
  else if(['VAEDecode','VAEDecodeTiled'].includes(nodeType)){nodeRank=5;stage='Decoding generated pixels locally';progress=0.70;}
  else if(nodeType==='SaveLatent'){nodeRank=4;stage='Saving sampler latent checkpoint';progress=0.68;}
  else if(nodeType==='SaveImage'){nodeRank=6;stage='Saving generated frames';progress=0.81;}
  else return;
  if(nodeRank<rank)return;
  const extra={nodeId:data.node,nodeType,progressAvailable:true};
  if(value.type==='progress'){
   if(!['KSampler','SamplerCustom','VAEDecode','VAEDecodeTiled','SaveImage'].includes(nodeType)||!Number.isInteger(data.value)||!Number.isInteger(data.max)||data.value<0||data.max<1||data.max>1000000||data.value>data.max)return;
   if(['KSampler','SamplerCustom'].includes(nodeType)){
    if(data.max!==steps||last?.nodeId===data.node&&Number.isInteger(last.samplerStep)&&data.value<last.samplerStep)return;
    stage+=`: ${data.value}/${data.max} steps (${Math.round(data.value/data.max*100)}%)`;progress+=0.43*data.value/data.max;extra.samplerStep=data.value;extra.samplerSteps=data.max;
   }else{stage+=`: ${data.value}/${data.max} units`;progress=Math.min(0.82,progress+(nodeRank===5?0.10:0.01)*data.value/data.max);extra.nodeValue=data.value;extra.nodeMaximum=data.max;}
  }else if(last?.nodeId===data.node&&nodeRank===rank)return;
  rank=nodeRank;last=emit({stage:`${label}: ${stage}`,progress,...extra},value.type);
 }
 function connect(){
  if(closed||signal?.aborted||clock()>=deadlineAt){close();return;}
  try{socket=new WebSocketImpl(url.href);handlers={message,open:()=>{if(openTimer!==undefined)clearTimer(openTimer);openTimer=undefined;},close:lost,error:lost};for(const[type,fn]of Object.entries(handlers))socket.addEventListener(type,fn);openTimer=timer(lost,Math.min(10000,deadlineAt-clock()));}
  catch{lost();}
 }
 signal?.addEventListener('abort',close,{once:true});deadlineTimer=timer(close,Math.max(1,deadlineAt-clock()));connect();
 return{close};
}

/** Worker-only provider decoration. Uses recorded submission identity, never
 * obtains a client from an unrelated queue or creates another provider prompt. */
export function createOriginalProgressBridge({provider,jobRoot,kind,request,deadlineAt,onProgress=()=>{},signal,listenerFactory=createOriginalProgressListener}){
 let listener,attaching,attached=false,closed=false,lastDetail,highest=0,journal=Promise.resolve(),journalCount=0;
 const journalPath=join(jobRoot,'provider-progress.jsonl');
 const emit=event=>{const value={...event};if(Number.isFinite(value.progress)){highest=Math.max(highest,value.progress);value.progress=highest;}safe(onProgress,value);};
 const telemetry=event=>{
  if(journalCount++>=512)return;
  journal=journal.then(async()=>{let size=0;try{size=(await stat(journalPath)).size;}catch(e){if(e.code!=='ENOENT')return;}if(size<512*1024)await appendFile(journalPath,JSON.stringify({jobId:basename(jobRoot),projectId:request.projectId,kind,...event})+'\n');}).catch(()=>{});
 };
 const detail=event=>{lastDetail=event;emit(event);};
 async function attach(promptId){
  if(closed||attached)return;if(attaching)return attaching;
  attaching=(async()=>{
   let target;
   try{target=await readOriginalMonitorTarget({jobRoot,kind,request});}catch{return;}
   if(closed||target.promptId!==promptId)return;attached=true;
   try{
    const workflow=JSON.parse(await readFile(join(jobRoot,kind,'workflow.json'),'utf8'));
    if(closed)return;
    listener=listenerFactory({baseUrl:provider.baseUrl,kind,target,workflow,deadlineAt,signal,onProgress:detail,onTelemetry:telemetry});
   }catch{detail({stage:`${kind}: detailed provider events unavailable; HTTP status monitoring continues`,progressAvailable:false,providerProgress:true});}
  })().finally(()=>{attaching=undefined;});return attaching;
 }
 const decorated=Object.create(provider);decorated.fetch=async(url,options)=>{
  try{const value=new URL(url);if(value.origin===new URL(provider.baseUrl).origin&&value.pathname.startsWith('/history/'))await attach(decodeURIComponent(value.pathname.slice('/history/'.length)));}catch{/* Optional progress cannot alter HTTP generation validation. */}
  return provider.fetch(url,options);
 };
 return{
  provider:decorated,
  progress(event){
   // Broad HTTP liveness messages must not erase the last node/step observation.
   const generic=/provider (?:processing|running|busy)|awaiting owned provider history/.test(event.stage||'');
   if(lastDetail&&generic)emit({...event,...lastDetail,...(event.elapsedSeconds!==undefined?{elapsedSeconds:event.elapsedSeconds}:{})});
   else{if(Number(event.progress)>=0.85){lastDetail=undefined;listener?.close();listener=undefined;}emit(event);}
  },
  async close(){if(closed)return;closed=true;await attaching;listener?.close();listener=undefined;await journal;}
 };
}
