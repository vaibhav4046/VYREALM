// Capability tiers: turn detected hardware into a production configuration.
//
// Every number here is one of four things, and which one is always stated:
//   MEASURED      a run on the reference box (Windows 11, RTX 3050 Laptop 6 GB,
//                 16 GB RAM, 12-core i5-12450HX), or a file stat under
//                 D:/VYREALM-runtime/ComfyUI/models
//   EXTRAPOLATED  arithmetic from one of those anchors, working shown in the
//                 tier's estimateBasis
//   POLICY        a chosen threshold. The ladder bands are policy, not
//                 measurements. 0/4 (minimal), 6/15 (standard) and 12/32
//                 (creator) are the RENDER_ONLY / STANDARD_LOCAL /
//                 CREATOR_LOCAL vram+ram bands already set in
//                 hardware-profile.mjs; entry's 4/8, workstation's 24/64 and
//                 every core minimum on the ladder are new here and rest on
//                 nothing measured. hardware-profile.mjs sets no core floors.
//   UNVERIFIED    an assumption that drives a number, named where it is used
//                 (the cores-per-composite divisor, the linear cost model)
// The rule is not that nothing is guessed. It is that no guess is silent.
//
// Extends runtime/hardware-profile.mjs. That module answers "which routes may
// this machine attempt"; this one answers "at what settings, and how long will
// it take". classifyHardware() gates capability, selectTier() configures it.

// The three Wan runs actually logged on this box, copied from the REROLL
// strategy basis in quality-gate.mjs. The project's 1568 s compute anchor is
// NOT one of them and is not their mean; the gap is computed below rather than
// typed, so it cannot drift into a flattering round number.
const WAN_LOGGED_RUNS = Object.freeze([1838.020, 1716.804, 1413.336]);
const WAN_LOGGED_MEAN = Number((WAN_LOGGED_RUNS.reduce((a, b) => a + b, 0) / WAN_LOGGED_RUNS.length).toFixed(2));
const WAN_ANCHOR_SECONDS = 1568;
const pct = (part, whole) => (100 * part / whole).toFixed(1);
const WAN_OPTIMISM = 'OPTIMISTIC: the three logged local runs (quality-gate.mjs) were ' + WAN_LOGGED_RUNS.join(' / ') +
  ' s, mean ' + WAN_LOGGED_MEAN + ' s. The ' + WAN_ANCHOR_SECONDS + ' s anchor sits ' +
  pct(WAN_LOGGED_MEAN - WAN_ANCHOR_SECONDS, WAN_LOGGED_MEAN) + '% under that mean (equivalently the mean is ' +
  pct(WAN_LOGGED_MEAN - WAN_ANCHOR_SECONDS, WAN_ANCHOR_SECONDS) + '% above the anchor), so a budget that only just clears it can still overrun.';

/** The two measured generation anchors. Both models exist on disk. */
export const MEASURED = Object.freeze({
  ltx: Object.freeze({
    model: 'ltxv-2b-0.9.8-distilled-q8_0.gguf',
    label: 'LTX-Video 2B distilled Q8_0',
    frames: 97,
    width: 768,
    height: 512,
    steps: 8,
    cfg: 1.0,
    seconds: 196,
    note: 'Fits entirely in 6 GB VRAM with no offload. 196 s for 97 frames is ~2.0 s/frame.'
  }),
  wan: Object.freeze({
    model: 'Wan2.2-TI2V-5B-Q4_K_M.gguf',
    label: 'Wan2.2 TI2V-5B Q4_K_M',
    frames: 121,
    width: 1024,
    height: 576,
    // 20 steps is not in the brief. It is recorded in quality-gate.mjs (the
    // REROLL strategy basis and the comment above its parameters) as the step
    // count the 1568 s anchor was measured at, and it is load-bearing: without
    // it the frames x megapixels x steps extrapolation has no step term.
    steps: 20,
    seconds: WAN_ANCHOR_SECONDS,
    peakVramGib: 5.85,
    loggedRuns: WAN_LOGGED_RUNS,
    loggedMeanSeconds: WAN_LOGGED_MEAN,
    note: WAN_ANCHOR_SECONDS + ' s for 121 frames at 1024x576 / 20 steps is ~13.0 s/frame. Peak 5.85 GiB VRAM on a 6 GB card. ' + WAN_OPTIMISM
  }),
  // FFmpeg composite of a 15 s 1080x1920 cut, CPU only, on the 12-core
  // reference box. Applied unscaled to every tier: composite cost on a
  // 2-core machine is UNVERIFIED and will be worse than this.
  composite: Object.freeze({ seconds: 11, cutSeconds: 15, width: 1080, height: 1920, cores: 12 })
});

const MP = (w, h) => (w * h) / 1e6;
const work = ({ frames, width, height, steps }) => frames * MP(width, height) * steps;

/**
 * Diffusion cost scales with frames x megapixels x steps. Each anchor gives a
 * seconds-per-frame-megapixel-step rate; every extrapolated estimate is that
 * rate replayed at a different frame/resolution/step budget. Linearity in all
 * three terms is the standard first-order assumption for DiT sampling; it is
 * not itself measured, and only two points on the curve exist.
 */
function extrapolate(anchor, target) {
  return Math.round(anchor.seconds * (work(target) / work(anchor)));
}

function basisFor(anchor, target, caveat) {
  const ratio = work(target) / work(anchor);
  const from = anchor.frames + 'f ' + anchor.width + 'x' + anchor.height + ' ' + anchor.steps + ' steps = ' + anchor.seconds + ' s';
  const to = target.frames + 'f ' + target.width + 'x' + target.height + ' ' + target.steps + ' steps';
  return 'EXTRAPOLATED from the measured ' + anchor.label + ' run (' + from + ') by frames x megapixels x steps: ' + to +
    ' is ' + ratio.toFixed(4) + 'x that work, so ' + anchor.seconds + ' x ' + ratio.toFixed(4) + ' = ' +
    extrapolate(anchor, target) + ' s. ' + caveat;
}

// UNVERIFIED, and load-bearing: it divides every composite wall-clock figure
// this module reports. The only composite ever timed here was ONE 15 s
// 1080x1920 cut on the 12-core box (11 s). Nobody measured how many cores
// FFmpeg actually saturated during it, so 4 is a scheduling policy chosen to
// leave the OS and the studio process room, not a measured thread count. If
// FFmpeg in fact saturates more cores, these slot counts are too optimistic.
const CORES_PER_COMPOSITE = 4;
const COMPOSITE_SLOT_BASIS = 'UNVERIFIED: slots are floor(cores/' + CORES_PER_COMPOSITE +
  '), floor 1. The ' + CORES_PER_COMPOSITE + '-cores-per-composite divisor is scheduling policy; the single timed composite never had its core usage measured.';
const compositeSlots = cores => Math.max(1, Math.floor(cores / CORES_PER_COMPOSITE));

const LTX_ENTRY = { frames: 65, width: 512, height: 320, steps: 8 };
const WAN_CREATOR = { frames: 121, width: 1024, height: 576, steps: 20 };
const WAN_WORKSTATION = { frames: 121, width: 1280, height: 704, steps: 20 };

/**
 * Ordered minimal -> workstation. Thresholds increase strictly in all three
 * dimensions, so the ladder has no overlap and no gap: a machine takes the
 * highest tier whose vram, ram and core minima it meets, all three.
 *
 * neuralConcurrency is 1 on every tier, workstation included. There is one
 * GPU. Two diffusion jobs sharing it do not parallelise: on the 6 GB reference
 * card the Wan2.2 working set alone peaks at 5.85 GiB, so a second job forces
 * both into host-memory offload and each run ends up slower than the pair
 * would have been back to back. Above 6 GB the working set would fit twice
 * over, but the SMs are still one resource and the two jobs simply timeshare
 * them, so wall clock is unchanged while peak memory doubles. Serial is never
 * worse and is the only arrangement anyone here measured.
 * inference-harness.acquireGpuLease() enforces it at the process level; this
 * field is the declared intent that matches.
 *
 * compositeConcurrency is the opposite case: FFmpeg composites are CPU-bound
 * and genuinely parallel, so this scales with cores.
 */
export const TIERS = Object.freeze({
  minimal: Object.freeze({
    id: 'minimal',
    label: 'Minimal',
    minVramGb: 0,
    minRamGb: 4,
    minCores: 2,
    videoModel: null,
    resolution: Object.freeze({ width: 1080, height: 1920 }),
    frames: null,
    steps: null,
    fps: 30,
    compositeConcurrency: compositeSlots(2),
    neuralConcurrency: 1,
    estimatedSecondsPerShot: null,
    estimateBasis: 'NOT_APPLICABLE: this tier runs no neural video model, so there is no per-shot diffusion cost to estimate. Composite cost is the measured FFmpeg figure. ' + COMPOSITE_SLOT_BASIS,
    notes: 'Floor tier. Editing, compositing, captions and audio mix from supplied or stock footage. No neural generation is offered below 4 GB VRAM: the smallest model on disk (ltxv-2b-0.9.8-distilled-q8_0.gguf) was only ever measured with its weights resident, and CPU-only diffusion was never timed here. The 1080x1920 at 30 fps canvas is the vertical format already defined in format-library.mjs, and is the geometry the 11 s composite was measured at.'
  }),
  entry: Object.freeze({
    id: 'entry',
    label: 'Entry',
    minVramGb: 4,
    minRamGb: 8,
    minCores: 4,
    videoModel: MEASURED.ltx.model,
    resolution: Object.freeze({ width: LTX_ENTRY.width, height: LTX_ENTRY.height }),
    frames: LTX_ENTRY.frames,
    steps: LTX_ENTRY.steps,
    fps: 24,
    compositeConcurrency: compositeSlots(4),
    neuralConcurrency: 1,
    estimatedSecondsPerShot: extrapolate(MEASURED.ltx, LTX_ENTRY),
    estimateBasis: basisFor(MEASURED.ltx, LTX_ENTRY, 'Treat it as a LOWER BOUND: a 4 GB card has less memory bandwidth than the measured RTX 3050 and will likely offload the text encoder, neither of which this arithmetic accounts for. No 4 GB run was measured. ' +
      'The 4 GB / 8 GB floor is POLICY and it is BELOW the project catalogue: provider-catalogue.mjs declares this same LTX build at minVramGb 6, minRamGb 15, minDiskGb 6, and lists a 3,386,856,640 B text encoder and a 2,493,859,780 B VAE that have to be resident in turn beside the 2,173,891,072 B unet. So entry-tier neural video is UNQUALIFIED: offer it, do not promise it, until a 4 GB run is timed. ' + COMPOSITE_SLOT_BASIS),
    notes: 'Shortest usable shot: 65 frames at 24 fps is 2.7 s. 24 fps is the frame rate this project already generates at (runtime/neural-production.mjs); the 8 steps and cfg 1.0 are the settings the LTX anchor itself was measured at. The 65-frame, 512x320 target is CHOSEN, not measured: it keeps the measured 8n+1 frame spacing (97 = 8x12+1, 65 = 8x8+1) and 32-pixel dimensions, and nothing shorter or smaller was ever run. Upscale to delivery resolution in the composite stage rather than generating large.'
  }),
  standard: Object.freeze({
    id: 'standard',
    label: 'Standard',
    minVramGb: 6,
    // 15, not 16: a machine sold as 16 GB reports about 15 GiB through
    // os.totalmem(). Same boundary hardware-profile.mjs uses, for the same
    // reason, so the reference box classifies consistently in both modules.
    minRamGb: 15,
    minCores: 8,
    videoModel: MEASURED.ltx.model,
    resolution: Object.freeze({ width: MEASURED.ltx.width, height: MEASURED.ltx.height }),
    frames: MEASURED.ltx.frames,
    steps: MEASURED.ltx.steps,
    fps: 24,
    compositeConcurrency: compositeSlots(8),
    neuralConcurrency: 1,
    estimatedSecondsPerShot: MEASURED.ltx.seconds,
    estimateBasis: 'MEASURED on the reference box (Windows 11, RTX 3050 Laptop 6 GB, 16 GB RAM, 12-core i5-12450HX): ' +
      MEASURED.ltx.label + ', ' + MEASURED.ltx.frames + ' frames at ' + MEASURED.ltx.width + 'x' + MEASURED.ltx.height +
      ', ' + MEASURED.ltx.steps + ' steps, cfg ' + MEASURED.ltx.cfg + ' = ' + MEASURED.ltx.seconds + ' s. ' + MEASURED.ltx.note +
      ' The 6 GB / 15 GB band is the STANDARD_LOCAL band from hardware-profile.mjs; the 8-core minimum is POLICY, since that module sets no core floors. ' + COMPOSITE_SLOT_BASIS,
    notes: 'Reference tier, the only one with a real timing. ' + MEASURED.wan.label + ' also runs here and was measured at ' +
      MEASURED.wan.seconds + ' s per shot at ' + MEASURED.wan.width + 'x' + MEASURED.wan.height + ' (peak ' +
      MEASURED.wan.peakVramGib + ' GiB, inside 6 GB), but it is 8x slower per shot, so it is the creator-tier default and an opt-in here. RAM minimum is 15 GB because a 16 GB machine reports ~15 GiB through os.totalmem().'
  }),
  creator: Object.freeze({
    id: 'creator',
    label: 'Creator',
    minVramGb: 12,
    minRamGb: 32,
    minCores: 12,
    videoModel: MEASURED.wan.model,
    resolution: Object.freeze({ width: WAN_CREATOR.width, height: WAN_CREATOR.height }),
    frames: WAN_CREATOR.frames,
    steps: WAN_CREATOR.steps,
    fps: 24,
    compositeConcurrency: compositeSlots(12),
    neuralConcurrency: 1,
    estimatedSecondsPerShot: MEASURED.wan.seconds,
    estimateBasis: 'EXTRAPOLATED: identical configuration to the measured ' + MEASURED.wan.label + ' run (' +
      MEASURED.wan.frames + 'f ' + MEASURED.wan.width + 'x' + MEASURED.wan.height + ' ' + MEASURED.wan.steps +
      ' steps = ' + MEASURED.wan.seconds + ' s), so the frames x megapixels x steps ratio is 1.0000x and the estimate carries across unchanged. It is EXTRAPOLATED rather than MEASURED because that run happened on a 6 GB card at a 5.85 GiB peak, i.e. hard against the memory ceiling; a 12 GB card removes that pressure and should be no worse, but no 12 GB run was timed. Do not read it as a speedup claim. ' +
      WAN_OPTIMISM + ' The 12 GB / 32 GB band is the CREATOR_LOCAL band from hardware-profile.mjs; the 12-core minimum is POLICY. ' + COMPOSITE_SLOT_BASIS,
    notes: 'Slower per shot than the standard tier by design: better hardware buys the larger model, not a shorter render. ' +
      MEASURED.wan.label + ' at ' + MEASURED.wan.width + 'x' + MEASURED.wan.height +
      ' is off the model card 1280x704 720P bucket, at roughly 65.5% of native latent capacity; the workstation tier corrects that.'
  }),
  workstation: Object.freeze({
    id: 'workstation',
    label: 'Workstation',
    minVramGb: 24,
    minRamGb: 64,
    minCores: 16,
    videoModel: MEASURED.wan.model,
    resolution: Object.freeze({ width: WAN_WORKSTATION.width, height: WAN_WORKSTATION.height }),
    frames: WAN_WORKSTATION.frames,
    steps: WAN_WORKSTATION.steps,
    fps: 24,
    compositeConcurrency: compositeSlots(16),
    neuralConcurrency: 1,
    estimatedSecondsPerShot: extrapolate(MEASURED.wan, WAN_WORKSTATION),
    estimateBasis: basisFor(MEASURED.wan, WAN_WORKSTATION, 'Frames and steps are held at the measured values so resolution is the only variable. 1280x704 is the model card native 720P bucket (quality-detectors.mjs off_bucket_resolution), so this tier alone generates in distribution. No 24 GB run was measured, and the 24 GB / 64 GB / 16-core band is POLICY: it is above every band hardware-profile.mjs defines and rests on nothing measured. The anchor optimism carries through this multiplication unchanged. ' +
      WAN_OPTIMISM + ' ' + COMPOSITE_SLOT_BASIS),
    notes: 'The only tier that generates at the model native 1280x704 bucket. Everything below it is off-bucket and pays for that in latent capacity.'
  })
});

/** Ascending. Every threshold is strictly greater than the one before it. */
export const TIER_ORDER = Object.freeze(['minimal', 'entry', 'standard', 'creator', 'workstation']);
export const FLOOR_TIER_ID = TIER_ORDER[0];

function coded(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const nonNegative = value => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Reads hardware off detectHardware()'s record or a plain object. An
 * unreadable field reads as 0, so an unknown machine is under-promised rather
 * than over-promised; fieldsPresent records which ones were actually there.
 */
export function readHardware(hardware) {
  if (!hardware || typeof hardware !== 'object') throw coded('CAPABILITY_TIER_HARDWARE_REQUIRED: pass a hardware record, e.g. the result of detectHardware()', 'CAPABILITY_TIER_HARDWARE_REQUIRED');
  const vram = nonNegative(hardware.vramGb) ?? nonNegative(hardware.gpu?.vramGb) ?? nonNegative(hardware.profile?.vramGb);
  const ram = nonNegative(hardware.ramGb) ?? nonNegative(hardware.totalRamGb) ?? nonNegative(hardware.profile?.ramGb);
  const cores = nonNegative(hardware.cores) ?? nonNegative(hardware.cpus);
  return {
    vramGb: vram ?? 0,
    ramGb: ram ?? 0,
    cores: cores ?? 0,
    gpu: String(hardware.gpu?.gpu ?? hardware.profile?.gpu ?? (typeof hardware.gpu === 'string' ? hardware.gpu : '')).trim() || null,
    measured: { vramGb: vram !== null, ramGb: ram !== null, cores: cores !== null }
  };
}

const satisfies = (tier, hw) => hw.vramGb >= tier.minVramGb && hw.ramGb >= tier.minRamGb && hw.cores >= tier.minCores;

function shortfalls(tier, hw) {
  const out = [];
  if (hw.vramGb < tier.minVramGb) out.push({ dimension: 'vramGb', detected: hw.vramGb, required: tier.minVramGb });
  if (hw.ramGb < tier.minRamGb) out.push({ dimension: 'ramGb', detected: hw.ramGb, required: tier.minRamGb });
  if (hw.cores < tier.minCores) out.push({ dimension: 'cores', detected: hw.cores, required: tier.minCores });
  return out;
}

/**
 * Highest tier the hardware satisfies in all three dimensions, never one it
 * does not. A machine under the floor still gets a working configuration: the
 * floor tier, flagged belowMinimum with its shortfalls named. A weak laptop
 * degrades, it does not get an exception thrown at it.
 */
export function selectTier(hardware) {
  const hw = readHardware(hardware);
  const floor = TIERS[FLOOR_TIER_ID];
  const missing = shortfalls(floor, hw);
  if (missing.length) {
    return Object.freeze({
      ...floor,
      belowMinimum: true,
      diagnostic: Object.freeze({
        code: 'HARDWARE_BELOW_MINIMUM',
        message: 'Detected ' + hw.vramGb + ' GB VRAM / ' + hw.ramGb + ' GB RAM / ' + hw.cores + ' cores, under the ' +
          floor.label + ' minimum of ' + floor.minVramGb + ' / ' + floor.minRamGb + ' / ' + floor.minCores +
          '. Running the ' + floor.label + ' configuration anyway: editing and compositing will work, but slower than the measured figures, and nothing was measured on hardware this small.',
        shortfalls: Object.freeze(missing.map(Object.freeze))
      })
    });
  }
  let selected = floor;
  for (const id of TIER_ORDER) if (satisfies(TIERS[id], hw)) selected = TIERS[id];
  return Object.freeze({ ...selected, belowMinimum: false, diagnostic: null });
}

function spec(tier) {
  if (!tier || !TIER_ORDER.includes(tier.id)) throw coded('CAPABILITY_TIER_UNKNOWN: ' + tier?.id, 'CAPABILITY_TIER_UNKNOWN');
  return TIERS[tier.id];
}

/** The next tier up, or null at the top. */
export function nextTier(tier) {
  const t = spec(tier);
  const index = TIER_ORDER.indexOf(t.id);
  return index === TIER_ORDER.length - 1 ? null : TIERS[TIER_ORDER[index + 1]];
}

const wholeCount = (value, field) => {
  if (!Number.isInteger(value) || value < 0) throw coded('CAPABILITY_TIER_INVALID_COUNT: ' + field + '=' + value, 'CAPABILITY_TIER_INVALID_COUNT');
  return value;
};

/**
 * Project a job onto a tier.
 *
 * neuralSeconds is serial: one GPU, neuralConcurrency 1, so N shots cost N
 * times the per-shot estimate with no divisor anywhere.
 *
 * compositeSeconds is the total CPU work, the serial sum. wallClockSeconds
 * divides that by compositeConcurrency because FFmpeg composites are CPU-bound
 * and genuinely parallel, then adds it after the neural stage: composites
 * consume generated shots, so the two stages do not overlap.
 */
export function projectRuntime(tier, { shots = 0, composites = 0 } = {}) {
  const t = spec(tier);
  const shotCount = wholeCount(shots, 'shots');
  const compositeCount = wholeCount(composites, 'composites');
  if (shotCount > 0 && t.estimatedSecondsPerShot === null) {
    throw coded('CAPABILITY_TIER_NO_NEURAL_VIDEO: the ' + t.label + ' tier runs no video model, so ' + shotCount +
      ' shot(s) cannot be projected. Supply footage and project composites only.', 'CAPABILITY_TIER_NO_NEURAL_VIDEO');
  }
  const perShot = t.estimatedSecondsPerShot ?? 0;
  const perComposite = MEASURED.composite.seconds;
  const neuralSeconds = shotCount * perShot;
  const compositeSeconds = compositeCount * perComposite;
  const compositeWallClock = Math.ceil(compositeCount / t.compositeConcurrency) * perComposite;
  return {
    neuralSeconds,
    compositeSeconds,
    wallClockSeconds: neuralSeconds + compositeWallClock,
    basis: 'Neural: ' + shotCount + ' shot(s) x ' + perShot + ' s, serial (neuralConcurrency ' + t.neuralConcurrency +
      ', one GPU) = ' + neuralSeconds + ' s; the per-shot figure is ' + t.estimateBasis.split(':')[0] + '. Composite: ' +
      compositeCount + ' cut(s) x ' + perComposite + ' s = ' + compositeSeconds + ' s of CPU work, run ' +
      t.compositeConcurrency + ' at a time, so ceil(' + compositeCount + '/' + t.compositeConcurrency + ') x ' +
      perComposite + ' = ' + compositeWallClock + ' s of wall clock. Composites follow the shots they cut, so the two stages add rather than overlap. The ' +
      perComposite + ' s per composite is MEASURED (a ' + MEASURED.composite.cutSeconds + ' s ' + MEASURED.composite.width +
      'x' + MEASURED.composite.height + ' cut on the ' + MEASURED.composite.cores +
      '-core reference CPU) and is applied unscaled to every tier: on fewer cores it will be worse, and that is UNVERIFIED. The slot count itself is not measured either. ' + COMPOSITE_SLOT_BASIS
  };
}

/** One sentence for the UI. */
export function describeTier(tier) {
  const t = spec(tier);
  const need = t.minVramGb + ' GB VRAM, ' + t.minRamGb + ' GB RAM and ' + t.minCores + ' cores';
  const composites = t.compositeConcurrency + ' composite' + (t.compositeConcurrency === 1 ? '' : 's') + ' at a time';
  if (t.videoModel === null) {
    return t.label + ' (' + need + '): editing, compositing, captions and audio only, no neural video generation, ' + composites + '.';
  }
  const confidence = t.estimateBasis.startsWith('MEASURED') ? 'measured' : 'estimated';
  return t.label + ' (' + need + '): ' + t.videoModel + ' at ' + t.resolution.width + 'x' + t.resolution.height + ', ' +
    t.frames + ' frames at ' + t.fps + ' fps in ' + t.steps + ' steps, about ' + t.estimatedSecondsPerShot +
    ' s per shot (' + confidence + '), one shot on the GPU at a time and ' + composites + '.';
}

/** What was detected, which tier it bought, and why not the next one up. */
export function tierEvidence(hardware, tier, { now = Date.now() } = {}) {
  const hw = readHardware(hardware);
  const t = spec(tier);
  const above = nextTier(t);
  return {
    schemaVersion: 1,
    tierId: t.id,
    label: t.label,
    detected: { vramGb: hw.vramGb, ramGb: hw.ramGb, cores: hw.cores, gpu: hw.gpu, fieldsPresent: { ...hw.measured } },
    requires: { minVramGb: t.minVramGb, minRamGb: t.minRamGb, minCores: t.minCores },
    satisfied: satisfies(t, hw),
    belowMinimum: Boolean(tier.belowMinimum),
    diagnostic: tier.diagnostic ?? null,
    blockedFrom: above ? above.id : null,
    blockedBy: above ? shortfalls(above, hw) : [],
    configuration: {
      videoModel: t.videoModel,
      resolution: { ...t.resolution },
      frames: t.frames,
      steps: t.steps,
      fps: t.fps,
      neuralConcurrency: t.neuralConcurrency,
      compositeConcurrency: t.compositeConcurrency
    },
    estimatedSecondsPerShot: t.estimatedSecondsPerShot,
    estimateBasis: t.estimateBasis,
    compositeSecondsPerCut: MEASURED.composite.seconds,
    compositeBasis: 'MEASURED: a ' + MEASURED.composite.cutSeconds + ' s ' + MEASURED.composite.width + 'x' +
      MEASURED.composite.height + ' FFmpeg composite took ' + MEASURED.composite.seconds + ' s, CPU only, on the ' +
      MEASURED.composite.cores + '-core reference box. Applied unscaled to every tier.',
    notes: t.notes,
    recordedAt: new Date(now).toISOString(),
    unmeasured: [
      'every tier except standard: no run was timed on that hardware class',
      'composite cost on fewer than ' + MEASURED.composite.cores + ' cores',
      COMPOSITE_SLOT_BASIS,
      'the ladder thresholds themselves: 0/4, 6/15 and 12/32 GB are the hardware-profile.mjs bands, but 4/8, 24/64 and every core minimum are POLICY',
      'entry-tier neural video: it sits below the minVramGb 6 / minRamGb 15 that provider-catalogue.mjs declares for that same LTX build',
      'whether the linear frames x megapixels x steps cost model holds outside the two measured points',
      'output quality at any setting; these are timings, not judgments'
    ]
  };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/capability-tiers.mjs')) {
  const { detectHardware } = await import('./hardware-profile.mjs');
  const hardware = await detectHardware();
  const tier = selectTier(hardware);
  console.log(describeTier(tier));
  console.log(JSON.stringify(tierEvidence(hardware, tier), null, 2));
}
