import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { executeWanStage, wanWorkflow, WAN_MODELS } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';
import { createComfyUIProvider } from './providers/comfyui.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const fail = (code, message) => { throw Object.assign(new Error(`${code}: ${message}`), { code }); };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validateKeyframeRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('KEYFRAME_REQUEST', 'A production request object is required');
  const allowed = new Set(['projectId','expectedRevision','prompt','negativePrompt','seed','width','height','steps','queuePolicy','kind']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('KEYFRAME_REQUEST', 'Unknown generation controls are not accepted');
  if (typeof input.projectId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(input.projectId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('KEYFRAME_PROJECT', 'An existing project and exact revision are required');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 6000) fail('KEYFRAME_PROMPT', 'A prompt of 1–6000 characters is required');
  if (input.negativePrompt !== undefined && (typeof input.negativePrompt !== 'string' || !input.negativePrompt.trim() || input.negativePrompt.length > 2000)) fail('KEYFRAME_NEGATIVE_PROMPT','Additional exclusions must contain 1–2000 characters');
  const request = { kind:'generation-keyframe', projectId:input.projectId, expectedRevision:input.expectedRevision, prompt:input.prompt.trim(), ...(input.negativePrompt === undefined ? {} : {negativePrompt:input.negativePrompt.trim()}), seed:input.seed ?? 730251, width:input.width ?? 1024, height:input.height ?? 576, steps:input.steps ?? 20, queuePolicy:input.queuePolicy ?? 'idle' };
  if (input.kind && input.kind !== request.kind || !Number.isSafeInteger(request.seed) || request.seed < 0 || ![[512,288],[1024,576]].some(([w,h]) => request.width === w && request.height === h) || !Number.isInteger(request.steps) || request.steps < 8 || request.steps > 30 || !['idle','fifo'].includes(request.queuePolicy)) fail('KEYFRAME_PROFILE', 'Use a bounded local still profile (512×288 or 1024×576, 8–30 steps)');
  return request;
}

export async function canonicalKeyframeStore(dataDir) {
  const databasePath = await realpath(join(resolve(dataDir), 'vyrelum.sqlite'));
  const canonicalData = dirname(databasePath);
  return { databasePath, dataDir:canonicalData, jobsDir:await realpath(join(canonicalData,'jobs')), mediaDir:await realpath(join(canonicalData,'media')) };
}
async function inside(base, path) {
  const actual = await realpath(resolve(base,path)), rel = relative(base,actual);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) fail('KEYFRAME_OWNERSHIP', 'Generation evidence must remain inside its job');
  return actual;
}
const readJSON = async path => JSON.parse(await readFile(path,'utf8'));

/** This proves a saved PNG came through the exact local Wan sampler graph. It is
 * not an image realism/casting verdict and does not claim a generated video. */
export async function verifyKeyframeEvidence({jobRoot, request, ffmpeg = process.env.VYRELUM_FFMPEG || join(root,'workers/tools/ffmpeg.exe'), ffprobe = process.env.VYRELUM_FFPROBE || join(root,'workers/tools/ffprobe.exe')}) {
  request = validateKeyframeRequest(request);
  const base = await realpath(jobRoot), stageRoot = await inside(base,'keyframe');
  const workflow = await readJSON(await inside(stageRoot,'workflow.json'));
  const expected = wanWorkflow({prompt:request.prompt,negativePrompt:request.negativePrompt,seed:request.seed,width:request.width,height:request.height,steps:request.steps,frames:1,prefix:`vyrealm/${basename(base)}/keyframe`});
  if (!isDeepStrictEqual(workflow, expected)) fail('KEYFRAME_WORKFLOW', 'The saved still must come from the exact bounded text-to-image sampler graph');
  const workflowHash = hashJson(workflow), history = await readJSON(await inside(stageRoot,'history.json'));
  const promptId = history.prompt?.[1];
  if (typeof promptId !== 'string' || !promptId || history.status?.completed !== true || history.status.status_str !== 'success' || hashJson(history.prompt?.[2]) !== workflowHash) fail('KEYFRAME_PROVIDER_HISTORY', 'A successful matching local provider history is required');
  const events = (await readFile(await inside(stageRoot,'provider.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const event of ['submitted','completed']) if (!events.some(entry => entry.event === event && entry.promptId === promptId && entry.workflowHash === workflowHash)) fail('KEYFRAME_PROVIDER_LOG', 'Submission and completion logs must match the exact graph');
  const ledger = await readJSON(await inside(stageRoot,'frames.json')), descriptors = history.outputs?.['10']?.images;
  if (!Array.isArray(ledger) || ledger.length !== 1 || !Array.isArray(descriptors) || descriptors.length !== 1) fail('KEYFRAME_FRAME_COUNT','Exactly one generated PNG is required');
  const frame = ledger[0], descriptor = descriptors[0], providerPath = `${descriptor.subfolder}/${descriptor.filename}`.replaceAll('\\','/');
  if (frame.index !== 0 || frame.path !== 'frames/00000.png' || !isDeepStrictEqual(frame.providerOutput,descriptor) || descriptor.type !== 'output' || providerPath.split('/').includes('..') || !providerPath.startsWith(`${expected['10'].inputs.filename_prefix}_`)) fail('KEYFRAME_OUTPUT_OWNERSHIP','The PNG descriptor must belong to this provider prompt');
  const imagePath = await inside(stageRoot,frame.path), bytes = await readFile(imagePath);
  if (bytes.length < 128 || !bytes.subarray(0,8).equals(pngSignature) || sha(bytes) !== frame.sha256) fail('KEYFRAME_OUTPUT_HASH','Generated PNG bytes changed or are invalid');
  const {stdout} = await exec(ffprobe,['-v','error','-count_frames','-show_streams','-of','json',imagePath],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  const stream = JSON.parse(stdout).streams?.find(item => item.codec_type === 'video');
  if (stream?.codec_name !== 'png' || stream.width !== request.width || stream.height !== request.height || Number(stream.nb_read_frames) !== 1) fail('KEYFRAME_DECODE','The generated PNG does not decode at the requested resolution');
  await exec(ffmpeg,['-v','error','-xerror','-i',imagePath,'-frames:v','1','-f','null','-'],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  const evidenceHash = hashJson({schemaVersion:1,kind:'generated-keyframe',projectId:request.projectId,promptId,workflowHash,outputHash:frame.sha256,width:request.width,height:request.height});
  return {ok:true,imagePath,bytes,promptId,workflowHash,outputHash:frame.sha256,evidenceHash,width:request.width,height:request.height,decodedFrames:1};
}

export async function produceLocalKeyframe({jobRoot,request,provider=createComfyUIProvider(),onProgress=()=>{},ffmpeg,ffprobe}) {
  request = validateKeyframeRequest(request);
  if (provider.id !== 'comfyui-local') fail('KEYFRAME_PROVIDER','Only the loopback ComfyUI adapter is supported');
  const saved = validateKeyframeRequest(await readJSON(join(jobRoot,'request.json')));
  if (!isDeepStrictEqual(saved,request)) fail('KEYFRAME_REQUEST_CHANGED','The durable request differs; create a new job');
  const started = Date.now(), workflow = wanWorkflow({...request,frames:1,prefix:`vyrealm/${basename(jobRoot)}/keyframe`});
  await executeWanStage({provider,jobRoot,stage:'keyframe',workflow,frames:1,width:request.width,height:request.height,requiredModels:Object.values(WAN_MODELS),onProgress,waitForIdle:true,queuePolicy:request.queuePolicy});
  const evidence = await verifyKeyframeEvidence({jobRoot,request,ffmpeg,ffprobe});
  const provenance = {status:'generated',generationStatus:'generated',mediaKind:'image',providerId:provider.id,modelId:WAN_MODELS.diffusion,promptId:evidence.promptId,workflowHash:evidence.workflowHash,evidenceHash:evidence.evidenceHash,seed:request.seed,prompt:request.prompt,...(request.negativePrompt === undefined ? {} : {negativePrompt:request.negativePrompt}),outputHash:evidence.outputHash,sourceResolution:{width:request.width,height:request.height},finalResolution:{width:request.width,height:request.height},renderTimeMs:Date.now()-started,semanticQuality:'unreviewed',keyframe:{promptId:evidence.promptId,outputHash:evidence.outputHash}};
  const receipt = {schemaVersion:1,kind:'generated-keyframe',status:'review_required',validated:true,sourceMethod:'local-generated-keyframe',provenance,verification:{ok:true,decodedFrames:1,width:request.width,height:request.height,evidenceHash:evidence.evidenceHash},outputs:{image:'keyframe/frames/00000.png'},diagnostics:[{code:'KEYFRAME_VISUAL_REVIEW_REQUIRED',message:'This is one locally generated still, not a generated video. Casting, costume, environment, composition and defects require visual review before animation.'}]};
  await writeFile(join(jobRoot,'result.json'),JSON.stringify(receipt,null,2));
  return receipt;
}

/** The keyframe branch is deliberately separate from the existing reviewed-video
 * admission gate. With DB supplied, both canonical asset copy and durable review
 * must agree with the on-disk source and its model evidence. */
export async function verifyOwnedGeneratedKeyframe({jobsDir,sourceJobId,projectId,expectedHash,requireReview=true,db,mediaDir,ffmpeg,ffprobe}) {
  if (!/^[a-zA-Z0-9-]+$/.test(sourceJobId || '') || !hashPattern.test(expectedHash || '')) fail('KEYFRAME_REFERENCE','An owned job ID and exact PNG hash are required');
  const jobsRoot = await realpath(jobsDir), jobRoot = await inside(jobsRoot,sourceJobId);
  const request = validateKeyframeRequest(await readJSON(await inside(jobRoot,'request.json')));
  if (request.projectId !== projectId) fail('KEYFRAME_PROJECT','The keyframe belongs to another project');
  const receipt = await readJSON(await inside(jobRoot,'result.json')), p=receipt.provenance;
  if (receipt.kind !== 'generated-keyframe' || receipt.validated !== true || receipt.verification?.ok !== true || p?.mediaKind !== 'image' || p.generationStatus !== 'generated' || p.status !== 'generated' || p.providerId !== 'comfyui-local' || p.modelId !== WAN_MODELS.diffusion || p.outputHash !== expectedHash || receipt.outputs?.image !== 'keyframe/frames/00000.png') fail('KEYFRAME_RECEIPT','A valid local-generation PNG receipt is required');
  const evidence = await verifyKeyframeEvidence({jobRoot,request,ffmpeg,ffprobe});
  if (evidence.outputHash !== expectedHash || evidence.evidenceHash !== p.evidenceHash || evidence.promptId !== p.promptId || evidence.workflowHash !== p.workflowHash || p.keyframe?.outputHash !== expectedHash || p.keyframe?.promptId !== evidence.promptId || p.seed !== request.seed || p.prompt !== request.prompt || p.negativePrompt !== request.negativePrompt) fail('KEYFRAME_RECEIPT','The receipt differs from its provider evidence');
  if (requireReview && (receipt.review?.verdict !== 'passed' || receipt.review.outputHash !== expectedHash || receipt.review.mediaKind !== 'image' || receipt.review.evidenceHash !== evidence.evidenceHash)) fail('KEYFRAME_REVIEW','A passed review of this exact generated PNG is required');
  if (db) {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(sourceJobId), stored = job && JSON.parse(job.output || 'null');
    if (!job || job.type !== 'generation-keyframe' || job.project_id !== projectId || !['review_required','succeeded','rejected'].includes(job.status) || requireReview && job.status !== 'succeeded' || !stored || stored.provenance?.outputHash !== expectedHash || stored.provenance?.evidenceHash !== evidence.evidenceHash || !isDeepStrictEqual(stored.review,receipt.review)) fail('KEYFRAME_DATABASE','The durable keyframe job and review do not agree with the source');
    const assetId=stored.assets?.image, asset=assetId && db.prepare('SELECT * FROM assets WHERE id=?').get(assetId);
    if (!asset || asset.project_id !== projectId || JSON.parse(asset.document).jobId !== sourceJobId || !mediaDir) fail('KEYFRAME_ASSET','The keyframe must have a registered same-project image asset');
    const assetPath = await inside(await realpath(mediaDir),asset.path);
    if (sha(await readFile(assetPath)) !== expectedHash) fail('KEYFRAME_ASSET','The registered image differs from the reviewed generated PNG');
  }
  return {...evidence,sourceJobId,sourceEvidenceHash:evidence.evidenceHash,reviewedOutputHash:expectedHash,path:evidence.imagePath,sha256:expectedHash,receipt,request};
}
