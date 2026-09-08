import {spawn,execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

const root=resolve('.'),dir=join(root,'work',`automation-journey-${Date.now()}`),exec=promisify(execFile);
await mkdir(dir,{recursive:true});
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`,source=join(dir,'test-source.mp4');
await exec(join(root,'workers/tools/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-y',source],{windowsHide:true});
const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),VYRELUM_DATA_DIR:join(dir,'data'),VYRELUM_RUNTIME_DIR:join(dir,'runtime'),VYRELUM_GPU_LEASE_DIR:join(dir,'gpu'),OLLAMA_HOST:'http://127.0.0.1:1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',browser;child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
 for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('Isolated server stopped: '+logs);try{if((await fetch(base+'/api/session')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#refreshBtn:not(:disabled)').waitFor();
 const request=async(route,method='GET',body,headers={})=>{const response=await page.request.fetch(base+'/api'+route,{method,...(body===undefined?{}:{data:body}),headers});assert.ok(response.ok(),await response.text());return response.json();};
 let project=await request('/projects','POST',{name:'Automation browser test — not a catalogue film',brief:'CPU-generated test pattern for workflow verification only.',captionsEnabled:false,settings:{width:320,height:180,fps:24}});
 const asset=await request('/assets','POST',await readFile(source),{'content-type':'video/mp4','x-filename':'test-source.mp4','x-project-id':project.id});
 project=await request('/projects/'+project.id,'PATCH',{expectedRevision:project.revision,patch:{timeline:[{id:'test-edit',assetId:asset.id,kind:'video',trimStart:0,duration:4,caption:''}]}});
 await page.evaluate(id=>localStorage.setItem('vyrelum:selectedProject',id),project.id);await page.reload();await page.locator('#refreshBtn:not(:disabled)').waitFor();
 async function openAutomations(){const link=page.locator('.sidebar [data-nav="Automations"]');if(!await link.isVisible()){if(await page.locator('#menuBtn').isVisible())await page.locator('#menuBtn').click();await link.evaluate(e=>{const details=e.closest('details');if(details)details.open=true;});}await link.click();await page.locator('#laForm').waitFor();}
 await openAutomations();await page.locator('#laProject').selectOption(project.id);await page.locator('#laName').fill('Render my saved edit');
 await page.locator('#laSubmit').click();await page.locator('.la-status').filter({hasText:'Ready for your review'}).waitFor({timeout:90000});
 const runs=await request('/automations'),run=runs.find(r=>r.name==='Render my saved edit');assert.equal(run.status,'needs-review');assert.equal(run.output.verification.fullDecode,true);assert.equal(run.output.creatorPack.published,false);
 await page.locator('.la-evidence summary').first().click();await page.locator('#laName').fill('Keep this unsent draft');await page.locator('#laName').focus();await page.waitForTimeout(5500);
 assert.equal(await page.locator('#laName').inputValue(),'Keep this unsent draft');assert.equal(await page.locator('#laName').evaluate(e=>document.activeElement===e),true);assert.equal(await page.locator('.la-evidence').first().getAttribute('open'),'');
 await page.screenshot({path:join(dir,'automation-1440.png')});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(dir,'automation-390.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Review video'}).click();await page.locator('video.media-preview').waitFor();await page.locator('video.media-preview').evaluate(async video=>{await video.play();});await page.waitForFunction(()=>document.querySelector('video.media-preview')?.ended,{},{timeout:15000});
 const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'Download video',exact:true}).click();const download=await downloadEvent;await download.saveAs(join(dir,'downloaded.mp4'));const hash=createHash('sha256').update(await readFile(join(dir,'downloaded.mp4'))).digest('hex');assert.equal(hash,run.output.sha256);
 await page.reload();await page.locator('#refreshBtn:not(:disabled)').waitFor();await openAutomations();await page.locator('.la-status').filter({hasText:'Ready for your review'}).waitFor();
 await page.locator('#laName').fill('Later, then cancel');await page.locator('#laWhen').selectOption('later');const future=new Date(Date.now()+3600000);future.setMinutes(future.getMinutes()-future.getTimezoneOffset());await page.locator('#laTime').fill(future.toISOString().slice(0,16));await page.locator('#laSubmit').click();
 const futureCard=page.locator('.la-run').filter({hasText:'Later, then cancel'});await futureCard.getByRole('button',{name:'Cancel workflow'}).click();await futureCard.locator('.la-status').filter({hasText:'Cancelled'}).waitFor();
 const jobs=await request('/jobs');assert.equal(jobs.filter(j=>j.type==='render').length,1);assert.equal(jobs.filter(j=>j.type==='creator-pack').length,1);assert.deepEqual(errors,[]);
 await writeFile(join(dir,'evidence.json'),JSON.stringify({passed:true,testOnly:true,projectId:project.id,automationId:run.id,outputSha256:hash,checks:['UI creates a real durable workflow','full FFmpeg decode verified','creator materials are drafts','polling preserves form focus and expanded evidence','mobile fits','review opens matching output','video playback reaches end','download hash matches receipt','reload retains workflow','scheduled cancellation creates no render','no page errors'],errors},null,2));console.log(JSON.stringify({passed:true,dir}));
}catch(error){await writeFile(join(dir,'server.log'),logs);throw error;}finally{await browser?.close();if(child.exitCode===null)child.kill();}
