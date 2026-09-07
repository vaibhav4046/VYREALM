/**
 * Truthful local model routing inventory. A descriptor is only `ready` when
 * its executable/checkpoint has passed the host preflight; registry entries do
 * not imply that weights are bundled or that a route can run on 6 GB VRAM.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProviderRegistry } from './providers/registry.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const MODEL_DESCRIPTORS = Object.freeze([
  { id: 'ollama-local', version: 'loopback', license: 'model-specific', capabilities: ['plan', 'script'], minVramGb: 0, minRamGb: 8, checkpointEnv: 'VYRELUM_DIRECTOR_MODEL', offline: true },
  { id: 'comfyui-local', version: 'loopback', license: 'workflow/model-specific', capabilities: ['keyframe', 'image-to-video'], minVramGb: 6, minRamGb: 16, checkpointEnv: 'VYRELUM_COMFYUI_URL', offline: true },
  { id: 'wan2.2', version: 'screened', license: 'Apache-2.0 code; model terms pending', capabilities: ['text-to-video', 'image-to-video'], minVramGb: 12, minRamGb: 32, offline: true },
  { id: 'wan2gp', version: 'screened', license: 'WanGP Community License 2.0', capabilities: ['image-to-video'], minVramGb: 6, minRamGb: 16, offline: true },
  { id: 'framepack', version: 'screened', license: 'Apache-2.0 code; model terms pending', capabilities: ['long-image-to-video'], minVramGb: 8, minRamGb: 16, offline: true },
  { id: 'whisper-local', version: 'checkpoint-required', license: 'project/model-specific', capabilities: ['transcription', 'captions'], minVramGb: 0, minRamGb: 8, checkpointDir: 'data/models/whisper', offline: true },
  { id: 'piper-local', version: 'checkpoint-required', license: 'project/voice-specific', capabilities: ['narration'], minVramGb: 0, minRamGb: 8, checkpointDir: 'data/models/piper', offline: true },
  { id: 'real-esrgan', version: 'checkpoint-required', license: 'model-specific', capabilities: ['upscale-4k'], minVramGb: 2, minRamGb: 8, checkpointDir: 'data/models/real-esrgan', offline: true },
  { id: 'ffmpeg-local', version: 'bundled', license: 'LGPL/GPL build notice', capabilities: ['compose', 'encode', 'audio-mix'], minVramGb: 0, minRamGb: 4, executable: 'workers/tools/ffmpeg.exe', offline: true }
]);

export async function inspectModelRouter({ root = ROOT, env = process.env, providers = null } = {}) {
  const providerReports = providers || await createProviderRegistry({ env }).inspect();
  return MODEL_DESCRIPTORS.map(descriptor => {
    const endpoint = descriptor.id === 'comfyui-local' && providerReports.find(item => item.id === 'comfyui-local');
    const configured = descriptor.checkpointEnv ? Boolean(env[descriptor.checkpointEnv]) : false;
    const path = descriptor.checkpointDir ? resolve(root, env[`VYRELUM_${descriptor.id.replaceAll('-', '_').toUpperCase()}_MODEL`] || descriptor.checkpointDir) : descriptor.executable ? resolve(root, descriptor.executable) : null;
    const installed = path ? existsSync(path) : configured || Boolean(endpoint?.health?.status === 'ready');
    const status = descriptor.id === 'ffmpeg-local' && installed ? 'ready' : installed ? 'detected_unqualified' : 'blocked';
    return { ...descriptor, status, installed, path, diagnostic: status === 'ready' ? null : status === 'detected_unqualified' ? 'Preflight and acceptance test required before production routing.' : 'Not installed or loopback endpoint unavailable; route remains blocked.' };
  });
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/model-router.mjs')) console.log(JSON.stringify(await inspectModelRouter(), null, 2));
