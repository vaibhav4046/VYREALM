import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProduction } from '../runtime/director.mjs';
import { renderTimeline } from './timeline.mjs';
import { renderAssetFirstTrailer } from '../runtime/asset-first-trailer.mjs';
import { renderProductVideo } from '../runtime/product-video.mjs';
import { preflightGeneration } from '../runtime/generation-gate.mjs';

const args=process.argv.slice(2), value=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const inputPath=value('--input'), output=resolve(value('--output')||'./produce-output');
if(!inputPath) throw new Error('Missing --input JSON path');
await mkdir(output,{recursive:true});
const workerRoot=fileURLToPath(new URL('..',import.meta.url));
const bundledFfmpeg=fileURLToPath(new URL('./tools/ffmpeg.exe',import.meta.url));
const bundledFfprobe=fileURLToPath(new URL('./tools/ffprobe.exe',import.meta.url));
const request=JSON.parse(await readFile(resolve(inputPath),'utf8'));
if (request.mode === 'product') {
  const receipt = await renderProductVideo({ input: request.productAssetPath, output, ffmpeg: process.env.VYRELUM_FFMPEG || bundledFfmpeg, ffprobe: process.env.VYRELUM_FFPROBE || bundledFfprobe, template: request.productTemplate || 'studio', camera: request.productCamera || 'dolly-in', width: Number(request.width) || 1080, height: Number(request.height) || 1920, fps: Number(request.fps) || 24, durationSeconds: Number(request.durationSeconds) || 15, aspectRatio: request.aspectRatio || '9:16' });
  await writeFile(join(output, 'result.json'), JSON.stringify({ ...receipt, projectId: request.projectId || null, revision: request.revision || null }, null, 2));
  console.log(JSON.stringify(receipt)); process.exit(0);
}
// Cinematic production is asset-first. Neural generation is a hard capability
// gate: without a qualified provider and a reviewed adapter, VYREALM must
// block instead of falling through to Blender primitives or calling an
// imported image "generated". The bundled rain-market fixture is an explicit
// fallback route and is labelled as such in provenance.
if (request.type !== 'direct' && (request.mode === 'cinematic' || request.sampleId === 'rain-market' || Array.isArray(request.shots))) {
  const hasSources = request.sampleId === 'rain-market' || (Array.isArray(request.shots) && request.shots.length > 0);
  const explicitFallback = request.sampleId === 'rain-market' || request.sourceMethod === 'fallback' || request.allowFallback === true;
  const neuralRequested = request.generationMode === 'neural' || request.neural === true || request.providerId || request.provider;
  if (!hasSources) {
    const gate = await preflightGeneration({ root: workerRoot });
    const blocked = { schemaVersion: 1, status: 'blocked', code: gate.code || 'BLOCKED_NEURAL_GENERATION', provenance: { generationStatus: 'blocked', providerId: gate.provider || null, modelId: gate.modelId || null }, providerReport: gate.providerReport, diagnostics: [{ code: gate.code || 'BLOCKED_NEURAL_GENERATION', message: gate.message || 'No qualified local generation provider is available.' }] };
    await writeFile(join(output, 'result.json'), JSON.stringify(blocked, null, 2)); console.log(JSON.stringify(blocked)); process.exit(0);
  }
  if (neuralRequested) {
    const gate = await preflightGeneration({ root: workerRoot });
    const blocked = { schemaVersion: 1, status: 'blocked', code: gate.status === 'ready' ? 'NEURAL_ADAPTER_SMOKE_TEST_REQUIRED' : gate.code, provenance: { generationStatus: 'blocked', providerId: gate.provider || null, modelId: gate.modelId || null }, providerReport: gate.providerReport, diagnostics: [{ code: gate.status === 'ready' ? 'NEURAL_ADAPTER_SMOKE_TEST_REQUIRED' : gate.code, message: gate.status === 'ready' ? 'A provider is detected, but no reviewed image-to-video adapter has produced an in-job clip.' : gate.message }] };
    await writeFile(join(output, 'result.json'), JSON.stringify(blocked, null, 2)); console.log(JSON.stringify(blocked)); process.exit(0);
  }
  if (!explicitFallback && !Array.isArray(request.shots)) {
    const blocked = { schemaVersion: 1, status: 'blocked', code: 'CINEMATIC_SOURCES_REQUIRED', provenance: { generationStatus: 'blocked' }, diagnostics: [{ code: 'CINEMATIC_SOURCES_REQUIRED', message: 'Add one local image or video source for every cinematic shot, or explicitly choose the labelled fallback.' }] };
    await writeFile(join(output, 'result.json'), JSON.stringify(blocked, null, 2)); console.log(JSON.stringify(blocked)); process.exit(0);
  }
  const sourceMethod = explicitFallback ? 'fallback-asset-first-keyframes' : 'imported-local-media';
  const receipt = await renderAssetFirstTrailer({ output, ffmpeg: process.env.VYRELUM_FFMPEG || bundledFfmpeg, ffprobe: process.env.VYRELUM_FFPROBE || bundledFfprobe, width: Number(request.width) || 1920, height: Number(request.height) || 1080, fps: Number(request.fps) || 24, durationSeconds: Math.max(15, Number(request.durationSeconds) || 15), captions: Boolean(request.captions), shots: request.shots, sourceMethod });
  const provenance = { generationStatus: explicitFallback ? 'fallback' : 'imported', providerId: null, modelId: null, workflowHash: null, seed: null, prompt: request.brief || '', sourceMethod, fourKMethod: 'optional-temporal-safe-local-upscale' };
  await writeFile(join(output,'result.json'), JSON.stringify({ ...receipt, provenance, projectId: request.projectId || null, revision: request.revision || null, outputs: { video: receipt.outputs.video, ...(receipt.outputs.captions ? { captions: receipt.outputs.captions } : {}) } }, null, 2));
  console.log(JSON.stringify(receipt)); process.exit(0);
}
if(request.mode!=='abstract'){
  const blocked={status:'blocked',code:'BLOCKED_NEURAL_GENERATION',provenance:{generationStatus:'blocked'},diagnostics:[{code:'BLOCKED_NEURAL_GENERATION',message:'Cinematic requests require a verified local model job or explicit user media. Primitive scene generation is available only in an explicitly selected abstract template.'}]};
  await writeFile(join(output,'result.json'),JSON.stringify(blocked,null,2));process.exit(0);
}
const plan=await createProduction({brief:request.brief,projectId:request.projectId,revision:request.revision,durationSeconds:request.durationSeconds||12,fps:request.fps||24,capabilities:request.capabilities||{}});
if(plan.status==='blocked') { await writeFile(join(output,'result.json'),JSON.stringify(plan,null,2)); console.log(JSON.stringify(plan)); process.exit(0); }
const sceneDir=join(output,'scene'), timelineDir=join(output,'timeline'); await mkdir(sceneDir,{recursive:true}); await mkdir(timelineDir,{recursive:true});
const requestedWidth=Number(request.width)||Number(plan.scene.render?.width)||640;
const requestedHeight=Number(request.height)||Number(plan.scene.render?.height)||360;
const sceneRequest=join(output,'scene-request.json'); await writeFile(sceneRequest,JSON.stringify({schemaVersion:1,kind:'scene',projectId:plan.projectId,revision:plan.revision,scene:{...plan.scene,render:{...plan.scene.render,frames:plan.durationFrames,fps:plan.fps,width:requestedWidth,height:requestedHeight}},},null,2));
const render=spawn(process.execPath,[fileURLToPath(new URL('./render.mjs',import.meta.url)),'--input',sceneRequest,'--output',sceneDir],{cwd:workerRoot,windowsHide:true,stdio:['ignore','pipe','pipe']}); let stderr=''; render.stderr.on('data',x=>{stderr+=x.toString().slice(-4000)}); const code=await new Promise((ok,bad)=>{render.on('error',bad);render.on('close',ok)}); if(code!==0) throw new Error(`Scene render failed: ${stderr.slice(-1500)}`);
const sceneResult=JSON.parse(await readFile(join(sceneDir,'result.json'),'utf8')); const clips=plan.timeline.map(shot=>({id:shot.id,kind:'video',path:join(sceneDir,'render.mp4'),duration:shot.duration,trimStart:shot.startFrame/plan.fps,caption:shot.caption||''}));
const timelineResult=await renderTimeline({schemaVersion:1,kind:'timeline',projectId:plan.projectId,revision:plan.revision,settings:{width:requestedWidth,height:requestedHeight,fps:plan.fps},timeline:{clips}},{output:timelineDir,ffmpeg:process.env.VYRELUM_FFMPEG||bundledFfmpeg,ffprobe:process.env.VYRELUM_FFPROBE||bundledFfprobe,cacheDir:resolve(process.env.VYRELUM_RUNTIME_DIR||join(join(workerRoot,'data','runtime')),'timeline-cache')});
const result={...plan,scene:plan.scene,outputs:{video:'timeline/render.mp4',poster:'timeline/poster.png',captions:'timeline/captions.srt',blend:'scene/scene.blend',sourceVideo:'scene/render.mp4'},renderEvidence:{scene:sceneResult,final:timelineResult}}; await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
