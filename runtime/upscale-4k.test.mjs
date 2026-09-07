import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEnhancementPlan, buildFfmpegArgs } from './upscale-4k.mjs';

test('4K enhancement plan is temporal-safe and uses delivery stages', () => {
  const plan = buildEnhancementPlan();
  assert.deepEqual(plan.stages, ['Source', 'Enhance', 'Upscale', 'Grade', 'Encode 4K']);
  assert.equal(plan.temporalSafe, 'video-scale');
  assert.equal(plan.width, 3840); assert.equal(plan.height, 2160);
});

test('4K encoder requests high profile, bitrate, audio, and faststart', () => {
  const args = buildFfmpegArgs('source.mp4', 'out.mp4');
  assert.ok(args.includes('high')); assert.ok(args.includes('60M')); assert.ok(args.includes('+faststart')); assert.ok(args.includes('48000'));
});
