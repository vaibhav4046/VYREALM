import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
const exec = promisify(execFile);
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

const out=resolve('outputs/verification/live-retained-ui');
await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),jobId:'a707a1a2-66da-415d-9051-c8ff805cb915',pageErrors:[],consoleErrors:[],failedRequests:[],views:[]};
const bounded=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms)})]).finally(()=>clearTimeout(timer));};
let server,identity,browser,context,page;
try {
  server=await chromium.launchServer({headless:true,timeout:20_000,args:['--disable-gpu','--disable-accelerated-video-decode']});
  identity=await windowsOwnedProcess(server.process(),'inspect');
  browser=await chromium.connect(server.wsEndpoint(),{timeout:20_000});
  context=await browser.newContext({viewport:{width:1280,height:900}});
  page=await context.newPage();page.setDefaultTimeout(15_000);
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('requestfailed',request=>report.failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  // Guard this verification journey against accidental project/job mutations.
  await context.route('**/api/**',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort('blockedbyclient'));
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:30_000});
  for(const width of [1280,424]) {
    await page.setViewportSize({width,height:900});
    if(width<760)await page.locator('#menuBtn').click();
    await page.locator('nav [data-nav="Dashboard"]').click();
    await page.getByRole('heading',{name:'From first idea to final cut.'}).waitFor();
    await page.screenshot({path:join(out,`${width}-dashboard.png`)});
    if(width<760)await page.locator('#menuBtn').click();
    await page.locator('nav [data-nav="Jobs"]').click();
    await page.getByRole('heading',{name:'Nothing gets lost.'}).waitFor();
    assert.equal(await page.locator('.crumb strong').textContent(),'Jobs');
    await page.screenshot({path:join(out,`${width}-jobs.png`)});
    await page.locator(`[data-retained-shot="${report.jobId}"]`).click();
    const video=page.locator('#retainedShotVideo');await video.waitFor();
    await video.evaluate(async element=>{element.muted=true;await element.play();});
    await page.waitForFunction(()=>document.querySelector('#retainedShotVideo')?.currentTime>=2,{timeout:15_000});
    await page.screenshot({path:join(out,`${width}-playing.png`)});
    await page.waitForFunction(()=>document.querySelector('#retainedShotVideo')?.ended,{timeout:15_000});
    const playback=await video.evaluate(element=>({duration:element.duration,currentTime:element.currentTime,ended:element.ended,videoWidth:element.videoWidth,videoHeight:element.videoHeight,currentSrc:element.currentSrc,error:element.error?.message||null,quality:element.getVideoPlaybackQuality?.().toJSON?.()||{totalVideoFrames:element.getVideoPlaybackQuality?.().totalVideoFrames,droppedVideoFrames:element.getVideoPlaybackQuality?.().droppedVideoFrames}}));
    assert.equal(playback.ended,true);assert(Math.abs(playback.duration-5)<0.1);assert(Math.abs(playback.currentTime-playback.duration)<0.1);assert.equal(playback.error,null);
    const view={width,playback,bodyWidth:await page.evaluate(()=>document.body.scrollWidth),viewport:width};report.views.push(view);
    console.log(JSON.stringify(view));
    await page.screenshot({path:join(out,`${width}-ended.png`)});
    await page.locator('#closeRetainedShot').click();
  }
  assert.deepEqual(report.pageErrors,[]);report.journeyPassed=true;
} catch(error) {
  report.error=error.stack;process.exitCode=1;
  if(page)await bounded(page.screenshot({path:join(out,'failure.png')}),5_000,'Failure screenshot timeout').catch(()=>{});
} finally {
  for(const [resource,label] of [[page,'page'],[context,'context'],[browser,'browser']])if(resource)await bounded(resource.close(),3_000,`${label} close timeout`).catch(error=>{(report.cleanupNotes||=[]).push(error.message);});
  if(server){
    try {report.nativeCleanup=await windowsOwnedProcess(server.process(),'terminate',identity);releaseExitedProcessPipes(server.process());await bounded(server.close(),3_000,'server temp cleanup delayed').catch(async error=>{await assertBrowserListenerClosed(server.wsEndpoint());(report.cleanupNotes||=[]).push(error.message);});}
    catch(error){report.cleanupError=error.stack;process.exitCode=1;}
  }
  report.finishedAt=new Date().toISOString();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}


