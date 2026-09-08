import { createHash } from 'node:crypto';
import { existsSync, statfsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { createComfyUIProvider } from './providers/comfyui.mjs';
import { detectHardware } from './hardware-profile.mjs';
import { verifyGenerationEvidence } from './generation-evidence.mjs';

export const NEURAL_MODEL_IDS = ['Wan2.2-TI2V-5B-Q4_K_M.gguf','umt5-xxl-encoder-Q4_K_S.gguf','wan2.2_vae.safetensors'];
export const NEURAL_REQUIRED_NODES = ['UnetLoaderGGUF','CLIPLoaderGGUF','VAELoader','ModelSamplingSD3','CLIPTextEncode','Wan22ImageToVideoLatent','KSampler','VAEDecode','SaveImage','LoadImage','SaveLatent'];

// Neural generation is an explicit capability.  A detected executable is not
// enough: a model, local hardware budget, and a verified output are required
// before a receipt can say "generated".
export const GENERATION_PROVIDER_ORDER = Object.freeze([
  'comfyui-local',
  'wan2.2-local',
  'wan2gp-local',
  'framepack-local',
]);

const providerSpecs = Object.freeze([
  { id: 'wan2.2-local', label: 'Wan2.2', executable: 'VYRELUM_WAN_EXECUTABLE', model: 'VYRELUM_WAN_MODEL' },
  { id: 'wan2gp-local', label: 'Wan2GP', executable: 'VYRELUM_WANGP_EXECUTABLE', model: 'VYRELUM_WANGP_MODEL' },
  { id: 'framepack-local', label: 'FramePack', executable: 'VYRELUM_FRAMEPACK_EXECUTABLE', model: 'VYRELUM_FRAMEPACK_MODEL' },
]);

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function pathFromEnv(env, key) {
  const value = String(env?.[key] || '').trim();
  return value ? resolve(value) : null;
}

function modelHint(root, env, names) {
  const dirs = [pathFromEnv(env, 'VYRELUM_MODELS_DIR'), join(root, 'models')].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function diskReport(root) {
  try {
    const stats = statfsSync(root);
    return { freeDiskGb: Number((Number(stats.bavail) * Number(stats.bsize) / (1024 ** 3)).toFixed(2)) };
  } catch {
    return { freeDiskGb: null };
  }
}

function hardwareReady(hardware) {
  const gpu = hardware?.gpu;
  const vramGb = finite(gpu?.vramGb) ?? finite(hardware?.profile?.vramGb) ?? 0;
  return { ok: Boolean(gpu?.gpu) && vramGb >= 4, gpu: gpu?.gpu || null, vramGb };
}

async function inspectComfyUI({ env, fetchImpl, hardware }) {
  const provider = createComfyUIProvider({ env, fetchImpl, hardware });
  const health = await provider.health_check();
  const cuda = health.system?.devices?.find(d=>d.type==='cuda'&&Number(d.vram_total)>0);
  const resources = hardwareReady(hardware?.gpu?hardware:cuda?{gpu:{gpu:cuda.name,vramGb:Number(cuda.vram_total)/1024**3}}:hardware);
  const installed = Object.values(health.installedModels || {}).flat();
  const missingModels = NEURAL_MODEL_IDS.filter(m=>!installed.includes(m));
  const missingNodes = NEURAL_REQUIRED_NODES.filter(n=>!health.nodes?.includes(n));
  const hasModel = !missingModels.length;
  const available = Boolean(health.available && hasModel && !missingNodes.length && resources.ok);
  const diagnostics = [];
  if (!health.available) diagnostics.push({ code: 'COMFYUI_UNAVAILABLE', message: health.reason || 'ComfyUI loopback is not reachable' });
  else if (!hasModel) diagnostics.push({ code: 'COMFYUI_MODELS_MISSING', message: `The fixed local workflow needs: ${missingModels.join(', ')}` });
  if(missingNodes.length)diagnostics.push({code:'COMFYUI_NODES_MISSING',message:`The reviewed adapter needs: ${missingNodes.join(', ')}`});
  if (!resources.ok) diagnostics.push({ code: 'CUDA_OR_VRAM_UNAVAILABLE', message: 'A measurable local GPU with at least 4 GB VRAM is required for the neural smoke test' });
  return {
    id: provider.id,
    label: 'ComfyUI',
    available,
    modelId: hasModel ? NEURAL_MODEL_IDS[0] : null,
    qualification: 'real-smoke-test-required',
    workflowHash: null,
    health,
    resources,
    diagnostics,
  };
}

function inspectExecutableProvider({ spec, root, env, hardware }) {
  const executable = pathFromEnv(env, spec.executable);
  const model = pathFromEnv(env, spec.model) || modelHint(root, env, [
    `${spec.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.safetensors`,
    `${spec.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.gguf`,
  ]);
  const resources = hardwareReady(hardware);
  const diagnostics = [];
  if (!executable || !existsSync(executable)) diagnostics.push({ code: 'PROVIDER_EXECUTABLE_MISSING', message: `${spec.label} executable is not configured` });
  if (!model || !existsSync(model)) diagnostics.push({ code: 'PROVIDER_MODEL_MISSING', message: `${spec.label} model files are not configured` });
  if (!resources.ok) diagnostics.push({ code: 'CUDA_OR_VRAM_UNAVAILABLE', message: 'A measurable local GPU with at least 4 GB VRAM is required for the neural smoke test' });
  return {
    id: spec.id,
    label: spec.label,
    available: false,
    installed: Boolean(executable && existsSync(executable) && model && existsSync(model)),
    adapterStatus: 'not-implemented',
    executable,
    modelId: model,
    workflowHash: null,
    resources,
    diagnostics,
  };
}

export async function inspectGenerationProviders({ root = process.cwd(), env = process.env, fetchImpl = globalThis.fetch, hardware } = {}) {
  const measuredHardware = hardware || await detectHardware();
  const providers = [await inspectComfyUI({ env, fetchImpl, hardware: measuredHardware }), ...providerSpecs.map(spec => inspectExecutableProvider({ spec, root, env, hardware: measuredHardware }))];
  const selected = providers.find(provider => provider.available) || null;
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    order: [...GENERATION_PROVIDER_ORDER],
    hardware: measuredHardware,
    disk: diskReport(root),
    providers,
    selected: selected ? { id: selected.id, label: selected.label, modelId: selected.modelId } : null,
  };
}

export async function preflightGeneration(options = {}) {
  const report = await inspectGenerationProviders(options);
  if (!report.selected) {
    return {
      status: 'blocked',
      code: 'BLOCKED_NEURAL_GENERATION',
      message: 'No qualified local image-to-video provider, model, and GPU preflight passed. Choose imported media or an explicitly labelled fallback.',
      providerReport: report,
    };
  }
  return { status: 'ready', provider: report.selected.id, modelId: report.selected.modelId, providerReport: report };
}

export function hashJson(value) {
  const canonical = v => Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export async function recordGeneratedProvenance({ jobRoot, outputPath, providerId, modelId, workflow, seed, prompt, durationSeconds, width, height, fps, vramPeakGb = null, renderTimeMs = null, providerEvidence, ffmpeg, ffprobe } = {}) {
  const absoluteRoot = resolve(jobRoot || process.cwd());
  const absoluteOutput = resolve(outputPath || '');
  const rel = relative(absoluteRoot, absoluteOutput);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || !existsSync(absoluteOutput)) {
    return { status: 'blocked', code: 'GENERATED_OUTPUT_OUTSIDE_JOB', message: 'A generated artifact must exist inside the durable VYREALM job directory.' };
  }
  const evidence = await verifyGenerationEvidence({jobRoot:absoluteRoot,outputPath:absoluteOutput,providerId,modelId,workflow,seed,prompt,durationSeconds,width,height,fps,providerEvidence,ffmpeg,ffprobe,hashJson});
  if(!evidence.ok)return {status:'blocked',code:evidence.code,message:evidence.message};
  const bytes = await import('node:fs/promises').then(fs => fs.readFile(absoluteOutput));
  return {
    status: 'generated',
    providerId: providerId || null,
    modelId: modelId || null,
    workflowHash: hashJson(workflow || {}),
    seed: seed ?? null,
    prompt: String(prompt || ''),
    outputPath: rel,
    outputHash: createHash('sha256').update(bytes).digest('hex'),
    durationSeconds: Number(durationSeconds) || null,
    resolution: { width: Number(width) || null, height: Number(height) || null },
    fps: Number(fps) || null,
    vramPeakGb: finite(vramPeakGb),
    renderTimeMs: Number(renderTimeMs) || null,
    providerPromptId: providerEvidence.promptId,
    evidenceHash: evidence.evidenceHash,
    frameCount: evidence.frameCount,
    lineage: evidence.lineage,
  };
}

// A provider can be visible in the machine inventory before a reviewed
// workflow adapter exists. Keep the smoke test conservative until an adapter
// invokes the provider and returns an in-job playable artifact.
export async function runGenerationSmokeTest({ invoke, ...options } = {}) {
  const preflight = await preflightGeneration(options);
  if (preflight.status !== 'ready') return { ...preflight, smokeTest: { status: 'blocked', code: preflight.code } };
  if (typeof invoke !== 'function') {
    return { status: 'blocked', code: 'NEURAL_ADAPTER_SMOKE_TEST_REQUIRED', message: 'A provider was detected, but no reviewed image-to-video adapter is connected; generation remains blocked.', providerReport: preflight.providerReport, smokeTest: { status: 'blocked', code: 'NEURAL_ADAPTER_SMOKE_TEST_REQUIRED' } };
  }
  try {
    const result = await invoke(preflight);
    const provenance = await recordGeneratedProvenance({ ...options, ...result, providerId: result?.providerId || preflight.provider, modelId: result?.modelId || preflight.modelId });
    if (provenance.status !== 'generated') return { status: 'blocked', code: provenance.code, message: provenance.message, providerReport: preflight.providerReport, smokeTest: provenance };
    return { status: 'generated', providerReport: preflight.providerReport, smokeTest: provenance };
  } catch (error) {
    return { status: 'blocked', code: error.code || 'NEURAL_SMOKE_TEST_FAILED', message: error.message, providerReport: preflight.providerReport, smokeTest: { status: 'blocked', code: error.code || 'NEURAL_SMOKE_TEST_FAILED' } };
  }
}
