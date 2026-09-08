import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { initializeFlagshipCatalogue, selectFlagship, listFlagships, removeFlagship } from './flagship-catalogue.mjs';

const exec = promisify(execFile);
const ffmpeg = resolve('workers/tools/ffmpeg.exe'), ffprobe = resolve('workers/tools/ffprobe.exe');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Test-owned Windows processes only. A held kernel handle plus creation time
// and executable checks prevents a recycled PID from becoming a kill target.
async function windowsOwnedProcess(child, mode, expected) {
  const { stdout } = await exec(join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', String.raw`
    $ErrorActionPreference = 'Stop'
    $targetPid = [int]$env:VYREALM_TEST_PROCESS_PID
    try { $target = [System.Diagnostics.Process]::GetProcessById($targetPid) }
    catch [System.ArgumentException] { @{pid=$targetPid;state='absent'} | ConvertTo-Json -Compress; exit 0 }
    try {
      [void]$target.Handle
      if ($target.HasExited) { @{pid=$targetPid;state='exited'} | ConvertTo-Json -Compress; exit 0 }
      $identity = @{pid=$targetPid;state='running';startedTicks=$target.StartTime.ToUniversalTime().Ticks.ToString();executable=$target.MainModule.FileName}
      if ($env:VYREALM_TEST_PROCESS_MODE -ne 'terminate') { $identity | ConvertTo-Json -Compress; exit 0 }
      $expected = ConvertFrom-Json $env:VYREALM_TEST_PROCESS_IDENTITY
      if ($identity.startedTicks -ne $expected.startedTicks -or $identity.executable -ine $expected.executable -or $identity.pid -ne $expected.pid) { throw 'OWNED_PROCESS_IDENTITY_CHANGED' }
      $info = New-Object System.Diagnostics.ProcessStartInfo
      $info.FileName = Join-Path $env:SystemRoot 'System32/taskkill.exe'
      $info.Arguments = '/PID ' + $targetPid + ' /T /F'
      $info.UseShellExecute = $false
      $info.CreateNoWindow = $true
      $info.RedirectStandardOutput = $true
      $info.RedirectStandardError = $true
      $killer = [System.Diagnostics.Process]::Start($info)
      try {
        if (-not $killer.WaitForExit(5000)) { $killer.Kill(); throw 'NATIVE_TASKKILL_TIMEOUT' }
        $nativeOutput = $killer.StandardOutput.ReadToEnd()
        $nativeError = $killer.StandardError.ReadToEnd()
        [void]$target.WaitForExit(5000)
        $osExitVerified = $false
        $fresh = $null
        try { $fresh = [System.Diagnostics.Process]::GetProcessById($targetPid); $fresh.Refresh(); $osExitVerified = $fresh.HasExited }
        catch [System.ArgumentException] { $osExitVerified = $true }
        finally { if ($fresh) { $fresh.Dispose() } }
        if (-not $osExitVerified) { throw ('OWNED_PROCESS_REMAINS_RUNNING: pid=' + $targetPid + ' nativeExitCode=' + $killer.ExitCode + ' ' + $nativeOutput + $nativeError) }
        $reportedPids = @([regex]::Matches(($nativeOutput + [Environment]::NewLine + $nativeError),'(?im)^\s*(?:SUCCESS|ERROR):.*?\bPID\s+([0-9]+)') | ForEach-Object { [int]$_.Groups[1].Value } | Sort-Object -Unique)
        # taskkill can return nonzero when one renderer exits before it is
        # reached. Accept that race only after querying every reported PID.
        if ($killer.ExitCode -ne 0 -and ($reportedPids.Count -eq 0 -or $reportedPids -notcontains $targetPid)) { throw ('NATIVE_TASKKILL_FAILED: ' + $nativeOutput + $nativeError) }
        foreach ($reportedPid in $reportedPids) {
          $remaining = $null
          try { $remaining = [System.Diagnostics.Process]::GetProcessById($reportedPid) }
          catch [System.ArgumentException] { continue }
          try { if (-not $remaining.HasExited) { throw ('OWNED_PROCESS_REMAINS_RUNNING: ' + $reportedPid) } }
          finally { $remaining.Dispose() }
        }
        @{pid=$targetPid;state='terminated';osExitVerified=$osExitVerified;treeTerminationConfirmed=$true;reportedPids=$reportedPids;nativeExitCode=$killer.ExitCode;nativeOutput=$nativeOutput.Trim();nativeError=$nativeError.Trim()} | ConvertTo-Json -Compress
      } finally { $killer.Dispose() }
    } finally { $target.Dispose() }
  `], { windowsHide: true, timeout: 15_000, maxBuffer: 100_000, env: { ...process.env, VYREALM_TEST_PROCESS_PID: String(child.pid), VYREALM_TEST_PROCESS_MODE: mode, VYREALM_TEST_PROCESS_IDENTITY: JSON.stringify(expected || {}) } });
  const state = JSON.parse(stdout);
  if (mode === 'inspect' && (state.state !== 'running' || resolve(state.executable).toLowerCase() !== resolve(child.spawnfile).toLowerCase())) throw new Error('OWNED_PROCESS_IDENTITY_UNAVAILABLE');
  return state;
}

function releaseExitedProcessPipes(child) {
  // Chromium's CDP transport uses additional pipe descriptors beyond stdout
  // and stderr. Release them only after native OS exit has been verified.
  for (const stream of child.stdio || []) stream?.destroy?.();
  child.unref();
}

async function assertBrowserListenerClosed(endpoint) {
  const address = new URL(endpoint);
  await new Promise((resolveClosed, reject) => {
    const socket = createConnection({ host: address.hostname, port: Number(address.port) });
    const finish = error => { socket.destroy(); error ? reject(error) : resolveClosed(); };
    socket.setTimeout(2_000, () => finish(new Error('BROWSER_LISTENER_STATE_UNAVAILABLE')));
    socket.once('connect', () => finish(new Error('BROWSER_LISTENER_REMAINS_OPEN')));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? null : error));
  });
}

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

test('native Windows cleanup verifies ownership and terminates only its test process tree', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  const owned = spawn(process.execPath, ['-e', "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});console.log(JSON.stringify({pid:process.pid,childPid:child.pid}));setInterval(()=>{},1000)"], { windowsHide:true,stdio:['ignore','pipe','pipe'] });
  let identity;
  try {
    const [chunk] = await once(owned.stdout,'data'), ids=JSON.parse(String(chunk));
    identity=await windowsOwnedProcess(owned,'inspect');
    await assert.rejects(windowsOwnedProcess(owned,'terminate',{...identity,startedTicks:identity.startedTicks+'1'}),/OWNED_PROCESS_IDENTITY_CHANGED/);
    assert.equal((await windowsOwnedProcess(owned,'status')).state,'running');
    const terminated=await windowsOwnedProcess(owned,'terminate',identity);
    assert.equal(terminated.osExitVerified,true); assert.equal(terminated.treeTerminationConfirmed,true);
    assert.equal((await windowsOwnedProcess({pid:ids.childPid},'status')).state,'absent');
    releaseExitedProcessPipes(owned);
  } finally {
    const state=await windowsOwnedProcess(owned,'status');
    if(state.state==='running') await windowsOwnedProcess(owned,'terminate',identity||state);
    releaseExitedProcessPipes(owned);
  }
});

test('catalogue UI selects, plays, downloads and withdraws a verified film through the real API', { timeout: 90_000 }, async t => {
  const started = Date.now(); let stage = 'fixture';
  const mark = name => { stage = name; t.diagnostic(`${name} at ${Date.now() - started}ms`); };
  const f = await fixture(t), socket = createServer();
  mark('test server startup');
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: resolve('.'), env: { ...process.env, PORT: String(port), VYRELUM_ROOT: resolve('.'), VYRELUM_DATA_DIR: f.dir, VYRELUM_RUNTIME_DIR: join(f.dir, 'runtime'), VYRELUM_FFMPEG: ffmpeg, VYRELUM_FFPROBE: ffprobe }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  const exited = once(child, 'exit'); let browser, browserServer, browserIdentity, page, context, primaryError, logs = '';
  const bounded = (promise, ms, name) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(name)), ms); })]).finally(() => clearTimeout(timer));
  };
  child.stdout.on('data', chunk => logs += chunk); child.stderr.on('data', chunk => logs += chunk);
  const abort = () => { void browserServer?.kill().catch(() => {}); child.kill(); };
  t.signal.addEventListener('abort', abort, { once: true });
  // Keep the real journey's existing 60s budget. The outer test additionally
  // reserves bounded Windows process cleanup time instead of abandoning owned
  // renderers when the journey has already passed.
  let journeyExpired = false;
  const journeyTimer = setTimeout(() => { journeyExpired = true; abort(); }, Math.max(1, 60_000 - (Date.now() - started)));
  try {
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Test server did not start: ${logs}`)), 10_000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('control plane listening')) { clearTimeout(timeout); resolveReady(); } });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited ${code}: ${logs}`)); });
    });
    mark('browser launch');
    // This media/API journey must not compete with local neural inference for
    // the laptop GPU. Owning the browser server also makes cleanup bounded if
    // Chromium stalls after video playback on a loaded machine.
    browserServer = await chromium.launchServer({ headless: true, timeout: 15_000, args: ['--disable-gpu', '--disable-accelerated-video-decode'] });
    if(process.platform==='win32') browserIdentity=await windowsOwnedProcess(browserServer.process(),'inspect');
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 15_000 });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    mark('load catalogue');
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole('button', { name: /Catalog/ }).click();
    mark('select flagship');
    await page.getByRole('button', { name: /Gate fixture/ }).click();
    await page.getByRole('button', { name: /Catalog/ }).click();
    await page.getByRole('button', { name: 'Add reviewed film to flagship' }).click();
    await page.getByRole('button', { name: 'Remove from flagship' }).waitFor();
    mark('play video');
    const video = page.getByLabel('Gate fixture', { exact: true });
    await video.evaluate(async element => { await element.play(); });
    assert.equal(await video.evaluate(element => element.videoWidth), 160);
    mark('download video');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download film' }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'Gate-fixture.mp4');
    assert.equal(await bounded(download.failure(), 15_000, 'Video download did not complete'), null);
    const downloadedPath = join(f.dir, 'downloaded-film.mp4');
    await bounded(download.saveAs(downloadedPath), 15_000, 'Video download could not be saved');
    assert.equal(hash(await readFile(downloadedPath)), f.receipt.provenance.outputHash);
    mark('reopen selection');
    await page.reload();
    await page.getByRole('button', { name: /Catalog/ }).click();
    await page.getByRole('button', { name: 'Remove from flagship' }).waitFor();
    mark('withdraw flagship');
    await page.getByRole('button', { name: 'Remove from flagship' }).click();
    await page.getByText('No film has passed the flagship selection gate yet.').waitFor();
    assert.deepEqual(errors, []);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM flagship_catalogue').get().n, 1);
    assert.equal(f.db.prepare('SELECT active FROM flagship_catalogue').get().active, 0);
    assert.equal(journeyExpired, false, 'Catalogue journey exceeded its 60s budget');
    mark('journey assertions passed');
  } catch (error) {
    primaryError = error;
    error.message = `Catalogue journey failed during ${stage}: ${error.message}\nTest server: ${logs.slice(-4000)}`;
    throw error;
  } finally {
    clearTimeout(journeyTimer);
    mark('test cleanup');
    const cleanupErrors = [];
    const ownedProcess = browserServer?.process();
    try {
      // Close the media page before its context. Direct browser.close() left
      // Chromium waiting indefinitely after playback on this Windows laptop.
      if (page) try { await bounded(page.close(), 5_000, 'Test page cleanup failed'); } catch (error) { cleanupErrors.push(error); }
      if (context) try { await bounded(context.close(), 5_000, 'Test context cleanup failed'); } catch (error) { cleanupErrors.push(error); }
      if (browser) try { await bounded(browser.close(), 5_000, 'Browser client disconnect failed'); } catch (error) { cleanupErrors.push(error); }
      if (browserServer) {
        try {
          let native;
          if(process.platform==='win32') {
            native=await windowsOwnedProcess(ownedProcess,'terminate',browserIdentity);
            if(!['absent','exited','terminated'].includes(native.state)) throw new Error('OWNED_BROWSER_OS_STATE_INVALID');
            t.diagnostic(`Native browser cleanup: ${JSON.stringify(native)}`);
            releaseExitedProcessPipes(ownedProcess);
            // This is Playwright's test-only hook for closing the specific
            // owned WebSocket server. Normally its process-close callback
            // does this, but Windows can delay that callback after OS exit.
            await bounded(browserServer._disconnectForTest(),5_000,'Owned browser listener disconnect failed');
            await assertBrowserListenerClosed(browserServer.wsEndpoint());
          }
          try { await bounded(browserServer.close(),5_000,'Browser server cleanup failed'); }
          catch (error) {
            // Playwright's close promise also waits for temporary directory
            // removal. A delayed filesystem cleanup is distinct from a live
            // browser: require native process-tree termination and a closed
            // listener before accepting that already-exited server.
            if (!native?.osExitVerified || !native.treeTerminationConfirmed) throw error;
            await assertBrowserListenerClosed(browserServer.wsEndpoint());
            t.diagnostic('Owned browser tree exited and WebSocket listener closed; Playwright temporary-directory cleanup is delayed.');
          }
        } catch(error) {
          cleanupErrors.push(error);
          // Even a failed tree audit must not leave dead CDP pipes holding the
          // test runner open. This OS query is read-only and scoped to its PID.
          if(process.platform==='win32') {
            try { const state=await windowsOwnedProcess(ownedProcess,'status'); if(['absent','exited'].includes(state.state)) releaseExitedProcessPipes(ownedProcess); } catch { /* Retain the original cleanup failure. */ }
          }
        }
      }
    } finally {
      // A page/context error must never leak the independently owned server.
      child.kill();
      await bounded(exited, 5_000, 'Test server cleanup failed');
      t.signal.removeEventListener('abort', abort);
    }
    if (cleanupErrors.length && !primaryError) throw new AggregateError(cleanupErrors, 'Catalogue test browser cleanup failed');
    for (const error of cleanupErrors) t.diagnostic(error.message);
  }
});
