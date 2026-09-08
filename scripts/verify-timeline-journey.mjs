import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';

const base=process.env.VYREALM_DEMO_URL||'http://127.0.0.1:4173',out=resolve(process.argv[3]||'work/timeline-live-proof');
const source=resolve(process.argv[2]||'work/demo-source/running-stream.webm');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base);await page.locator('#chatProject').waitFor();await page.locator('#chatProject').selectOption('');
 await page.locator('#chatMediaInput').setInputFiles(source);await page.waitForFunction(()=>document.querySelector('#chatProject')?.value&&document.querySelector('.chat-context-body')?.textContent.includes('Revision'));
 const projectId=await page.locator('#chatProject').inputValue();await page.locator('.sidebar [data-nav="Timeline"]').click();await page.locator('#tleTrim').waitFor();
 await page.locator('#tleVideo').evaluate(video=>video.readyState>=1?null:new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true})));
 await page.locator('#tleTrim').fill('2');await page.locator('#tleDuration').fill('4');await page.locator('#tleClipCaption').fill('Water, in motion.');await page.locator('#tleApply').click();
 await page.locator('#tleScrub').fill('1');await page.locator('#tleScrub').dispatchEvent('input');await page.waitForTimeout(400);
 const preview=await page.locator('#tleVideo').evaluate(v=>({time:v.currentTime,width:v.videoWidth,height:v.videoHeight}));assert.ok(Math.abs(preview.time-3)<0.2,JSON.stringify(preview));
 await page.locator('#tleSplit').click();await page.locator('[data-tle-clip]').nth(1).click();await page.locator('#tleEarlier').click();await page.locator('#tleSave').click();await page.waitForFunction(()=>document.querySelector('#tleSaveStatus')?.textContent.includes('Saved'));
 await page.screenshot({path:join(out,'01-timeline-edited.png')});
 const session=await(await context.request.get(base+'/api/session')).json(),headers={'X-Vyrelum-Token':session.token};
 const project=await(await context.request.get(base+`/api/projects/${projectId}`,{headers})).json();assert.equal(project.timeline.length,2);assert.equal(project.timeline[0].trimStart,3);assert.equal(project.timeline[0].duration,3);assert.equal(project.timeline[1].trimStart,2);assert.equal(project.timeline[1].duration,1);
 await page.reload();await page.locator('#chatProject').waitFor();assert.equal(await page.locator('#chatProject').inputValue(),projectId);await page.locator('.sidebar [data-nav="Timeline"]').click();await page.locator('#tleTrim').waitFor();assert.equal(await page.locator('#tleTrim').inputValue(),'3');
 const began=Date.now();await page.locator('#tleExport').click();await page.locator('.sidebar [data-nav="Jobs"].active').waitFor();
 let job;for(let i=0;i<180;i++){const jobs=await(await context.request.get(base+'/api/jobs',{headers})).json();job=jobs.find(j=>j.projectId===projectId&&j.type==='render');if(job&&['succeeded','review_required','failed','blocked'].includes(job.status))break;await page.waitForTimeout(1000);}
 assert.ok(job&&!['failed','blocked'].includes(job.status),JSON.stringify(job));assert.ok(['succeeded','review_required'].includes(job.status));
 await page.locator('.sidebar [data-nav="Export"]').click();await page.locator('video.media-preview').waitFor();await page.locator('video.media-preview').evaluate(v=>v.play());await page.waitForTimeout(1500);await page.locator('video.media-preview').evaluate(v=>v.pause());
 await page.screenshot({path:join(out,'02-timeline-export.png')});const assetId=job.output?.assets?.video;
 const link=page.getByRole('link',{name:'Download video',exact:true}).first();const downloadEvent=page.waitForEvent('download');await link.click();const download=await downloadEvent;await download.saveAs(join(out,'VYREALM-timeline-edit.mp4'));
 assert.deepEqual(errors,[]);await writeFile(join(out,'evidence.json'),JSON.stringify({projectId,jobId:job.id,elapsedMs:Date.now()-began,preview,clips:project.timeline,assetId,job,errors,checks:['UI upload','trim','preview source time','split','reorder','save','reopen','render','playback','download'],scope:'Functional editing verification; silent stream is not accepted creative showcase.'},null,2));console.log(JSON.stringify({passed:true,projectId,jobId:job.id,out}));
}finally{await context.close();await browser.close();}
