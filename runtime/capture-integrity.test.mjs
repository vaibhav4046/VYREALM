import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptureSegment } from './capture-integrity.mjs';

test('accepts the two observed intact recording segments', () => {
  for (const [wallSeconds, capturedSeconds] of [[303.104,303.4], [301.939,301.68]]) {
    assert.equal(validateCaptureSegment({ wallSeconds, capturedSeconds }).state, 'complete');
  }
});
test('rejects the interrupted real segment without inventing missing time', () => {
  const result = validateCaptureSegment({ wallSeconds:300.48, capturedSeconds:109.8 });
  assert.equal(result.state,'incomplete');
  assert.ok(result.reasons.includes('VIDEO_WALL_CLOCK_MISMATCH'));
  assert.ok(Math.abs(result.missingSeconds - 190.68) < 0.001);
});
test('an interrupted observation is incomplete even with a matching video duration', () => {
  assert.equal(validateCaptureSegment({ wallSeconds:300, capturedSeconds:300, interrupted:true }).state,'incomplete');
});
test('unknown, empty, padded, or implausibly long recordings cannot pass', () => {
  for (const args of [{wallSeconds:300, capturedSeconds:null}, {wallSeconds:300,capturedSeconds:0}, {wallSeconds:300,capturedSeconds:310}, {wallSeconds:300,capturedSeconds:300,probeAvailable:false}]) {
    assert.equal(validateCaptureSegment(args).state,'incomplete');
  }
});
