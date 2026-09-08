import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMedia } from './media-verifier.mjs';
import { generatedSourceProvenance } from './generation-delivery.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function run(command,args,{cwd,log,onProgress=()=>{},timeout=7200000}={}){
  return new Promise((ok,bad)=>{
    const child=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let tail='';
    const timer=setTimeout(()=>child.kill(),timeout);
    const consume=b=>{tail=(tail+b.toString()).slice(-6000);onProgress(b.toString());};
    child.stdout.on('data',consume);child.stderr.on('data',consume);
    child.on('error',e=>{clearTimeout(timer);bad(e)});child.on('close',async code=>{clearTimeout(timer);try{if(log)await writeFile(log,tail);code===0?ok():bad(new Error(`Enhancement process exited ${code}: ${tail}`));}catch(error){bad(error);}});
  });
}
export async function enhanceNeuralClip({input,receiptPath,output,runtimeDir=process.env.VYRELUM_RUNTIME_DIR||resolve('data/runtime'),onProgress=()=>{}}){
  const source=resolve(input),dir=resolve(output),receipt=JSON.parse(await readFile(receiptPath,'utf8'));
  const sourceProvenance=generatedSourceProvenance(receipt.provenance),sourceHash=receipt.provenance.sourceHash||receipt.provenance.outputHash;
  if(hash(await readFile(source))!==sourceHash)throw new Error('SOURCE_PROVENANCE_HASH_MISMATCH');
  const config=JSON.parse(await readFile(join(runtimeDir,'enhancement.json'),'utf8'));
  for(const item of config.artifacts){if(hash(await readFile(item.path))!==item.sha256)throw new Error('ENHANCEMENT_RUNTIME_INTEGRITY_FAILED');}
  await mkdir(dir,{recursive:true});
  const intermediateRoot=config.workRoot?join(resolve(config.workRoot),basename(dir)):dir;
  await mkdir(intermediateRoot,{recursive:true});
  const expectedStorage=Number(sourceProvenance.resolution.width)*Number(sourceProvenance.resolution.height)*16*3*Number(sourceProvenance.frameCount)*2+2*1024**3;
  const disk=await statfs(intermediateRoot);if(Number(disk.bavail)*Number(disk.bsize)<expectedStorage)throw new Error(`ENHANCEMENT_DISK_SPACE_REQUIRED: approximately ${Math.ceil(expectedStorage/1024**3)} GB free for retained lossless intermediates`);
  const ffmpeg=process.env.VYRELUM_FFMPEG||join(root,'workers/tools/ffmpeg.exe'),ffprobe=process.env.VYRELUM_FFPROBE||join(root,'workers/tools/ffprobe.exe');
  const sourceFrames=join(intermediateRoot,'source-frames'),enhanced=join(intermediateRoot,'enhanced-frames'),stable=join(intermediateRoot,'stable-frames');
  for(const folder of [sourceFrames,enhanced,stable])await mkdir(folder,{recursive:true});
  const started=Date.now(),fps=Number(sourceProvenance.fps),frameCount=Number(sourceProvenance.frameCount),duration=Number(receipt.durationSeconds);
  if(fps!==24||frameCount!==Math.round(duration*fps)||duration>90)throw new Error('ENHANCEMENT_PROFILE_UNSUPPORTED');
  onProgress({stage:'Source · extracting verified generated frames',progress:0.05});
  await run(ffmpeg,['-v','error','-y','-i',source,'-frames:v',String(frameCount),'-start_number','0',join(sourceFrames,'%06d.png')]);
  onProgress({stage:'Upscale · Real-ESRGAN x4, 128-pixel tiles',progress:0.2});
  if(!Number.isInteger(config.gpuId)||config.gpuId<0||config.gpuId>8)throw new Error('VULKAN_DEVICE_NOT_QUALIFIED');
  let upscaleTail='';
  await run(config.executable,['-i',sourceFrames,'-o',enhanced,'-n','realesrgan-x4plus','-s','4','-t','128','-m',config.models,'-g',String(config.gpuId),'-j','1:1:1','-f','png'],{cwd:config.directory,log:join(dir,'upscaler.log'),onProgress:chunk=>{upscaleTail=(upscaleTail+chunk).slice(-500);const matches=[...upscaleTail.matchAll(/(\d+(?:\.\d+)?)%/g)];if(matches.length)onProgress({stage:`Upscale · tiled Real-ESRGAN (${matches.at(-1)[1]}% of current frame)`,progress:0.2});}});
  if((await readdir(enhanced)).filter(x=>x.endsWith('.png')).length!==frameCount)throw new Error('ENHANCED_FRAME_COUNT_MISMATCH');
  onProgress({stage:'Enhance · motion-compensated temporal detail stabilization',progress:0.65});
  await run(config.python,[join(root,'workers/temporal-detail.py'),'--source',sourceFrames,'--enhanced',enhanced,'--output',stable],{log:join(dir,'temporal.log')});
  const target=join(dir,'delivery-4k.mp4');
  onProgress({stage:'Grade → Encode 4K · 60 Mbps H.264',progress:0.85});
  await run(ffmpeg,['-y','-framerate',String(fps),'-i',join(stable,'%06d.png'),'-i',source,'-map','0:v:0','-map','1:a?','-frames:v',String(frameCount),'-vf','scale=3840:2160:flags=lanczos,format=yuv420p','-c:v','libx264','-threads','4','-preset','fast','-profile:v','high','-level','5.1','-b:v','60M','-minrate','60M','-maxrate','60M','-bufsize','120M','-x264-params','nal-hrd=cbr:force-cfr=1','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',target],{log:join(dir,'encode.log')});
  const verification=await verifyMedia({videoPath:target,ffmpeg,ffprobe,expected:{width:3840,height:2160,fps,durationSeconds:duration,requireVisual:true}});
  if(!verification.ok)throw new Error(`ENHANCEMENT_REJECTED: ${verification.diagnostics.map(d=>d.code).join(', ')}`);
  const video=verification.probe.streams.find(s=>s.codec_type==='video');
  if(Number(video.nb_frames)!==frameCount||Number(video.bit_rate)<45000000)throw new Error('4K_DELIVERY_FRAME_COUNT_OR_BITRATE_FAILED');
  await run(ffmpeg,['-v','error','-xerror','-i',target,'-f','null','-'],{timeout:300000});
  await run(ffmpeg,['-y','-i',target,'-vf','fps=1,scale=384:216,tile=5x1','-frames:v','1',join(dir,'contact-sheet.png')]);
  const result={schemaVersion:2,status:'review_required',validated:true,durationSeconds:duration,outputs:{video:'delivery-4k.mp4',poster:'contact-sheet.png',quality:'verification.json'},verification,provenance:{generationStatus:'upscaled',sourceMethod:'local-neural-source',providerId:'realesrgan-ncnn-vulkan',modelId:'realesrgan-x4plus',source:sourceProvenance,sourceHash,outputHash:hash(await readFile(target)),resolution:sourceProvenance.resolution,deliveryResolution:{width:3840,height:2160},fourKMethod:'Real-ESRGAN x4 + motion-compensated detail + Lanczos to UHD',temporalMethod:'backward-flow-photometric-mask-detail-blend-v1',renderTimeMs:Date.now()-started,semanticQuality:'unreviewed'},diagnostics:[{code:'VISUAL_REVIEW_REQUIRED',message:'Enhanced delivery; native source detail remains limited by the local generation resolution.'}]};
  await writeFile(join(dir,'verification.json'),JSON.stringify(result,null,2));await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));return result;
}
