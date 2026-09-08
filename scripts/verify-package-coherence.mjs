import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';

// Read-only package audit. This does not launch an installer or application.
const [packageDirectory, evidencePath] = process.argv.slice(2);
assert.ok(packageDirectory, 'Usage: node scripts/verify-package-coherence.mjs <win-unpacked> [evidence.json]');
const root = resolve('.'), resources = resolve(packageDirectory, 'resources');
const unpacked = join(resources, 'app.asar.unpacked');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checked = new Set(), files = [];
async function check(name) {
  if (checked.has(name)) return;
  checked.add(name);
  const sourcePath = resolve(root, name);
  assert.ok(!relative(root, sourcePath).startsWith('..'), `Import escapes source: ${name}`);
  const source = await readFile(sourcePath), bundled = await readFile(join(unpacked, name));
  assert.equal(digest(bundled), digest(source), `Package differs from current source: ${name}`);
  files.push({ path: name, sha256: digest(source), bytes: source.length });
  if (!/\.[cm]?js$/.test(name)) return;
  const imports = source.toString().matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g);
  for (const match of imports) {
    const dependency = relative(root, resolve(dirname(sourcePath), match[1])).replaceAll('\\', '/');
    await check(dependency);
  }
}
for (const entry of ['index.html', 'styles.css', 'app.js', 'server.js', 'workers/render.mjs', 'workers/audio.mjs', 'workers/audio-local.py', 'workers/sound-design.mjs', 'workers/raw-footage.mjs', 'workers/raw-footage-asr.py']) await check(entry);
for (const entry of ['runtime/notices/FFmpeg-GPL-3.0.txt','runtime/notices/FFmpeg-NOTICE.txt','runtime/notices/FFmpeg-build-configuration.txt','workers/tools/ffmpeg.exe','workers/tools/ffprobe.exe']) await check(entry);
for (const entry of ['desktop/main.mjs', 'desktop/preload.cjs', 'desktop/oauth.mjs', 'desktop/runtime-paths.mjs', 'package.json', 'LICENSE']) {
  const source = await readFile(join(root, entry));
  const bundled = extractFile(join(resources, 'app.asar'), entry);
  assert.equal(digest(bundled), digest(source), `Archived package differs: ${entry}`);
  files.push({ path: entry, sha256: digest(source), bytes: source.length });
}
const evidence = { createdAt: new Date().toISOString(), packageDirectory: resolve(packageDirectory), scope: 'Current-source hashes and static relative import closure; no installer or Electron launch', fileCount: files.length, files };
if (evidencePath) { await mkdir(dirname(resolve(evidencePath)), { recursive: true }); await writeFile(evidencePath, JSON.stringify(evidence, null, 2)); }
console.log(`Package coherence passed: ${files.length} files, including browser and server dependency graphs.`);
