import test from 'node:test';
import assert from 'node:assert/strict';
import { rejectPlaceholder, SHOTS } from './asset-first-trailer.mjs';

test('asset-first trailer manifest contains three five-second shots', () => {
  assert.equal(SHOTS.length, 3);
  assert.ok(SHOTS.every(shot => shot.asset.endsWith('.png') && shot.camera.length > 12));
});

test('visual gate rejects primitive/debug assets and short output', () => {
  assert.throws(() => rejectPlaceholder({ files: ['purple-polygon.png', ...SHOTS.slice(1).map(s => s.asset)], sourceMethod: 'local-generated-keyframes', durationSeconds: 14, requestedDurationSeconds: 15 }), /CINEMATIC_REJECTED/);
  assert.throws(() => rejectPlaceholder({ files: SHOTS.map(s => s.asset), sourceMethod: 'upscaled-placeholder', durationSeconds: 15, requestedDurationSeconds: 15 }), /ASSET_SOURCE_UNQUALIFIED/);
});
