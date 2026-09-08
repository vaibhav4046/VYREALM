import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  MEASURED, TIERS, TIER_ORDER, FLOOR_TIER_ID,
  readHardware, selectTier, nextTier, projectRuntime, describeTier, tierEvidence
} from './capability-tiers.mjs';

const ordered = TIER_ORDER.map(id => TIERS[id]);
const MODELS = join(process.env.VYRELUM_MODELS_DIR || 'D:/VYREALM-runtime/ComfyUI/models', 'diffusion_models');
const hw = (vramGb, ramGb, cores) => ({ vramGb, ramGb, cores });
// The reference box this project's measurements come from.
const REFERENCE = hw(6, 15, 12);

test('the ladder is complete and ordered minimal to workstation', () => {
  assert.ok(TIER_ORDER.length >= 5, 'at least five tiers');
  assert.deepEqual(TIER_ORDER.slice().sort(), Object.keys(TIERS).slice().sort(), 'TIER_ORDER covers TIERS exactly');
  for (const id of TIER_ORDER) assert.equal(TIERS[id].id, id, 'TIERS is keyed by id');
  assert.equal(FLOOR_TIER_ID, TIER_ORDER[0]);
  assert.equal(nextTier(ordered.at(-1)), null);
  assert.equal(nextTier(TIERS.minimal).id, 'entry');
  assert.ok(Object.isFrozen(TIERS) && ordered.every(Object.isFrozen), 'TIERS is frozen');
});

test('thresholds are strictly monotonic and therefore non-overlapping', () => {
  for (let i = 1; i < ordered.length; i++) {
    const lower = ordered[i - 1];
    const upper = ordered[i];
    for (const key of ['minVramGb', 'minRamGb', 'minCores']) {
      assert.ok(upper[key] > lower[key], `${upper.id}.${key} (${upper[key]}) must exceed ${lower.id}.${key} (${lower[key]})`);
    }
  }
  // Strict increase in every dimension means no machine satisfies a higher
  // tier without satisfying every lower one, so the bands cannot overlap.
  for (let i = 0; i < ordered.length; i++) {
    const at = hw(ordered[i].minVramGb, ordered[i].minRamGb, ordered[i].minCores);
    const satisfied = ordered.filter(t => at.vramGb >= t.minVramGb && at.ramGb >= t.minRamGb && at.cores >= t.minCores);
    assert.deepEqual(satisfied.map(t => t.id), TIER_ORDER.slice(0, i + 1), 'a tier minimum satisfies exactly the tiers at or below it');
  }
});

test('every tier declares a complete, coherent configuration', () => {
  for (const tier of ordered) {
    for (const key of ['id', 'label', 'minVramGb', 'minRamGb', 'minCores', 'videoModel', 'resolution', 'frames', 'steps', 'fps', 'compositeConcurrency', 'neuralConcurrency', 'estimatedSecondsPerShot', 'estimateBasis', 'notes']) {
      assert.ok(key in tier, `${tier.id} is missing ${key}`);
    }
    assert.ok(tier.resolution.width > 0 && tier.resolution.height > 0, `${tier.id} resolution`);
    assert.ok(tier.fps > 0, `${tier.id} fps`);
    assert.ok(typeof tier.notes === 'string' && tier.notes.length > 0, `${tier.id} notes`);
    const neural = tier.videoModel !== null;
    assert.equal(tier.frames !== null, neural, `${tier.id}: frames present iff a model is`);
    assert.equal(tier.steps !== null, neural, `${tier.id}: steps present iff a model is`);
    assert.equal(tier.estimatedSecondsPerShot !== null, neural, `${tier.id}: estimate present iff a model is`);
    if (neural) assert.ok(tier.estimatedSecondsPerShot > 0, `${tier.id} estimate is positive`);
  }
});

test('neuralConcurrency is 1 everywhere: there is one GPU', () => {
  // Not a scaling knob. Two diffusion jobs on the 6 GB reference card (Wan2.2
  // peaks at 5.85 GiB alone) thrash into host memory rather than parallelise,
  // and on a larger card they merely timeshare the same SMs.
  for (const tier of ordered) assert.equal(tier.neuralConcurrency, 1, `${tier.id} must run one diffusion job`);
});

test('compositeConcurrency scales with cores and never drops', () => {
  for (const tier of ordered) {
    assert.equal(tier.compositeConcurrency, Math.max(1, Math.floor(tier.minCores / 4)),
      `${tier.id}: FFmpeg threads one 1080x1920 composite over ~4 cores, so slots are cores/4 with a floor of 1`);
  }
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].compositeConcurrency >= ordered[i - 1].compositeConcurrency, 'composite slots never decrease going up');
  }
  assert.ok(ordered.at(-1).compositeConcurrency > ordered[0].compositeConcurrency, 'more cores buy more parallel composites');
});

test('exactly one tier is MEASURED and it is the 6 GB / 16 GB reference box', () => {
  const measured = ordered.filter(t => t.estimateBasis.startsWith('MEASURED'));
  assert.equal(measured.length, 1, 'only the box we actually timed carries a measured estimate');
  const [reference] = measured;
  assert.equal(reference.id, selectTier(REFERENCE).id, 'the measured tier is the one this machine selects');
  assert.equal(reference.estimatedSecondsPerShot, MEASURED.ltx.seconds);
  assert.equal(reference.frames, MEASURED.ltx.frames);
  assert.equal(reference.steps, MEASURED.ltx.steps);
  assert.deepEqual({ ...reference.resolution }, { width: MEASURED.ltx.width, height: MEASURED.ltx.height });
  assert.equal(reference.videoModel, MEASURED.ltx.model);
});

test('every non-measured estimate is labelled and carries its scaling basis', () => {
  for (const tier of ordered) {
    assert.ok(typeof tier.estimateBasis === 'string' && tier.estimateBasis.length > 40, `${tier.id} basis is a real sentence`);
    if (tier.estimateBasis.startsWith('MEASURED')) continue;
    if (tier.estimatedSecondsPerShot === null) {
      assert.ok(tier.estimateBasis.startsWith('NOT_APPLICABLE'), `${tier.id} with no estimate says so`);
      continue;
    }
    assert.ok(tier.estimateBasis.startsWith('EXTRAPOLATED'), `${tier.id} must be marked EXTRAPOLATED`);
    // The scaling assumption has to be written out, not merely asserted.
    assert.match(tier.estimateBasis, /frames x megapixels x steps/, `${tier.id} names the cost model`);
    assert.match(tier.estimateBasis, /\d+\.\d{4}x that work|ratio is 1\.0000x/, `${tier.id} shows the ratio it multiplied by`);
    const anchor = tier.videoModel === MEASURED.ltx.model ? MEASURED.ltx : MEASURED.wan;
    assert.ok(tier.estimateBasis.includes(String(anchor.seconds)), `${tier.id} cites the anchor it scaled from`);
    assert.ok(tier.estimateBasis.includes(String(tier.estimatedSecondsPerShot)), `${tier.id} basis shows the number it produced`);
  }
});

test('extrapolated estimates equal the arithmetic they claim', () => {
  const mp = (w, h) => (w * h) / 1e6;
  const cost = (anchor, t) => Math.round(anchor.seconds * ((t.frames * mp(t.resolution.width, t.resolution.height) * t.steps) / (anchor.frames * mp(anchor.width, anchor.height) * anchor.steps)));
  for (const tier of ordered) {
    if (tier.videoModel === null) continue;
    const anchor = tier.videoModel === MEASURED.ltx.model ? MEASURED.ltx : MEASURED.wan;
    assert.equal(tier.estimatedSecondsPerShot, cost(anchor, tier), `${tier.id} estimate must be the anchor rate replayed, not a guess`);
  }
  // Spot-check the two derived numbers by hand so a silent change to the
  // model is caught: entry 65f 512x320 8 steps off LTX, workstation 121f
  // 1280x704 20 steps off Wan (1280*704 / (1024*576) = 1.52778).
  assert.equal(TIERS.entry.estimatedSecondsPerShot, 55);
  assert.equal(TIERS.workstation.estimatedSecondsPerShot, 2396);
  assert.equal(TIERS.creator.estimatedSecondsPerShot, MEASURED.wan.seconds, 'same config as the measured Wan run, carried across');
});

test('every model named by a tier exists on disk', { skip: existsSync(MODELS) ? false : `no model directory at ${MODELS}` }, () => {
  // Guards against a tier naming a weight file nobody installed. Skipped
  // rather than failed where the runtime is not provisioned, since the tier
  // table is still correct there.
  for (const tier of ordered) {
    if (tier.videoModel === null) continue;
    const file = join(MODELS, tier.videoModel);
    assert.ok(existsSync(file), `${tier.id} names ${tier.videoModel}, which must be installed at ${file}`);
    assert.ok(statSync(file).size > 0, `${file} must not be empty`);
  }
});

test('selectTier is exact at every boundary and one unit either side', () => {
  for (let i = 0; i < ordered.length; i++) {
    const tier = ordered[i];
    const below = i === 0 ? null : ordered[i - 1];
    assert.equal(selectTier(hw(tier.minVramGb, tier.minRamGb, tier.minCores)).id, tier.id, `${tier.id}: exactly at its minimum`);
    assert.equal(selectTier(hw(tier.minVramGb + 1, tier.minRamGb + 1, tier.minCores + 1)).id, tier.id, `${tier.id}: one unit over stays put until the next tier`);
    if (!below) continue;
    // One unit under any single dimension drops exactly one tier.
    assert.equal(selectTier(hw(tier.minVramGb - 1, tier.minRamGb, tier.minCores)).id, below.id, `${tier.id}: 1 GB short of VRAM drops to ${below.id}`);
    assert.equal(selectTier(hw(tier.minVramGb, tier.minRamGb - 1, tier.minCores)).id, below.id, `${tier.id}: 1 GB short of RAM drops to ${below.id}`);
    assert.equal(selectTier(hw(tier.minVramGb, tier.minRamGb, tier.minCores - 1)).id, below.id, `${tier.id}: one core short drops to ${below.id}`);
  }
});

test('selectTier never returns a tier the hardware does not satisfy', () => {
  for (let vram = 0; vram <= 32; vram += 2) {
    for (let ram = 2; ram <= 72; ram += 6) {
      for (const cores of [1, 2, 4, 8, 12, 16, 24]) {
        const chosen = selectTier(hw(vram, ram, cores));
        if (chosen.belowMinimum) continue;
        assert.ok(vram >= chosen.minVramGb && ram >= chosen.minRamGb && cores >= chosen.minCores,
          `${vram}/${ram}/${cores} was given ${chosen.id}, which it does not satisfy`);
        const above = nextTier(chosen);
        if (above) {
          assert.ok(vram < above.minVramGb || ram < above.minRamGb || cores < above.minCores,
            `${vram}/${ram}/${cores} should have reached ${above.id}`);
        }
      }
    }
  }
});

test('the reference box lands on the measured tier', () => {
  const chosen = selectTier(REFERENCE);
  assert.equal(chosen.id, 'standard');
  assert.equal(chosen.belowMinimum, false);
  assert.equal(chosen.diagnostic, null);
  // 12 cores clears creator's core minimum, but 6 GB VRAM does not clear its
  // VRAM minimum, and all three must pass.
  assert.deepEqual(tierEvidence(REFERENCE, chosen).blockedBy.map(x => x.dimension), ['vramGb', 'ramGb']);
});

test('a below-floor machine degrades to the floor tier instead of throwing', () => {
  const weak = hw(0, 2, 1);
  const chosen = selectTier(weak);
  assert.equal(chosen.id, FLOOR_TIER_ID);
  assert.equal(chosen.belowMinimum, true);
  assert.equal(chosen.diagnostic.code, 'HARDWARE_BELOW_MINIMUM');
  assert.deepEqual(chosen.diagnostic.shortfalls.map(s => s.dimension), ['ramGb', 'cores']);
  assert.deepEqual(chosen.diagnostic.shortfalls[0], { dimension: 'ramGb', detected: 2, required: TIERS.minimal.minRamGb });
  assert.match(chosen.diagnostic.message, /under the Minimal minimum/);
  // Still a usable configuration, not a stub.
  assert.ok(chosen.compositeConcurrency >= 1);
  assert.equal(projectRuntime(chosen, { composites: 2 }).wallClockSeconds, 22);
  // A machine that only just meets the floor is NOT flagged.
  assert.equal(selectTier(hw(0, TIERS.minimal.minRamGb, TIERS.minimal.minCores)).belowMinimum, false);
});

test('a workstation never gets the minimal tier', () => {
  for (const machine of [hw(24, 64, 16), hw(48, 128, 64), hw(80, 512, 128)]) {
    const chosen = selectTier(machine);
    assert.notEqual(chosen.id, 'minimal');
    assert.equal(chosen.id, 'workstation');
    assert.equal(chosen.belowMinimum, false);
    assert.ok(chosen.videoModel, 'a workstation gets a video model');
  }
  // Nor does any machine at or above the entry threshold.
  for (let vram = 4; vram <= 40; vram += 4) {
    assert.notEqual(selectTier(hw(vram, 64, 16)).id, 'minimal');
  }
});

test('selectTier reads detectHardware() records and unknown fields read as zero', () => {
  // Shape produced by hardware-profile.detectHardware().
  const record = { totalRamGb: 15.8, cpus: 12, gpu: { gpu: 'NVIDIA GeForce RTX 3050 Laptop GPU', vramGb: 6 }, profile: { id: 'STANDARD_LOCAL' } };
  assert.equal(selectTier(record).id, 'standard');
  const read = readHardware(record);
  assert.deepEqual(read.measured, { vramGb: true, ramGb: true, cores: true });
  assert.equal(read.gpu, 'NVIDIA GeForce RTX 3050 Laptop GPU');
  // Nothing detected must under-promise, never over-promise.
  const blank = readHardware({});
  assert.deepEqual({ vramGb: blank.vramGb, ramGb: blank.ramGb, cores: blank.cores }, { vramGb: 0, ramGb: 0, cores: 0 });
  assert.deepEqual(blank.measured, { vramGb: false, ramGb: false, cores: false });
  assert.equal(selectTier({}).belowMinimum, true);
  assert.equal(selectTier({ vramGb: NaN, ramGb: 'lots', cores: -4 }).belowMinimum, true, 'garbage reads as zero, not as capacity');
  assert.throws(() => selectTier(null), e => e.code === 'CAPABILITY_TIER_HARDWARE_REQUIRED');
  assert.throws(() => selectTier('16GB'), e => e.code === 'CAPABILITY_TIER_HARDWARE_REQUIRED');
});

test('projectRuntime: neural is serial, composites are parallel', () => {
  const tier = TIERS.standard;
  const perShot = tier.estimatedSecondsPerShot;      // 196, measured
  const perCut = MEASURED.composite.seconds;          // 11, measured
  const slots = tier.compositeConcurrency;            // 2

  const nothing = projectRuntime(tier, {});
  assert.deepEqual([nothing.neuralSeconds, nothing.compositeSeconds, nothing.wallClockSeconds], [0, 0, 0]);

  // Serial neural: no divisor, ever.
  for (const shots of [1, 3, 7, 40]) {
    const r = projectRuntime(tier, { shots });
    assert.equal(r.neuralSeconds, shots * perShot, 'N shots cost N times one shot');
    assert.equal(r.wallClockSeconds, shots * perShot, 'no composites, so wall clock is the neural time');
  }

  // Parallel composites: compositeSeconds is total CPU work, wall clock is
  // that work divided across the slots and rounded up to whole batches.
  for (const composites of [1, 2, 3, 4, 5, 9]) {
    const r = projectRuntime(tier, { composites });
    assert.equal(r.compositeSeconds, composites * perCut, 'total CPU work is the serial sum');
    assert.equal(r.wallClockSeconds, Math.ceil(composites / slots) * perCut, 'wall clock is ceil(cuts/slots) batches');
    assert.ok(r.wallClockSeconds <= r.compositeSeconds, 'parallelism never costs more than serial');
  }
  assert.equal(projectRuntime(tier, { composites: 2 }).wallClockSeconds, 11, '2 cuts in 2 slots is one batch');
  assert.equal(projectRuntime(tier, { composites: 3 }).wallClockSeconds, 22, '3 cuts in 2 slots is two batches');

  // Combined: stages add, because composites consume the shots.
  const job = projectRuntime(tier, { shots: 5, composites: 3 });
  assert.equal(job.neuralSeconds, 5 * 196);
  assert.equal(job.compositeSeconds, 3 * 11);
  assert.equal(job.wallClockSeconds, 5 * 196 + Math.ceil(3 / 2) * 11);
  assert.equal(job.wallClockSeconds, 1002);
  assert.match(job.basis, /serial \(neuralConcurrency 1, one GPU\)/);
  assert.match(job.basis, /ceil\(3\/2\)/);
  assert.match(job.basis, /MEASURED/);
});

test('projectRuntime: more composite slots cut wall clock, more shots never do', () => {
  const cuts = 8;
  const wide = projectRuntime(TIERS.workstation, { composites: cuts });   // 4 slots
  const narrow = projectRuntime(TIERS.minimal, { composites: cuts });     // 1 slot
  assert.equal(narrow.compositeSeconds, wide.compositeSeconds, 'same CPU work either way');
  assert.ok(wide.wallClockSeconds < narrow.wallClockSeconds, 'more cores finish the same cuts sooner');
  assert.equal(narrow.wallClockSeconds, 8 * 11);
  assert.equal(wide.wallClockSeconds, 2 * 11);
  // Neural has no such lever anywhere on the ladder.
  for (const tier of ordered) {
    if (tier.videoModel === null) continue;
    assert.equal(projectRuntime(tier, { shots: 4 }).neuralSeconds, 4 * tier.estimatedSecondsPerShot);
  }
});

test('projectRuntime rejects bad input with coded errors, not approximations', () => {
  assert.throws(() => projectRuntime(TIERS.standard, { shots: 1.5 }), e => e.code === 'CAPABILITY_TIER_INVALID_COUNT');
  assert.throws(() => projectRuntime(TIERS.standard, { shots: -1 }), e => e.code === 'CAPABILITY_TIER_INVALID_COUNT');
  assert.throws(() => projectRuntime(TIERS.standard, { composites: '3' }), e => e.code === 'CAPABILITY_TIER_INVALID_COUNT');
  assert.throws(() => projectRuntime({ id: 'gaming-rig' }, { shots: 1 }), e => e.code === 'CAPABILITY_TIER_UNKNOWN');
  assert.throws(() => projectRuntime(null, {}), e => e.code === 'CAPABILITY_TIER_UNKNOWN');
  // The floor tier has no video model, so asking it for shots is an error
  // rather than a silent zero.
  assert.throws(() => projectRuntime(TIERS.minimal, { shots: 1 }), e => e.code === 'CAPABILITY_TIER_NO_NEURAL_VIDEO');
  assert.doesNotThrow(() => projectRuntime(TIERS.minimal, { shots: 0, composites: 4 }));
});

test('describeTier is one sentence and states what it can actually do', () => {
  for (const tier of ordered) {
    const line = describeTier(tier);
    assert.equal(line.split('. ').length, 1, `${tier.id}: one sentence`);
    assert.ok(line.endsWith('.'), `${tier.id}: ends in a full stop`);
    assert.ok(line.length < 300, `${tier.id}: fits a UI line`);
    assert.ok(line.startsWith(tier.label), `${tier.id}: leads with its label`);
    assert.ok(line.includes(String(tier.minVramGb) + ' GB VRAM'), `${tier.id}: names what it needs`);
    if (tier.videoModel === null) {
      assert.match(line, /no neural video generation/);
    } else {
      assert.ok(line.includes(tier.videoModel), `${tier.id}: names its model`);
      assert.ok(line.includes(String(tier.estimatedSecondsPerShot) + ' s per shot'), `${tier.id}: names its cost`);
      assert.ok(line.includes(tier.estimateBasis.startsWith('MEASURED') ? '(measured)' : '(estimated)'),
        `${tier.id}: the UI must not present an extrapolation as a measurement`);
    }
  }
  assert.equal(describeTier(TIERS.standard).includes('(measured)'), true);
  assert.equal(describeTier(TIERS.creator).includes('(estimated)'), true);
  assert.throws(() => describeTier({ id: 'nope' }), e => e.code === 'CAPABILITY_TIER_UNKNOWN');
});

test('tierEvidence records what was detected and why that tier', () => {
  const record = tierEvidence(REFERENCE, selectTier(REFERENCE), { now: 0 });
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.tierId, 'standard');
  assert.deepEqual(record.detected, { vramGb: 6, ramGb: 15, cores: 12, gpu: null, fieldsPresent: { vramGb: true, ramGb: true, cores: true } });
  assert.deepEqual(record.requires, { minVramGb: 6, minRamGb: 15, minCores: 8 });
  assert.equal(record.satisfied, true);
  assert.equal(record.belowMinimum, false);
  assert.equal(record.blockedFrom, 'creator');
  assert.deepEqual(record.blockedBy, [
    { dimension: 'vramGb', detected: 6, required: 12 },
    { dimension: 'ramGb', detected: 15, required: 32 }
  ], 'names every dimension short of the next tier, and only those');
  assert.equal(record.recordedAt, new Date(0).toISOString());
  assert.equal(record.configuration.neuralConcurrency, 1);
  assert.equal(record.compositeSecondsPerCut, MEASURED.composite.seconds);
  assert.match(record.estimateBasis, /^MEASURED/);
  assert.ok(record.unmeasured.length > 0, 'says what it does not know');

  const top = tierEvidence(hw(48, 128, 32), selectTier(hw(48, 128, 32)));
  assert.equal(top.blockedFrom, null, 'nothing above workstation');
  assert.deepEqual(top.blockedBy, []);

  const weakHw = hw(0, 2, 1);
  const weak = tierEvidence(weakHw, selectTier(weakHw));
  assert.equal(weak.belowMinimum, true);
  assert.equal(weak.satisfied, false);
  assert.equal(weak.diagnostic.code, 'HARDWARE_BELOW_MINIMUM');
  assert.equal(weak.configuration.videoModel, null);
  assert.equal(weak.estimatedSecondsPerShot, null);

  assert.throws(() => tierEvidence(REFERENCE, { id: 'nope' }), e => e.code === 'CAPABILITY_TIER_UNKNOWN');
});

test('tierEvidence round-trips through JSON so it can be persisted', () => {
  const chosen = selectTier(REFERENCE);
  const record = tierEvidence(REFERENCE, chosen, { now: 1_700_000_000_000 });
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record, 'no undefined, no cycles, no class instances');
});

// --- adversarial pass: the numbers, and the guards they lean on ---------------

test('MEASURED matches provider-catalogue, the repo declared source for these anchors', async () => {
  // provider-catalogue.mjs calls MEASUREMENTS "the only wall-clock generation
  // numbers this module is allowed to quote". If this module restates them, a
  // divergence is a fabrication in one file or the other. Fails loudly rather
  // than letting the two drift into disagreement.
  const { MEASUREMENTS, PROVIDERS } = await import('./provider-catalogue.mjs');
  const pairs = [[MEASURED.ltx, MEASUREMENTS['ltxv-2b-distilled']], [MEASURED.wan, MEASUREMENTS['wan22-5b']]];
  for (const [mine, theirs] of pairs) {
    assert.equal(mine.frames, theirs.frames, `${mine.model}: frame count`);
    assert.equal(`${mine.width}x${mine.height}`, theirs.resolution, `${mine.model}: resolution`);
    assert.equal(mine.seconds, theirs.totalSeconds, `${mine.model}: measured seconds`);
    assert.equal(Number((mine.seconds / mine.frames).toFixed(1)), theirs.secondsPerFrame, `${mine.model}: s/frame`);
    if (theirs.steps !== undefined) assert.equal(mine.steps, theirs.steps, `${mine.model}: steps`);
    if (theirs.peakVramGiB !== null) assert.equal(mine.peakVramGib, theirs.peakVramGiB, `${mine.model}: peak VRAM`);
  }
  assert.equal(MEASURED.composite.seconds, MEASUREMENTS.composite.totalSeconds);
  assert.ok(MEASUREMENTS.composite.description.includes(`${MEASURED.composite.cutSeconds}s at ${MEASURED.composite.width}x${MEASURED.composite.height}`), 'same composite job in both files');
  // And every model a tier names must be a catalogue entry, not a filename
  // someone remembered.
  const installed = new Set(PROVIDERS.map(p => p.installedPath?.split('/').at(-1)).filter(Boolean));
  for (const tier of ordered) if (tier.videoModel) assert.ok(installed.has(tier.videoModel), `${tier.id} names ${tier.videoModel}, absent from the catalogue`);
});

test('a tier below the catalogue floor for its model must say so', async () => {
  // The entry tier promises LTX on 4 GB / 8 GB while provider-catalogue.mjs
  // declares that same build at 6 GB / 15 GB. That disagreement is allowed to
  // exist, because nobody has run a 4 GB card either way. It is NOT allowed to
  // be silent: the tier's own basis has to name the catalogue's numbers.
  const { PROVIDERS } = await import('./provider-catalogue.mjs');
  const byFile = new Map(PROVIDERS.filter(p => p.installedPath).map(p => [p.installedPath.split('/').at(-1), p]));
  let disclosures = 0;
  for (const tier of ordered) {
    const provider = tier.videoModel && byFile.get(tier.videoModel);
    if (!provider) continue;
    if (tier.minVramGb >= provider.minVramGb && tier.minRamGb >= provider.minRamGb) continue;
    disclosures++;
    assert.match(tier.estimateBasis, /provider-catalogue\.mjs/, `${tier.id} is under the catalogue floor and must cite it`);
    assert.ok(tier.estimateBasis.includes(`minVramGb ${provider.minVramGb}`), `${tier.id} must state the declared VRAM floor`);
    assert.ok(tier.estimateBasis.includes(`minRamGb ${provider.minRamGb}`), `${tier.id} must state the declared RAM floor`);
    assert.match(tier.estimateBasis, /UNQUALIFIED/, `${tier.id} must not read as a promise`);
  }
  assert.equal(disclosures, 1, 'exactly the entry tier is below the catalogue floor today');
  assert.equal(TIERS.entry.minVramGb, 4, 'if this changes, re-check the disclosure above');
});

test('the anchor-optimism percentages are computed, not typed', () => {
  // 1568 s is the project compute anchor: not a measurement, and not the mean
  // of the runs that were measured. Both percentages quoted have to fall out
  // of the logged runs, so nobody can round the gap down by hand.
  const runs = MEASURED.wan.loggedRuns;
  assert.deepEqual([...runs], [1838.020, 1716.804, 1413.336], 'the three runs logged in quality-gate.mjs');
  const mean = Number((runs.reduce((a, b) => a + b, 0) / runs.length).toFixed(2));
  assert.equal(MEASURED.wan.loggedMeanSeconds, mean);
  assert.equal(mean, 1656.05);
  assert.ok(MEASURED.wan.seconds < mean, 'the anchor is optimistic against the runs, and must be stated as such');
  const underMean = (100 * (mean - MEASURED.wan.seconds) / mean).toFixed(1);                   // 5.3
  const overAnchor = (100 * (mean - MEASURED.wan.seconds) / MEASURED.wan.seconds).toFixed(1);  // 5.6
  assert.equal(underMean, '5.3');
  assert.equal(overAnchor, '5.6');
  for (const tier of [TIERS.creator, TIERS.workstation]) {
    assert.ok(tier.estimateBasis.includes(`${underMean}% under that mean`), `${tier.id}: states the gap against the right base`);
    assert.ok(tier.estimateBasis.includes(`${overAnchor}% above the anchor`), `${tier.id}: states the reciprocal too`);
    assert.ok(tier.estimateBasis.includes(String(mean)), `${tier.id}: shows the mean it compared against`);
  }
  // The earlier wording claimed 5.6% "under the observed mean", which is the
  // wrong base for that ratio. It must not come back.
  for (const tier of ordered) assert.ok(!/5\.6% under/.test(tier.estimateBasis), `${tier.id}: 5.6% is the gap over the anchor, not under the mean`);
});

test('the composite slot divisor is disclosed as UNVERIFIED wherever it is used', () => {
  // compositeConcurrency divides every composite wall-clock number this module
  // reports, and nobody measured how many cores one FFmpeg composite uses.
  for (const tier of ordered) {
    assert.match(tier.estimateBasis, /UNVERIFIED: slots are floor\(cores\/4\)/, `${tier.id} basis must own the divisor`);
  }
  assert.match(projectRuntime(TIERS.standard, { composites: 3 }).basis, /UNVERIFIED: slots are floor\(cores\/4\)/);
  const evidence = tierEvidence(REFERENCE, selectTier(REFERENCE));
  assert.ok(evidence.unmeasured.some(x => /floor\(cores\/4\)/.test(x)), 'evidence lists the divisor as unmeasured');
  assert.ok(evidence.unmeasured.some(x => /POLICY/.test(x)), 'evidence says the ladder thresholds are policy, not measurements');
});

test('the ladder bands say which are borrowed from hardware-profile and which are policy', async () => {
  const { HARDWARE_PROFILES } = await import('./hardware-profile.mjs');
  // These three bands are not this module's inventions and must not drift.
  assert.deepEqual([TIERS.minimal.minVramGb, TIERS.minimal.minRamGb], [HARDWARE_PROFILES.RENDER_ONLY.minVramGb, HARDWARE_PROFILES.RENDER_ONLY.minRamGb]);
  assert.deepEqual([TIERS.standard.minVramGb, TIERS.standard.minRamGb], [HARDWARE_PROFILES.STANDARD_LOCAL.minVramGb, HARDWARE_PROFILES.STANDARD_LOCAL.minRamGb]);
  assert.deepEqual([TIERS.creator.minVramGb, TIERS.creator.minRamGb], [HARDWARE_PROFILES.CREATOR_LOCAL.minVramGb, HARDWARE_PROFILES.CREATOR_LOCAL.minRamGb]);
  // hardware-profile.mjs sets no core floors at all, so every core minimum on
  // this ladder is ours and has to be labelled as such.
  for (const profile of Object.values(HARDWARE_PROFILES)) assert.equal(profile.minCores, undefined, 'if core floors appear upstream, borrow them instead of inventing');
  for (const tier of ordered) assert.match(tier.estimateBasis, /POLICY/, `${tier.id} must name its policy thresholds`);
});

test('the one-GPU claim is enforced by a real lease, not just declared', async () => {
  // Every tier declares neuralConcurrency 1 and projectRuntime multiplies shots
  // with no divisor. That is only honest if something actually stops a second
  // diffusion job. Exercise the lease this module cites by name.
  const { acquireGpuLease } = await import('./inference-harness.mjs');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'vyrelum-lease-'));
  try {
    const first = await acquireGpuLease('tier-test-first', { root });
    await assert.rejects(() => acquireGpuLease('tier-test-second', { root }), /GPU_LEASE_BUSY/, 'a second concurrent lease must be refused');
    await first();
    const third = await acquireGpuLease('tier-test-third', { root });   // released, so it is free again
    await third();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
