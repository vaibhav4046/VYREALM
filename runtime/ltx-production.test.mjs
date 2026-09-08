import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ltxWorkflow, verifyOwnedLtxReference, produceLocalLtxShot } from './ltx-production.mjs';
import { verifyRecordedModelGraph } from './generation-evidence.mjs';
import { wanWorkflow, WAN_MODELS } from './neural-production.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const prompt = 'The reviewed warrior breathes steadily as his wet hair moves in the wind.';
const settings = { prompt, seed: 730241, profile: 'draft-512', imageName: 'vyrealm-reference.png', prefix: 'vyrealm/fixture/motion' };
const audit = { modelId: 'ltxv-2b-0.9.8-distilled-q8_0.gguf', prompt, seed: 730241, width: 512, height: 288, fps: 24, durationSeconds: 5 };

test('fixed LTX graph feeds the reference into conditioning and saves actual sampled frames', () => {
  const graph = ltxWorkflow(settings);
  assert.equal(graph['7'].class_type, 'LTXVImgToVideo');
  assert.deepEqual(graph['7'].inputs.image, ['11', 0]);
  assert.deepEqual(graph['8'].inputs.latent_image, ['7', 2]);
  assert.deepEqual(graph['8'].inputs.positive, ['13', 0]);
  assert.deepEqual(graph['8'].inputs.sigmas, ['14', 0]);
  assert.equal(graph['8'].inputs.noise_seed, 730241);
  assert.equal(graph['7'].inputs.length, 121);
  assert.equal(graph['13'].inputs.frame_rate, 24);
  assert.equal(graph['14'].inputs.steps, 8);
  assert.equal(graph['15'].inputs.sampler_name, 'euler');
  assert.equal(verifyRecordedModelGraph(graph, audit), true);
  const comparison = ltxWorkflow({ ...settings, profile: 'comparison-1024', tiledDecode: true });
  assert.equal(verifyRecordedModelGraph(comparison, { ...audit, width: 1024, height: 576 }), true);
  assert.deepEqual(comparison['9'], { class_type: 'VAEDecodeTiled', inputs: { samples: ['8', 0], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 } });
});

test('unsupported profiles, traversal, invalid prompt/seed and caller workflow overrides stop before invocation', () => {
  for (const mutation of [{ profile: 'native-4k' }, { imageName: '../outside.png' }, { imageName: 'https://example.com/a.png' }, { prefix: 'vyrealm/../other' }, { prompt: ' ' }, { seed: -1 }, { seed: 1.2 }, { tiledDecode: 'true' }, { frames: 241 }, { width: 3840 }, { workflow: {} }]) {
    assert.throws(() => ltxWorkflow({ ...settings, ...mutation }), /LTX_/);
  }
});

test('LTX evidence rejects substituted model, disconnected pixels, sampler, seed, schedule, inputs and extra nodes', () => {
  const changes = [
    g => { g['1'].inputs.unet_name = 'unknown.gguf'; },
    g => { g['2'].inputs.clip_name = 'other.gguf'; },
    g => { g['3'].inputs.vae_name = 'other.safetensors'; },
    g => { g['8'].class_type = 'KSampler'; },
    g => { g['8'].inputs.noise_seed++; },
    g => { g['8'].inputs.add_noise = false; },
    g => { g['8'].inputs.latent_image = ['7', 0]; },
    g => { g['10'].inputs.images = ['11', 0]; },
    g => { g['9'].inputs.samples = ['11', 0]; },
    g => { g['14'].inputs.steps = 1; },
    g => { g['15'].inputs.sampler_name = 'unknown'; },
    g => { g['7'].inputs.image = ['99', 0]; },
    g => { g['11'].inputs.image = '../external.png'; },
    g => { g['99'] = { class_type: 'ExecuteAnything', inputs: {} }; },
    g => { g['8'].inputs.arbitrary = true; },
  ];
  for (const change of changes) { const graph = ltxWorkflow(settings); change(graph); assert.throws(() => verifyRecordedModelGraph(graph, audit), /MODEL_/); }
  assert.throws(() => verifyRecordedModelGraph(ltxWorkflow(settings), { ...audit, fps: 60 }), /MODEL_/);
  assert.throws(() => verifyRecordedModelGraph(ltxWorkflow(settings), { ...audit, modelId: 'other.gguf' }), /MODEL_/);
});

test('the existing Wan graph remains accepted and wrong model remains rejected', () => {
  const graph = wanWorkflow({ prompt, seed: 730241, prefix: 'vyrealm/fixture/motion' });
  assert.equal(verifyRecordedModelGraph(graph, { ...audit, modelId: WAN_MODELS.diffusion }), true);
  assert.throws(() => verifyRecordedModelGraph(graph, audit), /MODEL_/);
});

async function referenceFixture(t) {
  const jobsDir = await mkdtemp(join(tmpdir(), 'vyrealm-ltx-reference-'));
  t.after(() => rm(jobsDir, { recursive: true, force: true }));
  const sourceJobId = 'source-generated-job', projectId = 'original-project';
  const sourceRoot = join(jobsDir, sourceJobId);
  await mkdir(join(sourceRoot, 'keyframe', 'frames'), { recursive: true });
  // Synthetic evidence fixture only; never submitted to a model or catalogue.
  const png = Buffer.alloc(160, 42); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  const path = join(sourceRoot, 'keyframe', 'frames', '00000.png');
  await writeFile(path, png);
  const delivery = Buffer.from('test fixture video bytes, not real generated media');
  await writeFile(join(sourceRoot, 'delivery-1080p.mp4'), delivery);
  await writeFile(join(sourceRoot, 'request.json'), JSON.stringify({ projectId }));
  const receipt = { validated: true, verification: { ok: true }, outputs: { video: 'delivery-1080p.mp4' },
    provenance: { generationStatus: 'generated', outputHash: sha(delivery), source: { status: 'generated', providerId: 'comfyui-local', modelId: WAN_MODELS.diffusion, evidenceHash: 'a'.repeat(64) }, keyframe: { outputHash: sha(png), promptId: 'keyframe-prompt' } },
    review: { verdict: 'passed', outputHash: sha(delivery) } };
  await writeFile(join(sourceRoot, 'result.json'), JSON.stringify(receipt));
  return { jobsDir, sourceRoot, projectId, receipt, reference: { path, sha256: sha(png), sourceJobId, promptId: 'keyframe-prompt' } };
}

test('only a matching PNG from a reviewed same-project generated job may condition LTX', async t => {
  const f = await referenceFixture(t);
  const verified = await verifyOwnedLtxReference(f);
  assert.equal(verified.sha256, f.reference.sha256);
  await assert.rejects(verifyOwnedLtxReference({ ...f, projectId: 'different-project' }), /LTX_REFERENCE_PROJECT/);
  await assert.rejects(verifyOwnedLtxReference({ ...f, reference: { ...f.reference, sourceJobId: '../outside' } }), /LTX_REFERENCE/);
  await assert.rejects(verifyOwnedLtxReference({ ...f, reference: { ...f.reference, promptId: 'other-prompt' } }), /LTX_REFERENCE/);
  const original = await readFile(f.reference.path);
  await writeFile(f.reference.path, 'changed');
  await assert.rejects(verifyOwnedLtxReference(f), /LTX_REFERENCE_INTEGRITY/);
  await writeFile(f.reference.path, original);
  const other = join(f.jobsDir, 'outside.png'); await writeFile(other, original);
  await assert.rejects(verifyOwnedLtxReference({ ...f, reference: { ...f.reference, path: other } }), /LTX_REFERENCE_OWNERSHIP/);
  f.receipt.review.verdict = 'rejected'; await writeFile(join(f.sourceRoot, 'result.json'), JSON.stringify(f.receipt));
  await assert.rejects(verifyOwnedLtxReference(f), /LTX_REFERENCE_REVIEW/);
});

test('changed reviewed delivery bytes and imported provenance cannot become a generated reference', async t => {
  const f = await referenceFixture(t);
  await writeFile(join(f.sourceRoot, 'delivery-1080p.mp4'), 'changed delivery');
  await assert.rejects(verifyOwnedLtxReference(f), /LTX_REFERENCE_REVIEW/);
  f.receipt.provenance.generationStatus = 'imported'; await writeFile(join(f.sourceRoot, 'result.json'), JSON.stringify(f.receipt));
  await assert.rejects(verifyOwnedLtxReference(f), /LTX_REFERENCE_GENERATION/);
});

test('producer cannot invoke a model with missing reference or an unrelated output directory', async t => {
  const f = await referenceFixture(t);
  const output = join(f.jobsDir, 'new-job');
  await assert.rejects(produceLocalLtxShot({ ...f, output, prompt, reference: undefined }), /LTX_REFERENCE/);
  await assert.rejects(produceLocalLtxShot({ ...f, output: f.sourceRoot, prompt }), /LTX_OUTPUT/);
  await assert.rejects(produceLocalLtxShot({ ...f, output, prompt, profile: 'native-4k' }), /LTX_PROFILE/);
});
