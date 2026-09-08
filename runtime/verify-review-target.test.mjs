import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyReviewTarget } from './verify-review-target.mjs';

const exec = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ffmpeg = resolve('workers/tools/ffmpeg.exe'), ffprobe = resolve('workers/tools/ffprobe.exe');
async function fixture(t, generated = false) {
  const dir = await mkdtemp(join(tmpdir(), 'vyrealm-review-target-')), jobsDir = join(dir, 'jobs'), mediaDir = join(dir, 'media'), jobRoot = join(jobsDir, 'job-1');
  await mkdir(jobRoot, { recursive: true }); await mkdir(mediaDir);
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,output TEXT); CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT);');
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const source = join(jobRoot, 'source.mp4'), video = join(jobRoot, 'render.mp4'), served = join(mediaDir, 'asset-1.mp4');
  // Tiny synthetic test media exercises byte integrity, never model quality.
  await exec(ffmpeg, ['-y','-v','error','-f','lavfi','-i','testsrc2=s=128x72:r=8','-frames:v','8','-c:v','libx264','-threads','2',source], { windowsHide: true });
  if (generated) await exec(ffmpeg, ['-y','-v','error','-i',source,'-vf','scale=1920:1080:flags=lanczos','-c:v','libx264','-threads','2','-crf','18',video], { windowsHide: true });
  else await copyFile(source, video);
  await copyFile(video, served);
  const receipt = { status: 'review_required', outputs: { video: 'render.mp4', ...(generated ? { sourceVideo: 'source.mp4' } : {}) }, durationSeconds: 1, verification: { ok: true }, provenance: { generationStatus: generated ? 'generated' : 'edited', sourceMethod: generated ? 'local-neural-source' : 'local-timeline-edit', outputHash: sha(await readFile(generated ? source : video)), resolution: { width:128, height:72 }, fps:8, frameCount:8, durationSeconds:1, ...(generated ? { outputPath:'source.mp4', providerId:'comfyui-local', modelId:'fixture-only', providerPromptId:'fixture-1', workflowHash:'c'.repeat(64), evidenceHash:'d'.repeat(64), deliveryMethod:'1080p-lanczos-from-128x72', deliveryResolution:{width:1920,height:1080} } : {}) } };
  const output = { ...structuredClone(receipt), assets: { video:'asset-1' } };
  const job = { id:'job-1', project_id:'project-1', status:'review_required' };
  const save = async () => { db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?,?,?)').run(job.id,job.project_id,job.status,JSON.stringify(output)); await writeFile(join(jobRoot,'result.json'),JSON.stringify(receipt)); };
  db.prepare('INSERT INTO assets VALUES(?,?,?,?)').run('asset-1','project-1',JSON.stringify({jobId:'job-1',mime:'video/mp4'}),served);
  await save();
  return { db,dir,jobsDir,mediaDir,jobRoot,source,video,served,receipt,output,job,save, args:{db,jobsDir,mediaDir,job,output,ffmpeg,ffprobe} };
}
test('reviews the actual registered delivery without writing files or SQLite', async t => {
  const f = await fixture(t), before = await readFile(join(f.jobRoot,'result.json'),'utf8'), jobBefore = f.db.prepare('SELECT * FROM jobs').get();
  const result = await verifyReviewTarget({...f.args,expectedOutputHash:f.output.provenance.outputHash});
  assert.equal(result.hash,sha(await readFile(f.served))); assert.equal(result.jobVideoPath,f.video); assert.equal(result.servedVideoPath,f.served);
  assert.equal(await readFile(join(f.jobRoot,'result.json'),'utf8'),before); assert.deepEqual(f.db.prepare('SELECT * FROM jobs').get(),jobBefore);
});
test('retained stale-revision assets with null project owner can be reviewed', async t => {
  const f = await fixture(t); f.db.prepare('UPDATE assets SET project_id=NULL').run();
  assert.equal((await verifyReviewTarget(f.args)).hash,f.output.provenance.outputHash);
});
test('incomplete jobs, stale snapshots and invalid expected hashes fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(verifyReviewTarget({...f.args,job:{...f.job,status:'running'}}),/REVIEW_TARGET_INCOMPLETE/);
  await assert.rejects(verifyReviewTarget({...f.args,expectedOutputHash:'bad'}),/REVIEW_TARGET_EXPECTED_HASH/);
  await assert.rejects(verifyReviewTarget({...f.args,expectedOutputHash:'0'.repeat(64)}),/REVIEW_TARGET_EXPECTED_HASH/);
  f.db.prepare("UPDATE jobs SET status='running'").run();
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_CHANGED/);
});
test('cross-project or cross-job registered assets are rejected', async t => {
  const f = await fixture(t); f.db.prepare("UPDATE assets SET project_id='other'").run();
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_OWNERSHIP/);
  f.db.prepare('UPDATE assets SET project_id=NULL,document=?').run(JSON.stringify({jobId:'other',mime:'video/mp4'}));
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_OWNERSHIP/);
});
test('external served files and escaping original paths cannot be reviewed', async t => {
  const f = await fixture(t); f.db.prepare('UPDATE assets SET path=?').run(f.source);
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_OWNERSHIP/);
  f.db.prepare('UPDATE assets SET path=?').run(f.served);
  f.output.outputs.video=f.served; f.receipt.outputs.video=f.served; await f.save();
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_OWNERSHIP/);
});
test('receipt-only evidence or hash changes cannot be accepted through database metadata', async t => {
  const f = await fixture(t); f.receipt.provenance.outputHash='a'.repeat(64); await f.save();
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_RECEIPT_MISMATCH/);
});
test('changed or missing job original cannot be replaced by the served copy', async t => {
  const f = await fixture(t); await writeFile(f.video,'changed');
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_HASH_MISMATCH/);
  await rm(f.video); await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_OWNERSHIP/);
});
test('changed playback copy fails despite the intact job original', async t => {
  const f = await fixture(t); await writeFile(f.served,'changed');
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_HASH_MISMATCH/);
});
test('matching hashes do not allow an undecodable result', async t => {
  const f = await fixture(t), invalid=Buffer.from('not an mp4'); await writeFile(f.video,invalid); await writeFile(f.served,invalid);
  f.output.provenance.outputHash=sha(invalid); f.receipt.provenance.outputHash=sha(invalid); await f.save();
  await assert.rejects(verifyReviewTarget(f.args),/REVIEW_TARGET_MEDIA_INVALID/);
});
test('a job changed during full media verification cannot receive the stale review', async t => {
  const f = await fixture(t); let jobReads=0;
  const db={prepare(sql) {
    if(sql==='SELECT * FROM jobs WHERE id=?' && ++jobReads===2) f.db.prepare("UPDATE jobs SET status='running'").run();
    return f.db.prepare(sql);
  }};
  await assert.rejects(verifyReviewTarget({...f.args,db}),/REVIEW_TARGET_CHANGED/);
  assert.equal(jobReads,2);
});
test('upscaled delivery and a previously rejected edit remain reviewable as their true source type', async t => {
  const f = await fixture(t); f.output.provenance.generationStatus='upscaled'; f.receipt.provenance.generationStatus='upscaled'; f.job.status='rejected'; await f.save();
  const checked=await verifyReviewTarget(f.args);
  assert.equal(checked.output.provenance.generationStatus,'upscaled'); assert.equal(checked.hash,f.output.provenance.outputHash);
});
test('legacy generated source evidence is retained while the review binds to delivered bytes', async t => {
  const f = await fixture(t,true), before=structuredClone(f.output), nativeHash=f.output.provenance.outputHash;
  const result=await verifyReviewTarget(f.args);
  assert.notEqual(result.hash,nativeHash); assert.equal(result.hash,sha(await readFile(f.served)));
  assert.equal(result.output.provenance.source.outputHash,nativeHash); assert.equal(result.output.provenance.source.evidenceHash,before.provenance.evidenceHash);
  assert.deepEqual(result.output.provenance,result.receipt.provenance); assert.deepEqual(f.output,before);
  assert.equal(result.output.provenance.deliveryVerification.fullyDecoded,true);
});
