import test from 'node:test';
import assert from 'node:assert/strict';
import { AESTHETIC_VOCABULARY, FAILURE_TRIGGERS, NEGATIVE_PROMPT, NEGATIVE_TERMS, RISK_WEIGHTS, SAMPLER_BOUNDS, SHOT_ROLES, analyseBrief, buildWanPrompt, recommendSampler } from './prompt-logic.mjs';
import { wanWorkflow } from './neural-production.mjs';

// One row per trigger. `hits` must match, `misses` must not - the false
// positives are the point, since a warning nobody believes is worse than none.
const FIXTURES = [
  { id: 'readable-text', hits: ['a sign that reads OPEN', 'a lit shopfront across the road', 'legible text on the box'], misses: ['the design of her jacket', 'her expression is easy to read', 'a neon-lit alley'] },
  { id: 'close-up-hands', hits: ['close-up on her hands', 'hands typing on a keyboard', 'a firm handshake'], misses: ['she carries a handbag', 'a close-up of her face', 'hands in her coat pockets'] },
  { id: 'crowd', hits: ['a crowded platform', 'a busy rain-soaked night market', 'distant people move naturally'], misses: ['a quiet street at dawn', 'two friends at a table', 'an empty market at closing time'] },
  // 'waves crash' is the regression: ambient water is exactly the motion this
  // module recommends ADDING, so warning about it was advice pointing backwards.
  { id: 'fast-complex-action', hits: ['he sprints toward the door', 'a fight breaks out', 'the glass shatters', 'a car crashes into the barrier'], misses: ['rain runs down the window', 'firelight dancing on the wall', 'she runs a hand along the rail', 'waves crash against the harbour wall', 'the surf crashes on the rocks', 'thunder crashes overhead'] },
  { id: 'multi-beat-action', hits: ['she opens the door and then steps outside', 'he looks up, then walks away'], misses: ['she hears a sound and looks over her shoulder', 'a black and white portrait'] },
  { id: 'scene-cut', hits: ['cut to the wide shot', 'a montage of the city'], misses: ['she cuts a lemon in half', 'the cutting light of a bare bulb'] },
  { id: 'lip-sync-dialogue', hits: ['she says, "we should go"', 'lip-synced to the chorus', 'he recites the oath'], misses: ['she says nothing at all', 'a quiet conversation implied by posture'] },
  { id: 'named-real-person', hits: ['a celebrity steps out of the car', 'a deepfake of a news anchor'], misses: ['a woman in her thirties', 'a famous landmark behind her'] },
  { id: 'extreme-close-up', hits: ['extreme close-up of the iris', 'a macro shot of the ring'], misses: ['a medium close-up of her face', 'a wide shot of the yard'] },
  { id: 'distant-small-face', hits: ['tiny figures on the bridge', 'an aerial shot of the valley'], misses: ['market stalls in the middle distance', 'a small dog on the step'] },
  { id: 'walking-locomotion', hits: ['he walks toward the gate', 'she wanders the aisles'], misses: ['the boardwalk at night', 'a walking stick leans on the wall'] },
  { id: 'camera-relative-facing', hits: ['she turns to face the camera', 'a front-facing portrait'], misses: ['she faces the window', 'the camera holds still'] },
  { id: 'open-sky-exposure', hits: ['a wide sky over the plain', 'late sunset light'], misses: ['the city skyline at dusk', 'a lamp-lit interior'] },
  { id: 'mood-prose', hits: ['an atmospheric shot full of tension', 'it evokes a lost summer'], misses: ['a cinematic portrait, shallow depth of field', 'cold blue light on wet stone'] },
  { id: 'negation-in-prompt', hits: ['No text or watermark.', 'without any distortion'], misses: ['she avoids the puddle', 'nothing in her hands'] },
  { id: 'explicit-stillness', hits: ['she stands still under the awning', 'a static shot of the doorway'], misses: ['her jacket is still wet from the rain', 'the room is quiet'] },
];

// Briefs that must fire nothing at all. If a change makes one of these warn,
// the regex got greedy.
const INNOCUOUS = [
  'A woman in a charcoal rain jacket stands under a stall lamp, wet hair, neon reflections behind her.',
  'A ceramic mug on a wooden table, steam rising, warm practical light.',
  'A tabby cat asleep on a windowsill, dust drifting in the light.',
];

test('every trigger matches its intended phrasing', () => {
  for (const fixture of FIXTURES) {
    const trigger = FAILURE_TRIGGERS.find(t => t.id === fixture.id);
    assert.ok(trigger, `no trigger named ${fixture.id}`);
    for (const hit of fixture.hits) assert.ok(trigger.pattern.test(hit), `${fixture.id} missed: ${hit}`);
  }
});

test('no trigger fires on innocuous phrasing', () => {
  for (const fixture of FIXTURES) {
    const trigger = FAILURE_TRIGGERS.find(t => t.id === fixture.id);
    for (const miss of fixture.misses) assert.equal(trigger.pattern.test(miss), false, `${fixture.id} false positive: ${miss}`);
  }
  for (const brief of INNOCUOUS) {
    const fired = analyseBrief(brief).triggers.map(t => `${t.id}:${t.matched}`);
    assert.deepEqual(fired, [], `false positives on "${brief}": ${fired.join(', ')}`);
  }
});

test('the fixture table covers every shipped trigger and every trigger is complete', () => {
  assert.deepEqual(FAILURE_TRIGGERS.map(t => t.id).sort(), FIXTURES.map(f => f.id).sort());
  assert.equal(new Set(FAILURE_TRIGGERS.map(t => t.id)).size, FAILURE_TRIGGERS.length);
  for (const t of FAILURE_TRIGGERS) {
    assert.ok(t.pattern instanceof RegExp && !t.pattern.global, `${t.id} pattern must be a non-global RegExp`);
    assert.ok(['high', 'medium'].includes(t.risk));
    assert.ok(t.why.length > 20 && t.reframe.length > 20, `${t.id} needs a real why and reframe`);
    assert.ok(Object.isFrozen(t));
  }
  assert.ok(Object.isFrozen(FAILURE_TRIGGERS));
});

test('risk score stays in 0..1 and dynamic degree reads the motion in the brief', () => {
  assert.equal(analyseBrief(INNOCUOUS[1]).riskScore, 0);
  const loaded = analyseBrief('Extreme close-up on her hands typing, a crowded platform behind her, a sign that reads DEPARTURES, then he sprints toward the door and we cut to the wide shot.');
  assert.equal(loaded.riskScore, 1);
  assert.ok(loaded.triggers.length >= 5);
  for (const brief of [...INNOCUOUS, ...FIXTURES.flatMap(f => [...f.hits, ...f.misses])]) {
    const { riskScore, dynamicDegree } = analyseBrief(brief);
    assert.ok(riskScore >= 0 && riskScore <= 1, `${brief} scored ${riskScore}`);
    assert.ok(['static', 'moderate', 'high'].includes(dynamicDegree));
  }
  assert.equal(analyseBrief('A brass key on black velvet, motionless.').dynamicDegree, 'static');
  assert.equal(analyseBrief('He sprints toward the door as the glass shatters.').dynamicDegree, 'high');
  assert.equal(analyseBrief('She turns her head, rain falling.').dynamicDegree, 'moderate');
  assert.throws(() => analyseBrief('   '), e => e.code === 'BRIEF_REQUIRED');
});

test('the risk score is the stated provisional shape, not an unexplained constant', () => {
  // riskScore is explicitly NOT a measured probability. The module makes exactly
  // two claims about it, and this pins both so the weights cannot drift back to
  // plausible-looking magic numbers.
  assert.equal(Number((RISK_WEIGHTS.high * 3).toFixed(3)), 1, 'three high triggers must reach the cap');
  assert.equal(Number((RISK_WEIGHTS.medium * 3).toFixed(6)), Number(RISK_WEIGHTS.high.toFixed(6)), 'a medium is a third of a high');
  const one = analyseBrief('A sign that reads OPEN.');
  const two = analyseBrief('A sign that reads OPEN, close-up on her hands.');
  const three = analyseBrief('A sign that reads OPEN, close-up on her hands, a crowded platform.');
  assert.deepEqual([one, two, three].map(a => a.triggers.filter(t => t.risk === 'high').length), [1, 2, 3]);
  assert.deepEqual([one, two, three].map(a => a.riskScore), [0.333, 0.667, 1]);
  // Saturation is real: past three highs the score stops discriminating, which is
  // a documented property of the cap, not a bug to be papered over.
  const six = analyseBrief('A sign that reads OPEN, close-up on her hands, a crowded platform, he sprints away, we cut to the wide shot, a celebrity waves.');
  assert.ok(six.triggers.filter(t => t.risk === 'high').length > 3);
  assert.equal(six.riskScore, 1);
});

test('the built prompt keeps the brief verbatim and adds structure around it', () => {
  const brief = 'A woman in a charcoal rain jacket stands under a stall lamp, wet hair, neon reflections behind her';
  const built = buildWanPrompt({ brief, shotRole: 'hero', camera: 'slow push in' });
  assert.ok(built.prompt.includes(brief), built.prompt);
  assert.deepEqual(built.structure.map(s => s.id), ['tags', 'subject', 'camera', 'light']);
  assert.equal(built.structure[0].text.split(',').length, 4, 'aesthetic tags cap at 4');
  assert.ok(built.applied.includes('tags.cap-4'));
  assert.ok(built.applied.includes('structure.repo-sys-order'));
  assert.ok(/push in/.test(built.prompt));
  // Exact vendor tokens, not near-misses: "Practical light" is not in the closed list.
  assert.ok(built.structure[0].text.includes('Night time'), built.structure[0].text);
  assert.ok(built.structure[0].text.includes('Practical lighting'), built.structure[0].text);
  assert.equal(built.negative, NEGATIVE_PROMPT);
  assert.deepEqual(built.warnings, []);
});

test('every emitted aesthetic tag is a member of the vendor closed vocabulary', () => {
  const vocab = new Set(Object.values(AESTHETIC_VOCABULARY).flat());
  assert.equal(vocab.size, 36, 'the transcribed vocabulary is 36 terms');
  // Briefs chosen to reach every LIGHT_PRESET plus the default, across every role.
  const briefs = ['A keeper checks a lamp at night.', 'A hearth burns in a stone room.', 'A field at dawn, first light.', 'Rain on an empty street.', 'A courier waits by a wall.'];
  const emitted = new Set();
  for (const brief of briefs) {
    for (const shotRole of Object.keys(SHOT_ROLES)) {
      for (const camera of [undefined, 'push in']) {
        const tags = buildWanPrompt({ brief, shotRole, camera }).structure.find(s => s.id === 'tags');
        if (tags) for (const tag of tags.text.replace(/\.$/, '').split(', ')) emitted.add(tag);
      }
    }
  }
  assert.ok(emitted.size >= 10, `only ${emitted.size} distinct tags exercised`);
  const strays = [...emitted].filter(tag => !vocab.has(tag)).sort();
  assert.deepEqual(strays, [], `tags outside the closed vocabulary: ${strays.join(', ')}`);
  // Every shot role's own constants must be members too, including the ones the
  // 4-tag cap can hide.
  for (const [role, spec] of Object.entries(SHOT_ROLES)) {
    assert.ok(AESTHETIC_VOCABULARY.shotSize.includes(spec.shotSize), `${role} shotSize ${spec.shotSize}`);
    assert.ok(AESTHETIC_VOCABULARY.composition.includes(spec.composition), `${role} composition ${spec.composition}`);
    if (spec.shootingAngle) assert.ok(AESTHETIC_VOCABULARY.shootingAngle.includes(spec.shootingAngle), `${role} angle ${spec.shootingAngle}`);
  }
});

test('style leads, and a non-photoreal style drops the cinematic tag block', () => {
  const built = buildWanPrompt({ brief: 'A courier crouches beside a rusted scooter.', shotRole: 'hero', style: '2D anime illustration' });
  assert.equal(built.structure[0].id, 'style');
  assert.equal(built.structure.find(s => s.id === 'tags'), undefined);
  assert.ok(built.applied.includes('style.non-photoreal-drops-tags'));
  // No motion cue in the brief, so the static rule adds ambient motion.
  assert.ok(built.structure.some(s => s.id === 'ambient'));
  const photoreal = buildWanPrompt({ brief: 'A courier crouches beside a rusted scooter as rain falls.', style: 'photoreal 35mm' });
  assert.deepEqual(photoreal.structure.map(s => s.id), ['style', 'tags', 'subject', 'light']);
});

test('a stated camera move drops the competing shooting-angle tag', () => {
  const withMove = buildWanPrompt({ brief: 'A dock worker leans on a rail.', shotRole: 'reaction', camera: 'slow push in' });
  assert.ok(withMove.applied.includes('camera.drop-shooting-angle'));
  assert.ok(!withMove.structure[0].text.includes('Over-the-shoulder'));
  const withoutMove = buildWanPrompt({ brief: 'A dock worker leans on a rail.', shotRole: 'reaction' });
  assert.ok(withoutMove.structure[0].text.includes('Over-the-shoulder'));
  const odd = buildWanPrompt({ brief: 'A dock worker leans on a rail.', camera: 'whip zoom through the keyhole' });
  assert.ok(odd.warnings.some(w => w.code === 'CAMERA_VOCABULARY_UNKNOWN'));
  assert.ok(odd.prompt.includes('whip zoom through the keyhole'), 'an unknown move is warned about, not deleted');
});

test('a high-risk brief produces warnings and reframes, never a silent edit', () => {
  const brief = 'Extreme close-up on her hands as she types, a crowded platform behind her, a sign that reads DEPARTURES.';
  const built = buildWanPrompt({ brief, shotRole: 'detail' });
  assert.ok(built.prompt.includes(brief), 'brief survives verbatim');
  const high = built.warnings.filter(w => w.code === 'PROMPT_HIGH_RISK');
  assert.ok(high.length >= 2, JSON.stringify(built.warnings));
  for (const w of built.warnings) {
    assert.ok(w.suggestion.length > 20, `${w.code} has no usable suggestion`);
    assert.ok(w.matched && brief.toLowerCase().includes(String(w.matched).toLowerCase()));
  }
  assert.deepEqual(high.map(w => w.triggerId).sort(), ['close-up-hands', 'crowd', 'readable-text']);
  // The reframes are offered, not applied: none of the offending words are gone.
  for (const word of ['Extreme close-up', 'hands', 'crowded', 'reads DEPARTURES']) assert.ok(built.prompt.includes(word));
});

test('a still brief gets ambient motion appended rather than being left static', () => {
  const built = buildWanPrompt({ brief: 'A brass key on black velvet, motionless.' });
  assert.ok(built.applied.includes('ambient.injected-for-static'));
  const ambient = built.structure.find(s => s.id === 'ambient');
  assert.ok(ambient && ambient.text.length > 20);
  assert.ok(built.prompt.includes('motionless'), 'the user still gets the stillness they asked for');
  const rainy = buildWanPrompt({ brief: 'A parked bicycle in the rain, nothing moves.' });
  assert.ok(rainy.structure.find(s => s.id === 'ambient').text.includes('Rain'));
  assert.equal(buildWanPrompt({ brief: 'She turns her head, rain falling on her shoulders.' }).structure.find(s => s.id === 'ambient'), undefined);
});

test('caller negative terms append to the vendor base and long prompts are flagged', () => {
  const built = buildWanPrompt({ brief: 'A lighthouse keeper checks a lamp.', negative: 'lens flare, chromatic aberration' });
  assert.ok(built.negative.startsWith(NEGATIVE_PROMPT));
  assert.ok(built.negative.endsWith('lens flare, chromatic aberration'));
  assert.ok(built.applied.includes('negative.caller-terms'));
  // The threshold is the vendor's I2V rule ("100 words or less"), the only vendor
  // length number denominated in words - the 60-200 figure is Chinese CHARACTERS.
  const long = buildWanPrompt({ brief: `A lighthouse keeper checks a lamp. ${'weathered brass fittings and salt-stained glass. '.repeat(30)}` });
  const flagged = long.warnings.find(w => w.code === 'PROMPT_TOO_LONG');
  assert.ok(flagged, 'a 200+ word prompt must be flagged');
  assert.ok(Number(flagged.matched.split(' ')[0]) > 100, flagged.matched);
  // The discriminating case: 100-200 words. This is flagged only if the threshold
  // is the vendor's 100 words and not the mis-unit-converted 200.
  const mid = buildWanPrompt({ brief: `A lighthouse keeper checks a lamp. ${'weathered brass fittings and salt-stained glass. '.repeat(14)}` });
  const midWords = mid.prompt.split(/\s+/).filter(Boolean).length;
  assert.ok(midWords > 100 && midWords < 200, `expected a 100-200 word prompt, got ${midWords}`);
  assert.ok(mid.warnings.some(w => w.code === 'PROMPT_TOO_LONG'), `${midWords} words was not flagged`);
  // ...and a prompt inside the vendor's own limit must not be.
  assert.equal(built.warnings.find(w => w.code === 'PROMPT_TOO_LONG'), undefined);
  assert.ok(built.prompt.split(/\s+/).filter(Boolean).length <= 100);
});

test('bad input is refused with a code rather than approximated', () => {
  assert.throws(() => buildWanPrompt({ brief: '' }), e => e.code === 'BRIEF_REQUIRED');
  assert.throws(() => buildWanPrompt({}), e => e.code === 'BRIEF_REQUIRED');
  assert.throws(() => buildWanPrompt({ brief: 'A dock.', shotRole: 'macro-insert' }), e => e.code === 'UNKNOWN_SHOT_ROLE');
  assert.throws(() => buildWanPrompt({ brief: 'A dock.', camera: 12 }), e => e.code === 'INVALID_CAMERA');
  assert.throws(() => buildWanPrompt({ brief: 'A dock.', style: {} }), e => e.code === 'INVALID_STYLE');
  assert.throws(() => recommendSampler({ dynamicDegree: 'frantic' }), e => e.code === 'UNKNOWN_DYNAMIC_DEGREE');
  assert.throws(() => recommendSampler({ shotRole: 'macro-insert' }), e => e.code === 'UNKNOWN_SHOT_ROLE');
});

test('every sampler recommendation is inside the ranges the workflow accepts', () => {
  for (const dynamicDegree of ['static', 'moderate', 'high']) {
    for (const shotRole of Object.keys(SHOT_ROLES)) {
      const s = recommendSampler({ dynamicDegree, shotRole });
      assert.ok(s.steps >= SAMPLER_BOUNDS.steps[0] && s.steps <= SAMPLER_BOUNDS.steps[1], `steps ${s.steps}`);
      assert.ok(s.rationale.length >= 3 && s.rationale.every(r => typeof r === 'string' && r.length > 20));
      // Comparing the recommendation against SAMPLER_BOUNDS alone is a tautology:
      // both are constants in the same file. Compare it against the graph that
      // actually runs instead.
      const graph = wanWorkflow({ prompt: 'x', steps: s.steps, frames: 121, width: 1024, height: 576, prefix: 'vyrealm/prompt-logic/test' });
      assert.equal(graph['8'].inputs.steps, s.steps, 'the recommended steps must reach the KSampler');
      assert.equal(graph['8'].inputs.sampler_name, s.sampler);
      assert.equal(graph['8'].inputs.scheduler, s.scheduler);
      // cfg and shift are advisory - wanWorkflow hardcodes both and takes neither
      // as an argument - so the only honest check is that the advice matches what
      // will actually run. This fails the day either side moves.
      assert.equal(graph['8'].inputs.cfg, s.cfg, 'recommended cfg differs from the cfg the graph hardcodes');
      assert.equal(graph['4'].inputs.shift, s.shift, 'recommended shift differs from the shift the graph hardcodes');
    }
  }
  // SAMPLER_BOUNDS.steps claims to mirror a real guard. Prove the edge is where
  // it says, rather than trusting the comment.
  assert.doesNotThrow(() => wanWorkflow({ prompt: 'x', steps: SAMPLER_BOUNDS.steps[1], frames: 121, width: 1024, height: 576, prefix: 'vyrealm/bound/ok' }));
  assert.throws(() => wanWorkflow({ prompt: 'x', steps: SAMPLER_BOUNDS.steps[1] + 1, frames: 121, width: 1024, height: 576, prefix: 'vyrealm/bound/over' }), /NEURAL_PROFILE_OUT_OF_BOUNDS/);
  assert.throws(() => wanWorkflow({ prompt: 'x', steps: SAMPLER_BOUNDS.steps[0] - 1, frames: 121, width: 1024, height: 576, prefix: 'vyrealm/bound/under' }), /NEURAL_PROFILE_OUT_OF_BOUNDS/);
  assert.equal(recommendSampler({ dynamicDegree: 'high' }).steps, 24);
  assert.equal(recommendSampler({ dynamicDegree: 'moderate', shotRole: 'detail' }).steps, 24);
  assert.equal(recommendSampler({ dynamicDegree: 'moderate' }).steps, 20);
});

test('every term in NEGATIVE_PROMPT is documented in English', () => {
  const emitted = NEGATIVE_PROMPT.split(/[，,]/).map(s => s.trim()).filter(Boolean);
  assert.equal(emitted.length, NEGATIVE_TERMS.length);
  assert.equal(new Set(emitted).size, emitted.length, 'no duplicate negative terms');
  for (const term of emitted) {
    const documented = NEGATIVE_TERMS.find(t => t.term === term);
    assert.ok(documented, `undocumented negative term: ${term}`);
    assert.ok(documented.why && documented.why.length > 20, `${term} has no explanation`);
    // Chinese terms carry an English gloss; English terms are their own gloss.
    if (/[一-鿿]/.test(term)) assert.ok(documented.gloss && /^[\x20-\x7e]+$/.test(documented.gloss), `${term} needs an ASCII gloss`);
  }
  // The vendor's own weighting, preserved: three anti-static slots and four for hands.
  assert.equal(NEGATIVE_TERMS.filter(t => /static|motionless/.test(t.gloss || '')).length, 3);
  assert.equal(NEGATIVE_TERMS.filter(t => /hand|finger|limb/.test(t.gloss || '')).length, 4);
  assert.ok(NEGATIVE_PROMPT.includes('背景人很多') && NEGATIVE_PROMPT.includes('倒着走'), 'the two most Wan-specific vendor terms survive');
});
