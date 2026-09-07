import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {verifyMedia} from './media-verifier.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ffmpeg = resolve(root, 'workers/tools/ffmpeg.exe');
const ffprobe = resolve(root, 'workers/tools/ffprobe.exe');
const run = (args) => new Promise((ok, bad) => { const p=spawn(ffmpeg,args,{stdio:'ignore',windowsHide:true}); p.on('error',bad); p.on('close',c=>c?bad(new Error(`ffmpeg exited ${c}`)):ok()); });

test('media verifier accepts a technical 1080p video with audio and captions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vyrelum-verifier-'));
  try {
    const video = join(dir, 'film.mp4'), srt = join(dir, 'film.srt');
    await run(['-y','-f','lavfi','-i','color=c=purple:s=1920x1080:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.0','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
    await writeFile(srt, '1\n00:00:00,000 --> 00:00:00,900\nOdyssey\n');
    const checked = await verifyMedia({videoPath:video, ffprobe, captionsPath:srt, requireCaptions:true, expected:{width:1920,height:1080,durationSeconds:1,fps:24,requireAudio:true}});
    assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
    assert.equal(checked.checks.resolution.actual.width, 1920);
    assert.equal(checked.checks.audio.ok, true);
    assert.equal(checked.checks.captions.ok, true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('media verifier reports missing files and mismatched technical gates', async () => {
  const missing = await verifyMedia({videoPath:'does-not-exist.mp4', ffprobe});
  assert.equal(missing.ok, false); assert.ok(missing.diagnostics.some(d=>d.code==='VIDEO_MISSING'));
  const dir = await mkdtemp(join(tmpdir(), 'vyrelum-verifier-'));
  try {
    const video = join(dir, 'film.mp4');
    await run(['-y','-f','lavfi','-i','color=c=black:s=320x180:r=24','-t','1.0','-an','-c:v','libx264','-pix_fmt','yuv420p',video]);
    const checked = await verifyMedia({videoPath:video, ffprobe, expected:{width:1920,height:1080,durationSeconds:3,fps:30,requireAudio:true}, captionsPath:join(dir,'none.srt'), requireCaptions:true});
    assert.equal(checked.ok, false);
    for (const code of ['VIDEO_RESOLUTION_MISMATCH','VIDEO_DURATION_MISMATCH','VIDEO_FPS_MISMATCH','AUDIO_STREAM_MISSING','CAPTIONS_MISSING']) assert.ok(checked.diagnostics.some(d=>d.code===code), code);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('media verifier catches a blank static render when visual gate is enabled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vyrelum-verifier-'));
  try {
    const video = join(dir, 'blank.mp4');
    await run(['-y','-f','lavfi','-i','color=c=black:s=320x180:r=24','-t','1.0','-an','-c:v','libx264','-pix_fmt','yuv420p',video]);
    const checked = await verifyMedia({videoPath:video, ffprobe, ffmpeg, expected:{width:320,height:180,fps:24,requireVisual:true}});
    assert.equal(checked.ok, false);
    assert.ok(checked.diagnostics.some(d=>d.code==='VISUAL_LUMA_INVALID'));
    assert.ok(checked.diagnostics.some(d=>d.code==='VISUAL_MOTION_MISSING'));
    assert.equal(checked.checks.visualContrast.ok, false);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

