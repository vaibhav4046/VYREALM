import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const THUMBNAIL_STYLES = Object.freeze(['cinematic', 'editorial', 'bold']);
export async function thumbnailHash(file) { const hash = crypto.createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); }
function local(value) { if (typeof value !== 'string' || !path.isAbsolute(value) || /^[/\\]{2}/.test(value) || value.includes('\0')) fail('THUMBNAIL_PATH', 'An absolute local file path is required.'); return path.resolve(value); }
function wrap(value, limit) { const lines = []; let line = ''; for (const word of value.split(/\s+/)) { for (let i = 0; i < word.length; i += limit) { const part = word.slice(i, i + limit); if ((line + ' ' + part).trim().length > limit) { lines.push(line); line = part; } else line = (line + ' ' + part).trim(); } } if (line) lines.push(line); return lines; }

/** CPU-only composition. A 4K canvas is not a claim of native neural image detail. */
export async function buildThumbnail({ outputDir, ffmpeg, ffprobe, fontPath, videoPath, imagePath, sourceHash, projectId = null, sourceAssetId = null, title, prompt = '', style = 'cinematic', atSeconds } = {}) {
  if (!THUMBNAIL_STYLES.includes(style)) fail('THUMBNAIL_STYLE', 'Choose cinematic, editorial, or bold.');
  if (typeof prompt !== 'string' || prompt.length > 6000) fail('THUMBNAIL_PROMPT', 'Use a prompt of at most 6000 characters.');
  const heading = (title || prompt.split(/[.!?\n]/)[0] || '').trim().replace(/\s+/g, ' ');
  if (!heading || heading.length > 100 || /[\u0000-\u001f]/.test(heading)) fail('THUMBNAIL_TITLE', 'Use a headline of 1–100 characters.');
  if (videoPath && imagePath) fail('THUMBNAIL_SOURCE', 'Choose one video or image source.');
  const destination = local(outputDir); local(ffmpeg); local(ffprobe); local(fontPath);
  const run = (bin, args, options = {}) => exec(bin, args, { windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 ** 2, ...options });
  const source = videoPath || imagePath;
  const actualSource = source ? await fs.realpath(local(source)) : null;
  const hash = actualSource ? await thumbnailHash(actualSource) : null;
  if (sourceHash !== undefined && sourceHash !== hash) fail('THUMBNAIL_SOURCE_MISMATCH', 'The thumbnail source does not match the reviewed export.');
  let sourceInfo = null, timestamp = null;
  if (actualSource) {
    const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', actualSource])).stdout);
    const stream = probe.streams?.find(item => item.codec_type === 'video');
    if (!stream?.width || !stream?.height) fail('THUMBNAIL_SOURCE', 'The source has no readable image stream.');
    sourceInfo = { width: stream.width, height: stream.height };
    if (videoPath) {
      const duration = Number(probe.format?.duration || stream.duration);
      if (!Number.isFinite(duration) || duration <= 0) fail('THUMBNAIL_SOURCE', 'The source video has no valid duration.');
      timestamp = atSeconds === undefined ? duration * 0.4 : Number(atSeconds);
      if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp >= duration) fail('THUMBNAIL_TIMESTAMP', 'Choose a frame within the video duration.');
      sourceInfo.durationSeconds = duration;
    }
  }
  // New folders only: retries cannot overwrite a reviewed thumbnail.
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try { await fs.mkdir(destination); } catch (error) { if (error.code === 'EEXIST') fail('THUMBNAIL_EXISTS', 'Choose a new thumbnail output folder.'); throw error; }
  const outputs = { master: 'thumbnail-master.png', upload: 'thumbnail-upload.jpg', preview: 'thumbnail-preview.jpg', manifest: 'thumbnail.json' };
  try {
    await fs.copyFile(fontPath, path.join(destination, 'font.ttf'));
    const lines = wrap(heading.toUpperCase(), style === 'editorial' ? 17 : 25);
    const fontSize = Math.min(style === 'editorial' ? 225 : 245, Math.floor(((style === 'editorial' ? 1450 : 650) - (lines.length - 1) * 30) / lines.length), Math.floor((style === 'editorial' ? 1480 : 3400) / Math.max(...lines.map(line => line.length))));
    await fs.writeFile(path.join(destination, 'headline.txt'), lines.join('\n'));
    let filter = 'scale=3840:2160:force_original_aspect_ratio=increase:flags=lanczos,crop=3840:2160,setsar=1';
    if (style === 'editorial') filter += ',drawbox=x=0:y=0:w=1980:h=2160:color=0x080610@0.88:t=fill,drawbox=x=165:y=260:w=22:h=1450:color=0xad83ff:t=fill';
    else if (style === 'bold') filter += ',drawbox=x=110:y=1170:w=3620:h=820:color=0x130923@0.91:t=fill,drawbox=x=110:y=1170:w=3620:h=24:color=0xc4a0ff:t=fill';
    else filter += ',drawbox=x=0:y=1110:w=3840:h=1050:color=0x080610@0.78:t=fill,drawbox=x=180:y=1210:w=280:h=18:color=0xb48aff:t=fill';
    const y = style === 'editorial' ? '(h-text_h)/2' : style === 'bold' ? '1270' : '1310';
    filter += `,drawtext=fontfile=font.ttf:textfile=headline.txt:expansion=none:fontcolor=white:fontsize=${fontSize}:line_spacing=30:x=${style === 'editorial' ? 260 : 190}:y=${y}:shadowcolor=black@0.7:shadowx=5:shadowy=7`;
    const input = actualSource ? [...(videoPath ? ['-ss', String(timestamp)] : []), '-i', actualSource] : ['-f', 'lavfi', '-i', 'color=c=0x160d28:s=3840x2160'];
    await run(ffmpeg, ['-v', 'error', ...input, '-frames:v', '1', '-vf', filter, '-threads', '1', outputs.master], { cwd: destination });
    let uploadSize = Infinity, uploadWidth = 3840, uploadQuality = 2;
    outer: for (const width of [3840, 2560, 1920, 1280]) for (const quality of [2, 4, 6, 9, 13]) {
      await run(ffmpeg, ['-v', 'error', '-y', '-i', outputs.master, '-vf', `scale=${width}:-2:flags=lanczos`, '-frames:v', '1', '-q:v', String(quality), '-threads', '1', outputs.upload], { cwd: destination });
      uploadSize = (await fs.stat(path.join(destination, outputs.upload))).size;
      if (uploadSize < 2_000_000) { uploadWidth = width; uploadQuality = quality; break outer; }
    }
    if (uploadSize >= 2_000_000) fail('THUMBNAIL_SIZE', 'The upload thumbnail could not meet the API size limit.');
    await run(ffmpeg, ['-v', 'error', '-i', outputs.master, '-vf', 'scale=320:180:flags=lanczos', '-frames:v', '1', '-q:v', '3', '-threads', '1', outputs.preview], { cwd: destination });
    if (actualSource && await thumbnailHash(actualSource) !== hash) fail('THUMBNAIL_SOURCE_CHANGED', 'The source changed during thumbnail generation.');
    const artifacts = {};
    for (const key of ['master', 'upload', 'preview']) { const file = path.join(destination, outputs[key]); const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file])).stdout); artifacts[key] = { file: outputs[key], ...probe.streams[0], bytes: (await fs.stat(file)).size, sha256: await thumbnailHash(file), mime: key === 'master' ? 'image/png' : 'image/jpeg' }; }
    if (artifacts.master.width !== 3840 || artifacts.master.height !== 2160) fail('THUMBNAIL_DIMENSIONS', '4K master validation failed.');
    const result = { schemaVersion: 1, kind: 'thumbnail', createdAt: new Date().toISOString(), title: heading, prompt, style, projectId, sourceAssetId, sourceHash: hash, source: sourceInfo, atSeconds: timestamp, method: videoPath ? 'composited-video-frame' : imagePath ? 'composited-source-image' : 'prompt-typography', modelInvoked: false, fourKMethod: '3840x2160 composition; source imagery resampled, text rendered at master resolution', requiresReview: true, outputs, artifacts, upload: { width: uploadWidth, quality: uploadQuality, maxBytes: 2_000_000 }, publishing: { state: 'not-uploaded', videoId: null } };
    await fs.writeFile(path.join(destination, outputs.manifest), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await fs.unlink(path.join(destination, 'font.ttf')).catch(() => {});
    await fs.unlink(path.join(destination, 'headline.txt')).catch(() => {});
  }
}
