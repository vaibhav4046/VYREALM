/**
 * Curate the showcase.
 *
 * The full render is 151 variants cut from ~91 seconds of source, so shipping all
 * of it advertises the repetition rather than the engine. This selects one file per
 * distinct picture: deduped by content hash, and excluding the mechanical evidence
 * retimes (the 53s/150s/300s stretches, which are the same cut slowed or ping-ponged).
 *
 *   node scripts/curate-showcase.mjs           # report only
 *   node scripts/curate-showcase.mjs --write   # copy the keepers to outputs/showcase
 */
import { readdirSync, mkdirSync, copyFileSync, createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const write = process.argv.includes('--write');
const sources = ['outputs/formats', 'outputs/catalogue'];
const outDir = join(root, 'outputs/showcase');

// Durations produced by includeEvidenceRetimes rather than by the format's own spec.
const RETIME_SECONDS = new Set([53, 150, 300]);

// Visual review, one frame per file at t=3s. These are the formats whose only source is
// the flat-vector "asset-first" family (a blob mascot on gradient backgrounds) or a plain
// gradient title card. They render correctly; they are just not worth showing.
const REJECTED_ON_LOOK = new Map([
  ['transformation-reveal', 'flat-vector mascot, no motion design'],
  ['before-after-split', 'flat-vector mascot, no motion design'],
  ['satisfying-loop', 'plain gradient title card'],
  ['pov-immersion', 'plain gradient title card'],
  ['product-hero-orbit', 'flat-vector cityscape, no subject'],
  ['tutorial-15s', 'flat-vector mascot, no motion design'],
  ['tutorial-longform', 'flat-vector fill, no subject'],
  ['mistake-warning', 'flat-vector mascot, no motion design'],
  ['behind-the-scenes', 'flat-vector mascot, no motion design'],
]);

const hash = path => new Promise((ok, bad) => {
  const h = createHash('sha256'), s = createReadStream(path);
  s.on('data', b => h.update(b)); s.on('error', bad); s.on('end', () => ok(h.digest('hex')));
});

const files = [];
for (const dir of sources) {
  const abs = join(root, dir);
  let names = [];
  try { names = readdirSync(abs).filter(n => n.endsWith('.mp4')); } catch { continue }
  for (const name of names) files.push({ name, dir, path: join(abs, name) });
}

const parsed = files.map(f => {
  const m = /^(\d{3})-(.+)-(\d+)s\.mp4$/.exec(f.name);
  return m ? { ...f, id: m[1], slug: m[2], seconds: Number(m[3]) } : null;
}).filter(Boolean);

const seenHash = new Map();
const kept = [], dropped = [];

for (const f of parsed.sort((a, b) => a.name.localeCompare(b.name))) {
  if (RETIME_SECONDS.has(f.seconds)) { dropped.push({ ...f, why: `evidence retime (${f.seconds}s)` }); continue }
  const family = f.slug.replace(/-(instagram-reels|tiktok|youtube-shorts|youtube-long|square-feed)$/, '');
  if (REJECTED_ON_LOOK.has(family)) { dropped.push({ ...f, why: `visual review: ${REJECTED_ON_LOOK.get(family)}` }); continue }
  const h = await hash(f.path);
  const twin = seenHash.get(h);
  if (twin) { dropped.push({ ...f, why: `byte-identical to ${twin}` }); continue }
  seenHash.set(h, f.name);
  kept.push({ ...f, sha256: h, bytes: statSync(f.path).size });
}

// One per format+duration: platform siblings differ only by caption placement.
const byPicture = new Map();
const final = [];
for (const f of kept) {
  const key = `${f.slug.replace(/-(instagram-reels|tiktok|youtube-shorts|youtube-long|square-feed)$/, '')}-${f.seconds}`;
  if (byPicture.has(key)) { dropped.push({ ...f, why: `same picture as ${byPicture.get(key)}` }); continue }
  byPicture.set(key, f.name);
  final.push(f);
}

console.log(`scanned ${parsed.length} rendered variants`);
console.log(`showcase keeps ${final.length}; drops ${dropped.length}`);
const reasons = dropped.reduce((a, d) => (a[d.why.replace(/ to .*| as .*/, '')] = (a[d.why.replace(/ to .*| as .*/, '')] || 0) + 1, a), {});
for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${why}`);
console.log('\nkeeping:');
for (const f of final) console.log(`  ${f.name}  ${(f.bytes / 1048576).toFixed(1)} MB`);

if (write) {
  mkdirSync(outDir, { recursive: true });
  for (const f of final) copyFileSync(f.path, join(outDir, basename(f.name)));
  console.log(`\nwrote ${final.length} files to outputs/showcase`);
}
