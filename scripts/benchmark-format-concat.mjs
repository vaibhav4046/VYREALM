import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// CPU-only, existing-footage benchmark. Module path allows an unchanged baseline
// checkout to be compared without adding a legacy path to the production API.
const [modulePath, source, target, ffmpeg, ffprobe, variant = 'candidate'] = process.argv.slice(2);
if (!ffprobe) throw new Error('Usage: node scripts/benchmark-format-concat.mjs module source target ffmpeg ffprobe variant');
const exec = promisify(execFile);
const { renderPlan } = await import(pathToFileURL(resolve(modulePath)));
await mkdir(target, { recursive: true });
const plan = {
  formatId: 'concat-benchmark', platform: 'youtube', durationSeconds: 12,
  canvas: { width: 1280, height: 720, fps: 24 }, grade: { id: 'neutral' },
  captionStyle: { id: 'minimal-lower' }, safeArea: { top: 40, bottom: 60, left: 60, right: 60 },
  audio: { id: 'music-drive' },
  timeline: ['hold', 'push-in', 'hold', 'pull-out'].map((motion, i) => ({
    shotRole: i === 2 ? 'black' : 'hero', role: `beat-${i}`, motion, durationSeconds: 3
  }))
};
const results = [];
for (const captions of [false, true]) {
  const label = `${variant}-${captions ? 'captions' : 'plain'}`;
  const output = join(target, `${label}.mp4`);
  const started = performance.now();
  const result = await renderPlan({ plan, shotLibrary: { hero: { path: resolve(source) } }, output,
    workDir: join(target, `${label}-work`), ffmpeg, ffprobe,
    captionText: captions ? 'A quiet moment. The camera moves closer. A pause. Then the picture returns.' : null,
    audioSources: {} });
  const wallMs = performance.now() - started;
  // Full decode, not just container metadata. Audio is deliberately a declared
  // silent track here, exercising muxing without introducing a music variable.
  await exec(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-'], { windowsHide: true });
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', output], { windowsHide: true });
  results.push({ label, wallMs, ...result, probe: JSON.parse(stdout), fullDecode: true });
  console.log(JSON.stringify({ label, wallMs, measured: result.measured }));
}
await writeFile(join(target, `${variant}.json`), JSON.stringify({ source: resolve(source),
  sourceSha256: createHash('sha256').update(await readFile(source)).digest('hex'),
  sourceGenerationMs: null, note: 'Fresh composition of existing footage; source generation is excluded and unknown.', results }, null, 2));
