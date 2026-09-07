import assert from 'node:assert/strict';
import { classifyHardware, hardwareDiagnostics } from './hardware-profile.mjs';

assert.equal(classifyHardware({vramGb: 4, ramGb: 16, gpu: 'Test GPU'}).id, 'LOW_VRAM_LOCAL');
assert.equal(classifyHardware({vramGb: 6, ramGb: 16, gpu: 'Test GPU'}).id, 'STANDARD_LOCAL');
assert.equal(classifyHardware({vramGb: 12, ramGb: 32, gpu: 'Test GPU'}).id, 'CREATOR_LOCAL');
assert.equal(classifyHardware({vramGb: 0, ramGb: 64, gpu: null}).id, 'RENDER_ONLY');
assert.equal(hardwareDiagnostics(classifyHardware({vramGb: 6, ramGb: 16, gpu: 'Test GPU'}), 'neural-video').reason, 'INSUFFICIENT_HARDWARE_PROFILE');
assert.equal(hardwareDiagnostics(classifyHardware({vramGb: 12, ramGb: 32, gpu: 'Test GPU'}), 'neural-video').status, 'allowed');
console.log('hardware profile classification tests passed');
