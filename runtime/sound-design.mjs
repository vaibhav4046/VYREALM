// Original deterministic sound synthesis. No stock samples or neural audio claim.
export function synthesizeSoundDesign({ durationSeconds, seed = 713, footsteps = [], shelterAt, climaxAt } = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 90 || !Number.isSafeInteger(seed)) throw new Error('SOUND_PROFILE_INVALID');
  if (!Array.isArray(footsteps) || footsteps.length > 120 || footsteps.some(t => !Number.isFinite(t) || t < 0 || t >= durationSeconds)) throw new Error('SOUND_EVENTS_OUTSIDE_TIMELINE');
  for (const time of [shelterAt, climaxAt]) if (time != null && (!Number.isFinite(time) || time < 0 || time >= durationSeconds)) throw new Error('SOUND_EVENTS_OUTSIDE_TIMELINE');
  const rate = 48000, frames = Math.round(durationSeconds * rate), samples = new Float32Array(frames * 2);
  let state = seed >>> 0, lowL = 0, lowR = 0, peak = 0;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2147483648 - 1; };
  for (let i = 0; i < frames; i++) {
    const t = i / rate, fade = Math.min(1, t / 0.3, (durationSeconds - t) / 0.5);
    const shelter = shelterAt == null ? 1 : 1 - 0.65 * Math.max(0, Math.min(1, (t - shelterAt) / 0.6));
    const nL = random(), nR = random();lowL += 0.14 * (nL - lowL);lowR += 0.14 * (nR - lowR);
    let left = (0.035 * nL + 0.12 * lowL) * shelter, right = (0.035 * nR + 0.12 * lowR) * shelter;
    for (let k = 0; k < footsteps.length; k++) {
      const age = t - footsteps[k];if (age < 0 || age > 0.32) continue;
      const thud = 0.3 * Math.sin(2 * Math.PI * (85 * age - 30 * age * age)) * Math.exp(-age * 30);
      const splash = 0.17 * (nL + nR) * Math.exp(-age * 18) * Math.min(1, age * 250);
      const pan = k % 2 ? 0.75 : 0.25;left += (thud + splash) * (1 - pan);right += (thud + splash) * pan;
    }
    if (climaxAt != null) {
      const age = t - climaxAt;
      if (age >= 0 && age < 2) { const hit = 0.26 * Math.sin(2 * Math.PI * (52 * age - 5 * age * age)) * Math.exp(-age * 3);left += hit;right += hit; }
      const rise = Math.max(0, Math.min(1, (t - (climaxAt - 3)) / 3)) * (t < climaxAt ? 1 : 0);
      left += lowL * rise * 0.12;right += lowR * rise * 0.12;
    }
    left *= fade;right *= fade;samples[i * 2] = left;samples[i * 2 + 1] = right;peak = Math.max(peak, Math.abs(left), Math.abs(right));
  }
  const wave = Buffer.alloc(44 + frames * 4);wave.write('RIFF', 0);wave.writeUInt32LE(wave.length - 8, 4);wave.write('WAVEfmt ', 8);wave.writeUInt32LE(16, 16);wave.writeUInt16LE(1, 20);wave.writeUInt16LE(2, 22);wave.writeUInt32LE(rate, 24);wave.writeUInt32LE(rate * 4, 28);wave.writeUInt16LE(4, 32);wave.writeUInt16LE(16, 34);wave.write('data', 36);wave.writeUInt32LE(frames * 4, 40);
  const scale = peak > 0.85 ? 0.85 / peak : 1;
  for (let i = 0; i < samples.length; i++) wave.writeInt16LE(Math.round(samples[i] * scale * 32767), 44 + i * 2);
  return { wave, evidence: { sourceMethod: 'local-procedural-sound-design', neuralModelInvoked: false, preset: 'rain-tension-v1', seed, durationSeconds: frames / rate, sampleRate: rate, channels: 2, footsteps, shelterAt: shelterAt ?? null, climaxAt: climaxAt ?? null, peakBeforeLimiter: peak, limiterGain: scale } };
}
