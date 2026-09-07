import { readFile, stat, copyFile, rename, appendFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.VYRELUM_ROOT || join(fileURLToPath(new URL('.', import.meta.url)), '..');
const manifestPath = join(root, 'runtime', 'manifest.json');
export async function readManifest(path = manifestPath) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.artifacts)) throw new Error('Unsupported runtime manifest');
  return value;
}
export async function inspectRuntime(path = manifestPath) {
  const manifest = await readManifest(path);
  const artifacts = [];
  for (const artifact of manifest.artifacts) {
    if (artifact.path.startsWith('http:') || artifact.path.startsWith('https:')) {
      artifacts.push({ id: artifact.id, status: 'external', path: artifact.path });
      continue;
    }
    const absolute = isAbsolute(artifact.path) ? artifact.path : join(root, artifact.path);
    try {
      const info = await stat(absolute);
      artifacts.push({ id: artifact.id, status: 'present', path: absolute, kind: info.isDirectory() ? 'directory' : 'file' });
    } catch {
      artifacts.push({ id: artifact.id, status: artifact.required ? 'missing-required' : 'missing-optional', path: absolute });
    }
  }
  return { schemaVersion: 1, checkedAt: new Date().toISOString(), policy: manifest.policy, artifacts };
}
export async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
export async function replaceWithVerified(source, destination, expectedSha256) {
  const actual = await sha256(source);
  if (actual.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    const error = new Error('Integrity check failed; repair was not applied');
    error.code = 'INTEGRITY_MISMATCH';
    throw error;
  }
  const backup = `${destination}.previous`;
  try { await stat(destination); await rename(destination, backup); } catch { /* no prior version */ }
  await copyFile(source, destination);
  return { destination, backup: await stat(backup).then(() => backup).catch(() => null), sha256: actual };
}
export async function downloadResumable(url, destination, expectedSha256, { fetchImpl = fetch } = {}) {
  if (!/^https:\/\//i.test(String(url))) throw Object.assign(new Error('Only explicit HTTPS downloads are allowed'), { code: 'NETWORK_POLICY' });
  const partial = `${destination}.partial`; let offset = 0;
  try { offset = (await stat(partial)).size; } catch {}
  const response = await fetchImpl(url, offset ? { headers: { Range: `bytes=${offset}-` } } : {});
  if (!response.ok && response.status !== 206) throw new Error(`Download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (offset && response.status === 206) await appendFile(partial, bytes); else { offset = 0; await writeFile(partial, bytes); }
  const actual = await sha256(partial);
  if (actual.toLowerCase() !== String(expectedSha256).toLowerCase()) throw Object.assign(new Error('Downloaded artifact checksum does not match manifest'), { code: 'INTEGRITY_MISMATCH', actual });
  const result = await replaceWithVerified(partial, destination, expectedSha256); await unlink(partial).catch(() => {}); return { ...result, bytes: (await stat(destination)).size };
}
export async function storageUsage(directory) {
  const walk = async path => { const info = await stat(path); if (!info.isDirectory()) return info.size; let total = 0; for (const entry of await readdir(path)) total += await walk(join(path, entry)); return total; };
  try { return await walk(directory); } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await inspectRuntime(), null, 2));
}
