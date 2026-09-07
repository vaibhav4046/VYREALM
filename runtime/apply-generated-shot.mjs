import { statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const fail = (suffix, message) => { const error = new Error(`APPLY_GENERATED_${suffix}: ${message}`); error.code = `APPLY_GENERATED_${suffix}`; throw error; };
const parse = value => { try { const result = JSON.parse(value || '{}'); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; } catch { fail('DOCUMENT_INVALID', 'The saved project or receipt is not a valid object'); } };
const projectView = (row, document = parse(row.document)) => ({ ...document, id: row.id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });

/** Attach one reviewed five-second generation without rewriting its job history. */
export function applyGeneratedShot({ db, projectId, expectedRevision, jobId, append = true } = {}) {
  if (!db || typeof projectId !== 'string' || !projectId || typeof jobId !== 'string' || !jobId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || append !== true) fail('INPUT_INVALID', 'An exact project revision, generated job and append:true are required');
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!row) fail('PROJECT_MISSING', 'Project not found');
    if (row.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Project changed; refresh before applying the retained shot');
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    if (!job || job.project_id !== projectId) fail('JOB_OWNERSHIP', 'The source job must belong to this project');
    if (!['generation-test', 'generation-shot'].includes(job.type)) fail('JOB_TYPE', 'Only a local generation test or shot can be applied');
    const output = parse(job.output), review = output.review, provenance = output.provenance;
    if (job.status !== 'succeeded' || review?.verdict !== 'passed' || !review.notes?.trim() || !review.reviewer || !review.reviewedAt) fail('REVIEW_REQUIRED', 'Complete and visually review this generated shot first');
    if (!/^[a-f0-9]{64}$/.test(provenance?.outputHash || '') || review.outputHash !== provenance.outputHash) fail('REVIEW_HASH', 'The passed review must identify this exact generated output');
    if (provenance.generationStatus !== 'generated' || output.verification?.ok !== true) fail('PROVENANCE', 'A technically verified locally generated receipt is required');
    if (Number(output.durationSeconds) !== 5) fail('DURATION', 'This recovery operation accepts a complete five-second generated shot');
    const assets = [];
    for (const kind of ['sourceVideo', 'video', 'poster', 'quality']) {
      const id = output.assets?.[kind];
      if (id == null && !['sourceVideo', 'video'].includes(kind)) continue;
      const asset = typeof id === 'string' && db.prepare('SELECT * FROM assets WHERE id=?').get(id);
      if (!asset) fail('ASSET_MISSING', `The retained ${kind} asset is missing`);
      const metadata = parse(asset.document);
      if (metadata.jobId !== jobId || asset.project_id != null && asset.project_id !== projectId || ['sourceVideo', 'video'].includes(kind) && !/^video\//.test(metadata.mime || '')) fail('ASSET_OWNERSHIP', `The ${kind} asset does not belong to this generated job and project`);
      let file;
      try { file = statSync(asset.path); } catch { fail('FILE_MISSING', `The retained ${kind} file is unavailable`); }
      if (!file.isFile() || file.size === 0) fail('FILE_MISSING', `The retained ${kind} file is empty or unavailable`);
      assets.push(asset);
    }
    const document = parse(row.document);
    if (document.timeline != null && !Array.isArray(document.timeline) || document.operations != null && !Array.isArray(document.operations)) fail('DOCUMENT_INVALID', 'Timeline and operations must remain editable arrays');
    db.exec('CREATE TABLE IF NOT EXISTS generated_shot_applications(project_id TEXT NOT NULL,job_id TEXT NOT NULL,applied_revision INTEGER NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,job_id));');
    const previous = db.prepare('SELECT document FROM generated_shot_applications WHERE project_id=? AND job_id=?').get(projectId, jobId);
    if (previous) {
      db.exec('COMMIT');
      return { applied: false, alreadyApplied: true, project: projectView(row, document), clipId: parse(previous.document).clipId, jobId };
    }
    const existingClip = (document.timeline || []).find(clip => clip.sourceJobId === jobId || clip.assetId === output.assets.sourceVideo);
    const updatedAt = new Date().toISOString(), revision = row.revision + 1, clipId = existingClip?.id || randomUUID();
    const audit = { id: randomUUID(), type: 'apply_generated_shot', jobId, sourceJobRevision: job.revision, expectedRevision, appliedRevision: revision, clipId, sourceVideoAssetId: output.assets.sourceVideo, videoAssetId: output.assets.video, outputHash: provenance.outputHash, alreadyPresent: Boolean(existingClip), appliedAt: updatedAt };
    for (const asset of assets) db.prepare('UPDATE assets SET project_id=? WHERE id=?').run(projectId, asset.id);
    if (!existingClip) document.timeline = [...(document.timeline || []), { id: clipId, kind: 'video', assetId: output.assets.sourceVideo, sourceJobId: jobId, duration: 5, trimStart: 0, caption: '', provenance }];
    document.operations = [...(document.operations || []), audit];
    document.latestOutput = { videoAssetId: output.assets.video, sourceVideoAssetId: output.assets.sourceVideo, posterAssetId: output.assets.poster || null, qualityAssetId: output.assets.quality || null, status: 'reviewed', jobId, provenance, verification: output.verification, review };
    const saved = JSON.stringify(document);
    db.prepare('UPDATE projects SET revision=?,document=?,updated_at=? WHERE id=?').run(revision, saved, updatedAt, projectId);
    db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run(projectId, revision, saved, updatedAt);
    db.prepare('INSERT INTO generated_shot_applications VALUES(?,?,?,?,?)').run(projectId, jobId, revision, JSON.stringify(audit), updatedAt);
    db.exec('COMMIT');
    return { applied: true, alreadyApplied: false, project: projectView({ ...row, revision, updated_at: updatedAt }, document), clipId, jobId };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the original validation or storage error. */ }
    throw error;
  }
}
