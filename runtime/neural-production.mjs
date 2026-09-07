import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createComfyUIProvider } from './providers/comfyui.mjs';
import { recordGeneratedProvenance, hashJson } from './generation-gate.mjs';
import { verifyMedia } from './media-verifier.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
export const WAN_MODELS = Object.freeze({ diffusion: 'Wan2.2-TI2V-5B-Q4_K_M.gguf', text: 'umt5-xxl-encoder-Q4_K_S.gguf', vae: 'wan2.2_vae.safetensors' });
export const SMOKE_PROMPT = 'An original adult woman with short dark wet hair, wearing a detailed charcoal rain jacket, stands beneath a warm stall lamp in a busy rain-soaked night market. Close cinematic portrait, her face clearly visible, fabric texture, market stalls in the middle distance, soft neon reflections behind her, shallow depth of field. She hears a sound, turns her head and looks over her shoulder, eyebrows rising, wet strands of hair move, rain falls continuously, distant people move naturally. Slow restrained handheld camera push in, realistic skin and materials, coherent lighting. No text or watermark.';
const NEGATIVE = 'static frozen image, slideshow, vector art, cartoon, geometric primitives, text, subtitles, watermark, black empty background, distorted face, deformed hands, duplicated limbs, unstable geometry, oversaturated, low quality';

export function wanWorkflow({ prompt = SMOKE_PROMPT, seed = 7092026, frames = 121, steps = 20, width = 512, height = 288, imageName, prefix }) {
  if (!/^[a-zA-Z0-9_/-]+$/.test(prefix || '')) throw new Error('INVALID_OUTPUT_PREFIX');
  if (![1, 33, 61, 121].includes(frames) || steps < 1 || steps > 30 || width % 32 || height % 32 || width * height > 1024 * 576) throw new Error('NEURAL_PROFILE_OUT_OF_BOUNDS');
  const workflow = {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: WAN_MODELS.diffusion } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: WAN_MODELS.text, type: 'wan' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: WAN_MODELS.vae } },
    '4': { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: 8 } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '7': { class_type: 'Wan22ImageToVideoLatent', inputs: { vae: ['3', 0], width, height, length: frames, batch_size: 1, ...(imageName ? { start_image: ['11', 0] } : {}) } },
    '8': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0], seed, steps, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: prefix } },
    '12': { class_type: 'SaveLatent', inputs: { samples: ['8', 0], filename_prefix: `${prefix}_latent` } },
  };
  if (imageName) workflow['11'] = { class_type: 'LoadImage', inputs: { image: imageName } };
  return workflow;
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function failure(code, message) { return Object.assign(new Error(message), { code }); }
async function run(cmd, args, log, timeout = 300000) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-6000); if (log) void appendFile(log, chunk); });
    child.on('error', e => { clearTimeout(timer); fail(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error(`${cmd} exited ${code}: ${error}`)); });
  });
}

async function readJsonIfPresent(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// The uploaded name is part of the sampler graph. Retain it across retries;
// uploading under a new name would invalidate an already completed stage.
export async function ensureWanInput({ provider, jobRoot, path, expectedHash }) {
  const bytes = await readFile(path);
  if (sha(bytes) !== expectedHash) throw failure('REFERENCE_INTEGRITY_FAILED', 'The retained keyframe has changed');
  const receiptPath = join(jobRoot, 'input-upload.json');
  const cached = await readJsonIfPresent(receiptPath);
  if (cached) {
    if (cached.sha256 !== expectedHash || typeof cached.imageName !== 'string' || !cached.imageName || cached.imageName.replaceAll('\\', '/').split('/').includes('..')) throw failure('INPUT_UPLOAD_CHANGED', 'The uploaded reference no longer matches this job');
    return cached.imageName;
  }
  // Recover jobs written before upload receipts were introduced.
  const retainedWorkflow = await readJsonIfPresent(join(jobRoot, 'motion', 'workflow.json'));
  const priorName = retainedWorkflow?.['11']?.inputs?.image;
  if (priorName) {
    await writeFile(receiptPath, JSON.stringify({ imageName: priorName, sha256: expectedHash, recoveredFromWorkflow: true }, null, 2));
    return priorName;
  }
  const upload = await provider.upload_inputs([{ data: bytes, filename: `vyrealm-${randomUUID()}.png` }]);
  const item = upload.uploaded?.[0];
  const imageName = item?.subfolder ? `${item.subfolder}/${item.name}` : item?.name;
  if (!imageName || item.type !== 'input' || imageName.replaceAll('\\', '/').split('/').includes('..')) throw failure('INPUT_UPLOAD_INVALID', 'Provider returned an invalid keyframe input');
  const query = new URLSearchParams({ filename: item.name, subfolder: item.subfolder || '', type: 'input' });
  const response = await provider.fetch(`${provider.baseUrl}/view?${query}`, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok || sha(Buffer.from(await response.arrayBuffer())) !== expectedHash) throw failure('INPUT_UPLOAD_HASH_MISMATCH', 'Provider input does not match the generated reference');
  await writeFile(receiptPath, JSON.stringify({ imageName, sha256: expectedHash, uploadedAt: new Date().toISOString() }, null, 2));
  return imageName;
}

async function recoverCompletedStage({ stageRoot, workflow, frames, submission, events }) {
  const workflowHash = hashJson(workflow);
  if (!submission || !events.some(e => e.event === 'completed' && e.promptId === submission.promptId && e.workflowHash === workflowHash)) return null;
  const history = await readJsonIfPresent(join(stageRoot, 'history.json'));
  const ledger = await readJsonIfPresent(join(stageRoot, 'frames.json'));
  if (!history?.status?.completed || history.status.status_str !== 'success' || history.prompt?.[1] !== submission.promptId || hashJson(history.prompt?.[2]) !== workflowHash) throw failure('CACHED_HISTORY_CHANGED', 'Retained provider history does not match the completed stage');
  const descriptors = history.outputs?.['10']?.images || [];
  if (!Array.isArray(ledger) || ledger.length !== frames || descriptors.length !== frames) throw failure('CACHED_FRAME_COUNT', 'Retained frame ledger is incomplete');
  for (let i = 0; i < frames; i++) {
    const item = ledger[i], descriptor = descriptors[i];
    const providerPath = `${descriptor.subfolder}/${descriptor.filename}`.replaceAll('\\', '/');
    if (item.index !== i || item.path !== `frames/${String(i).padStart(5, '0')}.png` || hashJson(item.providerOutput) !== hashJson(descriptor) || descriptor.type !== 'output' || providerPath.split('/').includes('..') || !providerPath.startsWith(`${workflow['10'].inputs.filename_prefix}_`)) throw failure('CACHED_FRAME_OWNERSHIP', 'Retained frame is outside the original provider output');
    const bytes = await readFile(join(stageRoot, item.path));
    if (sha(bytes) !== item.sha256 || bytes.length < 128 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw failure('CACHED_FRAME_CHANGED', 'A retained generated frame has changed. It was not overwritten.');
  }
  const latents = await readJsonIfPresent(join(stageRoot, 'latents.json')) || [];
  for (const latent of latents) if (latent.path !== 'generated.latent' || sha(await readFile(join(stageRoot, latent.path))) !== latent.sha256) throw failure('CACHED_LATENT_CHANGED', 'A retained latent checkpoint has changed');
  return { stageRoot, promptId: submission.promptId, historyPath: join(stageRoot, 'history.json'), logPath: join(stageRoot, 'provider.jsonl'), framesPath: join(stageRoot, 'frames.json'), workflow, ledger, latents, recovered: true };
}

// Only descriptors returned by this exact provider prompt are downloaded.
// A user-supplied file or unrelated ComfyUI history is never accepted here.
export async function executeWanStage({ provider, jobRoot, stage, workflow, frames, onProgress = () => {}, timeoutMs = 7200000, pollIntervalMs = 3000, waitForIdle = false }) {
  if (!['keyframe', 'motion'].includes(stage)) throw failure('INVALID_STAGE', 'Unknown generation stage');
  const stageRoot = join(jobRoot, stage);
  await mkdir(join(stageRoot, 'frames'), { recursive: true });
  const workflowPath=join(stageRoot,'workflow.json');
  let savedWorkflow;try{savedWorkflow=JSON.parse(await readFile(workflowPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(savedWorkflow&&hashJson(savedWorkflow)!==hashJson(workflow))throw failure('STAGE_INPUT_CHANGED','This stage belongs to a different workflow. Start a new project revision; existing outputs were retained.');
  if(!savedWorkflow)await writeFile(workflowPath, JSON.stringify(workflow, null, 2));
  const logPath = join(stageRoot, 'provider.jsonl');
  let events=[];try{events=(await readFile(logPath,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch(e){if(e.code!=='ENOENT')throw e;}
  const submission=events.find(x=>x.event==='submitted'&&x.workflowHash===hashJson(workflow));
  const recovered=await recoverCompletedStage({stageRoot,workflow,frames,submission,events});
  if(recovered){onProgress({stage:`${stage}: verified retained frames`});return recovered;}
  if(!submission){
    const idleDeadline=Date.now()+timeoutMs;
    while(true){
      let queue;
      try{
        const queueResponse=await provider.fetch(`${provider.baseUrl}/queue`,{signal:AbortSignal.timeout(30000),redirect:'error'});
        if(!queueResponse.ok)throw failure('PROVIDER_QUEUE_UNAVAILABLE','Cannot confirm the local GPU queue is idle');
        queue=await queueResponse.json();
      }catch(error){
        if(!waitForIdle||!(['TimeoutError','AbortError'].includes(error.name)||error instanceof TypeError))throw error;
        queue={queue_running:[['unknown']]};
      }
      if(!queue.queue_running?.length&&!queue.queue_pending?.length)break;
      if(!waitForIdle)throw failure('PROVIDER_BUSY','Another ComfyUI job is active. VYREALM did not enqueue a competing GPU job.');
      if(Date.now()>=idleDeadline)throw failure('PROVIDER_BUSY_TIMEOUT','The local GPU remained busy. Retained stages can be resumed; no competing job was submitted.');
      onProgress({stage:`${stage}: waiting for the local GPU; prior frames retained`});
      await new Promise(r=>setTimeout(r,pollIntervalMs));
    }
  }
  const submit=submission||await provider.generate_video({ workflow, requiredNodes: Object.values(workflow).map(n => n.class_type), requiredModels: Object.values(WAN_MODELS), frames, width: workflow['7'].inputs.width, height: workflow['7'].inputs.height, allowResourceWarnings: true });
  if(!submission)await appendFile(logPath, JSON.stringify({ event: 'submitted', promptId: submit.promptId, workflowHash: hashJson(workflow), timestamp: new Date().toISOString() }) + '\n');
  const deadline = Date.now() + timeoutMs;
  // Model loading can temporarily starve the local HTTP server. A missed
  // heartbeat does not mean the owned inference failed; never resubmit it.
  const pollJson = async (url, code) => {
    for (let attempt = 0; attempt < 6 && Date.now() < deadline; attempt++) {
      try {
        const response = await provider.fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now()))), redirect: 'error' });
        if (!response.ok) {
          if ([408,429,500,502,503,504].includes(response.status)) throw Object.assign(new Error(`HTTP ${response.status}`), { transientPoll: true });
          throw failure(code, `ComfyUI state request failed with HTTP ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        const transient = error.transientPoll || ['TimeoutError','AbortError'].includes(error.name) || error instanceof TypeError;
        if (!transient) throw error;
        await appendFile(logPath, JSON.stringify({event:'poll-retry',promptId:submit.promptId,attempt:attempt+1,reason:error.message,timestamp:new Date().toISOString()})+'\n');
        onProgress({stage:`${stage}: provider busy; retaining owned generation`,retry:attempt+1});
        if (attempt === 5) throw failure('PROVIDER_POLL_UNAVAILABLE', 'The owned provider job is retained, but its status could not be read after six attempts. Retry this job to reconnect without duplicate inference.');
        await new Promise(r=>setTimeout(r,Math.min(pollIntervalMs,Math.max(0,deadline-Date.now()))));
      }
    }
    throw failure('NEURAL_TIMEOUT', 'Local generation exceeded the bounded job time while awaiting provider status');
  };
  let history;
  while (Date.now() < deadline) {
    history = (await pollJson(`${provider.baseUrl}/history/${encodeURIComponent(submit.promptId)}`, 'PROVIDER_HISTORY_FAILED'))[submit.promptId];
    if (history?.status?.status_str === 'error') {
      await writeFile(join(stageRoot, 'history.json'), JSON.stringify(history, null, 2));
      throw failure('PROVIDER_EXECUTION_FAILED', JSON.stringify(history.status.messages).slice(-4000));
    }
    if (history?.status?.completed) break;
    if (!history && submission) {
      const queue = await pollJson(`${provider.baseUrl}/queue`, 'PROVIDER_QUEUE_UNAVAILABLE');
      if (![...(queue.queue_running || []), ...(queue.queue_pending || [])].some(entry => entry[1] === submit.promptId)) throw failure('PROVIDER_HISTORY_LOST', 'The provider restarted before this stage was retained. Earlier completed stages remain saved. Create a new shot to retry generation.');
    }
    onProgress({ stage: `${stage}: sampling locally`, elapsedSeconds: Math.round((timeoutMs - (deadline - Date.now())) / 1000) });
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  if (!history?.status?.completed) { await provider.cancel(submit.promptId); throw failure('NEURAL_TIMEOUT', 'Local generation exceeded the bounded job time'); }
  await writeFile(join(stageRoot, 'history.json'), JSON.stringify(history, null, 2));
  if (history.prompt?.[1] !== submit.promptId || hashJson(history.prompt?.[2]) !== hashJson(workflow)) throw failure('PROVIDER_WORKFLOW_MISMATCH', 'Provider history does not match this VYREALM workflow');
  const outputs = history.outputs?.['10']?.images || [];
  if (outputs.length !== frames) throw failure('PROVIDER_FRAME_COUNT', `Provider produced ${outputs.length} frames; ${frames} required`);
  const prefix = workflow['10'].inputs.filename_prefix;
  const latents=[];
  for(const item of history.outputs?.['12']?.latents || []){
    const name=`${item.subfolder}/${item.filename}`.replaceAll('\\','/');
    if(item.type!=='output'||name.split('/').includes('..')||!name.startsWith(`${prefix}_latent_`))throw failure('PROVIDER_OUTPUT_OWNERSHIP','Latent checkpoint is outside this job namespace');
    const query=new URLSearchParams({filename:item.filename,subfolder:item.subfolder,type:'output'});
    const response=await provider.fetch(`${provider.baseUrl}/view?${query}`,{signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok)throw failure('LATENT_CHECKPOINT_DOWNLOAD_FAILED','Generated latent checkpoint could not be retained');
    const bytes=Buffer.from(await response.arrayBuffer());
    const path='generated.latent';await writeFile(join(stageRoot,path),bytes);
    latents.push({path,sha256:sha(bytes),providerOutput:item});
  }
  await writeFile(join(stageRoot,'latents.json'),JSON.stringify(latents,null,2));
  const ledger = [];
  for (let index = 0; index < outputs.length; index++) {
    const item = outputs[index];
    const providerPath = `${item.subfolder}/${item.filename}`.replaceAll('\\', '/');
    if (item.type !== 'output' || providerPath.split('/').includes('..') || !providerPath.startsWith(`${prefix}_`)) throw failure('PROVIDER_OUTPUT_OWNERSHIP', 'Provider output is outside this job namespace');
    const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder, type: 'output' });
    const response = await provider.fetch(`${provider.baseUrl}/view?${query}`, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw failure('PROVIDER_DOWNLOAD_FAILED', `Frame ${index} could not be retrieved`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 128 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw failure('INVALID_GENERATED_FRAME', 'Provider output is not a PNG');
    const name = `${String(index).padStart(5, '0')}.png`;
    try{await writeFile(join(stageRoot, 'frames', name), bytes, { flag: 'wx' });}catch(error){if(error.code!=='EEXIST')throw error;if(sha(await readFile(join(stageRoot,'frames',name)))!==sha(bytes))throw failure('CACHED_FRAME_CHANGED','A retained generated frame has changed. It was not overwritten.');}
    ledger.push({ index, path: `frames/${name}`, sha256: sha(bytes), providerOutput: item });
  }
  await writeFile(join(stageRoot, 'frames.json'), JSON.stringify(ledger, null, 2));
  await writeFile(join(stageRoot, 'history.json'), JSON.stringify(history, null, 2));
  await appendFile(logPath, JSON.stringify({ event: 'completed', promptId: submit.promptId, workflowHash: hashJson(workflow), frameCount: ledger.length, timestamp: new Date().toISOString() }) + '\n');
  return { stageRoot, promptId: submit.promptId, historyPath: join(stageRoot, 'history.json'), logPath, framesPath: join(stageRoot, 'frames.json'), workflow, ledger, latents };
}

export async function produceNeuralSmoke({ output, prompt = SMOKE_PROMPT, seed = 7092026, fps = 24, steps = 20, frames = 121, width = 1024, height = 576, reference, ffmpeg = process.env.VYRELUM_FFMPEG || join(root, 'workers/tools/ffmpeg.exe'), ffprobe = process.env.VYRELUM_FFPROBE || join(root, 'workers/tools/ffprobe.exe'), onProgress = () => {}, provider = createComfyUIProvider() } = {}) {
  const jobRoot = resolve(output);
  await mkdir(jobRoot, { recursive: true });
  const identity=hashJson({prompt,seed,fps,steps,frames,width,height,...(reference?{referenceHash:reference.sha256}:{}),adapterVersion:'wan22-standard-vae-v2'});
  let checkpoint;try{checkpoint=JSON.parse(await readFile(join(jobRoot,'generation-checkpoint.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(checkpoint&&checkpoint.identity!==identity)throw failure('JOB_INPUT_CHANGED','Retained generation inputs differ. Create a new version to regenerate.');
  if(!checkpoint){checkpoint={identity,namespace:`vyrealm/${randomUUID()}`,started:Date.now()};await writeFile(join(jobRoot,'generation-checkpoint.json'),JSON.stringify(checkpoint,null,2));}
  const started = checkpoint.started, namespace = checkpoint.namespace;
  let vramPeakGb = null, measuring = false;
  const measure = async () => {
    if (measuring) return; measuring = true;
    try { const r = await execFileAsync('C:/Windows/System32/nvidia-smi.exe', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 }); const n = Number(r.stdout.trim().split('\n')[0]) / 1024; if (Number.isFinite(n)) vramPeakGb = Math.max(vramPeakGb || 0, n); } catch {} finally { measuring = false; }
  };
  await measure(); const timer = setInterval(() => void measure(), 2000);
  try {
    onProgress({ stage: reference?'Checking locked character reference':'Generating original keyframe', progress: 0.05 });
    let keyframe;
    if(reference){
      const bytes=await readFile(reference.path);if(sha(bytes)!==reference.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw failure('REFERENCE_INTEGRITY_FAILED','The locked keyframe no longer matches its generation evidence');
      await writeFile(join(jobRoot,'reference.png'),bytes);await writeFile(join(jobRoot,'reference.json'),JSON.stringify({sourceJobId:reference.sourceJobId,sha256:reference.sha256,sourceMethod:'prior-local-generated-keyframe'},null,2));
      keyframe={stageRoot:jobRoot,promptId:reference.promptId,ledger:[{path:'reference.png',sha256:reference.sha256}],sourceJobId:reference.sourceJobId};
    }else keyframe = await executeWanStage({ provider, jobRoot, stage: 'keyframe', workflow: wanWorkflow({ prompt, seed, frames: 1, steps, width, height, prefix: `${namespace}/keyframe` }), frames: 1, onProgress, waitForIdle:true });
    onProgress({ stage: 'Animating generated keyframe', progress: 0.25 });
    const imageName = await ensureWanInput({ provider, jobRoot, path: join(keyframe.stageRoot, keyframe.ledger[0].path), expectedHash: keyframe.ledger[0].sha256 });
    const motionWorkflow = wanWorkflow({ prompt, seed, frames, steps, width, height, imageName, prefix: `${namespace}/motion` });
    const motion = await executeWanStage({ provider, jobRoot, stage: 'motion', workflow: motionWorkflow, frames, onProgress, waitForIdle:true });
    onProgress({ stage: 'Encoding and checking generated frames', progress: 0.85 });
    const durationSeconds = (frames - 1) / fps;
    const source = join(jobRoot, 'generated-source.mp4');
    const encodeLog = join(jobRoot, 'encode.log');
    await run(ffmpeg, ['-y', '-framerate', String(fps), '-i', join(motion.stageRoot, 'frames', '%05d.png'), '-frames:v', String(frames - 1), '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', source], encodeLog);
    const verification = await verifyMedia({ videoPath: source, ffmpeg, ffprobe, expected: { width, height, fps, durationSeconds, requireVisual: true } });
    if (!verification.ok) throw failure('GENERATED_CLIP_REJECTED', verification.diagnostics.map(d => d.message).join('; '));
    await run(ffmpeg, ['-v', 'error', '-i', source, '-f', 'null', '-'], encodeLog);
    await run(ffmpeg, ['-y', '-i', source, '-vf', 'fps=1,scale=384:216,tile=5x1', '-frames:v', '1', join(jobRoot, 'contact-sheet.png')], encodeLog);
    await run(ffmpeg, ['-y', '-i', source, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(jobRoot, 'delivery-1080p.mp4')], encodeLog);
    const provenance = await recordGeneratedProvenance({ jobRoot, outputPath: source, providerId: provider.id, modelId: WAN_MODELS.diffusion, workflow: motionWorkflow, seed, prompt, durationSeconds, width, height, fps, vramPeakGb, renderTimeMs: Date.now() - started, providerEvidence: motion, ffmpeg, ffprobe });
    if (provenance.status !== 'generated') throw failure(provenance.code, provenance.message);
    const receipt = { schemaVersion: 2, status: 'review_required', validated: true, sourceMethod: 'local-wan22-gguf', provenance: { ...provenance, generationStatus: 'generated', keyframe: { promptId: keyframe.promptId, outputHash: keyframe.ledger[0].sha256, sourceMethod: reference ? 'prior-local-generated-keyframe' : 'local-generated-keyframe', sourceJobId: keyframe.sourceJobId || null }, deliveryMethod: `1080p-lanczos-from-${width}x${height}`, deliveryResolution:{width:1920,height:1080}, fourKMethod: 'not-run', semanticQuality: 'unreviewed' }, verification, durationSeconds, outputs: { video: 'delivery-1080p.mp4', sourceVideo: 'generated-source.mp4', poster: 'contact-sheet.png', quality: 'verification.json' }, diagnostics: [{ code: 'VISUAL_REVIEW_REQUIRED', message: 'Actual local neural inference completed; cinematic quality, face continuity and action alignment still need visual review.' }] };
    await writeFile(join(jobRoot, 'verification.json'), JSON.stringify(receipt, null, 2));
    await writeFile(join(jobRoot, 'result.json'), JSON.stringify(receipt, null, 2));
    onProgress({ stage: 'Generated clip ready for visual review', progress: 1 });
    return receipt;
  } finally { clearInterval(timer); }
}
