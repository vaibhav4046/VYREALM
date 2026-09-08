import test from 'node:test';
import assert from 'node:assert/strict';
import { createCinematicStudio } from '../cinematic-studio.js';

const hashA='a'.repeat(64),hashB='b'.repeat(64);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const job=(id='job-a',hash=hashA)=>({id,projectId:'project-a',productionRun:true,type:'generation-keyframe',status:'review_required',progress:100,createdAt:id==='job-a'?'2026-09-08T03:00:00Z':'2026-09-08T03:01:00Z',stage:'Review the casting image',output:{assets:{image:`image-${id}`},provenance:{generationStatus:'generated',mediaKind:'image',outputHash:hash,providerId:'comfyui-local',modelId:'Wan fixture model',sourceResolution:{width:1024,height:576},renderTimeMs:1000}}});

function fixture({jobs=[job()],api}={}){
  const store={project:{id:'project-a',revision:3},state:{jobs,assets:jobs.map(item=>({id:item.output.assets.image,projectId:item.projectId,kind:'image',mime:'image/png'}))}};
  const calls=[],errors=[];
  const studio=createCinematicStudio({store,api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body||'{}')});return api?api(path,options):{project:{id:'project-a',revision:4}};},refresh:async()=>{},onError:error=>errors.push(error)});
  return{store,studio,calls,errors};
}

function fakeReviewDom(t){
  const callbacks=new Map(),form={notes:'I inspected the displayed face, drape, diadem and bow.',dataset:{},querySelectorAll:()=>[],addEventListener:(type,callback)=>callbacks.set(type,callback)},cancel={disabled:false,dataset:{productionCancel:'job-a'},addEventListener:(type,callback)=>callbacks.set(`cancel:${type}`,callback)};
  let markup='';
  const node={get innerHTML(){return markup;},set innerHTML(value){markup=value;form.dataset={jobId:value.match(/data-job-id="([^"]*)"/)?.[1],outputHash:value.match(/data-output-hash="([^"]*)"/)?.[1],projectId:value.match(/data-project-id="([^"]*)"/)?.[1]};},contains:()=>true,querySelectorAll:()=>[],querySelector:selector=>selector==='#productionReview'?form:selector==='[data-production-cancel]'?cancel:null};
  const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),savedFormData=Object.getOwnPropertyDescriptor(globalThis,'FormData');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:form,querySelector:selector=>selector==='#chatProduction'?node:null}});
  Object.defineProperty(globalThis,'FormData',{configurable:true,value:class{constructor(target){this.target=target;}get(key){return key==='notes'?this.target.notes:null;}}});
  t.after(()=>{if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else delete globalThis.document;if(savedFormData)Object.defineProperty(globalThis,'FormData',savedFormData);else delete globalThis.FormData;});
  return{node,form,cancel,submit:()=>callbacks.get('submit')({preventDefault(){},submitter:{value:'passed'},currentTarget:form}),cancelClick:()=>callbacks.get('cancel:click')({currentTarget:cancel})};
}

test('the casting result is displayed as an image, not a completed trailer',()=>{
  const f=fixture(),html=f.studio.html();assert.match(html,/<img /);assert.doesNotMatch(html,/<video/);assert.match(html,/not the finished trailer/);assert.match(html,new RegExp(hashA));assert.match(html,/1024 × 576/);
});

test('production start uses the exact selected project/revision and only the original brief',async()=>{
  const f=fixture();await f.studio.start('Make an original Mahabharata trailer','story-session');assert.equal(f.calls[0].path,'/projects/project-a/production-run');assert.deepEqual(f.calls[0].body,{expectedRevision:3,brief:'Make an original Mahabharata trailer',sessionId:'story-session'});
});

test('a late production response cannot replace a different selected project',async()=>{
  const pending=deferred(),f=fixture({api:()=>pending.promise});const running=f.studio.start('Make Mahabharata');f.store.project={id:'project-b',revision:7};pending.resolve({project:{id:'project-a',revision:4}});await running;assert.equal(f.store.project.id,'project-b');assert.equal(f.store.project.revision,7);
});

test('simultaneous production starts cannot submit duplicate local generation jobs',async()=>{
  const pending=deferred(),f=fixture({api:()=>pending.promise});const first=f.studio.start('Make Mahabharata'),second=f.studio.start('Make Mahabharata').catch(()=>null);assert.equal(f.calls.length,1);pending.resolve({project:{id:'project-a',revision:4}});await Promise.all([first,second]);
});

test('a focused review never approves a newer candidate that was not displayed',async t=>{
  const dom=fakeReviewDom(t),f=fixture();dom.node.innerHTML=f.studio.html();f.studio.bind();
  f.store.state.jobs.unshift(job('job-b',hashB));f.studio.update();await dom.submit();
  assert.ok(f.calls.every(call=>call.path!=='/production-runs/job-b/review'),'The newer unseen candidate must not receive the old image review');
  if(f.calls.length){assert.equal(f.calls[0].path,'/production-runs/job-a/review');assert.equal(f.calls[0].body.expectedOutputHash,hashA);}
});

test('late review response cannot move the user back to another project',async t=>{
  const pending=deferred(),dom=fakeReviewDom(t),f=fixture({api:()=>pending.promise});dom.node.innerHTML=f.studio.html();f.studio.bind();const reviewing=dom.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.expectedOutputHash,hashA);f.store.project={id:'project-b',revision:7};pending.resolve({project:{id:'project-a',revision:4}});await reviewing;assert.equal(f.store.project.id,'project-b');
});

test('cancel sends the displayed job ID once while the request is pending',async t=>{
  const pending=deferred(),dom=fakeReviewDom(t),f=fixture({api:()=>pending.promise});f.store.state.jobs[0].status='running';dom.node.innerHTML=f.studio.html();f.studio.bind();const first=dom.cancelClick(),second=dom.cancelClick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/production-runs/job-a/cancel');pending.resolve({});await Promise.all([first,second]);
});

test('source text and provider labels are escaped in the casting panel',()=>{
  const malicious=job();malicious.stage='<script>run()</script>';malicious.output.provenance.modelId='<img onerror=run()>';const html=fixture({jobs:[malicious]}).studio.html();assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img onerror=/);
});
