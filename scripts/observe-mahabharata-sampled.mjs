import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile, appendFile, open, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// Explicit fallback for unreliable Windows continuous-video finalization.
// Each PNG is an actual app screenshot. This is NOT a continuous recording,
// and no video is synthesized from these samples or gaps concealed.
const origin='http://127.0.0.1:4173', projectId='e92789c9-ef27-44fc-b29d-aa01d3eea25b';
const startedAt=new Date().toISOString(), stamp=s=>s.replace(/[:.]/g,'-');
const base=resolve('outputs/verification/mahabharata-observation'), runDir=join(base,`run-${stamp(startedAt)}`);
const viewport={width:1280,height:720}, maxSeconds=14400, sampleIntervalSeconds=15, windowSeconds=300;
const stopPath=join(runDir,'STOP'), controlPath=join(runDir,'capture-command.json'), lockPath=join(base,'.observer.lock');
const allowedViews=new Set(['Dashboard','Create','Production plan','Storyboard','Timeline','Assets','Jobs','Export','Catalog','Settings']);
const hash=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
async function bounded(promise,ms,code) { let timer; try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(code),{code})),ms);})]); } finally {clearTimeout(timer);} }
const errorCode=error=>String(error?.code||error?.name||'ERROR').slice(0,80);
let writer=Promise.resolve(), previousEventHash=null, sequence=0, stopped=false, stopReason=null, browserServer, browser, context, page;
let view='Jobs', sampleCount=0, windowIndex=1, windowStartedAt=startedAt, samples=[], lastSample=null, lastCommand=null;
await mkdir(base,{recursive:true});
if (existsSync(lockPath)) { let active=false; try {const old=JSON.parse(await readFile(lockPath,'utf8'));process.kill(old.pid,0);active=true;} catch {} if(active)throw new Error('OBSERVER_ALREADY_RUNNING');await unlink(lockPath); }
const lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,startedAt,runDir}));await lock.close();
await mkdir(runDir,{recursive:true});
await writeFile(join(base,'current-run.json'),JSON.stringify({pid:process.pid,startedAt,runDir,mode:'time-sampled-app-observation',stopPath,controlPath},null,2));
function event(type,data={}) { writer=writer.then(async()=>{const entry={sequence:++sequence,at:new Date().toISOString(),type,...data,previousEventHash};const eventHash=hash(JSON.stringify(entry));await appendFile(join(runDir,'journal.jsonl'),JSON.stringify({...entry,eventHash})+'\n');previousEventHash=eventHash;});return writer; }
async function status(state='observing') { await writeFile(join(runDir,'run-status.json'),JSON.stringify({schemaVersion:1,pid:process.pid,state,updatedAt:new Date().toISOString(),startedAt,origin,projectId,viewport,mode:'time-sampled-app-observation',continuousRecording:false,audioCaptured:false,startedAfterGenerationSubmission:true,sampleIntervalSeconds,windowSeconds,maxSeconds,sampleCount,lastSample,currentWindow:windowIndex,currentView:view,stopReason,controlPath,stopPath},null,2)); }
async function finalizeWindow() {
  if(!samples.length)return;
  const endedAt=new Date().toISOString(), times=samples.map(s=>Date.parse(s.capturedAt)), gaps=times.slice(1).map((t,i)=>(t-times[i])/1000);
  const file=`sample-window-${String(windowIndex).padStart(4,'0')}.json`;
  const evidence={schemaVersion:1,mode:'time-sampled-app-observation',continuousRecording:false,windowIndex,windowStartedAt,endedAt,nominalIntervalSeconds:sampleIntervalSeconds,actualSampleCount:samples.length,firstCapturedAt:samples[0].capturedAt,lastCapturedAt:samples.at(-1).capturedAt,longestIntervalSeconds:gaps.length?Math.max(...gaps):null,samples,limitations:'Only the listed instants were captured. No frames or activity between them are asserted.'};
  const text=JSON.stringify(evidence,null,2);await writeFile(join(runDir,file),text,{flag:'wx'});await event('sample_window_finalized',{file,sha256:hash(text),actualSampleCount:samples.length,longestIntervalSeconds:evidence.longestIntervalSeconds});
  samples=[];windowIndex++;windowStartedAt=endedAt;
}
async function takeSample(reason='scheduled') {
  const requestedAt=new Date().toISOString();
  if(!page.url().startsWith(`${origin}/`)) {await event('sample_unavailable',{reason:'PAGE_OUTSIDE_LOCAL_APP'});return false;}
  try {
    const file=`sample-${String(++sampleCount).padStart(5,'0')}-${stamp(requestedAt)}.png`;
    const png=await page.screenshot({path:join(runDir,file),fullPage:false,timeout:15000});
    const capturedAt=new Date().toISOString();
    lastSample={file,requestedAt,capturedAt,captureOperationSeconds:(Date.parse(capturedAt)-Date.parse(requestedAt))/1000,sha256:hash(png),view,reason};samples.push(lastSample);await event('app_screenshot',lastSample);await status();return true;
  } catch(error) {await event('sample_unavailable',{code:errorCode(error)});return false;}
}
async function navigate(next) { if(!allowedViews.has(next))return;try {await page.locator(`[data-nav="${next}"]`).click({timeout:8000});view=next;await event('ui_navigation',{view});} catch(error){await event('navigation_unavailable',{view:next,code:errorCode(error)});} }
async function controls() {
  if(existsSync(stopPath)){stopped=true;stopReason='stop-file';return;}
  if(!existsSync(controlPath))return;
  try {const content=await readFile(controlPath,'utf8'),digest=hash(content);if(digest===lastCommand)return;lastCommand=digest;const command=JSON.parse(content);
    if(command.action==='stop'){stopped=true;stopReason='control-stop';}
    else if(command.action==='navigate'&&allowedViews.has(command.view))await navigate(command.view);
    else if(command.action==='screenshot')await takeSample('control-request');
    else await event('control_rejected',{reason:'ONLY_READ_ONLY_NAVIGATION_SCREENSHOT_OR_STOP_ALLOWED'});
  } catch(error){await event('control_error',{code:errorCode(error)});}
}
async function recordJobState() {
  try {const response=await page.request.get(`${origin}/api/jobs`,{timeout:8000});if(!response.ok())throw Object.assign(new Error('Job state unavailable'),{code:`HTTP_${response.status()}`});const jobs=await response.json();
    const selected=(Array.isArray(jobs)?jobs:[]).filter(j=>j.projectId===projectId).map(j=>({id:j.id,projectId:j.projectId,status:j.status,progress:j.progress,stage:j.stage,updatedAt:j.updatedAt}));
    await event('engine_job_snapshot',{jobs:selected});
  }catch(error){await event('engine_snapshot_unavailable',{code:errorCode(error)});}
}
process.on('SIGINT',()=>{stopped=true;stopReason='SIGINT';});process.on('SIGTERM',()=>{stopped=true;stopReason='SIGTERM';});
await event('observation_started',{pid:process.pid,origin,projectId,viewport,mode:'time-sampled-app-observation',continuousRecording:false,audioCaptured:false,startedAfterGenerationSubmission:true,sampleIntervalSeconds,windowSeconds,maxSeconds});await status('starting');
console.log(JSON.stringify({pid:process.pid,runDir,mode:'time-sampled-app-observation',controlPath,stopPath}));
try {
  browserServer=await chromium.launchServer({headless:true,timeout:30000,args:['--disable-gpu','--disable-accelerated-video-decode']});await event('owned_browser_started',{pid:browserServer.process().pid});
  browser=await chromium.connect(browserServer.wsEndpoint(),{timeout:30000});context=await browser.newContext({viewport,acceptDownloads:false});
  await context.addInitScript(({projectId,origin})=>{if(location.origin===origin)localStorage.setItem('vyrelum:selectedProject',projectId);},{projectId,origin});
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){await event('request_blocked',{method:request.method(),path:url.origin===origin?url.pathname:'external-origin'});return route.abort();}return route.continue();});
  page=await context.newPage();page.on('popup',popup=>{void popup.close();});page.on('crash',()=>{stopped=true;stopReason='page-crash';});browser.on('disconnected',()=>{if(!stopped){stopped=true;stopReason='browser-disconnected';}});
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});await page.locator('[data-nav="Jobs"]').waitFor({timeout:20000});await navigate('Jobs');await takeSample('first-real-app-observation');
  const deadline=Date.now()+maxSeconds*1000;let nextSampleAt=Date.now()+sampleIntervalSeconds*1000,nextJobAt=Date.now(),failures=0;
  while(!stopped&&Date.now()<deadline){await controls();if(stopped)break;
    if(Date.now()>=nextSampleAt){const ok=await takeSample();failures=ok?0:failures+1;nextSampleAt=Date.now()+sampleIntervalSeconds*1000;if(failures>=3){stopReason='three-consecutive-sample-failures';break;}}
    if(Date.now()>=nextJobAt){await recordJobState();nextJobAt=Date.now()+30000;}
    if(Date.now()-Date.parse(windowStartedAt)>=windowSeconds*1000)await finalizeWindow();
    await sleep(1000);
  }
  stopReason||='duration-limit';
}catch(error){stopReason=`observer-error:${errorCode(error)}`;await event('observation_error',{code:errorCode(error)});process.exitCode=1;}
finally {
  stopped=true;await finalizeWindow();await event('observation_stopped',{stopReason,sampleCount});await status('stopped');
  await bounded(page?.close().catch(()=>{}),15000,'PAGE_CLOSE_TIMEOUT').catch(()=>{});await bounded(context?.close().catch(()=>{}),15000,'CONTEXT_CLOSE_TIMEOUT').catch(()=>{});
  await bounded(browser?.close().catch(()=>{}),5000,'BROWSER_CLOSE_TIMEOUT').catch(()=>{});
  if(browserServer){const processHandle=browserServer.process();if(processHandle.exitCode===null&&processHandle.signalCode===null){void browserServer.kill().catch(()=>{});await bounded(new Promise(ok=>processHandle.once('exit',ok)),15000,'OWNED_BROWSER_EXIT_TIMEOUT').catch(async error=>{await event('cleanup_incomplete',{code:errorCode(error),ownedPid:processHandle.pid});});}}
  await writer;await unlink(lockPath).catch(()=>{});
  console.log(JSON.stringify({state:'stopped',runDir,stopReason,sampleCount}));
}
