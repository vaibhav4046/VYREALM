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

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shotsDir = join(root, 'outputs/desktop');

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
  diagram: { file: 'VYREALM_UI_PROJECT_OUTPUT_1080P.mp4', inPoint: 7, provenance: 'composited' }
  // Deliberately absent, because no honest source exists yet:
  //   talking-head  - needs a real presenter or a qualified local avatar
  //   anime-hero / anime-bg / anime-action - needs the anime generation to land
};

function parseArgs(argv) {
  const args = { limit: Infinity, out: 'outputs/formats', retimes: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--retimes') args.retimes = true;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(root, args.out);
  const workRoot = join(outDir, '.work');
  await mkdir(outDir, { recursive: true });

  const { resolved, absent } = resolveShots();
  if (absent.length) console.warn(`missing source files: ${absent.join(', ')}`);
  console.log(`shot roles available: ${Object.keys(resolved).join(', ')}\n`);

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
        workDir: join(workRoot, String(index))
      });
      const drift = Math.abs(receipt.measured.seconds - receipt.requestedSeconds);
      receipt.durationDriftSeconds = Number(drift.toFixed(3));
      receipt.durationExact = drift < 0.1;
      receipt.lint = lintPlan(plan);
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
