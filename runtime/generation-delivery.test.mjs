import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bindGeneratedDelivery, normalizeLegacyDelivery, generatedSourceProvenance } from './generation-delivery.mjs';
import { enhanceNeuralClip } from './neural-enhancement.mjs';

const ffmpeg = resolve('workers/tools/ffmpeg.exe'), ffprobe = resolve('workers/tools/ffprobe.exe');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = args => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { windowsHide: true, timeout: 60000 });
let fixture;
async function mediaFixture() {
  if (fixture) return fixture;
  const jobRoot = await mkdtemp(join(tmpdir(), 'vyrealm-delivery-fixture-'));
  const sourcePath = join(jobRoot, 'generated-source.mp4'), deliveryPath = join(jobRoot, 'delivery-1080p.mp4');
  // Synthetic audit fixtures only. They are never catalogue films or evidence
  // that a neural model ran. The provider audit itself is tested separately.
  run(['-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=8', '-frames:v', '8', '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', sourcePath]);
  run(['-i', sourcePath, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', deliveryPath]);
  const provenance = {
    status: 'generated', generationStatus: 'generated', providerId: 'comfyui-local', modelId: 'fixture-model',
    providerPromptId: 'fixture-owned-prompt', evidenceHash: 'e'.repeat(64), workflowHash: 'f'.repeat(64),
    outputHash: sha(await readFile(sourcePath)), outputPath: 'generated-source.mp4',
    resolution: { width: 128, height: 72 }, fps: 8, frameCount: 8, durationSeconds: 1,
    seed: 89, prompt: 'test fixture', lineage: [{ index: 0, rgbRmse: 1, threshold: 16 }],
    deliveryMethod: '1080p-lanczos-from-128x72', deliveryResolution: { width: 1920, height: 1080 },
  };
  fixture = { jobRoot, sourcePath, deliveryPath, provenance, deliveryMethod: provenance.deliveryMethod, ffmpeg, ffprobe };
  return fixture;
}

test('source provider evidence stays separate from the exact playable delivery hash', async () => {
  const args = await mediaFixture(), output = await bindGeneratedDelivery(args);
  assert.equal(output.sourceHash, args.provenance.outputHash);
  assert.equal(output.source.outputHash, args.provenance.outputHash);
  assert.equal(output.source.outputPath, 'generated-source.mp4');
  assert.equal(output.source.evidenceHash, args.provenance.evidenceHash);
  assert.deepEqual(output.source.lineage, args.provenance.lineage);
  assert.equal(output.outputHash, sha(await readFile(args.deliveryPath)));
  assert.notEqual(output.outputHash, output.sourceHash);
  assert.equal(output.outputPath, 'delivery-1080p.mp4');
  assert.deepEqual(output.resolution, { width: 128, height: 72 });
  assert.deepEqual(output.deliveryResolution, { width: 1920, height: 1080 });
  assert.equal(output.deliveryMethod, '1080p-lanczos-from-128x72');
  assert.equal(output.generationStatus, 'generated');
  assert.equal(output.sourceGenerationStatus, 'generated');
  assert.equal(output.evidenceScope, 'source');
  assert.equal(output.deliveryVerification.fullyDecoded, true);
  assert.equal(output.deliveryVerification.lineage.length, 3);
  assert.match(output.deliveryEvidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(generatedSourceProvenance(output).outputHash, args.provenance.outputHash);
});

test('legacy normalization is a pure migration and refuses tampered already-bound deliveries', async () => {
  const args = await mediaFixture();
  const receipt = { schemaVersion: 2, status: 'review_required', provenance: args.provenance, outputs: { video: 'delivery-1080p.mp4', sourceVideo: 'generated-source.mp4' } };
  const before = JSON.stringify(receipt), normalized = await normalizeLegacyDelivery({ jobRoot: args.jobRoot, receipt, ffmpeg, ffprobe });
  assert.equal(JSON.stringify(receipt), before);
  assert.notEqual(normalized.provenance.outputHash, receipt.provenance.outputHash);
  const again = await normalizeLegacyDelivery({ jobRoot: args.jobRoot, receipt: normalized, ffmpeg, ffprobe });
  assert.equal(again.provenance.outputHash, normalized.provenance.outputHash);
  assert.equal(again.provenance.deliveryEvidenceHash, normalized.provenance.deliveryEvidenceHash);
  const tampered = structuredClone(normalized); tampered.provenance.outputHash = 'a'.repeat(64);
  await assert.rejects(normalizeLegacyDelivery({ jobRoot: args.jobRoot, receipt: tampered, ffmpeg, ffprobe }), error => error.code === 'DELIVERY_PROVENANCE_HASH_MISMATCH');
  const retained = await readFile(args.deliveryPath);
  try {
    await writeFile(args.deliveryPath, Buffer.concat([retained, Buffer.from('changed bytes after review')]));
    await assert.rejects(normalizeLegacyDelivery({ jobRoot: args.jobRoot, receipt: normalized, ffmpeg, ffprobe }), error => error.code === 'DELIVERY_PROVENANCE_HASH_MISMATCH');
  } finally { await writeFile(args.deliveryPath, retained); }
});

test('wrong source hash, copied source path and external outputs fail the ownership boundary', async () => {
  const args = await mediaFixture();
  await assert.rejects(bindGeneratedDelivery({ ...args, provenance: { ...args.provenance, outputHash: '0'.repeat(64) } }), error => error.code === 'SOURCE_PROVENANCE_HASH_MISMATCH');
  const copy = join(args.jobRoot, 'copied-source.mp4'); await copyFile(args.sourcePath, copy);
  await assert.rejects(bindGeneratedDelivery({ ...args, sourcePath: copy }), error => error.code === 'SOURCE_PROVENANCE_PATH_MISMATCH');
  await writeFile(copy, 'changed provider-source bytes');
  await assert.rejects(bindGeneratedDelivery({ ...args, sourcePath: copy, provenance: { ...args.provenance, outputPath: 'copied-source.mp4' } }), error => error.code === 'SOURCE_PROVENANCE_HASH_MISMATCH');
  const outside = await mkdtemp(join(tmpdir(), 'vyrealm-outside-delivery-')), external = join(outside, 'external.mp4'); await copyFile(args.deliveryPath, external);
  await assert.rejects(bindGeneratedDelivery({ ...args, deliveryPath: external }), error => error.code === 'DELIVERY_OUTPUT_OUTSIDE_JOB');
  await assert.rejects(bindGeneratedDelivery({ ...args, deliveryPath: args.sourcePath }), error => error.code === 'DELIVERY_MUST_BE_SEPARATE_FROM_SOURCE');
  assert.throws(() => generatedSourceProvenance({ ...args.provenance, generationStatus: 'imported' }), /VERIFIED_NEURAL_SOURCE_REQUIRED/);
  assert.throws(() => generatedSourceProvenance({ ...args.provenance, source: args.provenance, sourceHash: '0'.repeat(64) }), /SOURCE_PROVENANCE_HASH_MISMATCH/);
});

test('an unrelated playable 1080p file cannot become a verified source delivery', async () => {
  const args = await mediaFixture(), unrelated = join(args.jobRoot, 'unrelated.mp4');
  run(['-f', 'lavfi', '-i', 'color=red:size=1920x1080:rate=8', '-frames:v', '8', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', unrelated]);
  await assert.rejects(bindGeneratedDelivery({ ...args, deliveryPath: unrelated }), error => error.code === 'DELIVERY_LINEAGE_MISMATCH');
  const wrongSize = join(args.jobRoot, 'wrong-size.mp4'); await copyFile(args.sourcePath, wrongSize);
  await assert.rejects(bindGeneratedDelivery({ ...args, deliveryPath: wrongSize }), error => error.code === 'DELIVERY_MEDIA_MISMATCH');
  const corrupt = join(args.jobRoot, 'corrupt.mp4'); await writeFile(corrupt, 'not a video');
  await assert.rejects(bindGeneratedDelivery({ ...args, deliveryPath: corrupt }));
});

test('enhancement consumes the native hash and rejects the 1080p delivery as source', async () => {
  const args = await mediaFixture(), provenance = await bindGeneratedDelivery(args), receiptPath = join(args.jobRoot, 'receipt.json');
  await writeFile(receiptPath, JSON.stringify({ durationSeconds: 1, provenance }));
  const runtimeDir = join(args.jobRoot, 'no-enhancement-runtime');
  await assert.rejects(enhanceNeuralClip({ input: args.deliveryPath, receiptPath, output: join(args.jobRoot, 'enhanced'), runtimeDir }), /SOURCE_PROVENANCE_HASH_MISMATCH/);
  // Reaching the missing runtime file means the original source hash passed;
  // no upscaler, GPU inference or generation success is simulated here.
  await assert.rejects(enhanceNeuralClip({ input: args.sourcePath, receiptPath, output: join(args.jobRoot, 'enhanced'), runtimeDir }), error => error.code === 'ENOENT' && error.path.endsWith('enhancement.json'));
});
