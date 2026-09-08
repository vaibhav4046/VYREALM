import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginalProgressListener, createOriginalProgressBridge } from './original-generation-progress.mjs';
import { wanWorkflow } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateKeyframeRequest } from './keyframe-production.mjs';
import { ltxWorkflow } from './ltx-production.mjs';

class Socket extends EventTarget {
 static instances=[];
 constructor(url){super();this.url=url;this.closed=0;Socket.instances.push(this);}
 close(){this.closed++;}
 send(){assert.fail('A progress listener must never send messages or submit work');}
 event(type,data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type,data})}));}
}
function fixture(t,extra={}){
 const timers=new Map();let next=0,now=1000;const progress=[],telemetry=[];
 Socket.instances=[];
 const workflow=wanWorkflow({prompt:'Original ceramic tea cup',prefix:'vyrealm/owned/motion',frames:121,steps:20,width:1024,height:576});
 const target={promptId:'owned-prompt',clientId:'owned-client',workflowHash:hashJson(workflow)};
 const options={baseUrl:'http://127.0.0.1:8188',kind:'motion',target,workflow,deadlineAt:9000,clock:()=>now,WebSocketImpl:Socket,onProgress:e=>progress.push(e),onTelemetry:e=>telemetry.push(e),setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id),...extra};
 const listener=createOriginalProgressListener(options);t.after(()=>listener.close());
 return{...options,listener,progress,telemetry,timers,setNow:n=>now=n,socket:()=>Socket.instances.at(-1),fire:ms=>{for(const[id,item]of timers){if(item.ms===ms){timers.delete(id);item.fn();return;}}assert.fail(`No ${ms}ms timer`);}};
}

test('only exact owned prompt and known graph nodes update real sampler/decode stage',t=>{
 const f=fixture(t),s=f.socket();assert.equal(new URL(s.url).searchParams.get('clientId'),'owned-client');
 s.event('executing',{node:'8'});s.event('progress',{prompt_id:'foreign',node:'8',value:8,max:20});s.event('progress',{prompt_id:'owned-prompt',node:'999',value:8,max:20});
 assert.equal(f.progress.length,0);
 s.event('executing',{prompt_id:'owned-prompt',node:'5'});s.event('progress',{prompt_id:'owned-prompt',node:'8',value:4,max:20});
 assert.match(f.progress.at(-1).stage,/4\/20/);assert.equal(f.progress.at(-1).samplerStep,4);assert.equal(f.progress.at(-1).progressBasis,'pipeline-stage');
 s.event('executing',{prompt_id:'owned-prompt',node:'9'});assert.match(f.progress.at(-1).stage,/Decoding/);assert.ok(f.progress.at(-1).progress<1);
 const count=f.progress.length;s.event('progress',{prompt_id:'owned-prompt',node:'8',value:3,max:20});assert.equal(f.progress.length,count,'late sampling events cannot regress a decoder stage');
 s.event('progress',{prompt_id:'owned-prompt',node:'9',value:1,max:32});assert.match(f.progress.at(-1).stage,/1\/32 units/);assert.doesNotMatch(f.progress.at(-1).stage,/frames/);
});
test('experimental LTX progress uses its eight-step scheduler and keeps tiled decode units honest',t=>{
 const workflow=ltxWorkflow({prompt:'Original steam moves',imageName:'owned.png',prefix:'vyrealm/owned/motion',profile:'draft-512',tiledDecode:true}),f=fixture(t,{workflow,target:{promptId:'owned-prompt',clientId:'owned-client',workflowHash:hashJson(workflow)}}),s=f.socket();
 s.event('executing',{prompt_id:'owned-prompt',node:'7'});assert.match(f.progress.at(-1).stage,/image-conditioned/);s.event('progress',{prompt_id:'owned-prompt',node:'8',value:4,max:8});assert.equal(f.progress.at(-1).samplerSteps,8);assert.match(f.progress.at(-1).stage,/4\/8/);const count=f.progress.length;s.event('progress',{prompt_id:'owned-prompt',node:'8',value:5,max:20});assert.equal(f.progress.length,count);s.event('progress',{prompt_id:'owned-prompt',node:'9',value:2,max:5});assert.match(f.progress.at(-1).stage,/2\/5 units/);assert.doesNotMatch(f.progress.at(-1).stage,/frames/);
});

test('malformed, binary, oversized and incompatible sampler counters are ignored',t=>{
 const f=fixture(t),s=f.socket();
 for(const data of ['{',Buffer.alloc(12),'x'.repeat(65537)])s.dispatchEvent(new MessageEvent('message',{data}));
 for(const [value,max]of [[-1,20],[21,20],[3,0],[1,1000001],[1.5,20],[1,30],['1',20]])s.event('progress',{prompt_id:'owned-prompt',node:'8',value,max});
 assert.equal(f.progress.length,0);
});

test('saving a latent before pixel decoding cannot hide the later expensive decode stage',t=>{
 const f=fixture(t),s=f.socket();s.event('executing',{prompt_id:'owned-prompt',node:'12'});assert.match(f.progress.at(-1).stage,/latent checkpoint/);
 s.event('executing',{prompt_id:'owned-prompt',node:'9'});assert.match(f.progress.at(-1).stage,/Decoding/);
});

test('socket terminal events never declare completed generation, and foreign terminals do not close it',t=>{
 const f=fixture(t),s=f.socket();s.event('execution_success',{prompt_id:'foreign'});assert.equal(s.closed,0);
 s.event('execution_success',{prompt_id:'owned-prompt'});assert.equal(s.closed,1);assert.match(f.progress.at(-1).stage,/Verifying/);assert.ok(f.progress.at(-1).progress<1);assert.equal(f.progress.at(-1).completed,undefined);
 assert.equal(f.timers.size,0);s.event('progress',{prompt_id:'owned-prompt',node:'8',value:20,max:20});assert.equal(f.progress.length,1);
});

test('disconnect reconnects only its recorded client, bounded and without changing deadline or submitting',t=>{
 const f=fixture(t,{deadlineAt:200000,maxReconnects:2});
 f.socket().dispatchEvent(new Event('close'));assert.match(f.progress.at(-1).stage,/unavailable/);f.fire(15000);
 assert.equal(Socket.instances.length,2);assert.equal(f.socket().url,Socket.instances[0].url);
 f.socket().dispatchEvent(new Event('error'));f.socket().dispatchEvent(new Event('close'));f.fire(30000);
 assert.equal(Socket.instances.length,3);f.socket().dispatchEvent(new Event('close'));assert.equal(f.timers.size,0);assert.match(f.progress.at(-1).stage,/HTTP status/);
});

test('explicit cancellation closes pending sockets and all timers; expired deadline cannot reconnect',t=>{
 const abort=new AbortController(),f=fixture(t,{signal:abort.signal,deadlineAt:200000});f.socket().dispatchEvent(new Event('close'));abort.abort();assert.equal(f.timers.size,0);assert.equal(Socket.instances.length,1);
 const g=fixture(t);g.setNow(9000);g.socket().dispatchEvent(new Event('error'));assert.equal(g.timers.size,0);assert.equal(Socket.instances.length,1);
});

test('socket open timeout is bounded, and callbacks cannot fail the generation worker',t=>{
 const f=fixture(t,{deadlineAt:200000,onProgress:()=>{throw Error('consumer failed');},onTelemetry:()=>{throw Error('disk full');}});f.fire(10000);assert.equal(f.socket().closed,1);f.fire(15000);f.socket().event('progress',{prompt_id:'owned-prompt',node:'8',value:2,max:20});
});

test('remote endpoints, tampered graph and absent legacy client identity cannot open a websocket',t=>{
 const f=fixture(t);f.listener.close();const before=Socket.instances.length;
 for(const extra of [{baseUrl:'http://example.com'},{target:{...f.target,workflowHash:'a'.repeat(64)}},{target:{...f.target,clientId:undefined}}])assert.throws(()=>createOriginalProgressListener({...f,...extra}),{code:'ORIGINAL_PROGRESS_INPUT'});
 assert.equal(Socket.instances.length,before);
});

test('bridge starts only from exact durable submission and preserves class provider methods',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-progress-unit-')),jobRoot=path.join(directory,'owned');await fs.mkdir(path.join(jobRoot,'keyframe'),{recursive:true});
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const request=validateKeyframeRequest({projectId:'p',expectedRevision:1,prompt:'Original handmade tea cup',width:1024,height:576,steps:20,seed:8}),workflow=wanWorkflow({...request,frames:1,prefix:'vyrealm/owned/keyframe'});
 await fs.writeFile(path.join(jobRoot,'request.json'),JSON.stringify(request));await fs.writeFile(path.join(jobRoot,'keyframe/workflow.json'),JSON.stringify(workflow));
 const target={event:'submitted',promptId:'owned-prompt',clientId:'owned-client',workflowHash:hashJson(workflow)};await fs.writeFile(path.join(jobRoot,'keyframe/provider.jsonl'),JSON.stringify(target)+'\n');
 let fetched=0,created=0,closed=0,emit;const progress=[];
 class Provider {constructor(){this.id='comfyui-local';this.baseUrl='http://127.0.0.1:8188';this.fetch=async()=>{fetched++;return Response.json({});};}upload_inputs(){return{inherited:true};}generate_video(){assert.fail('No submission from telemetry');}}
 const bridge=createOriginalProgressBridge({provider:new Provider(),jobRoot,kind:'keyframe',request,deadlineAt:Date.now()+10000,onProgress:e=>progress.push(e),listenerFactory:options=>{created++;emit=options.onProgress;assert.equal(options.target.promptId,'owned-prompt');return{close:()=>closed++};}});t.after(()=>bridge.close());
 assert.deepEqual(bridge.provider.upload_inputs(),{inherited:true});await bridge.provider.fetch('http://127.0.0.1:8188/queue');assert.equal(created,0);
 await bridge.provider.fetch('http://127.0.0.1:8188/history/foreign');assert.equal(created,0);
 await Promise.all([bridge.provider.fetch('http://127.0.0.1:8188/history/owned-prompt'),bridge.provider.fetch('http://127.0.0.1:8188/history/owned-prompt')]);assert.equal(created,1);assert.equal(fetched,4);
 emit({stage:'Sampling locally: 6/20 steps',progress:0.4,progressBasis:'pipeline-stage'});bridge.progress({stage:'keyframe: provider processing (text encoding, sampling or decoding)',elapsedSeconds:100});assert.match(progress.at(-1).stage,/6\/20/);assert.equal(progress.at(-1).elapsedSeconds,100);
 bridge.progress({stage:'Encoding and checking generated frames',progress:0.85});assert.match(progress.at(-1).stage,/Encoding/);await bridge.close();assert.equal(closed,1);
});
