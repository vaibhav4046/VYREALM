import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { synthesizeSoundDesign, epicDawnCues, validateEpicSoundProfile } from './sound-design.mjs';

test('original sound synthesis is reproducible, bounded and event-sensitive',()=>{
 const args={durationSeconds:2,seed:12,footsteps:[0.6,1.2],shelterAt:1.5,climaxAt:1.6};
 const result=synthesizeSoundDesign(args),again=synthesizeSoundDesign(args),bed=synthesizeSoundDesign({...args,footsteps:[]});
 assert.deepEqual(result.wave,again.wave);assert.equal(result.wave.readUInt32LE(24),48000);assert.equal(result.wave.readUInt32LE(40),2*48000*4);assert.equal(result.evidence.neuralModelInvoked,false);
 assert.deepEqual(result.wave.subarray(44,44+24000*4),bed.wave.subarray(44,44+24000*4),'unchanged ambience before first event');
 assert.notDeepEqual(result.wave.subarray(44+30000*4,44+32000*4),bed.wave.subarray(44+30000*4,44+32000*4),'footstep must audibly change its scheduled range');
 assert.throws(()=>synthesizeSoundDesign({...args,footsteps:[3]}),/OUTSIDE/);
});

const pcmRange = (wave, start, end) => wave.subarray(44 + Math.round(start * 48000) * 4, 44 + Math.round(end * 48000) * 4);
function rms(wave, start, end) {
  const bytes = pcmRange(wave, start, end); let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes.readInt16LE(i) / 32767) ** 2;
  return Math.sqrt(sum / (bytes.length / 2));
}

test('epic dawn uses original deterministic cues, dry ambience and bounded PCM storage', () => {
  const args = { preset: 'epic-dawn-v1', durationSeconds: 2, seed: 81 };
  const a = synthesizeSoundDesign(args), b = synthesizeSoundDesign(args);
  assert.deepEqual(a.wave, b.wave);
  assert.equal(a.wave.readUInt32LE(24), 48000);
  assert.equal(a.wave.readUInt16LE(22), 2);
  assert.equal(a.wave.readUInt16LE(34), 16);
  assert.equal(a.wave.length, 44 + 2 * 48000 * 4);
  assert.equal(a.evidence.neuralModelInvoked, false);
  assert.equal(a.evidence.providerId, 'local-dsp');
  assert.equal(a.evidence.reviewStatus, 'listening-required');
  assert.equal(a.evidence.storage.fullLengthFloatBuffers, 0);
  assert.equal(a.evidence.storage.pcmBytes, a.wave.length);
  assert.ok(a.evidence.peakAfterLimiter < 0.85);
  assert.ok(a.evidence.cues.some(cue => cue.kind === 'conch'));
  assert.ok(a.evidence.cues.every(cue => !['rain', 'splash', 'footstep'].includes(cue.kind)));
  assert.notDeepEqual(a.wave, synthesizeSoundDesign({ ...args, seed: 82 }).wave);
});

test('epic cue changes are confined to their scheduled sample range', () => {
  const args = { preset: 'epic-dawn-v1', durationSeconds: 3, seed: 14, quietWindows: [], cues: [{ id: 'wind', kind: 'wind', at: 0, duration: 3, gain: 0.3 }] };
  const bed = synthesizeSoundDesign(args);
  const event = synthesizeSoundDesign({ ...args, cues: [...args.cues, { id: 'single-impact', kind: 'drum', at: 1, duration: 0.8, gain: 0.7, pan: -1 }] });
  assert.deepEqual(pcmRange(event.wave, 0, 1), pcmRange(bed.wave, 0, 1));
  assert.notDeepEqual(pcmRange(event.wave, 1.02, 1.2), pcmRange(bed.wave, 1.02, 1.2));
  assert.deepEqual(pcmRange(event.wave, 1.8, 3), pcmRange(bed.wave, 1.8, 3));
  for (let i = 44 + 48000 * 4 + 2; i < 44 + 86400 * 4; i += 4) assert.equal(event.wave.readInt16LE(i), bed.wave.readInt16LE(i), 'left-panned impact must leave the right channel unchanged');
  const cue = event.evidence.cues.find(cue => cue.id === 'single-impact');
  assert.equal(cue.startFrame, 48000);
  assert.equal(cue.endFrame, 86400);
});

test('quiet windows create a controlled dip while preserving close cloth detail', () => {
  const args = { preset: 'epic-dawn-v1', durationSeconds: 4, cues: [{ id: 'warmth', kind: 'motif', at: 0, duration: 4, gain: 0.8 }], quietWindows: [] };
  const full = synthesizeSoundDesign(args), quiet = synthesizeSoundDesign({ ...args, quietWindows: [{ start: 1, end: 3, gain: 0.2 }] });
  assert.ok(rms(quiet.wave, 1.7, 2.3) < rms(full.wave, 1.7, 2.3) * 0.23);
  assert.deepEqual(pcmRange(quiet.wave, 0, 1), pcmRange(full.wave, 0, 1));
  const clothArgs = { ...args, cues: [{ id: 'close-cloth', kind: 'cloth', at: 1.5, duration: 0.8, gain: 0.8 }] };
  assert.deepEqual(synthesizeSoundDesign(clothArgs).wave, synthesizeSoundDesign({ ...clothArgs, quietWindows: [{ start: 1, end: 3, gain: 0.2 }] }).wave);
});

test('cue bounds and overloaded mixes cannot clip or allocate unbounded events', () => {
  const base = { durationSeconds: 2, cues: [] };
  assert.throws(() => synthesizeSoundDesign({ ...base, preset: 'unknown' }), /PRESET/);
  assert.throws(() => validateEpicSoundProfile({ ...base, durationSeconds: 120 }), /PROFILE/);
  const cue = { id: 'hit', kind: 'drum', at: 0.5, duration: 1, gain: 1 };
  for (const patch of [{ at: -1 }, { duration: 4 }, { gain: 2 }, { pan: 2 }, { frequencyHz: 50000 }, { kind: 'download-url' }]) {
    assert.throws(() => validateEpicSoundProfile({ ...base, cues: [{ ...cue, ...patch }] }), /SOUND_/);
  }
  assert.throws(() => validateEpicSoundProfile({ ...base, cues: [cue, cue] }), /ID_INVALID/);
  assert.throws(() => validateEpicSoundProfile({ ...base, cues: Array.from({ length: 65 }, (_, i) => ({ ...cue, id: `hit-${i}` })) }), /CUE_LIMIT/);
  assert.throws(() => validateEpicSoundProfile({ ...base, quietWindows: [{ start: 0, end: 3, gain: 0.5 }] }), /QUIET_WINDOW/);
  const overloaded = synthesizeSoundDesign({ ...base, preset: 'epic-dawn-v1', quietWindows: [], cues: Array.from({ length: 24 }, (_, i) => ({ ...cue, id: `hit-${i}` })) });
  assert.ok(overloaded.evidence.limiter.affectedSamples > 0);
  assert.ok(overloaded.evidence.peakAfterLimiter <= 0.851);
  for (let i = 44; i < overloaded.wave.length; i += 2) assert.ok(Math.abs(overloaded.wave.readInt16LE(i)) < 32767);
});

test('30-second Mahabharata score has the planned cue times and decodes as a genuine WAV', async () => {
  const cues = epicDawnCues(30);
  assert.equal(cues.find(cue => cue.id === 'bow-leather').at, 10.35);
  assert.equal(cues.find(cue => cue.id === 'choice-impact').at, 25.15);
  assert.equal(cues.find(cue => cue.id === 'counsel-motif').at, 15.2);
  const { wave, evidence } = synthesizeSoundDesign({ preset: 'epic-dawn-v1', durationSeconds: 30, seed: 713 });
  assert.equal(evidence.durationSeconds, 30);
  assert.equal(wave.readUInt32LE(40), 30 * 48000 * 4);
  assert.ok(rms(wave, 10.8, 11.4) < rms(wave, 1.5, 2.5), 'hand insert must be quieter than opening call');
  const folder = await mkdtemp(join(tmpdir(), 'vyrealm-epic-audio-')), path = join(folder, 'epic-dawn.wav');
  await writeFile(path, wave);
  const ffmpeg = process.env.VYRELUM_FFMPEG || fileURLToPath(new URL('../workers/tools/ffmpeg.exe', import.meta.url));
  const decoded = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-f', 's16le', '-acodec', 'pcm_s16le', '-'], { encoding: null, maxBuffer: wave.length + 4096, windowsHide: true });
  assert.equal(decoded.status, 0, decoded.stderr?.toString());
  assert.equal(decoded.stdout.length, 30 * 48000 * 4);
  assert.deepEqual(decoded.stdout, wave.subarray(44), 'decoder must preserve every PCM frame');
});
