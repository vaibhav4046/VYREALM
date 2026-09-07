import { sceneSchema, validateScene } from './scene-contract.mjs';
import { capabilityRoute, readPlanCache, writePlanCache } from './inference-harness.mjs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const MODEL = process.env.VYRELUM_DIRECTOR_MODEL || 'qwen3:4b-instruct';
const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const ROUTES = new Set(['scene3d', 'neural-video', 'image']);
const CAMERAS = new Set(['static', 'orbit', 'dolly', 'truck', 'pan', 'tilt']);
const schema = { type: 'object', required: ['title', 'treatment', 'shots'], properties: { title: { type: 'string' }, treatment: { type: 'string' }, shots: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', required: ['prompt', 'durationFrames', 'camera', 'route'], properties: { prompt: { type: 'string' }, durationFrames: { type: 'integer', minimum: 1 }, camera: { type: 'string' }, route: { type: 'string' }, caption: { type: 'string' } } } } } };
schema.required.push('scene'); schema.properties.scene = sceneSchema;
const OPTIONS = { temperature: 0.2, num_ctx: 4096, num_predict: 2600 };
function id(prefix, n) { return `${prefix}-${String(n + 1).padStart(2, '0')}`; }
function cleanCaption(value, index) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return `CHAPTER ${String(index + 1).padStart(2, '0')}`;
  const lead = text.split(/\s+(?:with|and|to|that)\s+/i)[0].trim();
  const cinematic = lead.replace(/^(?:exploration of|boarding|sailing through|entering|crossing|watching|following)\s+/i, '').trim();
  if (/^the\s+/i.test(cinematic) && cinematic.split(/\s+/).length <= 6) return cinematic.toUpperCase();
  const words = lead.split(/\s+/);
  if (lead.length <= 48 && words.length <= 7) return lead;
  return `${words.slice(0, 6).join(' ').slice(0, 44).trim()}…`;
}
function validate(raw, { fps, durationSeconds }) {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !Array.isArray(raw.shots) || !raw.shots.length) throw new Error('DIRECTOR_INVALID_OUTPUT: title/shots missing');
  const total = Math.max(1, Math.round(fps * durationSeconds));
  const shots = raw.shots.slice(0, 12).map((s, i) => ({ id: id('shot', i), prompt: String(s.prompt || '').trim().slice(0, 1200), route: ROUTES.has(s.route) ? s.route : 'scene3d', durationFrames: Math.max(1, Math.round(Number(s.durationFrames) || Math.floor(total / raw.shots.length))), camera: CAMERAS.has(s.camera) ? s.camera : 'static', caption: cleanCaption(s.caption, i) })).filter(s => s.prompt);
  if (!shots.length) throw new Error('DIRECTOR_INVALID_OUTPUT: no usable shot prompts');
  let remain = total; shots.forEach((s, i) => { s.durationFrames = i === shots.length - 1 ? Math.max(1, remain) : Math.min(Math.max(1, s.durationFrames), Math.max(1, remain - (shots.length - i - 1))); remain -= s.durationFrames; });
  return { title: raw.title.trim().slice(0, 200), treatment: String(raw.treatment || '').trim().slice(0, 2000), shots };
}
export async function createProduction({ brief, projectId = 'local-project', revision = 1, durationSeconds = 12, fps = 24, capabilities = {}, signal, onProgress } = {}) {
  if (typeof brief !== 'string' || !brief.trim()) throw new Error('DIRECTOR_BRIEF_REQUIRED');
  const start = Date.now(); onProgress?.({ phase: 'checking-runtime', progress: 0.05 });
  const endpoint = new URL(OLLAMA);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.protocol !== 'http:' || endpoint.username || endpoint.password) throw Error('DIRECTOR_LOOPBACK_REQUIRED');
  if (!Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 120 || brief.length > 4000) throw Error('DIRECTOR_INPUT_BOUNDS');
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
  const tags = await fetch(`${OLLAMA}/api/tags`, {signal: boundedSignal, redirect:'error'});
  if (!tags.ok) throw Error('DIRECTOR_RUNTIME_UNAVAILABLE');
  const health = { ollama: { json: await tags.json() } };
  const available = health.ollama?.json?.models?.some(m => m.name === MODEL || m.model === MODEL);
  if (!available) throw new Error(`DIRECTOR_MODEL_UNAVAILABLE: ${MODEL}`);
  const total = Math.max(1, Math.round(fps * durationSeconds));
  const cacheInput = { brief: brief.trim(), projectId, revision, durationSeconds, fps, capabilities };
  const cacheIdentity = { runtime:'ollama', endpoint:OLLAMA, model:MODEL, digest:health.ollama.json.models.find(m => m.name === MODEL || m.model === MODEL)?.digest, schema, options:OPTIONS, promptVersion:4 };
  const cached = await readPlanCache(cacheInput, cacheIdentity);
  if (cached?.schemaVersion === 1 && cached.projectId === projectId && cached.revision === revision) {
    onProgress?.({ phase: 'cache-hit', progress: 1, shots: cached.scenes?.[0]?.shots?.length || 0 });
    return { ...cached, modelEvidence: { ...cached.modelEvidence, cacheHit: true, wallMs: Date.now() - start } };
  }
  const prompt = `You are VYRELUM's local production director. Turn this brief into an executable, editable shot plan. Return JSON only matching the supplied schema. Use scene3d only for editable primitive 3D. If the request requires unavailable neural-video/image, preserve that requested route so it can be diagnosed as blocked. Available capabilities: ${JSON.stringify(capabilities)}. Include scene: choose 2-4 primitives, materials, lighting, camera and actual motion keyframes to depict the brief. All coordinates within -30..30; scales 0.01..15; rotations are Euler radians (-12..12); colors/metallic/roughness 0..1. Use snake_case IDs and existing material references. At least one object must move or rotate between frame 1 and frame ${total}. Camera looks down local -Z; suggest rotation near [1.15,0,0.65] and position near [6,-8,5] when looking at origin. Lens 15..120, light energy 0..5000. Keep scene compact, no more than 4 objects. Do not include scripts or paths. Exactly sum durations to ${total} frames at ${fps} fps. Brief: ${brief}`;
  const body = { model: MODEL, system: 'You produce safe production data. Never emit commands, file paths, URLs, credentials, or arbitrary tool calls.', prompt, format: schema, stream: false, think: false, keep_alive: 0, options: OPTIONS };
  onProgress?.({ phase: 'inference', progress: 0.15, model: MODEL });
  const r = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: boundedSignal, redirect:'error' });
  if (!r.ok) throw new Error(`DIRECTOR_RUNTIME_HTTP_${r.status}`);
  const data = await r.json(); let raw;
  try { raw = JSON.parse(data.response); } catch { throw new Error('DIRECTOR_INVALID_JSON'); }
  const plan = validate(raw, { fps, durationSeconds });
  const scene = validateScene(raw.scene, {frames:total,fps});
  const hardware = { vramGb: Number(process.env.VYRELUM_VRAM_GB || 6) };
  const routeDiagnostics = [];
  const routedShots = plan.shots.map(shot => {
    const decision = capabilityRoute({ route: shot.route, capabilities, hardware });
    if (decision.route === 'unsupported') {
      routeDiagnostics.push({ shotId: shot.id, requestedRoute: shot.route, selectedRoute: 'unsupported', reason: decision.reason });
      return { ...shot, route: shot.route, status:'blocked', diagnostic:decision.reason };
    }
    return { ...shot, route: decision.route };
  });
  const scenes = [{ id: 'scene-01', title: plan.title, purpose: plan.treatment, shots: routedShots.map((s, i) => ({ ...s, sceneId: 'scene-01', startFrame: routedShots.slice(0, i).reduce((n, x) => n + x.durationFrames, 0), endFrame: routedShots.slice(0, i + 1).reduce((n, x) => n + x.durationFrames, 0), camera: { type: s.camera }, capabilities })) }];
  const operations = [{ type: 'create_scene', sceneId: 'scene-01', revision }, ...routedShots.map((s, i) => ({ type: 'propose_shot', sceneId: 'scene-01', shotId: id('shot', i), revision, route: s.route, requestedRoute: plan.shots[i].route, durationFrames: s.durationFrames, prompt: s.prompt }))];
  onProgress?.({ phase: 'validated', progress: 1, shots: plan.shots.length });
  const result = { schemaVersion: 1, projectId, revision, fps, durationFrames: total, title: plan.title, treatment: plan.treatment, scene, scenes, operations, status: routeDiagnostics.length ? 'blocked' : 'ready', timeline: scenes[0].shots.map(s=>({id:s.id,kind:s.route,duration:s.durationFrames/fps,caption:s.caption,startFrame:s.startFrame,endFrame:s.endFrame,status:s.status||'ready'})), modelEvidence: { runtime: 'ollama', endpoint: OLLAMA, model: data.model || MODEL, digest: health.ollama.json.models.find(m => (m.name || m.model) === MODEL)?.digest, totalDurationNs: data.total_duration, loadDurationNs: data.load_duration, evalCount: data.eval_count, routeDiagnostics, wallMs: Date.now() - start } };
  await writePlanCache(cacheInput, result, cacheIdentity);
  return result;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/director.mjs')) {
  const args = process.argv.slice(2), inputIndex = args.indexOf('--input'), outputIndex = args.indexOf('--output');
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : null, outputDir = outputIndex >= 0 ? args[outputIndex + 1] : null;
  const run = async () => {
    let request = {};
    if (inputPath) request = JSON.parse(await readFile(inputPath, 'utf8'));
    else request.brief = args.filter((x, i) => !['--input', '--output'].includes(x) && i !== inputIndex + 1 && i !== outputIndex + 1).join(' ') || 'A red kite rescues a silver bell from a snowy tower.';
    const result = await createProduction({ brief: request.brief, projectId: request.projectId, revision: request.revision, durationSeconds: request.durationSeconds, fps: request.fps, capabilities: request.capabilities });
    if (outputDir) { await mkdir(outputDir, { recursive: true }); const tmp = `${outputDir}/result.json.tmp-${process.pid}`; await writeFile(tmp, JSON.stringify(result, null, 2), 'utf8'); await rename(tmp, `${outputDir}/result.json`); }
    console.log(JSON.stringify(result, null, 2));
  };
  run().catch(e => { console.error(e.message); process.exitCode = 1; });
}
