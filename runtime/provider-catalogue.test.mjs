import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, MEASUREMENTS, recommendProviders, planInstall, verifyInstall, catalogueEvidence, getProvider, downloadBytesOf } from './provider-catalogue.mjs';

const GB = 1024 ** 3;
// The machine these numbers were measured on.
const THIS_BOX = { vramGb: 6, ramGb: 15.7 };
const byId = id => PROVIDERS.find(p => p.id === id);
const throws = (fn, code) => assert.throws(fn, error => error.code === code, `expected ${code}`);

test('the catalogue is frozen and every entry carries a licence and a real digest or an explicit UNVERIFIED marker', () => {
  assert.equal(Object.isFrozen(PROVIDERS), true);
  assert.throws(() => { PROVIDERS[0].sizeBytes = 1; }, TypeError);
  for (const p of PROVIDERS) {
    assert.ok(p.license && p.license.trim().length >= 3, `${p.id} has no licence`);
    assert.ok(['RUNTIME_LOCK_FILE', 'ON_DISK_LICENSE', 'UNVERIFIED'].includes(p.licenseBasis), `${p.id} licenceBasis`);
    const pinned = /^[a-f0-9]{64}$/.test(p.sha256 || '');
    assert.ok(pinned || p.hashBasis === 'UNVERIFIED', `${p.id} has neither a real sha256 nor an UNVERIFIED marker`);
    if (pinned) assert.ok(['MEASURED_ON_DISK', 'RUNTIME_LOCK_FILE'].includes(p.hashBasis), `${p.id} pinned hash needs a real basis`);
    assert.ok(['MEASURED_ON_DISK', 'RUNTIME_LOCK_FILE', 'EXTRAPOLATED', 'UNVERIFIED'].includes(p.sizeBasis), `${p.id} sizeBasis`);
    // A number without a measurement basis is exactly the thing this repo bans.
    if (p.sizeBasis === 'UNVERIFIED') assert.equal(p.sizeBytes, null, `${p.id} claims a size it cannot verify`);
    else assert.ok(Number.isSafeInteger(p.sizeBytes) && p.sizeBytes > 0, `${p.id} size`);
    assert.ok(['installed', 'not-installed'].includes(p.installState));
    assert.ok(p.sourceUrl.startsWith('https://'), `${p.id} source url`);
  }
  const ids = PROVIDERS.map(p => p.id);
  for (const required of ['wan22-5b', 'ltxv-2b-distilled', 'acestep-15-base', 'piper-ljspeech', 'whisper-tiny-en', 'rife-ncnn', 'realesrgan-ncnn', 'musetalk', 'chatterbox-turbo', 'stable-audio-open', 'ltxv-13b-distilled']) assert.ok(ids.includes(required), `missing ${required}`);
  assert.equal(new Set(ids).size, ids.length);
});

test('installed sizes and digests match what is actually on this disk', () => {
  // Guards against a later edit quietly replacing a measured number.
  assert.equal(byId('wan22-5b').sizeBytes, 3433116000);
  assert.equal(byId('ltxv-2b-distilled').sizeBytes, 2173891072);
  assert.equal(byId('ltxv-2b-distilled').sha256, 'a0637b06a43fea8d71af2c7bf912c8c8a36d61654966054621f80f2c39e6faca');
  assert.equal(byId('acestep-15-base').sizeBytes, 4787825604);
  assert.equal(MEASUREMENTS['ltxv-2b-distilled'].secondsPerFrame, 2.0);
  assert.equal(MEASUREMENTS['wan22-5b'].peakVramGiB, 5.85);
});

test('planInstall refuses without an explicit approval', () => {
  throws(() => planInstall(['ltxv-13b-distilled'], { freeDiskBytes: 500 * GB }), 'INSTALL_NOT_APPROVED');
  throws(() => planInstall(['ltxv-13b-distilled'], { freeDiskBytes: 500 * GB, approved: 'yes' }), 'INSTALL_NOT_APPROVED');
  throws(() => planInstall(['ltxv-13b-distilled'], { freeDiskBytes: 500 * GB, approved: 1 }), 'INSTALL_NOT_APPROVED');
  throws(() => planInstall(['ltxv-13b-distilled'], { approved: false }), 'INSTALL_NOT_APPROVED');
});

test('planInstall refuses a short disk and names the shortfall including the 5GB headroom', () => {
  const size = downloadBytesOf('ltxv-13b-distilled');
  const free = 8 * GB;
  let error;
  try { planInstall(['ltxv-13b-distilled'], { freeDiskBytes: free, approved: true }); } catch (thrown) { error = thrown; }
  assert.equal(error?.code, 'INSUFFICIENT_DISK');
  assert.match(error.message, /5 GB working headroom/);
  const shortGb = Number(((size + 5 * GB - free) / GB).toFixed(2));
  assert.match(error.message, new RegExp(`Short by ${shortGb} GB`));
  // The same download fits once the headroom is actually available.
  const ok = planInstall(['ltxv-13b-distilled'], { freeDiskBytes: size + 5 * GB, approved: true });
  assert.equal(ok.totalBytes, size);
  assert.equal(ok.requiredBytes, size + 5 * GB);
});

test('planInstall blocks unknown sizes, already-installed entries, and flags unpinned checksums', () => {
  const plan = planInstall(['ltxv-13b-distilled', 'musetalk', 'wan22-5b'], { freeDiskBytes: 100 * GB, approved: true });
  assert.deepEqual(plan.steps.map(s => s.id), ['ltxv-13b-distilled']);
  assert.equal(plan.steps[0].requiresChecksumPin, true);
  assert.equal(plan.steps[0].sizeBasis, 'EXTRAPOLATED');
  assert.deepEqual(plan.blocked.map(b => b.code).sort(), ['ALREADY_INSTALLED', 'DOWNLOAD_SIZE_UNKNOWN']);
  throws(() => planInstall(['not-a-real-model'], { approved: true }), 'PROVIDER_UNKNOWN');
  throws(() => planInstall([], { approved: true }), 'INSTALL_NOTHING_REQUESTED');
  // installState describes this disk only; another machine passes its own set.
  const elsewhere = planInstall(['wan22-5b'], { freeDiskBytes: 100 * GB, approved: true, installed: [] });
  assert.deepEqual(elsewhere.blocked, []);
  assert.equal(elsewhere.steps[0].requiresChecksumPin, false);
  // The plan reserves for the encoder and VAE too, not just the headline file.
  assert.equal(elsewhere.totalBytes, 3433116000 + 4906997728);
  assert.equal(elsewhere.steps[0].weightBytes, byId('wan22-5b').sizeBytes);
});

// --- adversarial: each of these produced a plan before the guard was fixed ---

test('the disk guard cannot be skipped by omitting, blanking or corrupting the reading', () => {
  const attack = free => planInstall(['ltxv-13b-distilled'], { approved: true, freeDiskBytes: free });
  // Omitting it entirely used to hand back a 20 GB download with no check at all.
  throws(() => planInstall(['ltxv-13b-distilled'], { approved: true }), 'FREE_DISK_UNKNOWN');
  // '' and [] coerce to 0, which would have read as a full disk rather than an
  // unmeasured one; only an actual finite number is a disk reading.
  for (const free of [null, undefined, NaN, 'lots', '', {}, [], Infinity, -Infinity, String(500 * GB)]) {
    throws(() => attack(free), 'FREE_DISK_UNKNOWN');
  }
  const need = downloadBytesOf('ltxv-13b-distilled') + 5 * GB;
  assert.equal(planInstall(['ltxv-13b-distilled'], { approved: true, freeDiskBytes: need }).freeDiskBytes, need);
  throws(() => attack(need - 1), 'INSUFFICIENT_DISK');
  throws(() => attack(0), 'INSUFFICIENT_DISK');
  throws(() => attack(-1), 'INSUFFICIENT_DISK');
});

test('a plan reserves for the encoder and VAE a model cannot run without', () => {
  // The measured LTXV set is 2,173,891,072 unet + 3,386,856,640 t5 encoder
  // + 2,493,859,780 VAE. Reserving only the unet under-counts by 5.5 GB, which
  // is more than the whole 5 GB headroom, so "it fits" was a lie by 0.5 GB.
  const unetOnly = byId('ltxv-2b-distilled').sizeBytes;
  assert.equal(downloadBytesOf('ltxv-2b-distilled'), unetOnly + 3386856640 + 2493859780);
  throws(() => planInstall(['ltxv-2b-distilled'], { approved: true, installed: [], freeDiskBytes: unetOnly + 5 * GB }), 'INSUFFICIENT_DISK');
  const plan = planInstall(['ltxv-2b-distilled'], { approved: true, installed: [], freeDiskBytes: downloadBytesOf('ltxv-2b-distilled') + 5 * GB });
  assert.equal(plan.steps[0].companionBytes, 3386856640 + 2493859780);
  // Every plannable entry's companion weight is itself basis-labelled.
  for (const p of PROVIDERS) {
    if (downloadBytesOf(p.id) === null) { assert.equal(p.companionBytes, null); assert.equal(p.companionBasis, 'UNVERIFIED'); continue; }
    assert.ok(['MEASURED_ON_DISK', 'RUNTIME_LOCK_FILE', 'EXTRAPOLATED'].includes(p.companionBasis), `${p.id} companionBasis`);
  }
});

test('an all-blocked plan does not invent a disk problem, and duplicates are not double-counted', () => {
  // Everything requested is already here: nothing downloads, so a full disk is
  // not an error. This used to throw INSUFFICIENT_DISK for 0 GB of downloads.
  const nothing = planInstall(['wan22-5b', 'wan22-5b'], { approved: true, freeDiskBytes: 1 });
  assert.deepEqual(nothing.steps, []);
  assert.equal(nothing.totalBytes, 0);
  assert.deepEqual(nothing.blocked.map(b => b.code), ['ALREADY_INSTALLED']);
  // The same id twice is one download, not two.
  const once = planInstall(['wan22-5b', 'wan22-5b'], { approved: true, installed: [], freeDiskBytes: 100 * GB });
  assert.equal(once.steps.length, 1);
  assert.equal(once.totalBytes, downloadBytesOf('wan22-5b'));
});

test('no unpinned download can ever be accepted, however it is planned', () => {
  // planInstall may hand back an unpinned step, but it must be flagged and
  // verifyInstall must refuse it whatever bytes and digest turn up afterwards.
  const plan = planInstall(['ltxv-13b-distilled'], { approved: true, freeDiskBytes: 100 * GB });
  assert.equal(plan.steps[0].requiresChecksumPin, true);
  for (const attempt of [{ actualBytes: plan.steps[0].weightBytes, actualSha256: 'a'.repeat(64) }, { actualBytes: 0, actualSha256: '' }, {}]) {
    const result = verifyInstall('ltxv-13b-distilled', attempt);
    assert.equal(result.ok, false, 'an unpinned provider must never verify');
    assert.ok(result.mismatches.some(m => m.code === 'EXPECTED_SHA256_NOT_PINNED'));
  }
  // And every step that is NOT flagged really does carry a usable digest.
  const pinned = planInstall(['wan22-5b'], { approved: true, installed: [], freeDiskBytes: 100 * GB }).steps[0];
  assert.equal(pinned.requiresChecksumPin, false);
  assert.match(pinned.sha256, /^[a-f0-9]{64}$/);
});

test('every threshold that decides what gets offered carries its provenance', () => {
  for (const p of PROVIDERS) {
    assert.ok(['MEASURED_RUN', 'EXTRAPOLATED', 'UNVERIFIED'].includes(p.requirementBasis), `${p.id} requirementBasis`);
    assert.equal(Number.isFinite(p.minVramGb) && p.minVramGb >= 0, true, `${p.id} minVramGb`);
    assert.equal(Number.isFinite(p.minRamGb) && p.minRamGb >= 0, true, `${p.id} minRamGb`);
    // minDiskGb was an unused, unlabelled number and it was wrong: it claimed
    // 6 GB for an LTXV set that measures 7.5 GiB. downloadBytesOf replaced it.
    assert.equal('minDiskGb' in p, false, `${p.id} still carries the unbacked minDiskGb`);
  }
  // Only the two models with a recorded run may claim a measured requirement.
  assert.deepEqual(PROVIDERS.filter(p => p.requirementBasis === 'MEASURED_RUN').map(p => p.id), ['wan22-5b', 'ltxv-2b-distilled']);
  for (const p of PROVIDERS) if (p.requirementBasis === 'MEASURED_RUN') assert.ok(MEASUREMENTS[p.measurementKey], `${p.id} claims MEASURED_RUN with no run`);
  // An unmeasured requirement must say so wherever it is shown to a user.
  const { recommended } = recommendProviders({ vramGb: 24, ramGb: 64 }, null, { installed: [] });
  for (const r of recommended) {
    const basis = getProvider(r.id).requirementBasis;
    const entry = getProvider(r.id);
    if (basis === 'MEASURED_RUN') assert.doesNotMatch(r.reason, /not measured here/);
    else assert.match(r.reason, new RegExp(`Those floors \\(${entry.minVramGb} GB VRAM, ${entry.minRamGb} GB RAM\\) are ${basis}, not measured here`));
  }
});

test('a nonsense hardware reading is treated as no reading, not as negative silicon', () => {
  for (const bad of [-5, NaN, 'plenty', null, undefined, Infinity]) {
    const { machine, recommended } = recommendProviders({ vramGb: bad, ramGb: 15.7 }, null, { installed: [] });
    assert.equal(machine.vramGb, 0, `vramGb ${String(bad)} must clamp to 0`);
    // CPU providers survive; nothing claims the machine has negative VRAM.
    assert.ok(recommended.some(r => r.id === 'piper-ljspeech'));
    for (const r of recommended) assert.doesNotMatch(r.reason, /-\d/);
  }
});

test('recommendProviders never recommends something whose minVram exceeds the machine', () => {
  for (const machine of [THIS_BOX, { vramGb: 0, ramGb: 8 }, { vramGb: 4, ramGb: 15.7 }, { vramGb: 24, ramGb: 64 }]) {
    const { recommended, unsupported } = recommendProviders(machine, null, { installed: [] });
    for (const r of recommended) assert.ok(r.minVramGb <= machine.vramGb, `${r.id} needs ${r.minVramGb} GB on a ${machine.vramGb} GB machine`);
    const seen = new Set([...recommended, ...unsupported].map(x => x.id));
    assert.equal(seen.size, PROVIDERS.length, 'every provider must be classified');
  }
  const here = recommendProviders(THIS_BOX, null, { installed: [] });
  const big = here.unsupported.find(u => u.id === 'ltxv-13b-distilled');
  assert.equal(big.code, 'INSUFFICIENT_VRAM');
  assert.match(big.reason, /16 GB VRAM; this machine has 6 GB/);
});

test('an installed provider is never recommended again', () => {
  const installed = PROVIDERS.filter(p => p.installState === 'installed').map(p => p.id);
  const result = recommendProviders(THIS_BOX, null, { installed });
  assert.deepEqual(result.alreadyInstalled.map(a => a.id).sort(), [...installed].sort());
  for (const id of installed) {
    assert.equal(result.recommended.some(r => r.id === id), false, `${id} recommended while installed`);
    assert.equal(result.unsupported.some(u => u.id === id), false, `${id} reported unsupported while installed`);
  }
  // Default installed set comes from the catalogue itself.
  assert.deepEqual(recommendProviders(THIS_BOX).alreadyInstalled.map(a => a.id).sort(), [...installed].sort());
});

test('reasons are specific, cite the measured runs, and rank by impact per byte', () => {
  const { recommended } = recommendProviders(THIS_BOX, null, { installed: ['wan22-5b'] });
  const ltx = recommended.find(r => r.id === 'ltxv-2b-distilled');
  assert.match(ltx.reason, /2 s\/frame at 768x512/);
  // 13.0 / 2.0, and both resolutions named because the runs were not like-for-like.
  assert.match(ltx.reason, /6\.5x fewer seconds per frame/);
  assert.match(ltx.reason, /13 s\/frame at 1024x576/);
  assert.match(ltx.reason, /RTX 3050/);
  assert.match(ltx.reason, /Needs 6 GB VRAM, you have 6/);
  const ordered = recommended.map(r => r.impactPerGb);
  assert.deepEqual(ordered, [...ordered].sort((a, b) => b - a));
  // No speed claim may appear for a provider that was never benchmarked.
  for (const r of recommended) if (!MEASUREMENTS[r.id]) assert.doesNotMatch(r.reason, /s\/frame at \d+x\d+ \(/);
});

test('a tier that blocks a route rejects providers on that route even when the silicon fits', () => {
  const rendered = recommendProviders({ vramGb: 0, ramGb: 15.7 }, 'RENDER_ONLY', { installed: [] });
  assert.equal(rendered.recommended.some(r => r.kind === 'video'), false);
  assert.equal(rendered.unsupported.find(u => u.id === 'ltxv-2b-distilled').code, 'INSUFFICIENT_VRAM');
  // Captions and editing still work with no GPU, which is the point of the tier.
  assert.ok(rendered.recommended.some(r => r.id === 'whisper-tiny-en'));
  // acestep has no recorded run here, so the tier's route block stands.
  const standard = recommendProviders(THIS_BOX, 'STANDARD_LOCAL', { installed: [] });
  assert.equal(standard.unsupported.find(u => u.id === 'acestep-15-base').code, 'INSUFFICIENT_HARDWARE_PROFILE');
  // Both video models WERE measured running on this 6GB STANDARD_LOCAL box, so
  // the recorded run beats the tier heuristic rather than the other way round.
  const ltx = standard.recommended.find(r => r.id === 'ltxv-2b-distilled');
  assert.equal(ltx.tierOverridden, true);
  assert.match(ltx.reason, /overridden here by a recorded run/);
  throws(() => recommendProviders(THIS_BOX, 'GAMING_RIG'), 'HARDWARE_TIER_UNKNOWN');
});

test('a CPU-only provider is not gated by the GPU tier', () => {
  // Piper is 0 VRAM and installed and working here; the tier blocks "narration"
  // for GPU narration models, which must not veto a 114 MB CPU voice.
  const fresh = recommendProviders(THIS_BOX, 'STANDARD_LOCAL', { installed: [] });
  assert.ok(fresh.recommended.some(r => r.id === 'piper-ljspeech'), 'CPU TTS must survive the tier');
  assert.ok(fresh.recommended.some(r => r.id === 'whisper-tiny-en'));
  // A TTS model that does need the GPU is still gated by the same tier.
  assert.equal(fresh.unsupported.find(u => u.id === 'chatterbox-turbo').code, 'INSUFFICIENT_HARDWARE_PROFILE');
  // Even with no GPU at all, the CPU providers remain installable.
  const headless = recommendProviders({ vramGb: 0, ramGb: 15.7 }, null, { installed: [] });
  assert.equal(headless.tier, 'RENDER_ONLY');
  assert.ok(headless.recommended.some(r => r.id === 'piper-ljspeech'));
});

test('nothing is recommended that planInstall would then refuse', () => {
  for (const machine of [THIS_BOX, { vramGb: 24, ramGb: 64 }, { vramGb: 0, ramGb: 8 }]) {
    const { recommended } = recommendProviders(machine, null, { installed: [] });
    for (const r of recommended) {
      const plan = planInstall([r.id], { freeDiskBytes: 500 * GB, approved: true, installed: [] });
      assert.deepEqual(plan.blocked, [], `${r.id} was recommended but planInstall blocked it`);
      assert.equal(plan.steps.length, 1);
    }
  }
  const here = recommendProviders(THIS_BOX, null, { installed: [] });
  assert.equal(here.unsupported.find(u => u.id === 'stable-audio-open').code, 'DOWNLOAD_SIZE_UNKNOWN');
});

test('verifyInstall catches a size mismatch and a hash mismatch', () => {
  const wan = byId('wan22-5b');
  assert.deepEqual(verifyInstall('wan22-5b', { actualBytes: wan.sizeBytes, actualSha256: wan.sha256 }), { ok: true, id: 'wan22-5b', mismatches: [] });
  assert.equal(verifyInstall(wan, { actualBytes: wan.sizeBytes, actualSha256: wan.sha256.toUpperCase() }).ok, true);

  const short = verifyInstall('wan22-5b', { actualBytes: wan.sizeBytes - 1, actualSha256: wan.sha256 });
  assert.equal(short.ok, false);
  assert.deepEqual(short.mismatches.map(m => m.code), ['SIZE_MISMATCH']);
  assert.equal(short.mismatches[0].expected, wan.sizeBytes);

  const forged = verifyInstall('wan22-5b', { actualBytes: wan.sizeBytes, actualSha256: 'b'.repeat(64) });
  assert.equal(forged.ok, false);
  assert.deepEqual(forged.mismatches.map(m => m.code), ['SHA256_MISMATCH']);

  const both = verifyInstall('wan22-5b', { actualBytes: 10, actualSha256: 'c'.repeat(64) });
  assert.deepEqual(both.mismatches.map(m => m.field).sort(), ['bytes', 'sha256']);

  // A provider with nothing pinned can never verify, whatever bytes arrive.
  const unpinned = verifyInstall('musetalk', { actualBytes: 123, actualSha256: 'd'.repeat(64) });
  assert.equal(unpinned.ok, false);
  assert.deepEqual(unpinned.mismatches.map(m => m.code).sort(), ['EXPECTED_SHA256_NOT_PINNED', 'EXPECTED_SIZE_NOT_PINNED']);
  throws(() => verifyInstall('nope', {}), 'PROVIDER_UNKNOWN');
  assert.equal(getProvider(byId('rife-ncnn')).id, 'rife-ncnn');
});

test('catalogueEvidence reports schemaVersion 1 with the basis of every claim', () => {
  const plan = planInstall(['ltxv-13b-distilled'], { freeDiskBytes: 100 * GB, approved: true });
  const evidence = catalogueEvidence({ hardware: THIS_BOX, installed: ['wan22-5b'], plan, now: 0 });
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.recordedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(evidence.tier, 'STANDARD_LOCAL');
  assert.equal(evidence.catalogue.length, PROVIDERS.length);
  for (const row of evidence.catalogue) assert.ok(row.licenseBasis && row.sizeBasis && row.hashBasis);
  assert.deepEqual(evidence.alreadyInstalled, ['wan22-5b']);
  assert.equal(evidence.plan.steps[0].requiresChecksumPin, true);
  assert.ok(evidence.unmeasured.length >= 3);
  assert.equal(catalogueEvidence({ hardware: THIS_BOX }).plan, null);
});
