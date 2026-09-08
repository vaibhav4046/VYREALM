import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createComfyUIProvider } from './providers/comfyui.mjs';
import { ensureWanInput, executeWanStage } from './neural-production.mjs';
import { hashJson, recordGeneratedProvenance } from './generation-gate.mjs';
import { bindGeneratedDelivery } from './generation-delivery.mjs';
import { verifyMedia } from './media-verifier.mjs';
import { verifyOwnedGeneratedKeyframe } from './keyframe-production.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fail = (code, message) => { throw Object.assign(new Error(`${code}: ${message}`), { code }); };

export const LTX_MODELS = Object.freeze({
  diffusion: 'ltxv-2b-0.9.8-distilled-q8_0.gguf',
  text: 't5-v1_1-xxl-encoder-Q5_K_M.gguf',
  vae: 'ltxv-0.9.8-2b-distilled-vae.safetensors',
});
export const LTX_PROFILES = Object.freeze({
  'draft-512': Object.freeze({ width: 512, height: 288, frames: 121, fps: 24, steps: 8, qualified: false }),
  'comparison-1024': Object.freeze({ width: 1024, height: 576, frames: 121, fps: 24, steps: 8, qualified: false }),
});
const NEGATIVE = 'static frozen image, slideshow, vector art, cartoon, geometric primitives, text, subtitles, watermark, black empty background, distorted face, deformed hands, duplicated limbs, unstable geometry, oversaturated, low quality';

/** @typedef {'draft-512'|'comparison-1024'} LtxProfile */
/** @typedef {{path:string,sha256:string,sourceJobId:string,promptId:string}} GeneratedReference */
/** Fixed, audited graph only. No custom nodes, model paths or step overrides. */
export function ltxWorkflow(options = {}) {
  const allowed = new Set(['prompt', 'seed', 'profile', 'imageName', 'prefix', 'tiledDecode']);
  if (Object.keys(options).some(key => !allowed.has(key))) fail('LTX_WORKFLOW_OVERRIDE', 'Custom graphs and unbounded model settings are not supported');
  const { prompt, seed = 730241, profile = 'draft-512', imageName, prefix, tiledDecode = false } = options;
  const p = LTX_PROFILES[profile];
  if (!Object.hasOwn(LTX_PROFILES, profile)) fail('LTX_PROFILE', 'Choose the bounded draft-512 or comparison-1024 profile');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 6000) fail('LTX_PROMPT', 'A motion prompt of 1–6000 characters is required');
  if (!Number.isSafeInteger(seed) || seed < 0) fail('LTX_SEED', 'Seed must be a nonnegative safe integer');
  if (typeof tiledDecode !== 'boolean') fail('LTX_DECODE', 'Tiled decode must be explicitly enabled with a boolean');
  if (!/^vyrealm\/[a-zA-Z0-9_-]+\/motion$/.test(prefix || '')) fail('LTX_OUTPUT_PREFIX', 'Output must use this VYREALM job namespace');
  if (typeof imageName !== 'string' || !/^[a-zA-Z0-9_./ -]+\.png$/.test(imageName) || imageName.startsWith('/') || imageName.split('/').some(part => !part || part === '..' || part === '.')) fail('LTX_INPUT_IMAGE', 'An uploaded provider-local PNG name is required');
  return {
    '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: LTX_MODELS.diffusion } },
    '2': { class_type: 'CLIPLoaderGGUF', inputs: { clip_name: LTX_MODELS.text, type: 'ltxv' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: LTX_MODELS.vae } },
    '4': { class_type: 'ModelSamplingLTXV', inputs: { model: ['1', 0], max_shift: 2.05, base_shift: 0.95, latent: ['7', 2] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: NEGATIVE } },
    '7': { class_type: 'LTXVImgToVideo', inputs: { positive: ['5', 0], negative: ['6', 0], vae: ['3', 0], image: ['11', 0], width: p.width, height: p.height, length: p.frames, batch_size: 1, strength: 1 } },
    '8': { class_type: 'SamplerCustom', inputs: { model: ['4', 0], add_noise: true, noise_seed: seed, cfg: 1, positive: ['13', 0], negative: ['13', 1], sampler: ['15', 0], sigmas: ['14', 0], latent_image: ['7', 2] } },
    '9': { class_type: tiledDecode ? 'VAEDecodeTiled' : 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0], ...(tiledDecode ? { tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 } : {}) } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: prefix } },
    '11': { class_type: 'LoadImage', inputs: { image: imageName } },
    '12': { class_type: 'SaveLatent', inputs: { samples: ['8', 0], filename_prefix: `${prefix}_latent` } },
    '13': { class_type: 'LTXVConditioning', inputs: { positive: ['7', 0], negative: ['7', 1], frame_rate: p.fps } },
    '14': { class_type: 'LTXVScheduler', inputs: { steps: p.steps, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent: ['7', 2] } },
    '15': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
  };
}

async function inside(base, path, code = 'LTX_REFERENCE_OWNERSHIP') {
  const actual = await realpath(resolve(base, path)), rel = relative(base, actual);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) fail(code, 'Files must resolve inside the configured job store');
  return actual;
}

// Packaged Windows hosts can virtualize individual Roaming files without
// exposing a directory junction. Anchor the store to its existing SQLite file,
// not to a source-reference path supplied by the caller.
export async function canonicalLtxJobsRoot(jobsDir) {
  const configured = await realpath(jobsDir);
  if (basename(configured) !== 'jobs') return configured;
  try {
    const database = await realpath(join(dirname(configured), 'vyrelum.sqlite'));
    return await realpath(join(dirname(database), 'jobs'));
  } catch (error) { if (error.code === 'ENOENT') return configured; throw error; }
}

/** Read-only admission check. The server must additionally verify its DB job and
 * registered playback asset before scheduling, using verifyReviewTarget.
 * @param {{jobsDir:string,projectId:string,reference:GeneratedReference}} options
 */
export async function verifyOwnedLtxReference({ jobsDir, projectId, reference } = {}) {
  if (!jobsDir || typeof projectId !== 'string' || !projectId || !reference || !/^[a-zA-Z0-9-]+$/.test(reference.sourceJobId || '') || !hashPattern.test(reference.sha256 || '') || typeof reference.promptId !== 'string' || !reference.promptId) fail('LTX_REFERENCE_REQUIRED', 'A reviewed VYREALM-generated keyframe from this project is required');
  const jobsRoot = await canonicalLtxJobsRoot(jobsDir);
  const sourceRoot = await inside(jobsRoot, reference.sourceJobId);
  const image = await inside(sourceRoot, reference.path);
  const localName = relative(sourceRoot, image).replaceAll('\\', '/');
  if (!['keyframe/frames/00000.png', 'reference.png'].includes(localName)) fail('LTX_REFERENCE_OWNERSHIP', 'Only the saved generated keyframe may condition this route');
  const request = JSON.parse(await readFile(await inside(sourceRoot, 'request.json'), 'utf8'));
  if (request.projectId !== projectId) fail('LTX_REFERENCE_PROJECT', 'The source keyframe belongs to a different project');
  const receipt = JSON.parse(await readFile(await inside(sourceRoot, 'result.json'), 'utf8'));
  if (receipt.kind === 'generated-keyframe') {
    const verified = await verifyOwnedGeneratedKeyframe({jobsDir:jobsRoot,sourceJobId:reference.sourceJobId,projectId,expectedHash:reference.sha256});
    if (localName !== 'keyframe/frames/00000.png' || verified.promptId !== reference.promptId || verified.path.toLowerCase() !== image.toLowerCase()) fail('LTX_REFERENCE_GENERATION','The reference must be the exact reviewed provider PNG');
    return verified;
  }
  const p = receipt.provenance, native = p?.source || p;
  if (p?.generationStatus !== 'generated' || native?.status !== 'generated' || native?.providerId !== 'comfyui-local' || !native.modelId || !hashPattern.test(native.evidenceHash || '') || p.keyframe?.outputHash !== reference.sha256 || p.keyframe?.promptId !== reference.promptId) fail('LTX_REFERENCE_GENERATION', 'The PNG must match an owned local-generation receipt');
  if (receipt.validated !== true || receipt.verification?.ok !== true || receipt.review?.verdict !== 'passed' || !hashPattern.test(p.outputHash || '') || receipt.review.outputHash !== p.outputHash || typeof receipt.outputs?.video !== 'string') fail('LTX_REFERENCE_REVIEW', 'A passed review bound to the delivered video is required');
  const delivery = await inside(sourceRoot, receipt.outputs.video);
  if (sha(await readFile(delivery)) !== p.outputHash) fail('LTX_REFERENCE_REVIEW', 'The previously reviewed video bytes have changed');
  const bytes = await readFile(image);
  if (bytes.length < 128 || !bytes.subarray(0, 8).equals(pngSignature) || sha(bytes) !== reference.sha256) fail('LTX_REFERENCE_INTEGRITY', 'The generated reference PNG no longer matches its recorded hash');
  return { bytes, path: image, sha256: reference.sha256, sourceJobId: reference.sourceJobId, promptId: reference.promptId, sourceEvidenceHash: native.evidenceHash, reviewedOutputHash: p.outputHash };
}

async function readOptional(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function retain(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if (sha(await readFile(path)) !== sha(bytes)) fail('LTX_RETAINED_FILE_CHANGED', 'A retained job file differs; create a new job instead of overwriting it'); }
}
async function run(command, args, log) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300000);
    child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-6000); void appendFile(log, chunk).catch(() => {}); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 && !timedOut ? done() : reject(Object.assign(new Error(`LTX_ENCODE_FAILED: ${tail || 'FFmpeg timed out'}`), { code: 'LTX_ENCODE_FAILED' })); });
  });
}

/** Animate one reviewed engine-owned keyframe. This route never supplies images,
 * subtitles, speech, a 4K claim, a visual verdict, or a procedural fallback.
 * @param {{output:string,jobsDir:string,projectId:string,reference:GeneratedReference,prompt:string,seed?:number,profile?:LtxProfile,tiledDecode?:boolean,queuePolicy?:'idle'|'fifo',ffmpeg?:string,ffprobe?:string,onProgress?:Function,provider?:object}} options
 */
export async function produceLocalLtxShot({ output, jobsDir, projectId, reference, prompt, seed = 730241, profile = 'draft-512', tiledDecode = false, queuePolicy = 'idle', ffmpeg = process.env.VYRELUM_FFMPEG || join(root, 'workers/tools/ffmpeg.exe'), ffprobe = process.env.VYRELUM_FFPROBE || join(root, 'workers/tools/ffprobe.exe'), onProgress = () => {}, provider = createComfyUIProvider() } = {}) {
  // Validate graph parameters without uploading or queueing any provider work.
  ltxWorkflow({ prompt, seed, profile, tiledDecode, imageName: 'validated-reference.png', prefix: 'vyrealm/preflight/motion' });
  if (!['idle', 'fifo'].includes(queuePolicy)) fail('LTX_QUEUE_POLICY', 'Unknown queue policy');
  if (provider?.id !== 'comfyui-local') fail('LTX_PROVIDER', 'This route requires the local ComfyUI provider');
  const source = await verifyOwnedLtxReference({ jobsDir, projectId, reference });
  if (typeof output !== 'string' || !output) fail('LTX_OUTPUT', 'A new durable job directory is required');
  const jobsRoot = await canonicalLtxJobsRoot(jobsDir);
  const suppliedRoot = resolve(output), configuredRoot = resolve(jobsDir);
  const requestedRoot = dirname(suppliedRoot).toLowerCase() === configuredRoot.toLowerCase() ? join(jobsRoot, basename(suppliedRoot)) : suppliedRoot;
  const sourceRoot = await realpath(join(jobsRoot, source.sourceJobId));
  if (dirname(requestedRoot).toLowerCase() !== jobsRoot.toLowerCase() || requestedRoot.toLowerCase() === sourceRoot.toLowerCase()) fail('LTX_OUTPUT', 'Output must be a separate direct child of the configured job store');
  await mkdir(requestedRoot, { recursive: true });
  const jobRoot = await inside(jobsRoot, requestedRoot, 'LTX_OUTPUT');
  if (jobRoot.toLowerCase() === sourceRoot.toLowerCase()) fail('LTX_OUTPUT', 'A generation job cannot overwrite its reference job');
  const ownRequest = await readOptional(join(jobRoot, 'request.json'));
  if (ownRequest?.projectId && ownRequest.projectId !== projectId) fail('LTX_OUTPUT_PROJECT', 'The output job belongs to a different project');
  const p = LTX_PROFILES[profile];
  const identity = hashJson({ adapterVersion: 'ltx098-i2v-v1', projectId, prompt, seed, profile, tiledDecode, models: LTX_MODELS, referenceHash: source.sha256, sourceJobId: source.sourceJobId });
  let checkpoint = await readOptional(join(jobRoot, 'generation-checkpoint.json'));
  if (checkpoint && checkpoint.identity !== identity) fail('JOB_INPUT_CHANGED', 'Retained LTX inputs differ; create a new job to regenerate');
  if (!checkpoint) { checkpoint = { identity, namespace: `vyrealm/${randomUUID()}`, started: Date.now() }; await retain(join(jobRoot, 'generation-checkpoint.json'), JSON.stringify(checkpoint, null, 2)); }
  if (!/^vyrealm\/[a-zA-Z0-9_-]+$/.test(checkpoint.namespace) || !Number.isFinite(checkpoint.started)) fail('LTX_CHECKPOINT_INVALID', 'The retained checkpoint is invalid');
  await retain(join(jobRoot, 'reference.png'), source.bytes);
  await retain(join(jobRoot, 'reference.json'), JSON.stringify({ sourceJobId: source.sourceJobId, sha256: source.sha256, promptId: source.promptId, sourceEvidenceHash: source.sourceEvidenceHash, reviewedOutputHash: source.reviewedOutputHash, sourceMethod: 'prior-local-generated-keyframe' }, null, 2));
  let vramPeakGb = null, measuring = false;
  const measure = async () => {
    if (measuring) return; measuring = true;
    try { const r = await exec('C:/Windows/System32/nvidia-smi.exe', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 }); const value = Number(r.stdout.trim().split('\n')[0]) / 1024; if (Number.isFinite(value)) vramPeakGb = Math.max(vramPeakGb || 0, value); } catch {} finally { measuring = false; }
  };
  const timer = setInterval(() => void measure(), 2000);
  try {
    await measure();
    onProgress({ stage: 'Verifying and uploading the reviewed keyframe for LTX', progress: 0.05 });
    const imageName = await ensureWanInput({ provider, jobRoot, path: join(jobRoot, 'reference.png'), expectedHash: source.sha256 });
    const workflow = ltxWorkflow({ prompt, seed, profile, imageName, prefix: `${checkpoint.namespace}/motion`, tiledDecode });
    const motion = await executeWanStage({ provider, jobRoot, stage: 'motion', workflow, frames: p.frames, width: p.width, height: p.height, requiredModels: Object.values(LTX_MODELS), onProgress, waitForIdle: true, queuePolicy });
    onProgress({ stage: 'Encoding and verifying the 120 native LTX frames', progress: 0.85 });
    const durationSeconds = (p.frames - 1) / p.fps;
    const sourcePath = join(jobRoot, 'generated-source.mp4'), deliveryPath = join(jobRoot, 'delivery-1080p.mp4'), log = join(jobRoot, 'encode.log');
    await run(ffmpeg, ['-y', '-framerate', String(p.fps), '-i', join(motion.stageRoot, 'frames', '%05d.png'), '-frames:v', String(p.frames - 1), '-c:v', 'libx264', '-threads', '2', '-profile:v', 'high', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sourcePath], log);
    const verification = await verifyMedia({ videoPath: sourcePath, ffmpeg, ffprobe, expected: { width: p.width, height: p.height, fps: p.fps, durationSeconds, requireVisual: true } });
    if (!verification.ok) fail('GENERATED_CLIP_REJECTED', verification.diagnostics.map(d => d.message).join('; '));
    await run(ffmpeg, ['-y', '-i', sourcePath, '-vf', 'fps=1,scale=384:216,tile=5x1', '-frames:v', '1', join(jobRoot, 'contact-sheet.png')], log);
    const provenance = await recordGeneratedProvenance({ jobRoot, outputPath: sourcePath, providerId: provider.id, modelId: LTX_MODELS.diffusion, workflow, seed, prompt, durationSeconds, width: p.width, height: p.height, fps: p.fps, vramPeakGb, renderTimeMs: Date.now() - checkpoint.started, providerEvidence: motion, ffmpeg, ffprobe });
    if (provenance.status !== 'generated') fail(provenance.code, provenance.message);
    await run(ffmpeg, ['-y', '-i', sourcePath, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', deliveryPath], log);
    const delivery = await bindGeneratedDelivery({ jobRoot, provenance, sourcePath, deliveryPath, deliveryMethod: `1080p-lanczos-from-${p.width}x${p.height}`, deliveryResolution: { width: 1920, height: 1080 }, ffmpeg, ffprobe });
    const receipt = {
      schemaVersion: 2, status: 'review_required', validated: true, sourceMethod: 'local-ltx098-distilled-gguf', durationSeconds,
      provenance: { ...delivery, generationStatus: 'generated', keyframe: { promptId: source.promptId, outputHash: source.sha256, sourceJobId: source.sourceJobId, sourceMethod: 'prior-local-generated-keyframe' }, fourKMethod: 'not-run', semanticQuality: 'unreviewed' },
      verification, profile: { id: profile, ...p, tiledDecode, decodeQualification: 'unqualified', nativeFrames: p.frames - 1, generatedFrames: p.frames, interpolation: 'not-used', vramMeasurement: 'whole-device sampled usage; not isolated model allocation' },
      outputs: { video: 'delivery-1080p.mp4', sourceVideo: 'generated-source.mp4', poster: 'contact-sheet.png', quality: 'verification.json' },
      diagnostics: [{ code: 'VISUAL_REVIEW_REQUIRED', message: 'Local LTX model output is technically verified. Motion, reference identity, detail, temporal joins and action adherence still require visual review. No audio or lip-sync was generated.' }, { code: 'LTX_PROFILE_UNQUALIFIED', message: 'Experimental fixed single-pass GGUF route; not the upstream multiscale refinement pipeline. Speed and visual quality on this machine are not yet qualified.' }],
    };
    await writeFile(join(jobRoot, 'verification.json'), JSON.stringify(receipt, null, 2));
    await writeFile(join(jobRoot, 'result.json'), JSON.stringify(receipt, null, 2));
    onProgress({ stage: 'LTX clip ready for visual review', progress: 1 });
    return receipt;
  } finally { clearInterval(timer); }
}
