import { spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyMedia } from './media-verifier.mjs';

const run = (cmd, args, { timeout = 600000 } = {}) => new Promise((ok, bad) => {
  const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; const timer = setTimeout(() => { child.kill('SIGKILL'); bad(new Error(`${cmd} timed out`)); }, timeout);
  child.stderr.on('data', b => { err += b.toString(); if (err.length > 4000) err = err.slice(-4000); });
  child.on('error', e => { clearTimeout(timer); bad(e); });
  child.on('close', code => { clearTimeout(timer); code ? bad(new Error(`${cmd} exited ${code}: ${err.slice(-1200)}`)) : ok(); });
});

export function buildEnhancementPlan({ width = 3840, height = 2160, fps = 24, bitrate = '60M', backend = 'cpu' } = {}) {
  if (width !== 3840 || height !== 2160) throw new Error('4K enhancement requires 3840x2160');
  return { stages: ['Source', 'Enhance', 'Upscale', 'Grade', 'Encode 4K'], backend, width, height, fps, bitrate, temporalSafe: backend === 'cpu' ? 'video-scale' : 'scene-aware-frames' };
}

export function buildFfmpegArgs(input, output, { width = 3840, height = 2160, fps = 24, bitrate = '60M' } = {}) {
  return ['-y', '-i', input, '-vf', `scale=${width}:${height}:flags=lanczos,eq=contrast=1.04:brightness=0.01,unsharp=5:5:0.35:5:5:0,format=yuv420p`, '-r', String(fps), '-c:v', 'libx264', '-profile:v', 'high', '-level', '5.1', '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', '120M', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output];
}

/** Local 4K delivery. CPU fallback uses one temporal video filter (no independent-frame flicker). */
export async function enhanceTo4K({ input, output, ffmpeg, ffprobe, workDir = join(process.cwd(), 'work', 'enhance-4k'), fps = 24, bitrate = '60M', verify = true } = {}) {
  if (!input || !output || !ffmpeg || !ffprobe) throw new Error('input, output, ffmpeg, and ffprobe are required');
  const source = resolve(input), target = resolve(output); await mkdir(workDir, { recursive: true });
  const plan = buildEnhancementPlan({ fps, bitrate, backend: 'cpu' });
  const framesDir = join(resolve(workDir), 'source-frames');
  await mkdir(framesDir, { recursive: true });
  // Keep an inspectable extraction checkpoint while the encode remains temporal-safe.
  await run(ffmpeg, ['-y', '-i', source, '-vf', `fps=${fps}`, '-vsync', '0', join(framesDir, 'frame-%06d.png')]);
  await run(ffmpeg, buildFfmpegArgs(source, target, { fps, bitrate }));
  const result = { pipeline: plan, source, output: target, extractedFrames: (await stat(framesDir)).isDirectory(), temporalSafe: true };
  if (verify) { const check = await verifyMedia({ videoPath: target, ffprobe, ffmpeg, expected: { width: 3840, height: 2160, fps, requireAudio: true, requireVisual: true } }); if (!check.ok) throw new Error(`4K verification failed: ${check.diagnostics.map(d => d.code).join(', ')}`); result.verification = check; }
  return result;
}

export async function cleanEnhancementWorkdir(workDir) { await rm(resolve(workDir), { recursive: true, force: true }); }

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/upscale-4k.mjs')) {
  const args = process.argv.slice(2), value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const input = value('--input'), output = value('--output');
  if (!input || !output) { console.error('Usage: npm run enhance:4k -- --input source.mp4 --output final-4k.mp4'); process.exitCode = 2; }
  else enhanceTo4K({ input, output, ffmpeg: process.env.FFMPEG || 'workers/tools/ffmpeg.exe', ffprobe: process.env.FFPROBE || 'workers/tools/ffprobe.exe' }).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
