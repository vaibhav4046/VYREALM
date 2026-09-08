import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { buildThumbnail } from './thumbnail-studio.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
/** Host calls generate(projectId,input) behind its existing authenticated POST route. */
export function createThumbnailService({ db, jobsDir, root, ffmpeg, ffprobe, fontPath } = {}) {
  let busy = false;
  db.prepare("UPDATE jobs SET status='failed',stage='Thumbnail interrupted; generate again',error='THUMBNAIL_INTERRUPTED' WHERE type='thumbnail' AND status IN ('queued','running')").run();
  const service = {
    async handle({ method, pathname, body } = {}) {
      const match = String(pathname || '').match(/^\/api\/thumbnail\/projects\/([a-zA-Z0-9-]+)$/);
      if (!match) return null;
      if (method === 'POST') return service.generate(match[1], body);
      if (method === 'GET') { const row = db.prepare('SELECT document FROM projects WHERE id=?').get(match[1]); if (!row) fail('THUMBNAIL_PROJECT', 'Project unavailable.'); return { thumbnail: JSON.parse(row.document).thumbnailStudio || null, busy }; }
      fail('THUMBNAIL_METHOD', 'Use GET or POST.');
    },
    async generate(projectId, input = {}) {
      if (busy) fail('THUMBNAIL_BUSY', 'A thumbnail is being prepared. Please wait.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('THUMBNAIL_REQUEST', 'Thumbnail options must be an object.');
      if (Object.keys(input).some(key => !['expectedRevision', 'title', 'prompt', 'style', 'atSeconds', 'source', 'imageAssetId'].includes(key))) fail('THUMBNAIL_REQUEST', 'Unsupported thumbnail option.');
      const row = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
      if (!row || input.expectedRevision !== row.revision) fail('THUMBNAIL_REVISION', 'Open the current saved project revision first.');
      const project = JSON.parse(row.document), sourceMode = input.source || 'video';
      if (!['video', 'image', 'prompt'].includes(sourceMode)) fail('THUMBNAIL_SOURCE', 'Choose the current video, a project image, or prompt typography.');
      const assetId = sourceMode === 'video' ? project.latestOutput?.videoAssetId : sourceMode === 'image' ? input.imageAssetId : null;
      const asset = assetId ? db.prepare('SELECT * FROM assets WHERE id=? AND project_id=?').get(assetId, projectId) : null;
      if (sourceMode !== 'prompt' && !asset) fail('THUMBNAIL_SOURCE', 'Select available media from this project.');
      if (sourceMode === 'video' && ['blocked', 'rejected'].includes(project.latestOutput?.status)) fail('THUMBNAIL_SOURCE', 'The current export is blocked or rejected.');
      if (sourceMode === 'video' && !/^[a-f0-9]{64}$/.test(project.latestOutput?.provenance?.outputHash || '')) fail('THUMBNAIL_SOURCE_HASH', 'The current export needs a recorded SHA-256 before thumbnail generation.');
      if (asset) { const mime = JSON.parse(asset.document).mime || ''; if (!mime.startsWith(sourceMode === 'video' ? 'video/' : 'image/')) fail('THUMBNAIL_SOURCE', 'The selected media type does not match.'); }
      const id = randomUUID(), outputDir = path.join(jobsDir, id), createdAt = new Date().toISOString();
      busy = true;
      try {
        db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, projectId, row.revision, 'thumbnail', 'running', 0, 'Composing 4K thumbnail', JSON.stringify({ sourceAssetId: assetId, source: sourceMode, progressUnit: 'percent' }), 1, createdAt, createdAt);
        const thumbnail = await buildThumbnail({ outputDir, ffmpeg: ffmpeg || path.join(root, 'workers/tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ffprobe: ffprobe || path.join(root, 'workers/tools', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'), fontPath: fontPath || (process.platform === 'win32' ? 'C:/Windows/Fonts/segoeuib.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'), ...(sourceMode === 'video' ? { videoPath: asset.path, sourceHash: project.latestOutput?.provenance?.outputHash } : sourceMode === 'image' ? { imagePath: asset.path } : {}), projectId, sourceAssetId: assetId, title: input.title || project.title || project.name, prompt: input.prompt || '', style: input.style || 'cinematic', atSeconds: input.atSeconds });
        const assets = {};
        db.exec('BEGIN IMMEDIATE');
        try {
          const latest = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
          const attached = latest?.revision === row.revision;
          for (const key of ['master', 'upload', 'preview']) {
            const artifact = thumbnail.artifacts[key], assetId = randomUUID(); assets[key] = assetId;
            db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(assetId, projectId, JSON.stringify({ name: artifact.file, mime: artifact.mime, size: artifact.bytes, kind: 'image', jobId: id, provenance: { generationStatus: 'edited', sourceMethod: thumbnail.method, sourceHash: thumbnail.sourceHash, outputHash: artifact.sha256 } }), path.join(outputDir, artifact.file), createdAt);
          }
          const receipt = { ...thumbnail, assets, jobId: id, projectRevision: row.revision, attached };
          if (attached) {
            const next = { ...JSON.parse(latest.document), thumbnailStudio: receipt }, revision = latest.revision + 1, now = new Date().toISOString();
            db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(revision, JSON.stringify(next), now, projectId);
            db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(projectId, revision, JSON.stringify(next), now);
          }
          db.prepare("UPDATE jobs SET status='succeeded',progress=100,stage='Thumbnail ready for review',output=?,updated_at=? WHERE id=?").run(JSON.stringify(receipt), new Date().toISOString(), id);
          db.exec('COMMIT'); return { thumbnail: receipt, attached };
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      } catch (error) { db.prepare("UPDATE jobs SET status='failed',stage='Thumbnail needs attention',error=?,updated_at=? WHERE id=?").run(String(error.message).slice(0,1600), new Date().toISOString(), id); throw error; } finally { busy = false; }
    }
  };
  return service;
}
