import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { verifyMedia } from './media-verifier.mjs';

// Product-video routes are local equivalents of common template-first ad
// workflows. They describe an editable plan and never imply hosted inference.
export const PRODUCT_TEMPLATES = Object.freeze({
  studio: { label: 'Studio hero', description: 'Frame a supplied studio product image or clip', background: '#111018' },
  lifestyle: { label: 'Lifestyle scene', description: 'Frame supplied product footage in its original environment', background: '#15120f' },
  'with-model': { label: 'With model', description: 'Product-led portrait framing using supplied media', background: '#11141a' },
  'ugc-faceless': { label: 'UGC faceless', description: 'Fast vertical demo with product-first framing', background: '#141014' },
  'ugc-talking-head': { label: 'UGC talking head', description: 'Talking-head edit route using uploaded footage', background: '#10151a' },
  'ugc-silent': { label: 'UGC silent', description: 'Caption-ready silent product demonstration', background: '#141414' },
  'motion-2d': { label: '2D product motion', description: 'Graphic product motion with controlled camera movement', background: '#0d101a' },
  'motion-mixed-media': { label: 'Mixed media', description: 'Product image, color fields, and editorial movement', background: '#17100d' },
  // Keep stored identifiers compatible; a lateral crop cannot reveal an unseen side.
  '360-orbit': { label: 'Lateral product pan', description: 'Digital pan across supplied media; real 360 views require recorded footage', background: '#0b1016' },
  unboxing: { label: 'Unboxing footage', description: 'Edit a supplied unboxing clip; no package-opening performance is generated', background: '#15120e' },
  demo: { label: 'Product demo', description: 'Frame an existing product demonstration', background: '#111111' }
});

export const CAMERA_PRESETS = Object.freeze({
  static: { label: 'Static framing', x: 0, zoom: 1 },
  'pan-right': { label: 'Digital pan right', x: 1, zoom: 1.10 },
  'pan-left': { label: 'Digital pan left', x: -1, zoom: 1.10 },
  'dolly-in': { label: 'Digital push-in', x: 0, zoom: 1.16 },
  'crane-up': { label: 'Digital pan up', x: 0, zoom: 1.10 },
  'hero-orbit': { label: 'Digital lateral pan', x: 1, zoom: 1.18 },
  'handheld': { label: 'Digital crop drift', x: -1, zoom: 1.08 },
  'crash-zoom': { label: 'Digital fast zoom', x: 0, zoom: 1.28 }
});

const run = (cmd, args, timeout = 180_000) => new Promise((ok, bad) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let err = '', stdout = '', settled = false;
  const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
  const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} finish(bad, new Error(`${cmd} timed out`)); }, timeout);
  p.stdout.on('data', x => { stdout += x.toString(); if (stdout.length > 2_000_000) { p.kill(); finish(bad, new Error('PRODUCT_PROBE_TOO_LARGE')); } });
  p.stderr.on('data', x => { err += x.toString(); if (err.length > 5000) err = err.slice(-5000); });
  p.on('error', e => finish(bad, e));
  p.on('close', code => code ? finish(bad, new Error(`${cmd} exited ${code}: ${err.slice(-1600)}`)) : finish(ok, stdout));
});

const stillExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const videoExtensions = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi']);
const localPath = (value, code = 'PRODUCT_LOCAL_PATH_REQUIRED') => {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value) || /^(?:\\\\|\/\/)/.test(value) || (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))) throw new Error(`${code}: only a local filesystem path is accepted`);
  return resolve(value);
};
const assetKind = path => {
  const extension = extname(path).toLowerCase();
  if (stillExtensions.has(extension)) return 'image';
  if (videoExtensions.has(extension)) return 'video';
  throw new Error('PRODUCT_MEDIA_UNSUPPORTED: use a local PNG, JPEG, WebP, BMP, MP4, MOV, M4V, MKV, WebM, or AVI');
};
const validateOptions = ({ template = 'studio', camera = 'dolly-in', width = 1080, height = 1920, fps = 24, durationSeconds = 15, aspectRatio = '9:16' } = {}) => {
  if (!Object.hasOwn(PRODUCT_TEMPLATES, template)) throw new Error('PRODUCT_TEMPLATE_INVALID');
  if (!Object.hasOwn(CAMERA_PRESETS, camera)) throw new Error('PRODUCT_CAMERA_INVALID');
  if (!['16:9', '9:16', '1:1', '4:5'].includes(aspectRatio)) throw new Error('PRODUCT_ASPECT_RATIO_INVALID');
  if (![width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096 && value % 2 === 0) || width * height > 8_847_360) throw new Error('PRODUCT_RESOLUTION_INVALID: even dimensions from 64 to 4096, at most 8.85 megapixels');
  if (!Number.isInteger(fps) || fps < 12 || fps > 60) throw new Error('PRODUCT_FPS_INVALID: choose an integer from 12 to 60');
  if (!Number.isFinite(durationSeconds) || durationSeconds < 3 || durationSeconds > 60) throw new Error('PRODUCT_DURATION_INVALID: choose 3 to 60 seconds');
};

export function buildProductPlan({ template = 'studio', camera = 'dolly-in', durationSeconds = 15, aspectRatio = '9:16', productAssetId = null } = {}) {
  validateOptions({ template, camera, durationSeconds, aspectRatio });
  const t = PRODUCT_TEMPLATES[template];
  const c = CAMERA_PRESETS[camera];
  return {
    schemaVersion: 1, kind: 'product-video-plan', route: 'local-asset-motion', template,
    templateLabel: t.label, camera, cameraLabel: c.label, aspectRatio, durationSeconds,
    productAssetId, stages: ['product asset', 'look and camera', 'captions/audio', 'local FFmpeg encode'],
    limitations: ['Templates frame supplied media; they do not generate sets, people, product demonstrations, or subject performance.', 'Still images use digital pan/zoom without depth or 3D reconstruction. Uploaded video preserves its recorded camera and subject motion.'],
    diagnostics: productAssetId ? [] : [{ code: 'PRODUCT_ASSET_REQUIRED', message: 'Import a product image or video before rendering this product route.' }]
  };
}

export function buildProductFfmpegArgs(input, output, { width = 1080, height = 1920, fps = 24, durationSeconds = 15, camera = 'dolly-in', background = '#111018' } = {}) {
  validateOptions({ width, height, fps, durationSeconds, camera });
  const source = localPath(input), target = localPath(output);
  const kind = assetKind(source), c = CAMERA_PRESETS[camera];
  if (!/^#[\da-f]{6}$/i.test(background)) throw new Error('PRODUCT_BACKGROUND_INVALID');
  const args = ['-y', '-nostdin', '-threads', '2', '-protocol_whitelist', 'file,pipe', '-i', source];
  let filter;
  if (kind === 'image') {
    const frames = Math.round(fps * durationSeconds), progress = `on/${Math.max(1, frames - 1)}`;
    const pan = c.x !== 0 || camera === 'crane-up';
    const zoom = camera === 'static' ? '1' : pan ? String(c.zoom) : `1+${c.zoom - 1}*min(1,${progress}${camera === 'crash-zoom' ? '*4' : ''})`;
    const x = c.x > 0 ? `(iw-iw/zoom)*${progress}` : c.x < 0 ? `(iw-iw/zoom)*(1-${progress})` : '(iw-iw/zoom)/2';
    const y = camera === 'crane-up' ? `(ih-ih/zoom)*(1-${progress})` : '(ih-ih/zoom)/2';
    // One still input frame yields the requested output frames. This filter must
    // never be applied to footage: d=N would hold every source frame N times.
    filter = `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='${zoom}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p[v]`;
  } else {
    // Preserve source performance and timing. Fit without discarding product
    // edges; a selected still-camera preset is not synthetic camera movement.
    filter = `[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background},setsar=1,fps=${fps},format=yuv420p[v]`;
  }
  args.push('-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[v]');
  if (kind === 'video') args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
  else args.push('-an');
  args.push('-t', String(durationSeconds), '-r', String(fps), '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target);
  return args;
}

export async function renderProductVideo({ input, output, ffmpeg, ffprobe, template = 'studio', camera = 'dolly-in', width = 1080, height = 1920, fps = 24, durationSeconds = 15, aspectRatio = '9:16' } = {}) {
  validateOptions({ template, camera, width, height, fps, durationSeconds, aspectRatio });
  let source = localPath(input, 'PRODUCT_ASSET_REQUIRED');
  let file;
  try { source = localPath(await realpath(source)); file = await stat(source); } catch (error) { throw new Error(`PRODUCT_ASSET_REQUIRED: readable local media is required (${error.code || error.message})`); }
  if (!file.isFile() || !file.size) throw new Error('PRODUCT_ASSET_REQUIRED: media must be a non-empty regular file');
  const kind = assetKind(source);
  if (!ffmpeg || !ffprobe || !output) throw new Error('PRODUCT_RUNTIME_UNAVAILABLE: ffmpeg, ffprobe, and output are required');
  const out = localPath(output);
  const probe = JSON.parse(await run(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', source], 30_000));
  const sourceVideo = probe.streams?.find(stream => stream.codec_type === 'video');
  if (!sourceVideo || !(sourceVideo.width > 0 && sourceVideo.height > 0) || sourceVideo.width * sourceVideo.height > 64_000_000) throw new Error('PRODUCT_MEDIA_INVALID: readable video/image stream required (maximum 64 megapixels)');
  const sourceDuration = Number(sourceVideo.duration || probe.format?.duration || 0);
  if (kind === 'video' && (!Number.isFinite(sourceDuration) || sourceDuration <= 0)) throw new Error('PRODUCT_MEDIA_INVALID: source footage duration could not be determined');
  if (kind === 'video' && sourceDuration + 1 / fps < durationSeconds) throw new Error(`PRODUCT_SOURCE_TOO_SHORT: requested ${durationSeconds}s, source has ${sourceDuration}s; choose a shorter edit or supply longer footage`);
  const hasAudio = kind === 'video' && probe.streams.some(stream => stream.codec_type === 'audio');
  await mkdir(out, { recursive: true });
  const plan = buildProductPlan({ template, camera, durationSeconds, aspectRatio, productAssetId: 'local-file' });
  const video = join(out, 'product-video.mp4');
  if (source.toLowerCase() === video.toLowerCase()) throw new Error('PRODUCT_OUTPUT_CONFLICT: output must not overwrite source media');
  await run(ffmpeg, buildProductFfmpegArgs(source, video, { width, height, fps, durationSeconds, camera, background: PRODUCT_TEMPLATES[template].background }), 15 * 60_000);
  const visualSanity = kind === 'video' || camera !== 'static';
  const verification = await verifyMedia({ videoPath: video, ffprobe, ffmpeg, expected: { width, height, fps, durationSeconds, requireAudio: hasAudio, requireVisual: visualSanity } });
  if (!verification.ok) throw new Error(`PRODUCT_REJECTED: ${verification.diagnostics.map(d => d.code).join(',')}`);
  const receipt = { ...plan, sourceMethod: kind === 'video' ? 'uploaded-video-edit' : 'local-product-still-pan-zoom', audioMethod: hasAudio ? 'source-audio' : 'none', appliedCamera: kind === 'video' ? 'recorded-source-camera' : cLabel(camera), outputs: { video: 'product-video.mp4' }, verification, qualityGate: { rejectsMissingAsset: true, rejectsShortSource: true, requiresLocalSource: true, visualSanityChecked: visualSanity, semanticVisualInspection: 'not-performed' } };
  if (!hasAudio) receipt.diagnostics.push({ code: 'PRODUCT_AUDIO_ABSENT', severity: 'info', message: 'Source has no audio. This export is silent; import narration or music in the timeline to add sound.' });
  await writeFile(join(out, 'result.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}

const cLabel = camera => CAMERA_PRESETS[camera].label;
