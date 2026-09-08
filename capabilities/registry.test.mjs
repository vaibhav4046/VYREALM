import assert from 'node:assert/strict';
import { getCapabilityManifest, inspectCapabilities, executeCapability, CapabilityError } from './registry.mjs';

const manifest = await getCapabilityManifest();
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.capabilities.length, 9);
assert.ok(manifest.capabilities.every(capability => capability.instructions && capability.adapter && capability.adapterPath && capability.inputs && capability.outputs && capability.acceptance?.length));

const state = await inspectCapabilities({ env: { ...process.env, VYRELUM_OLLAMA_URL: 'http://127.0.0.1:9' } });
assert.equal(state.capabilities.length, manifest.capabilities.length);
assert.ok(state.capabilities.find(capability => capability.id === 'music-to-video').status === 'blocked');
assert.ok(state.capabilities.find(capability => capability.id === 'captions').available);

const captions = await executeCapability('captions', { segments: [{ start: 0, end: 1.5, text: '  A local caption  ' }] });
assert.deepEqual(captions.captions[0], { id: 'caption-1', start: 0, end: 1.5, text: 'A local caption' });

const cuts = await executeCapability('talking-head-editing', { takes: [{ id: 'take-a', path: 'camera-a.mov', in: 2, out: 5 }] });
assert.equal(cuts.timeline[0].duration, 3);

await assert.rejects(() => executeCapability('music-to-video', { audioPath: 'track.wav', shots: [{ id: 'shot-1' }] }), error => error instanceof CapabilityError && error.code === 'CAPABILITY_UNAVAILABLE');
await assert.rejects(() => executeCapability('captions', { segments: [{ start: 3, end: 2, text: 'bad' }] }), error => error instanceof CapabilityError && error.code === 'INVALID_INPUT');

console.log('capability registry acceptance tests passed');
