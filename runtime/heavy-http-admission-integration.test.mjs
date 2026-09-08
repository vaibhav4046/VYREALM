import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vyrealm-heavy-http-'));
  const dataDir = join(directory, 'data'), runtimeDir = join(directory, 'runtime');
  await mkdir(runtimeDir);
  // This isolated tripwire makes audio factory initialization fail with ENOTDIR.
  // A 409 HEAVY_WORK_BUSY therefore proves admission happens before that factory.
  const audioTripwire = join(runtimeDir, 'audio-onboarding');
  await writeFile(audioTripwire, 'Do not instantiate audio onboarding in this admission test.');
  // Defence in depth: even if a guard regresses, a registered invalid config
  // prevents both a download/install and a local voice verification process.
  await writeFile(join(runtimeDir, 'audio.json'), '{}');
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [join(root, 'server.js')], { cwd: root, windowsHide: true,
    env: { ...process.env, PORT: String(port), VYRELUM_ROOT: root, VYRELUM_DATA_DIR: dataDir, VYRELUM_RUNTIME_DIR: runtimeDir,
      LOCALAPPDATA: join(directory, 'local-app-data'), APPDATA: join(directory, 'app-data'),
      VYRELUM_GPU_LEASE_DIR: join(directory, 'gpu-lease'), VYRELUM_COMFYUI_URL: 'http://127.0.0.1:1', OLLAMA_HOST: 'http://127.0.0.1:1',
      VYRELUM_FFMPEG: join(directory, 'do-not-run-ffmpeg'), VYRELUM_FFPROBE: join(directory, 'do-not-run-ffprobe'),
      HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', UV_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = '', db;
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit'), timer = setTimeout(() => child.kill(), 5000);
      if (child.connected) child.send({ type: 'shutdown' });
      await exited; clearTimeout(timer);
    }
    db?.close();
    if (dirname(directory) === resolve(tmpdir()) && basename(directory).startsWith('vyrealm-heavy-http-')) await rm(directory, { recursive: true, force: true });
  });
  await new Promise((yes, no) => {
    const timer = setTimeout(() => no(Error(`Isolated server start timed out: ${logs}`)), 15000);
    child.stdout.on('data', data => { logs = (logs + data).slice(-12000); if (logs.includes('local control plane listening')) { clearTimeout(timer); yes(); } });
    child.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
    child.once('error', error => { clearTimeout(timer); no(error); });
    child.once('exit', code => { clearTimeout(timer); no(Error(`Isolated server exited ${code}: ${logs}`)); });
  });
  const base = `http://127.0.0.1:${port}`, session = await (await fetch(base + '/api/session')).json();
  const headers = { 'content-type': 'application/json', 'X-Vyrelum-Token': session.token };
  const api = async (path, method = 'GET', body, extraHeaders = {}) => {
    const response = await fetch(base + path, { method, headers: { ...headers, ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  };
  // Rows are inserted only after startup recovery/requeue has completed.
  db = new DatabaseSync(join(dataDir, 'vyrelum.sqlite'));
  const addJob = (id, type, status = 'running') => db.prepare('INSERT INTO jobs(id,type,status,input,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, type, status, '{}', 'Synthetic admission fixture; no worker exists', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z');
  return { directory, runtimeDir, dataDir, audioTripwire, db, addJob, api, base, headers, logs: () => logs };
}

test('HTTP heavy admission blocks overlap and releases locks without starting any media worker', { timeout: 45000 }, async t => {
  const f = await fixture(t), { db, addJob, api } = f;
  const created = await api('/api/projects', 'POST', { name: 'Heavy HTTP admission fixture', brief: 'Preserve this editable brief.', mode: 'creator' });
  assert.equal(created.status, 201); const project = created.body;
  await t.test('audio install and verify stop before factory initialization for each neural type', async () => {
    for (const [index, type] of ['generation-keyframe', 'generation-shot', 'generation-test', 'ltx-qualification'].entries()) {
      const id = `neural-${index}`, status = ['queued', 'running', 'validating', 'cancelling'][index]; addJob(id, type, status);
      for (const mode of ['install', 'verify']) {
        const result = await api('/api/audio/setup', 'POST', { mode });
        assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.code, 'HEAVY_WORK_BUSY');
        assert.equal(result.body.jobId, id); assert.equal(result.body.jobType, type);
      }
      const setup = await api('/api/runtime/setup', 'POST', {}); assert.equal(setup.status, 409); assert.equal(setup.body.code, 'HEAVY_WORK_BUSY');
      assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status, status);
      db.prepare('DELETE FROM jobs WHERE id=?').run(id);
    }
    assert.equal(await readFile(f.audioTripwire, 'utf8'), 'Do not instantiate audio onboarding in this admission test.');
    assert.deepEqual(await readdir(f.runtimeDir), ['audio-onboarding', 'audio.json']);
  });
  await t.test('new original and legacy generation plus production wait for raw edits and runtime setup', async () => {
    const routes = [`/api/projects/${project.id}/original-generation`, '/api/original-generation/absent/animate', '/api/original-generation/absent/retry', '/api/generation/smoke-test', '/api/generation/shot', `/api/projects/${project.id}/production-run`];
    for (const type of ['raw-footage-edit', 'runtime-setup']) for (const status of ['queued', 'running', 'staging', 'validating', 'cancelling']) {
      addJob('other-heavy-job', type, status);
      for (const route of routes) {
        const result = await api(route, 'POST', {});
        assert.equal(result.status, 409, `${route}: ${JSON.stringify(result.body)}`); assert.equal(result.body.code, 'HEAVY_WORK_BUSY'); assert.equal(result.body.jobId, 'other-heavy-job');
      }
      assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n, 1); assert.equal(db.prepare('SELECT status FROM jobs').get().status, status);
      db.exec('DELETE FROM jobs');
    }
  });
  await t.test('read-only routes, project saves and generic cancellation remain usable under a blocker', async () => {
    addJob('active-neural', 'generation-shot'); addJob('cancel-this-render', 'render', 'queued');
    assert.equal((await api('/api/jobs')).status, 200);
    assert.equal((await api(`/api/projects/${project.id}`)).status, 200);
    assert.equal((await api(`/api/projects/${project.id}/original-generation`)).status, 200);
    const saved = await api(`/api/projects/${project.id}`, 'PATCH', { expectedRevision: 1, brief: 'This edit remains available while generation runs.' });
    assert.equal(saved.status, 200); assert.equal(saved.body.revision, 2);
    const cancelled = await api('/api/jobs/cancel-this-render/cancel', 'POST', {});
    assert.equal(cancelled.status, 200); assert.equal(cancelled.body.status, 'cancelled');
    const absent = await api('/api/original-generation/absent/cancel', 'POST', {});
    assert.equal(absent.status, 404); assert.equal(absent.body.code, 'ORIGINAL_JOB_NOT_FOUND');
    assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get('active-neural').status, 'running');
    db.exec('DELETE FROM jobs');
  });
  await t.test('a partial POST holds only admission; malformed JSON releases it and leaves edits/cancel open', async () => {
    let partial;
    const response = new Promise((yes, no) => {
      partial = request(f.base + `/api/projects/${project.id}/original-generation`, { method: 'POST', headers: { ...f.headers, 'Content-Length': '2', Expect: '100-continue' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', data => { body += data; }); res.on('end', () => { try { yes({ status: res.statusCode, body: JSON.parse(body) }); } catch (error) { no(error); } });
      });
      partial.on('error', no); partial.setTimeout(5000, () => partial.destroy(Error('Partial admission request timed out')));
    });
    try {
      const ready = once(partial, 'continue'); partial.flushHeaders(); await ready; partial.write('{');
      const blocked = await api('/api/audio/setup', 'POST', { mode: 'verify' });
      assert.equal(blocked.status, 409, JSON.stringify(blocked.body)); assert.equal(blocked.body.code, 'HEAVY_WORK_BUSY');
      assert.match(blocked.body.error, /being scheduled/); assert.equal(blocked.body.jobId, undefined);
      assert.equal((await api('/api/jobs')).status, 200);
      const saved = await api(`/api/projects/${project.id}`, 'PATCH', { expectedRevision: 2, description: 'Saved while another POST body is incomplete.' });
      assert.equal(saved.status, 200); assert.equal(saved.body.revision, 3);
      const cancel = await api('/api/original-generation/absent/cancel', 'POST', {}); assert.equal(cancel.status, 404); assert.notEqual(cancel.body.code, 'HEAVY_WORK_BUSY');
      partial.end(']'); const invalid = await response;
      assert.equal(invalid.status, 400); assert.equal(invalid.body.code, 'ORIGINAL_REQUEST');
      const released = await api('/api/audio/setup', 'POST', { mode: 'invalid' });
      assert.equal(released.status, 400); assert.equal(released.body.code, 'AUDIO_SETUP_REQUEST');
      assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n, 0);
    } finally { partial.destroy(); await response.catch(() => {}); }
  });
  assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n, 0);
  assert.equal((await readdir(join(f.dataDir, 'jobs'))).length, 0);
  assert.equal((await readdir(join(f.dataDir, 'media'))).length, 0);
  assert.equal(await readFile(f.audioTripwire, 'utf8'), 'Do not instantiate audio onboarding in this admission test.');
  assert.equal(await readFile(join(f.runtimeDir, 'audio.json'), 'utf8'), '{}');
  assert.doesNotMatch(f.logs(), /worker started|Traceback|CUDA out of memory/i);
});
