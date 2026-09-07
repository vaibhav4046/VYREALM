/**
 * Render a format-library production plan to a real MP4.
 *
 * Each beat is rendered on its own, then the beats are concatenated. That is
 * slower than one large filtergraph but it fails loudly on the beat that
 * broke, which matters when a batch of a hundred plans is running unattended.
 *
 * This module composites EXISTING footage. It never generates pixels and it
 * never invents a source: a plan whose shot roles are unresolved is refused
 * before FFmpeg is invoked.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAMERA_MOVES, GRADES } from './format-library.mjs';
import { planSourceExtension, buildExtensionFilter, extensionProvenance } from './format-sourcing.mjs';
import { buildCueList, buildCaptionFilter, captionEvidence } from './format-captions.mjs';
import { planAudioSources, buildAudioFilter, silentTrackArgs, audioEvidence } from './format-audio.mjs';

/**
 * FFmpeg on this machine has no fontconfig default ("Cannot load default config
 * file"), so drawtext must be handed an explicit font. Segoe UI Bold ships with
 * Windows and reads well at caption weight.
 */
export const DEFAULT_CAPTION_FONT = process.env.VYRELUM_CAPTION_FONT || 'C:/Windows/Fonts/segoeuib.ttf';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_FFMPEG = process.env.VYRELUM_FFMPEG || join(root, 'workers/tools/ffmpeg.exe');
export const DEFAULT_FFPROBE = process.env.VYRELUM_FFPROBE || join(root, 'workers/tools/ffprobe.exe');

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let err = '';
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.slice(-2000) || `exit ${code}`)));
  });
}

/**
 * Build the filter chain for one beat: cover-fit to canvas, apply the camera
 * move as a zoompan, then the grade. Returns a single -vf string.
 */
export function beatFilter({ move, grade, width, height, fps, durationSeconds, extensionFilter = null }) {
  const camera = CAMERA_MOVES[move];
  if (!camera) throw new RangeError(`unknown camera move ${move}`);
  const look = GRADES[grade];
  if (!look) throw new RangeError(`unknown grade ${grade}`);

  const frames = Math.max(1, Math.round(durationSeconds * fps));
  // Oversample so the zoompan crop never runs past the source edge.
  const pad = 1.35;
  const sw = Math.round(width * pad / 2) * 2;
  const sh = Math.round(height * pad / 2) * 2;

  // Resample to the target rate BEFORE zoompan. zoompan with d=1 emits one
  // output frame per input frame; its own fps option only labels the output
  // stream. Without this a 24fps source yields 0.8x the requested duration.
  // Order matters. Frame-rate conversion first so the source runs at the target
  // rate; then any source extension, because loop counts FRAMES and would
  // repeat the wrong span at the source's native rate; then framing.
  const chain = [`fps=${fps}`];
  if (extensionFilter) chain.push(extensionFilter);
  chain.push(
    `scale=${sw}:${sh}:force_original_aspect_ratio=increase`,
    `crop=${sw}:${sh}`
  );

  // Drive zoom from the output frame index rather than accumulating, so a
  // pull-out actually starts wide and closes. zoompan seeds `zoom` at 1.0,
  // which makes the incremental form a no-op in the negative direction.
  const span = Math.abs(camera.zoom);
  const zExpr = camera.zoom === 0
    ? '1.001'
    : camera.zoom > 0
      ? `1+${span.toFixed(4)}*on/${frames}`
      : `${(1 + span).toFixed(4)}-${span.toFixed(4)}*on/${frames}`;

  // on/od are zoompan's normalised progress; pan is expressed as a fraction
  // of the frame so it reads the same at any canvas size.
  const px = camera.panX / 2;
  const py = camera.panY / 2;
  const xExpr = `iw/2-(iw/zoom/2)+(${px.toFixed(5)}*iw*on/${frames})`;
  const yExpr = `ih/2-(ih/zoom/2)+(${py.toFixed(5)}*ih*on/${frames})`;

  chain.push(
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${width}x${height}:fps=${fps}`
  );

  if (look.saturation !== 1 || look.contrast !== 1) {
    chain.push(`eq=saturation=${look.saturation}:contrast=${look.contrast}`);
  }
  if (look.temperature !== 0) {
    const warm = look.temperature;
    chain.push(`colorbalance=rs=${(warm * 0.4).toFixed(3)}:bs=${(-warm * 0.4).toFixed(3)}`);
  }
  if (look.grain > 0) {
    chain.push(`noise=alls=${Math.round(look.grain * 100)}:allf=t`);
  }
  chain.push('setsar=1', 'format=yuv420p');
  return chain.join(',');
}

/** Refuse a plan we cannot honestly render. */
export function assertRenderable(plan, shotLibrary) {
  if (!plan?.timeline?.length) throw new Error('PLAN_EMPTY');
  const missing = [];
  for (const beat of plan.timeline) {
    if (beat.shotRole === 'black') continue;
    const shot = shotLibrary[beat.shotRole];
    if (!shot) { missing.push(beat.shotRole); continue; }
    if (!existsSync(shot.path)) missing.push(`${beat.shotRole} (missing file ${shot.path})`);
  }
  if (missing.length) {
    const error = new Error(`PLAN_NOT_RENDERABLE: unresolved shot roles: ${[...new Set(missing)].join(', ')}`);
    error.code = 'PLAN_NOT_RENDERABLE';
    error.missing = [...new Set(missing)];
    throw error;
  }
}

/** Measured duration of a media file, in seconds. */
export async function probeDurationSeconds(path, ffprobe = DEFAULT_FFPROBE) {
  const out = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  const seconds = Number(String(out).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`PROBE_FAILED: ${path}`);
  return seconds;
}

/**
 * Verify each beat has enough real footage behind it.
 *
 * FFmpeg silently returns a SHORT clip when `-t` exceeds what remains after
 * `-ss`, which would let a 105-second beat quietly become 10 seconds of
 * output. Checking existence alone is not enough; this checks supply.
 */
export async function assertSufficientFootage(plan, shotLibrary, ffprobe = DEFAULT_FFPROBE) {
  const cache = new Map();
  const short = [];
  for (const beat of plan.timeline) {
    if (beat.shotRole === 'black') continue;
    const shot = shotLibrary[beat.shotRole];
    if (!cache.has(shot.path)) cache.set(shot.path, await probeDurationSeconds(shot.path, ffprobe));
    const total = cache.get(shot.path);
    const available = total - (shot.inPoint ?? 0);
    if (available + 1e-3 < beat.durationSeconds) {
      short.push(`${beat.shotRole} beat "${beat.role}" needs ${beat.durationSeconds}s but only ${available.toFixed(2)}s remains after in-point ${shot.inPoint ?? 0}s`);
    }
  }
  if (short.length) {
    const error = new Error(`INSUFFICIENT_FOOTAGE: ${short.join('; ')}`);
    error.code = 'INSUFFICIENT_FOOTAGE';
    error.shortfalls = short;
    throw error;
  }
}

/**
 * Decide, per beat, how to cover the requested duration from the footage that
 * actually exists.
 *
 * With allowExtension=false this is just the strict check above. With it on, a
 * short source is covered by a declared editing technique (slow, ping-pong,
 * loop) and the synthetic seconds are recorded, so the output still states
 * plainly which of its duration is original footage. A gap no strategy can
 * cover honestly still refuses.
 */
export async function planBeatSources(plan, shotLibrary, { ffprobe = DEFAULT_FFPROBE, allowExtension = false, maxSlowFactor = 2 } = {}) {
  const cache = new Map();
  const beats = [];
  const refusals = [];
  for (const beat of plan.timeline) {
    if (beat.shotRole === 'black') { beats.push({ beat, extension: null, availableSeconds: null }); continue; }
    const shot = shotLibrary[beat.shotRole];
    if (!cache.has(shot.path)) cache.set(shot.path, await probeDurationSeconds(shot.path, ffprobe));
    const available = cache.get(shot.path) - (shot.inPoint ?? 0);

    if (available + 1e-3 >= beat.durationSeconds) {
      beats.push({ beat, extension: null, availableSeconds: available });
      continue;
    }
    if (!allowExtension) {
      refusals.push(`${beat.shotRole} beat "${beat.role}" needs ${beat.durationSeconds}s but only ${available.toFixed(2)}s remains`);
      continue;
    }
    const extension = planSourceExtension({
      availableSeconds: available,
      neededSeconds: beat.durationSeconds,
      maxSlowFactor,
      fps: plan.canvas.fps
    });
    if (!extension.honest || extension.strategy === 'refuse') {
      refusals.push(`${beat.shotRole} beat "${beat.role}" needs ${beat.durationSeconds}s from ${available.toFixed(2)}s and no honest strategy covers it (${extension.reason ?? 'refused'})`);
      continue;
    }
    beats.push({ beat, extension, availableSeconds: available });
  }
  if (refusals.length) {
    const error = new Error(`INSUFFICIENT_FOOTAGE: ${refusals.join('; ')}`);
    error.code = 'INSUFFICIENT_FOOTAGE';
    error.shortfalls = refusals;
    throw error;
  }
  return beats;
}

/**
 * Render one plan. Returns measured facts about what was actually written,
 * read back off the file rather than assumed from the request.
 */
export async function renderPlan({
  plan,
  shotLibrary,
  output,
  workDir,
  ffmpeg = DEFAULT_FFMPEG,
  ffprobe = DEFAULT_FFPROBE,
  onProgress = () => {},
  allowExtension = false,
  maxSlowFactor = 2,
  captionText = null,
  captionFont = DEFAULT_CAPTION_FONT,
  audioSources = null
}) {
  assertRenderable(plan, shotLibrary);
  const sourcePlan = await planBeatSources(plan, shotLibrary, { ffprobe, allowExtension, maxSlowFactor });
  const { width, height, fps } = plan.canvas;
  await mkdir(workDir, { recursive: true });
  await mkdir(dirname(output), { recursive: true });

  const started = Date.now();
  const segments = [];

  const extensions = [];
  for (const [index, entry] of sourcePlan.entries()) {
    const { beat, extension, availableSeconds } = entry;
    const segment = join(workDir, `beat-${String(index).padStart(3, '0')}.mp4`);

    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (beat.shotRole === 'black') {
      args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${beat.durationSeconds}`);
      args.push('-vf', 'setsar=1,format=yuv420p');
    } else {
      const shot = shotLibrary[beat.shotRole];
      const extensionFilter = extension && extension.strategy !== 'none'
        ? buildExtensionFilter({ ...extension, availableSeconds, neededSeconds: beat.durationSeconds, fps })
        : null;
      // When extending, read ALL remaining footage; the extension filter is
      // what produces the beat's full duration from it.
      const readSeconds = extensionFilter ? availableSeconds : beat.durationSeconds;
      args.push('-ss', String(shot.inPoint ?? 0), '-t', String(readSeconds), '-i', shot.path);
      args.push('-vf', beatFilter({
        move: beat.motion,
        grade: plan.grade.id,
        width, height, fps,
        durationSeconds: beat.durationSeconds,
        extensionFilter
      }));
      if (extensionFilter) {
        extensions.push({ beatIndex: index, role: beat.role, shotRole: beat.shotRole, ...extensionProvenance({ ...extension, availableSeconds, neededSeconds: beat.durationSeconds }) });
      }
    }
    args.push('-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-r', String(fps), '-t', String(beat.durationSeconds), segment);

    await run(ffmpeg, args);
    segments.push(segment);
    onProgress({ stage: 'beat', index, total: sourcePlan.length, role: beat.role });
  }

  const listPath = join(workDir, 'concat.txt');
  await writeFile(listPath, segments.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'), 'utf8');

  // Captions are timed across the whole cut, not per beat, so they are burned
  // after the concat rather than into each segment.
  let captions = null;
  const wantsCaptions = captionText && plan.captionStyle?.id && plan.captionStyle.id !== 'none';
  const concatTarget = wantsCaptions ? join(workDir, 'concat.mp4') : output;
  await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', listPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', concatTarget]);

  if (wantsCaptions) {
    const cues = buildCueList({ text: captionText, durationSeconds: plan.durationSeconds, style: plan.captionStyle.id });
    const filter = buildCaptionFilter({
      cues,
      style: plan.captionStyle.id,
      canvas: plan.canvas,
      safeArea: plan.safeArea,
      fontFile: captionFont
    });
    await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', concatTarget,
      '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-r', String(fps), output]);
    captions = captionEvidence({ cues, style: plan.captionStyle.id });
  }

  // Audio last, over the finished picture. A silent cut reads as unfinished no
  // matter how good the framing is, so a bed with no supplied source still gets
  // a real silent track rather than no audio stream at all.
  let audio = null;
  if (audioSources) {
    const staged = join(workDir, 'with-audio.mp4');
    const plannedSources = planAudioSources(plan.audio.id, audioSources);
    const usable = ['music', 'narration', 'ambience'].filter(kind => plannedSources[kind]);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', output];

    if (usable.length === 0) {
      args.push(...silentTrackArgs(plan.durationSeconds));
      args.push('-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', staged);
      audio = { schemaVersion: 1, bedId: plan.audio.id, streams: [], silent: true, missing: plannedSources.missing };
    } else {
      const inputs = usable.map((kind, i) => {
        args.push('-i', plannedSources[kind]);
        return { kind, index: i + 1 };
      });
      const { filter, outLabel } = buildAudioFilter({ bed: plan.audio.id, inputs, durationSeconds: plan.durationSeconds });
      args.push('-filter_complex', filter, '-map', '0:v', '-map', `[${outLabel}]`,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', staged);
      audio = audioEvidence({ bed: plan.audio.id, inputs, durationSeconds: plan.durationSeconds });
    }
    await run(ffmpeg, args);
    await rm(output, { force: true });
    await rename(staged, output);
  }

  const probe = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets',
    '-count_packets', '-of', 'json', output]);
  const stream = JSON.parse(probe).streams?.[0] ?? {};
  const [num, den] = String(stream.r_frame_rate ?? '0/1').split('/').map(Number);
  const measuredFps = den ? num / den : 0;
  const measuredFrames = Number(stream.nb_read_packets ?? 0);

  await rm(workDir, { recursive: true, force: true });

  return {
    schemaVersion: 1,
    output,
    formatId: plan.formatId,
    platform: plan.platform,
    requestedSeconds: plan.durationSeconds,
    measured: {
      width: Number(stream.width ?? 0),
      height: Number(stream.height ?? 0),
      fps: measuredFps,
      frames: measuredFrames,
      seconds: measuredFps ? Number((measuredFrames / measuredFps).toFixed(3)) : 0
    },
    beats: plan.timeline.length,
    renderMs: Date.now() - started,
    sourceMethod: 'composited-from-existing-footage',
    generationStatus: 'composited',
    extensions,
    captions,
    audio,
    syntheticSeconds: Number(extensions.reduce((n, e) => n + (e.syntheticSeconds || 0), 0).toFixed(3)),
    note: extensions.length
      ? 'No pixels were generated by this module. Some beats were time-extended from shorter sources; see extensions[] for which beats and how much of their duration is time-manipulated rather than original footage.'
      : 'No pixels were generated by this module. Every frame derives from the supplied source shots at their original timing.'
  };
}
