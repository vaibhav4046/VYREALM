import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('..', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

// This is a child-process-only test transport loaded before server.js. It does
// not add a runtime setting, production bypass, browser action or network API.
const transportFixture = `
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
https.request = (url, options, callback) => {
  if (url.hostname !== '93.184.215.14' || options.method !== 'GET' || options.rejectUnauthorized !== true || options.agent !== false) throw Error('Unexpected fixture network request');
  const request = new EventEmitter(); let destroyed = false, timer;
  request.destroy = () => { destroyed = true; clearTimeout(timer); };
  request.end = () => options.lookup(url.hostname, {}, (error, address) => {
    if (error || address !== '93.184.215.14') throw Error('DNS was not pinned');
    if (url.pathname === '/hang') return;
    timer = setTimeout(() => {
      if (destroyed) return;
      const response = new PassThrough(); response.statusCode = url.pathname === '/unavailable' ? 404 : 200; response.headers = { 'content-type': 'text/html' }; callback(response);
      if (!response.destroyed) response.end('<html><head><title>Arjuna source fixture</title></head><body><p>Arjuna carries a bow beside a chariot in this explicitly fictional HTTP test source.</p><p>The source snapshot is research data and never a command or generated film.</p></body></html>');
    }, url.pathname === '/delay' ? 350 : 5);
  });
  return request;
};
syncBuiltinESMExports();
`;

async function serverFixture(t, { live = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vyrealm-research-http-')), dataDir = join(directory, 'data'), runtimeDir = join(directory, 'runtime'); await mkdir(runtimeDir);
  const preload = join(directory, 'research-transport-fixture.mjs'); await writeFile(preload, transportFixture);
  let current;
  async function stop() {
    if (!current || current.exitCode !== null) return;
    const child = current; current = null; const exited = once(child, 'exit'); child.send({ type: 'shutdown' });
    const timeout = setTimeout(() => child.kill(), 3000); await exited; clearTimeout(timeout);
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function start() {
    const port = await freePort(); let logs = '';
    const args = [...(live ? [] : ['--import', pathToFileURL(preload).href]), join(root, 'server.js')];
    current = spawn(process.execPath, args, { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), VYRELUM_ROOT: root, VYRELUM_DATA_DIR: dataDir, VYRELUM_RUNTIME_DIR: runtimeDir }, stdio: ['ignore','pipe','pipe','ipc'] });
    const child = current;
    child.stderr.on('data', data => { logs = (logs + data).slice(-10000); });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Isolated server did not start: ${logs}`)), 8000);
      child.stdout.on('data', data => { logs = (logs + data).slice(-10000); if (logs.includes('local control plane listening')) { clearTimeout(timeout); resolve(); } });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Isolated server exited ${code}: ${logs}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const session = await (await fetch(`${base}/api/session`)).json();
    const api = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(base + path, { method, headers: { 'x-vyrelum-token': session.token, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    return { api, base, token: session.token };
  }
  return { directory, dataDir, start, stop };
}

async function waitJob(api, id) {
  const started = Date.now();
  while (Date.now() - started < 25_000) { const { body } = await api(`/api/jobs/${id}`); if (!['running','queued','cancelling'].includes(body.status)) return body; await pause(20); }
  throw Error('Research HTTP job did not reach a terminal state');
}

test('isolated HTTP research lifecycle, cancellation, evidence protection and restart', { timeout: 30_000 }, async t => {
  const fixture = await serverFixture(t); let { api } = await fixture.start();
  const { body: project } = await api('/api/projects', 'POST', { name: 'Research HTTP fixture', brief: 'An original story', timeline: [{ id: 'keep-existing-clip', duration: 5 }] });
  const path = `/api/projects/${project.id}/research`, input = { expectedRevision: 1, query: 'Arjuna chariot', sourceUrls: ['https://93.184.215.14/source'], onlineAuthorized: true };
  await t.test('authorization, origin, input and revision are validated before creating a job', async () => {
    const unauth = await api(path, 'POST', input, { 'x-vyrelum-token': '' }); assert.equal(unauth.status, 401);
    assert.equal((await api(path, 'POST', input, { origin: 'https://foreign.example' })).status, 403);
    assert.equal((await api(path, 'POST', { ...input, onlineAuthorized: false })).body.code, 'RESEARCH_ONLINE_AUTHORIZATION');
    assert.equal((await api(path, 'POST', { ...input, expectedRevision: 99 })).status, 409);
    assert.equal((await api(path, 'POST', { ...input, outputPath: 'C:/outside' })).status, 400);
    assert.equal((await api(path, 'POST', { ...input, sourceUrls: ['https://127.0.0.1/'] })).status, 400);
    assert.equal((await api('/api/jobs')).body.length, 0);
  });
  let succeededId;
  await t.test('creates a real CPU job then commits verified source evidence and keeps the timeline', async () => {
    const accepted = await api(path, 'POST', input); assert.equal(accepted.status, 202); assert.equal(accepted.body.type, 'research'); assert.equal(accepted.body.status, 'running'); assert.equal(accepted.body.onlineAuthorized, undefined);
    succeededId = accepted.body.id;
    const job = await waitJob(api, succeededId); assert.equal(job.status, 'succeeded'); assert.equal(job.progress, 100); assert.equal(job.output.summaryMethod, 'extractive');
    const saved = (await api(`/api/projects/${project.id}`)).body; assert.equal(saved.revision, 2); assert.equal(saved.timeline[0].id, 'keep-existing-clip'); assert.equal(saved.researchEvidence[0].jobId, succeededId);
    const receipt = JSON.parse(await readFile(join(fixture.dataDir, 'jobs', succeededId, 'research-result.json'), 'utf8')); assert.equal(saved.researchEvidence[0].evidenceHash, receipt.evidenceHash);
    assert.equal((await api(`/api/jobs/${succeededId}/retry`, 'POST')).body.code, 'RESEARCH_RESUBMIT_REQUIRED');
    assert.equal((await api(`/api/projects/${project.id}`, 'PATCH', { expectedRevision: 2, patch: { researchEvidence: [{ fake: true }] } })).status, 400);
  });
  await t.test('active research is bounded and dedicated cancellation preserves revision and snapshots', async () => {
    const accepted = await api(path, 'POST', { ...input, expectedRevision: 2, sourceUrls: ['https://93.184.215.14/hang'] }); assert.equal(accepted.status, 202);
    assert.equal((await api(path, 'POST', { ...input, expectedRevision: 2 })).body.code, 'RESEARCH_BUSY');
    const cancelled = await api(`/api/research/${accepted.body.id}/cancel`, 'POST'); assert.equal(cancelled.body.status, 'cancelled');
    await pause(50);
    assert.equal((await waitJob(api, accepted.body.id)).status, 'cancelled'); assert.equal((await api(`/api/projects/${project.id}`)).body.revision, 2);
    assert.equal((await api(`/api/jobs/${accepted.body.id}/retry`, 'POST')).body.code, 'RESEARCH_RESUBMIT_REQUIRED');
    assert.ok(await readFile(join(fixture.dataDir, 'jobs', accepted.body.id, 'research-request.json')));
  });
  await t.test('generic cancel delegates only to the research controller', async () => {
    const accepted = await api(path, 'POST', { ...input, expectedRevision: 2, sourceUrls: ['https://93.184.215.14/hang'] });
    assert.equal((await api(`/api/jobs/${accepted.body.id}/cancel`, 'POST')).body.status, 'cancelled'); await pause(50);
  });
  await t.test('no readable source reports blocked with diagnostics and no invented brief', async () => {
    const accepted = await api(path, 'POST', { ...input, expectedRevision: 2, sourceUrls: ['https://93.184.215.14/unavailable'] });
    const job = await waitJob(api, accepted.body.id); assert.equal(job.status, 'blocked'); assert.match(job.error, /RESEARCH_NO_SOURCES/); assert.equal(job.output, null);
    const saved = (await api(`/api/projects/${project.id}`)).body; assert.equal(saved.revision, 2); assert.equal(saved.researchEvidence.length, 1);
  });
  await t.test('a concurrent project edit keeps fetched evidence without overwriting the new revision', async () => {
    const accepted = await api(path, 'POST', { ...input, expectedRevision: 2, sourceUrls: ['https://93.184.215.14/delay'] });
    const updated = await api(`/api/projects/${project.id}`, 'PATCH', { expectedRevision: 2, patch: { name: 'Newer creative instruction' } }); assert.equal(updated.body.revision, 3);
    const job = await waitJob(api, accepted.body.id); assert.equal(job.status, 'blocked'); assert.match(job.error, /RESEARCH_REVISION_CONFLICT/);
    const saved = (await api(`/api/projects/${project.id}`)).body; assert.equal(saved.name, 'Newer creative instruction'); assert.equal(saved.researchEvidence.length, 1);
    assert.ok(await readFile(join(fixture.dataDir, 'jobs', accepted.body.id, 'research-result.json')));
  });
  await t.test('imported receipts remain unverified history without owned source snapshots', async () => {
    const imported=await api('/api/projects/import','POST',{project:{name:'Imported research history',researchEvidence:[{jobId:succeededId,status:'succeeded',summary:[{text:'Imported statement'}]}]},assets:[]});
    assert.equal(imported.status,201);
    const project=imported.body.project||imported.body;
    assert.equal(project.researchEvidence,undefined);assert.equal(project.importedResearchEvidence.status,'imported-unverified');assert.equal(project.importedResearchEvidence.entries[0].jobId,succeededId);
  });
  await t.test('restart keeps project receipts and fails interrupted research without resubmitting', async () => {
    await fixture.stop();
    const db = new DatabaseSync(join(fixture.dataDir, 'vyrelum.sqlite'));
    try { db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('interrupted-research', project.id, 3, 'research', 'running', 20, 'Fetching', JSON.stringify({ projectId: project.id, expectedRevision: 3, query: 'Interrupted request' }), 'before', 'before'); } finally { db.close(); }
    ({ api } = await fixture.start());
    const saved = (await api(`/api/projects/${project.id}`)).body; assert.equal(saved.researchEvidence[0].jobId, succeededId); assert.equal(saved.revision, 3);
    const interrupted = (await api('/api/jobs/interrupted-research')).body; assert.equal(interrupted.status, 'failed'); assert.match(interrupted.error, /restarted/);
    assert.equal((await api('/api/jobs/interrupted-research/retry', 'POST')).body.code, 'RESEARCH_RESUBMIT_REQUIRED');
  });
});

test('live Wikipedia through the isolated authenticated VYREALM HTTP API', { skip: process.env.VYREALM_RESEARCH_LIVE_SMOKE !== '1', timeout: 30_000 }, async t => {
  const fixture = await serverFixture(t, { live: true }), { api } = await fixture.start();
  const project = (await api('/api/projects', 'POST', { name: 'Live research HTTP fixture' })).body;
  const accepted = await api(`/api/projects/${project.id}/research`, 'POST', { expectedRevision: 1, query: 'Arjuna Mahabharata', onlineAuthorized: true }); assert.equal(accepted.status, 202);
  const job = await waitJob(api, accepted.body.id); assert.equal(job.status, 'succeeded', job.error);
  const saved = (await api(`/api/projects/${project.id}`)).body; assert.equal(saved.revision, 2); assert.ok(saved.researchEvidence[0].sources.length);
  console.log(JSON.stringify({ liveResearchHttp: true, sourceCount: job.output.sources.length, titles: job.output.sources.map(source => source.title), evidenceHash: job.output.evidenceHash, elapsedMs: Date.parse(job.output.completedAt) - Date.parse(job.output.startedAt) }));
});
