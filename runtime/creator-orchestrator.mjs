/**
 * Creator orchestrator: one idea in, a multi-platform production plan out.
 *
 * The spine of the creator workflow. idea -> script -> shot plan -> format
 * selection -> render queue. It owns no logic that already exists elsewhere:
 * the brief is analysed by prompt-logic.mjs, the copy guard is the one
 * scripts/write-format-hooks.mjs already uses, the formats and duration
 * evidence come from format-library.mjs, and every second of the estimate
 * comes from capability-tiers.projectRuntime.
 *
 * Two honesty rules are load-bearing here.
 *
 * 1. No fabricated claims. A 4B model invents statistics unprompted; one real
 *    run of write-format-hooks.mjs produced "1,200 hours of film made on one
 *    laptop", a number nobody measured. Burned into a video that is a false
 *    claim, so every generated line goes through the SAME isUsableHook guard
 *    (imported, not re-written) and a failing line is replaced by its
 *    structural counterpart with the rejection recorded.
 *
 * 2. No silent degradation. If Ollama is unreachable the script returned is a
 *    deterministic STRUCTURAL PLAN - directions for what each beat must do,
 *    not written copy - and the result says so in llm.reachable, in
 *    script.source and in a warning. A caller can never mistake the fallback
 *    for a written script.
 *
 * Nothing here predicts reach. A format is a production hypothesis.
 */

import { analyseBrief } from './prompt-logic.mjs';
import { cleanHookLine, isUsableHook } from '../scripts/write-format-hooks.mjs';
import {
  FORMATS, FORMAT_IDS, PLATFORM_SPECS, PLATFORM_IDS, DURATION_EVIDENCE,
  inferNiche, buildProductionPlan, evidenceOptimalSeconds
} from './format-library.mjs';
import { projectRuntime } from './capability-tiers.mjs';

export const SCHEMA_VERSION = 1;

const failure = (code, message) => Object.assign(new Error(message), { code });

const DEFAULT_OLLAMA = process.env.VYRELUM_OLLAMA || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:4b-instruct';
const REQUEST_TIMEOUT_MS = 90000;

// ponytail: 6 s per spoken line is an editing rule of thumb, not a measurement.
// It only decides how many beats to ask for; nothing downstream depends on it.
const SECONDS_PER_LINE = 6;
const MIN_BEATS = 2;
const MAX_BEATS = 5;
const FALLBACK_SECONDS = 30;

// A think block spans lines, so it has to go before the response is split;
// cleanHookLine then does the per-line cleaning it was written for.
const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;

const BEAT_ROLES = Object.freeze(['context', 'turn', 'proof', 'payoff', 'close']);
const BEAT_SHOTS = Object.freeze(['broll-a', 'broll-b', 'broll-c', 'broll-d', 'broll-e']);

/** Directions, not copy. Used whenever the model is unreachable or its line is rejected. */
const STRUCTURAL = Object.freeze({
  hook: 'Open on the subject with no preamble; the first frame carries the whole idea.',
  context: 'Show the situation the idea sits in, one visual fact at a time.',
  turn: 'Turn: show the thing that makes this different from the obvious version.',
  proof: 'Show the proof on screen rather than asserting it in words.',
  payoff: 'Land the payoff the opening frame promised.',
  close: 'Hold the strongest frame while the point settles.',
  cta: 'Close on one instruction: the single thing the viewer does next.'
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function checkPlatforms(platforms) {
  const list = Array.isArray(platforms) && platforms.length ? platforms : PLATFORM_IDS;
  for (const id of list) {
    if (!PLATFORM_SPECS[id]) throw failure('UNKNOWN_PLATFORM', `unknown platform ${id}; known: ${PLATFORM_IDS.join(', ')}`);
  }
  return [...list];
}

/** Evidence-backed default duration, or the editorial fallback when no evidence exists. */
function resolveDuration(durationPreference, platforms) {
  const asked = Number(durationPreference);
  if (Number.isFinite(asked) && asked > 0) return { seconds: asked, basis: 'caller durationPreference' };
  for (const platform of platforms) {
    const seconds = evidenceOptimalSeconds(platform);
    if (seconds) {
      const evidence = DURATION_EVIDENCE[platform];
      return { seconds, basis: `midpoint of the best observed view band for ${PLATFORM_SPECS[platform].label} (${evidence.confidence}, ${evidence.source})` };
    }
  }
  return { seconds: FALLBACK_SECONDS, basis: `no duration evidence for ${platforms.join(', ')}; ${FALLBACK_SECONDS}s editorial default` };
}

const beatCount = seconds => Math.max(MIN_BEATS, Math.min(MAX_BEATS, Math.round(seconds / SECONDS_PER_LINE) - 2));

const subjectOf = brief => String(brief).trim().split(/(?<=[.!?])\s+/)[0].replace(/\s+/g, ' ').replace(/[.!?]+$/, '');

async function askOllama(endpoint, model, prompt) {
  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.7, num_predict: 400 } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const body = await res.json();
  const text = String(body?.response ?? '').trim();
  if (!text) throw new Error('ollama returned an empty response');
  return text;
}

function scriptPrompt({ brief, roles, seconds, platformLabels }) {
  return `You write scripts for short videos. Write exactly ${roles.length + 2} lines, one per line, nothing else.

Line 1 is the hook: the words on screen in the first second.
${roles.map((role, i) => `Line ${i + 2} is the "${role}" beat.`).join('\n')}
Line ${roles.length + 2} is the call to action.

The video runs about ${seconds} seconds, for ${platformLabels}.
Brief: ${brief}

Rules: plain spoken English, 5 to 18 words per line. No numbering, no labels, no hashtags, no emoji, no quotes, no preamble, no explanation.
NEVER state a statistic, measurement, percentage, count or any number. Nobody has measured those numbers, and a number in a video is a claim we cannot stand behind. Describe the thing instead.`;
}

/* ------------------------------------------------------------------ */
/* 1. Idea -> script -> shot list                                      */
/* ------------------------------------------------------------------ */

/**
 * Develop one brief into a script and a shot list.
 *
 * Returns { idea, angle, script, shotList, warnings, llm }. `llm.reachable`
 * and `script.source` are the honest record of whether a model wrote this or
 * whether it is the deterministic structural plan.
 */
export async function developIdea({ brief, platforms, durationPreference = null, ollama = DEFAULT_OLLAMA, model = DEFAULT_MODEL } = {}) {
  const analysis = analyseBrief(brief); // throws BRIEF_REQUIRED on an empty brief
  const targets = checkPlatforms(platforms);

  // Failure triggers from prompt-logic propagate verbatim, under the codes
  // buildWanPrompt already uses for them.
  const warnings = analysis.triggers.map(t => ({
    code: t.risk === 'high' ? 'PROMPT_HIGH_RISK' : 'PROMPT_MEDIUM_RISK',
    triggerId: t.id, risk: t.risk, matched: t.matched, why: t.why, suggestion: t.reframe
  }));

  const duration = resolveDuration(durationPreference, targets);
  const roles = BEAT_ROLES.slice(0, beatCount(duration.seconds));
  const structural = [STRUCTURAL.hook, ...roles.map(role => STRUCTURAL[role]), STRUCTURAL.cta];

  let lines = structural;
  let source = 'deterministic-structure';
  let reachable = false;

  try {
    const raw = await askOllama(ollama, model, scriptPrompt({
      brief, roles, seconds: duration.seconds,
      platformLabels: targets.map(id => PLATFORM_SPECS[id].label).join(' and ')
    }));
    reachable = true;
    source = `ollama:${model}`;
    const written = raw.replace(THINK_BLOCK, ' ').split('\n').map(cleanHookLine).filter(Boolean);
    if (written.length < structural.length) {
      warnings.push({
        code: 'LLM_SHORT_RESPONSE',
        message: `${model} returned ${written.length} usable line(s) of the ${structural.length} asked for. The missing lines are structural directions, not written copy.`
      });
    }
    lines = structural.map((direction, index) => {
      const candidate = written[index];
      if (!candidate) return direction;
      if (isUsableHook(candidate)) return candidate;
      // Same guard scripts/write-format-hooks.mjs applies. It rejects
      // fabricated quantities (any digit or quantity word) as well as model
      // chatter, markup, and lines outside 4-26 words.
      warnings.push({
        code: 'SCRIPT_LINE_REJECTED',
        line: index + 1,
        rejected: candidate,
        message: `Line ${index + 1} failed the shared copy guard (a digit or quantity word, model chatter, markup, or outside 4-26 words) and was replaced by a structural direction. An invented number burned into a video is a false claim.`
      });
      return direction;
    });
  } catch (error) {
    warnings.push({
      code: 'LLM_UNREACHABLE',
      endpoint: ollama,
      model,
      reason: String(error?.message ?? error),
      message: `No answer from Ollama at ${ollama}. The script below is a deterministic structural plan (directions for each beat), NOT written copy.`
    });
  }

  const niche = inferNiche(brief);
  const script = {
    source,
    hook: lines[0],
    beats: roles.map((role, i) => ({ role, line: lines[i + 1] })),
    cta: lines[lines.length - 1]
  };

  const shotList = [
    { role: 'hero', description: script.hook },
    ...script.beats.map((beat, i) => ({ role: BEAT_SHOTS[i], description: beat.line })),
    { role: 'closer', description: script.cta }
  ].map(shot => {
    // A shot whose description trips a high-risk prompt-logic trigger is not
    // reliably generatable on the local model; it has to be sourced or filmed.
    const blockers = analyseBrief(shot.description).triggers.filter(t => t.risk === 'high');
    for (const blocker of blockers) {
      warnings.push({
        code: 'SHOT_NOT_GENERATABLE',
        shotRole: shot.role, triggerId: blocker.id, matched: blocker.matched,
        why: blocker.why, suggestion: blocker.reframe
      });
    }
    return { ...shot, generatable: blockers.length === 0 };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    idea: subjectOf(brief),
    angle: `${niche} treatment for ${targets.map(id => PLATFORM_SPECS[id].label).join(', ')}, about ${duration.seconds} seconds (${duration.basis}).`,
    niche,
    platforms: targets,
    durationSeconds: duration.seconds,
    script,
    shotList,
    warnings,
    llm: { reachable, model, endpoint: ollama, source },
    disclaimer: 'A script and format plan is a production hypothesis. It does not predict reach.'
  };
}

/* ------------------------------------------------------------------ */
/* 2. Format selection                                                 */
/* ------------------------------------------------------------------ */

const NICHE_POINTS = 2;
const DURATION_POINTS = 2;
const NEUTRAL_POINTS = 1;

/** Where a duration sits against a platform's observed bands. */
function durationVerdict(platform, seconds) {
  const evidence = DURATION_EVIDENCE[platform];
  const label = PLATFORM_SPECS[platform].label;
  if (!evidence) return { points: NEUTRAL_POINTS, contradictsEvidence: false, note: `no duration evidence collected for ${label}` };
  const [low, high] = evidence.bestForViews;
  if (seconds >= low && seconds <= high) {
    return { points: DURATION_POINTS, contradictsEvidence: false, note: `${seconds}s is inside the ${low}-${high}s band with the best observed views on ${label} (${evidence.confidence})` };
  }
  for (const [weakLow, weakHigh] of evidence.weakBands) {
    if (seconds > weakLow && seconds <= weakHigh) {
      return {
        points: 0,
        contradictsEvidence: true,
        note: `CONTRADICTS THE EVIDENCE: ${seconds}s sits in the ${weakLow}-${weakHigh}s band, the weakest measured for ${label}; best observed is ${low}-${high}s (${evidence.confidence}, ${evidence.source})`
      };
    }
  }
  return { points: NEUTRAL_POINTS, contradictsEvidence: false, note: `${seconds}s is outside both the best (${low}-${high}s) and the weakest observed bands for ${label}` };
}

/**
 * Rank formats for an idea across the requested platforms.
 *
 * Deterministic: equal scores keep library order, so the same idea always
 * produces the same ranking. Only formats that actually target a requested
 * platform can appear.
 */
export function selectFormatsForIdea({ idea, platforms, count = 5 } = {}) {
  if (typeof idea !== 'string' || !idea.trim()) throw failure('IDEA_REQUIRED', 'selectFormatsForIdea needs a non-empty idea string');
  const targets = checkPlatforms(platforms);
  if (!Number.isInteger(count) || count < 1) throw failure('INVALID_COUNT', `count must be a positive integer, got ${count}`);

  const niche = inferNiche(idea);
  const picks = [];
  for (const formatId of FORMAT_IDS) {
    const format = FORMATS[formatId];
    for (const platform of format.platforms) {
      if (!targets.includes(platform)) continue;
      const verdict = durationVerdict(platform, format.seconds);
      const nicheMatch = format.niche === niche;
      picks.push({
        formatId,
        platform,
        platformLabel: PLATFORM_SPECS[platform].label,
        niche: format.niche,
        seconds: format.seconds,
        score: (nicheMatch ? NICHE_POINTS : 0) + verdict.points,
        contradictsEvidence: verdict.contradictsEvidence,
        reason: `${nicheMatch ? `matches the inferred niche "${niche}"` : `niche "${format.niche}" is not the inferred "${niche}"`}; ${verdict.note}.`,
        order: picks.length
      });
    }
  }
  picks.sort((a, b) => b.score - a.score || a.order - b.order);
  return picks.slice(0, count).map(({ order, ...pick }) => pick);
}

/* ------------------------------------------------------------------ */
/* 3. Production queue                                                 */
/* ------------------------------------------------------------------ */

function resolvePick(entry, targets) {
  const formatId = typeof entry === 'string' ? entry : entry?.formatId;
  const format = FORMATS[formatId];
  if (!format) throw failure('UNKNOWN_FORMAT', `unknown format ${formatId}`);
  const platform = typeof entry === 'string' ? targets.find(id => format.platforms.includes(id)) : entry.platform;
  if (!platform || !format.platforms.includes(platform)) {
    throw failure('FORMAT_PLATFORM_MISMATCH', `format ${formatId} targets ${format.platforms.join(', ')}, which does not cover ${platform ?? targets.join(', ')}`);
  }
  return { formatId, platform };
}

/**
 * Turn selected formats into a render queue with a runtime estimate.
 *
 * Every second in the estimate comes from capability-tiers.projectRuntime and
 * `basis` is that function's own basis string, so the queue never invents a
 * number. The total is one projection over the whole queue rather than a sum
 * of per-item projections, because composite concurrency applies across the
 * queue, not inside one item.
 *
 * On a tier with no video model, projectRuntime's CAPABILITY_TIER_NO_NEURAL_VIDEO
 * error is allowed to propagate: a queue whose neural beats the hardware cannot
 * generate is not a queue, and costing them at zero would be a lie.
 */
export function buildProductionQueue({ idea = '', formats, platforms, shots = {}, tier } = {}) {
  if (!Array.isArray(formats)) throw failure('FORMATS_REQUIRED', 'buildProductionQueue needs a formats array');
  const targets = checkPlatforms(platforms);

  let neuralShots = 0;
  let composites = 0;
  const items = formats.map((entry, index) => {
    const { formatId, platform } = resolvePick(entry, targets);
    const plan = buildProductionPlan({ formatId, platform, brief: idea, shots, seed: index });
    const itemComposites = plan.timeline.filter(beat => beat.route === 'composite').length;
    neuralShots += plan.neuralBeats;
    composites += itemComposites;
    return {
      planId: `q${index + 1}-${formatId}@${platform}`,
      formatId,
      platform,
      plan,
      estimatedSeconds: projectRuntime(tier, { shots: plan.neuralBeats, composites: itemComposites }).wallClockSeconds
    };
  });

  const projection = projectRuntime(tier, { shots: neuralShots, composites });
  return {
    schemaVersion: SCHEMA_VERSION,
    items,
    neuralShots,
    composites,
    totalEstimatedSeconds: projection.wallClockSeconds,
    basis: projection.basis,
    note: 'Per-item estimates project each item alone, so they can sum to more than the total whenever composites from different items share concurrency slots.'
  };
}

/* ------------------------------------------------------------------ */
/* 4. Evidence                                                         */
/* ------------------------------------------------------------------ */

/**
 * The auditable record of one orchestration.
 *
 * Pass the developIdea result. Attach a buildProductionQueue result as
 * `result.queue` to record the estimate basis too; without it, estimateBasis
 * is null and says why rather than guessing.
 */
export function orchestratorEvidence(result) {
  if (!result || typeof result !== 'object') throw failure('RESULT_REQUIRED', 'orchestratorEvidence needs a developIdea result');
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const queue = result.queue ?? null;
  return {
    schemaVersion: SCHEMA_VERSION,
    idea: result.idea ?? null,
    model: result.llm?.model ?? null,
    llmReachable: Boolean(result.llm?.reachable),
    scriptSource: result.script?.source ?? null,
    scriptIsWrittenCopy: Boolean(result.llm?.reachable) && result.script?.source !== 'deterministic-structure',
    platforms: result.platforms ?? [],
    warnings: warnings.map(w => ({ ...w })),
    warningCodes: [...new Set(warnings.map(w => w.code))],
    rejectedLines: warnings.filter(w => w.code === 'SCRIPT_LINE_REJECTED').map(w => ({ line: w.line, rejected: w.rejected })),
    queue: queue ? { itemCount: queue.items.length, neuralShots: queue.neuralShots, composites: queue.composites, totalEstimatedSeconds: queue.totalEstimatedSeconds } : null,
    estimateBasis: queue?.basis ?? null,
    estimateBasisNote: queue ? null : 'No queue was attached to this result, so no runtime was estimated.',
    disclaimer: 'Plans and estimates only. Nothing here was rendered, measured or published.'
  };
}
