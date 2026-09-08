import test from 'node:test';
import assert from 'node:assert/strict';
import {assetMediaType,selectLibraryAssets,createAssetLibrary} from '../asset-library.js';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const projects=[{id:'p1',name:'Moonrise',latestOutput:{videoAssetId:'rejected',status:'rejected'}},{id:'p2',name:'River'}];
const assets=[{id:'v1',projectId:'p1',name:'take.mp4',mime:'video/mp4',url:'/media/v1'},{id:'v2',projectId:'p2',name:'take.mp4',mime:'video/mp4',url:'/media/v2'},{id:'v1',projectId:'p1',name:'duplicate index',mime:'video/mp4',url:'/media/v1'},{id:'json',projectId:'p1',name:'evidence.json',mime:'application/json',url:'/media/json'},{id:'rejected',projectId:'p1',jobId:'j1',name:'render.mp4',mime:'video/mp4',url:'/media/rejected'},{id:'missing',projectId:'p1',name:'Missing photo',mime:'image/png'},{id:'unsafe',projectId:'p1',name:'External',mime:'image/png',url:'https://example.com/image.png'}];
test('project media is the default; internal files need the explicit Files filter',()=>{
 const result=selectLibraryAssets({assets,projects,currentProjectId:'p1'});assert.equal(result.total,4);assert.ok(result.items.every(x=>x.asset.projectId==='p1'));assert.ok(!result.items.some(x=>x.asset.id==='json'));
 assert.deepEqual(selectLibraryAssets({assets,projects,currentProjectId:'p1',type:'files'}).items.map(x=>x.asset.id),['json']);
});
test('all projects remains explicit and duplicate names represent distinct assets',()=>{
 const result=selectLibraryAssets({assets,projects,currentProjectId:'p1',scope:'all',query:'take.mp4'});assert.equal(result.total,2);assert.deepEqual(result.items.map(x=>x.projectName),['Moonrise','River']);
 assert.equal(selectLibraryAssets({assets,projects,currentProjectId:'p1',scope:'p2'}).total,1);
});
test('missing and unsafe local URLs are shown as unavailable; rejected history stays labelled',()=>{
 const result=selectLibraryAssets({assets,projects,currentProjectId:'p1'});assert.equal(result.items.find(x=>x.asset.id==='missing').url,null);assert.equal(result.items.find(x=>x.asset.id==='unsafe').url,null);
 const rejected=result.items.find(x=>x.asset.id==='rejected');assert.equal(rejected.review,'Rejected');assert.equal(rejected.role,'Output');
 assert.equal(result.items.find(x=>x.asset.id==='v1').role,'Source');
});
test('pagination clamps after filtering and never renders the full artifact history',()=>{
 const large=Array.from({length:75},(_,i)=>({id:`a${i}`,projectId:'p1',name:`Shot ${i}`,mime:'image/png',url:`/media/a${i}`}));
 const result=selectLibraryAssets({assets:large,projects,currentProjectId:'p1',page:2});assert.equal(result.items.length,24);assert.equal(result.items[0].asset.id,'a24');assert.equal(result.pages,4);
 const last=selectLibraryAssets({assets:large,projects,currentProjectId:'p1',page:99});assert.equal(last.page,4);assert.equal(last.items.length,3);
 assert.equal(selectLibraryAssets({assets:large,projects,currentProjectId:'p1',query:'not found',page:4}).page,1);
});
test('types use MIME and keep captions/quality artifacts out of media; no project does not invent assets',()=>{
 assert.equal(assetMediaType({mime:'text/plain',kind:'captions'}),'files');assert.equal(assetMediaType({mime:'image/png',kind:'poster'}),'image');assert.equal(assetMediaType({mime:'audio/wav'}),'audio');
 assert.equal(selectLibraryAssets({assets:[],projects:[]}).total,0);
});
test('HTML escapes names and exposes search/scope/type, page controls and native dialog',()=>{
 const store={project:projects[0],state:{projects,assets:[{...assets[0],name:'<img onerror=alert(1)>'}],jobs:[]}};const controller=createAssetLibrary({store});const html=controller.html();
 assert.match(html,/id="alSearch"/);assert.match(html,/id="alScope"/);assert.match(html,/id="alType"/);assert.match(html,/<dialog/);assert.ok(!html.includes('<img onerror='));assert.match(html,/&lt;img onerror=alert\(1\)&gt;/);controller.dispose();
});
test('real browser previews source media, closes with Escape, keeps filters, and resets scope when project changes',async t=>{
 const source=await readFile(new URL('../work/demo-source/running-stream.webm',import.meta.url));
 const fixture={project:projects[0],state:{projects,jobs:[],assets:[{id:'video',name:'River take',projectId:'p1',mime:'video/webm',url:'/media/video',size:source.length},{id:'photo',name:'Reference',projectId:'p1',mime:'image/svg+xml',url:'/media/photo'},{id:'document',name:'notes.json',projectId:'p1',mime:'application/json',url:'/media/document'},{id:'other',name:'River take',projectId:'p2',mime:'video/webm',url:'/media/video'}]}};
 const script=await readFile(new URL('../asset-library.js',import.meta.url)),css=await readFile(new URL('../asset-library.css',import.meta.url));
 const server=createServer((req,res)=>{const resources={'/asset-library.js':['text/javascript',script],'/asset-library.css':['text/css',css],'/media/video':['video/webm',source],'/media/photo':['image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="#30576c"/><text x="40" y="100" fill="white" font-size="30">Reference fixture</text></svg>'],'/media/document':['application/json','{}']};const resource=resources[req.url];if(resource){res.writeHead(200,{'Content-Type':resource[0]});return res.end(resource[1]);}res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#0b0c10;color:#eee;font-family:Arial}button,a{font-family:inherit}.btn{color:#eee;background:#252532;border:1px solid #434352;padding:10px;border-radius:7px;cursor:pointer}h1{font-weight:500}</style><link rel="stylesheet" href="/asset-library.css"><div id="fixture"></div><script type="module">import {createAssetLibrary} from '/asset-library.js';window.store=${JSON.stringify(fixture)};window.imports=0;window.controller=createAssetLibrary({store,onImport:()=>window.imports++});window.redraw=()=>{controller.dispose();document.querySelector('#fixture').innerHTML=controller.html();controller.bind();};redraw();</script>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1100,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#alSearch').waitFor();
 assert.equal(await page.locator('.al-card').count(),2);await page.getByRole('button',{name:'Import media ↗'}).click();assert.equal(await page.evaluate(()=>window.imports),1);
 await page.locator('[data-al-open="video"]').click();assert.equal(await page.locator('#alPreview').evaluate(d=>d.open),true);await page.locator('#alPreviewBody video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('#alPreviewBody video')?.currentTime>.1);assert.ok(await page.locator('#alPreviewBody video').evaluate(v=>v.videoWidth>0));await page.keyboard.press('Escape');assert.equal(await page.locator('#alPreview').evaluate(d=>d.open),false);assert.equal(await page.locator('[data-al-open="video"]').evaluate(b=>b===document.activeElement),true);assert.equal(await page.locator('#alPreviewBody video').count(),0);
 await page.locator('#alSearch').fill('River');await page.locator('#alScope').selectOption('all');assert.equal(await page.locator('.al-card').count(),2);await page.evaluate(()=>window.redraw());assert.equal(await page.locator('#alSearch').inputValue(),'River');assert.equal(await page.locator('#alScope').inputValue(),'all');
 await page.evaluate(()=>{window.store.project=window.store.state.projects[1];window.controller.update();});assert.equal(await page.locator('#alScope').inputValue(),'current');assert.equal(await page.locator('#alSearch').inputValue(),'');assert.equal(await page.locator('.al-card').count(),1);
 await page.evaluate(()=>{window.store.project=window.store.state.projects[0];window.controller.update();});await page.locator('#alType').selectOption('files');assert.equal(await page.locator('.al-card').count(),1);await page.locator('[data-al-open="document"]').click();assert.equal(await page.locator('#alPreview iframe,#alPreview script').count(),0);await page.keyboard.press('Escape');
 await page.locator('#alType').selectOption('media');await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#alSearch').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const proof=path.resolve('work/ui-quality-audit-2026-09-08/asset-library-fixture');await mkdir(proof,{recursive:true});await page.screenshot({path:path.join(proof,'mobile.png'),fullPage:true});await page.setViewportSize({width:1100,height:800});await page.screenshot({path:path.join(proof,'desktop.png'),fullPage:true});await writeFile(path.join(proof,'evidence.json'),JSON.stringify({scope:'Isolated UI fixture with real local WebM; no canonical writes',errors,checks:['source video plays','Escape closes and returns focus','filter persistence','project reset','files not executed','mobile search visible','no horizontal overflow']},null,2));assert.deepEqual(errors,[]);
});
