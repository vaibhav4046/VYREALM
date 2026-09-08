import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ACTIVE_NEURAL_JOB_TYPES, ACTIVE_HEAVY_JOB_STATUSES, listActiveNeuralJobs, assertNoActiveNeuralJobs } from './heavy-work-admission.mjs';
import { createRawFootageService } from './raw-footage-service.mjs';

function database(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT);CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT)');
  t.after(() => db.close()); return db;
}
function addJob(db, { id = 'neural-job', type = 'generation-shot', status = 'running', projectId = 'another-project' } = {}) {
  db.prepare('INSERT INTO jobs(id,project_id,type,status,input,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, projectId, type, status, '{"serviceOwner":"another-local-service"}', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z');
}
test('every active neural type/status blocks heavy work across all project and service owners', t => {
  const db = database(t);
  assert.deepEqual(ACTIVE_NEURAL_JOB_TYPES, ['generation-keyframe', 'generation-shot', 'generation-test', 'ltx-qualification']);
  assert.deepEqual(ACTIVE_HEAVY_JOB_STATUSES, ['queued', 'running', 'staging', 'validating', 'cancelling']);
  for (const type of ACTIVE_NEURAL_JOB_TYPES) for (const status of ACTIVE_HEAVY_JOB_STATUSES) {
    addJob(db, { type, status });
    assert.throws(() => assertNoActiveNeuralJobs(db, { operation: 'audio-verify' }), error => {
      assert.equal(error.code, 'HEAVY_WORK_BUSY'); assert.equal(error.jobId, 'neural-job'); assert.equal(error.jobType, type);
      assert.match(error.message, /audio-verify/); assert.match(error.message, /neural-job/);
      assert.deepEqual(error.blockingJobs, [{ jobId: 'neural-job', projectId: 'another-project', type, status }]); return true;
    });
    assert.equal(db.prepare('SELECT status FROM jobs').get().status, status);
    db.exec('DELETE FROM jobs');
  }
});
test('completed, rejected, blocked and review-required neural jobs do not prevent new work', t => {
  const db = database(t);
  for (const status of ['succeeded', 'failed', 'blocked', 'cancelled', 'rejected', 'review_required']) addJob(db, { id: status, status });
  addJob(db, { id: 'render', type: 'render', status: 'running' });
  assert.deepEqual(listActiveNeuralJobs(db), []);
  assert.doesNotThrow(() => assertNoActiveNeuralJobs(db, { operation: 'raw-footage-edit' }));
});
test('read-only admission reports deterministic blocker metadata without reading job prompts', t => {
  const db = database(t);
  addJob(db, { id: 'z' }); addJob(db, { id: 'a', type: 'generation-keyframe', projectId: null });
  const before = db.prepare('SELECT * FROM jobs ORDER BY id').all();
  assert.deepEqual(listActiveNeuralJobs(db).map(item => item.jobId), ['a', 'z']);
  assert.ok(listActiveNeuralJobs(db).every(item => !Object.hasOwn(item, 'input')));
  assert.deepEqual(db.prepare('SELECT * FROM jobs ORDER BY id').all(), before);
});

async function rawFixture(t, inspectSource) {
  const db = database(t), dataDir = await mkdtemp(join(tmpdir(), 'vyrealm-heavy-admission-')), jobsDir = join(dataDir, 'jobs'), mediaDir = join(dataDir, 'media');
  await mkdir(mediaDir); await mkdir(jobsDir);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-1', 1, JSON.stringify({ name: 'Saved project', brief: 'Original brief', timeline: [] }), 'old', 'old');
  db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run('project-1', 1, '{}', 'old');
  db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run('source-1', 'project-1', JSON.stringify({ mime: 'video/mp4' }), join(mediaDir, 'source.mp4'), 'old');
  let probes = 0, workers = 0;
  const service = await createRawFootageService({ db, dataDir, jobsDir, mediaDir, dependencies: {
    inspectSource: async () => { probes++; inspectSource?.(db); return { id: 'source-1', path: join(mediaDir, 'source.mp4'), mime: 'video/mp4', sha256: 'a'.repeat(64), durationSeconds: 5, hasAudio: false }; },
    startWorker: () => { workers++; assert.fail('No worker should start in an admission test'); },
  } });
  // Registered after the DB cleanup above: explicitly close before its handle.
  t.after(async () => {
    await service.close();
    if (dirname(dataDir) === resolve(tmpdir()) && basename(dataDir).startsWith('vyrealm-heavy-admission-')) await rm(dataDir, { recursive: true, force: true });
  });
  return { db, service, jobsDir, counts: () => ({ probes, workers }) };
}
const rawInput = { projectId: 'project-1', expectedRevision: 1, brief: 'Trim my uploaded footage.', durationSeconds: 2, captionsEnabled: false };
test('raw editing rejects neural overlap before source reads, subprocesses or project mutation', async t => {
  const f = await rawFixture(t); addJob(f.db, { status: 'cancelling' });
  await assert.rejects(f.service.start(rawInput), { code: 'HEAVY_WORK_BUSY', jobId: 'neural-job' });
  assert.deepEqual(f.counts(), { probes: 0, workers: 0 }); assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n, 1); assert.deepEqual(await readdir(f.jobsDir), []);
});
test('raw commit rechecks neural admission after asynchronous source inspection and rolls back', async t => {
  const f = await rawFixture(t, db => addJob(db, { type: 'ltx-qualification', status: 'queued' }));
  await assert.rejects(f.service.start(rawInput), { code: 'HEAVY_WORK_BUSY', jobType: 'ltx-qualification' });
  assert.deepEqual(f.counts(), { probes: 1, workers: 0 }); assert.equal(f.db.prepare('SELECT revision FROM projects').get().revision, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM project_revisions').get().n, 1);
  assert.deepEqual(f.db.prepare('SELECT type,status FROM jobs').all().map(row => ({ ...row })), [{ type: 'ltx-qualification', status: 'queued' }]);
  assert.equal(f.db.isTransaction, false);
});
