import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, freemem, totalmem, cpus } from 'node:os';
import { WAN_TILED_DECODE_CANDIDATE, DECODE_OPERATION, buildWanDecodeWorkflow, validateOwnedLatentSource, inspectRegisteredDecodeRuntime, stageOwnedLatent, hashFile } from '../runtime/decode-profiles.mjs';
import { executeWanStage, WAN_MODELS } from '../runtime/neural-production.mjs';
import { createComfyUIProvider } from '../runtime/providers/comfyui.mjs';
import { acquireGpuLease } from '../runtime/inference-harness.mjs';
import { verifyMedia } from '../runtime/media-verifier.mjs';
import { hashJson } from '../runtime/generation-gate.mjs';

const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return i<0?[a.slice(2),true]:[a.slice(2,i),a.slice(i+1)];}));
const allowed=new Set(['source-job','data-dir','runtime-dir','operation-id','execute','include-standard','queue-policy','verify-comparison-only']);
if(Object.keys(args).some(k=>!allowed.has(k)))throw new Error('Unknown benchmark argument');
if(args.execute&&args['verify-comparison-only'])throw new Error('CPU comparison verification cannot also execute a decode');
if(!args['source-job'])throw new Error('Pass --source-job=<completed VYREALM job UUID>. Default is preflight only; --execute explicitly permits decode.');
const accountRoot=process.env.APPDATA||join(homedir(),'.local','state');
const dataDir=resolve(args['data-dir']||process.env.VYRELUM_DATA_DIR||join(accountRoot,'vyrelum','data'));
const runtimeDir=resolve(args['runtime-dir']||process.env.VYRELUM_RUNTIME_DIR||join(accountRoot,'vyrelum','runtime'));
const operationId=args['operation-id']||randomUUID();
if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operationId))throw new Error('Invalid operation UUID');
const root=resolve('.'),runDir=join(root,'outputs','benchmarks','latent-decode',operationId),queuePolicy=args['queue-policy']||'fifo';
if(!['idle','fifo'].includes(queuePolicy))throw new Error('Use queue-policy=idle or fifo');
const ffmpeg=join(root,'workers/tools/ffmpeg.exe'),ffprobe=join(root,'workers/tools/ffprobe.exe'),provider=createComfyUIProvider();
const startedAt=new Date().toISOString(),exec=promisify(execFile);
await mkdir(runDir,{recursive:true});
const append=async(type,data={})=>appendFile(join(runDir,'benchmark.jsonl'),JSON.stringify({at:new Date().toISOString(),type,...data})+'\n');
async function save(name,value){await writeFile(join(runDir,name),JSON.stringify(value,null,2));}
async function run(args,logName,{cwd=runDir,timeout=300000}={}){
  const result=await exec(ffmpeg,['-threads','2','-filter_threads','2','-filter_complex_threads','2',...args],{cwd,windowsHide:true,timeout,maxBuffer:6_000_000});await appendFile(join(runDir,logName),result.stderr);return result;
}
async function nodeInfo(name){const response=await provider.fetch(`${provider.baseUrl}/object_info/${name}`,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw new Error(`NODE_PREFLIGHT_FAILED:${name}`);return (await response.json())[name];}
async function preflightNodes(){const names=['LoadLatent','VAELoader','VAEDecode','VAEDecodeTiled','SaveImage'],entries=await Promise.all(names.map(async name=>[name,await nodeInfo(name)]));const nodes=Object.fromEntries(entries);if(entries.some(([,node])=>!node))throw new Error('DECODE_NODE_MISSING');const fields=nodes.VAEDecodeTiled.input.required;for(const field of ['tile_size','overlap','temporal_size','temporal_overlap']){const v=WAN_TILED_DECODE_CANDIDATE[field],rule=fields[field]?.[1];if(!rule||v<rule.min||v>rule.max||(v-rule.min)%rule.step!==0)throw new Error(`DECODE_NODE_SCHEMA_CHANGED:${field}`);}if(!nodes.VAELoader.input.required.vae_name[0].includes(WAN_MODELS.vae))throw new Error('WAN_VAE_UNAVAILABLE');return nodes;}
async function stageMetrics(){let peakVramGb=null,minimumFreeRam=freemem(),busy=false;
  const sample=async()=>{if(busy)return;busy=true;minimumFreeRam=Math.min(minimumFreeRam,freemem());try{const r=await exec('nvidia-smi',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{windowsHide:true,timeout:3000});const value=Number(r.stdout.trim().split('\n')[0])/1024;if(Number.isFinite(value))peakVramGb=Math.max(peakVramGb||0,value);}catch{}finally{busy=false;}};
  await sample();const timer=setInterval(()=>void sample(),2000);return async()=>{clearInterval(timer);await sample();return {systemGpuMemoryPeakGb:peakVramGb,minimumSystemFreeRamGb:minimumFreeRam/1024**3,scope:'system-wide during queued decode and frame retrieval; not isolated model allocation'};};
}
async function executeDecode({source,latent,namespace,folder,standard,deadline}){
  const workflow=buildWanDecodeWorkflow({latentName:latent.name,prefix:`vyrealm/${namespace}/decode`,standard});
  const stageStarted=Date.now(),finishMetrics=await stageMetrics();let stage;
  try{const remaining=deadline-Date.now();if(remaining<1)throw new Error('DECODE_BENCHMARK_TIMEOUT');stage=await executeWanStage({provider,jobRoot:join(runDir,folder),stage:'decode',workflow,frames:source.frames,width:source.width,height:source.height,requiredModels:[WAN_MODELS.vae],waitForIdle:true,queuePolicy,timeoutMs:remaining,onProgress:value=>{void append(`${folder}_progress`,value);console.log(JSON.stringify({operation:DECODE_OPERATION,profile:folder,...value}));}});}
  finally{await save(`${folder}-resources.json`,await finishMetrics());}
  const history=JSON.parse(await readFile(stage.historyPath,'utf8')),messages=history.status?.messages||[],timeOf=event=>messages.find(m=>m[0]===event)?.[1]?.timestamp;
  const start=timeOf('execution_start'),end=timeOf('execution_success');
  return {stage,workflow,promptId:stage.promptId,workflowHash:hashJson(workflow),timing:{wallMs:Date.now()-stageStarted,providerExecutionMs:Number.isFinite(start)&&Number.isFinite(end)?end-start:null,scope:stage.recovered?'cached retained decode; no new invocation':'wall includes queue/load/decode/frame retrieval; provider time excludes FIFO wait'}};
}
function parseMetricFile(text,key){const values=[...text.matchAll(new RegExp(`(?:^|\\s)${key}:([\\d.+-]+|inf)`,'gm'))].map(m=>m[1]==='inf'?Infinity:Number(m[1])).filter(n=>!Number.isNaN(n));return {frames:values.length,mean:values.length?(values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0)/values.length:'infinite'):null,min:values.length?(Number.isFinite(Math.min(...values))?Math.min(...values):'infinite'):null};}
async function compareFrames(reference,candidate){
  for(const metric of ['ssim','psnr'])await run(['-hide_banner','-framerate','24','-i',join(reference,'frames','%05d.png'),'-framerate','24','-i',join(candidate,'frames','%05d.png'),'-filter_complex',`[0:v]format=yuv444p,setpts=PTS-STARTPTS[r];[1:v]format=yuv444p,setpts=PTS-STARTPTS[c];[r][c]${metric}=stats_file=${metric}.log`,'-frames:v','121','-f','null','-'],`${metric}-command.log`);
  const temporal={};
  for(const [label,directory] of [['standard',reference],['tiled',candidate]]){
    await run(['-hide_banner','-framerate','24','-i',join(directory,'frames','%05d.png'),'-vf',`tblend=all_mode=difference,signalstats,metadata=print:file=temporal-${label}.log`,'-frames:v','120','-f','null','-'],`temporal-${label}-command.log`);
    const text=await readFile(join(runDir,`temporal-${label}.log`),'utf8'),values=[...text.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map(m=>Number(m[1]));temporal[label]={frames:values.length,meanFrameDifference:values.length?values.reduce((a,b)=>a+b)/values.length:null,maxFrameDifference:values.length?Math.max(...values):null};
    await run(['-y','-v','error','-filter_threads','2','-framerate','24','-i',join(directory,'frames','%05d.png'),'-vf','select=not(mod(n\\,30)),scale=256:144,tile=5x1','-frames:v','1',`${label}-contact-sheet.png`],`${label}-contact.log`);
  }
  await run(['-y','-v','error','-i','standard-contact-sheet.png','-i','tiled-contact-sheet.png','-filter_complex','[0:v][1:v]vstack=inputs=2','-frames:v','1','comparison-contact-sheet.png'],'contact-sheet.log');
  const metrics={ssim:parseMetricFile(await readFile(join(runDir,'ssim.log'),'utf8'),'All'),psnr:parseMetricFile(await readFile(join(runDir,'psnr.log'),'utf8'),'psnr_avg'),temporal,contactSheet:'comparison-contact-sheet.png',contactSheetRows:['retained standard decode','candidate tiled decode'],semanticReview:'required',qualification:'unqualified'};
  if(metrics.ssim.frames!==121||metrics.psnr.frames!==121||temporal.standard.frames!==120||temporal.tiled.frames!==120)throw new Error('METRIC_FRAME_COUNT_MISMATCH');return metrics;
}
async function encodeDecodedClip(directory,source,name='decoded-source.mp4'){
  await run(['-y','-framerate','24','-i',join(directory,'frames','%05d.png'),'-frames:v','120','-c:v','libx264','-threads','2','-profile:v','high','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',name],`${name}-encode.log`);
  const videoPath=join(runDir,name);
  const verification=await verifyMedia({videoPath,ffmpeg,ffprobe,expected:{width:source.width,height:source.height,fps:24,durationSeconds:5,requireVisual:true}});
  if(!verification.ok)throw new Error(`DECODE_VIDEO_REJECTED:${verification.diagnostics.map(d=>d.message).join(';')}`);
  const probe=JSON.parse((await exec(ffprobe,['-v','error','-count_frames','-show_streams','-of','json',videoPath],{windowsHide:true,timeout:60000,maxBuffer:1_000_000})).stdout),video=probe.streams?.find(s=>s.codec_type==='video');
  if(Number(video?.nb_read_frames)!==120)throw new Error('DECODE_VIDEO_FRAME_COUNT_MISMATCH');
  await run(['-v','error','-xerror','-i',name,'-f','null','-'],`${name}-decode-check.log`);
  return {...verification,decodedFrameCount:120};
}

let releaseLease;
try{
  await append('preflight_started',{operationId,sourceJobId:args['source-job'],samplerInvoked:false});
  const source=await validateOwnedLatentSource({dataDir,sourceJobId:args['source-job']}),runtime=await inspectRegisteredDecodeRuntime({runtimeDir}),nodes=await preflightNodes();
  const identity=hashJson({sourceJobId:source.sourceJobId,latentHash:source.latentHash,sourceWorkflowHash:source.workflowHash,profile:WAN_TILED_DECODE_CANDIDATE,includeStandard:args['include-standard']===true,adapterVersion:1});
  let checkpoint;try{checkpoint=JSON.parse(await readFile(join(runDir,'checkpoint.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(checkpoint&&checkpoint.identity!==identity)throw new Error('BENCHMARK_INPUT_CHANGED');
  if(!checkpoint){checkpoint={schemaVersion:1,identity,operationId,standardNamespace:randomUUID(),startedAt};await writeFile(join(runDir,'checkpoint.json'),JSON.stringify(checkpoint,null,2),{flag:'wx'});}
  const planned={schemaVersion:1,status:'preflight-only',operation:DECODE_OPERATION,operationId,samplerInvoked:false,newFilmGenerated:false,profile:WAN_TILED_DECODE_CANDIDATE,source,runtime,nodeSchemaHash:hashJson(nodes),queuePolicy,hardware:{platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,totalRamGb:totalmem()/1024**3},qualification:'unqualified'};
  await save('preflight.json',planned);await append('preflight_passed',{sourceJobId:source.sourceJobId,latentHash:source.latentHash,profile:WAN_TILED_DECODE_CANDIDATE.id});
  if(args['verify-comparison-only']===true){const comparison=await compareFrames(source.stageRoot,source.stageRoot);comparison.contactSheetRows=['retained standard decode','same retained standard decode; CPU harness test only'];const videoVerification=await encodeDecodedClip(source.stageRoot,source,'cpu-reference-copy.mp4');await save('cpu-comparison-verification.json',{status:'cpu-comparison-verified',comparedSourceToItself:true,samplerInvoked:false,decodeInvoked:false,qualification:'unqualified',comparison,videoVerification,video:'cpu-reference-copy.mp4'});console.log(JSON.stringify({status:'cpu-comparison-verified',runDir,comparedSourceToItself:true,qualification:'unqualified'}));}
  else if(args.execute!==true){console.log(JSON.stringify({status:'preflight-only',runDir,operationId,latentHash:source.latentHash,profile:WAN_TILED_DECODE_CANDIDATE.id,qualification:'unqualified',executeCommand:`node scripts/benchmark-latent-decode.mjs --source-job=${source.sourceJobId} --operation-id=${operationId} --execute${args['include-standard']?' --include-standard':''}`},null,2));}
  else{
    releaseLease=await acquireGpuLease(`decode-benchmark:${operationId}`);
    if(await hashFile(runtime.vae.path)!==runtime.vae.sha256)throw new Error('WAN_VAE_HASH_MISMATCH');
    // Recheck source ownership under the GPU lease immediately before staging.
    const checked=await validateOwnedLatentSource({dataDir,sourceJobId:source.sourceJobId});if(checked.latentHash!==source.latentHash)throw new Error('SOURCE_CHANGED_SINCE_PREFLIGHT');
    const latent=await stageOwnedLatent({source:checked,runtime,operationId});await save('input-staging.json',latent);
    const inputNode=await nodeInfo('LoadLatent');if(!inputNode.input.required.latent[0].includes(latent.name))throw new Error('STAGED_LATENT_NOT_VISIBLE_TO_PROVIDER');
    const deadline=Date.now()+7200000;
    let standard=null;if(args['include-standard']===true)standard=await executeDecode({source,latent,namespace:checkpoint.standardNamespace,folder:'standard',standard:true,deadline});
    const candidate=await executeDecode({source,latent,namespace:operationId,folder:'candidate',standard:false,deadline});
    await releaseLease();releaseLease=null;
    const verification=await encodeDecodedClip(candidate.stage.stageRoot,source);
    const comparison=await compareFrames(standard?.stage.stageRoot||source.stageRoot,candidate.stage.stageRoot);
    const report={...planned,status:'review_required',operation:DECODE_OPERATION,samplerInvoked:false,newFilmGenerated:false,input:latent,candidate:{promptId:candidate.promptId,workflowHash:candidate.workflowHash,timing:candidate.timing,providerLog:'candidate/decode/provider.jsonl',resources:JSON.parse(await readFile(join(runDir,'candidate-resources.json'),'utf8'))},standard:standard?{promptId:standard.promptId,workflowHash:standard.workflowHash,timing:standard.timing,providerLog:'standard/decode/provider.jsonl',resources:JSON.parse(await readFile(join(runDir,'standard-resources.json'),'utf8'))}:{method:'retained original standard frames',isolatedDecodeTimingAvailable:false},outputs:{video:'decoded-source.mp4',sha256:await hashFile(join(runDir,'decoded-source.mp4')),contactSheet:comparison.contactSheet},verification,comparison,qualification:'unqualified',reviewRequired:['spatial tile seams','temporal flicker and motion continuity','face/material detail','actual speed and memory against an isolated standard decode'],completedAt:new Date().toISOString()};
    await save('result.json',report);await append('decode_benchmark_ready_for_review',{outputHash:report.outputs.sha256,promptId:candidate.promptId,qualification:'unqualified'});console.log(JSON.stringify({status:report.status,operation:DECODE_OPERATION,runDir,qualification:'unqualified'},null,2));
  }
}catch(error){await save('failure.json',{status:'failed',operation:DECODE_OPERATION,code:error.code||error.message,samplerInvoked:false,qualification:'unqualified',at:new Date().toISOString()});await append('benchmark_failed',{code:error.code||error.message});console.error(error.code||error.message);process.exitCode=1;}
finally{if(releaseLease)await releaseLease();}
