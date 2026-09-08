import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { applyGeneratedShot } from './apply-generated-shot.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'vyrealm-apply-shot-'));
  const db = new DatabaseSync(join(directory, 'test.sqlite'));
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT,PRIMARY KEY(project_id,revision));
    CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);
    CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,input TEXT,output TEXT,created_at TEXT,updated_at TEXT);`);
  t.after(() => { db.close(); assert(resolve(directory).startsWith(resolve(tmpdir()) + sep)); rmSync(directory, { recursive: true, force: true }); });
  const timestamp = '2026-09-07T21:00:00.000Z';
  const document = { name: 'Retained user project', timeline: [{ id: 'existing', kind: 'video', assetId: 'user-asset', duration: 3, caption: 'keep this edit' }], settings: { width: 1920, height: 1080, fps: 24 }, transcript: [{ start: 0, end: 1, text: 'Keep me' }], operations: [{ type: 'prior-edit' }], latestOutput: { status: 'blocked', jobId: 'job-1' } };
  const provenance = { generationStatus: 'generated', sourceMethod: 'local-wan22-gguf', providerId: 'comfyui', modelId: 'wan-test-model', evidenceHash: 'e'.repeat(64), workflowHash: 'w'.repeat(64), outputHash: 'a'.repeat(64) };
  const output = { durationSeconds: 5, status: 'reviewed', provenance, verification: { ok: true }, review: { verdict: 'passed', notes: 'Inspected source clip.', reviewer: 'operator-visual-review', reviewedAt: timestamp, outputHash: provenance.outputHash }, assets: { sourceVideo: 'source-1', video: 'video-1', poster: 'poster-1', quality: 'quality-1' } };
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-1', 7, JSON.stringify(document), timestamp, timestamp);
  db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run('project-1', 7, JSON.stringify(document), timestamp);
  db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)').run('job-1', 'project-1', 4, 'generation-shot', 'succeeded', JSON.stringify({ append: true, revision: 4, seed: 73, brief: 'Original idea retained.' }), JSON.stringify(output), timestamp, timestamp);
  for (const [kind, id] of Object.entries(output.assets)) {
    const path = join(directory, `${id}.fixture`);
    // Non-media bytes: this suite tests retained-asset transactions, not decoding.
    writeFileSync(path, `owned ${kind} fixture`);
    db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(id, null, JSON.stringify({ jobId: 'job-1', kind, mime: ['sourceVideo', 'video'].includes(kind) ? 'video/mp4' : 'application/json', projectRevisionMatch: false }), path, timestamp);
  }
  const options = { db, projectId: 'project-1', expectedRevision: 7, jobId: 'job-1', append: true };
  const saveOutput = () => db.prepare('UPDATE jobs SET output=? WHERE id=?').run(JSON.stringify(output), 'job-1');
  return { db, directory, document, output, options, saveOutput };
}

test('recovers reviewed stale output atomically while preserving edits and immutable job input', t => {
  const f = fixture(t), beforeJob = f.db.prepare('SELECT * FROM jobs').get();
  const result = applyGeneratedShot(f.options);
  assert.equal(result.applied, true);
  assert.equal(result.alreadyApplied, false);
  assert.equal(result.project.revision, 8);
  assert.equal(result.project.timeline.length, 2);
  assert.deepEqual(result.project.timeline[0], f.document.timeline[0]);
  assert.deepEqual(result.project.transcript, f.document.transcript);
  assert.deepEqual(result.project.settings, f.document.settings);
  assert.equal(result.project.timeline[1].assetId, 'source-1');
  assert.equal(result.project.timeline[1].duration, 5);
  assert.equal(result.project.timeline[1].sourceJobId, 'job-1');
  assert.equal(result.project.latestOutput.status, 'reviewed');
  assert.deepEqual(result.project.latestOutput.provenance, f.output.provenance);
  assert.deepEqual(f.db.prepare('SELECT * FROM jobs').get(), beforeJob);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE project_id=?').get('project-1').n, 4);
  assert.equal(JSON.parse(f.db.prepare('SELECT document FROM assets WHERE id=?').get('source-1').document).projectRevisionMatch, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM project_revisions').get().n, 2);
  const audit = JSON.parse(f.db.prepare('SELECT document FROM generated_shot_applications').get().document);
  assert.equal(audit.sourceJobRevision, 4);
  assert.equal(audit.appliedRevision, 8);
  assert.equal(audit.expectedRevision, 7);
  assert.equal(audit.sourceVideoAssetId, 'source-1');
  assert.equal(result.project.operations.at(-1).type, 'apply_generated_shot');
});

test('requires an exact safe-integer revision and append-only intent', t => {
  const f = fixture(t);
  for (const expectedRevision of [undefined, '7', 6, 8]) assert.throws(() => applyGeneratedShot({ ...f.options, expectedRevision }), /APPLY_GENERATED_(INPUT_INVALID|REVISION_CONFLICT)/);
  assert.throws(() => applyGeneratedShot({ ...f.options, append: false }), /APPLY_GENERATED_INPUT_INVALID/);
  assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision, 7);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE project_id IS NULL').get().n, 4);
});

test('rejects wrong project, unsupported job types, incomplete jobs and missing review', t => {
  const f = fixture(t);
  assert.throws(() => applyGeneratedShot({ ...f.options, projectId: 'other' }), /APPLY_GENERATED_PROJECT_MISSING/);
  f.db.prepare('UPDATE jobs SET project_id=?').run('other');
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_JOB_OWNERSHIP/);
  f.db.prepare('UPDATE jobs SET project_id=?,type=?').run('project-1', 'render');
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_JOB_TYPE/);
  f.db.prepare('UPDATE jobs SET type=?,status=?').run('generation-test', 'review_required');
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_REVIEW_REQUIRED/);
  f.db.prepare('UPDATE jobs SET status=?').run('succeeded');
  f.output.review.verdict = 'rejected'; f.saveOutput();
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_REVIEW_REQUIRED/);
  assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision, 7);
});

test('rejects reviews for different output hashes and non-generated or non-five-second receipts', t => {
  const f = fixture(t);
  f.output.review.outputHash = 'b'.repeat(64); f.saveOutput();
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_REVIEW_HASH/);
  f.output.review.outputHash = f.output.provenance.outputHash;
  f.output.provenance.generationStatus = 'fallback'; f.saveOutput();
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_PROVENANCE/);
  f.output.provenance.generationStatus = 'generated'; f.output.durationSeconds = 2; f.saveOutput();
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_DURATION/);
});

test('rejects missing assets, mismatched asset jobs, wrong owners and absent local files', t => {
  const f = fixture(t);
  f.output.assets.sourceVideo = 'missing'; f.saveOutput();
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_ASSET_MISSING/);
  f.output.assets.sourceVideo = 'source-1'; f.saveOutput();
  f.db.prepare('UPDATE assets SET document=? WHERE id=?').run(JSON.stringify({ jobId: 'wrong', mime: 'video/mp4' }), 'source-1');
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_ASSET_OWNERSHIP/);
  f.db.prepare('UPDATE assets SET document=?,project_id=? WHERE id=?').run(JSON.stringify({ jobId: 'job-1', mime: 'video/mp4' }), 'other', 'source-1');
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_ASSET_OWNERSHIP/);
  f.db.prepare('UPDATE assets SET project_id=NULL,path=? WHERE id=?').run(join(f.directory, 'does-not-exist.mp4'), 'source-1');
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_FILE_MISSING/);
  assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision, 7);
  assert.equal(f.db.prepare('SELECT project_id FROM assets WHERE id=?').get('video-1').project_id, null);
});

test('accepts already-owned assets and prevents a duplicate append across repeated calls', t => {
  const f = fixture(t);
  f.db.prepare('UPDATE assets SET project_id=? WHERE id=?').run('project-1', 'source-1');
  const first = applyGeneratedShot(f.options);
  assert.equal(first.applied, true);
  assert.throws(() => applyGeneratedShot(f.options), /APPLY_GENERATED_REVISION_CONFLICT/);
  const second = applyGeneratedShot({ ...f.options, expectedRevision: 8 });
  assert.equal(second.applied, false);
  assert.equal(second.alreadyApplied, true);
  assert.equal(second.project.revision, 8);
  assert.equal(second.project.timeline.length, 2);
  assert.equal(second.clipId, first.clipId);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM generated_shot_applications').get().n, 1);
});

test('rolls back every asset attachment and revision when persistence fails', t => {
  const f = fixture(t), beforeJob = f.db.prepare('SELECT * FROM jobs').get();
  f.db.exec("CREATE TRIGGER reject_revision BEFORE INSERT ON project_revisions BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");
  assert.throws(() => applyGeneratedShot(f.options), /fixture write failure/);
  assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision, 7);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE project_id IS NULL').get().n, 4);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM project_revisions').get().n, 1);
  assert.deepEqual(f.db.prepare('SELECT * FROM jobs').get(), beforeJob);
});

test('an existing timeline reference is retained while its orphan assets are recovered once', t => {
  const f = fixture(t);
  f.document.timeline.push({ id: 'existing-generated', kind: 'video', assetId: 'source-1', duration: 5, trimStart: 0, caption: 'User caption remains' });
  f.db.prepare('UPDATE projects SET document=?').run(JSON.stringify(f.document));
  const result = applyGeneratedShot(f.options);
  assert.equal(result.applied, true);
  assert.equal(result.project.timeline.length, 2);
  assert.equal(result.project.timeline[1].caption, 'User caption remains');
  assert.equal(result.clipId, 'existing-generated');
  assert.equal(result.project.latestOutput.status, 'reviewed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE project_id=?').get('project-1').n, 4);
});

test('durable application audit prevents repeated append after the user removes the clip', t => {
  const f = fixture(t), first = applyGeneratedShot(f.options);
  const document = { ...first.project, timeline: [first.project.timeline[0]] };
  f.db.prepare('UPDATE projects SET revision=?,document=?').run(9, JSON.stringify(document));
  const second = applyGeneratedShot({ ...f.options, expectedRevision: 9 });
  assert.equal(second.alreadyApplied, true);
  assert.equal(second.project.timeline.length, 1);
  assert.equal(second.project.revision, 9);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM generated_shot_applications').get().n, 1);
});
