import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';

const CHANNEL='UC'+'a'.repeat(22),OTHER='UC'+'b'.repeat(22),SHA='f'.repeat(64);
const source=()=>({id:'film-one',revision:3,title:'Original science short',latestOutput:{status:'reviewed',provenance:{outputHash:SHA}}});
async function fixture(t,handle){
 const script=await readFile(new URL('../youtube-upload.js',import.meta.url)),css=await readFile(new URL('../styles.css',import.meta.url));
 const state={project:source(),status:{configured:true,connected:true,connectedChannel:{id:CHANNEL,title:'My own original creator channel'},upload:'authorized-not-verified'},jobs:[],calls:[],held:[],errors:[]};
 const server=createServer(async(req,res)=>{
  if(req.url==='/youtube-upload.js'){res.setHeader('content-type','text/javascript');return res.end(script);}
  if(req.url==='/styles.css'){res.setHeader('content-type','text/css');return res.end(css);}
  if(req.url?.startsWith('/api/')){res.setHeader('content-type','application/json');let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):{};state.calls.push({path:req.url,method:req.method,...(req.method==='POST'?{body}:{})});
   if(await handle?.({req,res,body,state}))return;
   if(req.url==='/api/youtube/status')return res.end(JSON.stringify(state.status));
   if(req.url==='/api/jobs')return res.end(JSON.stringify(state.jobs));
   if(req.url==='/api/youtube/verify')return res.end(JSON.stringify({...state.status,channelVerification:{status:'verified',checkedAt:'2026-09-08T12:00:00Z'}}));
   res.statusCode=404;return res.end('{}');
  }
  if(req.url!=='/'){res.statusCode=404;return res.end();}
  res.setHeader('content-type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{display:block;padding:24px}main{max-width:1000px;margin:auto;min-width:0}@media(max-width:650px){body{padding:12px}}</style><main></main><script type="module">import{createYouTubeUpload}from'/youtube-upload.js';window.project=${JSON.stringify(state.project)};window.controller=createYouTubeUpload({getProject:()=>project,api:async(p,o)=>{const r=await fetch('/api'+p,o),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Raw fixture error'),{code:data.code,status:r.status});return data;}});document.querySelector('main').innerHTML=controller.html();controller.bind();</script>`);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 t.after(async()=>{for(const response of state.held)response.destroy();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>state.errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByText(/Destination:/).waitFor();
 return{page,state};
}

test('private upload preserves exact admission through ambiguous response, editing, reload and processing checks',{timeout:30000},async t=>{
 let uploads=0,held,processingReady=false;
 const {page,state}=await fixture(t,({req,res,body,state})=>{
  if(req.url==='/api/youtube/upload'){
   uploads++;if(uploads===1){held=res;state.held.push(res);return true;}
   const job={...body,id:body.requestId,revision:body.expectedRevision,type:'youtube-upload',status:'queued',progress:0,output:{}};state.jobs=[job];res.end(JSON.stringify(job));return true;
  }
  if(req.url.match(/^\/api\/youtube\/uploads\/[^/]+\/verify$/)){
   const out=state.jobs[0].output;out.processing={status:processingReady?'succeeded':'pending',source:'youtube-data-api',checkedAt:'2026-09-08T12:00:00Z'};out.processingVerified=processingReady;res.end(JSON.stringify(state.jobs[0]));return true;
  }
 });
 await page.locator('#ytUploadTitle').fill('My exact chosen title');await page.locator('#ytUploadDescription').fill('An original film with precise source credits.');await page.locator('#ytUploadAudience').selectOption('no');
 await page.locator('#ytUploadTitle').focus();await page.locator('#ytUploadTitle').evaluate(el=>el.setSelectionRange(3,9));
 await page.evaluate(()=>controller.update());assert.equal(await page.locator('#ytUploadTitle').inputValue(),'My exact chosen title');assert.deepEqual(await page.locator('#ytUploadTitle').evaluate(el=>[document.activeElement===el,el.selectionStart,el.selectionEnd]),[true,3,9]);
 await page.locator('#ytUploadConfirm').check();await page.locator('#ytUploadForm button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#ytUploadTitle').disabled);
 await page.evaluate(()=>{document.querySelector('#ytUploadForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 while(!held)await new Promise(resolve=>setImmediate(resolve));assert.equal(uploads,1);
 held.statusCode=500;held.end(JSON.stringify({error:'client_secret=LEAK_MUST_NOT_RENDER',code:'INTERNAL_ERROR'}));
 await page.getByRole('alert').filter({hasText:'unresolved'}).waitFor();assert.equal(await page.locator('#ytUploadTitle').isDisabled(),true);
 await page.locator('#ytUploadTitle').evaluate(el=>{el.value='Not authorized replacement';el.dispatchEvent(new Event('input',{bubbles:true}));});
 const original=state.calls.find(call=>call.path==='/api/youtube/upload').body;
 assert.equal(original.expectedChannelId,CHANNEL);assert.equal(original.expectedOutputHash,SHA);assert.equal(original.expectedRevision,3);assert.equal(original.metadata.privacyStatus,'private');assert.equal(original.metadata.selfDeclaredMadeForKids,false);
 state.project.revision=8;await page.reload();await page.getByRole('button',{name:'Retry same upload'}).waitFor();
 assert.equal(await page.locator('#ytUploadTitle').inputValue(),'My exact chosen title');assert.equal(await page.locator('#ytUploadTitle').isDisabled(),true);
 await page.getByRole('button',{name:'Retry same upload'}).click();await page.locator('[data-yt-job]').waitFor();assert.equal(uploads,2);
 assert.deepEqual(state.calls.filter(call=>call.path==='/api/youtube/upload')[1].body,original);
 assert.equal(await page.locator('#ytUploadConfirm').isChecked(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('vyrealm:youtube-upload-pending:v1')),null);
 state.jobs[0]={...state.jobs[0],status:'succeeded',progress:1,stage:'client_secret=LEAK_MUST_NOT_RENDER',output:{id:'local-upload-one',state:'uploaded_private',privacyStatus:'private',channelId:CHANNEL,sha256:SHA,videoId:'abcdEFG_123',processingVerified:false}};
 await page.evaluate(()=>controller.update());await page.getByText('Private transfer completed; processing not yet verified',{exact:true}).waitFor();assert.equal(await page.getByText('Private video ready',{exact:true}).count(),0);
 await page.locator('[data-yt-verify]').click();assert.equal(await page.getByText('Private video ready',{exact:true}).count(),0);
 processingReady=true;await page.locator('[data-yt-verify]').click();await page.getByText('Private video ready',{exact:true}).waitFor();
 const proof=path.resolve('work/youtube-upload-ui-proof');await mkdir(proof,{recursive:true});await page.screenshot({path:path.join(proof,'desktop-private-processing-verified.png'),fullPage:true});
 await page.reload();await page.getByText('Private video ready',{exact:true}).waitFor();assert.equal(uploads,2);
 state.status.connectedChannel.title='An unusually long creator channel name '+ 'Original science and films '.repeat(12);await page.evaluate(()=>controller.update());
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(proof,'mobile-upload.png'),fullPage:true});
 assert.doesNotMatch(await page.locator('body').innerHTML(),/LEAK_MUST_NOT_RENDER/);assert.deepEqual(state.errors,[]);
 await writeFile(path.join(proof,'evidence.json'),JSON.stringify({scope:'Isolated fixture; no live upload or credentials',checks:['exact reviewed hash/revision/channel','private metadata and audience confirmation','pending double submit blocked','ambiguous response locks original details','reload and changed revision retain identical request','polling retains title and cursor','reopened durable upload job','transfer and processing distinguished','processing requires explicit verification','390px no overflow','raw error and stage secrets never displayed'],uploadPosts:uploads,oneRequestId:state.calls.filter(call=>call.path==='/api/youtube/upload').every(call=>call.body.requestId===original.requestId),errors:state.errors},null,2));await page.evaluate(()=>controller.dispose());
});

test('a late project revision retains upload text and requires renewed confirmation without admitting an upload',{timeout:30000},async t=>{
 const {page,state}=await fixture(t);
 await page.locator('#ytUploadTitle').fill('My carefully written title');
 await page.locator('#ytUploadDescription').fill('My exact description');
 await page.locator('#ytUploadAudience').selectOption('no');
 await page.locator('#ytUploadConfirm').check();
 await page.evaluate(()=>{project.revision++;return controller.update();});
 assert.equal(await page.locator('#ytUploadTitle').inputValue(),'My carefully written title');
 assert.equal(await page.locator('#ytUploadDescription').inputValue(),'My exact description');
 assert.equal(await page.locator('#ytUploadAudience').inputValue(),'no');
 assert.equal(await page.locator('#ytUploadConfirm').isChecked(),false);
 await page.getByRole('alert').filter({hasText:'Your upload details are retained'}).waitFor();
 assert.equal(state.calls.some(call=>call.path==='/api/youtube/upload'),false);
 await page.evaluate(()=>controller.dispose());
});

test('changed channel, unreviewed export, navigation and unavailable retry storage prevent admission',{timeout:30000},async t=>{
 let changed=true,hold=false,heldVerify;
 const {page,state}=await fixture(t,({req,res,state})=>{
  if(req.url==='/api/youtube/verify'){
   if(hold){heldVerify=res;state.held.push(res);return true;}
   res.end(JSON.stringify({...state.status,connectedChannel:{id:changed?OTHER:CHANNEL,title:'Verified destination'},channelVerification:{status:'verified'}}));return true;
  }
 });
 await page.locator('#ytUploadAudience').selectOption('no');await page.locator('#ytUploadConfirm').check();await page.locator('#ytUploadForm button[type=submit]').click();
 await page.getByRole('alert').filter({hasText:'connected channel changed'}).waitFor();assert.equal(state.calls.some(call=>call.path==='/api/youtube/upload'),false);assert.equal(await page.locator('#ytUploadConfirm').isChecked(),false);
 changed=false;await page.evaluate(()=>{project.latestOutput.status='unreviewed';return controller.update();});assert.equal(await page.locator('#ytUploadForm button[type=submit]').isDisabled(),true);
 await page.evaluate(()=>{document.querySelector('#ytUploadForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await page.getByRole('alert').filter({hasText:'Review the export'}).waitFor();assert.equal(state.calls.some(call=>call.path==='/api/youtube/upload'),false);
 await page.evaluate(()=>{project.latestOutput.status='reviewed';return controller.update();});await page.locator('#ytUploadConfirm').check();hold=true;await page.locator('#ytUploadForm button[type=submit]').click();
 while(!heldVerify)await new Promise(resolve=>setImmediate(resolve));await page.evaluate(()=>{project={...project,id:'different-film',revision:1};return controller.update();});
 heldVerify.end(JSON.stringify({...state.status,channelVerification:{status:'verified'}}));hold=false;
 await page.waitForFunction(()=>!document.querySelector('#ytUploadRefresh').disabled);assert.equal(state.calls.some(call=>call.path==='/api/youtube/upload'),false);
 await page.reload();await page.locator('#ytUploadAudience').selectOption('no');await page.locator('#ytUploadConfirm').check();await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('Quota exceeded');};});await page.locator('#ytUploadForm button[type=submit]').click();
 await page.getByRole('alert').filter({hasText:'retry protection'}).waitFor();assert.equal(state.calls.some(call=>call.path==='/api/youtube/upload'),false);assert.deepEqual(state.errors,[]);await page.evaluate(()=>controller.dispose());
});
