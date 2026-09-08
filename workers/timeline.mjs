import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,stat,rename,rm} from 'node:fs/promises';
import {existsSync,createReadStream} from 'node:fs';
import {resolve,join,basename,extname} from 'node:path';
import {verifyMedia} from '../runtime/media-verifier.mjs';
import {rawFramingFilter} from '../runtime/raw-footage-plan.mjs';
import {buildCaptionFilter} from '../runtime/format-captions.mjs';
import {DEFAULT_CAPTION_FONT} from '../runtime/format-render.mjs';
import {prepareTimedCaptions} from '../runtime/timed-captions.mjs';

const CACHE_VERSION='timeline-base-v1';
const MEDIA_EXT=new Set(['.mp4','.mov','.m4v','.mkv','.webm','.avi','.gif','.png','.jpg','.jpeg','.webp','.bmp','.tif','.tiff','.wav','.mp3','.flac','.ogg','.m4a','.aac','.opus']);
const finite=(x,n)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&(!n||x<=n);
const localPath=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.includes('\0')||/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^[a-z]:[\\/]/i.test(value)||/^[/\\]{2}/.test(value)) throw new Error(`${label} must be a local file path`); const p=resolve(value); if(!MEDIA_EXT.has(extname(p).toLowerCase())) throw new Error(`${label} has unsupported media extension`); return p;};
const run=(cmd,args,{timeout=120000,maxLog=6000,captureStderr=false}={})=>new Promise((ok,bad)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let out='',err='',done=false; const finish=(fn,v)=>{if(done)return;done=true;clearTimeout(timer);fn(v)};p.stdout.on('data',d=>{out+=d.toString();if(out.length>maxLog)out=out.slice(-maxLog)});p.stderr.on('data',d=>{err+=d.toString();if(err.length>maxLog)err=err.slice(-maxLog)});p.on('error',e=>finish(bad,e));p.on('close',c=>c?finish(bad,new Error(`${basename(cmd)} exited ${c}: ${err.slice(-1800)}`)):finish(ok,captureStderr?{stdout:out,stderr:err}:out));const timer=setTimeout(()=>{p.kill('SIGKILL');finish(bad,new Error(`${basename(cmd)} timed out`))},timeout);});
const fileHash=async p=>{const h=createHash('sha256'); for await (const chunk of createReadStream(p)) h.update(chunk); return h.digest('hex');};
const probe=async (ffprobe,p)=>JSON.parse(await run(ffprobe,['-v','error','-print_format','json','-show_streams','-show_format',p]));
const escSrt=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\r','').replaceAll('\n','\n');
const captionText=s=>{const text=String(s||'').replace(/\s+/g,' ').trim();const lead=text.split(/\s+(?:with|and|to|that)\s+/i)[0].trim();const cinematic=lead.replace(/^(?:exploration of|boarding|sailing through|entering|crossing|watching|following)\s+/i,'').trim();if(/^the\s+/i.test(cinematic)&&cinematic.split(/\s+/).length<=6)return cinematic.toUpperCase();if(lead.length<=48&&lead.split(/\s+/).length<=7)return lead;return `${lead.split(/\s+/).slice(0,6).join(' ').slice(0,44).trim()}…`;};
const stamp=t=>{const ms=Math.max(0,Math.round(t*1000)), h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),q=ms%1000;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(q).padStart(3,'0')}`;};
const filterPath=p=>p.replaceAll('\\','/').replaceAll(':','\\:').replaceAll("'","\\'");

/** Render a schemaVersion 1 timeline using local FFmpeg executables.
 * Returns {outputs:{video,poster,captions,ffprobe}, ffprobe, cache:{clips:[...]}, inputHash}.
 * All output paths are relative names; cacheDir may be supplied for cross-job reuse.
 */
export async function renderTimeline(request,{output,ffmpeg,ffprobe,cacheDir,onProgress}={}) {
  if(!request||request.schemaVersion!==1||request.kind!=='timeline') throw new Error('Expected schemaVersion 1 kind timeline');
  if(!output||!ffmpeg||!ffprobe) throw new Error('output, ffmpeg and ffprobe are required');
  const started=Date.now();
  const settings=request.settings||{}, width=Number(settings.width), height=Number(settings.height), fps=Number(settings.fps);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>4096||height>4096||width*height>16777216||width%2||height%2) throw new Error('settings width/height must be even integers between 16 and 4096');
  if(!finite(fps,60)||fps<1) throw new Error('settings fps must be between 1 and 60');
  const profile=settings.rawEditProfile||{},framing=settings.framing??profile.framing??(settings.fit==='cover'?'crop-center':'fit'),audioTargetLUFS=settings.audioTargetLUFS??profile.audioTargetLUFS??-14,rawCaptionStyle=settings.captionStyle??profile.captionStyle;
  if(!['fit','crop-left','crop-right','crop-center'].includes(framing))throw new Error('Invalid settings.framing');
  if(typeof audioTargetLUFS!=='number'||!Number.isFinite(audioTargetLUFS)||audioTargetLUFS< -24||audioTargetLUFS> -10)throw new Error('settings.audioTargetLUFS must be between -24 and -10');
  if(rawCaptionStyle!==undefined&&!['minimal-lower','generic'].includes(rawCaptionStyle))throw new Error('Invalid settings.captionStyle');
  const clips=request.timeline?.clips; if(!Array.isArray(clips)||!clips.length||clips.length>64) throw new Error('timeline.clips must contain 1-64 clips');
  const out=resolve(output), cache=resolve(cacheDir||process.env.VYRELUM_RUNTIME_DIR||resolve('work'),'cache','timeline-v1'); await mkdir(out,{recursive:true}); await mkdir(cache,{recursive:true});
  const bases=[], receiptClips=[]; let total=0;
  for (let i=0;i<clips.length;i++) {
    const c=clips[i]||{};
    const p=localPath(c.path,`clip ${i} path`);
    if(c.kind!=='video'&&c.kind!=='image') throw new Error(`clip ${i} kind must be video or image`);
    const duration=Number(c.duration), trim=Number(c.trimStart||0);
    if(!finite(duration,3600)||duration<=0||!finite(trim,3600)) throw new Error(`clip ${i} duration/trimStart invalid`);
    total+=duration; if(total>21600) throw new Error('timeline duration exceeds 6 hours');
    const sourceHash=await fileHash(p); let sourceProbe=null;
    if(c.kind==='video') { sourceProbe=await probe(ffprobe,p); const d=Number(sourceProbe.format?.duration||0); if(!d||trim>=d||trim+duration>d+0.08) throw new Error(`clip ${i} trim exceeds source duration`); }
    const frames=Math.max(1,Math.round(duration*fps)), actual=frames/fps;
    const key=createHash('sha256').update(JSON.stringify({v:CACHE_VERSION,sourceHash,kind:c.kind,trim,duration:actual,width,height,fps,framing})).digest('hex');
    const base=join(cache,`${key}.mkv`), manifest=join(cache,`${key}.json`); let hit=false;
    if(existsSync(base)&&existsSync(manifest)) { try { const m=JSON.parse(await readFile(manifest,'utf8')); hit=m.key===key&&(await stat(base)).size>1000; } catch { hit=false; } }
    if(!hit) {
      const tmp=join(cache,`${key}.${process.pid}.${Date.now()}.tmp.mkv`), args=['-y','-protocol_whitelist','file,pipe'];
      if(c.kind==='image') args.push('-loop','1','-framerate',String(fps),'-i',p); else args.push('-ss',String(trim),'-i',p);
      const hasAudio=sourceProbe?.streams?.some(s=>s.codec_type==='audio'); if(!hasAudio) args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000'); const ai=hasAudio?0:1;
      args.push('-filter:v',`${rawFramingFilter(width,height,framing).replace('force_original_aspect_ratio=increase','force_original_aspect_ratio=increase:force_divisible_by=2').replace('force_original_aspect_ratio=decrease','force_original_aspect_ratio=decrease:force_divisible_by=2')},setsar=1,fps=${fps},trim=duration=${actual},setpts=PTS-STARTPTS`,'-map','0:v:0','-map',`${ai}:a:0`,'-t',String(actual),'-frames:v',String(frames),'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','pcm_s16le','-ar','48000','-ac','2',tmp);
      await run(ffmpeg,args); try { await rename(tmp,base); } catch { await rm(tmp,{force:true}); } await writeFile(manifest,JSON.stringify({key,sourceHash}));
    }
    bases.push(base); receiptClips.push({id:c.id??String(i),assetId:c.assetId??null,sourceHash,cacheKey:key,cacheHit:hit,duration:actual,requestedDuration:duration,trimStart:trim}); onProgress?.({stage:'base',index:i,cacheHit:hit});
  }
  let cursor=0;const clipCaptions=clips.flatMap((clip,i)=>{const start=cursor;cursor+=receiptClips[i].duration;return String(clip.caption||'').trim()?[{start,end:cursor,text:clip.caption}]:[];});
  const captionRows=prepareTimedCaptions(request.timeline.captions??clipCaptions,cursor);
  const captions=captionRows.map((caption,i)=>`${i+1}\n${stamp(caption.start)} --> ${stamp(caption.end)}\n${escSrt(caption.text)}\n`);
  const captionsFile=join(out,'captions.srt'); await writeFile(captionsFile,captions.join('\n'),'utf8');
  const inputs=[], vlabels=[], alabels=[]; clips.forEach((c,i)=>{inputs.push('-i',bases[i]);vlabels.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);const g=c.muted?0:(finite(Number(c.gain),8)?Number(c.gain):1);alabels.push(`[${i}:a]asetpts=PTS-STARTPTS,volume=${g}[a${i}]`);});
  const vf=vlabels.join(';')+`;${clips.map((_,i)=>`[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[vcat]`;
  const af=alabels.join(';')+`;${clips.map((_,i)=>`[a${i}]`).join('')}concat=n=${clips.length}:v=0:a=1[acat]`;
  let fc=`${vf};${af}`,audio='[acat]';
  if(!Array.isArray(request.audioTracks||[])||(request.audioTracks||[]).length>16)throw new Error('Use at most 16 audio layers');
  const layers=[...(request.soundtrack?.path?[request.soundtrack]:[]),...(request.audioTracks||[])].filter(t=>!t.muted),audioEvidence=[];
  for(let n=0;n<layers.length;n++){
    const layer=layers[n],sp=localPath(layer.path,'audio layer'),start=Number(layer.start??0),trim=Number(layer.trimStart??0),gain=Number(layer.gain??1);
    if(!finite(start,cursor)||start>=cursor||!finite(trim,21600)||!finite(gain,8))throw new Error('Audio layer timing or gain is outside bounds');
    const info=await probe(ffprobe,sp);if(!info.streams?.some(s=>s.codec_type==='audio')||trim>=Number(info.format?.duration||0))throw new Error('Audio layer has no usable audio at its trim point');
    inputs.push('-i',sp);const delay=Math.round(start*1000),index=clips.length+n;
    fc+=`;[${index}:a]atrim=start=${trim}:duration=${cursor-start},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${gain},adelay=${delay}|${delay}[layer${n}]`;
    audioEvidence.push({assetId:layer.assetId||null,sourceHash:await fileHash(sp),start,trimStart:trim,gain,provenance:layer.provenance||null});
  }
  if(layers.length){fc+=`;[acat]${layers.map((_,i)=>`[layer${i}]`).join('')}amix=inputs=${layers.length+1}:duration=first:dropout_transition=0:normalize=0[mix]`;audio='[mix]';}
  const loudnessPass=await run(ffmpeg,['-hide_banner','-nostats',...inputs,'-filter_complex',fc+`;${audio}loudnorm=I=${audioTargetLUFS}:TP=-2:LRA=11:print_format=json[analysis]`,'-map','[vcat]','-map','[analysis]','-f','null','-'],{captureStderr:true,timeout:300000});
  const loudnessJson=loudnessPass.stderr.match(/\{\s*"input_i"\s*:[\s\S]*?\}/);
  if(!loudnessJson)throw new Error('AUDIO_LOUDNESS_MEASUREMENT_FAILED');
  const loudness=JSON.parse(loudnessJson[0]),measured=['input_i','input_tp','input_lra','input_thresh','target_offset'].every(key=>Number.isFinite(Number(loudness[key])));
  const audioNormalization={method:measured?'two-pass-loudnorm':'silent-source',targetLufs:audioTargetLUFS,truePeakCeilingDb:-2,analysis:loudness};
  const normalize=measured?`loudnorm=I=${audioTargetLUFS}:TP=-2:LRA=11:measured_I=${Number(loudness.input_i)}:measured_TP=${Number(loudness.input_tp)}:measured_LRA=${Number(loudness.input_lra)}:measured_thresh=${Number(loudness.input_thresh)}:offset=${Number(loudness.target_offset)}:linear=true`:'anull';
  fc+=`;${audio}${normalize}[aout]`;audio='[aout]';
  // Short, transient-heavy edits may miss the target even after two-pass
  // loudnorm. Correct the PCM master in bounded passes before video encoding.
  let master=join(out,'audio-master-0.wav');
  await run(ffmpeg,['-y',...inputs,'-filter_complex',fc+';[vcat]nullsink','-map',audio,'-t',String(cursor),'-c:a','pcm_f32le','-ar','48000','-ac','2',master],{timeout:300000});
  const measureAudio=async path=>{
    const {stderr}=await run(ffmpeg,['-hide_banner','-nostats','-i',path,'-vn','-af',`loudnorm=I=${audioTargetLUFS}:TP=-3:LRA=11:print_format=json`,'-f','null','-'],{captureStderr:true,timeout:300000});
    const match=stderr.match(/\{\s*"input_i"\s*:[\s\S]*?\}/);if(!match)throw new Error('AUDIO_LOUDNESS_MEASUREMENT_FAILED');return JSON.parse(match[0]);
  };
  audioNormalization.corrections=[];
  // AAC can lower integrated loudness by a few tenths of a LU on short,
  // transient-heavy edits. Master PCM slightly above the delivery target so
  // the encoded file lands at -14 LUFS while retaining the true-peak margin.
  const masterTargetLufs=audioTargetLUFS+0.2,masterToleranceLufs=0.35;
  let masterLevel=await measureAudio(master);
  for(let pass=1;measured&&pass<=6&&(Math.abs(Number(masterLevel.input_i)-masterTargetLufs)>masterToleranceLufs||Number(masterLevel.input_tp)>-2.5);pass++){
    const next=join(out,`audio-master-${pass}.wav`);
    const gainDb=Math.max(-12,Math.min(12,masterTargetLufs-Number(masterLevel.input_i)));
    await run(ffmpeg,['-y','-i',master,'-af',`aresample=192000,volume=${gainDb}dB,alimiter=limit=0.668344:attack=5:release=50:level=false:latency=true,aresample=48000`,'-t',String(cursor),'-c:a','pcm_f32le','-ar','48000','-ac','2',next],{timeout:300000});
    master=next;masterLevel=await measureAudio(master);audioNormalization.corrections.push({method:'measured-gain-and-lookahead-limiter',gainDb,...masterLevel});
  }
  if(measured&&(Math.abs(Number(masterLevel.input_i)-masterTargetLufs)>0.6||Number(masterLevel.input_tp)>-2.5))throw new Error('AUDIO_DELIVERY_TARGET_UNREACHABLE: Adjust the mix dynamics and retry');
  audioNormalization.masterMeasurement=masterLevel;audioNormalization.masterFile=basename(master);
  const masterIndex=clips.length+layers.length;inputs.push('-i',master);fc=vf;audio=`${masterIndex}:a:0`;
  let videoLabel='[vcat]';const colorGrade=settings.colorGrade||null;
  if(colorGrade){const {contrast=1,saturation=1,gamma=1}=colorGrade;if([contrast,saturation,gamma].some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0.5||v>1.5))throw new Error('Color grade values must be between 0.5 and 1.5');fc+=`;[vcat]eq=contrast=${contrast}:saturation=${saturation}:gamma=${gamma}[vgraded]`;videoLabel='[vgraded]';}
  const captionStyle=`Fontname=Arial,Fontsize=${Math.max(11,Math.round(height/90))},Bold=1,Outline=2,Shadow=0,MarginV=${Math.max(34,Math.round(height/22))},Alignment=2,PrimaryColour=&H00F5F3FF,OutlineColour=&H900B0715`;
  const subtitleFilter=captions.length ? (rawCaptionStyle==='minimal-lower'?`;${videoLabel}${buildCaptionFilter({cues:captionRows,style:'minimal-lower',canvas:{width,height,fps},safeArea:{top:Math.round(height*.08),bottom:Math.round(height*.2),left:Math.round(width*.07),right:Math.round(width*.14)},fontFile:DEFAULT_CAPTION_FONT})}[vout]`:`;${videoLabel}subtitles='${filterPath(captionsFile)}':force_style='${captionStyle}'[vout]`) : '';
  const video=join(out,'render.mp4'), finalArgs=['-y',...inputs,'-filter_complex',fc+subtitleFilter,'-map',captions.length?'[vout]':videoLabel,'-map',audio,'-c:v','libx264','-threads','4','-preset','fast','-profile:v','high',...(width*height>=3840*2160?['-b:v','60M','-minrate','60M','-maxrate','60M','-bufsize','120M','-x264-params','nal-hrd=cbr:force-cfr=1']:['-crf','18']),'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart','-shortest',video]; await run(ffmpeg,finalArgs); audioNormalization.deliveryMeasurement=await measureAudio(video); if(measured&&(Math.abs(Number(audioNormalization.deliveryMeasurement.input_i)-audioTargetLUFS)>0.9||Number(audioNormalization.deliveryMeasurement.input_tp)>-1.5))throw new Error('AUDIO_DELIVERY_VERIFICATION_FAILED: Encoded audio missed loudness or peak limits'); await run(ffmpeg,['-v','error','-i',video,'-f','null','-']); const poster=join(out,'poster.png'); await run(ffmpeg,['-y','-i',video,'-frames:v','1',poster]); const fp=await probe(ffprobe,video); const renderDuration=receiptClips.reduce((sum,clip)=>sum+Number(clip.duration||0),0); const verification=await verifyMedia({videoPath:video,ffprobe,ffmpeg,expected:{width,height,fps,durationSeconds:renderDuration,requireAudio:true,requireVisual:true},captionsPath:captionsFile,requireCaptions:captions.length>0}); if(!verification.ok) throw new Error(`Rendered output failed technical verification: ${verification.diagnostics.map(d=>d.code).join(', ')}`); await writeFile(join(out,'ffprobe.json'),JSON.stringify(fp,null,2)); const inputHash=createHash('sha256').update(JSON.stringify(request)).digest('hex'); const receipt={schemaVersion:1,kind:'timeline',projectId:request.projectId??null,revision:request.revision??null,inputHash,provenance:{generationStatus:'edited',providerId:'ffmpeg-local',sourceMethod:'local-timeline-edit',outputHash:await fileHash(video),deliveryResolution:{width,height},fps,renderTimeMs:Date.now()-started,sources:receiptClips.map((c,i)=>({assetId:c.assetId,sourceHash:c.sourceHash,upstream:clips[i].provenance||{generationStatus:'imported'}})),fourKMethod:clips.some(c=>c.provenance?.generationStatus==='upscaled')?'Edit of verified AI-upscaled source':'Timeline canvas resize; no AI upscaling invoked'},audioNormalization,renderProfile:{framing,audioTargetLUFS,captionStyle:rawCaptionStyle||'generic'},colorGrade,audioLayers:audioEvidence,cache:{clips:receiptClips},outputs:{video:'render.mp4',poster:'poster.png',captions:'captions.srt',ffprobe:'ffprobe.json'},ffprobe:fp,verification}; await writeFile(join(out,'result.json'),JSON.stringify(receipt,null,2)); onProgress?.({stage:'complete',outputs:receipt.outputs,verification}); return receipt;
}
