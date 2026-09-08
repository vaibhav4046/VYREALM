import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, copyFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashJson } from './generation-gate.mjs';
import { WAN_MODELS } from './neural-production.mjs';

/** @typedef {{id:string,qualification:'unqualified',tile_size:number,overlap:number,temporal_size:number,temporal_overlap:number}} DecodeProfile */
export const WAN_TILED_DECODE_CANDIDATE = Object.freeze({ id:'wan22-vae-tiled-256-t128', qualification:'unqualified', tile_size:256, overlap:64, temporal_size:128, temporal_overlap:8 });
export const DECODE_OPERATION = 'decoded-from-prior-latent';
export const PINNED_COMFY_COMMIT='fbed745c8d7d62573b099cd61fe51cb64b9b807e';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const json=async path=>JSON.parse(await readFile(path,'utf8'));
export const hashFile=path=>new Promise((ok,bad)=>{const h=createHash('sha256'),s=createReadStream(path);s.on('data',b=>h.update(b));s.on('error',bad);s.on('end',()=>ok(h.digest('hex')));});
export function within(directory,path) {const rel=relative(resolve(directory),resolve(path));return Boolean(rel)&&rel!=='..'&&!rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`)&&!isAbsolute(rel);}
async function ownedPath(directory,path) {const root=await realpath(directory),target=await realpath(path);if(!within(root,target))fail('SOURCE_PATH_ESCAPE',`Retained evidence must remain inside its canonical directory: ${target} outside ${root}`);return target;}
function equal(a,b,code) {if(hashJson(a)!==hashJson(b))fail(code,'Retained source evidence does not match its owner');}

export function buildWanDecodeWorkflow({latentName,prefix,profile=WAN_TILED_DECODE_CANDIDATE,standard=false}) {
  if(!/^vyrealm-decode-[a-f0-9-]+\.latent$/i.test(latentName||'')||!/^vyrealm\/[a-f0-9-]+\/decode$/.test(prefix||''))fail('DECODE_NAMESPACE_INVALID','Decode inputs and outputs require a job namespace');
  if(!standard)equal(profile,WAN_TILED_DECODE_CANDIDATE,'DECODE_PROFILE_UNREVIEWED');
  return {
    '3':{class_type:'VAELoader',inputs:{vae_name:WAN_MODELS.vae}},
    '7':{class_type:'LoadLatent',inputs:{latent:latentName}},
    '9':{class_type:standard?'VAEDecode':'VAEDecodeTiled',inputs:{samples:['7',0],vae:['3',0],...(!standard?{tile_size:profile.tile_size,overlap:profile.overlap,temporal_size:profile.temporal_size,temporal_overlap:profile.temporal_overlap}:{})}},
    '10':{class_type:'SaveImage',inputs:{images:['9',0],filename_prefix:prefix}},
  };
}

export function inspectLatentHeader(bytes,{width,height,frames,workflowHash}) {
  if(bytes.length<16)fail('LATENT_FORMAT_INVALID','Latent checkpoint is truncated');
  const headerLength=Number(bytes.readBigUInt64LE(0));
  if(!Number.isSafeInteger(headerLength)||headerLength<2||headerLength>1024*1024||headerLength+8>bytes.length)fail('LATENT_FORMAT_INVALID','Invalid safetensors header length');
  let header;try{header=JSON.parse(bytes.subarray(8,8+headerLength).toString('utf8'));}catch{fail('LATENT_FORMAT_INVALID','Invalid safetensors header');}
  const tensor=header.latent_tensor;
  if(!header.latent_format_version_0||!tensor||tensor.dtype!=='F32')fail('LATENT_FORMAT_UNSUPPORTED','A versioned Wan float32 latent is required; implicit legacy rescaling is forbidden');
  equal(tensor.shape,[1,48,(frames+3)/4,height/16,width/16],'LATENT_SHAPE_MISMATCH');
  if(!Array.isArray(tensor.data_offsets)||tensor.data_offsets[0]<0||tensor.data_offsets[1]-tensor.data_offsets[0]!==tensor.shape.reduce((a,b)=>a*b,4)||8+headerLength+tensor.data_offsets[1]>bytes.length)fail('LATENT_TENSOR_TRUNCATED','Latent tensor offsets do not match its data');
  let prompt;try{prompt=JSON.parse(header.__metadata__?.prompt);}catch{fail('LATENT_PROMPT_MISSING','Latent checkpoint must retain the original workflow metadata');}
  if(hashJson(prompt)!==workflowHash)fail('LATENT_PROMPT_MISMATCH','Latent metadata differs from the recorded sampler workflow');
  return {dtype:tensor.dtype,shape:tensor.shape,headerBytes:headerLength,version:'latent_format_version_0'};
}

/** Reads only the existing canonical store and verifies each retained source byte. */
export async function validateOwnedLatentSource({dataDir,sourceJobId}) {
  if(!uuid.test(sourceJobId||''))fail('SOURCE_JOB_ID_INVALID','An existing VYREALM job UUID is required');
  // Windows packaged hosts may virtualize Roaming files without marking their
  // parent directory as a junction. Anchor both jobs and evidence to the actual
  // existing SQLite file, not a mixture of virtual and physical directory roots.
  const databasePath=await realpath(join(dataDir,'vyrelum.sqlite'));
  const canonicalData=dirname(databasePath),jobsRoot=await ownedPath(canonicalData,join(canonicalData,'jobs'));
  const jobRoot=await ownedPath(jobsRoot,join(jobsRoot,sourceJobId));
  const db=new DatabaseSync(databasePath,{readOnly:true});
  let job;try{job=db.prepare('SELECT * FROM jobs WHERE id=?').get(sourceJobId);}finally{db.close();}
  if(!job||!['generation-test','generation-shot'].includes(job.type)||!['succeeded','review_required'].includes(job.status))fail('SOURCE_JOB_NOT_COMPLETED','Source must be a completed canonical neural generation job');
  const result=await json(await ownedPath(jobRoot,join(jobRoot,'result.json'))),stored=JSON.parse(job.output||'null');
  if(result.validated!==true||result.provenance?.status!=='generated'||result.provenance?.generationStatus!=='generated'||result.provenance?.providerId!=='comfyui-local'||result.provenance?.modelId!==WAN_MODELS.diffusion)fail('SOURCE_NOT_GENERATED','Imported, fallback, failed or unfinished media cannot supply this benchmark');
  const fields=['providerId','modelId','providerPromptId','workflowHash','outputHash','resolution','fps','durationSeconds'];
  for(const key of fields)equal(result.provenance[key],stored?.provenance?.[key],'SOURCE_DATABASE_MISMATCH');
  const {width,height}=result.provenance.resolution||{},frames=121;
  if(width!==1024||height!==576||result.provenance.fps!==24||result.durationSeconds!==5||result.outputs?.sourceVideo!=='generated-source.mp4')fail('SOURCE_PROFILE_UNSUPPORTED','This opt-in Wan benchmark requires a 1024×576, 121-frame latent and five-second 24fps source');
  const checkpoint=await json(await ownedPath(jobRoot,join(jobRoot,'generation-checkpoint.json'))),stageRoot=await ownedPath(jobRoot,join(jobRoot,'motion'));
  if(!/^vyrealm\/[a-f0-9-]{36}$/.test(checkpoint.namespace||''))fail('SOURCE_NAMESPACE_INVALID','Source generation namespace is invalid');
  const workflow=await json(await ownedPath(stageRoot,join(stageRoot,'workflow.json'))),workflowHash=hashJson(workflow);
  if(workflowHash!==result.provenance.workflowHash||workflow['8']?.class_type!=='KSampler'||workflow['9']?.class_type!=='VAEDecode'||workflow['3']?.inputs?.vae_name!==WAN_MODELS.vae||workflow['10']?.inputs?.filename_prefix!==`${checkpoint.namespace}/motion`||workflow['12']?.class_type!=='SaveLatent')fail('SOURCE_WORKFLOW_MISMATCH','Source must contain the owned original sampler, standard VAE decode, frames and latent save');
  const history=await json(await ownedPath(stageRoot,join(stageRoot,'history.json'))),promptId=result.provenance.providerPromptId;
  if(!history.status?.completed||history.status.status_str!=='success'||history.prompt?.[1]!==promptId||hashJson(history.prompt?.[2])!==workflowHash)fail('SOURCE_HISTORY_INCOMPLETE','Successful owned provider history is required');
  const events=(await readFile(await ownedPath(stageRoot,join(stageRoot,'provider.jsonl')),'utf8')).trim().split('\n').map(JSON.parse);
  if(!['submitted','completed'].every(event=>events.some(e=>e.event===event&&e.promptId===promptId&&e.workflowHash===workflowHash)))fail('SOURCE_LOG_INCOMPLETE','Both submission and completion evidence are required');
  const ledger=await json(await ownedPath(stageRoot,join(stageRoot,'frames.json'))),descriptors=history.outputs?.['10']?.images;
  if(!Array.isArray(ledger)||ledger.length!==frames||descriptors?.length!==frames)fail('SOURCE_FRAMES_INCOMPLETE','The complete 121-frame standard decode is required');
  for(let i=0;i<frames;i++){
    const entry=ledger[i],descriptor=descriptors[i],providerPath=`${descriptor.subfolder}/${descriptor.filename}`.replaceAll('\\','/');
    if(entry.index!==i||entry.path!==`frames/${String(i).padStart(5,'0')}.png`||descriptor.type!=='output'||providerPath.split('/').includes('..')||!providerPath.startsWith(`${checkpoint.namespace}/motion_`))fail('SOURCE_FRAME_OWNERSHIP','Source frame is outside its original job');
    equal(entry.providerOutput,descriptor,'SOURCE_FRAME_DESCRIPTOR_MISMATCH');
    if(await hashFile(await ownedPath(stageRoot,join(stageRoot,entry.path)))!==entry.sha256)fail('SOURCE_FRAME_CHANGED','A retained standard frame has changed');
  }
  const latents=await json(await ownedPath(stageRoot,join(stageRoot,'latents.json'))),latentDescriptors=history.outputs?.['12']?.latents;
  if(latents.length!==1||latentDescriptors?.length!==1||latents[0].path!=='generated.latent')fail('SOURCE_LATENT_MISSING','Exactly one owned latent checkpoint is required');
  equal(latents[0].providerOutput,latentDescriptors[0],'SOURCE_LATENT_DESCRIPTOR_MISMATCH');
  const desc=latentDescriptors[0],providerLatent=`${desc.subfolder}/${desc.filename}`.replaceAll('\\','/');
  if(desc.type!=='output'||!providerLatent.startsWith(`${checkpoint.namespace}/motion_latent_`)||providerLatent.split('/').includes('..'))fail('SOURCE_LATENT_OWNERSHIP','Latent descriptor is outside this generation');
  const latentPath=await ownedPath(stageRoot,join(stageRoot,'generated.latent'));
  if((await stat(latentPath)).size>128*1024*1024)fail('LATENT_TOO_LARGE','Latent exceeds the bounded benchmark profile');
  const bytes=await readFile(latentPath),latentHash=sha(bytes);
  if(latentHash!==latents[0].sha256)fail('SOURCE_LATENT_CHANGED','Retained latent bytes do not match their ledger');
  const tensor=inspectLatentHeader(bytes,{width,height,frames,workflowHash});
  const sourceVideo=await ownedPath(jobRoot,join(jobRoot,'generated-source.mp4'));
  if(await hashFile(sourceVideo)!==result.provenance.outputHash)fail('SOURCE_VIDEO_CHANGED','Standard source MP4 no longer matches generation provenance');
  return {sourceJobId,projectId:job.project_id,jobRoot,stageRoot,sourceVideo,sourceVideoHash:result.provenance.outputHash,latentPath,latentHash,latentBytes:bytes.length,tensor,frames,width,height,fps:24,durationSeconds:5,providerPromptId:promptId,workflowHash,namespace:checkpoint.namespace,resultHash:await hashFile(join(jobRoot,'result.json')),standardTiming:{scope:'whole-original-generation-not-isolated-decode',renderTimeMs:result.provenance.renderTimeMs,vramPeakGb:result.provenance.vramPeakGb},evidenceHashes:{history:await hashFile(join(stageRoot,'history.json')),providerLog:await hashFile(join(stageRoot,'provider.jsonl')),frameLedger:await hashFile(join(stageRoot,'frames.json')),latentLedger:await hashFile(join(stageRoot,'latents.json'))}};
}

export async function inspectRegisteredDecodeRuntime({runtimeDir}) {
  const config=await json(join(runtimeDir,'comfyui.json'));
  if(config.schemaVersion!==1||!config.enabled||!isAbsolute(config.root||''))fail('COMFY_RUNTIME_UNREGISTERED','A registered local ComfyUI runtime is required');
  const root=await realpath(config.root),inventory=await json(await ownedPath(root,join(root,'installation.json')));
  if(inventory.manifest?.comfyui?.commit!==PINNED_COMFY_COMMIT)fail('COMFY_RUNTIME_PIN_CHANGED','Benchmark needs the inspected ComfyUI version');
  const nodes=inventory.code?.find(item=>item.path.replaceAll('\\','/')==='ComfyUI/nodes.py');
  if(!nodes||await hashFile(await ownedPath(root,join(root,nodes.path)))!==nodes.sha256)fail('COMFY_DECODE_CODE_CHANGED','Installed decode node source differs from the pinned inventory');
  const inputDirectory=await ownedPath(root,join(root,'ComfyUI','input'));
  const vae=inventory.models?.find(item=>item.path.replaceAll('\\','/').endsWith(`/vae/${WAN_MODELS.vae}`));
  if(!vae)fail('WAN_VAE_NOT_REGISTERED','Wan VAE is missing from the installation inventory');
  const vaePath=await ownedPath(root,join(root,vae.path)),vaeStat=await stat(vaePath);
  if(vaeStat.size!==vae.bytes||Math.abs(vaeStat.mtimeMs-vae.mtimeMs)>2)fail('WAN_VAE_CHANGED','Registered Wan VAE changed; repair before benchmarking');
  return {root,inputDirectory,commit:PINNED_COMFY_COMMIT,nodesSha256:nodes.sha256,vae:{name:WAN_MODELS.vae,path:vaePath,sha256:vae.sha256,bytes:vae.bytes}};
}

// Core LoadLatent scans input-root .latent basenames, not subdirectories.
// Its basename still carries the unique operation UUID; existing files are never overwritten.
export async function stageOwnedLatent({source,runtime,operationId}) {
  if(!uuid.test(operationId||''))fail('DECODE_OPERATION_ID_INVALID','Benchmark operation requires a UUID');
  if(await hashFile(source.latentPath)!==source.latentHash)fail('SOURCE_LATENT_CHANGED','Latent changed before input staging');
  const name=`vyrealm-decode-${operationId}.latent`,path=join(runtime.inputDirectory,name);
  try{await copyFile(source.latentPath,path,1);}catch(error){if(error.code!=='EEXIST')throw error;}
  const staged=await ownedPath(runtime.inputDirectory,path);
  if(await hashFile(staged)!==source.latentHash)fail('DECODE_INPUT_COLLISION','Provider input differs from the exact retained latent');
  return {name,path:staged,sha256:source.latentHash,sourceJobId:source.sourceJobId,operation:DECODE_OPERATION};
}
