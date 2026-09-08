import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { executeWanStage, wanWorkflow } from './neural-production.mjs';
import { validateKeyframeRequest } from './keyframe-production.mjs';
import { hashJson } from './generation-gate.mjs';
import { runOriginalWithReconnect, readOriginalMonitorTarget, writeOriginalWorkerFailure, readOriginalWorkerFailure, recordOriginalMonitoring } from './original-generation-monitor.mjs';
import { ORIGINAL_PROFILE, reviewedMotionWorkflow } from './reviewed-keyframe-motion.mjs';

async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-monitor-unit-')),jobRoot=path.join(directory,'owned-job');await fs.mkdir(jobRoot);
 const request=validateKeyframeRequest({projectId:'project-1',expectedRevision:2,prompt:'One original ceramic cup',seed:8,width:1024,height:576,steps:20});
 await fs.writeFile(path.join(jobRoot,'request.json'),JSON.stringify(request));
 const workflow=wanWorkflow({...request,frames:1,prefix:'vyrealm/owned-job/keyframe'}),log=path.join(jobRoot,'keyframe','provider.jsonl');
 const bytes=Buffer.alloc(256);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); // Descriptor mechanics only, never accepted visual media.
 let posts=0,polls=0,mode='recover';const urls=[];
 const history={prompt:[0,'owned-prompt',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'keyframe_00001_.png',subfolder:'vyrealm/owned-job',type:'output'}]}}};
 const provider={id:'comfyui-local',baseUrl:'http://127.0.0.1:8188',generate_video:async()=>{posts++;return{promptId:'owned-prompt'};},fetch:async url=>{
  urls.push(url);if(url.includes('/queue'))return Response.json({queue_running:[],queue_pending:[]});
  if(url.includes('/history/')){polls++;if(mode==='execution-error')return Response.json({'owned-prompt':{...history,status:{completed:true,status_str:'error',messages:['actual model error']}}});if(mode==='always-fail'||polls<=6)throw new DOMException('provider busy','TimeoutError');return Response.json({'owned-prompt':history});}
  return new Response(bytes);
 }};
 const options={jobRoot,kind:'keyframe',request,provider,runId:'00000000-0000-4000-8000-000000000001',deadlineAt:Date.now()+20000,wait:async()=>{},produce:({provider})=>executeWanStage({provider,jobRoot,stage:'keyframe',workflow,frames:1,width:1024,height:576,pollIntervalMs:0})};
 t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
 return{...options,options,workflow,log,urls,setMode:value=>mode=value,counts:()=>({posts,polls})};
}
test('six missed polls reconnect inside one operation to the exact stored prompt, retaining one output',async t=>{
 const f=await fixture(t),progress=[];const result=await runOriginalWithReconnect({...f.options,onProgress:p=>progress.push(p)});
 assert.equal(result.promptId,'owned-prompt');assert.equal(result.ledger.length,1);assert.deepEqual(f.counts(),{posts:1,polls:7});
 const events=(await fs.readFile(f.log,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(events.filter(x=>x.event==='submitted').length,1);assert.equal(events.filter(x=>x.event==='completed').length,1);
 assert.ok(progress.some(p=>p.stage.includes('Reconnecting')&&p.promptId==='owned-prompt'));
 const recovery=(await fs.readFile(path.join(f.jobRoot,'monitor-reconnect.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(recovery[0].requestHash,hashJson(f.request));assert.equal(recovery[0].workflowHash,hashJson(f.workflow));assert.equal(recovery[0].promptId,'owned-prompt');
});
test('recovery refuses missing or changed submission evidence and can never resubmit inference',async t=>{
 for(const mutation of ['remove','other-prompt','request','resubmit']){
  const f=await fixture(t);let iterations=0;const produce=async({provider})=>{iterations++;if(iterations===1)return f.options.produce({provider});if(mutation==='resubmit')return provider.generate_video({workflow:f.workflow});return f.options.produce({provider});};
  const wait=async()=>{if(mutation==='remove')await fs.unlink(f.log);if(mutation==='other-prompt')await fs.writeFile(f.log,JSON.stringify({event:'submitted',promptId:'foreign',workflowHash:hashJson(f.workflow)})+'\n');if(mutation==='request')await fs.writeFile(path.join(f.jobRoot,'request.json'),JSON.stringify({...f.request,seed:99}));};
  await assert.rejects(runOriginalWithReconnect({...f.options,produce,wait}),e=>/^ORIGINAL_(MONITOR_TARGET|RECONNECT_RESUBMISSION)/.test(e.code));assert.equal(f.counts().posts,1);
 }
});
test('explicit cancellation during reconnect does not resume or claim a result',async t=>{
 const f=await fixture(t),controller=new AbortController();
 await assert.rejects(runOriginalWithReconnect({...f.options,signal:controller.signal,wait:async()=>controller.abort()}),{code:'ORIGINAL_CANCELLED'});
 assert.deepEqual(f.counts(),{posts:1,polls:6});
});
test('persistent disconnect has a finite reconnect limit without additional provider submissions',async t=>{
 const f=await fixture(t);f.setMode('always-fail');
 await assert.rejects(runOriginalWithReconnect({...f.options,maxReconnects:2}),{code:'ORIGINAL_MONITOR_EXHAUSTED'});
 assert.deepEqual(f.counts(),{posts:1,polls:18});await assert.rejects(fs.access(path.join(f.jobRoot,'result.json')));
});
test('reconnection cannot reset the original deadline or continue a hanging producer',async t=>{
 const f=await fixture(t);let clock=1000,waited;
 await assert.rejects(runOriginalWithReconnect({...f.options,deadlineAt:1100,clock:()=>clock,wait:async ms=>{waited=ms;clock=1100;}}),{code:'ORIGINAL_TIMEOUT'});
 assert.ok(waited<=100);assert.equal(f.counts().posts,1);assert.equal(f.counts().polls,6);
 await assert.rejects(runOriginalWithReconnect({...f.options,deadlineAt:Date.now()+15,produce:async()=>new Promise(()=>{})}),{code:'ORIGINAL_TIMEOUT'});
 clock=1000;await assert.rejects(runOriginalWithReconnect({...f.options,clock:()=>clock,deadlineAt:1100,produce:async()=>{clock=1101;return{tooLate:true};}}),{code:'ORIGINAL_TIMEOUT'});
});
test('actual provider execution errors bypass reconnect',async t=>{
 const f=await fixture(t);f.setMode('execution-error');let sleeps=0;
 await assert.rejects(runOriginalWithReconnect({...f.options,wait:async()=>sleeps++}),{code:'PROVIDER_EXECUTION_FAILED'});assert.equal(sleeps,0);assert.equal(f.counts().posts,1);
});

test('monitor decoration preserves prototype upload methods and their guarded HTTP access',async t=>{
 const f=await fixture(t);let called=0;
 class Provider{constructor(){this.id='comfyui-local';this.fetch=async()=>{called++;return Response.json({ok:true});};}async upload_inputs(){return(await this.fetch('http://127.0.0.1:8188/view?type=input')).json();}}
 const result=await runOriginalWithReconnect({...f.options,provider:new Provider(),produce:({provider})=>provider.upload_inputs()});assert.deepEqual(result,{ok:true});assert.equal(called,1);
});
test('monitor target checks full owned workflow, duplicate submissions and exact request',async t=>{
 const f=await fixture(t);await runOriginalWithReconnect(f.options);const target=await readOriginalMonitorTarget(f.options);assert.equal(target.promptId,'owned-prompt');
 await fs.appendFile(f.log,JSON.stringify({event:'submitted',promptId:'different',workflowHash:hashJson(f.workflow)})+'\n');await assert.rejects(readOriginalMonitorTarget(f.options),{code:'ORIGINAL_MONITOR_TARGET'});
});
test('experimental LTX reconnect pins its tiled workflow and never submits another prompt',async t=>{
 const f=await fixture(t),request={projectId:'project-1',expectedRevision:2,keyframeJobId:'reviewed-image',expectedOutputHash:'a'.repeat(64),reviewHash:'b'.repeat(64),brief:'Original steam moves.',seed:8,motionEngine:'ltx-draft-512'},namespace='vyrealm/00000000-0000-4000-8000-000000000004',workflow=reviewedMotionWorkflow({request,imageName:'owned.png',prefix:`${namespace}/motion`});await fs.mkdir(path.join(f.jobRoot,'motion'));for(const [file,value]of [['motion-request.json',request],['generation-checkpoint.json',{namespace}],['motion/workflow.json',workflow]])await fs.writeFile(path.join(f.jobRoot,file),JSON.stringify(value));await fs.writeFile(path.join(f.jobRoot,'motion/provider.jsonl'),JSON.stringify({event:'submitted',promptId:'ltx-owned',clientId:'owned-client',workflowHash:hashJson(workflow)})+'\n');const options={...f.options,kind:'motion',request,deadlineAt:Date.now()+20*60000};let calls=0;const result=await runOriginalWithReconnect({...options,produce:async()=>{if(++calls===1)throw Object.assign(Error('Lost status'),{code:'PROVIDER_POLL_UNAVAILABLE'});return{fixture:true};}});assert.equal(result.fixture,true);assert.equal(calls,2);assert.equal(f.counts().posts,0);assert.equal((await readOriginalMonitorTarget(options)).promptId,'ltx-owned');workflow['9'].class_type='VAEDecode';await fs.writeFile(path.join(f.jobRoot,'motion/workflow.json'),JSON.stringify(workflow));await assert.rejects(readOriginalMonitorTarget(options),{code:'ORIGINAL_MONITOR_TARGET'});
});
test('structured worker errors are bound to job, request and invocation; stderr is never parsed as a recovery signal',async t=>{
 const f=await fixture(t),error=Object.assign(new Error('The monitor remained unreachable'),{code:'ORIGINAL_MONITOR_EXHAUSTED'});
 await writeOriginalWorkerFailure({...f.options,error});assert.equal((await readOriginalWorkerFailure(f.options)).code,error.code);
 assert.equal(await readOriginalWorkerFailure({...f.options,runId:'00000000-0000-4000-8000-000000000002'}),null);
 assert.equal(await readOriginalWorkerFailure({...f.options,request:{...f.request,seed:99}}),null);
 const file=path.join(f.jobRoot,'worker-error.json'),saved=JSON.parse(await fs.readFile(file,'utf8'));await fs.writeFile(file,JSON.stringify({...saved,projectId:'other'}));assert.equal(await readOriginalWorkerFailure(f.options),null);
});
test('motion recovery pins its actual image-conditioned graph and cannot follow another prompt',async t=>{
 const f=await fixture(t),kind='motion',request={projectId:'project-1',expectedRevision:2,keyframeJobId:'reviewed-image',expectedOutputHash:'a'.repeat(64),reviewHash:'b'.repeat(64),brief:'Steam moves while raindrops slide.',seed:8};
 const namespace='vyrealm/00000000-0000-4000-8000-000000000002',workflow=wanWorkflow({...ORIGINAL_PROFILE,prompt:request.brief,seed:request.seed,imageName:'owned-image.png',prefix:`${namespace}/motion`});
 await fs.writeFile(path.join(f.jobRoot,'motion-request.json'),JSON.stringify(request));await fs.writeFile(path.join(f.jobRoot,'generation-checkpoint.json'),JSON.stringify({namespace}));await fs.mkdir(path.join(f.jobRoot,'motion'));await fs.writeFile(path.join(f.jobRoot,'motion/workflow.json'),JSON.stringify(workflow));await fs.writeFile(path.join(f.jobRoot,'motion/provider.jsonl'),JSON.stringify({event:'submitted',promptId:'motion-prompt',workflowHash:hashJson(workflow)})+'\n');
 const options={...f.options,kind,request,deadlineAt:Date.now()+90*60000};let calls=0;
 await assert.rejects(runOriginalWithReconnect({...options,produce:async({provider})=>{if(++calls===1)throw Object.assign(new Error('status lost'),{code:'PROVIDER_POLL_UNAVAILABLE'});return provider.fetch('http://127.0.0.1:8188/history/foreign-prompt');}}),{code:'ORIGINAL_MONITOR_TARGET'});
 assert.equal(f.counts().posts,0);const target=await readOriginalMonitorTarget(options);assert.equal(target.promptId,'motion-prompt');assert.equal(target.workflowHash,hashJson(workflow));
});
test('reconnect statistics retain total elapsed time and never call a partial VRAM interval a full-job peak',()=>{
 const receipt={status:'review_required',validated:true,provenance:{renderTimeMs:2,vramPeakGb:3,source:{vramPeakGb:3}},diagnostics:[]},options={kind:'motion',runId:'run',startedAt:100,deadlineAt:9000,reconnects:1,finishedAt:1700};
 const result=recordOriginalMonitoring(receipt,options);assert.equal(result.monitoring.elapsedMs,1600);assert.equal(result.provenance.vramPeakGb,null);assert.equal(result.provenance.source.vramPeakGb,null);assert.equal(result.status,'review_required');assert.equal(receipt.provenance.vramPeakGb,3);
 assert.equal(recordOriginalMonitoring(receipt,{...options,kind:'keyframe'}).provenance.renderTimeMs,1600);assert.equal(recordOriginalMonitoring(receipt,{...options,reconnects:0}).provenance.vramPeakGb,3);
});
