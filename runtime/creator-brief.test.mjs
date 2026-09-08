import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreatorBrief, creatorBriefWorkflowInput, creatorCaptionOptions } from './creator-brief.mjs';
import { buildCreatorWorkflowPlan } from './creator-workflow.mjs';
import { buildCueList, buildCaptionFilter } from './format-captions.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('Night Lines: exact 10s/two shots, no captions, honest continuity and downstream workflow contract', () => {
  const brief = buildCreatorBrief({ prompt: 'Night Lines: a 10s miniature rail station film. Cool blue haze and amber windows. No captions. Voice: "Some journeys begin after the world falls quiet." Rain and tension, no music.', title: 'Night Lines', sourceMode: 'local-generation', shotDescriptions: ['Side view: detailed miniature railcar passes left through a night station.', 'Three-quarter view: a different train approaches from the right.'], continuityNotes: 'Different railcar geometry: do not imply the same vehicle.', durationSeconds: 10 });
  assert.equal(brief.method, 'deterministic-offline-adapter'); assert.equal(brief.modelInvoked, false); assert.equal(brief.status, 'draft');
  assert.equal(brief.shots.length, 2); assert.deepEqual(brief.shots.map(shot => shot.durationSeconds), [5, 5]);
  assert.equal(brief.shots[1].startFrame, 120); assert.equal(brief.shots.reduce((n, shot) => n + shot.durationFrames, 0), 240);
  assert.equal(brief.subtitles.selected, 'none'); assert.equal(brief.subtitles.enabled, false);
  assert.equal(brief.audio.narration.text, 'Some journeys begin after the world falls quiet.'); assert.equal(brief.audio.music.requested, false);
  assert.throws(() => creatorBriefWorkflowInput(brief, { projectId: 'night-lines', expectedRevision: 1 }), { code: 'CREATOR_BRIEF_SHOT_HANDOFF' });
  const input = creatorBriefWorkflowInput(brief, { projectId: 'night-lines', expectedRevision: 1, allowRoleResegmentation: true });
  const plan = buildCreatorWorkflowPlan({ input, project: { id: 'night-lines', revision: 1, settings: { fps: 24 } } });
  assert.equal(plan.inputs.captionsEnabled, false); assert.equal(plan.inputs.scriptText, brief.audio.narration.text); assert.match(plan.inputs.characterContinuity, /Different railcar geometry/);
  assert.equal(plan.mediaGenerated, false);
  assert.equal(plan.shots.length, 4); // Existing workflow rebuilds generic roles; never claim it retained this two-shot outline.
});
test('requested caption treatment is renderer-specific, never silently substituted', () => {
  const blocked = buildCreatorBrief({ prompt: 'A short with karaoke captions' });
  assert.equal(blocked.status, 'needs-changes'); assert.equal(blocked.subtitles.selected, null);
  assert.throws(() => creatorBriefWorkflowInput(blocked, { projectId: 'p', expectedRevision: 1 }), { code: 'CREATOR_BRIEF_NOT_READY' });
  const format = buildCreatorBrief({ prompt: 'A short with karaoke captions', renderer: 'format' });
  assert.equal(format.subtitles.selected, 'karaoke-bold'); assert.match(format.subtitles.limitation, /not word-aligned/);
  assert.throws(() => creatorBriefWorkflowInput(format, { projectId: 'p', expectedRevision: 1 }), { code: 'CREATOR_BRIEF_RENDERER_HANDOFF' });
  const readable = buildCreatorBrief({ prompt: 'A tutorial with readable subtitles' });
  const cues = buildCueList({ text: 'Choose the frame. Show the result.', durationSeconds: 5, style: readable.subtitles.selected });
  const filter = buildCaptionFilter({ cues, style: readable.subtitles.selected, canvas: { width: 1920, height: 1080, fps: 24 }, safeArea: { top: 86, bottom: 216, left: 134, right: 268 }, fontFile: 'C:/Windows/Fonts/segoeuib.ttf' });
  assert.match(filter, /drawtext=/); assert.equal(creatorCaptionOptions('timeline').some(item => item.id === 'karaoke-bold'), false);
  const none = buildCreatorBrief({ prompt: 'No subtitles. A quiet night.' }); assert.equal(none.subtitles.enabled, false);
});
test('bounded duration, explicit intent, unsupported capabilities and no provider execution', () => {
  const two = buildCreatorBrief({ prompt: 'Two 5-second shots of a station. No captions.' }); assert.equal(two.format.durationSeconds, 10); assert.equal(two.shots.length, 2);
  assert.equal(buildCreatorBrief({prompt:'A 10-second train film.'}).format.durationSeconds,10);
  const long = buildCreatorBrief({ prompt: 'A 30 minute documentary with automatic highlights and lip-sync' });
  assert.equal(long.format.requestedDurationSeconds, 1800); assert.equal(long.status, 'needs-changes'); assert.ok(long.feedback.some(item => item.code === 'WORKFLOW_DURATION_LIMIT'));
  const model = buildCreatorBrief({ prompt: 'OmniFlash makes a viral anime music video.' });
  assert.equal(model.modelInvoked, false); assert.ok(model.feedback.some(item => item.code === 'AMBIGUOUS_MODEL_REFERENCE'));
  assert.ok(model.feedback.some(item => item.code === 'ANIME_SOURCE_REQUIRED'));
  const conflict = buildCreatorBrief({ prompt: 'No narration.', narrationText: 'Speak this' }); assert.equal(conflict.status, 'needs-changes');
  for (const input of [null, [], { prompt: '' }, { prompt: 'test', extra: true }, { prompt: 'test', captionStyle: false }, { prompt: 'test', shotDescriptions: [''] }, { prompt: 'test', fps: 0 }]) assert.throws(() => buildCreatorBrief(input));
  assert.throws(() => creatorCaptionOptions('constructor'), { code: 'CREATOR_BRIEF_RENDERER' });
});

test('brief caption selections exercise actual renderer pixels for none/readable/group-highlight', async () => {
  const ffmpeg = fileURLToPath(new URL('../workers/tools/ffmpeg.exe', import.meta.url));
  for (const [captionStyle, renderer, expectedVisible] of [['none', 'timeline', false], ['readable', 'timeline', true], ['karaoke', 'format', true]]) {
    const brief = buildCreatorBrief({ prompt: 'A small caption demonstration', captionStyle, renderer });
    const cues = buildCueList({ text: 'Night Lines', durationSeconds: 1, style: brief.subtitles.selected });
    const filter = buildCaptionFilter({ cues, style: brief.subtitles.selected, canvas: { width: 640, height: 360, fps: 24 }, safeArea: { top: 20, bottom: 50, left: 30, right: 40 }, fontFile: 'C:/Windows/Fonts/segoeuib.ttf' });
    const { stdout } = await promisify(execFile)(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=640x360:d=1', ...(filter ? ['-vf', filter] : []), '-frames:v', '1', '-threads', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, encoding: 'buffer', maxBuffer: 1024 * 1024 });
    assert.equal(stdout.length, 640 * 360 * 3);
    assert.equal(stdout.some(value => value > 80), expectedVisible, `${captionStyle} should ${expectedVisible ? '' : 'not '}draw text`);
  }
});
