import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ProviderError, unavailable } from './provider-contract.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MODEL_FOLDERS = ['checkpoints', 'diffusion_models', 'unet', 'text_encoders', 'clip_gguf', 'unet_gguf', 'vae', 'loras', 'controlnet', 'upscale_models'];
const TIMEOUT_MS = 1800;

function endpoint(value) {
  let url;
  try { url = new URL(value || 'http://127.0.0.1:8188'); } catch { throw new ProviderError('COMFYUI_URL_INVALID', 'ComfyUI base URL is invalid'); }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password) throw new ProviderError('COMFYUI_LOOPBACK_REQUIRED', 'ComfyUI must use an unauthenticated HTTP loopback URL', { baseUrl: url.origin });
  return url.origin.replace(/\/$/, '');
}

async function jsonRequest(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
    let body = null;
    try { body = await response.json(); } catch {}
    return { response, body };
  } catch (error) {
    return { response: null, body: null, error };
  } finally { clearTimeout(timer); }
}

function namesFromObjectInfo(body) { return body && typeof body === 'object' ? Object.keys(body) : []; }
function modelNames(body) { return Array.isArray(body) ? body.map(x => typeof x === 'string' ? x : x?.name).filter(Boolean) : []; }

export class ComfyUIProvider {
  constructor({ env = process.env, baseUrl, fetchImpl = globalThis.fetch, hardware = {} } = {}) {
    this.id = 'comfyui-local';
    this.baseUrl = endpoint(baseUrl || env.VYRELUM_COMFYUI_URL || 'http://127.0.0.1:8188');
    this.fetch = fetchImpl;
    this.hardware = hardware;
    this._health = null;
  }

  capabilities() {
    return {
      provider: this.id,
      operations: ['generate_image', 'generate_video', 'animate_image', 'retrieve_result', 'cancel'],
      status: this._health?.available ? 'available' : 'unknown',
      modelRequirements: { image: ['checkpoint'], video: ['video model', 'custom nodes may be required'] },
      network: 'loopback-only',
    };
  }

  install_instructions() {
    return {
      provider: this.id,
      platform: process.platform,
      steps: [
        'Install ComfyUI from its official release for your operating system.',
        'Start it with the API enabled on a loopback address (default http://127.0.0.1:8188).',
        'Install only model checkpoints and custom nodes whose licenses you have reviewed.',
        'Use VYRELUM Models > Refresh to re-run health and model checks.',
      ],
      downloadsPerformed: 0,
      credentialsRequired: false,
    };
  }

  async health_check() {
    if (typeof this.fetch !== 'function') return this._health = { provider: this.id, available: false, reason: 'Fetch is unavailable in this runtime' };
    const statsP = jsonRequest(this.fetch, `${this.baseUrl}/system_stats`);
    const nodesP = jsonRequest(this.fetch, `${this.baseUrl}/object_info`);
    const modelPs = MODEL_FOLDERS.map(folder => jsonRequest(this.fetch, `${this.baseUrl}/models/${folder}`));
    const [stats, nodes, ...models] = await Promise.all([statsP, nodesP, ...modelPs]);
    if (!stats.response?.ok) {
      const reason = stats.response ? `ComfyUI returned HTTP ${stats.response.status}` : `ComfyUI loopback is not reachable (${stats.error?.code || stats.error?.message || 'request failed'})`;
      return this._health = { provider: this.id, available: false, baseUrl: this.baseUrl, reason, diagnostic: { code: 'COMFYUI_UNAVAILABLE', url: this.baseUrl } };
    }
    const nodeNames = nodes.response?.ok ? namesFromObjectInfo(nodes.body) : [];
    const installedModels = Object.fromEntries(models.map((result, index) => [MODEL_FOLDERS[index], result.response?.ok ? modelNames(result.body) : []]));
    const modelCount = Object.values(installedModels).reduce((n, values) => n + values.length, 0);
    return this._health = { provider: this.id, available: true, baseUrl: this.baseUrl, system: stats.body || {}, nodeCount: nodeNames.length, nodes: nodeNames, installedModels, modelCount, checkedAt: new Date().toISOString(), diagnostics: nodes.response?.ok ? [] : [{ code: 'NODE_LIST_UNAVAILABLE', reason: 'ComfyUI /object_info did not respond; node requirements cannot be verified' }] };
  }

  estimate_resources(request = {}) {
    const width = Math.max(64, Number(request.width) || 512), height = Math.max(64, Number(request.height) || 512), frames = Math.max(1, Number(request.frames) || 1), batch = Math.max(1, Number(request.batch) || 1);
    // Conservative preflight: activations scale with pixels × frames. This is a warning, not a claim of model support.
    const estimatedVramGb = Math.max(1, width * height * frames * batch * 4 / (1024 ** 3) * 8);
    const availableVramGb = Number(this.hardware.vramGb || process.env.VYRELUM_VRAM_GB || 0);
    const diskNeedGb = Math.max(0, Number(request.diskNeedGb) || 0);
    const availableDiskGb = Number(this.hardware.freeDiskGb || process.env.VYRELUM_FREE_DISK_GB || 0);
    const warnings = [];
    if (availableVramGb && estimatedVramGb > availableVramGb) warnings.push(`Estimated VRAM ${estimatedVramGb.toFixed(1)} GB exceeds available ${availableVramGb.toFixed(1)} GB`);
    if (availableDiskGb && diskNeedGb > availableDiskGb) warnings.push(`Estimated disk need ${diskNeedGb.toFixed(1)} GB exceeds available ${availableDiskGb.toFixed(1)} GB`);
    if (frames > 24) warnings.push('Long neural-video requests are not recommended on constrained local hardware');
    if (width * height > 1920 * 1080) warnings.push('Resolution exceeds the conservative local preflight profile');
    return { width, height, frames, batch, estimatedVramGb: Number(estimatedVramGb.toFixed(2)), availableVramGb, diskNeedGb, availableDiskGb, warnings, safe: warnings.length === 0 };
  }

  async _preflight(request, operation) {
    const health = this._health || await this.health_check();
    if (!health.available) throw new ProviderError('PROVIDER_UNAVAILABLE', health.reason, { operation, health });
    const requiredNodes = [...new Set(request.requiredNodes || [])], requiredModels = [...new Set(request.requiredModels || [])];
    const missingNodes = requiredNodes.filter(name => !health.nodes.includes(name));
    const installed = Object.values(health.installedModels || {}).flat();
    const missingModels = requiredModels.filter(name => !installed.includes(name));
    const resources = this.estimate_resources(request);
    if (missingNodes.length || missingModels.length) throw new ProviderError('WORKFLOW_REQUIREMENTS_MISSING', 'ComfyUI workflow requirements are not installed', { operation, missingNodes, missingModels, resources });
    if (resources.warnings.length && request.allowResourceWarnings !== true) throw new ProviderError('RESOURCE_PREFLIGHT_FAILED', resources.warnings.join('; '), { operation, resources });
    return { health, resources };
  }

  async upload_inputs(inputs = []) {
    if (!Array.isArray(inputs) || !inputs.length) throw new ProviderError('INVALID_INPUT', 'upload_inputs requires at least one input');
    const uploaded = [];
    for (const item of inputs) {
      const filename = String(item.filename || 'input.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
      const data = item.data instanceof Uint8Array || Buffer.isBuffer(item.data) ? item.data : item.path ? await readFile(item.path) : null;
      if (!data) throw new ProviderError('INVALID_INPUT', `Input ${filename} has no bytes or local path`);
      const form = new FormData(); form.append('image', new Blob([data]), filename); form.append('overwrite', 'false');
      const result = await jsonRequest(this.fetch, `${this.baseUrl}/upload/image`, { method: 'POST', body: form, timeout: 15000 });
      if (!result.response?.ok) throw new ProviderError('UPLOAD_FAILED', `ComfyUI input upload failed for ${filename}`, { status: result.response?.status, response: result.body });
      uploaded.push({ filename, ...result.body });
    }
    return { provider: this.id, uploaded };
  }

  async _submit(operation, request = {}) {
    await this._preflight(request, operation);
    if (!request.workflow || typeof request.workflow !== 'object' || Array.isArray(request.workflow)) throw new ProviderError('INVALID_WORKFLOW', 'A ComfyUI workflow object is required');
    const body = { prompt: request.workflow, client_id: request.clientId || randomUUID() };
    const result = await jsonRequest(this.fetch, `${this.baseUrl}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), timeout: 15000 });
    if (!result.response?.ok || !result.body?.prompt_id) throw new ProviderError('SUBMIT_FAILED', `ComfyUI rejected the workflow${result.body?.error ? `: ${result.body.error}` : ''}`, { status: result.response?.status, response: result.body });
    return { provider: this.id, operation, status: 'queued', promptId: result.body.prompt_id, clientId: body.client_id, resources: this.estimate_resources(request) };
  }

  generate_image(request = {}) { return this._submit('generate_image', request); }
  generate_video(request = {}) { return this._submit('generate_video', request); }
  animate_image(request = {}) { return this._submit('animate_image', request); }
  async transcribe() { return unavailable('transcribe', this.id, 'ComfyUI is an image/video graph runner; configure a local Whisper provider for transcription'); }
  async synthesize_speech() { return unavailable('synthesize_speech', this.id, 'Configure a local TTS provider; ComfyUI does not provide speech by default'); }
  async animate_avatar() { return unavailable('animate_avatar', this.id, 'No qualified avatar workflow is installed'); }
  async upscale(request = {}) { return this._submit('upscale', request); }
  async interpolate(request = {}) { return this._submit('interpolate', request); }
  async retrieve_result(promptId) {
    if (!promptId) throw new ProviderError('INVALID_INPUT', 'retrieve_result requires promptId');
    const result = await jsonRequest(this.fetch, `${this.baseUrl}/history/${encodeURIComponent(promptId)}`);
    if (!result.response?.ok) throw new ProviderError('RETRIEVE_FAILED', `ComfyUI history request failed`, { status: result.response?.status, promptId });
    const entry = result.body?.[promptId] || result.body;
    const outputs = entry?.outputs || {};
    const status = entry?.status?.status_str === 'error' ? 'failed' : entry?.status?.completed ? 'completed' : 'running';
    return { provider: this.id, promptId, status, outputs, error: entry?.status?.messages?.find(m => String(m?.[0]).toLowerCase().includes('error')) || null };
  }
  async cancel(promptId) {
    if (!promptId) throw new ProviderError('INVALID_INPUT', 'Cancellation requires the owned prompt ID');
    const queue = await jsonRequest(this.fetch, `${this.baseUrl}/queue`);
    if (!queue.response?.ok) throw new ProviderError('CANCEL_FAILED', 'Cannot inspect owned provider job before cancellation');
    const running = (queue.body?.queue_running || []).some(entry => entry[1] === promptId);
    const pending = (queue.body?.queue_pending || []).some(entry => entry[1] === promptId);
    if (!running && !pending) return { provider: this.id, promptId, status: 'not-active' };
    // ComfyUI interrupt is global. Never interrupt an unrelated local job.
    const result = await jsonRequest(this.fetch, `${this.baseUrl}/${running ? 'interrupt' : 'queue'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(running ? { prompt_id: promptId } : { delete: [promptId] }) });
    if (!result.response?.ok) throw new ProviderError('CANCEL_FAILED', 'ComfyUI cancel request failed', { status: result.response?.status, promptId });
    return { provider: this.id, promptId, status: 'cancelled' };
  }
}

export function createComfyUIProvider(options = {}) { return new ComfyUIProvider(options); }
