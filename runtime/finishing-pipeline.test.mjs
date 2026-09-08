import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  FINISHING_STEPS, ANCHORS, CONTENTION_MULTIPLIER, finishingStep,
  buildScaleFilter, scaleFactor, planFinishing, finish, finishingEvidence,
} from './finishing-pipeline.mjs';

const exec = promisify(execFile);
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.VYRELUM_FFMPEG || join(APP, 'workers/tools/ffmpeg.exe');
const FFPROBE = process.env.VYRELUM_FFPROBE || join(APP, 'workers/tools/ffprobe.exe');
const SHOTS = join(APP, 'outputs/shots');
const HAVE_FFMPEG = existsSync(FFMPEG) && existsSync(FFPROBE);

// The real LTX generation shape on this box: 97 frames, 768x512, 25 fps.
const LTX = { width: 768, height: 512, fps: 25, durationSeconds: 3.88 };
const ALL_TOOLS = ['ffmpeg', 'rife-ncnn-vulkan', 'realesrgan-ncnn-vulkan'];

const probe = async path => {
  const { stdout } = await exec(FFPROBE, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,nb_frames,avg_frame_rate:format=duration', '-of', 'json', path],
    { windowsHide: true, timeout: 120000 });
  const parsed = JSON.parse(stdout);
  const v = parsed.streams?.[0];
  return v?.width ? { width: v.width, height: v.height, durationSeconds: Number(v.duration) || Number(parsed.format?.duration) || 0 } : null;
};

/** First clip in outputs/shots that actually decodes; the directory is written into while tests run. */
const firstUsableShot = async () => {
  if (!HAVE_FFMPEG || !existsSync(SHOTS)) return null;
  for (const name of (await readdir(SHOTS)).filter(n => n.endsWith('.mp4')).sort()) {
    const path = join(SHOTS, name);
    const measured = await probe(path).catch(() => null);
    if (measured && measured.width > 0 && measured.durationSeconds > 0.5) return { path, ...measured };
  }
  return null;
};

// --------------------------------------------------------------------------
// catalogue
// --------------------------------------------------------------------------

test('the catalogue is frozen, ordered, and every step names its tool, cost basis and provenance label', () => {
  assert.ok(Object.isFrozen(FINISHING_STEPS));
  assert.deepEqual(FINISHING_STEPS.map(s => s.id),
    ['rife-interpolate', 'realesrgan-upscale', 'lanczos-scale', 'grade', 'encode-delivery']);
  for (const step of FINISHING_STEPS) {
    assert.ok(Object.isFrozen(step), `${step.id} is not frozen`);
    assert.deepEqual(Object.keys(step).sort(), ['costModel', 'fixes', 'id', 'label', 'preservesOriginal', 'provenanceLabel', 'tool']);
    assert.ok(step.fixes.length > 0, `${step.id} fixes nothing`);
    assert.equal(typeof step.preservesOriginal, 'boolean');
    assert.equal(typeof step.costModel.seconds, 'function');
    assert.match(step.costModel.basis, /EXTRAPOLATED from/);
    assert.ok(['interpolated', 'upscaled', 'graded', 'encoded'].includes(step.provenanceLabel));
    assert.ok(['ffmpeg', 'rife-ncnn-vulkan', 'realesrgan-ncnn-vulkan'].includes(step.tool));
  }
  assert.throws(() => { FINISHING_STEPS[0].tool = 'imagination'; }, TypeError);
  assert.throws(() => finishingStep('magic-fix'), e => e.code === 'UNKNOWN_FINISHING_STEP');
});

test('cost models reproduce the anchors they were derived from', () => {
  // Replay each anchor through its own model: the rate arithmetic must round-trip.
  const rife = finishingStep('rife-interpolate').costModel.seconds({
    sourceSeconds: ANCHORS.rife.sourceSeconds, width: ANCHORS.rife.width, height: ANCHORS.rife.height, outFps: ANCHORS.rife.targetFps,
  });
  assert.ok(Math.abs(rife - ANCHORS.rife.seconds) < 0.01, `RIFE model gave ${rife}, anchor is ${ANCHORS.rife.seconds}`);

  const esrgan = finishingStep('realesrgan-upscale').costModel.seconds({
    sourceSeconds: ANCHORS.realesrgan.sourceSeconds,
    fps: ANCHORS.realesrgan.inputFrames / ANCHORS.realesrgan.sourceSeconds,
    width: ANCHORS.realesrgan.width, height: ANCHORS.realesrgan.height,
  });
  assert.ok(Math.abs(esrgan - ANCHORS.realesrgan.seconds) < 0.01, `Real-ESRGAN model gave ${esrgan}, anchor is ${ANCHORS.realesrgan.seconds}`);

  const ff = finishingStep('encode-delivery').costModel.seconds({
    sourceSeconds: ANCHORS.ffmpeg.sourceSeconds, outWidth: ANCHORS.ffmpeg.width, outHeight: ANCHORS.ffmpeg.height,
  });
  assert.ok(Math.abs(ff - ANCHORS.ffmpeg.seconds) < 0.01, `FFmpeg model gave ${ff}, anchor is ${ANCHORS.ffmpeg.seconds}`);
  assert.equal(CONTENTION_MULTIPLIER, 20); // 220 s contended / 11 s idle, both measured
});

// --------------------------------------------------------------------------
// buildScaleFilter
// --------------------------------------------------------------------------

test('buildScaleFilter preserves aspect and pads rather than distorting', () => {
  const filter = buildScaleFilter({ fromWidth: 768, fromHeight: 512, toWidth: 1920, toHeight: 1080 });
  assert.match(filter, /force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=1920:1080:\(ow-iw\)\/2:\(oh-ih\)\/2/);
  assert.match(filter, /flags=lanczos/);
  assert.match(filter, /setsar=1/);
  // A bare "scale=W:H" with no aspect clause is the distortion this guards against.
  assert.doesNotMatch(filter, /scale=1920:1080(?!:force_original_aspect_ratio)/);
  // 768x512 (1.5) inside 1920x1080 (1.778) fits on height: 1080/512 = 2.109x.
  assert.ok(Math.abs(scaleFactor({ fromWidth: 768, fromHeight: 512, toWidth: 1920, toHeight: 1080 }) - 2.109375) < 1e-6);
});

test('buildScaleFilter rejects an upscale beyond 4x with a coded error instead of producing mush', () => {
  assert.throws(
    () => buildScaleFilter({ fromWidth: 768, fromHeight: 512, toWidth: 3840, toHeight: 2160 }),
    error => {
      assert.equal(error.code, 'UPSCALE_FACTOR_UNSUPPORTED');
      assert.equal(error.maxFactor, 4);
      assert.ok(error.factor > 4, `factor ${error.factor} should exceed the cap`);
      assert.equal(error.suggestion, 'realesrgan-upscale');
      assert.match(error.message, /768x512 to 3840x2160/);
      return true;
    });
  // Exactly 4x is allowed; a hair past it is not.
  assert.ok(buildScaleFilter({ fromWidth: 768, fromHeight: 512, toWidth: 3072, toHeight: 2048 }));
  assert.throws(() => buildScaleFilter({ fromWidth: 768, fromHeight: 512, toWidth: 3074, toHeight: 2050 }),
    e => e.code === 'UPSCALE_FACTOR_UNSUPPORTED');
  // Downscales are never capped.
  assert.ok(buildScaleFilter({ fromWidth: 3840, fromHeight: 2160, toWidth: 1920, toHeight: 1080 }));
});

test('buildScaleFilter rejects nonsense dimensions and unknown modes', () => {
  assert.throws(() => buildScaleFilter({ fromWidth: 0, fromHeight: 512, toWidth: 1920, toHeight: 1080 }), e => e.code === 'SCALE_DIMENSIONS_INVALID');
  assert.throws(() => buildScaleFilter({ fromWidth: 768.5, fromHeight: 512, toWidth: 1920, toHeight: 1080 }), e => e.code === 'SCALE_DIMENSIONS_INVALID');
  assert.throws(() => buildScaleFilter({ fromWidth: 768, fromHeight: 512, toWidth: 1920, toHeight: 1080, mode: 'ai-magic' }), e => e.code === 'SCALE_MODE_UNSUPPORTED');
});

test('the padded filter really produces the target frame without stretching, measured through ffmpeg', { skip: !HAVE_FFMPEG && 'ffmpeg/ffprobe not on this box' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vyrealm-scale-'));
  try {
    const out = join(dir, 'padded.mp4');
    const filter = buildScaleFilter({ fromWidth: 768, fromHeight: 512, toWidth: 1920, toHeight: 1080 });
    await exec(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=768x512:rate=25:duration=1',
      '-vf', filter, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', out], { windowsHide: true, timeout: 120000 });
    assert.deepEqual({ ...(await probe(out)), durationSeconds: undefined }, { width: 1920, height: 1080, durationSeconds: undefined });
    // cropdetect finds the real content box inside the pad. 768x512 fitted on
    // height is 1620x1080, so the bars are pad, not stretched picture.
    // limit=24 is cropdetect's own default: a lower limit treats the slightly
    // non-zero black of an x264 encode as content and reports the full frame.
    const { stderr } = await exec(FFMPEG, ['-hide_banner', '-i', out, '-vf', 'cropdetect=limit=24:round=2', '-frames:v', '12', '-f', 'null', '-'],
      { windowsHide: true, timeout: 120000 }).catch(e => e);
    const crop = [...String(stderr).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
    assert.ok(crop, 'cropdetect reported no crop box');
    assert.equal(Number(crop[2]), 1080, 'content should fill the full height');
    assert.ok(Math.abs(Number(crop[1]) - 1620) <= 4, `content width ${crop[1]} should be ~1620 (768x512 fitted on height), not 1920`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --------------------------------------------------------------------------
// planFinishing
// --------------------------------------------------------------------------

test('planFinishing orders the chain and prices it against the measured anchors', () => {
  const plan = planFinishing({ source: LTX, target: { width: 1920, height: 1080, fps: 60 }, availableTools: ALL_TOOLS, budgetSeconds: Infinity });
  assert.equal(plan.schemaVersion, 1);
  assert.deepEqual(plan.steps.map(s => s.id), ['rife-interpolate', 'realesrgan-upscale', 'lanczos-scale', 'grade', 'encode-delivery']);
  // Interpolation must precede upscaling: frame-interpolation.mjs refuses >1080p input.
  assert.ok(plan.steps.findIndex(s => s.id === 'rife-interpolate') < plan.steps.findIndex(s => s.id === 'realesrgan-upscale'));
  assert.deepEqual(plan.nativeResolution, { width: 768, height: 512 });
  assert.equal(plan.deliveryMethod, 'realesrgan-x4+lanczos-from-768x512');
  assert.ok(plan.projectedSeconds > 0);
  assert.equal(plan.projectedSecondsUnderContention, Math.round(plan.projectedSeconds * CONTENTION_MULTIPLIER * 10) / 10);
  assert.ok(plan.withinBudget);
  for (const step of plan.steps) assert.match(step.basis, /EXTRAPOLATED/);
});

test('planFinishing respects a tight budget by dropping expensive steps and says which it dropped', () => {
  const generous = planFinishing({ source: LTX, target: { width: 1920, height: 1080, fps: 60 }, availableTools: ALL_TOOLS, budgetSeconds: Infinity });
  const upscale = generous.steps.find(s => s.id === 'realesrgan-upscale');
  assert.ok(upscale.projectedSeconds > 1000, `the x4 upscale should be the expensive step, got ${upscale.projectedSeconds} s`);

  const tight = planFinishing({ source: LTX, target: { width: 1920, height: 1080, fps: 60 }, availableTools: ALL_TOOLS, budgetSeconds: 60 });
  assert.ok(tight.projectedSeconds <= 60, `tight plan projected ${tight.projectedSeconds} s`);
  assert.ok(tight.withinBudget);
  assert.ok(!tight.steps.some(s => s.id === 'realesrgan-upscale'), 'the expensive upscale should have been dropped');

  // Dropped, not silently omitted: id, code and the cost that excluded it.
  const dropped = tight.dropped.find(d => d.id === 'realesrgan-upscale');
  assert.ok(dropped, `dropped list did not name the upscale: ${JSON.stringify(tight.dropped)}`);
  assert.equal(dropped.code, 'OVER_BUDGET');
  assert.equal(dropped.projectedSeconds, upscale.projectedSeconds);
  assert.match(dropped.reason, /60 s budget/);
  // The delivery method changes with it, so the receipt cannot inherit a claim
  // about a pass that never ran.
  assert.equal(tight.deliveryMethod, 'lanczos-from-768x512');
  // Required steps survive: dropping the encode would not be a cheaper delivery.
  assert.ok(tight.steps.some(s => s.id === 'encode-delivery'));
  assert.ok(tight.steps.some(s => s.id === 'lanczos-scale'));

  // A budget nothing can fit says so rather than pretending.
  const impossible = planFinishing({ source: LTX, target: { width: 1920, height: 1080, fps: 60 }, availableTools: ALL_TOOLS, budgetSeconds: 0 });
  assert.equal(impossible.withinBudget, false);
  assert.ok(impossible.notes.some(n => n.code === 'BUDGET_EXCEEDED'));
});

test('planFinishing names missing tools and refuses to fake an unreachable 4K target', () => {
  const noNeural = planFinishing({ source: LTX, target: { width: 3840, height: 2160, fps: 60 }, availableTools: ['ffmpeg'], budgetSeconds: Infinity });
  assert.ok(noNeural.dropped.some(d => d.id === 'realesrgan-upscale' && d.code === 'TOOL_UNAVAILABLE'));
  assert.ok(noNeural.dropped.some(d => d.id === 'rife-interpolate' && d.code === 'TOOL_UNAVAILABLE'));
  // 768x512 to 3840x2160 is 4.22x, past the lanczos cap. The plan delivers the
  // largest honest frame and says why, instead of resampling into mush.
  const note = noNeural.notes.find(n => n.code === 'TARGET_RESOLUTION_UNREACHABLE');
  assert.ok(note, `expected an unreachable-target note, got ${JSON.stringify(noNeural.notes)}`);
  assert.match(note.message, /realesrgan-upscale/);
  assert.ok(noNeural.effectiveTarget.height < 2160);
  assert.ok(scaleFactor({ fromWidth: 768, fromHeight: 512, toWidth: noNeural.effectiveTarget.width, toHeight: noNeural.effectiveTarget.height }) <= 4);
  assert.equal(noNeural.deliveryMethod, 'lanczos-from-768x512');

  const sameSize = planFinishing({ source: LTX, target: { width: 768, height: 512, fps: 25 }, availableTools: ALL_TOOLS, budgetSeconds: Infinity });
  assert.ok(sameSize.dropped.some(d => d.id === 'realesrgan-upscale' && d.code === 'NOT_REQUIRED'));
  assert.ok(sameSize.dropped.some(d => d.id === 'rife-interpolate' && d.code === 'NOT_REQUIRED'));
  assert.equal(sameSize.deliveryMethod, 'native-768x512');
  assert.ok(!sameSize.steps.some(s => s.id === 'lanczos-scale'));
});

test('planFinishing rejects a source it cannot price', () => {
  assert.throws(() => planFinishing({ source: { width: 768, height: 512, fps: 25 }, target: { width: 1920, height: 1080 } }), e => e.code === 'PLAN_INPUT_INVALID');
  assert.throws(() => planFinishing({ source: LTX, target: { width: 1920, height: 1080 }, availableTools: [] }), e => e.code === 'TOOL_UNAVAILABLE');
  assert.throws(() => planFinishing({ source: { ...LTX, width: -8 }, target: { width: 1920, height: 1080 } }), e => e.code === 'SCALE_DIMENSIONS_INVALID');
});

// --------------------------------------------------------------------------
// receipts and evidence
// --------------------------------------------------------------------------

// A receipt shaped exactly as finish() returns one, for the pure-function
// checks that must hold without spending a minute of encoding.
const receiptFor = over => ({
  schemaVersion: 1,
  kind: 'vyrealm.finishing.receipt',
  source: { path: 'C:/shot.mp4', width: 768, height: 512, fps: 25, durationSeconds: 3.88, frames: 97 },
  output: { path: 'C:/out.mp4', width: 1920, height: 1080, fps: 25, durationSeconds: 3.88, frames: 97 },
  nativeResolution: { width: 768, height: 512 },
  deliveryResolution: { width: 1920, height: 1080 },
  deliveryMethod: 'lanczos-from-768x512',
  fpsMethod: 'native-25fps',
  upscaled: true,
  upscaleFactor: 2.1094,
  interpolated: false,
  steps: [{ id: 'lanczos-scale', tool: 'ffmpeg', provenanceLabel: 'upscaled', seconds: 3.2 }],
  totalSeconds: 3.2,
  ...over,
});

test('evidence never reports generationStatus "generated" for an upscaled clip', () => {
  const evidence = finishingEvidence(receiptFor());
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.generationStatus, 'upscaled');
  assert.notEqual(evidence.generationStatus, 'generated');
  assert.deepEqual(evidence.nativeResolution, { width: 768, height: 512, label: '768x512' });
  assert.equal(evidence.deliveryResolution.label, '1920x1080');
  assert.equal(evidence.upscaled, true);
  assert.match(evidence.caveat, /never be described as native 1080p/);
  assert.match(evidence.caveat, /768x512/);

  // The status is measured, not declared: a receipt whose step labels claim
  // nothing happened is still upscaled if the delivered frame is bigger.
  const lying = finishingEvidence(receiptFor({
    upscaled: false, interpolated: false,
    steps: [{ id: 'encode-delivery', tool: 'ffmpeg', provenanceLabel: 'encoded', seconds: 1 }],
  }));
  assert.equal(lying.generationStatus, 'upscaled');
  assert.equal(lying.upscaled, true);
});

test('evidence reports interpolated for a 60 fps pass at native resolution, and generated when nothing was resampled', () => {
  const interpolated = finishingEvidence(receiptFor({
    output: { path: 'C:/out.mp4', width: 768, height: 512, fps: 60, durationSeconds: 3.88, frames: 233 },
    deliveryResolution: { width: 768, height: 512 },
    deliveryMethod: 'native-768x512',
    fpsMethod: 'interpolated-60fps-from-25fps',
    upscaled: false, upscaleFactor: 1, interpolated: true,
    steps: [{ id: 'rife-interpolate', tool: 'rife-ncnn-vulkan', provenanceLabel: 'interpolated', seconds: 15.4 }],
  }));
  assert.equal(interpolated.generationStatus, 'interpolated');
  assert.deepEqual(interpolated.nativeResolution, { width: 768, height: 512, label: '768x512' });
  assert.equal(interpolated.deliveryFps, 60);
  assert.match(interpolated.caveat, /synthesized, not generated/);

  const untouched = finishingEvidence(receiptFor({
    output: { path: 'C:/out.mp4', width: 768, height: 512, fps: 25, durationSeconds: 3.88, frames: 97 },
    deliveryResolution: { width: 768, height: 512 }, deliveryMethod: 'native-768x512',
    upscaled: false, upscaleFactor: 1, interpolated: false,
    steps: [{ id: 'encode-delivery', tool: 'ffmpeg', provenanceLabel: 'encoded', seconds: 1.2 }],
  }));
  assert.equal(untouched.generationStatus, 'generated');
  assert.deepEqual(untouched.nativeResolution, { width: 768, height: 512, label: '768x512' });

  // Both at once: status reports the resolution claim, the fps claim survives
  // as its own field rather than being dropped.
  const both = finishingEvidence(receiptFor({ interpolated: true, fpsMethod: 'interpolated-60fps-from-25fps' }));
  assert.equal(both.generationStatus, 'upscaled');
  assert.equal(both.interpolated, true);
});

test('finishingEvidence refuses a receipt with no measured provenance', () => {
  assert.throws(() => finishingEvidence({}), e => e.code === 'EVIDENCE_INPUT_INVALID');
  assert.throws(() => finishingEvidence(receiptFor({ deliveryMethod: null })), e => e.code === 'EVIDENCE_INPUT_INVALID');
  assert.throws(() => finishingEvidence(receiptFor({ steps: undefined })), e => e.code === 'EVIDENCE_INPUT_INVALID');
});

test('finish refuses neural steps rather than skipping them and writing a receipt anyway', async () => {
  await assert.rejects(
    () => finish({ source: join(SHOTS, 'forest-light.mp4'), output: join(tmpdir(), 'never-written.mp4'), steps: ['realesrgan-upscale'], workDir: tmpdir() }),
    error => {
      assert.equal(error.code, 'NEURAL_STEP_NOT_EXECUTED_HERE');
      assert.match(error.message, /realesrgan-ncnn-vulkan/);
      return true;
    });
  await assert.rejects(
    () => finish({ source: join(SHOTS, 'forest-light.mp4'), output: join(tmpdir(), 'never-written.mp4'), steps: ['rife-interpolate'], workDir: tmpdir() }),
    error => error.code === 'NEURAL_STEP_NOT_EXECUTED_HERE' && /frame-interpolation\.mjs/.test(error.message));
  await assert.rejects(() => finish({ source: 'a.mp4', output: 'a.mp4', steps: ['grade'], workDir: tmpdir() }), e => e.code === 'FINISH_INPUT_INVALID');
  await assert.rejects(() => finish({ source: join(SHOTS, 'no-such-clip.mp4'), output: join(tmpdir(), 'x.mp4'), steps: ['grade'], workDir: tmpdir() }), e => e.code === 'FINISH_SOURCE_MISSING');
});

// --------------------------------------------------------------------------
// integration: a real clip, real FFmpeg, measured output
// --------------------------------------------------------------------------

test('finishes a real generated clip and measures what it actually produced', { timeout: 600000 }, async t => {
  const shot = await firstUsableShot();
  if (!shot) return t.skip(`no decodable clip in ${SHOTS} (and ffmpeg ${HAVE_FFMPEG ? 'is' : 'is not'} present)`);

  const dir = await mkdtemp(join(tmpdir(), 'vyrealm-finish-'));
  try {
    const output = join(dir, 'delivery.mp4');
    const progress = [];
    const plan = planFinishing({
      source: { width: shot.width, height: shot.height, fps: 25, durationSeconds: shot.durationSeconds },
      target: { width: 1920, height: 1080 },
      availableTools: ['ffmpeg'],
      budgetSeconds: Infinity,
    });
    const steps = plan.steps.filter(s => s.tool === 'ffmpeg').map(s => ({ id: s.id, params: s.params }));
    assert.deepEqual(steps.map(s => s.id), ['lanczos-scale', 'grade', 'encode-delivery']);

    const receipt = await finish({ source: shot.path, output, steps, workDir: dir, ffmpeg: FFMPEG, ffprobe: FFPROBE, onProgress: p => progress.push(p.stepId) });

    // Measured, not asserted from the plan: probe the delivered file directly.
    const delivered = await probe(output);
    assert.deepEqual({ width: delivered.width, height: delivered.height }, { width: 1920, height: 1080 });
    assert.equal(receipt.output.width, delivered.width);
    assert.equal(receipt.output.height, delivered.height);
    assert.ok(Math.abs(delivered.durationSeconds - shot.durationSeconds) < 0.5,
      `delivered ${delivered.durationSeconds} s against a ${shot.durationSeconds} s source`);

    // The honesty payload.
    assert.deepEqual(receipt.nativeResolution, { width: shot.width, height: shot.height });
    assert.equal(receipt.deliveryMethod, `lanczos-from-${shot.width}x${shot.height}`);
    assert.ok(receipt.deliveryMethod.includes(`${shot.width}x${shot.height}`), 'deliveryMethod must name the true source resolution');
    assert.doesNotMatch(receipt.deliveryMethod, /^(4K|1080p|native-1920x1080)$/);
    assert.equal(receipt.upscaled, true);

    // Per-step seconds are real elapsed time, and they add up.
    assert.deepEqual(receipt.steps.map(s => s.id), ['lanczos-scale', 'grade', 'encode-delivery']);
    for (const step of receipt.steps) assert.ok(step.seconds > 0, `${step.id} recorded ${step.seconds} s`);
    assert.ok(Math.abs(receipt.totalSeconds - receipt.steps.reduce((s, x) => s + x.seconds, 0)) < 0.01);
    assert.deepEqual(progress, ['lanczos-scale', 'grade', 'encode-delivery']);

    const evidence = finishingEvidence(receipt);
    assert.equal(evidence.generationStatus, 'upscaled');
    assert.notEqual(evidence.generationStatus, 'generated');
    assert.equal(evidence.nativeResolution.label, `${shot.width}x${shot.height}`);
    assert.equal(evidence.deliveryResolution.label, '1920x1080');

    // Report the real numbers this run produced; they are the point of the test.
    console.log(`  measured: ${shot.path} ${shot.width}x${shot.height} ${shot.durationSeconds}s -> 1920x1080 ${delivered.durationSeconds}s in ${receipt.totalSeconds}s ` +
      `(${receipt.steps.map(s => `${s.id} ${s.seconds}s`).join(', ')}); projected ${plan.projectedSeconds}s`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// --------------------------------------------------------------------------
// provenance leaks that survived the first pass
// --------------------------------------------------------------------------

test('a frame-rate bump without interpolation is never reported as generated', () => {
  // 25 -> 60 fps through encode-delivery's -r is FRAME DUPLICATION. The frame
  // count grows, the imagery does not. MEASURED on this box through this exact
  // path: desert-monolith 97 frames at 25 fps became 233 frames at 60 fps.
  const duplicated = finishingEvidence(receiptFor({
    output: { path: 'C:/out.mp4', width: 768, height: 512, fps: 60, durationSeconds: 3.88, frames: 233 },
    deliveryResolution: { width: 768, height: 512 }, deliveryMethod: 'native-768x512',
    fpsMethod: 'resampled-60fps-from-25fps', upscaled: false, upscaleFactor: 1, interpolated: false,
    steps: [{ id: 'encode-delivery', tool: 'ffmpeg', provenanceLabel: 'encoded', seconds: 2.7 }],
    origin: { width: 768, height: 512, method: 'ltx-2b-distilled' },
  }));
  assert.notEqual(duplicated.generationStatus, 'generated');
  assert.equal(duplicated.generationStatus, 'resampled');
  assert.equal(duplicated.fpsResampled, true);
  assert.doesNotMatch(duplicated.caveat, /No resampling or interpolation was applied/);
  assert.match(duplicated.caveat, /duplicate/i);
  assert.match(duplicated.caveat, /25/);
  assert.match(duplicated.caveat, /60/);
});

test('a downscaled delivery is not native, and the caveat names the frame actually delivered', () => {
  const shrunk = finishingEvidence(receiptFor({
    output: { path: 'C:/out.mp4', width: 384, height: 256, fps: 25, durationSeconds: 3.88, frames: 97 },
    deliveryResolution: { width: 384, height: 256 }, deliveryMethod: 'lanczos-from-768x512',
    upscaled: false, upscaleFactor: 0.5, interpolated: false,
    steps: [{ id: 'lanczos-scale', tool: 'ffmpeg', provenanceLabel: 'upscaled', seconds: 1.1 }],
    origin: { width: 768, height: 512, method: 'ltx-2b-distilled' },
  }));
  assert.equal(shrunk.generationStatus, 'resampled');
  assert.doesNotMatch(shrunk.caveat, /No resampling or interpolation was applied/);
  assert.match(shrunk.caveat, /384x256/);
  assert.match(shrunk.caveat, /768x512/);
});

test('an upscaled AND interpolated delivery discloses both, not just the resolution', () => {
  const both = finishingEvidence(receiptFor({
    output: { path: 'C:/out.mp4', width: 1920, height: 1080, fps: 60, durationSeconds: 3.88, frames: 233 },
    interpolated: true, fpsMethod: 'interpolated-60fps-from-25fps',
    steps: [
      { id: 'rife-interpolate', tool: 'rife-ncnn-vulkan', provenanceLabel: 'interpolated', seconds: 15.4 },
      { id: 'lanczos-scale', tool: 'ffmpeg', provenanceLabel: 'upscaled', seconds: 3.2 },
    ],
    origin: { width: 768, height: 512, method: 'ltx-2b-distilled' },
  }));
  assert.equal(both.generationStatus, 'upscaled');
  assert.equal(both.interpolated, true);
  assert.match(both.caveat, /never be described as native 1080p/);
  assert.match(both.caveat, /synthesized/, 'the interpolation disclosure must survive alongside the upscale one');
});

test('evidence says out loud when the source file provenance was never verified', () => {
  // finish() measures what it did; it cannot know how the file it was handed
  // was made. An unverified input must not come out the far end reading
  // "generated", because generationStatus "generated" is the pass value other
  // modules gate on (apply-generated-shot.mjs, generation-delivery.mjs) and the
  // string flagship-catalogue.mjs prints as "Generated locally".
  const unverified = finishingEvidence(receiptFor({
    output: { path: 'C:/out.mp4', width: 768, height: 512, fps: 25, durationSeconds: 3.88, frames: 97 },
    deliveryResolution: { width: 768, height: 512 }, deliveryMethod: 'native-768x512',
    upscaled: false, upscaleFactor: 1, interpolated: false,
    steps: [{ id: 'encode-delivery', tool: 'ffmpeg', provenanceLabel: 'encoded', seconds: 1.2 }],
  }));
  assert.equal(unverified.sourceProvenanceVerified, false);
  assert.notEqual(unverified.generationStatus, 'generated');
  assert.equal(unverified.generationStatus, 'unverified-source');
  assert.match(unverified.caveat, /not verified/i);

  const asserted = finishingEvidence(receiptFor({
    output: { path: 'C:/out.mp4', width: 768, height: 512, fps: 25, durationSeconds: 3.88, frames: 97 },
    deliveryResolution: { width: 768, height: 512 }, deliveryMethod: 'native-768x512',
    upscaled: false, upscaleFactor: 1, interpolated: false,
    steps: [{ id: 'encode-delivery', tool: 'ffmpeg', provenanceLabel: 'encoded', seconds: 1.2 }],
    origin: { width: 768, height: 512, method: 'ltx-2b-distilled' },
  }));
  assert.equal(asserted.sourceProvenanceVerified, true);
  assert.equal(asserted.generationStatus, 'generated');
});

test('a declared origin can only reveal earlier enlargement, never launder one away', () => {
  // The honest use: a clip already run through Real-ESRGAN outside this module
  // (which finish() tells you to do) is 3072x2048 on disk but 768x512 native.
  const revealed = finishingEvidence(receiptFor({
    source: { path: 'C:/up.mp4', width: 3072, height: 2048, fps: 25, durationSeconds: 3.88, frames: 97 },
    output: { path: 'C:/out.mp4', width: 1920, height: 1080, fps: 25, durationSeconds: 3.88, frames: 97 },
    nativeResolution: { width: 768, height: 512 },
    deliveryResolution: { width: 1920, height: 1080 },
    deliveryMethod: 'realesrgan-x4+lanczos-from-768x512',
    upscaled: true, upscaleFactor: 2.1094, interpolated: false,
    origin: { width: 768, height: 512, method: 'realesrgan-x4' },
    steps: [{ id: 'lanczos-scale', tool: 'ffmpeg', provenanceLabel: 'upscaled', seconds: 3.2 }],
  }));
  assert.equal(revealed.generationStatus, 'upscaled');
  assert.deepEqual(revealed.nativeResolution, { width: 768, height: 512, label: '768x512' });

  // The laundering attempt: claim a bigger native than the file ever was, so a
  // 768x512 -> 1920x1080 upscale could read as a downscale from 4K.
  const laundered = finishingEvidence(receiptFor({
    nativeResolution: { width: 4096, height: 4096 },
    origin: { width: 4096, height: 4096, method: 'imagination' },
  }));
  assert.equal(laundered.generationStatus, 'upscaled', 'a declared origin larger than the measured source must be ignored');
  assert.deepEqual(laundered.nativeResolution, { width: 768, height: 512, label: '768x512' });
});

test('planFinishing warns that a 60 fps target without RIFE is frame duplication', () => {
  const noRife = planFinishing({ source: LTX, target: { width: 1920, height: 1080, fps: 60 }, availableTools: ['ffmpeg'], budgetSeconds: Infinity });
  assert.ok(!noRife.steps.some(s => s.id === 'rife-interpolate'));
  assert.equal(noRife.steps.find(s => s.id === 'encode-delivery').params.fps, 60);
  const note = noRife.notes.find(n => n.code === 'FPS_TARGET_WITHOUT_INTERPOLATION');
  assert.ok(note, `a 60 fps encode with no interpolation step must be named: ${JSON.stringify(noRife.notes)}`);
  assert.match(note.message, /duplicat/i);

  // With RIFE in the chain there is nothing to warn about.
  const withRife = planFinishing({ source: LTX, target: { width: 1920, height: 1080, fps: 60 }, availableTools: ALL_TOOLS, budgetSeconds: Infinity });
  assert.ok(!withRife.notes.some(n => n.code === 'FPS_TARGET_WITHOUT_INTERPOLATION'));
});

test('finish re-derives the scale filter from the measured input, so a stale plan cannot smuggle an over-cap upscale', { skip: !HAVE_FFMPEG && 'ffmpeg/ffprobe not on this box' }, async t => {
  const shot = await firstUsableShot();
  if (!shot) return t.skip(`no decodable clip in ${SHOTS}`);
  const dir = await mkdtemp(join(tmpdir(), 'vyrealm-stale-'));
  try {
    // A filter string built when the plan believed the source was 1920x1080
    // (a legal 2x to 3840x2160), handed to finish() with a 768x512 file: that
    // is a 4.2x lanczos upscale the cap exists to refuse.
    const stale = buildScaleFilter({ fromWidth: 1920, fromHeight: 1080, toWidth: 3840, toHeight: 2160 });
    await assert.rejects(
      () => finish({
        source: shot.path, output: join(dir, 'smuggled.mp4'), workDir: dir,
        ffmpeg: FFMPEG, ffprobe: FFPROBE,
        steps: [{ id: 'lanczos-scale', params: { toWidth: 3840, toHeight: 2160, mode: 'lanczos', filter: stale } }],
      }),
      e => e.code === 'UPSCALE_FACTOR_UNSUPPORTED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
