import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

assert.ok(process.argv[2], 'Usage: node scripts/verify-clean-source.mjs <staged-source-directory>');
const source=resolve(process.argv[2]), repo=fileURLToPath(new URL('..',import.meta.url));
const proof=join(repo,'work',`clean-boot-${Date.now()}`), home=join(proof,'home'); await mkdir(home,{recursive:true});
for(const name of ['data','node_modules','workers/tools','runtime/assets','.env']) await assert.rejects(access(join(source,name)),{code:'ENOENT'});
const manifest=JSON.parse(await readFile(join(source,'source-manifest.json'),'utf8'));
assert.ok(manifest.files.length>0);
const socket=createServer(); await new Promise(done=>socket.listen(0,'127.0.0.1',done)); const port=socket.address().port; await new Promise(done=>socket.close(done));
const base=`http://127.0.0.1:${port}`;
const env={SystemRoot:process.env.SystemRoot||'',PATH:join(process.env.SystemRoot||'C:/Windows','System32'),TEMP:home,TMP:home,HOME:home,USERPROFILE:home,APPDATA:join(home,'AppData/Roaming'),LOCALAPPDATA:join(home,'AppData/Local'),PORT:String(port),VYRELUM_ROOT:source,VYRELUM_DATA_DIR:join(proof,'data'),VYRELUM_RUNTIME_DIR:join(proof,'runtime'),OLLAMA_HOST:'http://127.0.0.1:1',VYRELUM_OLLAMA_URL:'http://127.0.0.1:1'};
const server=spawn(process.execPath,['server.js'],{cwd:source,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
const exited=once(server,'exit'); let logs='',browser;
server.stdout.on('data',data=>logs+=data);server.stderr.on('data',data=>logs+=data);
try {
  let ready=false;
  for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error(`Clean server exited: ${logs}`);try{if((await fetch(`${base}/api/session`)).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,100));}
  assert.ok(ready,`Clean server did not start: ${logs}`);
  const browserFiles=manifest.files.filter(file=>!file.file.includes('/') && /\.(js|css|html)$/.test(file.file) && !['server.js','engine.js'].includes(file.file));
  for(const file of browserFiles)assert.equal((await fetch(`${base}/${file.file}`)).status,200,file.file);
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-accelerated-video-decode']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],outside=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==base){outside.push(url.origin);return route.abort();}return route.continue();});
  await page.goto(base);await page.locator('#refreshBtn:not(:disabled)').waitFor();
  const session=await(await fetch(`${base}/api/session`)).json(),headers={'X-Vyrelum-Token':session.token};
  const initial=await(await fetch(`${base}/api/state`,{headers})).json();assert.deepEqual(initial.projects,[]);assert.deepEqual(initial.assets,[]);assert.deepEqual(initial.jobs,[]);
  await page.locator('.sidebar [data-nav=Dashboard]').click();await page.locator('#newProject').click();
  await page.locator('#projectName').fill('Clean source verification');await page.locator('#projectBrief').fill('A new empty project created without models or imported user data.');await page.locator('#createProjectBtn').click();await page.locator('#produceBtn').waitFor();
  const id=await page.evaluate(()=>localStorage.getItem('vyrelum:selectedProject'));
  assert.ok(id);await page.reload();await page.locator('#refreshBtn:not(:disabled)').waitFor();
  const project=await(await fetch(`${base}/api/projects/${id}`,{headers})).json();assert.equal(project.name,'Clean source verification');assert.equal(project.timeline.length,0);
  assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
  const evidence={createdAt:new Date().toISOString(),node:process.version,platform:process.platform,sourceFileCount:manifest.files.length,sourceDirectory:source,noUserDataOrCredentialsCopied:true,noModelsOrToolsCopied:true,noNpmDependenciesInAppSnapshot:true,verificationHarness:'Existing Playwright installation outside snapshot; application started using Node built-ins',httpModules:'all 200',initialProjects:0,initialAssets:0,initialJobs:0,createdProjectReopened:true,pageErrors:errors,externalBrowserRequests:outside};
  await writeFile(join(proof,'clean-boot-evidence.json'),JSON.stringify(evidence,null,2));console.log(`PASS: clean source app loaded, created and reopened a project without models or user state. Evidence: ${join(proof,'clean-boot-evidence.json')}`);
} finally {
  await browser?.close();
  if(server.exitCode===null){const timer=setTimeout(()=>server.kill(),15000);try{server.send({type:'shutdown'});await exited;}finally{clearTimeout(timer);}}
}
