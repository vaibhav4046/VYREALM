import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleLocalBatchProjects, localBatchInput, localBatchCard, createLocalBatchSubmission, createLocalAutomationWorkspace } from '../local-automations.js';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

test('batch history keeps its cursor after recent-status polling across all 45 receipts',{timeout:30000},async t=>{
 const script=await readFile(new URL('../local-automations.js',import.meta.url));
 const batches=Array.from({length:45},(_,i)=>receipt({...input,requestId:'history-request-'+i},{id:'batch-'+String(45-i).padStart(2,'0'),name:'Saved batch '+(45-i)}));
 const requests=[],writes=[],errors=[];
 const server=createServer((req,res)=>{
  if(req.url==='/local-automations.js'){res.setHeader('content-type','text/javascript');return res.end(script);}
  if(req.url?.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(req.method!=='GET'){writes.push(req.url);res.statusCode=405;return res.end('{}');}
   if(req.url==='/api/automations')return res.end('[]');
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/api/automation-batches'){
    const before=url.searchParams.get('before');requests.push(before);
    const start=before?batches.findIndex(batch=>batch.id===before)+1:0;
    const page=batches.slice(start,start+10);
    return res.end(JSON.stringify({batches:page,nextCursor:start+page.length<batches.length?page.at(-1).id:null}));
   }
   res.statusCode=404;return res.end('{}');
  }
  res.setHeader('content-type','text/html');
  res.end(`<!doctype html><main id="fixture"></main><script type="module">import{createLocalAutomationWorkspace}from'/local-automations.js';const store={state:{projects:[]}};window.controller=createLocalAutomationWorkspace({store,api:async(p,o)=>{const response=await fetch('/api'+p,o);if(!response.ok)throw Error('HTTP '+response.status);return response.json();}});document.querySelector('#fixture').innerHTML=controller.html();controller.bind();</script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>document.querySelectorAll('[data-lab-id]').length===10);
 await page.locator('#labMore').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-lab-id]').length===20);
 const readsBeforePoll=requests.filter(cursor=>cursor===null).length;
 batches[0].entries[0].automation.status='running';
 // Wait for the real three-second interval to refresh the first page.
 await page.waitForFunction(()=>document.querySelector('[data-lab-id="batch-45"]').textContent.includes('In progress'),{},{timeout:7000});
 assert.ok(requests.filter(cursor=>cursor===null).length>readsBeforePoll);
 await page.locator('#labMore').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-lab-id]').length===30,{},{timeout:5000});
 assert.deepEqual(requests.filter(Boolean),['batch-36','batch-26']);
 const firstThree=await page.locator('[data-lab-id]').evaluateAll(elements=>elements.map(element=>element.dataset.labId));
 assert.equal(new Set(firstThree).size,30);assert.deepEqual(firstThree.slice().sort(),batches.slice(0,30).map(batch=>batch.id).sort());
 await page.locator('#labMore').click();await page.waitForFunction(()=>document.querySelectorAll('[data-lab-id]').length===40);
 await page.locator('#labMore').click();await page.waitForFunction(()=>document.querySelectorAll('[data-lab-id]').length===45);
 assert.equal(await page.locator('#labMore').isHidden(),true);
 await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/automation-batches?limit=10')),page.evaluate(()=>window.controller.update())]);
 assert.equal(await page.locator('#labMore').isHidden(),true);
 assert.equal(await page.locator('[data-lab-id]').count(),45);assert.deepEqual(requests.filter(Boolean),['batch-36','batch-26','batch-16','batch-06']);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 const proof=path.resolve('work/local-batch-pagination-proof');await mkdir(proof,{recursive:true});
 await writeFile(path.join(proof,'evidence.json'),JSON.stringify({scope:'Isolated read-only browser fixture; 45 synthetic batch receipts',requests,loaded:45,uniqueIds:45,writes,errors,checks:['real timer refresh updates recent status','page 3 follows page 2 after polling','all history remains accessible without duplicate cursor','exhausted history stays exhausted after recent refresh']},null,2));
 await page.evaluate(()=>window.controller.dispose());
});

const project={id:'p1',name:'Saved sunrise',revision:3,timeline:[{assetId:'a',duration:15}]};
const input={name:'My batch',entries:[{projectId:'p1',expectedRevision:3,name:'Saved sunrise'}]};
const memory=()=>{const data=new Map();return{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
function receipt(request,overrides={}){const entries=request.entries.map((e,position)=>({...e,position,admissionStatus:'accepted',automationId:'a-'+position,automation:{id:'a-'+position,projectId:e.projectId,expectedRevision:e.expectedRevision,status:'scheduled',step:'waiting',name:e.name},diagnostic:null}));return{id:'batch-1',kind:'saved-edit-render-batch',requestId:request.requestId,name:request.name,admissionStatus:'complete',status:'in-progress',counts:{requested:entries.length,accepted:entries.length,rejected:0,admissionPending:0,pending:entries.length,readyForReview:0,failed:0,paused:0,cancelled:0,unverifiedReviewStates:0,missingAutomations:0,publishedByAutomation:0},entries,...overrides};}

test('only real saved non-demo timelines are offered, with no automatic selection',()=>{
 const eligible=eligibleLocalBatchProjects([project,{...project,id:'demo',demo:true},{...project,id:'blank',timeline:[]},{...project,id:'bad',revision:0},project]);assert.deepEqual(eligible.map(p=>p.id),['p1']);
 const html=createLocalAutomationWorkspace({store:{state:{projects:[project]}},api:async()=>[]}).html();assert.match(html,/Batch saved edits/);assert.match(html,/0 selected/);assert.doesNotMatch(html,/type="checkbox"[^>]*checked/);assert.match(html,/id="laForm"/);
});

test('batch inputs preserve selected revisions, reject dirty/unbounded/duplicate selection and normalize time',()=>{
 assert.deepEqual(localBatchInput(input),input);assert.throws(()=>localBatchInput({...input,dirtyProjectId:'p1'}),/Save/);assert.throws(()=>localBatchInput({...input,entries:[input.entries[0],input.entries[0]]}),/once|distinct/);assert.throws(()=>localBatchInput({...input,entries:Array.from({length:65},(_,i)=>({projectId:'p'+i,expectedRevision:1}))}),/64/);assert.throws(()=>localBatchInput({...input,when:'later',scheduledAt:'2020-01-01'}),/future/);
 assert.equal(localBatchInput({...input,when:'later',scheduledAt:'2099-01-01T10:00:00+01:00'}).scheduledAt,'2099-01-01T09:00:00.000Z');
});

test('ambiguous response and reload retain identical request payload while changed revisions cannot make a second batch',async()=>{
 const storage=memory(),sent=[];let resolve;const first=createLocalBatchSubmission({storage,uuid:()=> 'request-one',api:async(_p,o)=>{sent.push(JSON.parse(o.body));return new Promise(r=>resolve=r);}});
 const a=first.submit(input),b=first.submit(input);assert.equal(sent.length,1);assert.ok(first.pending());resolve(receipt(sent[0],{admissionStatus:'interrupted',entries:sent[0].entries.map((e,position)=>({...e,position,admissionStatus:'pending',automationId:null,automation:null})),counts:{requested:1,accepted:0,rejected:0,admissionPending:1,pending:0,readyForReview:0}}));await Promise.all([a,b]);assert.ok(first.pending());
 const second=createLocalBatchSubmission({storage,api:async(_p,o)=>{sent.push(JSON.parse(o.body));throw Error('Network response lost');}});await assert.rejects(second.submit(),/lost/);assert.deepEqual(sent[1],sent[0]);assert.equal(second.pending().entries[0].expectedRevision,3);
 await assert.rejects(second.submit({...input,entries:[{projectId:'p1',expectedRevision:4}]}),/original|same batch/);assert.equal(sent.length,2);
 const final=createLocalBatchSubmission({storage,api:async(_p,o)=>{sent.push(JSON.parse(o.body));return receipt(sent.at(-1));}});await final.submit();assert.equal(final.pending(),null);assert.deepEqual(sent[2],sent[0]);
});

test('forged response ownership cannot release retry protection, while a matching polled receipt can',async()=>{
 const storage=memory(),flow=createLocalBatchSubmission({storage,uuid:()=> 'owned-request',api:async(_p,o)=>receipt({...JSON.parse(o.body),requestId:'different'})});await assert.rejects(flow.submit(input),/match|receipt/);assert.ok(flow.pending());
 assert.equal(flow.accept(receipt({...flow.pending(),entries:[{projectId:'other',expectedRevision:3}]})),false);assert.ok(flow.pending());assert.equal(flow.accept(receipt(flow.pending())),true);assert.equal(flow.pending(),null);
});

test('definitive validation failures unlock the draft; ambiguous server failures retain exact admission identity',async()=>{
 for(const [status,code,clears] of [[400,'AUTOMATION_BATCH_REQUEST',true],[409,'AUTOMATION_BATCH_REQUEST_CONFLICT',true],[500,'AUTOMATION_BATCH_REQUEST',false],[409,'AUTOMATION_BATCH_EVIDENCE',false],[400,'UNKNOWN_ERROR',false]]){
  const flow=createLocalBatchSubmission({storage:memory(),uuid:()=> 'error-request',api:async()=>{throw Object.assign(Error('Admission error'),{status,code});}});await assert.rejects(flow.submit(input),/Admission error/);assert.equal(flow.pending()===null,clears,`${status} ${code}`);
 }
});

test('ready counts require matching decoded video and creator materials evidence',()=>{
 const batch=receipt({...input,requestId:'proof-request'}),sha='a'.repeat(64);batch.entries[0].automation.status='needs-review';batch.entries[0].automation.output={sha256:sha,videoAssetId:'video-one',verification:{ok:true,playable:true,fullDecode:true,sha256:sha},creatorPack:{jobId:'pack-one',sourceAssetId:'video-one',sourceHash:sha,status:'draft',published:false}};batch.counts.pending=0;batch.counts.readyForReview=1;assert.match(localBatchCard(batch),/<b>1<\/b> ready for review/);batch.entries[0].automation.output.verification.fullDecode=false;assert.match(localBatchCard(batch),/No output is counted/);
});

test('missing durable storage prevents admission, and rejected entries never appear as completed videos',async()=>{
 let calls=0;const flow=createLocalBatchSubmission({storage:{getItem:()=>null,setItem:()=>{throw Error('full');}},api:async()=>calls++});await assert.rejects(flow.submit(input),/retry protection|storage/i);assert.equal(calls,0);
 const batch=receipt({...input,requestId:'req'},{counts:{requested:1,accepted:0,rejected:1,admissionPending:0,pending:0,readyForReview:0},entries:[{...input.entries[0],admissionStatus:'rejected',automation:null,diagnostic:{message:'Missing <source>'}}]});const html=localBatchCard(batch);assert.match(html,/Rejected/);assert.match(html,/Missing &lt;source&gt;/);assert.doesNotMatch(html,/completed|<source>/i);
});

test('real browser selects explicitly, locks duplicate submit, restores exact retry after reload, and shows partial results on mobile',{timeout:45000},async t=>{
 const script=await readFile(new URL('../local-automations.js',import.meta.url)),css=await readFile(new URL('../local-automations.css',import.meta.url));
 const initial={project,dirty:false,state:{projects:[project,{id:'p2',name:'Saved rain',revision:4,timeline:[{assetId:'b',duration:15}]},{...project,id:'demo',demo:true},{...project,id:'empty',timeline:[]}]}};
 let posts=[],pendingResponse,dropFirst=true;const batches=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/local-automations.js'){res.setHeader('content-type','text/javascript');return res.end(script);}if(req.url==='/local-automations.css'){res.setHeader('content-type','text/css');return res.end(css);}
  if(req.url?.startsWith('/api/')){
   res.setHeader('content-type','application/json');if(req.url==='/api/automations')return res.end('[]');if(req.url.startsWith('/api/automation-batches')&&req.method==='GET')return res.end(JSON.stringify({batches,nextCursor:null}));
   if(req.url==='/api/automation-batches'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);posts.push(request);if(dropFirst){dropFirst=false;pendingResponse=res;return;}
    const result=receipt(request);result.counts.accepted=1;result.counts.rejected=1;result.counts.pending=1;result.partialAdmission=true;result.entries[1]={...result.entries[1],admissionStatus:'rejected',automationId:null,automation:null,diagnostic:{code:'AUTOMATION_REVISION',message:'Saved revision changed. Select the current edit in a new batch.'}};batches.push(result);return res.end(JSON.stringify(result));}
   return res.end('{}');
  }
  res.setHeader('content-type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#101117;color:#eee;font-family:Arial}button,input,select{font:inherit}input,select{background:#1d1c25;color:#eee;max-width:100%;padding:10px;border:1px solid #555;border-radius:5px}.btn{padding:9px;border:1px solid #665870;background:#262231;color:#eee;border-radius:6px}.panel{border:1px solid #393341;border-radius:8px}.hero{margin-bottom:20px}.hero h1{font-size:32px}</style><link rel="stylesheet" href="/local-automations.css"><main id="fixture"></main><script type="module">import{createLocalAutomationWorkspace}from'/local-automations.js';window.store=${JSON.stringify(initial)};window.opens=[];const api=async(p,o)=>{const r=await fetch('/api'+p,o);if(!r.ok)throw Error('HTTP '+r.status);return r.json();};window.controller=createLocalAutomationWorkspace({store,api,onOpenProject:(...args)=>opens.push(args)});document.querySelector('#fixture').innerHTML=controller.html();controller.bind();</script>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});t.after(async()=>{pendingResponse?.destroy();await browser.close();await new Promise(r=>server.close(r));});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#labSubmit').waitFor();assert.equal(await page.locator('[data-lab-project]').count(),2);assert.equal(await page.locator('[data-lab-project]:checked').count(),0);await page.locator('#labSelectAll').click();assert.equal(await page.locator('[data-lab-project]:checked').count(),2);await page.locator('#labName').fill('Two real saved edits');await page.locator('#labSubmit').click();await page.waitForFunction(()=>document.querySelector('#labSubmit').disabled);assert.equal(await page.locator('#labName').isDisabled(),true);assert.equal(await page.locator('[data-lab-project]').first().isDisabled(),true);while(!pendingResponse)await new Promise(r=>setImmediate(r));pendingResponse.statusCode=500;pendingResponse.end(JSON.stringify({error:"Response unavailable after admission",code:"INTERNAL_ERROR"}));await page.getByText(/Retry the same batch/).first().waitFor();assert.equal(posts.length,1);
 await page.reload();await page.locator('#labSubmit').waitFor();await page.evaluate(()=>{window.store.state.projects[0].revision=9;window.controller.update();});assert.equal(await page.locator('#labName').isDisabled(),true);await page.locator('#labSubmit').click();await page.getByText('1 rejected',{exact:false}).first().waitFor();assert.equal(posts.length,2);assert.deepEqual(posts[1],posts[0]);assert.equal(await page.locator('[data-lab-project]:checked').count(),0);
 await page.locator('[data-lab-detail]').click();assert.match(await page.locator('#labRuns').innerText(),/Saved revision changed/);await page.locator('[data-lab-open]').first().click();assert.deepEqual(await page.evaluate(()=>window.opens),[['p1','Timeline']]);
 const proof=path.resolve('work/local-batch-ui-proof');await mkdir(proof,{recursive:true});await page.locator('#localBatch').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(proof,'desktop.png')});await page.setViewportSize({width:390,height:844});await page.locator('#localBatch').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(proof,'mobile.png')});await writeFile(path.join(proof,'evidence.json'),JSON.stringify({scope:'Isolated API fixture, no canonical jobs or generated media',requests:posts.length,samePayload:JSON.stringify(posts[0])===JSON.stringify(posts[1]),errors,checks:['empty initial selection','non-demo saved timelines','locked inflight controls','durable retry after reload and revision change','partial rejection visible','open exact project','mobile no overflow']},null,2));assert.deepEqual(errors,[]);await page.evaluate(()=>window.controller.dispose());
});
