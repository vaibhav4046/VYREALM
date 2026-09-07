/**
 * Batch-render format-library plans into real MP4s.
 *
 *   node scripts/render-format-batch.mjs --limit 10
 *   node scripts/render-format-batch.mjs --out outputs/formats --retimes
 *
 * Renders sequentially on purpose. A parallel fan-out would contend for RAM
 * with a running ComfyUI generation on this hardware, and losing a 25-minute
 * neural job to save a few minutes of FFmpeg is a bad trade.
 *
 * Plans whose shot roles have no real source are SKIPPED and reported, never
 * substituted with stand-in footage.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandVariants, lintPlan } from '../runtime/format-library.mjs';
import { renderPlan } from '../runtime/format-render.mjs';
import { readFile } from 'node:fs/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shotsDir = join(root, 'outputs/desktop');
const HOOKS_PATH = join(root, 'runtime/assets/format-hooks.json');
const MUSIC_BED = join(root, 'runtime/assets/music-bed.m4a');
const NARRATION_DIR = join(root, 'runtime/assets/narration');

/** Hook lines written by the local LLM. Absent file means no captions, not fake ones. */
async function loadHooks() {
  try { return JSON.parse(await readFile(HOOKS_PATH, 'utf8')).hooks ?? {}; }
  catch { return {}; }
}

/**
 * Shot roles mapped onto real footage already produced by this project.
 * `inPoint` selects a distinct moment so one source yields several roles.
 * Roles with no honest source are deliberately absent.
 */
export const SHOT_LIBRARY = {
  hero: { file: 'VYREALM_RAINLINE_TRAILER_1080P.mp4', inPoint: 0, provenance: 'local-neural-source' },
  'broll-a': { file: 'VYREALM_RAINLINE_TRAILER_1080P.mp4', inPoint: 5, provenance: 'local-neural-source' },
  'broll-b': { file: 'VYREALM_RAINLINE_TRAILER_1080P.mp4', inPoint: 10, provenance: 'local-neural-source' },
  establish: { file: 'VYREALM_CINEMATIC_15S_TRAILER_1080P.mp4', inPoint: 0, provenance: 'composited' },
  'broll-c': { file: 'VYREALM_CINEMATIC_15S_TRAILER_1080P.mp4', inPoint: 5, provenance: 'composited' },
  texture: { file: 'VYREALM_CINEMATIC_15S_TRAILER_1080P.mp4', inPoint: 10, provenance: 'composited' },
  product: { file: 'VYREALM_ASSET_FIRST_TRAILER_1080P.mp4', inPoint: 0, provenance: 'composited' },
  process: { file: 'VYREALM_ASSET_FIRST_TRAILER_1080P.mp4', inPoint: 8, provenance: 'composited' },
  after: { file: 'VYREALM_ASSET_FIRST_TRAILER_1080P.mp4', inPoint: 16, provenance: 'composited' },
  before: { file: 'VYREALM_ASSET_FIRST_TRAILER_1080P.mp4', inPoint: 22, provenance: 'composited' },
  pov: { file: 'ODYSSEY_FILM_CINEMATIC_1080P.mp4', inPoint: 0, provenance: 'blender-3d' },
  loop: { file: 'ODYSSEY_FILM_CINEMATIC_1080P.mp4', inPoint: 2, provenance: 'blender-3d' },
  screen: { file: 'VYREALM_UI_PROJECT_OUTPUT_1080P.mp4', inPoint: 0, provenance: 'composited' },
  diagram: { file: 'VYREALM_UI_PROJECT_OUTPUT_1080P.mp4', inPoint: 7, provenance: 'composited' },
  // Locally generated: Wan2.2 TI2V-5B Q4, 1024x576, 121 frames, 1568s on a 3050 6GB.
  'anime-hero': { file: 'VYREALM_ANIME_HERO_5S.mp4', inPoint: 0, provenance: 'local-neural-source' },
  'anime-bg': { file: 'VYREALM_ANIME_HERO_5S.mp4', inPoint: 0, provenance: 'local-neural-source' },
  'anime-action': { file: 'VYREALM_ANIME_HERO_5S.mp4', inPoint: 2, provenance: 'local-neural-source' },
  // Locally generated presenter. Wan2.2, 121 frames. Note: hand detail shows
  // the classic AI artifact in parts of the shot - exactly what the quality
  // detectors are meant to catch and route to trim or re-roll.
  'talking-head': { file: 'VYREALM_TALKING_HEAD_5S.mp4', inPoint: 0, provenance: 'local-neural-source' }
};

function parseArgs(argv) {
  const args = { limit: Infinity, out: 'outputs/formats', retimes: false, extend: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--retimes') args.retimes = true;
    else if (argv[i] === '--extend') args.extend = true;
  }
  return args;
}

export function resolveShots(library = SHOT_LIBRARY, dir = shotsDir) {
  const resolved = {};
  const absent = [];
  for (const [role, entry] of Object.entries(library)) {
    const path = join(dir, entry.file);
    if (!existsSync(path)) { absent.push(`${role} -> ${entry.file}`); continue; }
    resolved[role] = { path, inPoint: entry.inPoint, provenance: entry.provenance };
  }
  return { resolved, absent };
}

/**
 * Supply only what the bed can actually use. A bed wanting narration we do not
 * have renders silent rather than failing the whole video; the audio module is
 * right to refuse a half-built mix, so the decision belongs here.
 */
function buildAudioSources(plan) {
  const sources = {};
  if (existsSync(MUSIC_BED)) sources.musicPath = MUSIC_BED;
  const narration = join(NARRATION_DIR, `${plan.formatId}.wav`);
  if (existsSync(narration)) { sources.narrationPath = narration; sources.ambiencePath = narration; }
  if (plan.audio.narration && !sources.narrationPath) return null;
  if (plan.audio.music && !sources.musicPath) return null;
  return Object.keys(sources).length ? sources : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(root, args.out);
  const workRoot = join(outDir, '.work');
  await mkdir(outDir, { recursive: true });

  const { resolved, absent } = resolveShots();
  if (absent.length) console.warn(`missing source files: ${absent.join(', ')}`);
  console.log(`shot roles available: ${Object.keys(resolved).join(', ')}\n`);

  const hooks = await loadHooks();
  const hasMusic = existsSync(MUSIC_BED);
  console.log(`hooks loaded: ${Object.keys(hooks).length} | music bed: ${hasMusic ? 'yes' : 'no'}`);

  const assetIds = Object.fromEntries(Object.keys(resolved).map(role => [role, { assetId: role }]));
  const variants = expandVariants({
    brief: 'VYREALM format library batch',
    shots: assetIds,
    limit: Number.MAX_SAFE_INTEGER,
    includeEvidenceRetimes: args.retimes
  });

  const renderable = variants.filter(plan => plan.renderable);
  const skipped = variants.filter(plan => !plan.renderable);
  const queue = renderable.slice(0, args.limit);

  console.log(`${variants.length} plans, ${renderable.length} renderable, ${skipped.length} skipped for missing sources`);
  console.log(`rendering ${queue.length}\n`);

  const started = Date.now();
  const receipts = [];
  const failures = [];

  for (const [index, plan] of queue.entries()) {
    const name = `${String(index + 1).padStart(3, '0')}-${plan.formatId}-${plan.platform}-${plan.durationSeconds}s.mp4`;
    const label = `[${index + 1}/${queue.length}] ${plan.formatId} @ ${plan.platform} ${plan.durationSeconds}s`;
    try {
      const receipt = await renderPlan({
        plan,
        shotLibrary: resolved,
        output: join(outDir, name),
        workDir: join(workRoot, String(index)),
        allowExtension: args.extend,
        captionText: hooks[plan.formatId]?.line ?? null,
        // Only supply audio when the bed can actually be satisfied. A bed that
        // wants narration we do not have must render silent, not fail the whole
        // video - the module is right to refuse a half-built mix.
        audioSources: buildAudioSources(plan)
      });
      const drift = Math.abs(receipt.measured.seconds - receipt.requestedSeconds);
      receipt.durationDriftSeconds = Number(drift.toFixed(3));
      receipt.durationExact = drift < 0.1;
      receipt.lint = lintPlan(plan);
      receipt.hookSource = hooks[plan.formatId]?.source ?? 'none';
      receipt.shotProvenance = [...new Set(plan.timeline
        .filter(b => b.shotRole !== 'black')
        .map(b => resolved[b.shotRole]?.provenance)
        .filter(Boolean))];
      receipts.push(receipt);
      console.log(`${label} -> ${receipt.measured.width}x${receipt.measured.height} ${receipt.measured.seconds}s ${receipt.durationExact ? 'exact' : `DRIFT ${drift.toFixed(3)}s`} ${receipt.renderMs}ms`);
    } catch (error) {
      failures.push({ formatId: plan.formatId, platform: plan.platform, error: error.message });
      console.error(`${label} -> FAILED ${error.message}`);
    }
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: 'Composited recuts of existing project footage. No pixels were generated by this batch.',
    totals: {
      plans: variants.length,
      renderable: renderable.length,
      skippedForMissingSources: skipped.length,
      attempted: queue.length,
      rendered: receipts.length,
      failed: failures.length,
      exactDuration: receipts.filter(r => r.durationExact).length,
      wallClockMs: Date.now() - started
    },
    skippedRoles: [...new Set(skipped.flatMap(p => p.missingShotRoles))],
    failures,
    receipts
  };
  const evidencePath = join(outDir, 'BATCH_EVIDENCE.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');

  console.log(`\nrendered ${receipts.length}/${queue.length}, exact duration ${evidence.totals.exactDuration}/${receipts.length}, ${(evidence.totals.wallClockMs / 1000).toFixed(1)}s total`);
  if (evidence.skippedRoles.length) console.log(`skipped roles with no honest source: ${evidence.skippedRoles.join(', ')}`);
  console.log(`evidence: ${evidencePath}`);
  if (failures.length) process.exitCode = 1;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (invokedDirectly) {
  await main();
}
