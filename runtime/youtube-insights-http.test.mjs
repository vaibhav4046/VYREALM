import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url));
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'vyrealm-insights-http-')),dataDir=join(directory,'data');
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[join(root,'server.js')],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),VYRELUM_ROOT:root,VYRELUM_DATA_DIR:dataDir,VYRELUM_RUNTIME_DIR:join(directory,'runtime'),VYRELUM_GPU_LEASE_DIR:join(directory,'gpu'),VYRELUM_COMFYUI_URL:'http://127.0.0.1:1',OLLAMA_HOST:'http://127.0.0.1:1',VYRELUM_OLLAMA_URL:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe','ipc']});
 let logs='',db,browser;
 t.after(async()=>{await browser?.close();db?.close();if(child.exitCode===null){const exited=once(child,'exit');if(child.connected)child.send({type:'shutdown'});const timer=setTimeout(()=>child.kill(),4000);await exited;clearTimeout(timer);}if(dirname(directory)===resolve(tmpdir())&&basename(directory).startsWith('vyrealm-insights-http-'))await rm(directory,{recursive:true,force:true});});
 await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error(`Isolated server startup timeout: ${logs}`)),15000);child.stdout.on('data',b=>{logs=(logs+b).slice(-12000);if(logs.includes('local control plane listening')){clearTimeout(timer);yes();}});child.stderr.on('data',b=>logs=(logs+b).slice(-12000));child.once('error',e=>{clearTimeout(timer);no(e);});child.once('exit',code=>{clearTimeout(timer);no(Error(`Isolated server exited ${code}: ${logs}`));});});
 const base=`http://127.0.0.1:${port}`,session=await(await fetch(base+'/api/session')).json();assert.ok(session.token);
 const api=async(path,method='GET',body,headers={})=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json','X-Vyrelum-Token':session.token,...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return{status:response.status,body:await response.json()};};
 db=new DatabaseSync(join(dataDir,'vyrelum.sqlite'));
 return {api,db,base,async page(){browser=await chromium.launch({headless:true});return browser.newPage({viewport:{width:1440,height:1000}});}};
}

test('real isolated insights API and Settings preserve offline and provenance boundaries',{timeout:40000},async t=>{
 const f=await fixture(t),request={requestId:randomUUID(),channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',snapshotId:randomUUID(),recommendationId:'unavailable-recommendation'};
 await t.test('fresh profile has no connection or analytics and static modules are JavaScript',async()=>{
  const state=await f.api('/api/youtube/insights');assert.equal(state.status,200);assert.equal(state.body.connection,'disconnected');assert.equal(state.body.snapshot,null);assert.deepEqual(state.body.recommendations,[]);assert.equal(state.body.settings,null);
  assert.equal((await f.api('/api/youtube/status')).body.code,'YOUTUBE_CLIENT_NOT_CONFIGURED');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM youtube_insights_snapshots').get().n,0);
  for(const file of ['youtube-upload.js','youtube-insights.js']){const response=await fetch(`${f.base}/${file}`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/(javascript|ecmascript)/i);const source=await response.text();assert.match(source,/export function/);assert.doesNotMatch(source,/<!doctype html>/i);}
 });
 await t.test('brief admission enforces token, origin, exact ID-only input and connected channel',async()=>{
  assert.equal((await fetch(f.base+'/api/youtube/insights')).status,401);
  assert.equal((await fetch(f.base+'/api/youtube/insights/brief',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)})).status,401);
  assert.equal((await f.api('/api/youtube/insights/brief','POST',request,{origin:'https://foreign.example'})).status,403);
  for(const input of [{...request,brief:'Forged metrics and winner claim'},{...request,evidence:{views:999999}},{...request,requestId:'bad-id'},{...request,snapshotId:'bad-id'},{...request,channelId:'other-profile'}]){
   const result=await f.api('/api/youtube/insights/brief','POST',input);assert.equal(result.status,400);assert.equal(result.body.code,'INSIGHT_PROJECT_INVALID');
  }
  const disconnected=await f.api('/api/youtube/insights/brief','POST',request);assert.equal(disconnected.status,409);assert.equal(disconnected.body.code,'INSIGHT_PROJECT_CHANNEL_REQUIRED');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM projects').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
 });
 await t.test('imported insight evidence is never an active receipt and both PATCH formats reject forgery',async()=>{
  const forged={snapshotId:request.snapshotId,channelId:request.channelId,recommendationId:request.recommendationId,sourceMethod:'youtube-analytics-derived-hypothesis',evidence:{views:999999}};
  const imported=await f.api('/api/projects/import','POST',{project:{name:'Unverified imported analytics draft',brief:'Fixture only',timeline:[],insightSource:forged},assets:[]});assert.equal(imported.status,201);assert.equal(Object.hasOwn(imported.body,'insightSource'),false);assert.equal(imported.body.importedInsightSource.status,'imported-unverified');assert.deepEqual(imported.body.importedInsightSource.value,forged);
  for(const body of [{expectedRevision:1,patch:{insightSource:forged}},{expectedRevision:1,insightSource:forged}]){
   const response=await f.api(`/api/projects/${imported.body.id}`,'PATCH',body);assert.equal(response.status,400);assert.match(response.body.error,/managed by workers/);
  }
  const reopened=await f.api(`/api/projects/${imported.body.id}`);assert.equal(reopened.body.revision,1);assert.equal(Object.hasOwn(reopened.body,'insightSource'),false);assert.equal(reopened.body.importedInsightSource.status,'imported-unverified');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
 });
 await t.test('actual app mounts disconnected insights in Settings on desktop and mobile without online actions',async()=>{
  const page=await f.page(),errors=[],posts=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/youtube/'))posts.push(r.url());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===f.base)return route.continue();external.push(url.origin);return route.abort();});
  await page.goto(f.base);await page.locator('.content[aria-busy="false"]').waitFor({timeout:10000});await page.locator('[data-nav="Settings"]').click();await page.locator('#youtubeInsights [data-insights-status]').filter({hasText:'paused'}).waitFor({timeout:7000});
  const panel=page.locator('#youtubeInsights');assert.match(await panel.innerText(),/Connect and verify your channel/);assert.equal(await panel.locator('#insightsEnabled').isDisabled(),true);assert.equal(await panel.locator('#insightsRefresh').isDisabled(),true);assert.equal(await panel.locator('[data-insight-brief]').count(),0);
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await panel.scrollIntoViewIfNeeded();const bounds=await panel.boundingBox();assert.ok(bounds&&bounds.width>200&&bounds.width<=viewport.width,JSON.stringify(bounds));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);assert.deepEqual(external,[]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM youtube_insights_snapshots').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,0);
 });
});
