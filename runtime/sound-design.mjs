// Original deterministic sound synthesis. No stock samples or neural audio claim.
export const SOUND_PRESETS = Object.freeze(['rain-tension-v1', 'epic-dawn-v1']);
const EPIC_KINDS = new Set(['wind', 'drum', 'conch', 'cloth', 'motif']);

/** @typedef {{id?:string,kind:'wind'|'drum'|'conch'|'cloth'|'motif',at:number,duration:number,gain?:number,pan?:number,frequencyHz?:number}} SoundCue */
/** @typedef {{start:number,end:number,gain:number}} QuietWindow */

export function synthesizeSoundDesign(options = {}) {
  const preset = options.preset ?? 'rain-tension-v1';
  if (!SOUND_PRESETS.includes(preset)) throw new Error('SOUND_PRESET_INVALID');
  return preset === 'epic-dawn-v1' ? synthesizeEpicDawn(options) : synthesizeRain(options);
}

function synthesizeRain({ durationSeconds, seed = 713, footsteps = [], shelterAt, climaxAt } = {}) {
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

// Cue positions are proportions of the researched 30-second sequence, allowing
// the same restrained arc to fit a shorter preview without cut-off events.
export function epicDawnCues(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 90) throw new Error('SOUND_PROFILE_INVALID');
  const scale = durationSeconds / 30;
  return [
    { id: 'plain-wind', kind: 'wind', at: 0, duration: 30, gain: 0.6, pan: 0 },
    { id: 'distant-call', kind: 'conch', at: 0.7, duration: 3.8, gain: 0.42, pan: -0.28, frequencyHz: 146.832 },
    { id: 'chariot-tack', kind: 'cloth', at: 3.3, duration: 0.9, gain: 0.48, pan: 0.3 },
    { id: 'heartbeat-drum', kind: 'drum', at: 7.7, duration: 1.4, gain: 0.35, pan: -0.1, frequencyHz: 56 },
    { id: 'bow-leather', kind: 'cloth', at: 10.35, duration: 0.9, gain: 0.8, pan: 0.12 },
    { id: 'saffron-cloth', kind: 'cloth', at: 12.35, duration: 0.8, gain: 0.55, pan: -0.16 },
    { id: 'counsel-motif', kind: 'motif', at: 15.2, duration: 9.4, gain: 0.5, pan: 0, frequencyHz: 146.832 },
    { id: 'quiet-rein', kind: 'cloth', at: 17.5, duration: 0.7, gain: 0.3, pan: -0.25 },
    { id: 'resolve-drum', kind: 'drum', at: 21.3, duration: 1.8, gain: 0.48, pan: 0.08, frequencyHz: 56 },
    { id: 'choice-impact', kind: 'drum', at: 25.15, duration: 2.3, gain: 0.72, pan: 0, frequencyHz: 49 },
    { id: 'returning-call', kind: 'conch', at: 25.55, duration: 3.6, gain: 0.46, pan: 0.18, frequencyHz: 146.832 },
    { id: 'final-warmth', kind: 'motif', at: 25.25, duration: 4.75, gain: 0.35, pan: 0, frequencyHz: 146.832 },
  ].map(cue => ({ ...cue, at: cue.at * scale, duration: cue.duration * scale }));
}

/** Validate executable cue data. Descriptions never become commands or paths. */
export function validateEpicSoundProfile({ durationSeconds, seed = 713, cues, quietWindows } = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 90 || !Number.isSafeInteger(seed)) throw new Error('SOUND_PROFILE_INVALID');
  cues ??= epicDawnCues(durationSeconds);
  quietWindows ??= [
    { start: durationSeconds * 10 / 30, end: durationSeconds * 14.8 / 30, gain: 0.28 },
    { start: durationSeconds * 15.4 / 30, end: durationSeconds * 19.5 / 30, gain: 0.65 },
  ];
  if (!Array.isArray(cues) || cues.length > 64 || !Array.isArray(quietWindows) || quietWindows.length > 8) throw new Error('SOUND_CUE_LIMIT');
  const ids = new Set();
  const normalized = cues.map((cue, index) => {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue) || !EPIC_KINDS.has(cue.kind)) throw new Error('SOUND_CUE_INVALID');
    const id = cue.id ?? `${cue.kind}-${index + 1}`, gain = cue.gain ?? 0.5, pan = cue.pan ?? 0;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error('SOUND_CUE_ID_INVALID');
    ids.add(id);
    if (!Number.isFinite(cue.at) || !Number.isFinite(cue.duration) || cue.at < 0 || cue.duration <= 0 || cue.at + cue.duration > durationSeconds + 1e-7 || Math.round(cue.at * 48000) >= Math.round((cue.at + cue.duration) * 48000)) throw new Error('SOUND_EVENTS_OUTSIDE_TIMELINE');
    if (!Number.isFinite(gain) || gain < 0 || gain > 1 || !Number.isFinite(pan) || pan < -1 || pan > 1) throw new Error('SOUND_CUE_GAIN_INVALID');
    const frequencyHz = cue.frequencyHz ?? (cue.kind === 'drum' ? 56 : 146.832);
    if (!Number.isFinite(frequencyHz) || frequencyHz < 40 || frequencyHz > 1200 || (cue.frequencyHz !== undefined && ['wind', 'cloth'].includes(cue.kind))) throw new Error('SOUND_CUE_FREQUENCY_INVALID');
    return { id, kind: cue.kind, at: cue.at, duration: cue.duration, gain, pan, ...(!['wind', 'cloth'].includes(cue.kind) ? { frequencyHz } : {}) };
  }).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const quiet = quietWindows.map(window => {
    if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < 0 || window.end <= window.start || window.end > durationSeconds || !Number.isFinite(window.gain) || window.gain < 0 || window.gain > 1) throw new Error('SOUND_QUIET_WINDOW_INVALID');
    return { start: window.start, end: window.end, gain: window.gain };
  });
  return { durationSeconds, seed, cues: normalized, quietWindows: quiet };
}

function pcmWave(frames, sampleRate) {
  const wave = Buffer.alloc(44 + frames * 4);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(2, 22); wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 4, 28);
  wave.writeUInt16LE(4, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(frames * 4, 40);
  return wave;
}
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const envelope = (age, duration, attack, release) => smooth(age / Math.min(attack, duration * 0.3)) * smooth((duration - age) / Math.min(release, duration * 0.4));

function synthesizeEpicDawn(options) {
  const { durationSeconds, seed, cues, quietWindows } = validateEpicSoundProfile(options);
  const rate = 48000, frames = Math.round(durationSeconds * rate), wave = pcmWave(frames, rate), tau = 2 * Math.PI;
  const prepared = cues.map(cue => ({ ...cue, startFrame: Math.round(cue.at * rate), endFrame: Math.round((cue.at + cue.duration) * rate), left: Math.cos((cue.pan + 1) * Math.PI / 4), right: Math.sin((cue.pan + 1) * Math.PI / 4) }));
  let state = seed >>> 0, windL = 0, windR = 0, subL = 0, subR = 0, clothL = 0, clothR = 0, peak = 0, peakOutput = 0, limited = 0;
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 2147483648 - 1; };
  // Only the final PCM byte buffer is proportional to duration. No full-length
  // float stems, frame arrays or second-pass normalization are allocated.
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / rate, nL = random(), nR = random();
    windL += 0.022 * (nL - windL); windR += 0.022 * (nR - windR);
    subL += 0.0015 * (nL - subL); subR += 0.0015 * (nR - subR);
    clothL += 0.32 * (nL - clothL); clothR += 0.32 * (nR - clothR);
    let dynamics = 1;
    for (const window of quietWindows) {
      if (t < window.start || t >= window.end) continue;
      const dip = envelope(t - window.start, window.end - window.start, 0.4, 0.4);
      dynamics = Math.min(dynamics, 1 - (1 - window.gain) * dip);
    }
    let left = 0, right = 0;
    for (const cue of prepared) {
      if (frame < cue.startFrame || frame >= cue.endFrame) continue;
      const age = (frame - cue.startFrame) / rate, length = (cue.endFrame - cue.startFrame) / rate;
      let signal = 0;
      if (cue.kind === 'wind') {
        const gust = 0.7 + 0.15 * Math.sin(tau * 0.19 * age) + 0.1 * Math.sin(tau * 0.071 * age);
        const level = cue.gain * 0.32 * gust * dynamics * envelope(age, length, 0.6, 1.3);
        left += (windL - subL) * level * cue.left;
        right += (windR - subR) * level * cue.right;
        continue;
      }
      if (cue.kind === 'drum') {
        const phase = tau * cue.frequencyHz * (age + 0.65 * 0.075 * (1 - Math.exp(-age / 0.075)));
        const resonant = Math.sin(phase) + 0.22 * Math.sin(phase * 1.61) + 0.06 * Math.sin(phase * 2.42);
        const head = (nL + nR) * 0.09 * Math.exp(-age * 42);
        signal = 0.34 * (resonant + head) * Math.exp(-age * 4.2) * envelope(age, length, 0.015, 0.5);
      } else if (cue.kind === 'conch') {
        const phase = tau * cue.frequencyHz * (age + 0.007 * (1 - Math.cos(tau * 4.2 * age)) / (tau * 4.2));
        const harmonics = Math.sin(phase) + 0.36 * Math.sin(phase * 2 + 0.12) + 0.15 * Math.sin(phase * 3) + 0.065 * Math.sin(phase * 4 + 0.3);
        const breath = (clothL + clothR) * 0.035;
        signal = 0.115 * (harmonics + breath) * envelope(age, length, 0.65, 1.1) * (0.88 + 0.12 * Math.sin(Math.PI * age / length));
      } else if (cue.kind === 'cloth') {
        const rub = (clothL + clothR - windL - windR) * (0.65 + 0.35 * Math.sin(tau * 9 * age) ** 2);
        const creak = Math.sin(tau * (190 * age + 14 * age * age)) * 0.12;
        signal = 0.12 * (rub + creak) * Math.sin(Math.PI * age / length) ** 2 * envelope(age, length, 0.08, 0.2);
      } else if (cue.kind === 'motif') {
        const root = tau * cue.frequencyHz * age;
        const fifth = Math.sin(root * 1.498307) * 0.25;
        const third = Math.sin(root * 1.189207) * 0.16 * smooth(age / Math.max(0.1, length * 0.4));
        const warmth = Math.sin(root) * 0.58 + Math.sin(root * 1.0015 + 0.4) * 0.2 + fifth + third;
        signal = 0.075 * warmth * envelope(age, length, 1.6, 2.2);
      }
      signal *= cue.gain * (cue.kind === 'cloth' ? 1 : dynamics);
      left += signal * cue.left; right += signal * cue.right;
    }
    const fade = envelope(t, durationSeconds, 0.15, 0.65);
    left *= fade; right *= fade;
    for (let channel = 0; channel < 2; channel++) {
      const sample = channel === 0 ? left : right, absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      // Transparent below the knee, bounded under pathological overlapping cues.
      const output = absolute <= 0.7 ? sample : Math.sign(sample) * (0.7 + 0.15 * Math.tanh((absolute - 0.7) / 0.15));
      if (absolute > 0.7) limited++;
      const pcm = Math.round(output * 32767);
      peakOutput = Math.max(peakOutput, Math.abs(pcm) / 32767);
      wave.writeInt16LE(pcm, 44 + frame * 4 + channel * 2);
    }
  }
  return {
    wave,
    evidence: {
      sourceMethod: 'local-procedural-sound-design', providerId: 'local-dsp', neuralModelInvoked: false,
      preset: 'epic-dawn-v1', seed, durationSeconds: frames / rate, sampleRate: rate, channels: 2, bitsPerSample: 16,
      cues: prepared.map(({ left, right, ...cue }) => ({ ...cue, at: cue.startFrame / rate, duration: (cue.endFrame - cue.startFrame) / rate })),
      quietWindows, synthesis: 'original deterministic harmonic and filtered-noise synthesis; no samples or recorded instruments',
      peakBeforeLimiter: peak, peakAfterLimiter: peakOutput, limiter: { knee: 0.7, ceiling: 0.85, affectedSamples: limited },
      storage: { pcmBytes: wave.length, fullLengthFloatBuffers: 0 },
      reviewStatus: 'listening-required', loudnessNormalized: false,
    },
  };
}
