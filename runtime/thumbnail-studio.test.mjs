import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildThumbnail, thumbnailHash } from './thumbnail-studio.mjs';
import { prepareYouTubeThumbnail, thumbnailUploadFailure } from '../publishing/youtube-thumbnail.mjs';
const exec = promisify(execFile), root = fileURLToPath(new URL('..', import.meta.url));
const tools = { ffmpeg: path.join(root, 'workers/tools/ffmpeg.exe'), ffprobe: path.join(root, 'workers/tools/ffprobe.exe'), fontPath: 'C:/Windows/Fonts/segoeuib.ttf' };
test('real frame composition creates 4K master, bounded JPEG, readable-size preview and exact upload binding', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vyrealm-thumbnail-'));
  t.after(async () => { if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('vyrealm-thumbnail-')) await fs.rm(dir, { recursive: true, force: true }); });
  const videoPath = path.join(dir, 'source.mp4');
  await exec(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=1', '-c:v', 'libx264', '-threads', '1', videoPath], { windowsHide: true });
  const sourceHash = await thumbnailHash(videoPath), outputDir = path.join(dir, 'frame');
  const thumbnail = await buildThumbnail({ ...tools, videoPath, sourceHash, outputDir, title: 'A quieter world', projectId: 'test-project' });
  assert.deepEqual([thumbnail.artifacts.master.width, thumbnail.artifacts.master.height], [3840, 2160]);
  assert.deepEqual([thumbnail.artifacts.preview.width, thumbnail.artifacts.preview.height], [320, 180]);
  assert.ok(thumbnail.artifacts.upload.bytes < 2_000_000); assert.equal(thumbnail.sourceHash, sourceHash); assert.equal(thumbnail.modelInvoked, false);
  const filePath = path.join(outputDir, thumbnail.outputs.upload), uploadReceipt = { videoId: 'abcdefghijk', sha256: sourceHash };
  const request = await prepareYouTubeThumbnail({ thumbnail, filePath, uploadReceipt });
  assert.equal(new URL(request.url).searchParams.get('videoId'), 'abcdefghijk'); assert.equal(request.binding.sourceHash, sourceHash); assert.equal(request.body.length, thumbnail.artifacts.upload.bytes);
  await assert.rejects(prepareYouTubeThumbnail({ thumbnail, filePath, uploadReceipt: { ...uploadReceipt, sha256: '0'.repeat(64) } }), { code: 'THUMBNAIL_VIDEO_MISMATCH' });
  await assert.rejects(prepareYouTubeThumbnail({ thumbnail, filePath, uploadReceipt: { sha256: sourceHash } }), { code: 'THUMBNAIL_VIDEO_PENDING' });
  await fs.appendFile(filePath, 'tampered');
  await assert.rejects(prepareYouTubeThumbnail({ thumbnail, filePath, uploadReceipt }), { code: 'THUMBNAIL_CHANGED' });
  await assert.rejects(buildThumbnail({ ...tools, videoPath, outputDir: path.join(dir, 'bad'), sourceHash: '0'.repeat(64), title: 'Mismatch' }), { code: 'THUMBNAIL_SOURCE_MISMATCH' });
  await assert.rejects(buildThumbnail({ ...tools, videoPath, outputDir: path.join(dir, 'time'), atSeconds: 4, title: 'Bad frame' }), { code: 'THUMBNAIL_TIMESTAMP' });
  for (const style of ['editorial', 'bold']) {
    const typography = await buildThumbnail({ ...tools, outputDir: path.join(dir, style), prompt: 'A quieter world', style });
    assert.equal(typography.method, 'prompt-typography'); assert.equal(typography.sourceHash, null);
  }
  assert.equal(thumbnailUploadFailure(403).state, 'permission-required');
});
