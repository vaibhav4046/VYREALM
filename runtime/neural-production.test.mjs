import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeWanStage, wanWorkflow, ensureWanInput } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';

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
