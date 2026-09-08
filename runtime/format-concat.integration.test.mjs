import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPlan, DEFAULT_FFMPEG, DEFAULT_FFPROBE } from './format-render.mjs';

const exec = promisify(execFile);
const ffmpeg = DEFAULT_FFMPEG, ffprobe = DEFAULT_FFPROBE;
const available = existsSync(ffmpeg) && existsSync(ffprobe);
async function ff(args) { return (await exec(ffmpeg, ['-v', 'error', ...args], { windowsHide: true, maxBuffer: 8 * 1024 ** 2 })).stdout; }
const hashes = text => text.split('\n').filter(line => /^0,/.test(line)).map(line => line.split(',').at(-1).trim());

for (const fps of [24, 30]) test(`stream-copy keeps all decoded beat frames and timestamps at ${fps}fps`, { skip: !available }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vyrelum-concat-'));
  try {
    const source = join(dir, 'source.mp4'), output = join(dir, 'output.mp4'), workDir = join(dir, 'beats');
    await ff(['-f', 'lavfi', '-i', `testsrc2=s=320x180:r=${fps}:d=2`, '-c:v', 'libx264', source]);
    const plan = { formatId: 'verification', platform: 'youtube', durationSeconds: 3,
      canvas: { width: 320, height: 180, fps }, grade: { id: 'neutral' }, captionStyle: { id: 'none' },
      timeline: ['hero', 'black', 'hero'].map((shotRole, i) => ({ shotRole, role: `beat-${i}`, motion: 'hold', durationSeconds: 1 })) };
    const result = await renderPlan({ plan, shotLibrary: { hero: { path: source } }, output, workDir, ffmpeg, ffprobe,
      onProgress: ({ index }) => copyFileSync(join(workDir, `beat-${String(index).padStart(3, '0')}.mp4`), join(dir, `retained-${index}.mp4`)) });
    const expected = [];
    for (let i = 0; i < 3; i++) expected.push(...hashes(await ff(['-i', join(dir, `retained-${i}.mp4`), '-f', 'framemd5', '-'])));
    const actual = hashes(await ff(['-xerror', '-i', output, '-f', 'framemd5', '-']));
    assert.deepEqual(actual, expected, 'concat must not change any decoded pixel or drop/reorder frames');
    assert.equal(actual.length, fps * 3);
    const { stdout } = await exec(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', output], { windowsHide: true });
    const times = JSON.parse(stdout).frames.map(frame => Number(frame.best_effort_timestamp_time));
    times.forEach((time, i) => assert.ok(Math.abs(time - i / fps) < 0.00001, `continuous frame ${i}: ${time}`));
    assert.equal(result.assembly.additionalLossyEncode, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
