import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.VYRELUM_RUNTIME_DIR = await mkdtemp(join(tmpdir(), 'vyrealm-director-test-'));
const { directorMode, directorSchema, directorPrompt, validateDirectorPlan, createProduction } = await import('./director.mjs');
const timing = { fps: 24, durationSeconds: 10 };
const shot = (overrides = {}) => ({
  prompt: 'Arjuna steadies his bow on a carved wooden chariot at dawn. A close handheld view reveals woven cloth and worried eyes; distant flags stir in warm haze.',
  durationFrames: 120, camera: 'handheld', route: 'neural-video',
  subject: 'Arjuna, a young archer wearing woven burgundy cloth and engraved bronze armor.',
  environment: 'Kurukshetra plain at dawn, with ranks of distant chariots and standards.',
  action: 'His fingers tighten slowly around the bow as he looks toward the army.',
  lighting: 'Low warm sunrise catches his face, with cool fill from the sky.',
  depth: 'Foreground bow, midground face, background standards and atmospheric haze.',
  continuity: 'Same burgundy cloth, bronze armor, tied dark hair, warm dawn throughout.',
  ...overrides,
});
const plan = (overrides = {}) => ({ title: 'Before the First Arrow', treatment: 'An original adaptation of Arjuna’s hesitation and renewed resolve.', shots: [shot(), shot({ camera: 'push-in' })], ...overrides });
const scene = {
  objects: [{ id: 'orb', type: 'uv_sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], material: 'bronze', keyframes: [{ frame: 1, position: [0, 0, 0], rotation: [0, 0, 0] }, { frame: 240, position: [0.5, 0, 0], rotation: [0, 0, 1] }] }],
  materials: [{ id: 'bronze', color: [0.7, 0.4, 0.2], metallic: 0.8, roughness: 0.3 }],
  lights: [{ id: 'key', type: 'AREA', position: [3, -4, 5], rotation: [0, 0, 0], energy: 800, color: [1, 0.8, 0.6] }],
  camera: { position: [6, -8, 5], rotation: [1.15, 0, 0.65], lens: 45, keyframes: [{ frame: 1, position: [6, -8, 5] }] },
};

test('cinematic and explicit abstract schemas request different source material', () => {
  const cinematic = directorSchema();
  assert.equal(cinematic.required.includes('scene'), false);
  assert.equal(Object.hasOwn(cinematic.properties, 'scene'), false);
  assert.deepEqual(cinematic.properties.shots.items.properties.route.enum, ['neural-video', 'image']);
  assert.equal(Object.hasOwn(cinematic.properties.shots.items.properties, 'caption'), false);
  for (const key of ['subject', 'environment', 'action', 'lighting', 'depth', 'continuity']) assert.ok(cinematic.properties.shots.items.required.includes(key));
  const abstract = directorSchema({ mode: 'abstract', captions: true });
  assert.ok(abstract.required.includes('scene'));
  assert.deepEqual(abstract.properties.shots.items.properties.route.enum, ['scene3d']);
  assert.ok(abstract.properties.shots.items.properties.caption);
  assert.equal(directorMode('scene3d'), 'abstract');
  assert.throws(() => directorMode('misspelled'), /DIRECTOR_INVALID_MODE/);
  const cinemaPrompt = directorPrompt({ brief: 'An original epic trailer', ...timing });
  assert.ok(!cinemaPrompt.includes('choose 2-4 primitives'));
  assert.match(cinemaPrompt, /Captions and titles are disabled/);
  assert.match(cinemaPrompt, /Preserve the requested route/);
  assert.match(directorPrompt({ brief: 'An abstract bronze orb', ...timing, mode: 'abstract' }), /choose 2-4 primitives/);
});

test('neural and image plans validate without a Blender scene and do not invent captions', () => {
  const output = validateDirectorPlan(plan({ shots: [shot({ caption: 'Unrequested debug text' }), shot({ route: 'image' })] }), timing);
  assert.deepEqual(output.shots.map(s => s.route), ['neural-video', 'image']);
  assert.deepEqual(output.shots.map(s => s.caption), ['', '']);
  assert.equal(Object.hasOwn(output, 'scene'), false);
  assert.equal(output.shots[0].subject, shot().subject);
  assert.equal(validateDirectorPlan(plan({ shots: [shot({ caption: 'I will act.' })] }), { ...timing, captions: true }).shots[0].caption, 'I will act.');
  assert.equal(validateDirectorPlan(plan(), { ...timing, captions: true }).shots[0].caption, '');
});

test('cinematic invalid or primitive routes fail instead of falling through to scene3d', () => {
  for (const route of [undefined, null, '', 'unknown', 'scene3d']) {
    assert.throws(() => validateDirectorPlan(plan({ shots: [shot({ route })] }), timing), /DIRECTOR_INVALID_ROUTE/);
  }
  assert.throws(() => validateDirectorPlan(plan({ scene }), timing), /DIRECTOR_CINEMATIC_SCENE_FORBIDDEN/);
  for (const key of ['subject', 'environment', 'action', 'lighting', 'depth', 'continuity']) {
    assert.throws(() => validateDirectorPlan(plan({ shots: [shot({ [key]: '' })] }), timing), new RegExp(key));
  }
  assert.throws(() => validateDirectorPlan(plan({ shots: [shot({ camera: 'accidental-pan' })] }), timing), /DIRECTOR_INVALID_CAMERA/);
  assert.throws(() => validateDirectorPlan(plan({ shots: [shot({ durationFrames: '120' })] }), timing), /DIRECTOR_INVALID_DURATION/);
});

test('duration allocation preserves the requested runtime and never creates nonpositive shots', () => {
  const output = validateDirectorPlan(plan({ shots: [shot({ durationFrames: 999 }), shot({ durationFrames: 1 }), shot({ durationFrames: 1 })] }), timing);
  assert.equal(output.shots.reduce((n, s) => n + s.durationFrames, 0), 240);
  assert.ok(output.shots.every(s => Number.isInteger(s.durationFrames) && s.durationFrames > 0));
  assert.throws(() => validateDirectorPlan(plan(), { fps: 1, durationSeconds: 1 }), /more shots than frames/);
  assert.throws(() => validateDirectorPlan(plan({ shots: Array.from({ length: 13 }, () => shot()) }), timing), /DIRECTOR_INVALID_OUTPUT/);
});

test('editable primitives remain available only in an explicitly selected abstract plan', () => {
  const output = validateDirectorPlan(plan({ scene, shots: [shot({ route: 'scene3d' })] }), { ...timing, mode: 'abstract' });
  assert.equal(output.scene.objects[0].type, 'uv_sphere');
  assert.equal(output.scene.render.frames, 240);
  assert.equal(output.shots[0].route, 'scene3d');
  assert.throws(() => validateDirectorPlan(plan({ shots: [shot({ route: 'scene3d' })] }), { ...timing, mode: 'abstract' }), /SCENE_REQUIRED/);
  assert.throws(() => validateDirectorPlan(plan({ scene }), { ...timing, mode: 'abstract' }), /DIRECTOR_INVALID_ROUTE/);
});

test('Ollama plan round trip preserves blocked routes and caches only planning evidence', async t => {
  const requests = [];
  const model = process.env.VYRELUM_DIRECTOR_MODEL || 'qwen3:4b-instruct';
  // Transport fixtures validate the actual request/response and cache path.
  // They are not generated media or a measured model capability.
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: model, digest: 'fixture-model-digest' }] });
    assert.ok(url.endsWith('/api/generate'));
    requests.push(JSON.parse(options.body));
    return Response.json({ response: JSON.stringify(plan()), model, total_duration: 1234, eval_count: 80 });
  });
  const request = { brief: 'Research context: Gita 1.28–30 and 18.73. Create an original ten-second trailer.', projectId: 'director-routing-fixture', ...timing };
  const blocked = await createProduction(request);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.generationStatus, 'blocked');
  assert.ok(blocked.scenes[0].shots.every(s => s.route === 'neural-video' && s.status === 'blocked'));
  assert.ok(blocked.modelEvidence.routeDiagnostics.every(d => d.reason === 'NEURAL_VIDEO_MODEL_UNQUALIFIED'));
  assert.equal(Object.hasOwn(blocked, 'scene'), false);
  assert.equal(Object.hasOwn(blocked, 'outputs'), false);
  assert.equal(requests[0].format.required.includes('scene'), false);
  assert.ok(!requests[0].prompt.includes('choose 2-4 primitives'));
  assert.equal(requests[0].keep_alive, 0);
  const cached = await createProduction(request);
  assert.equal(cached.modelEvidence.cacheHit, true);
  assert.equal(requests.length, 1);
  const ready = await createProduction({ ...request, capabilities: { 'neural-video': true } });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.generationStatus, 'not-generated');
  assert.ok(ready.timeline.every(s => s.generationStatus === 'not-generated'));
  assert.equal(Object.hasOwn(ready, 'outputs'), false);
  assert.equal(requests.length, 2, 'different capability inputs must not reuse the blocked plan');
});
