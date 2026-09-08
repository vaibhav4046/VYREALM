import assert from 'node:assert/strict';
import {mkdir,rm,stat,readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {renderTimeline} from './timeline.mjs';

const root=resolve(import.meta.dirname,'..');
const ffmpeg=resolve(root,'workers/tools/ffmpeg.exe');
const ffprobe=resolve(root,'workers/tools/ffprobe.exe');
const dir=resolve(root,'work/timeline-tests');
const run=(args)=>new Promise((ok,bad)=>{const p=spawn(ffmpeg,args,{windowsHide:true,stdio:'ignore'});p.on('error',bad);p.on('close',c=>c?bad(new Error(`ffmpeg ${c}`)):ok());});
const capture=(args)=>new Promise((ok,bad)=>{const p=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','ignore']});const b=[];p.stdout.on('data',x=>b.push(x));p.on('error',bad);p.on('close',c=>c?bad(new Error(`ffmpeg ${c}`)):ok(Buffer.concat(b)));});
test('renders trimmed ordered clips with captions, soundtrack, and reusable bases',async()=>{
  await rm(dir,{recursive:true,force:true}); await mkdir(dir,{recursive:true});
  const source=join(dir,'source.mp4'), image=join(dir,'still.png'), music=join(dir,'music.wav');
  await run(['-y','-f','lavfi','-i','color=c=red:s=160x90:r=10:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:d=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','pcm_s16le','-shortest',source]);
  await run(['-y','-f','lavfi','-i','color=c=blue:s=160x90:d=1','-frames:v','1',image]);
  await run(['-y','-f','lavfi','-i','sine=frequency=220:sample_rate=48000:d=2','-c:a','pcm_s16le',music]);
  const request={schemaVersion:1,kind:'timeline',projectId:'test',revision:1,settings:{width:160,height:90,fps:10},timeline:{clips:[{id:'a',assetId:'src',path:source,kind:'video',duration:0.7,trimStart:0.4,caption:'Hello & <world>',gain:0.5},{id:'b',assetId:'still',path:image,kind:'image',duration:0.5,caption:'Second',muted:true}]},soundtrack:{path:music,assetId:'music',gain:0.2}};
  const out=join(dir,'out'); const first=await renderTimeline(request,{output:out,ffmpeg,ffprobe,cacheDir:join(dir,'cache')});
  assert.equal(first.outputs.video,'render.mp4'); assert.equal(first.outputs.captions,'captions.srt'); assert.equal(first.cache.clips.length,2);
  const srt=await readFile(join(out,'captions.srt'),'utf8'); assert.match(srt,/Hello &amp; &lt;world&gt;/); assert.match(srt,/00:00:00,700/);
  assert.ok((await stat(join(out,'poster.png'))).size>0); assert.ok(first.ffprobe.streams.some(s=>s.codec_type==='audio')); assert.ok(Math.abs(Number(first.ffprobe.format.duration)-1.2)<0.15);
  const early=await capture(['-v','error','-ss','0.2','-i',join(out,'render.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']); const late=await capture(['-v','error','-ss','0.95','-i',join(out,'render.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']); assert.ok(early[0]>180&&early[2]<100,'first trimmed clip should be red'); assert.ok(late[2]>130&&late[0]<100,'ordered second clip should be blue');
  const second=await renderTimeline({...request,timeline:{...request.timeline,clips:request.timeline.clips.map((c,i)=>({...c,caption:i?'Changed':'Hello & <world>'}))}},{output:out,ffmpeg,ffprobe,cacheDir:join(dir,'cache')});
  assert.ok(second.cache.clips.every(c=>c.cacheHit));
  const changed=await renderTimeline({...request,timeline:{...request.timeline,clips:[{...request.timeline.clips[0],trimStart:0.1},request.timeline.clips[1]]}},{output:out,ffmpeg,ffprobe,cacheDir:join(dir,'cache')});
  assert.equal(changed.cache.clips[0].cacheHit,false); assert.equal(changed.cache.clips[1].cacheHit,true);
});

test('scheduled audio layer starts at its saved time and preserves full video duration',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'vyrealm-audio-layer-')),image=join(temp,'source.mp4'),tone=join(temp,'tone.wav');
  await run(['-y','-f','lavfi','-i','testsrc2=s=160x90:r=24:d=2','-c:v','libx264','-pix_fmt','yuv420p',image]);
  await run(['-y','-f','lavfi','-i','sine=frequency=330:sample_rate=48000:d=1','-c:a','pcm_s16le',tone]);
  const request={schemaVersion:1,kind:'timeline',settings:{width:160,height:90,fps:24},timeline:{clips:[{id:'source',kind:'video',path:image,duration:2}]},audioTracks:[{path:tone,assetId:'sound',start:1,gain:0.8}]};
  const out=join(temp,'out'),receipt=await renderTimeline(request,{output:out,ffmpeg,ffprobe,cacheDir:temp});
  assert.equal(receipt.audioLayers[0].start,1);assert.equal(receipt.audioLayers[0].sourceHash.length,64);assert.equal(receipt.ffprobe.streams.find(s=>s.codec_type==='video').nb_frames,'48');
  const rms=async at=>{const b=await capture(['-v','error','-ss',String(at),'-i',join(out,'render.mp4'),'-t','0.2','-vn','-ac','1','-f','s16le','pipe:1']);let sum=0;for(let i=0;i<b.length;i+=2)sum+=b.readInt16LE(i)**2;return Math.sqrt(sum/(b.length/2));};
  assert.ok(await rms(0.2)<5,'no early sound before the scheduled cue');assert.ok(await rms(1.2)>100,'scheduled sound is audible');
  await assert.rejects(renderTimeline({...request,audioTracks:[{path:tone,start:3}]},{output:out,ffmpeg,ffprobe,cacheDir:temp}),/outside bounds/);
});

test('delivery normalizes quiet source audio to the measured loudness target',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'vyrealm-loudness-')),source=join(temp,'quiet.mp4');
  await run(['-y','-f','lavfi','-i','testsrc2=s=160x90:r=24:d=5','-f','lavfi','-i','sine=frequency=330:sample_rate=48000:d=5','-af','volume=0.05','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  const out=join(temp,'out');const receipt=await renderTimeline({schemaVersion:1,kind:'timeline',settings:{width:160,height:90,fps:24},timeline:{clips:[{kind:'video',path:source,duration:5}]}},{output:out,ffmpeg,ffprobe,cacheDir:temp});
  // Read FFmpeg's delivered-file measurement independently of the worker receipt.
  const report=await new Promise((ok,bad)=>{const p=spawn(ffmpeg,['-hide_banner','-nostats','-i',join(out,'render.mp4'),'-vn','-af','loudnorm=I=-14:TP=-2:LRA=11:print_format=json','-f','null','-'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let text='';p.stderr.on('data',b=>text+=b);p.on('error',bad);p.on('close',code=>code?bad(new Error(text)):ok(JSON.parse(text.match(/\{\s*"input_i"\s*:[\s\S]*?\}/)[0])));});
  assert.equal(receipt.audioNormalization.method,'two-pass-loudnorm');
  assert.ok(Math.abs(Number(report.input_i)+14)<0.5,`Delivered loudness ${report.input_i} LUFS`);
  assert.ok(Number(report.input_tp)<=-1.5,`Delivered true peak ${report.input_tp} dBTP`);
});
