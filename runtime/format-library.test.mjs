import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORMATS,
  FORMAT_IDS,
  PLATFORM_SPECS,
  HOOK_PATTERNS,
  CAMERA_MOVES,
  DURATION_EVIDENCE,
  validateFormat,
  validateAllFormats,
  buildProductionPlan,
  expandVariants,
  countVariants,
  inferNiche,
  lintPlan,
  assertNotBulkPublishable,
  retimeFormat,
  evidenceOptimalSeconds
} from './format-library.mjs';

test('every shipped format passes structural validation', () => {
  const ids = validateAllFormats();
  assert.equal(ids.length, FORMAT_IDS.length);
  assert.ok(ids.length >= 30, `expected a substantial library, got ${ids.length}`);
});

test('beats tile the full duration with no gap or overlap', () => {
  for (const id of FORMAT_IDS) {
    const format = FORMATS[id];
    let cursor = 0;
    for (const beat of format.beats) {
      assert.ok(Math.abs(beat.at - cursor) < 1e-6, `${id}: beat starts at ${beat.at}, expected ${cursor}`);
      cursor += beat.dur;
    }
    assert.ok(Math.abs(cursor - format.seconds) < 1e-6, `${id}: beats sum to ${cursor}, declared ${format.seconds}`);
  }
});

test('a gap between beats is rejected', () => {
  assert.throws(() => validateFormat('synthetic-gap', {
    label: 'Gap', niche: 'general', platforms: ['tiktok'], seconds: 10,
    hook: 'cold-question', captions: 'none', audio: 'music-drive', grade: 'neutral', pacing: 'calm',
    beats: [
      { at: 0, dur: 4, role: 'a', shot: 'hero', motion: 'hold', route: 'composite' },
      { at: 5, dur: 5, role: 'b', shot: 'hero', motion: 'hold', route: 'composite' }
    ]
  }), /must tile/);
});

test('a duration outside the platform envelope is rejected', () => {
  assert.throws(() => validateFormat('synthetic-too-long', {
    label: 'Too long', niche: 'general', platforms: ['instagram-reels'], seconds: 5000,
    hook: 'cold-question', captions: 'none', audio: 'music-drive', grade: 'neutral', pacing: 'calm',
    beats: [{ at: 0, dur: 5000, role: 'a', shot: 'hero', motion: 'hold', route: 'composite' }]
  }), /exceeds/);
});

test('an opening beat shorter than the hook hold is rejected', () => {
  assert.throws(() => validateFormat('synthetic-short-hook', {
    label: 'Short hook', niche: 'general', platforms: ['tiktok'], seconds: 10,
    hook: 'threat-reveal', captions: 'none', audio: 'music-drive', grade: 'neutral', pacing: 'calm',
    beats: [
      { at: 0, dur: 0.2, role: 'a', shot: 'hero', motion: 'hold', route: 'composite' },
      { at: 0.2, dur: 9.8, role: 'b', shot: 'hero', motion: 'hold', route: 'composite' }
    ]
  }), /shorter than hook hold/);
});

test('an unknown camera move is rejected', () => {
  assert.throws(() => validateFormat('synthetic-camera', {
    label: 'Bad camera', niche: 'general', platforms: ['tiktok'], seconds: 5,
    hook: 'loop-seam', captions: 'none', audio: 'music-drive', grade: 'neutral', pacing: 'calm',
    beats: [{ at: 0, dur: 5, role: 'a', shot: 'hero', motion: 'barrel-roll', route: 'composite' }]
  }), /unknown camera move/);
});

test('a plan with unresolved shot roles is not renderable', () => {
  const plan = buildProductionPlan({ formatId: 'cold-open-question', platform: 'tiktok', brief: 'test' });
  assert.equal(plan.renderable, false);
  assert.ok(plan.missingShotRoles.length > 0);
  assert.ok(plan.timeline.every(beat => beat.assetId === null));
});

test('supplying every shot role makes a plan renderable', () => {
  const format = FORMATS['cold-open-question'];
  const shots = {};
  for (const beat of format.beats) shots[beat.shot] = { assetId: `asset-${beat.shot}` };
  const plan = buildProductionPlan({ formatId: 'cold-open-question', platform: 'tiktok', shots });
  assert.equal(plan.renderable, true);
  assert.equal(plan.missingShotRoles.length, 0);
});

test('a plan carries the platform canvas and safe area', () => {
  const plan = buildProductionPlan({ formatId: 'product-proof-15', platform: 'instagram-reels' });
  assert.deepEqual(plan.canvas, PLATFORM_SPECS['instagram-reels'].canvas);
  assert.equal(plan.safeAreaConfidence, 'community-measured');
  assert.ok(plan.safeArea.bottom > 0);
});

test('requesting a platform the format does not target throws', () => {
  assert.throws(() => buildProductionPlan({ formatId: 'anime-short-film', platform: 'tiktok' }), /does not target/);
});

test('expandVariants is deterministic and respects its limit', () => {
  const a = expandVariants({ brief: 'same', limit: 20 });
  const b = expandVariants({ brief: 'same', limit: 20 });
  assert.equal(a.length, 20);
  assert.deepEqual(a.map(v => `${v.formatId}:${v.platform}`), b.map(v => `${v.formatId}:${v.platform}`));
});

test('the library emits at least 100 distinct format-platform variants', () => {
  const variants = expandVariants({ brief: 'x', limit: Number.MAX_SAFE_INTEGER });
  const keys = new Set(variants.map(v => `${v.formatId}:${v.platform}`));
  assert.equal(keys.size, variants.length, 'variants must be distinct');
  assert.ok(variants.length >= 100, `expected 100+ variants, got ${variants.length}`);
  assert.equal(countVariants(), variants.length);
});

test('niche filtering narrows the variant set', () => {
  const anime = expandVariants({ niches: ['anime'], limit: Number.MAX_SAFE_INTEGER });
  assert.ok(anime.length > 0);
  assert.ok(anime.every(v => v.niche === 'anime'));
  assert.ok(anime.length < countVariants());
});

test('niche inference falls back to general', () => {
  assert.equal(inferNiche('a cel-shaded anime rooftop scene'), 'anime');
  assert.equal(inferNiche('unboxing our new product'), 'product');
  assert.equal(inferNiche(''), 'general');
  assert.equal(inferNiche(null), 'general');
});

test('the linter flags a duration in a platform weak band', () => {
  const plan = buildProductionPlan({ formatId: 'anime-action-beat', platform: 'tiktok' });
  const warnings = lintPlan(plan);
  const band = warnings.find(w => w.code === 'WEAK_DURATION_BAND');
  assert.ok(band, 'expected a weak-duration warning for a 10s TikTok plan');
  assert.equal(band.severity, 'evidence');
  assert.equal(band.confidence, 'secondary-correlational');
  assert.ok(band.source.startsWith('http'));
});

test('duration evidence records its own sample and confidence', () => {
  for (const [platform, evidence] of Object.entries(DURATION_EVIDENCE)) {
    assert.ok(PLATFORM_SPECS[platform], `${platform} must be a known platform`);
    assert.ok(evidence.source.startsWith('http') || evidence.source.length > 10);
    assert.ok(evidence.confidence.startsWith('secondary'), 'duration data is correlational, never platform-published');
  }
});

test('platform penalties and safe areas declare their provenance', () => {
  for (const [id, spec] of Object.entries(PLATFORM_SPECS)) {
    assert.ok(spec.safeAreaConfidence, `${id} must state safe-area confidence`);
    assert.ok(Array.isArray(spec.penalties), `${id} must list penalties`);
    if (spec.penalties.length > 0) assert.ok(spec.penaltySource || id === 'youtube-shorts' || id === 'youtube-long');
  }
});

test('hook patterns are structural rules, not copy', () => {
  for (const [id, hook] of Object.entries(HOOK_PATTERNS)) {
    assert.ok(hook.holdSeconds > 0, `${id} needs a hold`);
    assert.ok(hook.rule.length > 30, `${id} rule must describe on-screen structure`);
    assert.ok(!hook.rule.includes('{brief}'), `${id} must not be a fill-in template`);
  }
});

test('camera moves are deterministic numeric instructions', () => {
  for (const [id, move] of Object.entries(CAMERA_MOVES)) {
    assert.equal(typeof move.zoom, 'number', `${id} zoom`);
    assert.equal(typeof move.panX, 'number', `${id} panX`);
    assert.equal(typeof move.panY, 'number', `${id} panY`);
  }
});

test('retiming preserves beat tiling and hook hold', () => {
  const retimed = retimeFormat('cold-open-question', 53);
  assert.equal(retimed.seconds, 53);
  assert.equal(retimed.retimedFrom, 'cold-open-question');
  let cursor = 0;
  for (const beat of retimed.beats) {
    assert.ok(Math.abs(beat.at - cursor) < 1e-6, `beat at ${beat.at}, expected ${cursor}`);
    cursor += beat.dur;
  }
  assert.ok(Math.abs(cursor - 53) < 1e-6, `beats sum to ${cursor}, expected 53`);
  assert.ok(retimed.beats[0].dur >= HOOK_PATTERNS[retimed.hook].holdSeconds);
});

test('retiming preserves beat count, roles and routes', () => {
  const original = FORMATS['product-proof-15'];
  const retimed = retimeFormat('product-proof-15', 50);
  assert.equal(retimed.beats.length, original.beats.length);
  assert.deepEqual(retimed.beats.map(b => b.role), original.beats.map(b => b.role));
  assert.deepEqual(retimed.beats.map(b => b.route), original.beats.map(b => b.route));
});

test('retiming below the hook hold is refused', () => {
  assert.throws(() => retimeFormat('micro-horror-turn', 0.5), /hook needs/);
});

test('evidence-optimal duration comes from the recorded band', () => {
  assert.equal(evidenceOptimalSeconds('instagram-reels'), 53);
  assert.equal(evidenceOptimalSeconds('youtube-long'), null);
});

test('evidence retimes add variants that clear the weak-duration band', () => {
  const base = expandVariants({ brief: 'x', limit: Number.MAX_SAFE_INTEGER });
  const extended = expandVariants({ brief: 'x', limit: Number.MAX_SAFE_INTEGER, includeEvidenceRetimes: true });
  assert.ok(extended.length > base.length, 'retimes must add variants');
  const retimes = extended.filter(v => v.variantOf);
  assert.ok(retimes.length > 0);
  for (const plan of retimes) {
    const weak = lintPlan(plan).filter(w => w.code === 'WEAK_DURATION_BAND');
    assert.equal(weak.length, 0, `${plan.formatId} @ ${plan.platform} ${plan.durationSeconds}s still in a weak band`);
    assert.ok(plan.variantReason.includes('best observed band'));
  }
});

test('a batch of variants is never reported as publish-ready', () => {
  const variants = expandVariants({ brief: 'x', limit: 30 });
  const gate = assertNotBulkPublishable(variants);
  assert.equal(gate.publishReady, false);
  assert.equal(gate.planCount, 30);
  assert.ok(gate.policy.length >= 2);
});
