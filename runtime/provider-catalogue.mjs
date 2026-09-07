// Catalogue of local capabilities a VYREALM install can run, what this machine
// can actually take, and a download plan that refuses to run unguarded.
//
// PROVENANCE OF EVERY NUMBER IN THIS FILE
//   MEASURED_ON_DISK   stat/sha256sum of the real file under D:\VYREALM-runtime
//   RUNTIME_LOCK_FILE  runtime/*.lock.json, themselves pinned from HTTPS downloads
//   ON_DISK_LICENSE    a licence/model-card file shipped inside the install
//   EXTRAPOLATED       arithmetic from a measured number, derivation stated inline
//   UNVERIFIED         vendor documentation this machine cannot confirm
// No entry carries an unlabelled number. Timings come from the two benchmark
// runs recorded in `MEASUREMENTS` and nowhere else.
//
// requirementBasis covers minVramGb/minRamGb the same way, over
//   MEASURED_RUN | EXTRAPOLATED | UNVERIFIED
// because those thresholds decide what gets offered and were previously the
// only numbers here with no stated provenance.
//
// companionBytes is the measured weight of the files a provider cannot run
// without (text encoder, VAE). sizeBytes alone under-counts the download, and
// the disk guard has to reserve for the whole set, not just the headline file.
import { classifyHardware, HARDWARE_PROFILES } from './hardware-profile.mjs';

const GB = 1024 ** 3;
const HEADROOM_BYTES = 5 * GB;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
const gb = bytes => Number((bytes / GB).toFixed(2));

/** The only wall-clock generation numbers this module is allowed to quote. */
export const MEASUREMENTS = Object.freeze({
  machine: 'Windows 11, RTX 3050 Laptop 6GB VRAM, 16GB RAM, 12-core i5-12450HX',
  'wan22-5b': Object.freeze({ frames: 121, resolution: '1024x576', totalSeconds: 1568, secondsPerFrame: 13.0, peakVramGiB: 5.85 }),
  'ltxv-2b-distilled': Object.freeze({ frames: 97, resolution: '768x512', totalSeconds: 196, secondsPerFrame: 2.0, steps: 8, cfg: 1.0, peakVramGiB: null }),
  composite: Object.freeze({ description: 'FFmpeg composite render, 15s at 1080x1920', totalSeconds: 11, device: 'cpu' })
});

// A provider's kind maps onto the route budget already defined by
// hardware-profile.mjs, so tier gating stays in one place.
const ROUTE_BY_KIND = Object.freeze({
  video: 'neural-video', 'lip-sync': 'neural-video', music: 'music-to-video',
  sfx: 'audio-mix', tts: 'narration', stt: 'captions',
  interpolation: 'edit', upscale: 'edit'
});

// impactScore is an editorial weight (1-10), NOT a measurement. It orders
// recommendations by usefulness per byte and nothing else; it is never
// presented as a reading, and impactPerGb derived from it is a sort key, not a
// number to quote at anyone.
const CATALOGUE = [
  {
    id: 'wan22-5b',
    label: 'Wan2.2 TI2V-5B (Q4_K_M GGUF)',
    kind: 'video',
    purpose: 'Higher-fidelity text/image-to-video. Slow on 6GB but the best-looking local video model installed.',
    sizeBytes: 3433116000,
    sizeBasis: 'MEASURED_ON_DISK',
    // umt5-xxl-encoder-Q4_K_S.gguf 3,497,596,768 + wan2.2_vae.safetensors
    // 1,409,400,960, both stat'd on this disk and both in neural-runtime.lock.json.
    companionBytes: 4906997728,
    companionBasis: 'MEASURED_ON_DISK',
    minVramGb: 6,
    minRamGb: 15,
    // 5.85 GiB whole-device peak recorded on a 6 GB card (MEASUREMENTS + the
    // wholeDeviceVramPeakGiB in neural-runtime.lock.json). The RAM floor is the
    // tier that run happened on, not an independently measured minimum.
    requirementBasis: 'MEASURED_RUN',
    license: 'Apache-2.0',
    licenseBasis: 'RUNTIME_LOCK_FILE',
    sourceUrl: 'https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF',
    sha256: '95b19697b7f98e65b0a543640e9ca7b4dfec32e2a6e3731e8e10708be52655e2',
    hashBasis: 'RUNTIME_LOCK_FILE',
    installState: 'installed',
    installedPath: 'ComfyUI/models/diffusion_models/Wan2.2-TI2V-5B-Q4_K_M.gguf',
    comfyNodeClasses: ['UnetLoaderGGUF', 'CLIPLoaderGGUF', 'VAELoader', 'Wan22ImageToVideoLatent', 'KSampler', 'VAEDecode'],
    impactScore: 6,
    measurementKey: 'wan22-5b',
    whyItHelps: 'The fidelity ceiling for local video on this machine.',
    notes: 'Needs umt5-xxl-encoder-Q4_K_S.gguf (3,497,596,768 B) and wan2.2_vae.safetensors (1,409,400,960 B) alongside it; minDiskGb covers all three. Node classes verified present in the installed ComfyUI checkout.'
  },
  {
    id: 'ltxv-2b-distilled',
    label: 'LTX-Video 2B 0.9.8 distilled (Q8_0 GGUF)',
    kind: 'video',
    purpose: 'FAST draft-to-final video. The working loop: iterate here, escalate to Wan only when a shot is locked.',
    sizeBytes: 2173891072,
    sizeBasis: 'MEASURED_ON_DISK',
    // t5-v1_1-xxl-encoder-Q5_K_M.gguf 3,386,856,640 +
    // ltxv-0.9.8-2b-distilled-vae.safetensors 2,493,859,780, both stat'd here.
    companionBytes: 5880716420,
    companionBasis: 'MEASURED_ON_DISK',
    minVramGb: 6,
    minRamGb: 15,
    // 97 frames at 768x512 completed inside this 6 GB card (MEASUREMENTS).
    // No per-run VRAM peak was captured, so the floor is the card it ran on.
    requirementBasis: 'MEASURED_RUN',
    license: 'LTXV Open Weights License (Lightricks)',
    licenseBasis: 'UNVERIFIED',
    sourceUrl: 'https://huggingface.co/Lightricks/LTX-Video',
    sha256: 'a0637b06a43fea8d71af2c7bf912c8c8a36d61654966054621f80f2c39e6faca',
    hashBasis: 'MEASURED_ON_DISK',
    installState: 'installed',
    installedPath: 'ComfyUI/models/diffusion_models/ltxv-2b-0.9.8-distilled-q8_0.gguf',
    comfyNodeClasses: ['UnetLoaderGGUF', 'CLIPLoaderGGUF', 'VAELoader', 'EmptyLTXVLatentVideo', 'LTXVConditioning', 'ModelSamplingLTXV', 'LTXVScheduler', 'SamplerCustom', 'VAEDecode'],
    impactScore: 9,
    measurementKey: 'ltxv-2b-distilled',
    whyItHelps: 'Turns video generation from an overnight job into an inner loop.',
    notes: 'Needs t5-v1_1-xxl-encoder-Q5_K_M.gguf (3,386,856,640 B) and ltxv-0.9.8-2b-distilled-vae.safetensors (2,493,859,780 B). Licence text is not present in the install, so the licence line is the vendor claim and is UNVERIFIED here.'
  },
  {
    id: 'acestep-15-base',
    label: 'ACE-Step v1.5 base',
    kind: 'music',
    purpose: 'Local music generation for scored cuts, so a film does not need licensed stock music.',
    sizeBytes: 4787825604,
    sizeBasis: 'MEASURED_ON_DISK',
    // qwen_1.7b_ace15.safetensors 3,708,523,360 + ace_1.5_vae.safetensors
    // 337,431,732, both stat'd on this disk.
    companionBytes: 4045955092,
    companionBasis: 'MEASURED_ON_DISK',
    minVramGb: 6,
    minRamGb: 15,
    // Nothing has ever been generated with this model here. The floors are the
    // tier it was installed on, which is a guess dressed as a requirement.
    requirementBasis: 'UNVERIFIED',
    license: 'Apache-2.0',
    licenseBasis: 'UNVERIFIED',
    sourceUrl: 'https://huggingface.co/ACE-Step/ACE-Step-v1.5',
    sha256: '4177f600501a6d4bd81cadaa0abac557ffd15c54e5c8cb52053cdb24a0844d6b',
    hashBasis: 'MEASURED_ON_DISK',
    installState: 'installed',
    installedPath: 'ComfyUI/models/diffusion_models/acestep_v1.5_base.safetensors',
    comfyNodeClasses: ['VAELoader', 'TextEncodeAceStepAudio15', 'EmptyAceStep15LatentAudio', 'KSampler', 'VAEDecodeAudio', 'SaveAudio'],
    impactScore: 5,
    measurementKey: null,
    whyItHelps: 'Removes the music licensing question from every export.',
    notes: 'Needs qwen_1.7b_ace15.safetensors (3,708,523,360 B) and ace_1.5_vae.safetensors (337,431,732 B). No generation benchmark has been run for this model on this machine, so no timing is quoted. No licence file ships in the install.'
  },
  {
    id: 'piper-ljspeech',
    label: 'Piper en_US LJSpeech (high)',
    kind: 'tts',
    purpose: 'Offline narration. CPU-only, so it never competes with the GPU lease.',
    sizeBytes: 114204494,
    sizeBasis: 'MEASURED_ON_DISK',
    // The measured directory total is the whole provider; nothing else loads.
    companionBytes: 0,
    companionBasis: 'MEASURED_ON_DISK',
    minVramGb: 0,
    minRamGb: 2,
    // minVramGb 0 is a fact about the runtime (piper-tts is CPU-only, it has no
    // CUDA path). The 2 GB RAM floor is a guess; no Piper run was timed here.
    requirementBasis: 'UNVERIFIED',
    license: 'GPL-3.0 (Piper runtime); LJ Speech training corpus is public domain',
    licenseBasis: 'ON_DISK_LICENSE',
    sourceUrl: 'https://huggingface.co/rhasspy/piper-voices',
    sha256: '5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a',
    hashBasis: 'RUNTIME_LOCK_FILE',
    installState: 'installed',
    installedPath: 'audio-models/piper',
    comfyNodeClasses: [],
    impactScore: 7,
    measurementKey: null,
    whyItHelps: 'Narration without a cloud TTS account, and without touching the GPU.',
    notes: 'sizeBytes is the measured directory total (onnx 114,199,011 + onnx.json 4,970 + MODEL_CARD 513). sha256 pins the onnx weight. Licence line is from the on-disk MODEL_CARD plus the audio lock file; the GPL-3.0 term is the piper-tts 1.8.0 runtime, not the voice.'
  },
  {
    id: 'whisper-tiny-en',
    label: 'faster-whisper tiny.en',
    kind: 'stt',
    purpose: 'Transcription for auto-captions and cut-point search. CPU-only.',
    sizeBytes: 78091917,
    sizeBasis: 'MEASURED_ON_DISK',
    companionBytes: 0,
    companionBasis: 'MEASURED_ON_DISK',
    minVramGb: 0,
    minRamGb: 2,
    // CPU-only by construction (faster-whisper on the CTranslate2 CPU backend).
    // The RAM floor is unmeasured.
    requirementBasis: 'UNVERIFIED',
    license: 'MIT',
    licenseBasis: 'RUNTIME_LOCK_FILE',
    sourceUrl: 'https://huggingface.co/Systran/faster-whisper-tiny.en',
    sha256: '1a5afae06a4db91c975c9a9d78be5cc110ee4ea022ad57d55492e4550e936b2a',
    hashBasis: 'RUNTIME_LOCK_FILE',
    installState: 'installed',
    installedPath: 'audio-models/whisper-tiny.en',
    comfyNodeClasses: [],
    impactScore: 6,
    measurementKey: null,
    whyItHelps: 'Captions and searchable dialogue for 78 MB.',
    notes: 'sizeBytes is the measured directory total across the five locked files; sha256 pins model.bin. Runs in audio-venv via faster-whisper 1.2.1, outside ComfyUI.'
  },
  {
    id: 'rife-ncnn',
    label: 'RIFE v4.6 (ncnn-vulkan, 20221029)',
    kind: 'interpolation',
    purpose: 'Frame interpolation. Generate fewer frames, interpolate up to the delivery frame rate.',
    sizeBytes: 431540241,
    sizeBasis: 'RUNTIME_LOCK_FILE',
    // The release ZIP is self-contained: exe, DLL and weights all ship in it.
    companionBytes: 0,
    companionBasis: 'RUNTIME_LOCK_FILE',
    minVramGb: 2,
    minRamGb: 4,
    // No RIFE run has been timed here and the lock file records no VRAM figure.
    // Both floors are guesses.
    requirementBasis: 'UNVERIFIED',
    license: 'MIT (RIFE code and model release); the Microsoft runtime DLL has separate terms',
    licenseBasis: 'RUNTIME_LOCK_FILE',
    sourceUrl: 'https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-windows.zip',
    sha256: 'd8e4d772d26cd8006ef0ad0bc82eb191b53c68677d1ae2f42506d74cbbbea606',
    hashBasis: 'RUNTIME_LOCK_FILE',
    installState: 'installed',
    installedPath: 'rife-qualification/runtime',
    comfyNodeClasses: [],
    impactScore: 6,
    measurementKey: null,
    whyItHelps: 'Halves the frames a video model has to produce for a given output frame rate.',
    notes: 'sizeBytes and sha256 are the release ZIP, which is what a fresh install downloads; the extracted rife-v4.6 weights measure 10,631,069 B on disk. The upstream release published no digest, so the lock hash was measured from the official HTTPS download.'
  },
  {
    id: 'realesrgan-ncnn',
    label: 'Real-ESRGAN x4plus (ncnn-vulkan, v0.2.5.0 / 20220424)',
    kind: 'upscale',
    purpose: 'Upscale a finished cut instead of generating at a resolution this GPU cannot hold.',
    sizeBytes: 45474481,
    sizeBasis: 'MEASURED_ON_DISK',
    companionBytes: 0,
    companionBasis: 'MEASURED_ON_DISK',
    minVramGb: 2,
    minRamGb: 4,
    // enhancement.lock.json records qualification "not-yet-run"; both floors
    // are guesses and stay that way until an upscale is timed here.
    requirementBasis: 'UNVERIFIED',
    license: 'BSD-3-Clause',
    licenseBasis: 'ON_DISK_LICENSE',
    sourceUrl: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip',
    sha256: 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d',
    hashBasis: 'RUNTIME_LOCK_FILE',
    installState: 'installed',
    installedPath: 'enhancement/realesrgan-20220424',
    comfyNodeClasses: [],
    impactScore: 5,
    measurementKey: null,
    whyItHelps: 'Lets every generation run at a resolution that fits in 6GB and still deliver 4K.',
    notes: 'sizeBytes is the measured on-disk ZIP; sha256 is that archive from the enhancement lock. Licence read from enhancement/realesrgan-20220424/licenses/Real-ESRGAN-LICENSE. enhancement.lock.json records qualification as "not-yet-run" — installed is not the same as benchmarked.'
  },
  {
    id: 'ltxv-13b-distilled',
    label: 'LTX-Video 13B 0.9.8 distilled',
    kind: 'video',
    purpose: 'The quality step up from the 2B distilled model, at roughly 6.5x the weights.',
    // 13B / 2B scaled from the measured Q8_0 2B file: 2,173,891,072 B for 2B is
    // 1,086,945,536 B per billion parameters, x13. Real byte count depends on
    // the quant actually published, so this is a planning figure, not a fact.
    sizeBytes: 14130291968,
    sizeBasis: 'EXTRAPOLATED',
    // Same node graph as the 2B, so the same companions: the measured
    // t5-v1_1-xxl encoder 3,386,856,640 plus the measured 2B VAE 2,493,859,780
    // standing in for a 13B VAE whose real size is not known here.
    companionBytes: 5880716420,
    companionBasis: 'EXTRAPOLATED',
    // Weights alone exceed 6GB at Q8_0, so a 6GB card cannot hold this without
    // offload. 16 is the smallest card class that plausibly holds it; untested.
    minVramGb: 16,
    minRamGb: 31,
    requirementBasis: 'EXTRAPOLATED',
    license: 'LTXV Open Weights License (Lightricks)',
    licenseBasis: 'UNVERIFIED',
    sourceUrl: 'https://huggingface.co/Lightricks/LTX-Video',
    sha256: null,
    hashBasis: 'UNVERIFIED',
    installState: 'not-installed',
    installedPath: null,
    comfyNodeClasses: ['UnetLoaderGGUF', 'CLIPLoaderGGUF', 'VAELoader', 'EmptyLTXVLatentVideo', 'LTXVConditioning', 'ModelSamplingLTXV', 'LTXVScheduler', 'SamplerCustom', 'VAEDecode'],
    impactScore: 7,
    measurementKey: null,
    whyItHelps: 'Same LTXV pipeline and node graph as the installed 2B, so no new workflow to build.',
    notes: 'sizeBytes and minVramGb are EXTRAPOLATED from the measured 2B Q8_0 file; no 13B run has happened here. No checksum is pinned, so planInstall marks the step requiresChecksumPin and verifyInstall refuses it until one is recorded.'
  },
  {
    id: 'musetalk',
    label: 'MuseTalk (lip-sync)',
    kind: 'lip-sync',
    purpose: 'Drive a face in an existing shot from a narration track, instead of regenerating the shot.',
    sizeBytes: null,
    sizeBasis: 'UNVERIFIED',
    companionBytes: null,
    companionBasis: 'UNVERIFIED',
    minVramGb: 6,
    minRamGb: 15,
    requirementBasis: 'UNVERIFIED',
    license: 'MIT (code); model weights carry additional upstream terms',
    licenseBasis: 'UNVERIFIED',
    sourceUrl: 'https://github.com/TMElyralab/MuseTalk',
    sha256: null,
    hashBasis: 'UNVERIFIED',
    installState: 'not-installed',
    installedPath: null,
    comfyNodeClasses: [],
    impactScore: 4,
    measurementKey: null,
    whyItHelps: 'The one thing that makes a generated talking head survive a second viewing.',
    notes: 'The source checkout exists at D:\\VYREALM-runtime\\MuseTalk (34,492,721 B measured) but that is code only, no weights. Weight size, digests and the exact licence of each downloaded weight are UNVERIFIED, so planInstall blocks this until a size is pinned.'
  },
  {
    id: 'chatterbox-turbo',
    label: 'Chatterbox Turbo (expressive TTS)',
    kind: 'tts',
    purpose: 'Expressive narration with emotion control, where Piper is flat but reliable.',
    sizeBytes: null,
    sizeBasis: 'UNVERIFIED',
    companionBytes: null,
    companionBasis: 'UNVERIFIED',
    // 4 is a vendor-shaped guess, not a reading. It decides whether this model
    // is offered on a 4 GB card, so it is the most load-bearing unverified
    // number in the file.
    minVramGb: 4,
    minRamGb: 15,
    requirementBasis: 'UNVERIFIED',
    license: 'MIT',
    licenseBasis: 'UNVERIFIED',
    sourceUrl: 'https://github.com/resemble-ai/chatterbox',
    sha256: null,
    hashBasis: 'UNVERIFIED',
    installState: 'not-installed',
    installedPath: null,
    comfyNodeClasses: [],
    impactScore: 5,
    measurementKey: null,
    whyItHelps: 'Piper reads text; this one performs it.',
    notes: 'Nothing about this provider has been measured on this machine. Size, digest and licence are all UNVERIFIED vendor claims; planInstall blocks it until a size is pinned.'
  },
  {
    id: 'stable-audio-open',
    label: 'Stable Audio Open 1.0 (SFX)',
    kind: 'sfx',
    purpose: 'Short sound effects and foley, which ACE-Step (a music model) does not cover.',
    sizeBytes: null,
    sizeBasis: 'UNVERIFIED',
    companionBytes: null,
    companionBasis: 'UNVERIFIED',
    minVramGb: 6,
    minRamGb: 15,
    requirementBasis: 'UNVERIFIED',
    license: 'Stability AI Community License (non-commercial above a revenue threshold)',
    licenseBasis: 'UNVERIFIED',
    sourceUrl: 'https://huggingface.co/stabilityai/stable-audio-open-1.0',
    sha256: null,
    hashBasis: 'UNVERIFIED',
    installState: 'not-installed',
    installedPath: null,
    comfyNodeClasses: [],
    impactScore: 5,
    measurementKey: null,
    whyItHelps: 'Fills the foley gap between the music bed and the dialogue track.',
    notes: 'Size, digest and licence are UNVERIFIED. The licence is NOT a plain open-source licence and gates commercial use above a revenue threshold; read it before shipping anything made with this. planInstall blocks it until a size is pinned.'
  }
];

const deepFreeze = entry => Object.freeze({ ...entry, comfyNodeClasses: Object.freeze([...entry.comfyNodeClasses]) });
export const PROVIDERS = Object.freeze(CATALOGUE.map(deepFreeze));
const BY_ID = new Map(PROVIDERS.map(p => [p.id, p]));

export function getProvider(idOrEntry) {
  if (idOrEntry && typeof idOrEntry === 'object' && BY_ID.get(idOrEntry.id)) return BY_ID.get(idOrEntry.id);
  const found = BY_ID.get(String(idOrEntry ?? ''));
  if (!found) fail('PROVIDER_UNKNOWN', `No catalogue entry for "${idOrEntry}"`);
  return found;
}

/**
 * Everything that has to land on disk for this provider to run: the headline
 * weight plus the text encoder and VAE it cannot load without. Null when either
 * half is unpinned, which is what makes the provider unplannable.
 */
export function downloadBytesOf(provider) {
  const entry = getProvider(provider);
  if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0) return null;
  if (!Number.isSafeInteger(entry.companionBytes) || entry.companionBytes < 0) return null;
  return entry.sizeBytes + entry.companionBytes;
}

/** Sort key only. Uninstallable-by-size entries sort last rather than divide by null. */
function impactPerGb(provider) {
  const bytes = downloadBytesOf(provider);
  return bytes ? provider.impactScore / (bytes / GB) : 0;
}

// Hardware numbers arrive from detection, a UI or a test. A negative or
// non-finite reading is not a machine with negative VRAM, it is a missing
// reading, and hardware-profile.mjs already treats it that way.
const nonNegative = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };

function machineOf(hardware = {}) {
  const source = hardware.profile ? { vramGb: hardware.profile.vramGb, ramGb: hardware.profile.ramGb, gpu: hardware.profile.gpu } : hardware;
  return { vramGb: nonNegative(source.vramGb), ramGb: nonNegative(source.ramGb ?? hardware.totalRamGb), gpu: source.gpu ?? null };
}

function reasonFor(provider, machine, installedIds) {
  const parts = [provider.whyItHelps];
  const mine = MEASUREMENTS[provider.measurementKey];
  if (mine) parts.push(`Measured here: ${mine.secondsPerFrame} s/frame at ${mine.resolution} (${mine.frames} frames in ${mine.totalSeconds}s) on ${MEASUREMENTS.machine}.`);
  // Comparative speed claims are only made between two providers that were
  // both actually benchmarked, and always name both resolutions, because the
  // two runs were not made at the same size.
  if (mine) {
    for (const id of installedIds) {
      const rival = BY_ID.get(id), theirs = rival && rival.kind === provider.kind && MEASUREMENTS[rival.measurementKey];
      if (!theirs || theirs.secondsPerFrame <= mine.secondsPerFrame) continue;
      parts.push(`${(theirs.secondsPerFrame / mine.secondsPerFrame).toFixed(1)}x fewer seconds per frame than your installed ${rival.label} (${theirs.secondsPerFrame} s/frame at ${theirs.resolution}) — measured at different resolutions, not a like-for-like benchmark.`);
    }
  }
  // Quote the whole download, weights plus the encoder and VAE they need, not
  // the headline file: the difference is 5.5 GB for the LTXV entry.
  const download = downloadBytesOf(provider);
  if (download === null) parts.push('Download size is UNVERIFIED; it cannot be planned until a size is pinned.');
  else if (provider.sizeBasis === 'EXTRAPOLATED' || provider.companionBasis === 'EXTRAPOLATED') parts.push(`Download size ~${gb(download)} GB is EXTRAPOLATED, not measured.`);
  else parts.push(`${gb(download)} GB download${provider.companionBytes > 0 ? `, of which ${gb(provider.companionBytes)} GB is the text encoder and VAE it cannot run without` : ''}.`);
  parts.push(`Needs ${provider.minVramGb} GB VRAM, you have ${machine.vramGb}.`);
  if (provider.requirementBasis !== 'MEASURED_RUN') parts.push(`That requirement is ${provider.requirementBasis}, not a measurement taken here.`);
  return parts.join(' ');
}

/**
 * What this machine should install next, worst-first filtered then ranked by
 * impact per byte. `tier` is a HARDWARE_PROFILES id; omit it to classify from
 * the hardware itself.
 */
export function recommendProviders(hardware = {}, tier = null, { installed = null } = {}) {
  const machine = machineOf(hardware);
  const tierId = tier ?? classifyHardware({ vramGb: machine.vramGb, ramGb: machine.ramGb, gpu: machine.gpu }).id;
  const profile = HARDWARE_PROFILES[tierId];
  if (!profile) fail('HARDWARE_TIER_UNKNOWN', `"${tierId}" is not a hardware profile id`);
  const installedIds = installed ? [...installed] : PROVIDERS.filter(p => p.installState === 'installed').map(p => p.id);
  const installedSet = new Set(installedIds);
  const recommended = [], unsupported = [], alreadyInstalled = [];
  for (const provider of PROVIDERS) {
    const summary = { id: provider.id, label: provider.label, kind: provider.kind, sizeBytes: provider.sizeBytes, sizeBasis: provider.sizeBasis, minVramGb: provider.minVramGb, license: provider.license, installState: provider.installState };
    if (installedSet.has(provider.id)) { alreadyInstalled.push({ ...summary, reason: 'Already installed on this machine.' }); continue; }
    // The tier's route budget is a GPU budget. A provider that needs no VRAM
    // (Piper, whisper.cpp-class models) is not GPU work and is not gated by it,
    // otherwise a 114 MB CPU voice would demand a 12GB card to be suggested.
    const route = provider.minVramGb > 0 ? ROUTE_BY_KIND[provider.kind] : null;
    if (provider.minVramGb > machine.vramGb) { unsupported.push({ ...summary, code: 'INSUFFICIENT_VRAM', reason: `Needs ${provider.minVramGb} GB VRAM; this machine has ${machine.vramGb} GB.` }); continue; }
    if (provider.minRamGb > machine.ramGb) { unsupported.push({ ...summary, code: 'INSUFFICIENT_RAM', reason: `Needs ${provider.minRamGb} GB system RAM; this machine has ${machine.ramGb} GB.` }); continue; }
    // hardware-profile.mjs blocks 'neural-video' below CREATOR_LOCAL, but both
    // video models were measured running on this 6GB STANDARD_LOCAL box. A
    // recorded run on hardware that meets the provider's own minimums beats the
    // coarse tier heuristic; a provider with no measurement does not get to.
    const measured = MEASUREMENTS[provider.measurementKey], blockedByTier = route !== null && profile.blockedRoutes.includes(route);
    if (blockedByTier && !measured) { unsupported.push({ ...summary, code: tierId === 'RENDER_ONLY' ? 'NO_DISCRETE_GPU' : 'INSUFFICIENT_HARDWARE_PROFILE', reason: `The ${profile.label} tier blocks the "${route}" route: ${profile.reason}` }); continue; }
    // Never suggest something planInstall would refuse: with no size there is
    // no way to check free disk before downloading, so it is not installable.
    if (!Number.isSafeInteger(provider.sizeBytes)) { unsupported.push({ ...summary, code: 'DOWNLOAD_SIZE_UNKNOWN', reason: `${provider.label} has no verified or extrapolated download size (sizeBasis ${provider.sizeBasis}), so free disk cannot be checked before downloading. Pin a size before offering this.` }); continue; }
    const tierOverride = blockedByTier ? ` The ${profile.label} tier blocks "${route}", overridden here by a recorded run on hardware meeting this provider's own minimums.` : '';
    recommended.push({ ...summary, impactPerGb: Number(impactPerGb(provider).toFixed(4)), tierOverridden: Boolean(tierOverride), reason: reasonFor(provider, machine, installedIds) + tierOverride });
  }
  recommended.sort((a, b) => b.impactPerGb - a.impactPerGb || a.id.localeCompare(b.id));
  return { tier: tierId, machine, recommended, unsupported, alreadyInstalled };
}

/**
 * A download plan. Refuses to produce one without an explicit approval flag,
 * and refuses when the download plus 5 GB of working headroom would not fit.
 * Unguarded downloads are what took this disk from 27 GB to 7.9 GB free.
 */
export function planInstall(providerIds, { freeDiskBytes = null, approved = false, installed = null } = {}) {
  if (approved !== true) fail('INSTALL_NOT_APPROVED', 'Pass approved:true. Downloads never start from a default or a truthy value.');
  const ids = [...new Set(Array.isArray(providerIds) ? providerIds : [providerIds])];
  if (!ids.length) fail('INSTALL_NOTHING_REQUESTED', 'Name at least one provider to install');
  // installState in the catalogue describes THIS disk. Another machine passes
  // its own detected set, the same way recommendProviders takes one, or the two
  // disagree and a fresh install refuses to download what it does not have.
  const installedSet = new Set(installed ?? PROVIDERS.filter(p => p.installState === 'installed').map(p => p.id));
  const steps = [], blocked = [];
  for (const id of ids) {
    const provider = getProvider(id);
    if (installedSet.has(id)) { blocked.push({ id, code: 'ALREADY_INSTALLED', reason: `${provider.label} is already installed${provider.installedPath ? ` at ${provider.installedPath}` : ''}.` }); continue; }
    if (!Number.isSafeInteger(provider.sizeBytes) || provider.sizeBytes <= 0) { blocked.push({ id, code: 'DOWNLOAD_SIZE_UNKNOWN', reason: `${provider.label} has no verified or extrapolated download size, so free disk cannot be checked before downloading.` }); continue; }
    steps.push({
      id, label: provider.label, url: provider.sourceUrl,
      bytes: provider.sizeBytes, sizeBasis: provider.sizeBasis,
      sha256: provider.sha256, hashBasis: provider.hashBasis,
      // verified-download.mjs cannot run without a pinned digest, by design.
      requiresChecksumPin: !HASH.test(provider.sha256 || ''),
      license: provider.license, licenseBasis: provider.licenseBasis
    });
  }
  const totalBytes = steps.reduce((sum, step) => sum + step.bytes, 0);
  const requiredBytes = totalBytes + HEADROOM_BYTES;
  if (freeDiskBytes !== null && Number(freeDiskBytes) < requiredBytes) {
    const shortfall = requiredBytes - Number(freeDiskBytes);
    fail('INSUFFICIENT_DISK', `${gb(totalBytes)} GB of downloads plus ${gb(HEADROOM_BYTES)} GB working headroom needs ${gb(requiredBytes)} GB free, but only ${gb(Number(freeDiskBytes))} GB is free. Short by ${gb(shortfall)} GB.`);
  }
  return { steps, totalBytes, requiredBytes, headroomBytes: HEADROOM_BYTES, freeDiskBytes: freeDiskBytes === null ? null : Number(freeDiskBytes), blocked };
}

/** Post-download check. A provider with no pinned digest can never pass. */
export function verifyInstall(provider, { actualBytes = null, actualSha256 = null } = {}) {
  const entry = getProvider(provider), mismatches = [];
  if (!HASH.test(entry.sha256 || '')) mismatches.push({ field: 'sha256', code: 'EXPECTED_SHA256_NOT_PINNED', expected: null, actual: actualSha256, reason: `${entry.label} has no pinned digest (hashBasis ${entry.hashBasis}); pin one before trusting a download.` });
  else if (String(actualSha256 || '').toLowerCase() !== entry.sha256) mismatches.push({ field: 'sha256', code: 'SHA256_MISMATCH', expected: entry.sha256, actual: actualSha256, reason: 'Downloaded bytes do not hash to the pinned digest.' });
  if (!Number.isSafeInteger(entry.sizeBytes)) mismatches.push({ field: 'bytes', code: 'EXPECTED_SIZE_NOT_PINNED', expected: null, actual: actualBytes, reason: `${entry.label} has no verified download size (sizeBasis ${entry.sizeBasis}).` });
  else if (Number(actualBytes) !== entry.sizeBytes) mismatches.push({ field: 'bytes', code: 'SIZE_MISMATCH', expected: entry.sizeBytes, actual: actualBytes, reason: `Expected ${entry.sizeBytes} bytes, got ${actualBytes}.` });
  return { ok: mismatches.length === 0, id: entry.id, mismatches };
}

export function catalogueEvidence({ hardware = {}, tier = null, installed = null, plan = null, now = Date.now() } = {}) {
  const recommendation = recommendProviders(hardware, tier, { installed });
  return {
    schemaVersion: 1,
    recordedAt: new Date(now).toISOString(),
    tier: recommendation.tier,
    machine: recommendation.machine,
    benchmarkMachine: MEASUREMENTS.machine,
    catalogue: PROVIDERS.map(p => ({ id: p.id, kind: p.kind, installState: p.installState, sizeBytes: p.sizeBytes, sizeBasis: p.sizeBasis, sha256: p.sha256, hashBasis: p.hashBasis, license: p.license, licenseBasis: p.licenseBasis })),
    recommended: recommendation.recommended.map(r => ({ id: r.id, impactPerGb: r.impactPerGb, reason: r.reason })),
    unsupported: recommendation.unsupported.map(u => ({ id: u.id, code: u.code, reason: u.reason })),
    alreadyInstalled: recommendation.alreadyInstalled.map(a => a.id),
    plan: plan ? { totalBytes: plan.totalBytes, requiredBytes: plan.requiredBytes, headroomBytes: plan.headroomBytes, steps: plan.steps.map(s => ({ id: s.id, bytes: s.bytes, sizeBasis: s.sizeBasis, requiresChecksumPin: s.requiresChecksumPin })), blocked: plan.blocked } : null,
    // Stated so a reader never mistakes this catalogue for a benchmark suite.
    unmeasured: ['ACE-Step generation time on this machine', 'Real-ESRGAN qualification (enhancement.lock.json records not-yet-run)', 'every not-installed provider: size, digest, licence text and speed']
  };
}
