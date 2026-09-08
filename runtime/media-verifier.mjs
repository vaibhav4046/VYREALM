import {spawn} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {basename, resolve} from 'node:path';

const run = (cmd, args, timeout = 30_000) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(cmd, args, {stdio:['ignore','pipe','pipe'], windowsHide:true});
  let out = '', err = '', settled = false;
  const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
  child.stdout.on('data', chunk => { out += chunk.toString(); });
  child.stderr.on('data', chunk => { err += chunk.toString(); });
  child.on('error', error => finish(rejectRun, error));
  child.on('close', code => code === 0 ? finish(resolveRun, out) : finish(rejectRun, new Error(`${basename(cmd)} exited ${code}: ${err.slice(-1200)}`)));
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(rejectRun, new Error(`${basename(cmd)} timed out`)); }, timeout);
});

// FFmpeg's signalstats filter is a lightweight, deterministic visual sanity
// check. It catches an all-black/white or completely static export without
// pretending to score cinematography or photorealism.
const runCombined = (cmd, args, timeout = 30_000) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(cmd, args, {stdio:['ignore','pipe','pipe'], windowsHide:true});
  let out = '', err = '', settled = false;
  const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
  child.stdout.on('data', chunk => { out += chunk.toString(); });
  child.stderr.on('data', chunk => { err += chunk.toString(); });
  child.on('error', error => finish(rejectRun, error));
  child.on('close', code => code === 0 ? finish(resolveRun, `${out}\n${err}`) : finish(rejectRun, new Error(`${basename(cmd)} exited ${code}: ${err.slice(-1200)}`)));
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(rejectRun, new Error(`${basename(cmd)} timed out`)); }, timeout);
});

const result = (ok, actual, expected, message) => ({ok, actual, expected, message});
const captionCue = /(?:^|\n)\s*\d+\s*\r?\n\s*\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/m;

/**
 * Verify a rendered media file in layers. This is deliberately independent of
 * the renderer so installers, CI and the desktop runtime can use the same
 * technical acceptance gate.
 *
 * Checks: file existence/readability, ffprobe validity, video stream,
 * resolution, duration, frame rate, audio stream, optional caption cues and
 * an opt-in signalstats sanity gate for blank/static frames. No visual-quality
 * claim is made by this verifier.
 */
export async function verifyMedia({videoPath, ffprobe, ffmpeg, expected = {}, captionsPath, requireCaptions = false, toleranceSeconds = 0.12} = {}) {
  const checks = {};
  const diagnostics = [];
  const add = (name, value, code, message) => { checks[name] = value; if (!value.ok) diagnostics.push({code, message, severity:'error'}); };
  const path = typeof videoPath === 'string' ? resolve(videoPath) : '';
  let file;
  try { file = path && existsSync(path) ? await stat(path) : null; } catch {}
  add('exists', result(Boolean(file?.isFile() && file.size > 0), file ? {bytes:file.size} : null, 'non-empty regular file', file ? '' : 'Rendered video is missing or empty'), 'VIDEO_MISSING', 'Rendered video is missing or empty');
  if (!file) return {ok:false, checks, diagnostics, probe:null};
  if (typeof ffprobe !== 'string' || !ffprobe) {
    add('probe', result(false, null, 'ffprobe JSON', 'ffprobe executable is not configured'), 'FFPROBE_UNAVAILABLE', 'ffprobe executable is not configured');
    return {ok:false, checks, diagnostics, probe:null};
  }
  let probe;
  try { probe = JSON.parse(await run(ffprobe, ['-v','error','-print_format','json','-show_streams','-show_format',path])); }
  catch (error) {
    add('probe', result(false, null, 'valid ffprobe JSON', error.message), 'FFPROBE_FAILED', `ffprobe failed: ${error.message}`);
    return {ok:false, checks, diagnostics, probe:null};
  }
  add('probe', result(true, 'valid', 'valid ffprobe JSON', ''), 'FFPROBE_FAILED', 'ffprobe failed');
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  add('videoStream', result(Boolean(video), video ? {codec:video.codec_name} : null, 'at least one video stream', video ? '' : 'No video stream found'), 'VIDEO_STREAM_MISSING', 'No video stream found');
  if (!video) return {ok:false, checks, diagnostics, probe};
  const width = Number(video.width || 0), height = Number(video.height || 0);
  const expectedWidth = Number(expected.width || 0), expectedHeight = Number(expected.height || 0);
  const resolutionOk = (!expectedWidth || width === expectedWidth) && (!expectedHeight || height === expectedHeight);
  add('resolution', result(resolutionOk, {width, height}, expectedWidth || expectedHeight ? {width:expectedWidth || undefined, height:expectedHeight || undefined} : 'any positive resolution', resolutionOk ? '' : `Expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`), 'VIDEO_RESOLUTION_MISMATCH', `Expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  const duration = Number(probe.format?.duration || video.duration || 0);
  const expectedDuration = Number(expected.durationSeconds || 0);
  const durationOk = duration > 0 && (!expectedDuration || Math.abs(duration - expectedDuration) <= Math.max(toleranceSeconds, 1 / Math.max(1, Number(expected.fps) || 24)));
  add('duration', result(durationOk, duration, expectedDuration || '> 0 seconds', durationOk ? '' : `Expected about ${expectedDuration}s, got ${duration}s`), 'VIDEO_DURATION_MISMATCH', `Expected about ${expectedDuration}s, got ${duration}s`);
  const frameRate = video.avg_frame_rate && video.avg_frame_rate !== '0/0' ? (() => { const [n,d] = String(video.avg_frame_rate).split('/').map(Number); return d ? n / d : 0; })() : 0;
  const expectedFps = Number(expected.fps || 0);
  const fpsOk = !expectedFps || (frameRate > 0 && Math.abs(frameRate - expectedFps) <= 0.5);
  add('frameRate', result(fpsOk, frameRate, expectedFps || 'reported/any', fpsOk ? '' : `Expected about ${expectedFps}fps, got ${frameRate}`), 'VIDEO_FPS_MISMATCH', `Expected about ${expectedFps}fps, got ${frameRate}`);
  const audioRequired = Boolean(expected.requireAudio);
  const audioOk = !audioRequired || Boolean(audio);
  add('audio', result(audioOk, audio ? {codec:audio.codec_name, channels:audio.channels} : null, audioRequired ? 'at least one audio stream' : 'optional', audioOk ? '' : 'Audio stream is required but missing'), 'AUDIO_STREAM_MISSING', 'Audio stream is required but missing');
  if (requireCaptions) {
    let captionText = '';
    try { captionText = await (await import('node:fs/promises')).readFile(resolve(captionsPath || ''), 'utf8'); } catch {}
    const captionsOk = captionCue.test(captionText);
    add('captions', result(captionsOk, captionsOk ? 'cue(s) present' : null, 'SRT file with at least one cue', captionsOk ? '' : 'Caption file is missing or has no valid SRT cues'), 'CAPTIONS_MISSING', 'Caption file is missing or has no valid SRT cues');
  } else if (captionsPath) {
    let present = false; try { present = Boolean((await stat(resolve(captionsPath))).isFile()); } catch {}
    checks.captions = result(present, present ? 'file present' : null, 'optional SRT file', present ? '' : 'Optional caption file is missing');
  }

  // Opt-in because technical-only callers may validate intentionally static
  // stills. Production renders enable this gate so blank/static exports fail
  // with an actionable diagnostic instead of reaching the catalogue.
  if (expected.requireVisual) {
    const ffmpegPath = typeof ffmpeg === 'string' && ffmpeg ? resolve(ffmpeg) : resolve(String(ffprobe).replace(/ffprobe(?:\.exe)?$/i, 'ffmpeg$&'.toLowerCase().endsWith('.exe') ? '.exe' : ''));
    let sample = '';
    try {
      sample = await runCombined(ffmpegPath, ['-v','error','-i',path,'-vf','fps=4,signalstats,metadata=print:file=-','-frames:v','12','-f','null','-'], 45_000);
      const values = name => [...sample.matchAll(new RegExp(`(?:lavfi\\.)?signalstats\\.${name}=([0-9]+(?:\\.[0-9]+)?)`, 'g'))].map(match => Number(match[1])).filter(Number.isFinite);
      const yavg = values('YAVG'), ymin = values('YMIN'), ymax = values('YMAX'), ydif = values('YDIF');
      const mean = yavg.length ? yavg.reduce((sum, value) => sum + value, 0) / yavg.length : 0;
      const ranges = ymin.length && ymax.length ? ymin.map((value, index) => Number(ymax[index] || 0) - value) : [];
      const maxRange = ranges.length ? Math.max(...ranges) : 0;
      const maxDiff = ydif.length ? Math.max(...ydif) : 0;
      const lumaOk = yavg.length > 0 && mean >= 24 && mean <= 232;
      const contrastOk = maxRange >= 12;
      const motionOk = maxDiff >= 0.1;
      const actual = {samples:yavg.length, meanLuma:Number(mean.toFixed(3)), maxRange:Number(maxRange.toFixed(3)), maxFrameLumaDelta:Number(maxDiff.toFixed(5))};
      add('visualLuma', result(lumaOk, actual, 'mean luma between 24 and 232', lumaOk ? '' : `Mean luma ${actual.meanLuma} indicates a blank/dark/white export`), 'VISUAL_LUMA_INVALID', 'Visual luma is outside the readable range');
      add('visualContrast', result(contrastOk, actual, 'at least 12 levels of luma range', contrastOk ? '' : 'Frames have insufficient luminance contrast'), 'VISUAL_CONTRAST_LOW', 'Frames have insufficient luminance contrast');
      add('visualMotion', result(motionOk, actual, 'non-static frame samples', motionOk ? '' : 'Frame samples are identical; expected deliberate motion'), 'VISUAL_MOTION_MISSING', 'Frame samples are identical; expected deliberate motion');
    } catch (error) {
      add('visual', result(false, null, 'FFmpeg signalstats sample', error.message), 'VISUAL_CHECK_UNAVAILABLE', `Visual sanity check failed: ${error.message}`);
    }
  }
  return {ok: diagnostics.length === 0, checks, diagnostics, probe};
}
