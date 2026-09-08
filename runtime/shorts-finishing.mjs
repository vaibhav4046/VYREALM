import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPlan, DEFAULT_CAPTION_FONT } from './format-render.mjs';
import { buildCueList, buildCaptionFilter } from './format-captions.mjs';
import { buildAudioFilter } from './format-audio.mjs';
import { synthesizeSoundDesign } from './sound-design.mjs';
import { verifyMedia } from './media-verifier.mjs';

const exec = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const run = (command, args) => exec(command, args, { windowsHide:true, timeout:180000, maxBuffer:8*1024**2 });

/** Captions end when speech ends, rather than filling the entire shot silence.
 * Paging within a spoken line is approximate; this is not word alignment. */
export function speechCaptionCues(cues) {
  return cues.flatMap(cue => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || !Number.isFinite(cue.speechDurationSeconds) || cue.start < 0 || cue.speechDurationSeconds <= 0 || cue.start + cue.speechDurationSeconds > cue.end + 0.001) fail('SHORTS_SPEECH_TIMING', 'Actual speech must fit its planned shot');
    return buildCueList({text:cue.text,durationSeconds:cue.speechDurationSeconds,style:'single-line-center'}).map(page=>({...page,start:page.start+cue.start,end:page.end+cue.start}));
  });
}

/** Host queueAudio/queueRender adapter helper. The host must verify canonical
 * project ownership and durable review before supplying these source records.
 * This helper rechecks exact file bytes and durations before touching media. */
export async function finishShorts({ sources, narration, outputDir, audioConfigPath, ffmpeg, ffprobe, sound = null, captionsEnabled = true, width = 1080, height = 1920, onProgress = () => {} } = {}) {
  const started = Date.now();
  if (!Array.isArray(sources) || sources.length < 4 || sources.length > 6 || !Array.isArray(narration) || narration.length !== sources.length) fail('SHORTS_FINISH_INPUT','Provide 4–6 reviewed five-second clips and matching narration');
  if (![[1080,1920],[720,1280],[1920,1080],[1280,720]].some(pair=>pair[0]===width&&pair[1]===height)) fail('SHORTS_CANVAS','Use a 720p or 1080p portrait/landscape canvas');
  if (typeof captionsEnabled !== 'boolean') fail('SHORTS_CAPTIONS','captionsEnabled must be boolean');
  const durationSeconds = sources.length * 5, ledger = [], seen = new Set();
  for (const source of sources) {
    const bytes = await readFile(source.path), digest = sha(bytes);
    if (source.reviewedHash !== digest || source.sha256 !== digest || source.review !== 'passed') fail('SHORTS_SOURCE_REVIEW','Source bytes must match their passed review');
    if (seen.has(digest)) fail('SHORTS_DUPLICATE_SOURCE','Duplicate clips cannot pad the short'); seen.add(digest);
    const probe = JSON.parse((await run(ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',source.path])).stdout);
    if (!probe.streams.some(stream=>stream.codec_type==='video') || Math.abs(Number(probe.format.duration)-5)>0.05) fail('SHORTS_SOURCE_DURATION','Every source must be a real five-second video');
    ledger.push({id:source.id,path:await realpath(source.path),sha256:digest,sourceMethod:source.sourceMethod||'unknown',generationMs:Number.isFinite(source.generationMs)?source.generationMs:null});
  }
  const output = resolve(outputDir); await mkdir(output,{recursive:true});
  const actualOutput=await realpath(output);
  if(ledger.some(source=>{const rel=relative(actualOutput,source.path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..\\`)&&!rel.startsWith('../');})) fail('SHORTS_OUTPUT_OVERLAP','Source media must be outside the finishing job directory');
  const voiceDir = join(output,'voice'); await mkdir(voiceDir,{recursive:true});
  const cues = narration.map((text,i)=>({start:i*5,end:(i+1)*5,text}));
  const requestPath = join(output,'voice-request.json');
  await writeFile(requestPath,JSON.stringify({operation:'voiceover',text:narration.join(' '),cues,durationSeconds}));
  const config = JSON.parse(await readFile(audioConfigPath,'utf8'));
  const audioStarted = Date.now(); onProgress({stage:'narration'});
  await run(config.python,[fileURLToPath(new URL('../workers/audio-local.py',import.meta.url)),'--request',requestPath,'--output',voiceDir,'--config',resolve(audioConfigPath)]);
  const voice = JSON.parse(await readFile(join(voiceDir,'result.json'),'utf8'));
  if (!voice.validated || voice.cues?.length!==cues.length) fail('SHORTS_VOICE_FAILED','Piper did not produce every timed speech cue');
  const audioMs = Date.now()-audioStarted;
  const captions = speechCaptionCues(voice.cues);
  const soundStarted=Date.now();let soundEvidence=null, soundPath=null;
  if (sound) { const generated=synthesizeSoundDesign({...sound,durationSeconds});soundPath=join(output,'sound.wav');await writeFile(soundPath,generated.wave);soundEvidence=generated.evidence; }
  const soundMs=Date.now()-soundStarted;
  onProgress({stage:'picture'}); const picture=join(output,'picture.mp4'), assemblyStarted=Date.now();
  const plan={formatId:'reviewed-short',platform:'youtube-shorts',durationSeconds,canvas:{width,height,fps:24},grade:{id:'neutral'},captionStyle:{id:'none'},
    timeline:sources.map((source,i)=>({shotRole:`s${i}`,role:i===0?'hook':i===sources.length-1?'payoff':'progression',motion:'hold',durationSeconds:5}))};
  const shotLibrary=Object.fromEntries(sources.map((source,i)=>[`s${i}`,{path:source.path}]));
  const pictureReceipt=await renderPlan({plan,shotLibrary,output:picture,workDir:join(output,'picture-work'),ffmpeg,ffprobe,allowExtension:false});
  const captionFilter=captionsEnabled?buildCaptionFilter({cues:captions,style:'minimal-lower',canvas:plan.canvas,safeArea:{top:Math.round(height*.1),bottom:Math.round(height*.2),left:Math.round(width*.07),right:Math.round(width*.14)},fontFile:DEFAULT_CAPTION_FONT}):null;
  const args=['-y','-v','error','-i',picture,'-i',join(voiceDir,'narration.wav')];
  const inputs=[{kind:'narration',index:1}];if(soundPath){args.push('-i',soundPath);inputs.push({kind:'ambience',index:2});}
  const mix=buildAudioFilter({bed:{music:false,narration:true,ambience:Boolean(soundPath),duckDb:-12,targetLufs:-16},inputs,durationSeconds});
  const final=join(output,'short.mp4');
  args.push('-filter_complex',`${captionFilter?`[0:v]${captionFilter}[picture];`:''}${mix.filter}`,'-map',captionFilter?'[picture]':'0:v:0','-map',`[${mix.outLabel}]`);
  args.push(...(captionFilter?['-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p']:['-c:v','copy']),'-c:a','aac','-b:a','192k','-movflags','+faststart',final);
  await run(ffmpeg,args); const assemblyMs=Date.now()-assemblyStarted;
  onProgress({stage:'verification'});
  await run(ffmpeg,['-v','error','-xerror','-i',final,'-f','null','-']);
  const verification=await verifyMedia({videoPath:final,ffmpeg,ffprobe,expected:{width,height,fps:24,durationSeconds,requireAudio:true,requireVisual:true}});
  if(!verification.ok)fail('SHORTS_EXPORT_FAILED',verification.diagnostics.map(d=>d.code).join(', '));
  const outputHash=sha(await readFile(final));
  const result={schemaVersion:1,status:'review_required',outputs:{video:final},outputHash,durationSeconds,sourceMode:'reviewed-existing-clips',
    sources:ledger,voice:voice.provenance,sound:soundEvidence,captions:{enabled:captionsEnabled,cues:captionsEnabled?captions:[],timingMethod:'actual-utterance-duration; proportional paging, not word alignment'},
    timings:{totalMs:Date.now()-started,audioMs,soundMs,assemblyMs,sourceGenerationMs:ledger.every(s=>s.generationMs!==null)?ledger.reduce((sum,s)=>sum+s.generationMs,0):null,sourceGenerationIncludedInTotal:false},
    picture:pictureReceipt,verification,visualQuality:'requires-human-review',audioQuality:'requires-listening-review'};
  await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));return result;
}
