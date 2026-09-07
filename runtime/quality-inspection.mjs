import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyMedia } from './media-verifier.mjs';

export const VISUAL_CATEGORIES = Object.freeze(['subjectRealism','facialDetail','environmentDetail','lighting','depth','motion','temporalConsistency','composition','audioAlignment']);
export const mediaHash = async path => { const hash=createHash('sha256'); for await(const chunk of createReadStream(path))hash.update(chunk); return hash.digest('hex'); };
export const runMediaCommand = (cmd,args,{timeout=600000,signal}={}) => new Promise((ok,bad)=>{
  const p=spawn(cmd,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); let stdout='',stderr='',done=false;
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?bad(error):ok({stdout,stderr});};
  const abort=()=>{p.kill();finish(new Error('JOB_CANCELLED'));};
  const timer=setTimeout(()=>{p.kill();finish(new Error('MEDIA_COMMAND_TIMEOUT'));},timeout);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  p.stdout.on('data',b=>{stdout=(stdout+b).slice(-4000000);});p.stderr.on('data',b=>{stderr=(stderr+b).slice(-2000000);});
  p.on('error',finish);p.on('close',code=>finish(code?new Error(`MEDIA_COMMAND_FAILED (${code}): ${stderr.slice(-1800)}`):null));
});

// A technical pixel check cannot judge realism, performance, or sound/action
// alignment. Only a review of this exact artifact can satisfy these categories.
export function assessVisualReview(review,sha256){
  const diagnostics=[];
  if(!review)return {status:'review_required',scores:null,diagnostics:[{code:'VISUAL_REVIEW_REQUIRED',message:'Review the video and contact sheet; subject performance and sound alignment are not measured by pixel statistics.'}]};
  if(review.sha256!==sha256)diagnostics.push({code:'REVIEW_STALE',message:'The review belongs to a different render.'});
  if(!review.reviewer||!review.method)diagnostics.push({code:'REVIEW_PROVENANCE_MISSING',message:'Name the reviewer and review method.'});
  for(const key of VISUAL_CATEGORIES){const v=review.categories?.[key];if(!v||!Number.isFinite(v.score)||v.score<0||v.score>10||typeof v.observation!=='string'||!v.observation.trim())diagnostics.push({code:'REVIEW_INCOMPLETE',category:key,message:`${key} needs a score and an observation.`});else if(v.score<7)diagnostics.push({code:'VISUAL_QUALITY_REJECTED',category:key,message:v.observation});}
  return {status:diagnostics.length?'rejected':'passed',scores:review.categories||null,reviewer:review.reviewer,method:review.method,diagnostics};
}

export async function inspectRender({videoPath,output,ffmpeg,ffprobe,expected={},sourceMethod,review,signal}={}){
  await mkdir(output,{recursive:true});const started=Date.now();
  const technical=await verifyMedia({videoPath,ffmpeg,ffprobe,expected});
  const diagnostics=[...technical.diagnostics];
  const sha256=await mediaHash(videoPath);
  let exactProbe;
  try{exactProbe=JSON.parse((await runMediaCommand(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',resolve(videoPath)],{signal})).stdout);}catch(error){diagnostics.push({code:'FRAME_COUNT_UNAVAILABLE',message:error.message});}
  const video=exactProbe?.streams?.find(s=>s.codec_type==='video'),audio=exactProbe?.streams?.find(s=>s.codec_type==='audio');
  const duration=Number(video?.duration||exactProbe?.format?.duration||0),frames=Number(video?.nb_read_frames||video?.nb_frames||0);
  const wanted=expected.durationSeconds&&expected.fps?Math.round(expected.durationSeconds*expected.fps):null;
  if(wanted&&frames!==wanted)diagnostics.push({code:'FRAME_COUNT_MISMATCH',message:`Expected ${wanted} frames, decoded ${frames}.`});
  const sync=video&&audio?Math.max(Math.abs(Number(video.start_time||0)-Number(audio.start_time||0)),Math.abs(Number(video.start_time||0)+Number(video.duration||0)-Number(audio.start_time||0)-Number(audio.duration||0))):null;
  if(audio&&(sync===null||!Number.isFinite(sync)||sync>0.1001))diagnostics.push({code:'AUDIO_VIDEO_SYNC',message:`Audio/video end points differ by ${sync} seconds.`});
  let blackSeconds=0;
  try{
    const decoded=await runMediaCommand(ffmpeg,['-hide_banner','-v','info','-xerror','-i',resolve(videoPath),'-vf','blackdetect=d=0.08:pix_th=0.10:pic_th=0.98','-f','null','-'],{signal});
    blackSeconds=[...decoded.stderr.matchAll(/black_duration:([\d.]+)/g)].reduce((s,m)=>s+Number(m[1]),0);
    if(blackSeconds>0.10)diagnostics.push({code:'BLACK_FRAMES_DETECTED',message:`${blackSeconds.toFixed(3)} seconds of mostly black frames were detected across the full render.`});
  }catch(error){diagnostics.push({code:'FULL_DECODE_FAILED',message:error.message});}
  const count=Math.ceil(duration);let sheets=[];
  if(count>0&&count<=600){
    const frameDir=join(output,'frames');await mkdir(frameDir,{recursive:true});
    await runMediaCommand(ffmpeg,['-v','error','-y','-i',resolve(videoPath),'-vf','fps=1,scale=480:-2','-frames:v',String(count),join(frameDir,'frame-%04d.png')],{signal});
    const pages=Math.ceil(count/30);
    for(let i=0;i<pages;i++){
      const n=Math.min(30,count-i*30),file=join(output,`contact-sheet-${i+1}.png`);
      await runMediaCommand(ffmpeg,['-v','error','-y','-ss',String(i*30),'-i',resolve(videoPath),'-vf',`fps=1,scale=320:-2,tile=5x${Math.ceil(n/5)}:nb_frames=${n}`,'-frames:v','1','-update','1',file],{signal});sheets.push(file);
    }
  }else diagnostics.push({code:'INSPECTION_DURATION_LIMIT',message:'Frame inspection supports renders up to 10 minutes; inspect long-form chapters separately.'});
  const visual=assessVisualReview(review,sha256);
  const status=diagnostics.length?'rejected':visual.status;
  const receipt={schemaVersion:1,status,sourceMethod:sourceMethod||'unspecified',sha256,technical:{...technical,ok:diagnostics.length===0,decodedFrames:frames,expectedFrames:wanted,avSyncSeconds:sync,blackSeconds,fullDurationSeconds:duration},visual,diagnostics:[...diagnostics,...visual.diagnostics],outputs:{video:resolve(videoPath),contactSheets:sheets,frames:join(output,'frames')},timing:{inspectionMs:Date.now()-started},unmeasured:['semantic deformation','subject motion','action/sound timing','local inference memory peak']};
  await writeFile(join(output,'quality.json'),JSON.stringify(receipt,null,2));return receipt;
}
