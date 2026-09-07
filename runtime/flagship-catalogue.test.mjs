import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { initializeFlagshipCatalogue, selectFlagship, listFlagships, removeFlagship } from './flagship-catalogue.mjs';

const exec = promisify(execFile);
const ffmpeg = resolve('workers/tools/ffmpeg.exe'), ffprobe = resolve('workers/tools/ffprobe.exe');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'vyrealm-flagship-')), jobsDir = join(dir, 'jobs'), jobDir = join(jobsDir, 'job-1'), mediaDir = join(dir, 'media');
  await mkdir(jobDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'vyrelum.sqlite'));
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT); CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT); CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);');
  initializeFlagshipCatalogue(db);
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const jobVideoPath = join(jobDir, 'render.mp4'), videoPath = join(mediaDir, 'video-1-render.mp4');
  // This technical fixture is explicitly imported test media, never a cinematic benchmark.
  await exec(ffmpeg, ['-y','-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=24','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',jobVideoPath], { windowsHide: true });
  // Mirror server.js: retain job output and serve a separately owned media copy.
  await copyFile(jobVideoPath, videoPath);
  const outputHash = hash(await readFile(videoPath));
  const review = { verdict: 'passed', notes: 'Technical test fixture inspected for gate coverage.', reviewer: 'operator-visual-review', reviewedAt: '2026-09-07T12:00:00.000Z', outputHash };
  const receipt = { outputs: { video: 'render.mp4' }, verification: { ok: true }, provenance: { generationStatus: 'edited', sourceMethod: 'local-timeline-edit', outputHash, fps: 24, deliveryResolution: { width: 160, height: 90 }, sources: [{ sourceHash: 'a'.repeat(64), upstream: { generationStatus: 'imported', sourceMethod: 'user-media' } }] }, review };
  const document = { name: 'Gate fixture', brief: 'One second verification fixture.', timeline: [{ duration: 1 }], latestOutput: { jobId: 'job-1', videoAssetId: 'video-1', status: 'reviewed', provenance: receipt.provenance } };
  const save = async () => {
    db.prepare('INSERT OR REPLACE INTO projects(id,revision,document,created_at,updated_at) VALUES (?,?,?,?,?)').run('project-1', 3, JSON.stringify(document), review.reviewedAt, review.reviewedAt);
    db.prepare('INSERT OR REPLACE INTO assets(id,project_id,document,path,created_at) VALUES (?,?,?,?,?)').run('video-1', 'project-1', JSON.stringify({ jobId: 'job-1', mime: 'video/mp4' }), videoPath, review.reviewedAt);
    db.prepare('INSERT OR REPLACE INTO jobs(id,project_id,revision,type,status,output,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('job-1', 'project-1', 2, 'render', 'succeeded', JSON.stringify({ ...receipt, assets: { video: 'video-1' } }), review.reviewedAt, review.reviewedAt);
    await writeFile(join(jobDir, 'result.json'), JSON.stringify(receipt));
  };
  await save();
  return { db, dir, jobsDir, mediaDir, jobVideoPath, videoPath, receipt, document, save, options: { db, jobsDir, mediaDir, ffmpeg, ffprobe, projectId: 'project-1', expectedRevision: 3 } };
}

test('a reviewed owned playable output becomes a durable local flagship and removal retains history', async t => {
  const f = await fixture(t), result = await selectFlagship(f.options);
  assert.notEqual(f.videoPath, f.jobVideoPath);
  assert.equal(result.outputHash, f.receipt.provenance.outputHash);
  assert.equal(result.projectRevision, 3);
  assert.equal(result.sourceLabel, 'Edited · imported media');
  assert.equal(result.verification.fullDecode, true);
  assert.equal((await listFlagships({ db: f.db })).length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM flagship_catalogue').get().n, 1);
  removeFlagship({ db: f.db, id: result.id });
  assert.equal((await listFlagships({ db: f.db })).length, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM flagship_catalogue').get().n, 1);
});

test('rejects stale revisions, unreviewed output, forged hash, and fallback lineage', async t => {
  const f = await fixture(t);
  await assert.rejects(selectFlagship({ ...f.options, expectedRevision: 2 }), /FLAGSHIP_REVISION_CONFLICT/);
  f.receipt.review.verdict = 'rejected'; await f.save();
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_REVIEW_REQUIRED/);
  f.receipt.review.verdict = 'passed'; f.receipt.review.outputHash = 'b'.repeat(64); await f.save();
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_REVIEW_HASH_MISMATCH/);
  f.receipt.review.outputHash = f.receipt.provenance.outputHash;
  f.receipt.provenance.sources[0].upstream = { generationStatus: 'fallback', sourceMethod: 'bundled-vector-keyframe' }; await f.save();
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_SOURCE_UNQUALIFIED/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM flagship_catalogue').get().n, 0);
});

test('rejects output bytes changed since visual review and copied external outputs', async t => {
  const f = await fixture(t);
  await writeFile(f.videoPath, 'corrupted video');
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_OUTPUT_HASH_MISMATCH/);
  f.db.prepare('UPDATE assets SET path=?').run(join(f.jobsDir, '..', 'outside.mp4'));
  await writeFile(join(f.jobsDir, '..', 'outside.mp4'), 'external media');
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_OUTPUT_OWNERSHIP/);
});

test('a revoked review or changed file is removed from the visible flagship selection', async t => {
  const f = await fixture(t);
  await selectFlagship(f.options);
  f.receipt.review.verdict = 'rejected'; await f.save();
  assert.equal((await listFlagships({ db: f.db })).length, 0);
  f.receipt.review.verdict = 'passed'; await f.save();
  assert.equal((await listFlagships({ db: f.db })).length, 1);
  await writeFile(f.videoPath, 'tampered after selection');
  assert.equal((await listFlagships({ db: f.db })).length, 0);
});

test('an unplayable output cannot be selected even when its claimed hash matches', async t => {
  const f = await fixture(t), invalid = Buffer.from('This is not an MP4');
  await writeFile(f.videoPath, invalid);
  await writeFile(f.jobVideoPath, invalid);
  f.receipt.provenance.outputHash = hash(invalid); f.receipt.review.outputHash = hash(invalid); await f.save();
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_MEDIA_INVALID/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM flagship_catalogue').get().n, 0);
});

test('a removed asset cannot remain a playable flagship entry', async t => {
  const f = await fixture(t);
  await selectFlagship(f.options);
  f.db.prepare('DELETE FROM assets WHERE id=?').run('video-1');
  assert.equal((await listFlagships({ db: f.db })).length, 0);
});

test('a served media copy cannot stand in for a missing or altered in-job original', async t => {
  const f = await fixture(t);
  await writeFile(f.jobVideoPath, 'replaced in-job source');
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_OUTPUT_HASH_MISMATCH/);
  await rm(f.jobVideoPath);
  await assert.rejects(selectFlagship(f.options), /FLAGSHIP_OUTPUT_OWNERSHIP/);
});

test('catalogue UI selects, plays, downloads and withdraws a verified film through the real API', { timeout: 60_000 }, async t => {
  const f = await fixture(t), socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: resolve('.'), env: { ...process.env, PORT: String(port), VYRELUM_ROOT: resolve('.'), VYRELUM_DATA_DIR: f.dir, VYRELUM_RUNTIME_DIR: join(f.dir, 'runtime'), VYRELUM_FFMPEG: ffmpeg, VYRELUM_FFPROBE: ffprobe }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const exited = once(child, 'exit'); let browser, logs = '';
  child.stdout.on('data', chunk => logs += chunk); child.stderr.on('data', chunk => logs += chunk);
  try {
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Test server did not start: ${logs}`)), 10_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('control plane listening')) { clearTimeout(timeout); resolveReady(); } });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}: ${logs}`)); });
    });
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole('button', { name: /Catalog/ }).click();
    await page.getByRole('button', { name: /Gate fixture/ }).click();
    await page.getByRole('button', { name: /Catalog/ }).click();
    await page.getByRole('button', { name: 'Add reviewed film to flagship' }).click();
    await page.getByRole('button', { name: 'Remove from flagship' }).waitFor();
    const video = page.getByLabel('Gate fixture', { exact: true });
    await video.evaluate(async element => { await element.play(); });
    assert.equal(await video.evaluate(element => element.videoWidth), 160);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download film' }).click();
    assert.equal((await downloaded).suggestedFilename(), 'Gate-fixture.mp4');
    await page.reload();
    await page.getByRole('button', { name: /Catalog/ }).click();
    await page.getByRole('button', { name: 'Remove from flagship' }).waitFor();
    await page.getByRole('button', { name: 'Remove from flagship' }).click();
    await page.getByText('No film has passed the flagship selection gate yet.').waitFor();
    assert.deepEqual(errors, []);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM flagship_catalogue').get().n, 1);
    assert.equal(f.db.prepare('SELECT active FROM flagship_catalogue').get().active, 0);
  } finally {
    await browser?.close(); child.kill(); await exited;
  }
});
