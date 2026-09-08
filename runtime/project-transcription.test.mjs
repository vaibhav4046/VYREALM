import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';import {projectTranscriptionUpdate} from './project-transcription.mjs';import {renderTimeline} from '../workers/timeline.mjs';

test('trimmed transcription persists in edit time, reopens, and renders a real captioned five-second export',{timeout:60000},async()=>{
 const folder=await mkdtemp(join(tmpdir(),'vyrealm-trim-caption-')),source=join(folder,'source.mp4'),dbPath=join(folder,'project.sqlite');
 const ffmpeg=resolve('workers/tools/ffmpeg.exe'),ffprobe=resolve('workers/tools/ffprobe.exe');
 const run=args=>new Promise((resolve,reject)=>{const p=spawn(ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});const buffers=[];let error='';p.stdout.on('data',d=>buffers.push(d));p.stderr.on('data',d=>error=(error+d).slice(-1000));p.on('error',reject);p.on('exit',code=>code?reject(Error(error)):resolve(Buffer.concat(buffers)));});
 await run(['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x202020:s=320x180:r=24:d=10','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',source]);
 const original=[{start:5.25,end:6.25,text:'The retained words'}];
 const project={id:'trim-before-transcribe',revision:2,timeline:[{id:'trim',assetId:'source',kind:'video',duration:5,trimStart:5}],settings:{width:320,height:180,fps:24}};
 const update=projectTranscriptionUpdate({project,sourceAssetId:'source',jobId:'transcription',segments:original,provenance:{generationStatus:'transcribed',sourceMethod:'known-timing-test-fixture'}});
 assert.deepEqual(update.transcript,[{start:.25,end:1.25,text:'The retained words'}]);assert.equal(update.transcriptSource.coordinateSpace,'timeline');assert.equal(original[0].start,5.25);
 const db=new DatabaseSync(dbPath);db.exec('CREATE TABLE projects(document TEXT)');db.prepare('INSERT INTO projects VALUES(?)').run(JSON.stringify({...project,...update}));db.close();
 const reopened=new DatabaseSync(dbPath);const saved=JSON.parse(reopened.prepare('SELECT document FROM projects').get().document);reopened.close();
 const output=join(folder,'render');const receipt=await renderTimeline({schemaVersion:1,kind:'timeline',projectId:saved.id,revision:3,settings:saved.settings,timeline:{clips:saved.timeline.map(c=>({...c,path:source})),captions:saved.transcript}},{output,ffmpeg,ffprobe,cacheDir:join(folder,'cache')});
 const srt=await readFile(join(output,'captions.srt'),'utf8');assert.match(srt,/00:00:00,250 --> 00:00:01,250/);assert.doesNotMatch(srt,/00:00:05,250/);
 assert.equal(receipt.ffprobe.streams.find(s=>s.codec_type==='video').nb_frames,'120');
 await run(['-v','error','-i',join(output,'render.mp4'),'-f','null','-']);
 const white=async seconds=>{const b=await run(['-v','error','-ss',String(seconds),'-i',join(output,'render.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);let count=0;for(let i=0;i<b.length;i+=3)if(b[i]>160&&b[i+1]>160&&b[i+2]>160)count++;return count;};
 const during=await white(.5),after=await white(2);assert.ok(during>after+30,'Caption must be visible in the retained edit interval and absent after it');
 await writeFile(join(folder,'evidence.json'),JSON.stringify({scope:'Known transcript fixture; real SQLite reopen and FFmpeg render, no speech-model inference',passed:true,rawSourceCues:original,editCues:saved.transcript,decodedFrames:120,whitePixels:{during,after}},null,2));
 console.log('Caption regression evidence: '+folder);
});

test('narration without a visual placement keeps its timing and cannot inherit another clip trim',()=>{
 const project={timeline:[{id:'other',assetId:'different',duration:5,trimStart:10}],settings:{fps:24}};
 const segments=[{start:.1,end:1,text:'Local narration'}];const result=projectTranscriptionUpdate({project,sourceAssetId:'narration',jobId:'voice-captions',segments,provenance:{}});
 assert.deepEqual(result.transcript,segments);assert.notEqual(result.transcript,segments);assert.equal(result.transcriptSource.coordinateSpace,'source');assert.equal(result.transcriptSource.mapping,undefined);
});

const narrationInput=project=>({project,sourceAssetId:'narration',jobId:'captions',segments:[{start:.2,end:1,text:'Narration words'}],provenance:{providerId:'faster-whisper-local-cpu'}});
const audioProject=()=>({timeline:[{id:'visual',assetId:'footage',trimStart:7,duration:5}],settings:{fps:24}});
test('zero-offset ordinary narration preserves source timing',()=>{
 const p=audioProject();p.soundtrack={assetId:'narration',gain:1,muted:false};const result=projectTranscriptionUpdate(narrationInput(p));assert.deepEqual(result.transcript,[{start:.2,end:1,text:'Narration words'}]);assert.equal(result.transcriptSource.coordinateSpace,'source');
});
test('shifted or trimmed soundtrack narration blocks rather than silently placing global captions',()=>{
 for(const placement of [{start:2},{trimStart:3},{start:3,trimStart:3}]){const p=audioProject();p.soundtrack={assetId:'narration',...placement};const before=structuredClone(p);assert.throws(()=>projectTranscriptionUpdate(narrationInput(p)),e=>e.code==='TRANSCRIPT_AUDIO_OFFSET_UNSUPPORTED'&&/assembled export/.test(e.message));assert.deepEqual(p,before);}
});
test('a displaced matching audio layer blocks even when an undisplaced copy also exists',()=>{
 const p=audioProject();p.soundtrack={assetId:'narration'};p.audioTracks=[{id:'layer',assetId:'narration',start:1.5,trimStart:0}];assert.throws(()=>projectTranscriptionUpdate(narrationInput(p)),e=>e.code==='TRANSCRIPT_AUDIO_OFFSET_UNSUPPORTED');
});
test('unrelated displaced layers do not block normal narration or visual source mapping',()=>{
 const p=audioProject();p.soundtrack={assetId:'narration',start:0,trimStart:0};p.audioTracks=[{id:'rain',assetId:'rain',start:3,trimStart:2}];assert.equal(projectTranscriptionUpdate(narrationInput(p)).transcript[0].start,.2);
 const result=projectTranscriptionUpdate({...narrationInput(p),sourceAssetId:'footage',segments:[{start:7.2,end:8,text:'Visible speech'}]});assert.equal(result.transcript[0].start,.2);assert.equal(result.transcriptSource.coordinateSpace,'timeline');
});
test('invalid matched audio offsets fail with a precise placement diagnostic',()=>{
 for(const placement of [{start:NaN},{start:-1},{trimStart:Infinity},{trimStart:-1}]){const p=audioProject();p.audioTracks=[{assetId:'narration',...placement}];assert.throws(()=>projectTranscriptionUpdate(narrationInput(p)),e=>e.code==='TRANSCRIPT_AUDIO_PLACEMENT_INVALID');}
});
