import { mkdir, readFile, writeFile, rename, unlink, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { homedir } from 'node:os';

const ROOT = process.env.VYRELUM_RUNTIME_DIR || path.resolve('data/runtime');
const CACHE = path.join(ROOT, 'plan-cache');
// All VYREALM workspaces on this user account share one physical GPU budget.
// Tests can select an isolated lease directory explicitly.
const GPU_ROOT=process.env.VYRELUM_GPU_LEASE_DIR||path.join(process.env.APPDATA||path.join(homedir(),'.local','state'),'vyrelum','runtime');
export function capabilityRoute({ route = 'scene3d', capabilities = {}, hardware = {} } = {}) {
  // Hardware preflight can provide an explicit profile; honor its measured
  // route budget before capability-specific checks so unsupported requests
  // fail with a stable, user-facing diagnostic.
  const profile = hardware.profile;
  if (profile && Array.isArray(profile.blockedRoutes) && profile.blockedRoutes.includes(route)) {
    return { route: 'unsupported', reason: profile.id === 'RENDER_ONLY' ? 'NO_DISCRETE_GPU' : 'INSUFFICIENT_HARDWARE_PROFILE', profile: profile.id };
  }
  if (route === 'neural-video' && !capabilities['neural-video']) return { route: 'unsupported', reason: 'NEURAL_VIDEO_MODEL_UNQUALIFIED' };
  if (route === 'image' && !capabilities.image) return { route: 'unsupported', reason: 'IMAGE_MODEL_UNQUALIFIED' };
  if (hardware.vramGb && hardware.vramGb < 4 && route !== 'scene3d') return { route: 'unsupported', reason: 'INSUFFICIENT_VRAM' };
  return { route };
}
// An OS-backed SQLite write lock is released automatically on process death.
// No wall-clock expiry can evict a live worker. The caller must retain this
// lease until its GPU child has terminated (including cancellation cleanup).
export async function acquireGpuLease(owner, { root = GPU_ROOT } = {}) {
  if (typeof owner !== 'string' || !owner) throw new TypeError('GPU_LEASE_OWNER_REQUIRED');
  await mkdir(root, { recursive: true });
  const db = new DatabaseSync(path.join(root, 'gpu-lease.sqlite'));
  try { db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); }
  catch (error) {
    db.close();
    if (error.errcode === 5 || error.errcode === 6 || /locked|busy/i.test(error.message)) throw new Error('GPU_LEASE_BUSY', { cause: error });
    throw error;
  }
  const workerFile = path.join(root, 'gpu-worker.json');
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
  try {
    const prior = JSON.parse(await readFile(workerFile, 'utf8'));
    if (Number.isInteger(prior.pid) && prior.pid > 0 && alive(prior.pid)) throw new Error('GPU_LEASE_BUSY');
  } catch (error) {
    if (error.code !== 'ENOENT') { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try { await unlink(workerFile).catch(e => { if (e.code !== 'ENOENT') throw e; }); } finally { try { db.exec('ROLLBACK'); } finally { db.close(); } }
  };
  release.registerChild = async pid => {
    if (released || !Number.isInteger(pid) || pid < 1) throw new Error('INVALID_GPU_CHILD');
    const temporary = `${workerFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ pid, owner }), {flag:'wx'});
    await rename(temporary, workerFile);
  };
  return release;
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw new TypeError('CACHE_INPUT_MUST_BE_JSON');
}
// Callers can pass model digest, adapter version, and other provenance in
// identity or input. Namespace version invalidates entries from older formats.
export function cacheKey(input, identity = {}) {
  return createHash('sha256').update(canonical({ namespace: 'vyrelum-plan-cache-v2', identity, input })).digest('hex');
}
export async function readPlanCache(input, identity = {}) {
  const key = cacheKey(input, identity);
  try {
    const entry = JSON.parse(await readFile(path.join(CACHE, `${key}.json`), 'utf8'));
    return entry.key === key && entry.version === 2 ? entry.value : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}
export async function writePlanCache(input, value, identity = {}) {
  const key = cacheKey(input, identity);
  const serialized = JSON.stringify({ version: 2, key, value });
  await mkdir(CACHE, { recursive: true });
  const destination = path.join(CACHE, `${key}.json`);
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    // Immutable first writer wins; hard-link publication is atomic on Windows too.
    await link(temporary, destination).catch(error => { if (error.code !== 'EEXIST') throw error; });
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return destination;
}

