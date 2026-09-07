import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_DESCRIPTORS, inspectModelRouter } from './model-router.mjs';

test('model router keeps unqualified neural candidates blocked', async () => {
  const reports = await inspectModelRouter({ root: process.cwd(), env: {}, providers: [] });
  assert.ok(MODEL_DESCRIPTORS.some(item => item.id === 'wan2.2'));
  assert.equal(reports.find(item => item.id === 'wan2.2').status, 'blocked');
  assert.equal(reports.find(item => item.id === 'ffmpeg-local').status, 'ready');
});
