import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileSha256 } from './verified-download.mjs';
import { verifyMedia } from './media-verifier.mjs';

const exec = promisify(execFile);
const hashPattern = /^[a-f0-9]{64}$/;
const parse = value => JSON.parse(value || '{}');
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
const publicEntry = ({ filePath, fileIdentity, sourceFilePath, sourceFileIdentity, projectSnapshot, ...entry }) => entry;
const identity = info => ({ bytes: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
const equalIdentity = (left, right) => left && right && left.bytes === right.bytes && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;

export function initializeFlagshipCatalogue(db) {
  // Selections are separate from project edits and retained after withdrawal.
  db.exec('CREATE TABLE IF NOT EXISTS flagship_catalogue (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, selected_at TEXT NOT NULL, withdrawn_at TEXT);');
}

function sourceKinds(provenance, sourceHash, depth = 0) {
  if (!provenance || depth > 12 || /primitive|vector|procedural|fallback|explicit-scene/i.test(String(provenance.sourceMethod || ''))) fail('FLAGSHIP_SOURCE_UNQUALIFIED', 'A placeholder or unrecorded source cannot enter the flagship catalogue');
  const status = provenance.generationStatus;
  if (status === 'generated') {
    if (!provenance.providerId || !provenance.modelId || !hashPattern.test(provenance.workflowHash || '') || !hashPattern.test(provenance.evidenceHash || '') || !hashPattern.test(provenance.outputHash || '')) fail('FLAGSHIP_SOURCE_UNQUALIFIED', 'Generated media requires provider, model, workflow and output evidence');
    return ['locally generated'];
  }
  if (status === 'imported') {
    if (!hashPattern.test(sourceHash || provenance.outputHash || '')) fail('FLAGSHIP_SOURCE_UNQUALIFIED', 'Imported media requires its source hash');
    return ['imported media'];
  }
  if (status === 'edited' && Array.isArray(provenance.sources) && provenance.sources.length) return provenance.sources.flatMap(source => sourceKinds(source.upstream || source.provenance, source.sourceHash, depth + 1));
  if (status === 'upscaled' && provenance.source) return sourceKinds(provenance.source, provenance.sourceHash, depth + 1);
  // Interpolation retains a source receipt under this field.
  if (status === 'edited' && provenance.source) return sourceKinds(provenance.source, provenance.sourceHash, depth + 1);
  fail('FLAGSHIP_SOURCE_UNQUALIFIED', 'The complete generated or imported source lineage is required');
}

function candidate(db, projectId, expectedRevision) {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!project) fail('FLAGSHIP_PROJECT_MISSING', 'Project not found');
  if (project.revision !== expectedRevision) fail('FLAGSHIP_REVISION_CONFLICT', 'Refresh and save the project before selecting a flagship');
  const document = parse(project.document), latest = document.latestOutput;
  if (document.demo) fail('FLAGSHIP_DEMO_DOCUMENT', 'Demo documents are separate from the flagship film catalogue');
  const job = latest?.jobId && db.prepare('SELECT * FROM jobs WHERE id=?').get(latest.jobId);
  const asset = latest?.videoAssetId && db.prepare('SELECT * FROM assets WHERE id=?').get(latest.videoAssetId);
  if (!job || !asset || job.project_id !== projectId || asset.project_id !== projectId || parse(asset.document).jobId !== job.id || !/^video\//.test(parse(asset.document).mime || '')) fail('FLAGSHIP_OUTPUT_OWNERSHIP', 'A rendered video owned by this saved project is required');
  const output = parse(job.output), provenance = output.provenance, review = output.review;
  if (job.status !== 'succeeded' || latest.status !== 'reviewed' || review?.verdict !== 'passed' || !review.notes?.trim() || !review.reviewer || !review.reviewedAt) fail('FLAGSHIP_REVIEW_REQUIRED', 'Inspect the complete final output and record a passed visual review first');
  if (!hashPattern.test(provenance?.outputHash || '') || review.outputHash !== provenance.outputHash || latest.provenance?.outputHash !== provenance.outputHash) fail('FLAGSHIP_REVIEW_HASH_MISMATCH', 'The review must identify this exact output hash');
  if (output.assets?.video !== asset.id || !output.outputs?.video || output.verification?.ok !== true) fail('FLAGSHIP_VERIFICATION_REQUIRED', 'The worker receipt must contain a technically verified output');
  const kinds = [...new Set(sourceKinds(provenance))];
  return { project, document, job, asset, output, kinds };
}

export async function selectFlagship({ db, jobsDir, mediaDir, ffmpeg, ffprobe, projectId, expectedRevision, title, description } = {}) {
  const checked = candidate(db, projectId, expectedRevision), { project, document, job, asset, output, kinds } = checked;
  if (title != null && (typeof title !== 'string' || !title.trim() || title.length > 160) || description != null && (typeof description !== 'string' || description.length > 1200)) fail('FLAGSHIP_METADATA_INVALID', 'Use a title up to 160 characters and description up to 1200 characters');
  if (!/^[a-zA-Z0-9-]+$/.test(job.id)) fail('FLAGSHIP_OUTPUT_OWNERSHIP', 'Invalid job identity');
  let jobRoot, filePath, sourceFilePath, receipt;
  try {
    const jobsRoot = await realpath(jobsDir);
    jobRoot = await realpath(join(jobsDir, job.id));
    const jobRelative = relative(jobsRoot, jobRoot);
    if (!jobRelative || jobRelative.startsWith('..') || isAbsolute(jobRelative)) fail('FLAGSHIP_OUTPUT_OWNERSHIP', 'The saved job directory must remain inside the VYREALM job store');
    sourceFilePath = await realpath(resolve(jobRoot, output.outputs.video));
    const sourceRelative = relative(jobRoot, sourceFilePath);
    if (!sourceRelative || sourceRelative.startsWith('..') || isAbsolute(sourceRelative)) fail('FLAGSHIP_OUTPUT_OWNERSHIP', 'The original output must remain inside its VYREALM job');
    filePath = await realpath(asset.path);
    const mediaRoot = await realpath(mediaDir), mediaRelative = relative(mediaRoot, filePath);
    if (!mediaRelative || mediaRelative.startsWith('..') || isAbsolute(mediaRelative)) fail('FLAGSHIP_OUTPUT_OWNERSHIP', 'The registered playback copy must remain inside the VYREALM media store');
    receipt = parse(await readFile(join(jobRoot, 'result.json'), 'utf8'));
  } catch (error) { if (error.code?.startsWith('FLAGSHIP_')) throw error; fail('FLAGSHIP_OUTPUT_OWNERSHIP', 'The in-job video and receipt must exist'); }
  const outputHash = output.provenance.outputHash;
  if (receipt.provenance?.outputHash !== outputHash || receipt.outputs?.video !== output.outputs.video || receipt.verification?.ok !== true || receipt.review?.verdict !== 'passed' || receipt.review?.outputHash !== outputHash) fail('FLAGSHIP_RECEIPT_MISMATCH', 'The saved worker receipt and visual review must agree with the project');
  const [before, sourceBefore] = await Promise.all([stat(filePath), stat(sourceFilePath)]);
  const [mediaHash, jobHash] = await Promise.all([fileSha256(filePath), fileSha256(sourceFilePath)]);
  if (!before.isFile() || !sourceBefore.isFile() || mediaHash !== outputHash || jobHash !== outputHash) fail('FLAGSHIP_OUTPUT_HASH_MISMATCH', 'The in-job output and registered playback copy must both match the reviewed video hash');
  const canvas = output.provenance.deliveryResolution || output.provenance.resolution || {};
  const verification = await verifyMedia({ videoPath: filePath, ffmpeg, ffprobe, expected: { width: canvas.width, height: canvas.height, fps: output.provenance.targetFps || output.provenance.fps, durationSeconds: output.durationSeconds || (document.timeline || []).reduce((sum, clip) => sum + Number(clip.duration || 0), 0), requireAudio: true } });
  if (!verification.ok) fail('FLAGSHIP_MEDIA_INVALID', verification.diagnostics.map(item => item.message).join('; '));
  try { await exec(ffmpeg, ['-v','error','-xerror','-i',filePath,'-map','0:v:0','-map','0:a:0','-f','null','-'], { windowsHide: true, timeout: 300_000, maxBuffer: 1_000_000 }); }
  catch { fail('FLAGSHIP_DECODE_FAILED', 'The complete video and audio could not be decoded'); }
  const [after, sourceAfter] = await Promise.all([stat(filePath), stat(sourceFilePath)]);
  if (!equalIdentity(identity(before), identity(after)) || !equalIdentity(identity(sourceBefore), identity(sourceAfter))) fail('FLAGSHIP_OUTPUT_CHANGED', 'The video or in-job original changed during verification');
  // Decode is asynchronous: re-check the revision and review before committing.
  const current = candidate(db, projectId, expectedRevision);
  if (current.job.id !== job.id || current.output.provenance.outputHash !== outputHash) fail('FLAGSHIP_OUTPUT_CHANGED', 'The current reviewed output changed during verification');
  const selectedAt = new Date().toISOString(), id = randomUUID();
  const sourceLabel = `${output.provenance.generationStatus === 'generated' ? 'Generated locally' : output.provenance.generationStatus === 'upscaled' ? 'Upscaled' : 'Edited'}${output.provenance.generationStatus === 'generated' ? '' : ` · ${kinds.join(' + ')}`}`;
  const entry = { id, projectId, projectRevision: project.revision, jobId: job.id, title: title?.trim() || String(document.title || document.name || 'Untitled film').slice(0, 160), description: description?.trim() || String(document.description || document.brief || '').slice(0, 1200), videoAssetId: asset.id, posterAssetId: document.latestOutput.posterAssetId || null, outputHash, sourceLabel, provenance: output.provenance, review: output.review, selectedAt, verification: { fullDecode: true, width: verification.checks.resolution.actual.width, height: verification.checks.resolution.actual.height, durationSeconds: verification.checks.duration.actual, fps: verification.checks.frameRate.actual, hasAudio: true, checkedAt: selectedAt }, filePath, fileIdentity: identity(after), sourceFilePath, sourceFileIdentity: identity(sourceAfter), projectSnapshot: document };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE flagship_catalogue SET active=0,withdrawn_at=? WHERE project_id=? AND active=1').run(selectedAt, projectId);
    db.prepare('INSERT INTO flagship_catalogue(id,project_id,document,active,selected_at) VALUES(?,?,?,1,?)').run(id, projectId, JSON.stringify(entry), selectedAt);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return publicEntry(entry);
}

export async function listFlagships({ db } = {}) {
  const entries = [];
  for (const row of db.prepare('SELECT * FROM flagship_catalogue WHERE active=1 ORDER BY selected_at DESC').all()) {
    try {
      const entry = parse(row.document), job = db.prepare('SELECT * FROM jobs WHERE id=?').get(entry.jobId), output = parse(job?.output), asset = db.prepare('SELECT * FROM assets WHERE id=?').get(entry.videoAssetId);
      if (job?.status !== 'succeeded' || output.review?.verdict !== 'passed' || output.review.outputHash !== entry.outputHash || output.provenance?.outputHash !== entry.outputHash) continue;
      if (!asset || asset.project_id !== entry.projectId || parse(asset.document).jobId !== entry.jobId || output.assets?.video !== entry.videoAssetId || await realpath(asset.path) !== entry.filePath) continue;
      // Fast invalidation during the UI poll; the full hash and decode were
      // checked on selection, and any file change requires fresh selection.
      if (await realpath(entry.filePath) !== entry.filePath || !equalIdentity(identity(await stat(entry.filePath)), entry.fileIdentity)) continue;
      if (await realpath(entry.sourceFilePath) !== entry.sourceFilePath || !equalIdentity(identity(await stat(entry.sourceFilePath)), entry.sourceFileIdentity)) continue;
      entries.push(publicEntry(entry));
    } catch { /* A missing file or revoked receipt is not shown as a flagship. */ }
  }
  return entries;
}

export function removeFlagship({ db, id } = {}) {
  const result = db.prepare('UPDATE flagship_catalogue SET active=0,withdrawn_at=? WHERE id=? AND active=1').run(new Date().toISOString(), id);
  return { removed: result.changes > 0, id };
}
