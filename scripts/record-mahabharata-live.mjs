import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile, appendFile, rename, stat, open, unlink } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Observe the real local application. Never submit production/review commands,
// inject a replacement UI, alter captured frames, accelerate time, or record
// unrelated apps. The first keyframe predates this recording.
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return i < 0 ? [arg.slice(2), true] : [arg.slice(2, i), arg.slice(i + 1)]; }));
const root = resolve('.'), base = resolve(args['output-dir'] || 'outputs/verification/mahabharata-live');
const projectId = 'e92789c9-ef27-44fc-b29d-aa01d3eea25b', firstJobId = 'a707a1a2-66da-415d-9051-c8ff805cb915';
const origin = 'http://127.0.0.1:4173', startedAt = new Date().toISOString(), stamp = value => value.replace(/[:.]/g, '-');
const maxSeconds = Math.max(10, Math.min(10800, Number(args['max-seconds']) || 10800));
const chunkSeconds = Math.max(10, Math.min(300, Number(args['chunk-seconds']) || 300));
const snapshotSeconds = Math.max(10, Math.min(60, Number(args['snapshot-seconds']) || 15));
const runDir = join(base, `run-${stamp(startedAt)}`), controlPath = join(runDir, 'capture-command.json'), stopPath = join(runDir, 'STOP');
const journalPath = join(runDir, 'journal.jsonl'), statusPath = join(runDir, 'run-status.json'), lockPath = join(base, '.capture.lock');
const digest = value => createHash('sha256').update(value).digest('hex');
const shaFile = path => new Promise((ok, bad) => { const h = createHash('sha256'), stream = createReadStream(path); stream.on('data', b => h.update(b)); stream.on('error', bad); stream.on('end', () => ok(h.digest('hex'))); });
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const exec = promisify(execFile), views = ['Jobs', 'Create', 'Production plan', 'Create', 'Export'];
const allowedViews = new Set(['Dashboard','Create','Production plan','Storyboard','Timeline','Assets','Jobs','Export','Catalog','Settings']);
let stopped = false, writer = Promise.resolve(), previousEventHash = null, sequence = 0, browser, currentContext;
let completedSegments = [], lastSnapshot = null, lastCommand = null, currentSegment = null, lastRuntimeSnapshot = null;
let stopReason = null, currentView = 'Jobs', overrideViewUntil = 0;

await mkdir(base, { recursive: true });
if (existsSync(lockPath)) {
  let live = false;
  try { const lock = JSON.parse(await readFile(lockPath, 'utf8')); process.kill(lock.pid, 0); live = true; } catch {}
  if (live) throw new Error('CAPTURE_ALREADY_RUNNING: an existing recorder owns this output directory');
  await unlink(lockPath);
}
const lock = await open(lockPath, 'wx');
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt, runDir })); await lock.close();
await mkdir(runDir, { recursive: true });
await writeFile(join(base, 'current-run.json'), JSON.stringify({ pid: process.pid, startedAt, runDir, controlPath, stopPath }, null, 2));

function event(type, data = {}) {
  writer = writer.then(async () => {
    const entry = { sequence: ++sequence, at: new Date().toISOString(), type, ...data, previousEventHash };
    const eventHash = digest(JSON.stringify(entry));
    await appendFile(journalPath, JSON.stringify({ ...entry, eventHash }) + '\n'); previousEventHash = eventHash;
  });
  return writer;
}
async function status(state = 'recording') {
  await writeFile(statusPath, JSON.stringify({ schemaVersion: 1, state, pid: process.pid, startedAt, updatedAt: new Date().toISOString(), projectId, firstJobId, origin, viewport: { width: 1920, height: 1080 }, startedAfterFirstKeyframe: true, recordedSurface: 'real local VYREALM browser UI only', audioCapture: 'Playwright records browser pixels only; final film audio must be inspected separately', timing: 'real elapsed browser video; no retiming or replacement frames; inter-segment gaps are recorded in UTC', maxSeconds, chunkSeconds, currentSegment, completedSegments, lastSnapshot, currentView, controlPath, stopPath, stopReason }, null, 2));
}
const errorCode = error => String(error?.code || error?.name || 'OBSERVATION_FAILED').slice(0, 80);
const safeText = value => typeof value === 'string' ? value.replace(/(?:token|authorization|api[_-]?key)\s*[:=]\s*\S+/ig, '[redacted]').slice(0, 1200) : value;
const provenance = value => value ? Object.fromEntries(['generationStatus','sourceMethod','providerId','modelId','workflowHash','evidenceHash','outputHash','sourceHash','deliveryHash','seed','resolution','deliveryResolution','fps','sourceFps','targetFps','fourKMethod','vramPeakGb','renderTimeMs','semanticQuality'].filter(key => value[key] != null).map(key => [key, value[key]])) : null;

async function getJson(page, path) {
  let response = await page.request.get(`${origin}/api${path}`, { timeout: 8000 });
  if (response.status() === 401) {
    // Session credentials stay in the browser cookie jar and are never saved.
    await page.request.get(`${origin}/api/session`, { timeout: 8000 });
    response = await page.request.get(`${origin}/api${path}`, { timeout: 8000 });
  }
  if (!response.ok()) throw Object.assign(new Error('Local API unavailable'), { code: `HTTP_${response.status()}` });
  return response.json();
}
async function snapshot(page) {
  const at = new Date().toISOString();
  try {
    const [project, jobs] = await Promise.all([getJson(page, `/projects/${projectId}`), getJson(page, '/jobs')]);
    if (!lastRuntimeSnapshot || Date.now() - lastRuntimeSnapshot.time > 60000) {
      try {
        const runtime = await getJson(page, '/runtime/status');
        lastRuntimeSnapshot = { time: Date.now(), at, registered: runtime.registered, generation: { status: runtime.generation?.status, code: runtime.generation?.code, provider: runtime.generation?.provider, modelId: runtime.generation?.modelId, message: safeText(runtime.generation?.message) }, interpolation: { status: runtime.interpolation?.status, device: runtime.interpolation?.device } };
      } catch (error) { await event('runtime_snapshot_unavailable', { code: errorCode(error) }); }
    }
    const observed = { schemaVersion: 1, at, source: origin, project: { id: project.id, name: project.name, revision: project.revision, mode: project.mode, settings: project.settings, timelineClips: project.timeline?.length || 0, latestOutput: project.latestOutput ? { jobId: project.latestOutput.jobId, status: project.latestOutput.status, videoAssetId: project.latestOutput.videoAssetId, provenance: provenance(project.latestOutput.provenance) } : null }, jobs: (Array.isArray(jobs) ? jobs : []).filter(job => job.projectId === projectId || job.id === firstJobId).map(job => ({ id: job.id, projectId: job.projectId, revision: job.revision, type: job.type, status: job.status, progress: job.progress, stage: safeText(job.stage), error: safeText(job.error), attempts: job.attempts, createdAt: job.createdAt, updatedAt: job.updatedAt, outputStatus: job.output?.status, provenance: provenance(job.output?.provenance) })), runtime: lastRuntimeSnapshot };
    const file = `snapshot-${stamp(at)}.json`, text = JSON.stringify(observed, null, 2);
    await writeFile(join(runDir, file), text); lastSnapshot = { file, at, sha256: digest(text) };
    await event('api_snapshot', lastSnapshot); await status();
    return true;
  } catch (error) { await event('api_unavailable', { code: errorCode(error) }); return false; }
}
async function screenshot(page, reason) {
  const at = new Date().toISOString(), file = `screen-${stamp(at)}.png`;
  try { await page.screenshot({ path: join(runDir, file), fullPage: false, timeout: 8000 }); await event('screenshot', { file, at, reason, view: currentView, sha256: await shaFile(join(runDir, file)) }); }
  catch (error) { await event('screenshot_unavailable', { code: errorCode(error) }); }
}
async function navigate(page, view) {
  if (!allowedViews.has(view)) return;
  try {
    await page.locator(`[data-nav="${view}"]`).click({ timeout: 5000 }); currentView = view;
    if (view === 'Create') {
      const panel = page.locator('.provenance-panel').first();
      if (await panel.count()) await panel.scrollIntoViewIfNeeded({ timeout: 2500 });
    } else if (view === 'Jobs') {
      const job = page.locator('.job-row').filter({ hasText: projectId }).first();
      if (await job.count()) await job.scrollIntoViewIfNeeded({ timeout: 2500 });
    }
    await event('ui_navigation', { view });
  } catch (error) { await event('navigation_unavailable', { view, code: errorCode(error) }); }
}
async function controls(page) {
  if (existsSync(stopPath)) { stopped = true; stopReason = 'stop-file'; return; }
  if (!existsSync(controlPath)) return;
  try {
    const text = await readFile(controlPath, 'utf8'), hash = digest(text); if (hash === lastCommand) return;
    lastCommand = hash; const command = JSON.parse(text);
    if (command.action === 'stop') { stopped = true; stopReason = 'control-stop'; await event('control', { action: 'stop' }); }
    else if (command.action === 'screenshot') { await screenshot(page, 'control-request'); }
    else if (command.action === 'navigate' && allowedViews.has(command.view)) { overrideViewUntil = Date.now() + 60000; await navigate(page, command.view); }
    else await event('control_rejected', { code: 'ONLY_READ_ONLY_NAVIGATION_SCREENSHOT_OR_STOP_ALLOWED' });
  } catch (error) { await event('control_unavailable', { code: errorCode(error) }); }
}

process.on('SIGINT', () => { stopped = true; stopReason = 'SIGINT'; });
process.on('SIGTERM', () => { stopped = true; stopReason = 'SIGTERM'; });
await event('capture_started', { pid: process.pid, projectId, firstJobId, origin, startedAfterFirstKeyframe: true, viewport: { width: 1920, height: 1080 }, readOnly: true, timing: 'real time; no retiming', maxSeconds, chunkSeconds });
await status();
console.log(JSON.stringify({ state: 'starting', pid: process.pid, runDir, controlPath, stopPath }));

try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-accelerated-video-decode'] });
  const deadline = Date.now() + maxSeconds * 1000;
  let segmentNumber = 0, navigationIndex = 0;
  while (!stopped && Date.now() < deadline) {
    const segmentStart = new Date().toISOString(), index = ++segmentNumber, name = `segment-${String(index).padStart(4, '0')}-${stamp(segmentStart)}`;
    const segmentDir = join(runDir, name); await mkdir(segmentDir, { recursive: true });
    currentContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: segmentDir, size: { width: 1920, height: 1080 } }, acceptDownloads: false });
    await currentContext.addInitScript(({ projectId }) => { if (location.origin === 'http://127.0.0.1:4173') localStorage.setItem('vyrelum:selectedProject', projectId); }, { projectId });
    await currentContext.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !['GET','HEAD'].includes(request.method())) { await event('request_blocked', { method: request.method(), path: url.origin === origin ? url.pathname : 'external-origin' }); return route.abort(); }
      return route.continue();
    });
    const page = await currentContext.newPage();
    page.on('popup', popup => { void popup.close(); void event('popup_blocked'); });
    page.on('pageerror', error => { void event('ui_error', { code: errorCode(error) }); });
    const video = page.video(); currentSegment = { index, name, startedAt: segmentStart, state: 'recording' };
    await event('segment_started', currentSegment); await status();
    let lastNavigate = 0, lastSnapshotAt = 0, lastRecovery = 0, initiallyCaptured = false;
    const segmentDeadline = Math.min(deadline, Date.now() + chunkSeconds * 1000);
    try {
      while (!stopped && Date.now() < segmentDeadline) {
        await controls(page); if (stopped) break;
        const hasApp = page.url().startsWith(origin) && await page.locator('[data-nav="Jobs"]').count().catch(() => 0);
        if (!hasApp && Date.now() - lastRecovery > 10000) {
          lastRecovery = Date.now();
          try { await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 8000 }); await page.locator('[data-nav="Jobs"]').waitFor({ timeout: 8000 }); await event('app_connected'); }
          catch (error) { await event('app_unavailable', { code: errorCode(error) }); }
        }
        if (Date.now() - lastNavigate >= 30000 && Date.now() >= overrideViewUntil) { await navigate(page, views[navigationIndex++ % views.length]); lastNavigate = Date.now(); }
        if (Date.now() - lastSnapshotAt >= snapshotSeconds * 1000) {
          const available = await snapshot(page); lastSnapshotAt = Date.now();
          if (available && !initiallyCaptured) { await screenshot(page, 'segment-start-real-ui'); initiallyCaptured = true; }
          if (!available && Date.now() - lastRecovery > 10000) { lastRecovery = Date.now(); try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 }); } catch {} }
        }
        await sleep(1000);
      }
      await screenshot(page, 'segment-end-real-ui');
    } catch (error) { await event('segment_observation_error', { code: errorCode(error) }); }
    finally {
      const stoppedObservingAt = new Date().toISOString();
      await currentContext.close(); currentContext = null;
      const recordedPath = await video.path(), finalPath = join(runDir, `${name}.webm`); await rename(recordedPath, finalPath);
      let probe = null;
      try { const { stdout } = await exec(join(root, 'workers/tools/ffprobe.exe'), ['-v','error','-show_entries','format=duration:stream=codec_type,width,height,avg_frame_rate','-of','json',finalPath], { windowsHide: true, timeout: 15000, maxBuffer: 1_000_000 }); probe = JSON.parse(stdout); } catch (error) { await event('segment_probe_unavailable', { code: errorCode(error) }); }
      const segment = { index, file: basename(finalPath), startedAt: segmentStart, stoppedObservingAt, finalizedAt: new Date().toISOString(), realElapsedSeconds: (Date.parse(stoppedObservingAt) - Date.parse(segmentStart)) / 1000, bytes: (await stat(finalPath)).size, sha256: await shaFile(finalPath), probe, timing: 'unaltered real-time browser recording' };
      await writeFile(join(runDir, `${name}.json`), JSON.stringify(segment, null, 2)); completedSegments.push(segment); currentSegment = null;
      await event('segment_finalized', segment); await status();
    }
  }
  if (!stopReason) stopReason = 'duration-limit';
} catch (error) { stopReason = `recorder-error:${errorCode(error)}`; await event('capture_error', { code: errorCode(error) }); process.exitCode = 1; }
finally {
  await currentContext?.close().catch(() => {}); await browser?.close().catch(() => {});
  await event('capture_stopped', { stopReason, completedSegments: completedSegments.length }); await status('stopped'); await writer;
  await unlink(lockPath).catch(() => {});
  console.log(JSON.stringify({ state: 'stopped', runDir, stopReason, completedSegments: completedSegments.length }));
}
