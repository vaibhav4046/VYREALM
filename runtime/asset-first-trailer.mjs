import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMedia } from './media-verifier.mjs';
import { inspectRender } from './quality-inspection.mjs';

const SHOTS = [
  { id: 'rain-market-close', caption: 'Did you hear that?', camera: 'close handheld reaction in a rain-soaked night market', asset: 'rain-market-close.png', subject: 'original woman with wet hair and textured jacket', environment: 'neon night market', foreground: 'rain and out-of-focus stalls', background: 'lit awnings and bokeh', lighting: 'cyan practicals with warm rim' },
  { id: 'rain-market-run', caption: 'Run.', camera: 'tracking move as she runs through the market', asset: 'rain-market-run.png', subject: 'same woman and wardrobe in motion', environment: 'rainy market aisle', foreground: 'posts and rain crossing lens', background: 'receding stalls and signs', lighting: 'mixed neon reflections' },
  { id: 'rain-market-shelter', caption: 'Not yet.', camera: 'slow push-in as she looks back from shelter', asset: 'rain-market-shelter.png', subject: 'same woman with expressive face', environment: 'covered market shelter', foreground: 'shelter frame and wet shoulder', background: 'distant lights and falling rain', lighting: 'soft practical key and blue edge' }
];

const run = (cmd, args, timeout = 180_000) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let err = '';
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} rejectRun(new Error(`${cmd} timed out`)); }, timeout);
  child.stderr.on('data', x => { err += x.toString(); if (err.length > 5000) err = err.slice(-5000); });
  child.on('error', e => { clearTimeout(timer); rejectRun(e); });
  child.on('close', code => { clearTimeout(timer); code ? rejectRun(new Error(`${cmd} exited ${code}: ${err.slice(-1800)}`)) : resolveRun(); });
});

function shotFilter(index, fps, width, height, shotDuration = 5) {
  const direction = index % 2 ? 1 : -1;
  const zoom = `zoompan=z='min(zoom+0.0012,1.14)':x='iw/2-(iw/zoom/2)+${direction}*on*0.10':y='ih/2-(ih/zoom/2)':d=${Math.round(fps * shotDuration)}:s=${width}x${height}:fps=${fps}`;
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${zoom},format=yuv420p`;
}

function rejectPlaceholder({ files, keyframes = [], sourceMethod, durationSeconds, requestedDurationSeconds, expectedShotCount = 3 }) {
  const reasons = [];
  if (!['local-generated-keyframes', 'local-textured-raster-keyframes', 'bundled-development-keyframes', 'bundled-development-generated-keyframes', 'fallback-asset-first-keyframes', 'imported-local-media'].includes(sourceMethod)) reasons.push('ASSET_SOURCE_UNQUALIFIED');
  if (keyframes.length && keyframes.some(file => !String(file).toLowerCase().endsWith('.png'))) reasons.push('KEYFRAME_ASSET_MISSING');
  if (files.some(file => /primitive|debug|placeholder|polygon|ring/i.test(file))) reasons.push('DEFAULT_PRIMITIVE_VISIBLE');
  if (durationSeconds + 0.12 < requestedDurationSeconds) reasons.push('DURATION_SHORT');
  if (expectedShotCount && files.length !== expectedShotCount) reasons.push('SHOT_COUNT_INVALID');
  if (reasons.length) throw new Error(`CINEMATIC_REJECTED: ${reasons.join(',')}`);
}

const bundledAssetDir = resolve(fileURLToPath(new URL('./assets/cinematic', import.meta.url)));
export async function renderAssetFirstTrailer({ output, ffmpeg, ffprobe, assetDir = bundledAssetDir, width = 1920, height = 1080, fps = 24, durationSeconds = 15, captions = false, shots = SHOTS, sourceMethod = 'bundled-development-generated-keyframes' } = {}) {
  if (!output || !ffmpeg || !ffprobe) throw new Error('output, ffmpeg, and ffprobe are required');
  if (durationSeconds < 15) throw new Error('Asset-first trailer requires at least 15 seconds');
  const out = resolve(output); await mkdir(out, { recursive: true });
  const shotList = Array.isArray(shots) && shots.length ? shots : SHOTS;
  const shotDuration = Number(durationSeconds) / shotList.length;
  const shotDir = join(out, 'shots'); await mkdir(shotDir, { recursive: true });
  const shotFiles = [], keyframes = [];
  for (const [i, shot] of shotList.entries()) {
    const source = shot.path ? resolve(shot.path) : join(assetDir, shot.asset); if (!existsSync(source)) throw new Error(`CINEMATIC_ASSET_MISSING: ${shot.asset || source}`);
    let keyframe = source;
    const sourceExt = extname(source).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(sourceExt)) {
      // User footage is accepted as a source, but this fallback deliberately
      // extracts a checked keyframe before applying deterministic camera motion.
      // Full image-to-video animation remains a separately qualified adapter.
      keyframe = join(shotDir, `${String(i + 1).padStart(2, '0')}-${shot.id}-source.png`);
      await run(ffmpeg, ['-y', '-ss', '0', '-i', source, '-frames:v', '1', '-vf', 'format=rgb24', keyframe]);
    }
    keyframes.push(keyframe);
    const target = join(shotDir, `${String(i + 1).padStart(2, '0')}-${shot.id}.mp4`);
    await run(ffmpeg, ['-y', '-loop', '1', '-i', keyframe, '-t', String(shotDuration), '-vf', shotFilter(i, fps, width, height, shotDuration), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', target]);
    shotFiles.push(target);
  }
  const concat = join(out, 'shots.ffconcat');
  await writeFile(concat, `ffconcat version 1.0\n${shotFiles.map(file => `file '${file.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n')}\n`);
  const silentVideo = join(out, 'picture.mp4');
  await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', silentVideo]);
  const captionsFile = join(out, 'captions.srt');
  await writeFile(captionsFile, captions ? shotList.map((shot, i) => { const start=i*shotDuration,end=(i+1)*shotDuration; const stamp=t=>{const ms=Math.round(t*1000),s=Math.floor(ms/1000);return `00:00:${String(s%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}; return `${i+1}\n${stamp(start)} --> ${stamp(end)}\n${shot.caption || ''}\n`; }).join('\n') : '');
  const final = join(out, 'trailer-1080p.mp4');
  const fadeOut=Math.max(1,Number(durationSeconds)-2); const audio = `anoisesrc=color=pink:amplitude=0.018:sample_rate=48000:duration=${durationSeconds},highpass=f=500,lowpass=f=9000[a0];sine=frequency=58:sample_rate=48000:duration=${durationSeconds},volume=0.07[a1];sine=frequency=196:sample_rate=48000:duration=${durationSeconds},volume=0.025[a2];[a0][a1][a2]amix=inputs=3:duration=longest,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOut}:d=2,aresample=48000[a]`;
  await run(ffmpeg, ['-y', '-i', silentVideo, '-filter_complex', audio, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest', final]);
  const verification = await verifyMedia({ videoPath: final, ffprobe, ffmpeg, expected: { width, height, fps, durationSeconds, requireAudio: true, requireVisual: true }, captionsPath: captionsFile, requireCaptions: captions });
  if (!verification.ok) throw new Error(`CINEMATIC_REJECTED: ${verification.diagnostics.map(d => d.code).join(',')}`);
  const probe = JSON.parse(await new Promise((res, rej) => { const p = spawn(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', final], { windowsHide: true }); let s = ''; p.stdout.on('data', x => s += x); p.on('error', rej); p.on('close', c => c ? rej(new Error('ffprobe failed')) : res(s)); }));
  const duration = Number(probe.format?.duration || 0);
  rejectPlaceholder({ files: shotList.map(shot => shot.asset || shot.path || ''), keyframes, sourceMethod, durationSeconds: duration, requestedDurationSeconds: durationSeconds, expectedShotCount: shotList === SHOTS ? 3 : shotList.length });
  const quality = await inspectRender({ videoPath: final, output: join(out, 'quality'), ffmpeg, ffprobe, expected: { width, height, fps, durationSeconds, requireAudio: true }, sourceMethod });
  const receipt = { schemaVersion: 1, status: quality.status === 'passed' ? 'verified' : 'review_required', sourceMethod, shotCount: shotList.length, shotDurationSeconds: Number(shotDuration.toFixed(3)), shots: shotList, outputs: { video: 'trailer-1080p.mp4', captions: captions ? 'captions.srt' : null, keyframes: 'shots', quality: 'quality/quality.json' }, verification, qualityReview: quality, qualityGate: { rejectedPrimitiveGeometry: true, rejectedBlackFrames: true, rejectedDebugText: true, requiresSubjectEnvironmentDepth: true, requiresRecognisableSubject: true, requiresMotionAndSound: true } };
  await writeFile(join(out, 'result.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}

export { SHOTS, rejectPlaceholder };
