/**
 * Take a finished .mp4 all the way to a private YouTube upload through the product's
 * own routes: create a project, import the file, render it, record an operator review,
 * then upload. No step is skipped and no gate is bypassed.
 *
 *   node scripts/publish-film.mjs <file.mp4> "<title>" <notesFile> [--no-upload]
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const [file, title, notesFile] = process.argv.slice(2);
const noUpload = process.argv.includes('--no-upload');
if (!file || !title || !notesFile) throw new Error('usage: publish-film.mjs <file.mp4> "<title>" <notesFile> [--no-upload]');

const BASE = process.env.VYREALM_BASE || 'http://127.0.0.1:4173';
const CHANNEL = process.env.VYREALM_CHANNEL || 'UCdpl3uICbMmFdsUawHNkLMA';
const notes = readFileSync(notesFile, 'utf8').trim();
if (!notes) throw new Error('inspection notes are required');

const token = (await (await fetch(`${BASE}/api/session`)).json()).token;
const H = { 'X-Vyrelum-Token': token, 'Content-Type': 'application/json' };
const api = async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${JSON.stringify(body).slice(0, 400)}`);
  return body;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const poll = async (fn, label, timeoutMs = 600000) => {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(3000);
  }
};

// 1. Project
const project = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: title, brief: notes.slice(0, 400) }) });
console.log('project', project.id, 'rev', project.revision);

// 2. Import the film as footage
const bytes = readFileSync(file);
const asset = await api('/api/assets', {
  method: 'POST',
  headers: { 'Content-Type': 'video/mp4', 'X-Project-Id': project.id, 'X-Filename': encodeURIComponent(basename(file)) },
  body: bytes,
});
console.log('asset', asset.id, statSync(file).size, 'bytes');

// 3. Put it on the timeline and save
const current = await api(`/api/projects/${project.id}`);
const saved = await api(`/api/projects/${project.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    expectedRevision: current.revision,
    timeline: [{ assetId: asset.id }],
    captionsEnabled: false,
    exportCanvas: '1920x1080',
    exportFraming: 'cover',
  }),
});
console.log('saved rev', saved.revision);

// 4. Render
const before = (await api(`/api/projects/${project.id}`)).latestOutput?.jobId ?? null;
await api('/api/jobs', { method: 'POST', body: JSON.stringify({ projectId: project.id, type: 'render', expectedRevision: saved.revision }) });
const rendered = await poll(async () => {
  const p = await api(`/api/projects/${project.id}`);
  const o = p.latestOutput;
  return o?.jobId && o.jobId !== before && ['verified', 'review_required', 'succeeded'].includes(o.status) ? { p, o } : null;
}, 'render');
console.log('render', rendered.o.jobId, rendered.o.status, rendered.o.provenance?.outputHash?.slice(0, 16));

// 5. Operator review - the gate the uploader insists on
await api('/api/generation/review', {
  method: 'POST',
  body: JSON.stringify({ jobId: rendered.o.jobId, verdict: 'passed', notes, expectedOutputHash: rendered.o.provenance.outputHash }),
});
const reviewed = await api(`/api/projects/${project.id}`);
console.log('reviewed ->', reviewed.latestOutput.status);
if (reviewed.latestOutput.status !== 'reviewed') throw new Error(`expected reviewed, got ${reviewed.latestOutput.status}`);

if (noUpload) { console.log(JSON.stringify({ projectId: project.id, revision: reviewed.revision, outputHash: reviewed.latestOutput.provenance.outputHash }, null, 2)); process.exit(0); }

// 6. Upload
const job = await api('/api/youtube/upload', {
  method: 'POST',
  body: JSON.stringify({
    projectId: project.id,
    expectedRevision: reviewed.revision,
    expectedOutputHash: reviewed.latestOutput.provenance.outputHash,
    expectedChannelId: CHANNEL,
    confirmed: true,
    containsSyntheticMedia: true,
    metadata: {
      title,
      description: process.env.VYREALM_DESCRIPTION || notes.slice(0, 4000),
      selfDeclaredMadeForKids: false,
      privacyStatus: 'private',
    },
  }),
});
console.log('upload job', job.id);
const done = await poll(async () => {
  const jobs = await api('/api/jobs');
  const j = jobs.find(x => x.id === job.id);
  if (j && ['succeeded', 'failed'].includes(j.status)) return j;
  if (j) process.stdout.write(`  ${j.status} ${Math.round((j.progress || 0) * 100)}%\r`);
  return null;
}, 'upload');
if (done.status !== 'succeeded') throw new Error(`upload failed: ${done.error}`);
console.log(JSON.stringify({ videoId: done.output.videoId, watchUrl: done.output.watchUrl, privacyStatus: done.output.privacyStatus }, null, 2));
