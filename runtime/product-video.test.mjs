import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { PRODUCT_TEMPLATES, CAMERA_PRESETS, buildProductPlan, buildProductFfmpegArgs, renderProductVideo } from './product-video.mjs';

const ffmpeg = fileURLToPath(new URL('../workers/tools/ffmpeg.exe', import.meta.url));
const ffprobe = fileURLToPath(new URL('../workers/tools/ffprobe.exe', import.meta.url));
const run = args => new Promise((ok, bad) => {
  const child = spawn(ffmpeg, args, { windowsHide: true });
  const chunks = []; let errors = '';
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stderr.on('data', chunk => { errors += chunk; });
  child.on('error', bad);
  child.on('close', code => code ? bad(new Error(errors)) : ok(Buffer.concat(chunks)));
});

test('uploaded footage keeps source frame progression and source audio', { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vyrealm-product-motion-'));
  try {
    const source = join(directory, 'moving-product.mp4');
    await run(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=997:sample_rate=48000:duration=4', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', source]);
    const receipt = await renderProductVideo({ input: source, output: join(directory, 'render'), ffmpeg, ffprobe, camera: 'static', width: 320, height: 180, durationSeconds: 3 });
    const output = join(directory, 'render', receipt.outputs.video);
    for (const time of ['1', '2']) {
      const decode = file => run(['-v', 'error', '-ss', time, '-i', file, '-frames:v', '1', '-vf', 'scale=80:46', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']);
      const a = await decode(source), b = await decode(output);
      assert.equal(a.length, b.length);
      const difference = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
      assert.ok(difference < 3, `Source frame at ${time}s was altered/frozen (mean pixel error ${difference})`);
    }
    const pcm = await run(['-v', 'error', '-ss', '0.5', '-i', output, '-t', '1', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1']);
    let crossings = 0;
    for (let offset = 2; offset < pcm.length; offset += 2) if (pcm.readInt16LE(offset - 2) <= 0 && pcm.readInt16LE(offset) > 0) crossings++;
    assert.ok(Math.abs(crossings - 997) < 3, `Expected original 997 Hz audio, heard ${crossings} Hz`);
    assert.equal(receipt.sourceMethod, 'uploaded-video-edit');
    assert.equal(receipt.audioMethod, 'source-audio');
    assert.equal(receipt.verification.ok, true);
    await assert.rejects(renderProductVideo({ input: source, output: join(directory, 'too-long'), ffmpeg, ffprobe, width: 320, height: 180, durationSeconds: 5 }), /PRODUCT_SOURCE_TOO_SHORT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('product catalogue exposes local equivalents for template-first ad routes', () => {
  for (const key of ['studio', 'lifestyle', 'with-model', 'ugc-faceless', 'ugc-talking-head', 'motion-2d', 'motion-mixed-media', '360-orbit', 'unboxing', 'demo']) assert.ok(PRODUCT_TEMPLATES[key]);
  for (const key of ['static', 'pan-right', 'dolly-in', 'hero-orbit', 'crane-up', 'handheld']) assert.ok(CAMERA_PRESETS[key]);
});

test('product plan is explicit when no local asset is attached', () => {
  const plan = buildProductPlan({ template: 'lifestyle', camera: 'hero-orbit' });
  assert.equal(plan.route, 'local-asset-motion');
  assert.equal(plan.diagnostics[0].code, 'PRODUCT_ASSET_REQUIRED');
});

test('product FFmpeg graph uses local inputs, requested canvas, and motion', () => {
  const args = buildProductFfmpegArgs('product.png', 'out.mp4', { width: 1080, height: 1920, fps: 24, durationSeconds: 15, camera: 'hero-orbit' });
  assert.ok(args.some(value => String(value).endsWith('product.png')));
  assert.ok(args.includes('-filter_complex'));
  assert.ok(args.some(v => String(v).includes('zoompan')));
  assert.ok(args.some(v => String(v).includes('1080x1920')));
  assert.ok(args.some(value => String(value).endsWith('out.mp4')));
});
