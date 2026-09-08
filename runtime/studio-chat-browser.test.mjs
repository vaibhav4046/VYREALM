import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createServer } from 'node:net';

test('chat creates a project, persists direction and characters, plans shots and reopens without a GPU', {timeout:120000},async()=>{
 const directory=resolve('work/chat-e2e',String(Date.now()));await mkdir(directory,{recursive:true});
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const server=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),VYRELUM_DATA_DIR:join(directory,'data'),VYRELUM_RUNTIME_DIR:join(directory,'runtime'),OLLAMA_HOST:'http://127.0.0.1:1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});let serverLog='';server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);
 const closed=new Promise(r=>server.once('close',r));let browserServer,browser;const errors=[],outside=[];let evidence;
 try{
  const base=`http://127.0.0.1:${port}`;let session;
  for(let i=0;i<80;i++){try{session=await(await fetch(base+'/api/session',{signal:AbortSignal.timeout(500)})).json();break;}catch{if(server.exitCode!==null)throw Error(serverLog);await new Promise(r=>setTimeout(r,100));}}assert.ok(session?.token,serverLog);
  browserServer=await chromium.launchServer({headless:true});browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&!['localhost','127.0.0.1'].includes(url.hostname)){outside.push(url.origin);return route.abort();}return route.continue();});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#chatInput').waitFor();await page.locator('#chatLocalModel').uncheck();await page.locator('#chatInput').fill('An original archer learns to repair a bow. Plan a clear three-step tutorial using my footage.');await page.locator('#chatForm button[type=submit]:not([name=intent])').click();
  await page.locator('.chat-message[data-role=assistant]').waitFor({timeout:30000});assert.match(await page.locator('.chat-message[data-role=assistant]').innerText(),/local workflow guide/i);
  const projectId=await page.evaluate(()=>localStorage.getItem('vyrelum:selectedProject'));assert.ok(projectId);
  await page.locator('[data-chat-tab=characters]').click();await page.locator('#chatCharacterName').fill('Nalin');await page.locator('#chatCharacterDescription').fill('Original adult archer, linen tunic, leather wrist guard, dark hair tied at the nape.');await page.locator('#chatCharacterForm button[type=submit]').click();await page.locator('.chat-character strong').filter({hasText:'Nalin'}).waitFor();
  await page.locator('[data-chat-tab=project]').click();await page.locator('#chatContext [data-chat-action=plan]').click();await page.locator('#chatWorkflow').selectOption('tutorial');await page.locator('#chatSource option[value=uploaded-media]').waitFor({state:'attached'});await page.locator('#chatSource').selectOption('uploaded-media');await page.locator('#chatScript').fill('First inspect the bow. Then replace the worn string. Finally check the tension.');await page.locator('#chatPlanForm button[type=submit]').click();await page.locator('.chat-shot').first().waitFor();assert.equal(await page.locator('.chat-shot').count(),4);
  await page.reload();await page.locator('.chat-message[data-role=assistant]').waitFor();assert.equal(await page.locator('.chat-message[data-role=user]').count(),1);await page.locator('[data-chat-tab=characters]').click();await page.locator('.chat-character strong').filter({hasText:'Nalin'}).waitFor();
  const request=async path=>(await fetch(base+path,{headers:{'X-Vyrelum-Token':session.token}})).json();const project=await request(`/api/projects/${projectId}`);assert.equal(project.characters[0].name,'Nalin');assert.equal(project.creatorWorkflow.workflowId,'tutorial');assert.equal(project.creatorWorkflow.mediaGenerated,false);assert.equal((await request('/api/jobs')).length,0);assert.equal(project.timeline.length,0);
  await page.locator('#chatNewSession').click();await page.locator('.chat-empty').waitFor();assert.equal(await page.locator('.chat-message[data-role=user]').count(),0);await page.locator('#chatLocalModel').uncheck();await page.locator('#chatInput').fill('Develop a second opening for the same project.');await page.locator('#chatForm button[type=submit]:not([name=intent])').click();await page.locator('.chat-message[data-role=assistant]').waitFor();assert.equal(await page.locator('.chat-message[data-role=user]').count(),1);await page.locator('#chatSession').selectOption('main');await page.locator('.chat-message[data-role=user]').waitFor();assert.match(await page.locator('.chat-message[data-role=user]').innerText(),/original archer/);await page.reload();await page.locator('.chat-message[data-role=user]').waitFor();assert.equal(await page.locator('#chatSession').inputValue(),'main');
  await page.screenshot({path:join(directory,'chat-persisted.png')});assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);evidence={passed:true,projectId,revision:project.revision,steps:['create in chat','offline guide reply','save character','plan uploaded tutorial','reload conversation and character'],jobs:0,pageErrors:errors,externalRequests:outside,source:'real browser and isolated VYREALM server; no model/media generation claimed'};await writeFile(join(directory,'evidence.json'),JSON.stringify(evidence,null,2));
 }finally{
  const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise(r=>{timer=setTimeout(()=>r(false),5000);})]);}finally{clearTimeout(timer);}};
  if(browser)await bounded(browser.close().then(()=>true));if(browserServer){await bounded(browserServer.close().then(()=>true));const process=browserServer.process();if(process?.exitCode===null&&process.pid)await promisify(execFile)('taskkill.exe',['/pid',String(process.pid),'/t','/f'],{windowsHide:true}).catch(()=>{});}
  if(server.exitCode===null&&server.connected)server.send({type:'shutdown'});if(await bounded(closed.then(()=>true))===false&&server.pid)await promisify(execFile)('taskkill.exe',['/pid',String(server.pid),'/t','/f'],{windowsHide:true}).catch(()=>{});
  await writeFile(join(directory,'server.log'),serverLog);
 }assert.ok(evidence?.passed);
});
