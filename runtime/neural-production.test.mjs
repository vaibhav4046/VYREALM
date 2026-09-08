import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeWanStage, wanWorkflow, ensureWanInput } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';

test('optional bounded casting exclusions preserve the exact historical default graph',()=>{
 const original=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'});
 assert.equal(hashJson(original),'598943df6bdef166a63a6103439369312c2571b739cc9361037040c4305ca124');
 const custom=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe',negativePrompt:'beard, moustache, topknot, segmented armour'});
 assert.equal(custom['6'].inputs.text,`${original['6'].inputs.text}, beard, moustache, topknot, segmented armour`);
 assert.notEqual(hashJson(custom),hashJson(original));
 for(const negativePrompt of ['',null,[],42,'x'.repeat(2001)])assert.throws(()=>wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe',negativePrompt}),/NEURAL_NEGATIVE_PROMPT/);
});

test('provider queue progress does not claim a sampler node when only whole-graph running state is known',async()=>{
 const jobRoot=await mkdtemp(join(tmpdir(),'vyrealm-stage-label-')),workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'}),updates=[];
 const bytes=Buffer.alloc(256);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 const history={prompt:[0,'owned',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'keyframe_00001_.png',subfolder:'vyrealm/test',type:'output'}]}}};let polls=0;
 const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>({promptId:'owned'}),fetch:async url=>url.includes('/queue')?Response.json({queue_running:[[0,'owned']],queue_pending:[]}):url.includes('/history/')?Response.json(++polls===1?{}:{owned:history}):new Response(bytes)};
 await executeWanStage({provider,jobRoot,stage:'keyframe',workflow,frames:1,queuePolicy:'fifo',pollIntervalMs:0,onProgress:p=>updates.push(p)});
 assert.ok(updates.some(p=>p.providerState==='running' && p.stage.includes('text encoding, sampling or decoding')));
 assert.ok(updates.every(p=>!p.stage.includes('sampling locally')));
});

test('Windows provider descriptors are owned, retained and reused without duplicate inference',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vyrealm-stage-'));
  const workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'});
  let submitted=0;
  // Descriptor-boundary fixture only; not a playable or accepted generation.
  const bytes=Buffer.alloc(256);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const history={prompt:[0,'owned',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'keyframe_00001_.png',subfolder:'vyrealm\\test',type:'output'}]}}};
  const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>{submitted++;return{promptId:'owned'}},fetch:async url=>url.includes('/queue')?Response.json({queue_running:[],queue_pending:[]}):url.includes('/history/')?Response.json({owned:history}):new Response(bytes)};
  const options={provider,jobRoot:root,stage:'keyframe',workflow,frames:1};
  const a=await executeWanStage(options);assert.equal(a.ledger.length,1);assert.deepEqual(await readFile(join(a.stageRoot,a.ledger[0].path)),bytes);
  const offline={...provider,fetch:async()=>{throw Error('provider restarted')},generate_video:async()=>{throw Error('must not repeat inference')}};
  const recovered=await executeWanStage({...options,provider:offline});assert.equal(recovered.recovered,true);assert.equal(submitted,1,'retry should recover completed frames with no live provider');
  await assert.rejects(executeWanStage({...options,workflow:wanWorkflow({frames:1,seed:9,prefix:'vyrealm/test/keyframe'})}),e=>e.code==='STAGE_INPUT_CHANGED');
  await writeFile(join(a.stageRoot,a.ledger[0].path),Buffer.alloc(256));
  await assert.rejects(executeWanStage({...options,provider:offline}),e=>e.code==='CACHED_FRAME_CHANGED');
});

test('a submitted stage lost on provider restart fails without new inference',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vyrealm-history-')),workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'});
  await mkdir(join(root,'keyframe'));
  await writeFile(join(root,'keyframe','workflow.json'),JSON.stringify(workflow));
  await writeFile(join(root,'keyframe','provider.jsonl'),JSON.stringify({event:'submitted',promptId:'lost',workflowHash:hashJson(workflow)})+'\n');
  let posted=false;
  const provider={baseUrl:'http://127.0.0.1:8188',fetch:async url=>Response.json(url.includes('/queue')?{queue_running:[],queue_pending:[]}:{}),generate_video:async()=>{posted=true}};
  await assert.rejects(executeWanStage({provider,jobRoot:root,stage:'keyframe',workflow,frames:1}),e=>e.code==='PROVIDER_HISTORY_LOST');assert.equal(posted,false);
});

test('input upload keeps its exact graph name across retries and rejects changed bytes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vyrealm-upload-')),path=join(root,'frame.png'),bytes=Buffer.from('descriptor fixture'),expectedHash=createHash('sha256').update(bytes).digest('hex');
  await writeFile(path,bytes);let uploads=0;
  const provider={baseUrl:'http://127.0.0.1:8188',upload_inputs:async()=>{uploads++;return{uploaded:[{name:'owned.png',subfolder:'',type:'input'}]}},fetch:async()=>new Response(bytes)};
  assert.equal(await ensureWanInput({provider,jobRoot:root,path,expectedHash}),'owned.png');
  assert.equal(await ensureWanInput({provider:{},jobRoot:root,path,expectedHash}),'owned.png');assert.equal(uploads,1);
  await writeFile(path,'modified');
  await assert.rejects(ensureWanInput({provider,jobRoot:root,path,expectedHash}),e=>e.code==='REFERENCE_INTEGRITY_FAILED');
});
test('a provider output from another namespace is rejected',async()=>{
  const workflow=wanWorkflow({frames:1,prefix:'vyrealm/owned/keyframe'}),root=await mkdtemp(join(tmpdir(),'vyrealm-ownership-'));
  const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>({promptId:'owned'}),fetch:async url=>url.includes('/queue')?Response.json({}):Response.json({owned:{prompt:[0,'owned',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'keyframe_00001_.png',subfolder:'vyrealm\\different',type:'output'}]}}}})};
  await assert.rejects(executeWanStage({provider,jobRoot:root,stage:'keyframe',workflow,frames:1}),e=>e.code==='PROVIDER_OUTPUT_OWNERSHIP');
});
test('busy external provider queue is not given a competing job',async()=>{
  let posted=false;const provider={baseUrl:'http://127.0.0.1:8188',fetch:async()=>Response.json({queue_running:[[0,'other']]}),generate_video:async()=>{posted=true}};
  await assert.rejects(executeWanStage({provider,jobRoot:await mkdtemp(join(tmpdir(),'vyrealm-busy-')),stage:'keyframe',workflow:wanWorkflow({frames:1,prefix:'vyrealm/owned/keyframe'}),frames:1}),e=>e.code==='PROVIDER_BUSY');assert.equal(posted,false);
});

test('temporary history timeouts reconnect to the same inference without duplicate submission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-poll-')),workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'});
 const bytes=Buffer.alloc(256);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 let posts=0,polls=0;
 const history={prompt:[0,'owned',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'keyframe_00001_.png',subfolder:'vyrealm/test',type:'output'}]}}};
 const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>{posts++;return{promptId:'owned'}},fetch:async url=>{
  if(url.includes('/queue'))return Response.json({});
  if(url.includes('/history/')){polls++;if(polls===1)throw new DOMException('model loading','TimeoutError');if(polls===2)return new Response('',{status:503});return Response.json({owned:history});}
  return new Response(bytes);
 }};
 const result=await executeWanStage({provider,jobRoot:root,stage:'keyframe',workflow,frames:1,pollIntervalMs:0});
 assert.equal(posts,1);assert.equal(polls,3);assert.equal(result.promptId,'owned');
 const events=(await readFile(result.logPath,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(e=>e.event==='poll-retry').length,2);
 assert.ok(events.every(e=>e.promptId==='owned'));
});

test('persistent status failure is bounded and retains original submission for explicit recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-poll-fail-')),workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'});
 let posts=0,polls=0;
 const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>{posts++;return{promptId:'retained'}},fetch:async url=>{
  if(url.includes('/queue'))return Response.json({});polls++;throw new DOMException('busy','TimeoutError');
 }};
 await assert.rejects(executeWanStage({provider,jobRoot:root,stage:'keyframe',workflow,frames:1,pollIntervalMs:0}),e=>e.code==='PROVIDER_POLL_UNAVAILABLE');
 assert.equal(posts,1);assert.equal(polls,6);
 const log=await readFile(join(root,'keyframe','provider.jsonl'),'utf8');assert.match(log,/"event":"submitted","promptId":"retained"/);
});

test('waiting at a GPU boundary neither interrupts nor submits behind another provider job',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-idle-')),workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'});
 const bytes=Buffer.alloc(256);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 let queues=0,posts=0;const updates=[];
 const history={prompt:[0,'owned',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'keyframe_00001_.png',subfolder:'vyrealm/test',type:'output'}]}}};
 const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>{assert.equal(queues,2);posts++;return{promptId:'owned'}},fetch:async url=>{
  if(url.includes('/queue'))return Response.json(++queues===1?{queue_running:[[0,'external']]}:{});
  if(url.includes('/history/'))return Response.json({owned:history});
  assert.ok(url.includes('/view?'),'must never call external interrupt');return new Response(bytes);
 }};
 await executeWanStage({provider,jobRoot:root,stage:'keyframe',workflow,frames:1,pollIntervalMs:0,waitForIdle:true,onProgress:p=>updates.push(p)});
 assert.equal(posts,1);assert.equal(queues,2);assert.ok(updates.some(p=>p.stage.includes('waiting for the local GPU')));
});

test('decode accepts a VAE-only graph and explicit resources while preserving owned cache recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-decode-stage-'));
 const workflow={'3':{class_type:'VAELoader',inputs:{vae_name:'wan2.2_vae.safetensors'}},'7':{class_type:'LoadLatent',inputs:{latent:'owned.latent'}},'9':{class_type:'VAEDecodeTiled',inputs:{samples:['7',0],vae:['3',0]}},'10':{class_type:'SaveImage',inputs:{images:['9',0],filename_prefix:'vyrealm/test/decode'}}};
 const bytes=Buffer.alloc(256);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 const history={prompt:[0,'decoded',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'decode_00001_.png',subfolder:'vyrealm/test',type:'output'}]}}};let request;
 const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async value=>{request=value;return{promptId:'decoded'};},fetch:async url=>url.includes('/queue')?Response.json({queue_running:[],queue_pending:[]}):url.includes('/history/')?Response.json({decoded:history}):new Response(bytes)};
 const options={provider,jobRoot:root,stage:'decode',workflow,frames:1,width:1024,height:576,requiredModels:['wan2.2_vae.safetensors']};
 const result=await executeWanStage(options);assert.equal(result.ledger.length,1);assert.deepEqual(request.requiredModels,['wan2.2_vae.safetensors']);assert.equal(request.width,1024);assert.equal(request.height,576);
 const cached=await executeWanStage({...options,provider:{generate_video:()=>assert.fail('must not repeat decode')}});assert.equal(cached.recovered,true);
 await assert.rejects(executeWanStage({...options,width:4096}),e=>e.code==='STAGE_DIMENSIONS_OUT_OF_BOUNDS');
 await assert.rejects(executeWanStage({...options,workflow:{...workflow,'8':{class_type:'KSampler',inputs:{}}}}),e=>e.code==='DECODE_GRAPH_NOT_ISOLATED');
});

test('opt-in FIFO joins behind existing work once and reports queued position truthfully',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-fifo-')),workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'}),updates=[];
 const bytes=Buffer.alloc(256);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
 const history={prompt:[0,'owned',workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:[{filename:'keyframe_00001_.png',subfolder:'vyrealm/test',type:'output'}]}}};let posts=0,polls=0;
 const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>{posts++;return{promptId:'owned'};},fetch:async url=>{
  if(url.includes('/queue'))return Response.json({queue_running:[[0,'other']],queue_pending:posts?[[0,'before'],[1,'owned']]:[[0,'before']]});
  if(url.includes('/history/'))return Response.json(++polls===1?{}:{owned:history});
  assert.ok(url.includes('/view?'),'must not interrupt or delete external jobs');return new Response(bytes);
 }};
 await executeWanStage({provider,jobRoot:root,stage:'keyframe',workflow,frames:1,queuePolicy:'fifo',pollIntervalMs:0,onProgress:p=>updates.push(p)});
 assert.equal(posts,1);assert.ok(updates.some(p=>p.providerState==='queued'&&p.queuePosition===2));assert.ok(!updates.some(p=>p.providerState==='running'));
});

test('FIFO rejects excess queue and unbounded waits without submitting',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-fifo-cap-')),workflow=wanWorkflow({frames:1,prefix:'vyrealm/test/keyframe'});let posts=0;
 const provider={baseUrl:'http://127.0.0.1:8188',generate_video:async()=>{posts++;},fetch:async()=>Response.json({queue_running:[[0,'other']],queue_pending:Array.from({length:8},(_,i)=>[i,`external${i}`])})};
 const options={provider,jobRoot:root,stage:'keyframe',workflow,frames:1,queuePolicy:'fifo'};
 await assert.rejects(executeWanStage(options),e=>e.code==='PROVIDER_QUEUE_CAPACITY');
 await assert.rejects(executeWanStage({...options,timeoutMs:7200001}),e=>e.code==='INVALID_QUEUE_POLICY');assert.equal(posts,0);
});
