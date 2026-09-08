import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const HARDWARE_PROFILES = Object.freeze({
  LOW_VRAM_LOCAL: Object.freeze({
    id: 'LOW_VRAM_LOCAL',
    label: 'Low-VRAM local',
    minVramGb: 1,
    minRamGb: 8,
    routes: Object.freeze(['scene3d', 'edit', 'captions', 'audio-mix']),
    blockedRoutes: Object.freeze(['neural-video', 'image', 'music-to-video', 'narration']),
    reason: 'Use compact local planning, Blender scenes and FFmpeg editing; neural generation needs more measured GPU memory.'
  }),
  STANDARD_LOCAL: Object.freeze({
    id: 'STANDARD_LOCAL',
    label: 'Standard local',
    minVramGb: 6,
    // A machine sold as 16 GB reports about 15 GiB through os.totalmem().
    // Keep the boundary in GiB so the target 16 GB laptop is classified
    // consistently across Windows and macOS.
    minRamGb: 15,
    routes: Object.freeze(['scene3d', 'edit', 'captions', 'audio-mix', 'image']),
    blockedRoutes: Object.freeze(['neural-video', 'music-to-video', 'narration']),
    reason: 'Suitable for local planning, 3D, editing and qualified compact image adapters; heavier video/audio models remain gated.'
  }),
  CREATOR_LOCAL: Object.freeze({
    id: 'CREATOR_LOCAL',
    label: 'Creator local',
    minVramGb: 12,
    minRamGb: 32,
    routes: Object.freeze(['scene3d', 'edit', 'captions', 'audio-mix', 'image', 'neural-video', 'music-to-video', 'narration']),
    blockedRoutes: Object.freeze([]),
    reason: 'Hardware budget is suitable for the full local adapter set, subject to each model’s acceptance test.'
  }),
  RENDER_ONLY: Object.freeze({
    id: 'RENDER_ONLY',
    label: 'Render only',
    minVramGb: 0,
    minRamGb: 4,
    routes: Object.freeze(['scene3d', 'edit', 'captions', 'audio-mix']),
    blockedRoutes: Object.freeze(['neural-video', 'image', 'music-to-video', 'narration']),
    reason: 'No measurable discrete GPU was found; CPU rendering and editing are available, while neural adapters are blocked.'
  })
});

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function classifyHardware({ vramGb = null, ramGb = null, gpu = null } = {}) {
  const vram = finite(vramGb) ?? 0;
  const ram = finite(ramGb) ?? 0;
  const hasGpu = Boolean(String(gpu || '').trim()) || vram > 0;
  let id;
  if (!hasGpu) id = 'RENDER_ONLY';
  else if (vram >= 12 && ram >= 32) id = 'CREATOR_LOCAL';
  else if (vram >= 6 && ram >= 15) id = 'STANDARD_LOCAL';
  else id = 'LOW_VRAM_LOCAL';
  const profile = HARDWARE_PROFILES[id];
  return {
    id,
    label: profile.label,
    vramGb: vram,
    ramGb: ram,
    gpu: String(gpu || '').trim() || null,
    routes: [...profile.routes],
    blockedRoutes: [...profile.blockedRoutes],
    reason: profile.reason,
    measured: { vramGb: vramGb !== null && vramGb !== undefined, ramGb: ramGb !== null && ramGb !== undefined, gpu: hasGpu }
  };
}

export function hardwareDiagnostics(profile, route) {
  const p = typeof profile === 'string' ? HARDWARE_PROFILES[profile] : profile;
  const requested = String(route || 'scene3d');
  if (!p || !HARDWARE_PROFILES[p.id]) return { route: 'unsupported', requestedRoute: requested, reason: 'HARDWARE_PROFILE_UNKNOWN', profile: null };
  if (p.routes.includes(requested)) return { route: requested, requestedRoute: requested, status: 'allowed', profile: p.id, reason: null };
  return { route: 'unsupported', requestedRoute: requested, status: 'blocked', profile: p.id, reason: p.id === 'RENDER_ONLY' ? 'NO_DISCRETE_GPU' : 'INSUFFICIENT_HARDWARE_PROFILE' };
}

function parseNvidiaSmi(stdout) {
  const line = String(stdout || '').split(/\r?\n/).map(x => x.trim()).find(Boolean);
  if (!line) return null;
  const parts = line.split(',').map(x => x.trim());
  const vramMb = finite(parts[2]);
  return { gpu: parts[0] || null, driver: parts[1] || null, vramGb: vramMb === null ? null : vramMb / 1024, freeVramGb: finite(parts[4]) === null ? null : finite(parts[4]) / 1024 };
}

async function queryNvidia() {
  const candidates = process.env.VYRELUM_NVIDIA_SMI
    ? [process.env.VYRELUM_NVIDIA_SMI]
    : process.platform === 'win32'
      ? ['C:/Windows/System32/nvidia-smi.exe', 'C:/Windows/system32/nvidia-smi.exe', 'nvidia-smi']
      : ['nvidia-smi'];
  for (const executable of candidates) {
    try {
      const result = await execFileAsync(executable, ['--query-gpu=name,driver_version,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true });
      const parsed = parseNvidiaSmi(result.stdout);
      if (parsed) return parsed;
    } catch { /* try the next OS or PATH location */ }
  }
  return null;
}

let cached;
export async function detectHardware({ refresh = false, nvidia = queryNvidia } = {}) {
  if (cached && !refresh) return structuredClone(cached);
  const overrideVram = finite(process.env.VYRELUM_VRAM_GB);
  const overrideGpu = process.env.VYRELUM_GPU_NAME || null;
  const gpu = overrideVram !== null || overrideGpu ? { gpu: overrideGpu || (overrideVram > 0 ? 'Configured GPU' : null), vramGb: overrideVram ?? 0, driver: null, freeVramGb: null, source: 'environment' } : await nvidia();
  const profile = classifyHardware({ vramGb: gpu?.vramGb, ramGb: os.totalmem() / (1024 ** 3), gpu: gpu?.gpu });
  cached = { schemaVersion: 1, checkedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model || null, cpus: os.cpus().length, totalRamGb: profile.ramGb, gpu: gpu ? { ...gpu } : null, profile };
  return structuredClone(cached);
}

export function resetHardwareCache() { cached = undefined; }

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/hardware-profile.mjs')) console.log(JSON.stringify(await detectHardware(), null, 2));
