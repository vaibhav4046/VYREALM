import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
/** Prepare only. Caller owns OAuth, explicit reviewed-thumbnail selection, network and receipt persistence. */
export async function prepareYouTubeThumbnail({ thumbnail, filePath, uploadReceipt } = {}) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(uploadReceipt?.videoId || '')) fail('THUMBNAIL_VIDEO_PENDING', 'Wait for the video upload to return its video ID.');
  if (!/^[a-f0-9]{64}$/.test(thumbnail?.sourceHash || '') || thumbnail.sourceHash !== uploadReceipt.sha256) fail('THUMBNAIL_VIDEO_MISMATCH', 'This thumbnail belongs to a different video export.');
  const asset = thumbnail.artifacts?.upload;
  if (asset?.mime !== 'image/jpeg' || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) fail('THUMBNAIL_INVALID', 'Select a verified JPEG upload thumbnail.');
  const handle = await fs.open(filePath, 'r'); let body;
  try { const info = await handle.stat(); if (!info.isFile() || info.size <= 0 || info.size >= 2_000_000) fail('THUMBNAIL_SIZE', 'YouTube API thumbnails must be under 2 MB.'); body = await handle.readFile(); } finally { await handle.close(); }
  if (body.length >= 2_000_000 || body[0] !== 0xff || body[1] !== 0xd8 || crypto.createHash('sha256').update(body).digest('hex') !== asset.sha256) fail('THUMBNAIL_CHANGED', 'The reviewed thumbnail changed. Generate and review it again.');
  const url = new URL('https://www.googleapis.com/upload/youtube/v3/thumbnails/set');
  url.searchParams.set('videoId', uploadReceipt.videoId); url.searchParams.set('uploadType', 'media');
  return { url: url.href, method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(body.length) }, body, binding: { videoId: uploadReceipt.videoId, sourceHash: thumbnail.sourceHash, thumbnailHash: asset.sha256 } };
}
export function thumbnailUploadFailure(status) {
  if (status === 401) return { state: 'authorization-required', code: 'THUMBNAIL_AUTH', message: 'Reconnect YouTube to upload this thumbnail.' };
  if (status === 403) return { state: 'permission-required', code: 'THUMBNAIL_PERMISSION', message: 'YouTube denied the thumbnail. Check channel custom-thumbnail eligibility and OAuth permission.' };
  if (status === 404) return { state: 'video-unavailable', code: 'THUMBNAIL_VIDEO_UNAVAILABLE', message: 'The uploaded video is not available to this account.' };
  return { state: 'failed', code: 'THUMBNAIL_UPLOAD_FAILED', message: 'Thumbnail upload failed. The video upload is retained; retry the thumbnail separately.' };
}
