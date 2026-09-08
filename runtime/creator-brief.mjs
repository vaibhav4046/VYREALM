import { createHash } from 'node:crypto';
import { CREATOR_WORKFLOWS, validateCreatorWorkflowInput } from './creator-workflow.mjs';
import { CAPTION_STYLES, GRADES } from './format-library.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const has = (object, key) => Object.hasOwn(object, key);
const clean = (value, label, max = 6000) => { if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('CREATOR_BRIEF_INPUT', `${label} must be bounded plain text.`); return value.trim(); };
const families = {
  cinematic: { workflowId: 'cinematic', recipeId: 'establishing-mood', grade: 'cool-night' },
  anime: { workflowId: 'cinematic', recipeId: 'anime-character-intro', grade: 'anime-flat' },
  music: { workflowId: 'cinematic', recipeId: 'music-video-loop', grade: 'film-vintage' },
  shorts: { workflowId: 'social-recut', recipeId: 'cold-open-question', grade: 'neutral' },
  longform: { workflowId: 'faceless', recipeId: 'documentary-chapter', grade: 'neutral' },
  tutorial: { workflowId: 'tutorial', recipeId: 'tutorial-15s', grade: 'neutral' }
};
const captionsByRenderer = { timeline: ['none', 'minimal-lower', 'generic'], format: Object.keys(CAPTION_STYLES) };
export function creatorCaptionOptions(renderer = 'timeline') {
  if (!has(captionsByRenderer, renderer)) fail('CREATOR_BRIEF_RENDERER', 'Choose timeline or format.');
  return captionsByRenderer[renderer].map(id => ({ id, label: id === 'generic' ? 'Standard subtitles' : CAPTION_STYLES[id].label, renderer, timing: id === 'none' ? 'none' : renderer === 'timeline' ? 'editable-cue-timestamps' : 'estimated-cue-timing', ...(id === 'karaoke-bold' ? { limitation: 'Highlights short cue groups; not word-aligned sung-lyric karaoke.' } : {}) }));
}
function inferFamily(prompt) {
  if (/\banime\b/i.test(prompt)) return 'anime';
  if (/\b(music video|music visuali[sz]er|lyric video)\b/i.test(prompt)) return 'music';
  if (/\b(tutorial|how to|step.by.step)\b/i.test(prompt)) return 'tutorial';
  if (/\b(long.form|documentary|chapter)\b/i.test(prompt)) return 'longform';
  if (/\b(shorts|reels|tiktok|vertical)\b/i.test(prompt)) return 'shorts';
  return 'cinematic';
}
function requestedCaptions(prompt, explicit) {
  const aliases = { readable: 'minimal-lower', karaoke: 'karaoke-bold', standard: 'generic', off: 'none' };
  if (explicit !== undefined) return aliases[explicit] || explicit;
  if (/\b(no|without|disable)\s+(?:burned[- ]in\s+)?(?:captions?|subtitles?)\b/i.test(prompt)) return 'none';
  if (/\bkaraoke\b/i.test(prompt)) return 'karaoke-bold';
  if (/\b(captions?|subtitles?)\b/i.test(prompt)) return 'minimal-lower';
  return 'none';
}

/** Pure offline adapter. It creates editable proposals, never media or executable model calls. */
export function buildCreatorBrief(input) {
  const keys = new Set(['prompt', 'title', 'family', 'durationSeconds', 'fps', 'aspect', 'renderer', 'captionStyle', 'sourceMode', 'narrationText', 'shotDescriptions', 'continuityNotes', 'constraints']);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.has(key))) fail('CREATOR_BRIEF_INPUT', 'Unsupported brief options.');
  const prompt = clean(input.prompt, 'Prompt'); if (!prompt) fail('CREATOR_BRIEF_INPUT', 'Describe the video.');
  const family = input.family || inferFamily(prompt); if (!has(families, family)) fail('CREATOR_BRIEF_FAMILY', 'Choose an available brief family.');
  const definition = families[family], workflow = CREATOR_WORKFLOWS.find(item => item.id === definition.workflowId);
  const durationMatch = prompt.match(/\b(\d+(?:\.\d+)?)\s*-?\s*(seconds?|secs?|s|minutes?|mins?|m)\b/i);
  const perShotMatch = prompt.match(/\b(two|three|four|\d+)\s+(\d+(?:\.\d+)?)[ -]?(?:seconds?|secs?|s)[ -]?shots?\b/i);
  const perShotCount = perShotMatch ? ({two:2,three:3,four:4}[perShotMatch[1].toLowerCase()] || Number(perShotMatch[1])) : null;
  const inferredDuration = perShotMatch && (!durationMatch || durationMatch.index >= perShotMatch.index) ? perShotCount * Number(perShotMatch[2]) : durationMatch ? Number(durationMatch[1]) * (/^m/i.test(durationMatch[2]) ? 60 : 1) : family === 'longform' ? 300 : 15;
  const durationSeconds = input.durationSeconds ?? inferredDuration;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 36000) fail('CREATOR_BRIEF_DURATION', 'Planning duration must be between 1 second and 10 hours.');
  const fps = input.fps ?? 24; if (![24, 25, 30, 60].includes(fps)) fail('CREATOR_BRIEF_FPS', 'Choose 24, 25, 30 or 60 fps.');
  const aspect = input.aspect || (/\b(vertical|shorts|reels|tiktok|9:16)\b/i.test(prompt) ? '9:16' : /\b(square|1:1)\b/i.test(prompt) ? '1:1' : '16:9');
  if (!['16:9', '9:16', '1:1'].includes(aspect)) fail('CREATOR_BRIEF_ASPECT', 'Choose 16:9, 9:16 or 1:1.');
  const renderer = input.renderer || 'timeline', options = creatorCaptionOptions(renderer);
  if (input.captionStyle !== undefined) clean(input.captionStyle, 'Caption style', 60);
  const requested = requestedCaptions(prompt, input.captionStyle);
  const captionOption = options.find(item => item.id === requested);
  const sourceMode = input.sourceMode || 'uploaded-media';
  if (!['uploaded-media', 'local-generation', 'mixed'].includes(sourceMode)) fail('CREATOR_BRIEF_SOURCE', 'Choose uploaded media, local generation or mixed.');
  const title = input.title === undefined ? prompt.split(/[.!?\n]/)[0].slice(0, 100) : clean(input.title, 'Title', 100);
  if (!title) fail('CREATOR_BRIEF_INPUT', 'A title is required.');
  const narrationText = input.narrationText === undefined ? (prompt.match(/\b(?:voice|narration|voiceover)\s*[:—-]?\s*["“']([^"”']{1,1200})["”']/i)?.[1] || '') : clean(input.narrationText, 'Narration', 12000);
  const feedback = [], add = (code, message, severity = 'review') => feedback.push({ code, message, severity });
  if (!captionOption) add('CAPTION_UNSUPPORTED_ON_ROUTE', `${requested} is unavailable on the ${renderer} renderer. Choose one of the returned supported options; no substitution was made.`, 'blocked');
  if (requested === 'karaoke-bold' && captionOption) add('CAPTION_CUE_HIGHLIGHT_ONLY', captionOption.limitation);
  if (durationSeconds > 600) add('WORKFLOW_DURATION_LIMIT', 'The existing creator workflow accepts at most 600 seconds. Split this outline into shorter projects.', 'blocked');
  if (sourceMode !== 'uploaded-media' && durationSeconds > 120) add('DIRECTOR_DURATION_LIMIT', 'The model director is bounded to 120 seconds; use separately reviewed short generation jobs.');
  if (!workflow.sourceModes.includes(sourceMode)) add('WORKFLOW_SOURCE_UNSUPPORTED', `${workflow.label} does not support ${sourceMode}.`, 'blocked');
  if (/\b(lip[- ]?sync|dubbing|diarization)\b/i.test(prompt)) add('UNCONNECTED_MEDIA_FEATURE', 'Lip-sync, dubbing and diarization are not connected to this adapter.', 'blocked');
  if (/\b(automatic|auto)[ -]?(beat sync|beat detection|highlights?)\b/i.test(prompt)) add('UNSUPPORTED_AUTOMATIC_SELECTION', 'Select source moments and music beats manually; this adapter does not analyze media.', 'blocked');
  if (/\b(viral|guaranteed|million views)\b/i.test(prompt)) add('NO_PERFORMANCE_PREDICTION', 'The plan cannot predict reach or guarantee engagement.');
  if (/\bOmni\s*Flash\b/i.test(prompt)) add('AMBIGUOUS_MODEL_REFERENCE', 'OmniFlash is not resolved to an official model or UI contract. No provider is selected.');
  if (family === 'anime') add('ANIME_SOURCE_REQUIRED', 'An anime recipe or colour grade does not generate anime characters; supply representative footage or separately reviewed generated shots.');
  if (/\b(same|identical)\s+(?:character|vehicle|train|railcar)\b/i.test(prompt)) add('CONTINUITY_NOT_GUARANTEED', 'Identity continuity requires source inspection and references; the planner cannot verify it.');
  const constraints = input.constraints ?? [];
  if (!Array.isArray(constraints) || constraints.length > 20) fail('CREATOR_BRIEF_INPUT', 'Use at most 20 constraints.');
  const declaredConstraints = constraints.map(value => clean(value, 'Constraint', 500));
  const continuity = clean(input.continuityNotes ?? 'Review subject identity, geometry, direction, lighting and cut continuity.', 'Continuity notes', 2000);
  const suppliedShots = input.shotDescriptions;
  if (suppliedShots !== undefined && (!Array.isArray(suppliedShots) || !suppliedShots.length || suppliedShots.length > 12)) fail('CREATOR_BRIEF_INPUT', 'Supply 1–12 shot descriptions.');
  const shotCount = suppliedShots?.length || perShotCount || (durationSeconds <= 12 ? 2 : 4), totalFrames = Math.round(durationSeconds * fps);
  if (shotCount > 12) fail('CREATOR_BRIEF_SHOTS', 'Use at most 12 shot proposals per brief.');
  const topic = prompt.split(/[\n.!?]/)[0].slice(0, 240);
  const descriptions = suppliedShots ? suppliedShots.map(value => clean(value, 'Shot description', 1000)) : Array.from({length:shotCount},(_,index)=>{const role=workflow.roles[index % workflow.roles.length];return `${role.charAt(0).toUpperCase() + role.slice(1)}: ${topic}`;});
  if (descriptions.some(value => !value)) fail('CREATOR_BRIEF_INPUT', 'Shot descriptions cannot be empty.');
  const shots = []; let cursor = 0;
  for (const [index, description] of descriptions.entries()) {
    const durationFrames = index === descriptions.length - 1 ? totalFrames - cursor : Math.floor(totalFrames / descriptions.length);
    shots.push({ id: `brief-shot-${index + 1}`, startFrame: cursor, durationFrames, startSeconds: cursor / fps, durationSeconds: durationFrames / fps, role: index === 0 ? 'hook' : index === descriptions.length - 1 ? 'payoff' : 'development', description, camera: 'static', cameraStatus: 'editable-proposal', assetId: null, mediaStatus: 'not-selected', continuity }); cursor += durationFrames;
  }
  const noVoice = /\b(no|without)\s+(?:voiceover|narration|voice)\b/i.test(prompt);
  if (noVoice && narrationText) add('NARRATION_CONFLICT', 'The prompt requests no narration but a narration script is supplied. Resolve this before applying.', 'blocked');
  const music = !/\b(no|without)\s+music\b/i.test(prompt) && /\b(music|song|soundtrack)\b/i.test(prompt);
  const ambience = /\b(rain|ambien|tension|wind|atmosphere|station)\b/i.test(prompt);
  if (music) add('MUSIC_ASSET_REQUIRED', 'Supply an authorized audio asset. DSP atmosphere is not a generated song.');
  const grade = /\b(no|without)\s+(?:colou?r\s+)?grad/i.test(prompt) ? 'neutral' : definition.grade;
  if (!has(GRADES, grade)) fail('CREATOR_BRIEF_GRADE', 'Unavailable colour grade.');
  return {
    schemaVersion: 1, kind: 'creator-brief', method: 'deterministic-offline-adapter', modelInvoked: false, mediaGenerated: false, editable: true, status: feedback.some(item => item.severity === 'blocked') ? 'needs-changes' : 'draft',
    inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), prompt, title,
    family, workflowId: definition.workflowId, recipeReference: { id: definition.recipeId, use: 'existing creative recipe reference; this outline is not a render plan' },
    format: { aspect, durationSeconds: totalFrames / fps, requestedDurationSeconds: durationSeconds, fps, canvas: aspect === '9:16' ? { width: 1080, height: 1920 } : aspect === '1:1' ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 }, resolutionMeaning: 'delivery canvas; source resolution remains separate' },
    hook: { text: descriptions[0], basis: suppliedShots ? 'user-supplied-opening' : 'workflow-role-plus-prompt', instruction: 'Show the promised subject immediately; keep title and thumbnail faithful to this opening.' },
    beats: shots.map(({ id, startSeconds, durationSeconds, role }) => ({ shotId: id, startSeconds, durationSeconds, role })), shots,
    audio: { narration: { mode: narrationText && !noVoice ? 'piper' : 'none', text: narrationText, timing: 'requires-measured-audio-duration', generated: false }, music: { requested: music, status: music ? 'needs-authorized-asset' : 'not-requested', generated: false }, ambience: { requested: ambience, method: ambience ? 'local-DSP-candidate' : 'none', generated: false } },
    subtitles: { requested, selected: captionOption?.id ?? null, enabled: captionOption ? captionOption.id !== 'none' : null, renderer, options, timing: captionOption?.timing || null, cues: [], ...(captionOption?.limitation ? { limitation: captionOption.limitation } : {}) },
    style: { gradeId: grade, gradeLabel: GRADES[grade].label, generationStyle: family === 'anime' ? 'anime requested; source-dependent' : 'source-dependent' },
    constraints: [...declaredConstraints, continuity, 'No media selection, rendering, model invocation or publication occurs during planning.'], feedback,
    integration: { sourceMode, workflowEndpoint: '/api/creator/workflows/plan', workflowEndpointPurpose: 'Saves planning intent but generates its own generic role segmentation. Preserve this brief.shots separately for exact shot timing.', requiresSavedProject: true, requiresReview: true, renderer, autoSubmit: false }
  };
}

/** Convert reviewed outline to the existing validated workflow input, without submitting it. */
export function creatorBriefWorkflowInput(brief, { projectId, expectedRevision, assetIds = [], allowRoleResegmentation = false } = {}) {
  if (brief?.kind !== 'creator-brief' || brief.status !== 'draft' || brief.subtitles.selected === null) fail('CREATOR_BRIEF_NOT_READY', 'Resolve unsupported options before applying this brief.');
  if (brief.integration.renderer === 'format') fail('CREATOR_BRIEF_RENDERER_HANDOFF', 'Use the format-render adapter with this brief; the creator workflow endpoint cannot preserve format-specific caption treatment.');
  if (!allowRoleResegmentation) fail('CREATOR_BRIEF_SHOT_HANDOFF', 'The existing workflow endpoint regenerates generic shot roles. Preserve brief.shots in a dedicated adapter, or explicitly allow role resegmentation to save planning intent only.');
  return validateCreatorWorkflowInput({ projectId, expectedRevision, workflowId: brief.workflowId, brief: `${brief.prompt}\n\nShot proposals:\n${brief.shots.map(shot => `${shot.startSeconds.toFixed(2)}–${(shot.startSeconds + shot.durationSeconds).toFixed(2)}s: ${shot.description}`).join('\n')}`.slice(0, 6000), durationSeconds: brief.format.durationSeconds, sourceMode: brief.integration.sourceMode, assetIds, captionsEnabled: brief.subtitles.enabled, narrationMode: brief.audio.narration.mode, scriptText: brief.audio.narration.text, characterContinuity: brief.constraints.join('\n').slice(0, 4000) });
}
