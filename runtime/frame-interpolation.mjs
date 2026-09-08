import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, copyFile, stat, statfs, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fileSha256 } from './verified-download.mjs';
import { verifyMedia } from './media-verifier.mjs';

const app=fileURLToPath(new URL('..',import.meta.url));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const configuredRuntime=()=>process.env.VYRELUM_RUNTIME_DIR||resolve('data/runtime');
export function renderInputIdentity(document){return digest(Object.fromEntries(['timeline','settings','soundtrack','audioTracks','transcript','captionsEnabled'].map(key=>[key,document?.[key]??null])));}
export function captionBoundaryFrames(srt,fps,frames){
  const time=value=>{const [h,m,s]=value.replace(',','.').split(':').map(Number);return h*3600+m*60+s;};
  return [...new Set([...String(srt).matchAll(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/g)].flatMap(m=>[m[1],m[2]]).map(t=>Math.ceil(time(t)*fps-1e-8)).filter(n=>n>0&&n<frames))];
}
export function protectedCaptionSamples(segment,fps,boundaries){
  const protectedPairs=new Set(boundaries.map(n=>n-1-segment.start));
  return Array.from({length:segment.targetFrames},(_,index)=>({index,position:index*fps/60})).filter(s=>!Number.isInteger(s.position)&&protectedPairs.has(Math.floor(s.position))).map(s=>({outputFrame:s.index+1,sourceFrame:Math.floor(s.position)}));
}

export function validateInterpolationSource(receipt){
  if(receipt?.review?.verdict!=='passed')throw new Error('REVIEWED_SOURCE_REQUIRED: Review the export before interpolating it');
  const provenance=receipt?.provenance;
  if(!['generated','edited','imported','upscaled'].includes(provenance?.generationStatus)||! /^[a-f0-9]{64}$/.test(provenance?.outputHash||'')||provenance.semanticQuality?.startsWith('rejected'))throw new Error('SOURCE_PROVENANCE_REQUIRED');
  return provenance.outputHash;
}

export function interpolationPlan({fps,frames,cutFrames=[]}){
  if(![24,30].includes(fps))throw new Error('SOURCE_FPS_UNSUPPORTED: Use a 24 or 30 fps constant-frame-rate export');
  if(!Number.isSafeInteger(frames)||frames<2||frames>fps*90)throw new Error('SOURCE_FRAME_COUNT_UNSUPPORTED: Use a 1–90 second edit');
  const targetFrames=frames*60/fps;
  if(!Number.isSafeInteger(targetFrames))throw new Error('DURATION_NOT_ALIGNED: Duration must end on a 60 fps frame boundary');
  if(!Array.isArray(cutFrames)||cutFrames.length>120||cutFrames.some(n=>!Number.isSafeInteger(n)||n<=0||n>=frames))throw new Error('CUT_FRAMES_INVALID');
  const cuts=[0,...new Set(cutFrames.sort((a,b)=>a-b)),frames];
  if(cuts.some(n=>!Number.isSafeInteger(n*60/fps)))throw new Error('CUT_NOT_ALIGNED: A cut falls between 60 fps frames. Move that cut by one source frame and re-export');
  const segments=cuts.slice(0,-1).map((start,index)=>({index,start,frames:cuts[index+1]-start,targetStart:start*60/fps,targetFrames:(cuts[index+1]-start)*60/fps}));
  if(segments.some(s=>s.frames<2))throw new Error('SHOT_TOO_SHORT: RIFE requires two source frames per shot');
  return {sourceFps:fps,targetFps:60,sourceFrames:frames,targetFrames,durationSeconds:frames/fps,segments};
}

async function run(command,args,{cwd,log,timeout=3600000,onChunk=()=>{}}={}){
  return new Promise((ok,bad)=>{
    const output=log?createWriteStream(log):null;
    const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false,settled=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    const finish=async(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(output)await new Promise(r=>output.end(r));error?bad(error):ok({stdout,stderr});};
    child.stdout.on('data',b=>{stdout=(stdout+b).slice(-2000000);output?.write(b);onChunk(b.toString());});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-500000);output?.write(b);onChunk(b.toString());});
    child.on('error',e=>void finish(e));
    child.on('close',code=>void finish(code===0&&!timedOut?null:new Error(`${timedOut?'PROCESS_TIMEOUT':'PROCESS_FAILED'}: ${basename(command)} ${code}: ${stderr.slice(-1500)}`)));
  });
}

export async function inspectInterpolationRuntime({runtimeDir=configuredRuntime(),verify=false}={}){
  try{
    if(process.platform!=='win32'||process.arch!=='x64')throw new Error('INTERPOLATION_PLATFORM_UNQUALIFIED: Windows x64 only; macOS has not been tested');
    const pins=JSON.parse(await readFile(join(app,'runtime/interpolation.lock.json'),'utf8'));
    const config=JSON.parse(await readFile(join(runtimeDir,'interpolation.json'),'utf8'));
    const base=await realpath(config.root);
    for(const item of pins.artifacts){
      const path=await realpath(join(base,item.path)),rel=relative(base,path);
      if(rel.startsWith('..')||isAbsolute(rel)||(await stat(path)).size!==item.bytes||verify&&await fileSha256(path)!==item.sha256)throw new Error('INTERPOLATION_RUNTIME_INTEGRITY_FAILED');
    }
    const gpuId=Number.isInteger(config.gpuId)&&config.gpuId>=0&&config.gpuId<=7?config.gpuId:-1;
    return {status:'ready',message:verify?'Pinned RIFE runtime verified; output review still required':'Runtime registered; hashes are checked before each job',device:gpuId<0?'cpu':config.gpuName||`Vulkan device ${gpuId}`,config:{...config,root:base,gpuId},pins};
  }catch(error){return {status:'blocked',code:error.code==='ENOENT'?'INTERPOLATION_NOT_INSTALLED':error.message.split(':')[0],message:error.code==='ENOENT'?'Install the free local interpolation runtime in Settings':error.message};}
}

function parseFrameHashes(text){return text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());}

export async function qualifyInterpolationDevice(root,reportDirectory){
  const input=join(reportDirectory,'probe-input'),cpu=join(reportDirectory,'probe-cpu'),gpu=join(reportDirectory,'probe-gpu');
  for(const dir of [input,cpu,gpu])await mkdir(dir,{recursive:true});
  const ffmpeg=process.env.VYRELUM_FFMPEG||join(app,'workers/tools/ffmpeg.exe');
  await run(ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x64:rate=2:duration=1','-frames:v','2','-start_number','0',join(input,'%08d.png')]);
  const args=(device,destination)=>['-i',input,'-o',destination,'-m',join(root,'rife-v4.6'),'-n','4','-g',String(device),'-j','1:1:1','-f','%08d.png'];
  const cpuResult=await run(join(root,'rife-ncnn-vulkan.exe'),args(-1,cpu),{cwd:root,log:join(reportDirectory,'cpu-probe.log'),timeout:120000});
  if((await readdir(cpu)).filter(p=>p.endsWith('.png')).length!==4)throw new Error('CPU_INTERPOLATION_PROBE_FAILED');
  const devices=[...cpuResult.stderr.matchAll(/^\[(\d+) ([^\]]+)\]\s+queueC=/gm)].map(m=>({id:Number(m[1]),name:m[2]}));
  const candidate=devices.find(d=>/NVIDIA|AMD|Radeon/i.test(d.name));
  const report={gpuId:-1,gpuName:null,cpuProbe:'passed',gpuProbe:'not-available',scope:'64x64 startup/model probe only; full output quality and performance require a real export',devices};
  if(candidate){try{
    await run(join(root,'rife-ncnn-vulkan.exe'),args(candidate.id,gpu),{cwd:root,log:join(reportDirectory,'gpu-probe.log'),timeout:120000});
    if((await readdir(gpu)).filter(p=>p.endsWith('.png')).length!==4)throw new Error('GPU_PROBE_FRAME_COUNT');
    report.gpuId=candidate.id;report.gpuName=candidate.name;report.gpuProbe='passed';
  }catch(error){report.gpuProbe='failed';report.diagnostic=error.message;}}
  await writeFile(join(reportDirectory,'device-probe.json'),JSON.stringify(report,null,2));return report;
}

export async function interpolateVideo({sourcePath,sourceReceipt,sourceJobId,cutFrames=[],captionSrt='',reuse=null,output,device='auto',runtimeDir=configuredRuntime(),onProgress=()=>{}}){
  const sourceHash=validateInterpolationSource(sourceReceipt);
  if(!['auto','cpu'].includes(device))throw new Error('INTERPOLATION_DEVICE_INVALID');
  if(await fileSha256(sourcePath)!==sourceHash)throw new Error('SOURCE_PROVENANCE_HASH_MISMATCH');
  const runtime=await inspectInterpolationRuntime({runtimeDir,verify:true});
  if(runtime.status!=='ready')throw new Error(`${runtime.code}: ${runtime.message}`);
  const {config,pins}=runtime;
  const job=resolve(output);await mkdir(job,{recursive:true});
  const work=join(config.workRoot||join(config.root,'work'),basename(job));await mkdir(work,{recursive:true});
  const ffmpeg=process.env.VYRELUM_FFMPEG||join(app,'workers/tools/ffmpeg.exe'),ffprobe=process.env.VYRELUM_FFPROBE||join(app,'workers/tools/ffprobe.exe');
  const probe=JSON.parse((await run(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',sourcePath])).stdout);
  const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
  if(!video||video.width*video.height>1920*1080)throw new Error('INTERPOLATION_RESOLUTION_UNQUALIFIED: Interpolate at 1080p or lower before a separate 4K enhancement');
  const [num,den]=video.avg_frame_rate.split('/').map(Number),fps=num/den,frames=Number(video.nb_read_frames),duration=Number(video.duration);
  if(Math.abs(Number(video.start_time||0))>0.001||Math.abs(duration-frames/fps)>0.001||video.r_frame_rate!==video.avg_frame_rate)throw new Error('CONSTANT_FRAME_RATE_REQUIRED');
  if(audio&&(Math.abs(Number(audio.duration)-duration)>0.1||Math.abs(Number(audio.start_time||0))>0.02))throw new Error('SOURCE_AUDIO_SYNC_INVALID');
  if(audio&&audio.codec_name!=='aac')throw new Error('INTERPOLATION_AUDIO_CODEC_UNSUPPORTED: Export AAC audio first so the bitstream can be preserved');
  const basePlan=interpolationPlan({fps,frames,cutFrames});
  const storage=video.width*video.height*3*(frames+basePlan.targetFrames)*1.25+512*1024**2;
  const free=await statfs(work);if(Number(free.bavail)*Number(free.bsize)<storage)throw new Error(`INTERPOLATION_DISK_SPACE_REQUIRED: Allow ${Math.ceil(storage/1024**3)} GB for retained frames`);
  const source=join(work,'source.mp4');
  if(await stat(source).catch(()=>null)){if(await fileSha256(source)!==sourceHash)throw new Error('RETAINED_SOURCE_CHANGED');}else await copyFile(sourcePath,source);
  if(await fileSha256(source)!==sourceHash)throw new Error('SOURCE_COPY_HASH_MISMATCH');
  onProgress({stage:'Inspecting source timing and shot cuts',progress:0.02});
  const sceneLog=await run(ffmpeg,['-hide_banner','-i',source,'-an','-vf',"select='gt(scene,0.45)',showinfo",'-fps_mode','vfr','-f','null','-'],{log:join(job,'scene-detection.log'),timeout:300000});
  const detected=[...sceneLog.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(m=>Math.round(Number(m[1])*fps)).filter(n=>n>0&&n<frames);
  const plan=interpolationPlan({fps,frames,cutFrames:[...new Set([...cutFrames,...detected])]});
  const captionBoundaries=captionBoundaryFrames(captionSrt,fps,frames);
  const gpuId=device==='cpu'?-1:config.gpuId,started=Date.now();
  const identity=digest({sourceHash,plan,captionBoundaries,gpuId,artifacts:pins.artifacts,adapter:'rife-timed-segments-v2'});
  const priorV1=digest({sourceHash,plan,gpuId,artifacts:pins.artifacts,adapter:'rife-timed-segments-v1'});
  const reusable=reuse?.sourceHash===sourceHash&&reuse.sourceFps===fps&&reuse.targetFps===60&&reuse.sourceFrames===frames&&reuse.segments?.length===plan.segments.length&&[priorV1,identity].includes(reuse.workflowHash);
  const checkpointPath=join(work,'checkpoint.json');let checkpoint;
  try{checkpoint=JSON.parse(await readFile(checkpointPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(checkpoint&&checkpoint.identity!==identity)throw new Error('INTERPOLATION_INPUT_CHANGED: Start a new job; retained intermediates belong to different settings');
  checkpoint||={identity,completed:{}};
  await writeFile(checkpointPath,JSON.stringify(checkpoint,null,2));
  await writeFile(join(job,'plan.json'),JSON.stringify({identity,sourceJobId,sourceHash,...plan,captionBoundaries,detectedCutFrames:detected,workDirectory:work},null,2));
  let vramPeakGb=null,measuring=false;
  const measure=async()=>{if(measuring||gpuId<0)return;measuring=true;try{const result=await run('C:/Windows/System32/nvidia-smi.exe',['--query-gpu=memory.used','--format=csv,noheader,nounits'],{timeout:3000});const value=Number(result.stdout.trim().split('\n')[0])/1024;if(Number.isFinite(value))vramPeakGb=Math.max(vramPeakGb||0,value);}catch{}finally{measuring=false;}};
  await measure();const timer=setInterval(()=>void measure(),2000),segmentResults=[];
  try{
    for(const segment of plan.segments){
      const dir=join(work,`shot-${segment.index}`),inputFrames=join(dir,'input'),outFrames=join(dir,'output'),target=join(dir,'segment.mp4');
      await mkdir(inputFrames,{recursive:true});await mkdir(outFrames,{recursive:true});
      const cached=checkpoint.completed[segment.index];
      if(cached&&await fileSha256(target).catch(()=>null)===cached.sha256){segmentResults.push({...cached,cached:true});continue;}
      const protectedSamples=protectedCaptionSamples(segment,fps,captionBoundaries),prior=reusable?reuse.segments[segment.index]:null,priorDir=reusable?join(reuse.workDirectory,`shot-${segment.index}`):null;
      const priorValid=prior&&prior.sourceFrames===segment.frames&&prior.outputFrames===segment.targetFrames&&await fileSha256(join(priorDir,'segment.mp4')).catch(()=>null)===prior.sha256;
      if(priorValid&&!protectedSamples.length){
        await copyFile(join(priorDir,'segment.mp4'),target);
        const evidence={...prior,path:target,reusedFromJobId:reuse.jobId,cached:true};
        checkpoint.completed[segment.index]=evidence;await writeFile(checkpointPath,JSON.stringify(checkpoint,null,2));segmentResults.push(evidence);continue;
      }
      onProgress({stage:`Shot ${segment.index+1}/${plan.segments.length} · extracting original frames`,progress:0.05+segment.index/plan.segments.length*0.8});
      await run(ffmpeg,['-v','error','-y','-i',source,'-an','-vf',`trim=start_frame=${segment.start}:end_frame=${segment.start+segment.frames},setpts=PTS-STARTPTS`,'-fps_mode','passthrough','-start_number','0',join(inputFrames,'%08d.png')],{timeout:300000});
      // Pinned main.cpp maps i * inputCount/outputCount, clamps to the last
      // source frame and writes files starting at 1. 120 -> 300 therefore
      // samples exactly i * 24/60 without stretching the last-frame interval.
      const args=['-i',inputFrames,'-o',outFrames,'-m',join(config.root,pins.modelId),'-n',String(segment.targetFrames),'-g',String(gpuId),'-j','1:1:1','-f','%08d.png'];
      await writeFile(join(dir,'invocation.json'),JSON.stringify({executable:join(config.root,'rife-ncnn-vulkan.exe'),args,model:pins.modelId,identity},null,2));
      if(priorValid){
        onProgress({stage:`Shot ${segment.index+1} · reusing verified RIFE frames; repairing caption transitions`,progress:0.2});
        const priorFrames=join(priorDir,'output');
        const hashes=parseFrameHashes((await run(ffmpeg,['-v','error','-framerate','60','-start_number','1','-i',join(priorFrames,'%08d.png'),'-frames:v',String(segment.targetFrames),'-pix_fmt','rgb24','-f','framemd5','-'],{timeout:300000})).stdout);
        if(digest(hashes)!==prior.frameLedgerHash)throw new Error('REUSED_FRAME_LEDGER_CHANGED');
        for(let n=1;n<=segment.targetFrames;n++)await copyFile(join(priorFrames,String(n).padStart(8,'0')+'.png'),join(outFrames,String(n).padStart(8,'0')+'.png'));
        await copyFile(join(priorDir,'rife.log'),join(dir,'rife.log'));
        await writeFile(join(dir,'reuse.json'),JSON.stringify({sourceJobId:reuse.jobId,frameLedgerHash:prior.frameLedgerHash,modelInvokedThisAttempt:false},null,2));
      }else{
        const tick=setInterval(()=>onProgress({stage:`Shot ${segment.index+1}/${plan.segments.length} · RIFE ${gpuId<0?'CPU':'Vulkan'} interpolation`,elapsedSeconds:Math.round((Date.now()-started)/1000),progress:0.1+segment.index/plan.segments.length*0.8}),10000);
        try{await run(join(config.root,'rife-ncnn-vulkan.exe'),args,{cwd:config.root,log:join(dir,'rife.log'),timeout:7200000});}finally{clearInterval(tick);}
      }
      // Interpolating across a burned subtitle change can melt the letters.
      // Preserve the preceding original sample for those few in-between
      // frames, keeping the source caption timing and all old artifacts.
      for(const sample of protectedSamples)await copyFile(join(inputFrames,String(sample.sourceFrame).padStart(8,'0')+'.png'),join(outFrames,String(sample.outputFrame).padStart(8,'0')+'.png'));
      const outputFiles=(await readdir(outFrames)).filter(x=>x.endsWith('.png')).sort();
      if(outputFiles.length!==segment.targetFrames||outputFiles[0]!=='00000001.png'||outputFiles.at(-1)!==String(segment.targetFrames).padStart(8,'0')+'.png')throw new Error('INTERPOLATED_FRAME_COUNT_MISMATCH');
      const hashes=parseFrameHashes((await run(ffmpeg,['-v','error','-framerate','60','-start_number','1','-i',join(outFrames,'%08d.png'),'-frames:v',String(segment.targetFrames),'-pix_fmt','rgb24','-f','framemd5','-'],{timeout:300000})).stdout);
      const sourceHashes=parseFrameHashes((await run(ffmpeg,['-v','error','-framerate',String(fps),'-i',join(inputFrames,'%08d.png'),'-pix_fmt','rgb24','-f','framemd5','-'],{timeout:300000})).stdout);
      if(hashes.length!==segment.targetFrames)throw new Error('INTERPOLATED_FRAME_DECODE_FAILED');
      const synthetic=hashes.filter((hash,index)=>{const position=index*fps/60;if(Number.isInteger(position)||position>=segment.frames-1)return false;return hash!==sourceHashes[Math.floor(position)]&&hash!==sourceHashes[Math.ceil(position)];}).length;
      if(new Set(sourceHashes).size>1&&synthetic===0)throw new Error('INTERPOLATION_NO_SYNTHESIZED_FRAMES');
      await run(ffmpeg,['-v','error','-y','-framerate','60','-start_number','1','-i',join(outFrames,'%08d.png'),'-frames:v',String(segment.targetFrames),'-an','-c:v','libx264','-threads','4','-preset','fast','-crf','18','-profile:v','high','-pix_fmt','yuv420p','-video_track_timescale','15360',target],{log:join(dir,'encode.log'),timeout:600000});
      const evidence={index:segment.index,sourceFrames:segment.frames,outputFrames:segment.targetFrames,synthesizedFrames:synthetic,protectedCaptionFrames:protectedSamples.map(s=>s.outputFrame-1),...(priorValid?{reusedFromJobId:reuse.jobId}:{}),sha256:await fileSha256(target),frameLedgerHash:digest(hashes),path:target};
      await writeFile(join(dir,'frame-ledger.json'),JSON.stringify({source:sourceHashes,output:hashes},null,2));
      checkpoint.completed[segment.index]=evidence;await writeFile(checkpointPath,JSON.stringify(checkpoint,null,2));segmentResults.push(evidence);
    }
    onProgress({stage:'Encoding 60 fps delivery · preserving original audio',progress:0.9});
    const list=join(work,'segments.ffconcat');
    // Fixed relative names keep the concat demuxer inside this job directory.
    await writeFile(list,'ffconcat version 1.0\n'+plan.segments.map(s=>`file shot-${s.index}/segment.mp4`).join('\n')+'\n');
    const target=join(job,'delivery-60fps.mp4');
    await run(ffmpeg,['-v','error','-y','-f','concat','-safe','1','-i',list,'-i',source,'-map','0:v:0','-map','1:a?','-c','copy','-movflags','+faststart',target],{log:join(job,'encode.log'),timeout:300000});
    const verification=await verifyMedia({videoPath:target,ffmpeg,ffprobe,expected:{width:video.width,height:video.height,fps:60,durationSeconds:duration,requireAudio:Boolean(audio),requireVisual:true},toleranceSeconds:0.02});
    const stream=verification.probe?.streams?.find(s=>s.codec_type==='video'),deliveredAudio=verification.probe?.streams?.find(s=>s.codec_type==='audio');
    if(!verification.ok||Number(stream?.nb_frames)!==plan.targetFrames||Math.abs(Number(stream?.duration)-duration)>0.001||audio&&Math.abs(Number(deliveredAudio?.duration)-duration)>0.1)throw new Error('INTERPOLATION_DELIVERY_VERIFICATION_FAILED');
    await run(ffmpeg,['-v','error','-xerror','-i',target,'-f','null','-'],{timeout:300000});
    let audioHash=null;
    if(audio){const args=path=>['-v','error','-i',path,'-map','0:a:0','-c','copy','-f','hash','-hash','sha256','-'];const before=(await run(ffmpeg,args(source))).stdout.trim(),after=(await run(ffmpeg,args(target))).stdout.trim();if(before!==after)throw new Error('INTERPOLATION_AUDIO_BITSTREAM_CHANGED');audioHash=after;}
    const columns=Math.min(5,Math.ceil(duration)),rows=Math.ceil(Math.ceil(duration)/columns);
    await run(ffmpeg,['-v','error','-y','-i',target,'-vf',`fps=1,scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2,tile=${columns}x${rows}`,'-frames:v','1',join(job,'contact-sheet.png')],{timeout:300000});
    const result={schemaVersion:1,status:'review_required',validated:true,durationSeconds:duration,outputs:{video:'delivery-60fps.mp4',poster:'contact-sheet.png',quality:'verification.json'},verification,interpolation:{...plan,segments:segmentResults,audioHash,device:gpuId<0?'cpu':runtime.device,sceneCutMethod:'timeline boundaries plus FFmpeg scene score > 0.45',endpointMethod:'terminal-frame-hold',identity,workDirectory:work},provenance:{generationStatus:'edited',sourceMethod:'local-rife-frame-interpolation',providerId:pins.providerId,modelId:pins.modelId,source:sourceReceipt.provenance,sourceHash,sourceJobId,outputHash:await fileSha256(target),sourceFps:fps,targetFps:60,fps:60,frameCount:plan.targetFrames,resolution:{width:video.width,height:video.height},deliveryResolution:{width:video.width,height:video.height},fourKMethod:sourceReceipt.provenance.fourKMethod||'No 4K enhancement invoked',interpolationMethod:'RIFE v4.6, isolated shots, terminal clamp, caption-boundary hold',modelInvokedThisAttempt:segmentResults.some(s=>!s.cached&&!s.reusedFromJobId),reusedFromJobs:[...new Set(segmentResults.map(s=>s.reusedFromJobId).filter(Boolean))],workflowHash:identity,renderTimeMs:Date.now()-started,vramPeakGb,semanticQuality:'unreviewed'},diagnostics:[{code:'VISUAL_REVIEW_REQUIRED',message:'60 fps contains synthesized in-between frames. Inspect faces, hands, occlusions and cuts; this is not native 60 fps model generation.'}]};
    await writeFile(join(job,'verification.json'),JSON.stringify(result,null,2));await writeFile(join(job,'result.json'),JSON.stringify(result,null,2));return result;
  }finally{clearInterval(timer);}
}
