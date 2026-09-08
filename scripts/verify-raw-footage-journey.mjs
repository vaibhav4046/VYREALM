import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';

// Exercises ordinary browser controls against the running product. Source media
// is supplied through its upload input; no project/job writes bypass the UI.
const base=process.env.VYREALM_DEMO_URL||'http://127.0.0.1:4173';
const source=resolve(process.argv[2]||'work/demo-source/running-stream.webm');
const out=resolve(process.argv[3]||`work/raw-user-journey-${Date.now()}`);await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:join(out,'recordings'),size:{width:1440,height:900}},acceptDownloads:true});
const page=await context.newPage(),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))requests.push(r.url());});
let result;
try{
  await page.goto(base);await page.locator('#chatProject').waitFor();await page.locator('#chatProject').selectOption('');
  await page.screenshot({path:join(out,'01-upload-first.png')});
  await page.locator('#chatMediaInput').setInputFiles(source);
  await page.waitForFunction(()=>document.querySelector('#chatProject')?.value&&document.querySelector('.chat-context-body')?.textContent.includes('Revision'));
  await page.locator('#chatInput').fill('Make a 20-second vertical reel from my uploaded footage. Preserve the original water sound. No captions.');
  await page.screenshot({path:join(out,'02-original-brief.png')});
  const began=Date.now();await page.getByRole('button',{name:'Produce video',exact:true}).click();
  await page.getByLabel('Current video production').waitFor({timeout:30000});
  await page.screenshot({path:join(out,'03-product-working.png')});
  await page.locator('#chatProduction video').waitFor({timeout:240000});
  const elapsedMs=Date.now()-began,projectId=await page.locator('#chatProject').inputValue();
  const session=await(await context.request.get(base+'/api/session')).json();
  const headers={'X-Vyrelum-Token':session.token};
  const current=await(await context.request.get(base+`/api/projects/${projectId}/production-run`,{headers})).json();
  assert.equal(current.job.status,'review_required');assert.equal(current.job.output.provenance.generationStatus,'edited');
  await page.locator('#chatProduction video').evaluate(video=>video.play());await page.waitForTimeout(3000);await page.locator('#chatProduction video').evaluate(video=>video.pause());
  await page.screenshot({path:join(out,'04-real-result.png')});
  result={projectId,jobId:current.job.id,elapsedMs,status:'awaiting-actual-visual-review',job:current.job,errors,externalBrowserRequests:requests,proofMethod:'UI upload → ordinary brief → Produce video; product owns worker, edit, audio and export. No direct provider or database mutations.'};
  await writeFile(join(out,'evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({readyForReview:true,outputDirectory:out,projectId,jobId:result.jobId,elapsedMs,output:current.job.output}));
  let decision;const deadline=Date.now()+600000;
  while(Date.now()<deadline){try{decision=JSON.parse(await readFile(join(out,'review.json'),'utf8'));break;}catch{}await page.waitForTimeout(1000);}
  if(!decision)throw Error('No visual review supplied; output remains review_required.');
  assert.ok(['passed','rejected'].includes(decision.verdict));await page.locator('#productionReviewNotes').fill(decision.notes);
  await page.locator(`#productionReview button[value="${decision.verdict}"]`).click();
  await page.locator('#productionReview').waitFor({state:'detached'});
  if(decision.verdict==='passed'){
    const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'Download MP4'}).click();const download=await downloadEvent;await download.saveAs(join(out,'VYREALM-stream-reel-1080p.mp4'));
    await page.reload();await page.locator('#chatProduction video').waitFor();assert.equal(await page.locator('#chatProject').inputValue(),projectId);
    await page.screenshot({path:join(out,'05-reopened-project.png')});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);result={...result,status:decision.verdict==='passed'?'reviewed-downloaded-reopened':'rejected',review:decision};
  await writeFile(join(out,'evidence.json'),JSON.stringify(result,null,2));
}finally{await context.close();await browser.close();}
console.log(JSON.stringify({completed:true,directory:out,status:result?.status}));
