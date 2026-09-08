import assert from 'node:assert/strict';
import test from 'node:test';
import {
  developIdea, selectFormatsForIdea, buildProductionQueue, orchestratorEvidence
} from './creator-orchestrator.mjs';
import { FORMATS, buildProductionPlan } from './format-library.mjs';
import { TIERS, projectRuntime } from './capability-tiers.mjs';

const OLLAMA = process.env.VYRELUM_OLLAMA || 'http://127.0.0.1:11434';

/** Swap globalThis.fetch for the duration of one call, then put it back. */
async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

const respondWith = lines => async () => ({ ok: true, json: async () => ({ response: lines.join('\n') }) });
const refuse = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); };

/**
 * The whole point of the fallback: an unreachable model must still produce a
 * plan a human can shoot from, and must never be mistaken for written copy.
 */
test('an unreachable Ollama yields a usable deterministic plan, flagged as such', async () => {
  const result = await withFetch(refuse, () => developIdea({
    brief: 'A local video studio that runs on one laptop.',
    platforms: ['instagram-reels', 'tiktok'],
    durationPreference: 20
  }));

  assert.equal(result.llm.reachable, false);
  assert.equal(result.script.source, 'deterministic-structure');

  const unreachable = result.warnings.find(w => w.code === 'LLM_UNREACHABLE');
  assert.ok(unreachable, 'the result must say the model was unreachable');
  assert.match(unreachable.message, /NOT written copy/);
  assert.match(unreachable.reason, /ECONNREFUSED/);

  // Usable means complete: a hook, real beats, a CTA and a shot per line.
  assert.ok(result.script.hook.length > 10);
  assert.ok(result.script.beats.length >= 2);
  assert.ok(result.script.beats.every(b => typeof b.line === 'string' && b.line.length > 10));
  assert.ok(result.script.cta.length > 10);
  assert.equal(result.shotList.length, result.script.beats.length + 2);
  assert.ok(result.shotList.every(s => typeof s.generatable === 'boolean'));
  assert.deepEqual(result.shotList.map(s => s.role).slice(0, 2), ['hero', 'broll-a']);

  const evidence = orchestratorEvidence(result);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.llmReachable, false);
  assert.equal(evidence.scriptIsWrittenCopy, false);
  assert.ok(evidence.warningCodes.includes('LLM_UNREACHABLE'));
  assert.equal(evidence.estimateBasis, null);
  assert.match(evidence.estimateBasisNote, /No queue/);
});

/**
 * The load-bearing test. A 4B model invents statistics unprompted; one real run
 * of write-format-hooks.mjs produced "1,200 hours of film made on one laptop".
 * Burned into a video that is a false claim, so the line must not survive.
 */
test('a generated line carrying a fabricated statistic is rejected', async () => {
  const fabricated = '1,200 hours of film made on one laptop.';
  const result = await withFetch(respondWith([
    fabricated,
    'Everything renders on the machine already on your desk.',
    'No account, no upload, no waiting for a queue.',
    'Open it and cut your first scene tonight.'
  ]), () => developIdea({
    brief: 'A local video studio that runs on one laptop.',
    platforms: ['instagram-reels'],
    durationPreference: 15
  }));

  assert.equal(result.llm.reachable, true);
  assert.notEqual(result.script.hook, fabricated);

  const rejection = result.warnings.find(w => w.code === 'SCRIPT_LINE_REJECTED');
  assert.ok(rejection, 'the rejection must be recorded, not silent');
  assert.equal(rejection.line, 1);
  assert.equal(rejection.rejected, fabricated);

  // The clean lines it wrote are kept.
  assert.equal(result.script.beats[0].line, 'Everything renders on the machine already on your desk.');
  assert.equal(result.script.cta, 'Open it and cut your first scene tonight.');

  const evidence = orchestratorEvidence(result);
  assert.deepEqual(evidence.rejectedLines, [{ line: 1, rejected: fabricated }]);
});

test('every quantity word the shared guard covers is rejected in a script line', async () => {
  const result = await withFetch(respondWith([
    'Thousands of creators already switched to this studio.',
    'Everything renders on the machine already on your desk.',
    'No account, no upload, no waiting for a queue.',
    'Open it and cut your first scene tonight.'
  ]), () => developIdea({ brief: 'A local video studio.', platforms: ['tiktok'], durationPreference: 15 }));

  assert.ok(result.warnings.some(w => w.code === 'SCRIPT_LINE_REJECTED' && /Thousands/.test(w.rejected)));
});

test('format selection only returns formats that target the requested platforms', () => {
  const picks = selectFormatsForIdea({ idea: 'An anime short film about a lighthouse keeper', platforms: ['youtube-long'], count: 6 });

  assert.ok(picks.length > 0);
  for (const pick of picks) {
    assert.equal(pick.platform, 'youtube-long');
    assert.ok(FORMATS[pick.formatId].platforms.includes('youtube-long'), `${pick.formatId} does not target youtube-long`);
    assert.ok(pick.reason.length > 20, 'every pick carries a reason');
  }

  const vertical = selectFormatsForIdea({ idea: 'An anime short film about a lighthouse keeper', platforms: ['tiktok'], count: 6 });
  assert.ok(vertical.every(p => p.platform === 'tiktok'));
  assert.ok(!vertical.some(p => picks.some(other => other.formatId === p.formatId && !FORMATS[p.formatId].platforms.includes('tiktok'))));
});

test('duration evidence ranks picks and a contradicting pick says so', () => {
  const picks = selectFormatsForIdea({ idea: 'A cinematic trailer for a horror film', platforms: ['tiktok'], count: 40 });
  const scores = picks.map(p => p.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'picks come back ranked');

  // TikTok's weakest measured band is 0-15s, so any short format must be flagged.
  const short = picks.find(p => p.seconds <= 15);
  assert.ok(short, 'the library has formats short enough to hit the weak band');
  assert.equal(short.contradictsEvidence, true);
  assert.match(short.reason, /CONTRADICTS THE EVIDENCE/);
  assert.match(short.reason, /socialinsider/);
});

test('the queue estimate is exactly what projectRuntime says', () => {
  const tier = TIERS.standard;
  const picks = selectFormatsForIdea({ idea: 'An anime character intro', platforms: ['tiktok', 'instagram-reels'], count: 3 });
  const queue = buildProductionQueue({ idea: 'An anime character intro', formats: picks, platforms: ['tiktok', 'instagram-reels'], tier });

  assert.equal(queue.items.length, 3);

  let shots = 0;
  let composites = 0;
  for (const pick of picks) {
    const plan = buildProductionPlan({ formatId: pick.formatId, platform: pick.platform });
    shots += plan.neuralBeats;
    composites += plan.timeline.filter(b => b.route === 'composite').length;
  }
  const expected = projectRuntime(tier, { shots, composites });

  assert.equal(queue.neuralShots, shots);
  assert.equal(queue.composites, composites);
  assert.equal(queue.totalEstimatedSeconds, expected.wallClockSeconds);
  assert.equal(queue.basis, expected.basis);

  // Per-item estimates come from the same function, one item at a time.
  const first = queue.items[0];
  const firstPlan = first.plan;
  assert.equal(first.estimatedSeconds, projectRuntime(tier, {
    shots: firstPlan.neuralBeats,
    composites: firstPlan.timeline.filter(b => b.route === 'composite').length
  }).wallClockSeconds);
  assert.equal(first.planId, `q1-${first.formatId}@${first.platform}`);

  const evidence = orchestratorEvidence({ idea: 'An anime character intro', llm: { model: 'qwen3:4b-instruct', reachable: false }, warnings: [], queue });
  assert.equal(evidence.estimateBasis, expected.basis);
  assert.equal(evidence.queue.totalEstimatedSeconds, expected.wallClockSeconds);
});

test('a queue on a tier with no video model refuses rather than costing shots at zero', () => {
  assert.throws(
    () => buildProductionQueue({ formats: ['anime-character-intro'], platforms: ['tiktok'], tier: TIERS.minimal }),
    err => err.code === 'CAPABILITY_TIER_NO_NEURAL_VIDEO'
  );
});

test('warnings from analyseBrief propagate into the result', async () => {
  const result = await withFetch(refuse, () => developIdea({
    brief: 'Close-up on hands tying a knot beside a sign that reads OPEN.',
    platforms: ['tiktok'],
    durationPreference: 15
  }));

  const triggerIds = result.warnings.filter(w => w.triggerId).map(w => w.triggerId);
  assert.ok(triggerIds.includes('readable-text'), `expected readable-text, got ${triggerIds.join(', ')}`);
  assert.ok(triggerIds.includes('close-up-hands'), `expected close-up-hands, got ${triggerIds.join(', ')}`);

  const readable = result.warnings.find(w => w.triggerId === 'readable-text');
  assert.equal(readable.code, 'PROMPT_HIGH_RISK');
  assert.equal(readable.risk, 'high');
  assert.ok(readable.suggestion.length > 0, 'the reframe from prompt-logic comes with it');
  assert.ok(orchestratorEvidence(result).warningCodes.includes('PROMPT_HIGH_RISK'));
});

test('unknown platforms and empty briefs fail with codes, not approximations', async () => {
  await assert.rejects(() => developIdea({ brief: 'x', platforms: ['myspace'] }), err => err.code === 'UNKNOWN_PLATFORM');
  await assert.rejects(() => developIdea({ brief: '   ' }), err => err.code === 'BRIEF_REQUIRED');
  assert.throws(() => selectFormatsForIdea({ idea: '' }), err => err.code === 'IDEA_REQUIRED');
  assert.throws(() => buildProductionQueue({ formats: ['no-such-format'], platforms: ['tiktok'], tier: TIERS.standard }), err => err.code === 'UNKNOWN_FORMAT');
  assert.throws(() => buildProductionQueue({ formats: ['anime-short-film'], platforms: ['tiktok'], tier: TIERS.standard }), err => err.code === 'FORMAT_PLATFORM_MISMATCH');
});

/* ------------------------------------------------------------------ */
/* Integration: the real local model                                   */
/* ------------------------------------------------------------------ */

test('INTEGRATION: the real local Ollama writes a script that passes the copy guard', async t => {
  let up = false;
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    up = res.ok;
  } catch { up = false; }
  if (!up) {
    t.skip(`Ollama is not answering at ${OLLAMA}. Start it (ollama serve) and pull qwen3:4b-instruct to run this test.`);
    return;
  }

  const result = await developIdea({
    brief: 'A filmmaking studio that runs entirely on your own laptop, with no cloud and no credits.',
    platforms: ['instagram-reels'],
    durationPreference: 20
  });

  if (!result.llm.reachable) {
    const why = result.warnings.find(w => w.code === 'LLM_UNREACHABLE');
    t.skip(`Ollama answered /api/tags but not /api/generate (${why?.reason}). Pull the model with: ollama pull qwen3:4b-instruct`);
    return;
  }

  assert.equal(result.script.source, 'ollama:qwen3:4b-instruct');
  assert.ok(result.script.hook.length > 10);
  assert.ok(result.script.beats.every(b => b.line.length > 10));

  // Whatever the model wrote, no fabricated quantity reaches the script: any
  // line it rejected was replaced, so no surviving line carries a digit.
  const surviving = [result.script.hook, ...result.script.beats.map(b => b.line), result.script.cta];
  for (const line of surviving) assert.doesNotMatch(line, /\d/, `a number survived into the script: ${line}`);

  const evidence = orchestratorEvidence(result);
  assert.equal(evidence.llmReachable, true);
  assert.equal(evidence.model, 'qwen3:4b-instruct');
  console.log(`  real model wrote: ${JSON.stringify(result.script.hook)} (${result.warnings.filter(w => w.code === 'SCRIPT_LINE_REJECTED').length} line(s) rejected)`);
});
