/**
 * Turn the raw Playwright capture of a real end-to-end run into a fixed-length
 * demo cut. The capture is the genuine session: nothing is re-staged or faked,
 * the only edit is a uniform speed ramp so a multi-minute run fits the target.
 *
 *   node scripts/build-demo-cut.mjs --target 180
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ffmpeg = join(root, 'workers/tools/ffmpeg.exe');
const ffprobe = join(root, 'workers/tools/ffprobe.exe');
const rawDir = join(root, 'outputs/demo/raw');
const outDir = join(root, 'outputs/demo');

const argv = process.argv.slice(2);
const target = Number(argv[argv.indexOf('--target') + 1]) || 180;

const duration = async path => {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Unreadable duration for ${path}`);
  return seconds;
};

const files = (await readdir(rawDir)).filter(f => f.endsWith('.webm')).sort();
if (!files.length) throw new Error(`No capture in ${rawDir}. Run the recorded demo first.`);

// Playwright writes one webm per page context. Longest is the studio session.
const measured = [];
for (const file of files) {
  const path = join(rawDir, file);
  measured.push({ path, file, seconds: await duration(path), bytes: (await stat(path)).size });
}
measured.sort((a, b) => b.seconds - a.seconds);
const source = measured[0];

await mkdir(outDir, { recursive: true });
const out = join(outDir, `VYREALM_DEMO_${target}S.mp4`);

// setpts wants the inverse: to compress 600s into 180s, each PTS is scaled by 0.3.
const factor = target / source.seconds;
if (factor >= 1) throw new Error(`Capture is ${source.seconds.toFixed(1)}s, already shorter than the ${target}s target; nothing to compress`);

await run(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', source.path,
  '-filter:v', `setpts=${factor.toFixed(6)}*PTS,scale=1920:-2:flags=lanczos,fps=30`,
  '-an',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  out
], { maxBuffer: 1 << 26 });

const finalSeconds = await duration(out);
console.log(JSON.stringify({
  source: source.file,
  sourceSeconds: Number(source.seconds.toFixed(2)),
  speedUp: Number((1 / factor).toFixed(2)),
  output: out,
  outputSeconds: Number(finalSeconds.toFixed(2)),
  candidates: measured.map(m => ({ file: m.file, seconds: Number(m.seconds.toFixed(2)) }))
}, null, 2));
