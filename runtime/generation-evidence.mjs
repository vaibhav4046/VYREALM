import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, isAbsolute, resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const sha = b=>createHash('sha256').update(b).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code});

// Evidence is an audit of this local job, not a cryptographic attestation of a
// potentially compromised host. It prevents accidental import/upscale promotion.
export async function verifyGenerationEvidence(o){
  try{
    const base=await realpath(o.jobRoot);
    const owned=async path=>{
      if(!path)throw fail('PROVIDER_EVIDENCE_MISSING','Provider evidence is missing');
      const absolute=await realpath(resolve(path)), rel=relative(base,absolute);
      if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw fail('GENERATED_OUTPUT_OUTSIDE_JOB','Provider files must resolve inside this job');
      return absolute;
    };
    await owned(o.outputPath);
    const e=o.providerEvidence;
    if(o.providerId!=='comfyui-local'||!e?.promptId||!e.logPath||!e.historyPath||!e.framesPath)throw fail('PROVIDER_EVIDENCE_MISSING','A local provider prompt, history, log and frame ledger are required');
    const history=JSON.parse(await readFile(await owned(e.historyPath),'utf8'));
    const logs=(await readFile(await owned(e.logPath),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
    const ledger=JSON.parse(await readFile(await owned(e.framesPath),'utf8'));
    const workflow=JSON.parse(await readFile(await owned(join(e.stageRoot,'workflow.json')),'utf8'));
    const hash=o.hashJson(workflow);
    if(hash!==o.hashJson(o.workflow)||history.prompt?.[1]!==e.promptId||o.hashJson(history.prompt?.[2])!==hash)throw fail('PROVIDER_WORKFLOW_MISMATCH','Provider history must match the full submitted graph');
    if(history.status?.completed!==true||history.status?.status_str!=='success')throw fail('PROVIDER_EXECUTION_UNCONFIRMED','Provider did not report successful execution');
    for(const event of ['submitted','completed'])if(!logs.some(l=>l.event===event&&l.promptId===e.promptId&&l.workflowHash===hash))throw fail('PROVIDER_LOG_MISSING',`Missing matching ${event} provider log`);
    const sampler=workflow['8'], model=workflow['1'];
    if(model?.class_type!=='UnetLoaderGGUF'||model.inputs?.unet_name!==o.modelId||sampler?.class_type!=='KSampler'||Number(sampler.inputs?.seed)!==Number(o.seed)||workflow['5']?.inputs?.text!==o.prompt||workflow['10']?.class_type!=='SaveImage')throw fail('MODEL_INVOCATION_MISMATCH','The recorded model, seed and prompt must match the actual sampler graph');
    if(JSON.stringify(sampler.inputs.model)!=='["4",0]'||JSON.stringify(workflow['4']?.inputs?.model)!=='["1",0]'||JSON.stringify(workflow['9']?.inputs?.samples)!=='["8",0]'||JSON.stringify(workflow['10']?.inputs?.images)!=='["9",0]')throw fail('MODEL_OUTPUT_DISCONNECTED','Saved frames must come from the model sampler and VAE');
    const expectedFrames=Math.round(Number(o.durationSeconds)*Number(o.fps));
    if(!Number.isSafeInteger(expectedFrames)||expectedFrames<2||!Array.isArray(ledger)||ledger.length<expectedFrames||ledger.length>expectedFrames+1)throw fail('PROVIDER_FRAME_COUNT','Recorded frame count does not match the requested video');
    const descriptors=history.outputs?.['10']?.images||[];
    if(descriptors.length!==ledger.length)throw fail('PROVIDER_FRAME_COUNT','History and ledger frame counts differ');
    for(let i=0;i<ledger.length;i++){
      const frame=ledger[i],descriptor=descriptors[i];
      const providerPath=`${descriptor.subfolder}/${descriptor.filename}`.replaceAll('\\','/');
      if(frame.index!==i||o.hashJson(frame.providerOutput)!==o.hashJson(descriptor)||descriptor.type!=='output'||!providerPath.startsWith(`${workflow['10'].inputs.filename_prefix}_`))throw fail('PROVIDER_OUTPUT_OWNERSHIP','Frame descriptor is not owned by this provider prompt');
      const bytes=await readFile(await owned(join(e.stageRoot,frame.path)));
      if(bytes.length<128||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||sha(bytes)!==frame.sha256)throw fail('GENERATED_FRAME_HASH_MISMATCH','A generated frame is missing or has changed');
    }
    if(!o.ffmpeg||!o.ffprobe)throw fail('GENERATED_CLIP_DECODE_REQUIRED','FFmpeg and FFprobe are required to verify generated media');
    const {stdout}=await exec(o.ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',o.outputPath],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});
    const probe=JSON.parse(stdout),v=probe.streams?.find(s=>s.codec_type==='video');
    if(!v||v.width!==o.width||v.height!==o.height||Number(v.nb_read_frames)!==expectedFrames||Math.abs(Number(v.duration||probe.format?.duration)-o.durationSeconds)>0.1)throw fail('GENERATED_CLIP_MISMATCH','The decoded video does not match the requested size, duration and frame count');
    const [n,d]=String(v.avg_frame_rate||'0/1').split('/').map(Number);
    if(Math.abs(n/d-o.fps)>0.01)throw fail('GENERATED_CLIP_MISMATCH','Generated clip frame rate is incorrect');
    await exec(o.ffmpeg,['-v','error','-xerror','-i',o.outputPath,'-f','null','-'],{windowsHide:true,timeout:60000,maxBuffer:1024*1024});
    const lineage=[];
    for(const index of [...new Set([0,Math.floor(expectedFrames/2),expectedFrames-1])]){
      // Decode the delivered source frame and its provider PNG into the same
      // RGB color space; lossy H.264 is allowed, an unrelated copied clip isn't.
      const common={windowsHide:true,timeout:60000,maxBuffer:16*1024*1024,encoding:'buffer'};
      const video=await exec(o.ffmpeg,['-v','error','-i',o.outputPath,'-vf',`select=eq(n\\,${index})`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],common);
      const png=await exec(o.ffmpeg,['-v','error','-i',join(e.stageRoot,ledger[index].path),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],common);
      if(video.stdout.length!==png.stdout.length||!png.stdout.length)throw fail('GENERATED_CLIP_LINEAGE_MISMATCH','Source clip dimensions differ from provider frames');
      let squareError=0;for(let i=0;i<png.stdout.length;i++)squareError+=(png.stdout[i]-video.stdout[i])**2;
      const rmse=Math.sqrt(squareError/png.stdout.length);
      if(rmse>16)throw fail('GENERATED_CLIP_LINEAGE_MISMATCH',`Decoded frame ${index} does not match its provider source (RGB RMSE ${rmse.toFixed(2)})`);
      lineage.push({index,rgbRmse:Number(rmse.toFixed(4)),threshold:16});
    }
    return {ok:true,frameCount:expectedFrames,lineage,evidenceHash:o.hashJson({promptId:e.promptId,workflowHash:hash,frames:ledger.map(f=>f.sha256),output:sha(await readFile(o.outputPath))})};
  }catch(error){return {ok:false,code:error.code||'GENERATED_EVIDENCE_INVALID',message:error.message};}
}
