/**
 * Fold locally generated shots into the render shot library.
 *
 * Mass generation writes outputs/shots/<name>.mp4 plus a manifest. The format
 * library asks for ROLES (hero, broll-a, establish, texture...), so this maps
 * generated clips onto roles by their content, and gives long-form formats
 * genuine variety instead of the same clip repeated for five minutes.
 *
 * Writes runtime/assets/shot-roles.json, which the batch renderer prefers over
 * its small built-in library when present.
 *
 *   node scripts/register-generated-shots.mjs
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOTS_DIR = join(root, 'outputs/shots');
const MANIFEST = join(SHOTS_DIR, 'manifest.json');
const OUT = join(root, 'runtime/assets/shot-roles.json');

/**
 * Which generated clips suit which narrative role. A clip can serve several
 * roles; a role draws from several clips so a long format does not repeat.
 * Keyed by substring of the generated shot name.
 */
const ROLE_AFFINITY = {
  hero: ['anime-rooftop', 'nature-fox', 'mood-dusk', 'story-door', 'candle-dark', 'lighthouse'],
  'broll-a': ['neon-alley', 'rain-window', 'forest-light', 'anime-street', 'snow-pines'],
  'broll-b': ['ocean-cliff', 'mountain-fog', 'autumn-leaves', 'anime-train', 'desert-road'],
  'broll-c': ['city-timelapse', 'steel-forge', 'nature-eagle', 'anime-sky', 'abstract-smoke'],
  establish: ['desert-monolith', 'mountain-fog', 'city-timelapse', 'ocean-cliff', 'anime-sky'],
  texture: ['ink-water', 'abstract-liquid', 'abstract-smoke', 'abstract-glass', 'rain-window'],
  loop: ['vinyl-spin', 'ink-water', 'abstract-liquid', 'abstract-glass'],
  pov: ['mood-corridor', 'forest-light', 'neon-alley', 'desert-road'],
  before: ['story-chair', 'mood-corridor', 'snow-pines'],
  after: ['mood-dusk', 'city-timelapse', 'lighthouse'],
  process: ['steel-forge', 'coffee-macro', 'vinyl-spin'],
  product: ['product-watch', 'product-sneaker', 'product-bottle', 'product-headphones'],
  screen: ['tech-laptop', 'tech-server', 'tech-circuit'],
  diagram: ['tech-circuit', 'abstract-glass', 'tech-server'],
  'anime-hero': ['anime-rooftop', 'anime-cat'],
  'anime-bg': ['anime-sky', 'anime-street', 'anime-festival', 'anime-train'],
  'anime-action': ['anime-festival', 'anime-street', 'anime-rooftop'],
  'talking-head': [],
};

/** Fallback clips already in the project, used when generation has not covered a role. */
const EXISTING = {
  hero: 'VYREALM_RAINLINE_TRAILER_1080P.mp4',
  'talking-head': 'VYREALM_TALKING_HEAD_5S.mp4',
  'anime-hero': 'VYREALM_ANIME_HERO_5S.mp4',
};

async function main() {
  if (!existsSync(MANIFEST)) {
    console.error(`no manifest at ${MANIFEST} - run mass generation first`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const shots = { ...(manifest.shots ?? {}) };

  // Scan the directory too. Clips recovered outside the generator never reach
  // the manifest, and trusting the manifest alone silently drops real footage.
  for (const file of await readdir(SHOTS_DIR)) {
    if (!file.endsWith('.mp4')) continue;
    const name = file.replace(/\.mp4$/, '');
    if (shots[name]) continue;
    shots[name] = {
      file,
      model: manifest.model ?? 'unknown',
      frames: 97,
      fps: 25,
      provenance: 'local-neural-source',
      note: 'discovered on disk; not recorded by the generator run',
    };
  }

  const available = Object.entries(shots)
    .filter(([, s]) => existsSync(join(SHOTS_DIR, s.file)));

  console.log(`${available.length} generated clips available (${Object.keys(manifest.shots ?? {}).length} from manifest, ${available.length - Object.keys(manifest.shots ?? {}).length} discovered on disk)`);

  const roles = {};
  let assigned = 0;
  for (const [role, wanted] of Object.entries(ROLE_AFFINITY)) {
    const matches = available.filter(([name]) => wanted.some(w => name.includes(w)));
    if (matches.length) {
      roles[role] = {
        // Several sources per role: the renderer picks per beat, so a 300s
        // documentary does not cut between the same two clips for five minutes.
        sources: matches.map(([name, s]) => ({
          path: join(SHOTS_DIR, s.file),
          inPoint: 0,
          durationSeconds: s.frames / s.fps,
          provenance: 'local-neural-source',
          model: s.model,
          generationSeconds: s.generationSeconds,
          shot: name,
        })),
      };
      assigned += matches.length;
      continue;
    }
    const fallback = EXISTING[role];
    if (fallback && existsSync(join(root, 'outputs/desktop', fallback))) {
      roles[role] = {
        sources: [{
          path: join(root, 'outputs/desktop', fallback),
          inPoint: 0,
          provenance: 'local-neural-source',
          shot: fallback,
          note: 'fallback: generation has not yet produced a clip for this role',
        }],
      };
    }
  }

  const doc = {
    schemaVersion: 1,
    generatedAt: null,
    generatedClips: available.length,
    rolesCovered: Object.keys(roles).length,
    sourceAssignments: assigned,
    model: manifest.model ?? null,
    roles,
    note: 'Roles map to locally generated clips. Roles with several sources let long formats cut between distinct shots rather than repeating one.',
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(doc, null, 2), 'utf8');

  for (const [role, entry] of Object.entries(roles)) {
    console.log(`  ${role.padEnd(14)} ${entry.sources.length} source(s)  ${entry.sources.map(s => s.shot).join(', ').slice(0, 70)}`);
  }
  console.log(`\n${Object.keys(roles).length} roles -> ${OUT}`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (invokedDirectly) await main();

export { ROLE_AFFINITY, EXISTING };
