import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hashJson, recordGeneratedProvenance } from './generation-gate.mjs';
import { ltxWorkflow, LTX_MODELS } from './ltx-production.mjs';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('the LTX audit binds a playable native clip to exact prompt history and rejects changed ownership/lineage', async t => {
  const jobRoot = await mkdtemp(join(tmpdir(), 'vyrealm-ltx-audit-fixture-'));
  t.after(() => rm(jobRoot, { recursive: true, force: true }));
  const stageRoot = join(jobRoot, 'motion'), framesDir = join(stageRoot, 'frames');
  await mkdir(framesDir, { recursive: true });
  const ffmpeg = resolve('workers/tools/ffmpeg.exe'), ffprobe = resolve('workers/tools/ffprobe.exe');
  const opts = { windowsHide: true, timeout: 60000, maxBuffer: 1_000_000 };
  // Synthetic CPU test frames only. This isolated fixture is never a model run,
  // source asset, user project or catalogue entry.
  await exec(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=512x288:rate=24', '-frames:v', '121', '-threads', '2', '-start_number', '0', join(framesDir, '%05d.png')], opts);
  const outputPath = join(jobRoot, 'source.mp4');
  await exec(ffmpeg, ['-v', 'error', '-framerate', '24', '-i', join(framesDir, '%05d.png'), '-frames:v', '120', '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', outputPath], opts);
  const prompt = 'Synthetic evidence audit fixture, not a generated scene.';
  const workflow = ltxWorkflow({ prompt, seed: 730241, imageName: 'owned.png', prefix: 'vyrealm/ltx-fixture/motion' });
  const promptId = 'synthetic-ltx-provider-fixture', workflowHash = hashJson(workflow);
  const ledger = [];
  for (let i = 0; i < 121; i++) {
    const path = `frames/${String(i).padStart(5, '0')}.png`;
    ledger.push({ index: i, path, sha256: sha(await readFile(join(stageRoot, path))), providerOutput: { filename: `motion_${i}.png`, subfolder: 'vyrealm\\ltx-fixture', type: 'output' } });
  }
  const history = { prompt: [0, promptId, workflow], status: { completed: true, status_str: 'success' }, outputs: { '10': { images: ledger.map(f => f.providerOutput) } } };
  const providerEvidence = { stageRoot, promptId, historyPath: join(stageRoot, 'history.json'), framesPath: join(stageRoot, 'frames.json'), logPath: join(stageRoot, 'provider.jsonl') };
  const log = ['submitted', 'completed'].map(event => JSON.stringify({ event, promptId, workflowHash })).join('\n');
  await writeFile(join(stageRoot, 'workflow.json'), JSON.stringify(workflow));
  await writeFile(providerEvidence.historyPath, JSON.stringify(history));
  await writeFile(providerEvidence.framesPath, JSON.stringify(ledger));
  await writeFile(providerEvidence.logPath, log);
  const options = { jobRoot, outputPath, providerId: 'comfyui-local', modelId: LTX_MODELS.diffusion, workflow, seed: 730241, prompt, durationSeconds: 5, width: 512, height: 288, fps: 24, providerEvidence, ffmpeg, ffprobe };
  const result = await recordGeneratedProvenance(options);
  assert.equal(result.status, 'generated', JSON.stringify(result));
  assert.equal(result.frameCount, 120);
  assert.equal(result.lineage.length, 3);
  assert.deepEqual(result.resolution, { width: 512, height: 288 });
  assert.equal(result.outputHash, sha(await readFile(outputPath)));
  assert.equal((await recordGeneratedProvenance({ ...options, providerId: 'external-provider' })).code, 'PROVIDER_EVIDENCE_MISSING');
  assert.equal((await recordGeneratedProvenance({ ...options, seed: 730242 })).code, 'MODEL_INVOCATION_MISMATCH');
  await writeFile(providerEvidence.logPath, JSON.stringify({ event: 'unrelated' }));
  assert.equal((await recordGeneratedProvenance(options)).code, 'PROVIDER_LOG_MISSING');
  await writeFile(providerEvidence.logPath, log);
  const changed = structuredClone(history); changed.outputs['10'].images[0].subfolder = 'someone-else';
  await writeFile(providerEvidence.historyPath, JSON.stringify(changed));
  assert.equal((await recordGeneratedProvenance(options)).code, 'PROVIDER_OUTPUT_OWNERSHIP');
  await writeFile(providerEvidence.historyPath, JSON.stringify(history));
  await exec(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:size=512x288:rate=24', '-frames:v', '120', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', outputPath], opts);
  assert.equal((await recordGeneratedProvenance(options)).code, 'GENERATED_CLIP_LINEAGE_MISMATCH');
  await writeFile(join(framesDir, '00000.png'), 'tampered');
  assert.equal((await recordGeneratedProvenance(options)).code, 'GENERATED_FRAME_HASH_MISMATCH');
});
