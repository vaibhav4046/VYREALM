import { access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = join(ROOT, 'capabilities', 'manifest.json');
let manifestCache;

export class CapabilityError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'CapabilityError'; this.code = code; this.details = details; }
}

export async function getCapabilityManifest() {
  if (!manifestCache) manifestCache = JSON.parse(await readFile(manifestPath, 'utf8'));
  return manifestCache;
}

async function executable(name, root, env) {
  const explicit = env[`VYRELUM_${name.toUpperCase()}`];
  const candidates = explicit ? [explicit] : [];
  if (name === 'blender') candidates.push(join(root, 'work', 'render-development', 'tools', 'blender', 'blender-4.5.13-windows-x64', process.platform === 'win32' ? 'blender.exe' : 'blender'));
  if (name === 'ffmpeg') candidates.push(join(root, 'work', 'render-development', 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  for (const candidate of candidates) if (existsSync(candidate)) return { available: true, path: candidate, source: explicit ? 'configured' : 'bundled' };
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = await execFileAsync(command, [name], { timeout: 1200, windowsHide: true });
    const path = out.stdout.trim().split(/\r?\n/)[0];
    if (path) return { available: true, path, source: 'system' };
  } catch {}
  return { available: false, reason: `${name} is not bundled or configured` };
}

async function localModel(env) {
  const url = env.VYRELUM_OLLAMA_URL || 'http://127.0.0.1:11434';
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return { available: false, reason: `Local model runtime returned HTTP ${response.status}` };
    const body = await response.json();
    const model = env.VYRELUM_DIRECTOR_MODEL || 'qwen3:4b-instruct';
    const found = (body.models || []).some(entry => entry.name === model || entry.model === model);
    return found ? { available: true, model, endpoint: url } : { available: false, reason: `Required local model ${model} is not installed` };
  } catch { return { available: false, reason: 'Ollama loopback is not reachable; start the bundled runtime or install the selected local model' }; }
}

async function dependencyReport(names, root, env) {
  const report = {};
  for (const name of names) {
    if (name === 'node-runtime') report[name] = { available: true, version: process.version };
    else if (name === 'render-worker') report[name] = { available: existsSync(join(root, 'workers', 'render.mjs')), path: join(root, 'workers', 'render.mjs') };
    else if (name === 'director-worker') report[name] = { available: existsSync(join(root, 'runtime', 'director.mjs')), path: join(root, 'runtime', 'director.mjs') };
    else if (name === 'blender' || name === 'ffmpeg') report[name] = await executable(name, root, env);
    else if (name === 'ollama-loopback') report[name] = await localModel(env);
    else if (name === 'ace-step-local') { const path = env.VYRELUM_ACE_STEP_MODEL || join(root, 'data', 'models', 'ace-step'); report[name] = { available: existsSync(path), path, reason: 'ACE-Step checkpoint is not bundled; no model download is attempted' }; }
    else if (name === 'whisper-local') { const path = env.VYRELUM_WHISPER_MODEL || join(root, 'data', 'models', 'whisper'); report[name] = { available: existsSync(path), path, reason: 'Whisper checkpoint is not bundled; supplied transcript captions remain available' }; }
    else if (name === 'kokoro-local') { const path = env.VYRELUM_KOKORO_MODEL || join(root, 'data', 'models', 'kokoro'); report[name] = { available: existsSync(path), path, reason: 'Kokoro checkpoint is not bundled; narration is not claimed available' }; }
    else report[name] = { available: false, reason: `Unknown dependency ${name}` };
  }
  return report;
}

export async function inspectCapabilities({ root = ROOT, env = process.env } = {}) {
  const manifest = await getCapabilityManifest();
  const shared = new Map();
  const result = [];
  for (const capability of manifest.capabilities) {
    const names = [...new Set(capability.dependencies || [])];
    const report = {};
    for (const name of names) {
      if (!shared.has(name)) shared.set(name, dependencyReport([name], root, env).then(x => x[name]));
      report[name] = await shared.get(name);
    }
    const missing = Object.entries(report).filter(([, value]) => !value.available).map(([name, value]) => ({ name, reason: value.reason }));
    result.push({ id: capability.id, label: capability.label, version: capability.version, adapter: capability.adapter, adapterPath: capability.adapterPath, available: missing.length === 0, status: missing.length ? 'blocked' : 'ready', reason: missing.length ? missing.map(x => `${x.name}: ${x.reason}`).join('; ') : 'Required dependencies detected. Run this operation and inspect its output to verify it.', dependencies: report, inputs: capability.inputs, outputs: capability.outputs });
  }
  return { schemaVersion: 1, catalogue: manifest.catalogue, attribution: manifest.attribution, screenedReferences: manifest.screenedReferences || [], capabilities: result };
}

function requireFields(capability, input) {
  if (!input || typeof input !== 'object') throw new CapabilityError('INVALID_INPUT', `${capability.id} input must be an object`);
  for (const field of capability.inputs.required || []) if (input[field] === undefined || input[field] === null) throw new CapabilityError('INVALID_INPUT', `${capability.id} requires ${field}`, { field });
}
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export async function executeCapability(id, input, { root = ROOT, env = process.env } = {}) {
  const manifest = await getCapabilityManifest();
  const capability = manifest.capabilities.find(x => x.id === id);
  if (!capability) throw new CapabilityError('UNKNOWN_CAPABILITY', `Unknown capability ${id}`, { id });
  requireFields(capability, input);
  if (capability.adapter === 'captions') {
    const captions = input.segments.map((segment, index) => {
      const start = number(segment.start), end = number(segment.end);
      if (end < start) throw new CapabilityError('INVALID_INPUT', `Caption segment ${index} ends before it starts`, { index });
      return { id: segment.id || `caption-${index + 1}`, start, end, text: String(segment.text || '').trim() };
    });
    return { schemaVersion: 1, capability: id, captions, transcriptSource: input.transcriptSource || 'supplied-segments' };
  }
  if (capability.adapter === 'cut-list') {
    const takes = input.takes.map((take, index) => ({ id: take.id || `take-${index + 1}`, path: String(take.path || ''), in: number(take.in), out: number(take.out, number(take.duration)) }));
    if (takes.some(take => !take.path || take.out <= take.in)) throw new CapabilityError('INVALID_INPUT', 'Each talking-head take needs a path and a positive in/out range');
    return { schemaVersion: 1, capability: id, timeline: takes.map(take => ({ id: `clip-${take.id}`, kind: 'video', sourceId: take.id, path: take.path, trimStart: take.in, duration: take.out - take.in })) };
  }
  if (capability.adapter === 'music-beat-map') {
    if (!Array.isArray(input.beatGrid) || !input.beatGrid.length) throw new CapabilityError('CAPABILITY_UNAVAILABLE', 'Music-to-video requires a qualified ACE-Step beat grid or supplied beatGrid; no hosted music fallback is used', { dependency: 'ace-step-local' });
    return { schemaVersion: 1, capability: id, beats: input.beatGrid.map((beat, index) => ({ id: beat.id || `beat-${index + 1}`, time: number(beat.time), strength: number(beat.strength, 1) })), shots: input.shots.map((shot, index) => ({ ...shot, beatId: input.beatGrid[index % input.beatGrid.length].id || `beat-${(index % input.beatGrid.length) + 1}` })) };
  }
  if (capability.adapter === 'audio-mix') {
    const deps = await dependencyReport(['ffmpeg'], root, env);
    if (!deps.ffmpeg.available) throw new CapabilityError('CAPABILITY_UNAVAILABLE', deps.ffmpeg.reason, { dependency: 'ffmpeg' });
    const tracks = input.tracks.map((track, index) => ({ id: track.id || `track-${index + 1}`, path: String(track.path || ''), gainDb: number(track.gainDb), pan: Math.max(-1, Math.min(1, number(track.pan))) }));
    if (tracks.some(track => !track.path)) throw new CapabilityError('INVALID_INPUT', 'Every audio track needs a local path');
    return { schemaVersion: 1, capability: id, mixGraph: { tracks, output: input.outputPath || 'mix.wav' }, outputPath: input.outputPath || 'mix.wav', renderer: deps.ffmpeg.path };
  }
  const deps = await dependencyReport(capability.dependencies || [], root, env);
  const missing = Object.entries(deps).filter(([, value]) => !value.available);
  if (missing.length) throw new CapabilityError('CAPABILITY_UNAVAILABLE', missing.map(([name, value]) => `${name}: ${value.reason}`).join('; '), { dependencies: deps });
  return { schemaVersion: 1, capability: id, adapter: capability.adapter, status: 'ready-to-queue', request: { ...input, capability: id } };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/registry.mjs')) {
  console.log(JSON.stringify(await inspectCapabilities(), null, 2));
}
