import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyMedia } from './media-verifier.mjs';
import { buildCaptionFilter } from './format-captions.mjs';
import { DEFAULT_CAPTION_FONT } from './format-render.mjs';

const exec=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const run=(bin,args)=>exec(bin,args,{windowsHide:true,timeout:180000,maxBuffer:8*1024**2});
const stamp=t=>{const ms=Math.round(t*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};

/** Explicitly chronological coverage, not semantic highlights or AI direction. */
export function planRawRanges(sources,durationSeconds){
  if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>90||!Array.isArray(sources)||!sources.length)fail('RAW_DURATION','Choose 1–90 seconds and at least one uploaded video');
  const available=sources.map(source=>({...source,frames:Math.floor(source.durationSeconds*24)}));
  if(available.some(source=>!Number.isFinite(source.durationSeconds)||source.durationSeconds<=0)||available.reduce((sum,source)=>sum+source.frames,0)<Math.round(durationSeconds*24))fail('RAW_SOURCE_TOO_SHORT','Not enough distinct source footage; upload longer footage or choose a shorter edit');
  let remaining=Math.round(durationSeconds*24);const ranges=[];
  for(const source of available){
    const frames=Math.min(remaining,source.frames),count=Math.ceil(frames/120);if(!count)continue;
    const gap=count===1?0:(source.frames-frames)/(count-1);let used=0;
    for(let i=0;i<count;i++){const length=Math.floor(frames/count)+(i<frames%count?1:0);ranges.push({assetId:source.id,start:Math.round(used+i*gap)/24,duration:length/24});used+=length;}
    remaining-=frames;
  }
  return ranges;
}

export async function editRawFootage(request,{ffmpeg,ffprobe,onProgress=()=>{}}={}){
  const started=Date.now(), {projectId,revision,brief,durationSeconds=20,aspect='9:16',captionsEnabled=true,audioConfigPath}=request;
  if(!projectId||!Number.isSafeInteger(revision)||revision<1||typeof brief!=='string'||!brief.trim()||!['9:16','16:9'].includes(aspect)||typeof captionsEnabled!=='boolean')fail('RAW_REQUEST','A saved project, brief, aspect and caption choice are required');
  if(!Array.isArray(request.sourceAssets)||!request.sourceAssets.length||request.sourceAssets.length>12)fail('RAW_ASSETS','Select up to twelve uploaded video assets');
  const outputDir=resolve(request.outputDir);await mkdir(outputDir,{recursive:true});const outputRoot=await realpath(outputDir),inventory=[],seen=new Set();
  for(const asset of request.sourceAssets){
    if(!asset.id||seen.has(asset.id)||!String(asset.mime).startsWith('video/'))fail('RAW_ASSET','Only distinct uploaded video assets are supported');seen.add(asset.id);
    const path=await realpath(asset.path),rel=relative(outputRoot,path);
    if(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\'))fail('RAW_OUTPUT_OVERLAP','Sources must remain outside the output job directory');
    const probe=JSON.parse((await run(ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',path])).stdout);
    if(!probe.streams?.some(stream=>stream.codec_type==='video'))fail('RAW_VIDEO','The selected asset has no video stream');
    const sourceHash=sha(await readFile(path));if(asset.sha256&&asset.sha256!==sourceHash)fail('RAW_SOURCE_HASH','The registered source hash no longer matches its bytes');
    inventory.push({id:asset.id,path,sourceHash,durationSeconds:Number(probe.format?.duration),hasAudio:probe.streams.some(stream=>stream.codec_type==='audio')});
  }
  const ranges=planRawRanges(inventory,durationSeconds),width=aspect==='9:16'?1080:1920,height=aspect==='9:16'?1920:1080;
  const segments=[];let hasAudio=false;onProgress({stage:'Editing uploaded footage',progress:0.1});const editStarted=Date.now();
  for(const [index,range]of ranges.entries()){
    const source=inventory.find(source=>source.id===range.assetId),file=join(outputDir,`segment-${index}.mp4`);hasAudio ||= source.hasAudio;
    const args=['-y','-v','error','-ss',String(range.start),'-i',source.path];
    if(!source.hasAudio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
    args.push('-map','0:v:0','-map',source.hasAudio?'0:a:0':'1:a:0','-t',String(range.duration),'-vf',`fps=24,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p`,'-af','aresample=48000,apad','-c:v','libx264','-preset','veryfast','-crf','18','-c:a','aac','-ar','48000','-ac','2','-b:a','192k',file);
    await run(ffmpeg,args);segments.push(file);onProgress({stage:'Editing uploaded footage',progress:0.1+0.45*(index+1)/ranges.length});
  }
  const list=join(outputDir,'segments.txt');await writeFile(list,segments.map(file=>`file '${file.replaceAll('\\','/').replaceAll("'","'\\''")}'`).join('\n'));
  const cut=join(outputDir,'cut.mp4');await run(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i',list,'-c','copy',cut]);
  const editMs=Date.now()-editStarted,asrStarted=Date.now();let captionStatus=captionsEnabled?(hasAudio?'pending':'no-audio'):'disabled',cues=[],asr=null,config=null;const diagnostics=[];
  if(captionsEnabled&&hasAudio){try{if(!audioConfigPath)throw new Error('No audio configuration supplied');config=JSON.parse(await readFile(audioConfigPath,'utf8'));}catch(error){captionStatus='unavailable';diagnostics.push({code:'RAW_CAPTION_RUNTIME_UNAVAILABLE',message:error.message});}}
  if(captionsEnabled&&hasAudio&&config){
    const asrDir=join(outputDir,'transcript');await mkdir(asrDir,{recursive:true});
    const asrRequest=join(outputDir,'transcribe-request.json');await writeFile(asrRequest,JSON.stringify({operation:'transcribe',inputPath:cut}));onProgress({stage:'Transcribing original audio locally',progress:0.6});
    try{await run(config.python,[fileURLToPath(new URL('../workers/raw-footage-asr.py',import.meta.url)),'--request',asrRequest,'--output',asrDir,'--config',resolve(audioConfigPath)]);asr=JSON.parse(await readFile(join(asrDir,'result.json'),'utf8'));}
    catch(error){captionStatus=`${error.message} ${error.stderr}`.includes('NO_SPEECH_DETECTED')?'no-speech':'unavailable';if(captionStatus==='unavailable')diagnostics.push({code:'RAW_TRANSCRIPTION_FAILED',message:String(error.stderr||error.message).slice(-1800)});}
    for(const segment of asr?.segments||[]){
      const words=(segment.words||[]).filter(word=>Number.isFinite(word.start)&&Number.isFinite(word.end)&&word.end>word.start&&String(word.word).trim());
      for(let i=0;i<words.length;i+=4){const group=words.slice(i,i+4),start=Math.max(0,group[0].start),end=Math.min(durationSeconds,group.at(-1).end),text=group.map(word=>word.word.trim()).join(' ');if(end>start&&(!cues.length||start>=cues.at(-1).end))cues.push({start,end,text});}
    }
    if(captionStatus!=='unavailable')captionStatus=cues.length?'transcribed':'no-speech';
  }
  const transcriptionMs=Date.now()-asrStarted,finishStarted=Date.now(),final=join(outputDir,'edited.mp4');let captions=null;
  const args=['-y','-v','error','-i',cut];
  if(cues.length){captions='captions.srt';await writeFile(join(outputDir,captions),cues.map((cue,i)=>`${i+1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n'));args.push('-vf',buildCaptionFilter({cues,style:'minimal-lower',canvas:{width,height,fps:24},safeArea:{top:Math.round(height*.08),bottom:Math.round(height*.2),left:Math.round(width*.07),right:Math.round(width*.14)},fontFile:DEFAULT_CAPTION_FONT}),'-c:v','libx264','-preset','veryfast','-crf','18');}else args.push('-c:v','copy');
  args.push('-map','0:v:0','-map','0:a:0','-af','loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000','-c:a','aac','-b:a','192k','-t',String(durationSeconds),'-movflags','+faststart',final);onProgress({stage:'Finishing original audio and export',progress:0.85});await run(ffmpeg,args);
  const finishingMs=Date.now()-finishStarted;await run(ffmpeg,['-v','error','-xerror','-i',final,'-f','null','-']);
  const verification=await verifyMedia({videoPath:final,ffmpeg,ffprobe,expected:{width,height,fps:24,durationSeconds,requireAudio:hasAudio,requireVisual:true}});
  if(!verification.ok)fail('RAW_EXPORT_VERIFY',verification.diagnostics.map(item=>item.code).join(', '));
  await run(ffmpeg,['-y','-v','error','-ss',String(Math.min(1,durationSeconds/3)),'-i',final,'-frames:v','1',join(outputDir,'poster.png')]);
  const result={schemaVersion:1,status:'review_required',validated:true,projectId,revision,sourceMethod:'local-raw-footage-edit',durationSeconds,width,height,fps:24,
    timeline:ranges.map((range,index)=>({id:`raw-${index+1}`,assetId:range.assetId,kind:'video',trimStart:range.start,duration:range.duration,muted:false})),
    outputs:{video:'edited.mp4',poster:'poster.png',captions},verification,captionStatus,captionsStatus:captionStatus,captionsAvailable:captionStatus==='transcribed',segments:cues,
    provenance:{generationStatus:'edited',sourceMethod:'uploaded-real-footage',neuralVideoGenerated:false,outputHash:sha(await readFile(final)),sources:inventory.map(source=>({assetId:source.id,sourceHash:source.sourceHash,durationSeconds:source.durationSeconds,ranges:ranges.filter(range=>range.assetId===source.id)})),
      selectionMethod:'chronological evenly spaced ranges up to five seconds; not semantic highlight detection',audioMethod:hasAudio?'original audio retained and normalized':'silent source; no replacement narration or music',captions:asr?.provenance||null,timings:{totalMs:Date.now()-started,editMs,transcriptionMs,finishingMs,sourceGenerationMs:null}},
    diagnostics:[...diagnostics,{code:'RAW_REVIEW_REQUIRED',message:'Review framing, cut continuity and any machine-transcribed words. The brief is retained as user intent; this deterministic edit does not claim to understand its visual semantics.'}]};
  await writeFile(join(outputDir,'result.json'),JSON.stringify(result,null,2));onProgress({stage:'Edited video ready for review',progress:1});return result;
}
