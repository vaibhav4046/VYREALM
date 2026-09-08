import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { TOOL_DEFINITIONS, dispatchTool, createLocalApi, ToolError } from './automation-tools.mjs';
import { WAN_MODELS } from './neural-production.mjs';
import { LTX_MODELS } from './ltx-production.mjs';

const names=['generate_original_keyframe','inspect_original_generation','review_original_keyframe','animate_original_keyframe','retry_original_generation','cancel_original_generation'];
const H='a'.repeat(64),E='b'.repeat(64),W='c'.repeat(64);
const base={projectId:'project-1',expectedRevision:3},direction={...base,brief:'An original ceramic cup with curling steam beside a rainy window.',seed:12,negativePrompt:'letters, logos'};
function state(status='review_required',kind='keyframe'){
 const output={validated:true,verification:{ok:true},sourceMethod:'local-generated-keyframe',assets:{image:'image-1'},provenance:{providerId:'comfyui-local',modelId:'Wan-test-fixture',generationStatus:'generated',mediaKind:'image',workflowHash:W,evidenceHash:E,outputHash:H},review:status==='succeeded'?{verdict:'passed',notes:'Inspected this exact still.',outputHash:H,evidenceHash:E,mediaKind:'image',reviewer:'operator-visual-review'}:undefined};
 const image={id:'still-1',projectId:base.projectId,revision:2,type:'generation-keyframe',stageKind:'keyframe',status,output:['queued','running','failed','blocked','cancelled'].includes(status)?null:output};
 const value={project:{id:base.projectId,revision:3,brief:'Project description stays separate',originalGeneration:{keyframeJobId:image.id,motionJobId:null,brief:direction.brief}},job:image,keyframeJob:image,motionJob:null,profile:{width:1024,height:576,frames:121,fps:24,durationSeconds:5}};
 if(kind==='motion'){
  image.status='succeeded';image.output={...output,review:{verdict:'passed',notes:'Inspected the fixture only.',outputHash:H,evidenceHash:E,mediaKind:'image',reviewer:'operator-visual-review'}};
  const p={...output.provenance,modelId:WAN_MODELS.diffusion,mediaKind:undefined,outputHash:'d'.repeat(64),sourceHash:H,source:{...output.provenance,modelId:WAN_MODELS.diffusion,outputHash:H,resolution:{width:1024,height:576}},resolution:{width:1024,height:576},deliveryResolution:{width:1920,height:1080},deliveryMethod:'1080p-lanczos-from-1024x576'};
  value.job=value.motionJob={id:'motion-1',projectId:base.projectId,revision:3,type:'generation-shot',stageKind:'motion',status,output:['queued','running'].includes(status)?null:{...output,sourceMethod:'local-wan22-gguf',assets:{sourceVideo:'source-1',video:'delivery-1',poster:'sheet-1'},provenance:p}};
  value.project.originalGeneration.motionJobId='motion-1';
 }
 return value;
}
function fake(before=state(),after=before){const calls=[];return{calls,api:async(path,method='GET',body)=>{calls.push({path,method,body});if(method==='POST')return typeof after==='function'?after(path,body):after;return path.endsWith('/original-generation')?before:before.project;}};}

test('six strict tools are discoverable and the old smoke test stays a diagnostic',()=>{
 for(const name of names){const d=TOOL_DEFINITIONS.find(x=>x.name===name);assert.ok(d,name);assert.equal(d.inputSchema.additionalProperties,false);}
 assert.equal(new Set(TOOL_DEFINITIONS.map(x=>x.name)).size,TOOL_DEFINITIONS.length);
 assert.match(TOOL_DEFINITIONS.find(x=>x.name==='run_generation_test').description,/diagnostic/i);
 assert.match(TOOL_DEFINITIONS.find(x=>x.name==='review_original_keyframe').description,/operator|user/i);
});
test('keyframe admission preserves exact original prompt, seed and checked revision without claiming media',async()=>{
 const queued=state('queued');queued.project.revision=4;queued.job.revision=4;const f=fake(state(),queued);
 const r=await dispatchTool(names[0],direction,f);
 assert.equal(r.status,'queued');assert.equal(r.verification.status,'not-run');assert.deepEqual(r.outputPaths,[]);assert.equal(r.metadata.nextTool,names[1]);assert.equal(r.metadata.generatedVideo,false);
 assert.deepEqual(f.calls.at(-1),{path:'/api/projects/project-1/original-generation',method:'POST',body:{expectedRevision:3,brief:direction.brief,seed:12,negativePrompt:'letters, logos'}});
 assert.equal(r.reproducibility.revision,4);
});
test('invalid fields, path IDs, whitespace, noninteger seeds and bad review hashes cannot reach the API',async()=>{
 const review={...base,jobId:'still-1',expectedOutputHash:H,verdict:'passed',notes:'Explicit operator inspection of this still.'};let calls=0;
 const bad=[[names[0],{...direction,referencePath:'C:/outside.png'}],[names[0],{...direction,projectId:'../outside'}],[names[0],{...direction,brief:'   '}],[names[0],{...direction,seed:.5}],[names[0],{...direction,negativePrompt:'\t'}],[names[2],{...review,expectedOutputHash:'bad'}],[names[2],{...review,verdict:'approved'}],[names[2],{...review,notes:' '}],[names[3],{...base,keyframeJobId:'x/y',expectedOutputHash:H}],[names[5],{projectId:'project-1',jobId:'still-1',force:true}]];
 for(const [name,args] of bad){const r=await dispatchTool(name,args,{api:async()=>calls++});assert.equal(r.status,'failed');assert.equal(r.diagnostics[0].code,'INVALID_INPUT');}
 assert.equal(calls,0);
});
test('stale project and cross-project responses cannot admit or control inference',async()=>{
 const f=fake(state());const r=await dispatchTool(names[0],{...direction,expectedRevision:2},f);assert.equal(r.diagnostics[0].code,'REVISION_CONFLICT');assert.equal(f.calls.length,1);
 const wrong=state();wrong.keyframeJob.projectId='other';const g=fake(wrong);const c=await dispatchTool(names[5],{projectId:'project-1',jobId:'still-1'},g);assert.equal(c.status,'failed');assert.ok(g.calls.every(x=>x.method==='GET'));
 const foreign=fake({...state(),project:{id:'other',revision:3}});assert.equal((await dispatchTool(names[0],direction,foreign)).status,'failed');assert.equal(foreign.calls.length,1);
});
test('operator review forwards the exact hash, verdict and notes and never starts animation',async()=>{
 for(const verdict of ['passed','rejected']){
  const before=state(),after=state(verdict==='passed'?'succeeded':'rejected');after.project.revision=4;after.keyframeJob.output.review={...state('succeeded').keyframeJob.output.review,verdict,notes:'Operator inspected ceramic texture, steam and composition.'};
  const args={...base,jobId:'still-1',expectedOutputHash:H,verdict,notes:after.keyframeJob.output.review.notes},f=fake(before,after),r=await dispatchTool(names[2],args,f);
  assert.equal(r.status,verdict==='passed'?'succeeded':'rejected');assert.equal(r.metadata.generatedVideo,false);assert.equal(r.metadata.animationStarted,false);assert.deepEqual(r.metadata.review,after.keyframeJob.output.review);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
  assert.deepEqual(f.calls.at(-1),{path:'/api/original-generation/still-1/review',method:'POST',body:{...base,expectedOutputHash:H,verdict,notes:args.notes}});
 }
});
test('review rejects a mismatched persisted hash, verdict or returned note',async()=>{
 const args={...base,jobId:'still-1',expectedOutputHash:H,verdict:'passed',notes:'Operator checked this exact image.'};
 for(const patch of [{outputHash:E},{verdict:'rejected'},{notes:'Invented automatic approval'}]){const after=state('succeeded');after.project.revision=4;after.job.output.review={...after.job.output.review,notes:args.notes,...patch};const r=await dispatchTool(names[2],args,fake(state(),after));assert.equal(r.status,'failed');assert.equal(r.diagnostics[0].code,'ORIGINAL_RECEIPT_MISMATCH');}
});
test('animate is a separate admission using an exact reviewed local still, not an imported path',async()=>{
 const after=state('queued','motion');after.project.revision=4;after.job.revision=4;const f=fake(state('succeeded'),after),args={...base,keyframeJobId:'still-1',expectedOutputHash:H,brief:'Steam curls upward while raindrops slide down the window.',seed:14};
 const r=await dispatchTool(names[3],args,f);assert.equal(r.status,'queued');assert.equal(r.metadata.generatedVideo,false);assert.equal(r.verification.status,'not-run');assert.deepEqual(f.calls.at(-1),{path:'/api/original-generation/still-1/animate',method:'POST',body:{...base,expectedOutputHash:H,brief:args.brief,seed:14}});
});
test('MCP explicitly forwards the experimental LTX choice and rejects unknown engines before admission',async()=>{
 const after=state('queued','motion');after.project.revision=4;after.job.revision=4;after.job.motionEngine='ltx-draft-512';
 const args={...base,keyframeJobId:'still-1',expectedOutputHash:H,motionEngine:'ltx-draft-512'},f=fake(state('succeeded'),after);
 const result=await dispatchTool(names[3],args,f);assert.equal(result.status,'queued');assert.equal(result.metadata.generatedVideo,false);
 assert.deepEqual(f.calls.at(-1),{path:'/api/original-generation/still-1/animate',method:'POST',body:{...base,expectedOutputHash:H,motionEngine:'ltx-draft-512'}});
 const invalid=fake(state('succeeded'),after),rejected=await dispatchTool(names[3],{...args,motionEngine:'cloud'},invalid);
 assert.equal(rejected.status,'failed');assert.equal(invalid.calls.length,0);
 after.job.motionEngine='wan';const substituted=await dispatchTool(names[3],args,fake(state('succeeded'),after));assert.equal(substituted.status,'failed');assert.equal(substituted.diagnostics[0].code,'ORIGINAL_RECEIPT_MISMATCH');
});

test('completed LTX motion preserves its experimental source receipt and stays pending visual review',async()=>{
 const s=state('review_required','motion');s.job.motionEngine='ltx-draft-512';s.job.output.sourceMethod='local-ltx098-distilled-gguf';
 const p=s.job.output.provenance;p.modelId=LTX_MODELS.diffusion;p.source.modelId=LTX_MODELS.diffusion;p.source.resolution={width:512,height:288};p.resolution={width:512,height:288};p.deliveryMethod='1080p-lanczos-from-512x288';
 const r=await dispatchTool(names[1],{projectId:'project-1'},fake(s));
 assert.equal(r.status,'review_required');assert.equal(r.metadata.generatedVideo,true);assert.deepEqual(r.metadata.provenance,p);assert.equal(r.verification.visualRealismEvaluated,false);assert.equal(r.metadata.review,null);
 for(const mutate of [x=>delete x.job.motionEngine,x=>x.job.motionEngine='unknown',x=>x.job.output.sourceMethod='local-wan22-gguf',x=>x.job.output.provenance.modelId=WAN_MODELS.diffusion,x=>x.job.output.provenance.source.modelId=WAN_MODELS.diffusion,x=>x.job.output.provenance.source.providerId='imported',x=>x.job.output.provenance.sourceHash=E]){
  const bad=structuredClone(s);mutate(bad);const rejected=await dispatchTool(names[1],{projectId:'project-1'},fake(bad));assert.equal(rejected.status,'failed');assert.equal(rejected.diagnostics[0].code,'ORIGINAL_RECEIPT_MISMATCH');
 }
});

test('inspection preserves actual generated source versus upscaled delivery and requires motion review',async()=>{
 const s=state('review_required','motion'),r=await dispatchTool(names[1],{projectId:'project-1'},fake(s));
 assert.equal(r.status,'review_required');assert.equal(r.metadata.mediaKind,'video');assert.equal(r.metadata.generatedVideo,true);assert.deepEqual(r.metadata.provenance,s.job.output.provenance);assert.equal(r.verification.kind,'worker-media-verification');assert.equal(r.verification.visualRealismEvaluated,false);assert.equal(r.metadata.nextTool,'inspect_original_generation');assert.match(r.diagnostics.map(d=>d.message).join(' '),/review/i);
 assert.deepEqual(r.metadata.assets,{sourceVideo:'source-1',video:'delivery-1',poster:'sheet-1'});
});
test('inspection distinguishes no job, still review, failed, blocked and cancelled jobs',async()=>{
 const empty={...state(),job:null,keyframeJob:null,motionJob:null};empty.project.originalGeneration={};
 assert.equal((await dispatchTool(names[1],{projectId:'project-1'},fake(empty))).status,'not_started');
 for(const status of ['review_required','failed','blocked','cancelled']){const s=state(status);if(status==='failed')s.job.error='Provider output is missing';const r=await dispatchTool(names[1],{projectId:'project-1'},fake(s));assert.equal(r.status,status);assert.equal(r.metadata.generatedVideo,false);if(status==='failed')assert.match(r.diagnostics.map(d=>d.message).join(' '),/Provider output is missing/);}
});
test('success or review status without a generated-media receipt is refused',async()=>{
 for(const change of [s=>{s.job.output=null;},s=>{s.job.output.verification.ok=false;},s=>{s.job.output.provenance.generationStatus='imported';},s=>{s.job.output.assets={};},s=>{s.job.output.provenance.outputHash='invalid';}]){const s=state('succeeded');change(s);const r=await dispatchTool(names[1],{projectId:'project-1'},fake(s));assert.equal(r.status,'failed');assert.equal(r.diagnostics[0].code,'ORIGINAL_RECEIPT_MISMATCH');}
 const s=state('succeeded');delete s.job.output.review;assert.equal((await dispatchTool(names[1],{projectId:'project-1'},fake(s))).status,'review_required');
});
test('retry and cancel use reserved service controls and validate returned job ownership',async()=>{
 const queued=state('queued');queued.job.revision=3;const r=await dispatchTool(names[4],{...base,jobId:'still-1'},fake(state('failed'),queued));assert.equal(r.status,'queued');assert.equal(r.verification.status,'not-run');
 const before=state('running'),cancelled={...before.job,status:'cancelling'},f=fake(before,{job:cancelled});const c=await dispatchTool(names[5],{projectId:'project-1',jobId:'still-1'},f);assert.equal(c.status,'cancelling');assert.deepEqual(f.calls.at(-1),{path:'/api/original-generation/still-1/cancel',method:'POST',body:{}});
 const foreign=fake(before,{job:{...cancelled,projectId:'other'}});assert.equal((await dispatchTool(names[5],{projectId:'project-1',jobId:'still-1'},foreign)).status,'failed');
 const wrongJob=fake(before,{job:{...cancelled,id:'different-same-project'}});assert.equal((await dispatchTool(names[5],{projectId:'project-1',jobId:'still-1'},wrongJob)).status,'failed');
});
test('backend revision, rejection and provider errors retain their actionable codes',async()=>{
 for(const code of ['ORIGINAL_REVISION_CONFLICT','ORIGINAL_REVIEW_REQUIRED','ORIGINAL_REJECTED_REFERENCE','ORIGINAL_PROVIDER_BLOCKED']){
  const f=fake(state('succeeded'),()=>{throw new ToolError(code,'Exact backend diagnostic',{stage:'keyframe'});});const r=await dispatchTool(names[3],{...base,keyframeJobId:'still-1',expectedOutputHash:H},f);assert.equal(r.status,'failed');assert.deepEqual(r.diagnostics[0],{code,message:'Exact backend diagnostic',details:{stage:'keyframe'}});
 }
});

test('stdio MCP uses authenticated loopback HTTP and returns pending/review receipts with no GPU',async t=>{
 const calls=[],s=state('queued');s.project.revision=4;s.job.revision=4;
 const server=createServer(async(req,res)=>{let bytes='';for await(const chunk of req)bytes+=chunk;calls.push({url:req.url,method:req.method,token:req.headers['x-vyrelum-token'],body:bytes?JSON.parse(bytes):undefined});res.setHeader('content-type','application/json');if(req.url==='/api/session')return res.end(JSON.stringify({token:'isolated-fixture-session'}));if(req.headers['x-vyrelum-token']!=='isolated-fixture-session'){res.statusCode=401;return res.end('{}');}if(req.url==='/api/projects/project-1')return res.end(JSON.stringify({...s.project,revision:3}));if(req.url==='/api/projects/project-1/original-generation')return res.end(JSON.stringify(s));res.statusCode=409;res.end(JSON.stringify({code:'ORIGINAL_REVIEW_REQUIRED',error:'The exact still needs operator review'}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');const baseUrl=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(process.execPath,['mcp-server.mjs'],{cwd:new URL('..',import.meta.url),windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,VYREALM_API:baseUrl}});const pending=new Map(),reader=createInterface({input:child.stdout});let stderr='';child.stderr.on('data',c=>stderr+=c);reader.on('line',line=>{const result=JSON.parse(line);pending.get(result.id)?.(result);pending.delete(result.id);});
 t.after(async()=>{reader.close();child.stdin.end();if(child.exitCode===null){child.kill();await once(child,'close');}await new Promise(r=>server.close(r));});
 let next=0;function rpc(method,params){const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`MCP response timeout: ${stderr}`)),10000);pending.set(id,result=>{clearTimeout(timer);resolve(result);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 const listed=await rpc('tools/list',{});for(const name of names)assert.ok(listed.result.tools.some(x=>x.name===name));
 const admission=await rpc('tools/call',{name:names[0],arguments:direction}),r=JSON.parse(admission.result.content[0].text);assert.equal(r.status,'queued');assert.equal(admission.result.isError,false);assert.equal(r.metadata.generatedVideo,false);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 Object.assign(s,state('review_required'));
 const inspected=await rpc('tools/call',{name:names[1],arguments:{projectId:'project-1'}});assert.equal(inspected.result.isError,true);assert.equal(JSON.parse(inspected.result.content[0].text).status,'review_required');
 const denied=await rpc('tools/call',{name:names[3],arguments:{...base,keyframeJobId:'still-1',expectedOutputHash:H}});assert.equal(denied.result.isError,true);assert.equal(JSON.parse(denied.result.content[0].text).diagnostics[0].code,'ORIGINAL_REVIEW_REQUIRED');
 const api=createLocalApi({base:baseUrl});await assert.rejects(api('/api/original-generation/still-1/animate','POST',{}),{code:'ORIGINAL_REVIEW_REQUIRED'});
 assert.ok(calls.filter(c=>c.url!=='/api/session').every(c=>c.token==='isolated-fixture-session'));
});
