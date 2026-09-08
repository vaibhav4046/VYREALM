import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { wanWorkflow } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';
import { WAN_TILED_DECODE_CANDIDATE as profile,buildWanDecodeWorkflow,inspectLatentHeader,validateOwnedLatentSource,stageOwnedLatent,within } from './decode-profiles.mjs';

const sourceJobId='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222',namespace='vyrealm/33333333-3333-4333-8333-333333333333';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function latentBytes(workflow){const size=1*48*31*36*64*4,header=Buffer.from(JSON.stringify({__metadata__:{prompt:JSON.stringify(workflow)},latent_tensor:{dtype:'F32',shape:[1,48,31,36,64],data_offsets:[0,size]},latent_format_version_0:{dtype:'F32',shape:[0],data_offsets:[size,size]}}));const bytes=Buffer.alloc(8+header.length+size);bytes.writeBigUInt64LE(BigInt(header.length));header.copy(bytes,8);return bytes;}
async function fixture(t){
 const tempRoot=await realpath(tmpdir()),directory=await realpath(await mkdtemp(join(tempRoot,'vyrealm-decode-test-')));
 t.after(async()=>{assert.ok(within(tempRoot,directory)&&basename(directory).startsWith('vyrealm-decode-test-'));await rm(directory,{recursive:true,force:true});});
 const dataDir=join(directory,'data'),jobRoot=join(dataDir,'jobs',sourceJobId),stageRoot=join(jobRoot,'motion');await mkdir(join(stageRoot,'frames'),{recursive:true});
 const workflow=wanWorkflow({frames:121,width:1024,height:576,prefix:`${namespace}/motion`,prompt:'Ownership fixture, never accepted as generated media'}),workflowHash=hashJson(workflow),promptId='owned-provider-prompt';
 const bytes=latentBytes(workflow),latentHash=digest(bytes),video=Buffer.from('ownership fixture only; not a playable media acceptance sample');
 const frame=Buffer.alloc(256);const ledger=[];for(let i=0;i<121;i++){const path=`frames/${String(i).padStart(5,'0')}.png`,providerOutput={filename:`motion_${String(i+1).padStart(5,'0')}_.png`,subfolder:namespace,type:'output'};await writeFile(join(stageRoot,path),frame);ledger.push({index:i,path,sha256:digest(frame),providerOutput});}
 const latentDescriptor={filename:'motion_latent_00001_.latent',subfolder:namespace,type:'output'};
 const history={prompt:[0,promptId,workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:ledger.map(f=>f.providerOutput)},'12':{latents:[latentDescriptor]}}};
 const result={validated:true,status:'review_required',durationSeconds:5,outputs:{sourceVideo:'generated-source.mp4'},provenance:{status:'generated',generationStatus:'generated',providerId:'comfyui-local',modelId:'Wan2.2-TI2V-5B-Q4_K_M.gguf',providerPromptId:promptId,workflowHash,outputHash:digest(video),resolution:{width:1024,height:576},fps:24,durationSeconds:5}};
 const save=async(path,value)=>writeFile(path,JSON.stringify(value));
 await writeFile(join(stageRoot,'generated.latent'),bytes);await writeFile(join(jobRoot,'generated-source.mp4'),video);await save(join(jobRoot,'generation-checkpoint.json'),{namespace});await save(join(jobRoot,'result.json'),result);await save(join(stageRoot,'workflow.json'),workflow);await save(join(stageRoot,'history.json'),history);await save(join(stageRoot,'frames.json'),ledger);await save(join(stageRoot,'latents.json'),[{path:'generated.latent',sha256:latentHash,providerOutput:latentDescriptor}]);
 await writeFile(join(stageRoot,'provider.jsonl'),['submitted','completed'].map(event=>JSON.stringify({event,promptId,workflowHash})).join('\n')+'\n');
 const db=new DatabaseSync(join(dataDir,'vyrelum.sqlite'));db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,type TEXT,status TEXT,output TEXT)');db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(sourceJobId,'original-project','generation-shot','succeeded',JSON.stringify(result));db.close();
 return{directory,dataDir,jobRoot,stageRoot,workflow,workflowHash,bytes,latentHash,result,history,ledger,save};
}

test('candidate preserves all temporal latent frames and cannot introduce sampling',()=>{
 assert.deepEqual([profile.tile_size,profile.overlap,profile.temporal_size,profile.temporal_overlap],[256,64,128,8]);assert.equal(profile.qualification,'unqualified');
 const graph=buildWanDecodeWorkflow({latentName:`vyrealm-decode-${operationId}.latent`,prefix:`vyrealm/${operationId}/decode`});
 assert.deepEqual(Object.values(graph).map(n=>n.class_type),['VAELoader','LoadLatent','VAEDecodeTiled','SaveImage']);assert.equal(graph['9'].inputs.temporal_size/4,32,'one31-frame Wan temporal latent fits');
 assert.throws(()=>buildWanDecodeWorkflow({latentName:'../borrowed.latent',prefix:`vyrealm/${operationId}/decode`}),e=>e.code==='DECODE_NAMESPACE_INVALID');
 assert.throws(()=>buildWanDecodeWorkflow({latentName:`vyrealm-decode-${operationId}.latent`,prefix:`vyrealm/${operationId}/decode`,profile:{...profile,temporal_size:32}}),e=>e.code==='DECODE_PROFILE_UNREVIEWED');
});

test('completed canonical source validates without mutating its SQLite record',async t=>{
 const f=await fixture(t),before=await readFile(join(f.dataDir,'vyrelum.sqlite'));
 const source=await validateOwnedLatentSource({dataDir:f.dataDir,sourceJobId});assert.equal(source.latentHash,f.latentHash);assert.equal(source.frames,121);assert.deepEqual(source.tensor.shape,[1,48,31,36,64]);assert.equal(source.projectId,'original-project');assert.deepEqual(await readFile(join(f.dataDir,'vyrelum.sqlite')),before);
});

test('changed latent bytes and imported provenance cannot enter decode benchmark',async t=>{
 const f=await fixture(t);const changed=Buffer.from(f.bytes);changed[changed.length-1]=1;await writeFile(join(f.stageRoot,'generated.latent'),changed);
 await assert.rejects(validateOwnedLatentSource({dataDir:f.dataDir,sourceJobId}),e=>e.code==='SOURCE_LATENT_CHANGED');
 await writeFile(join(f.stageRoot,'generated.latent'),f.bytes);await f.save(join(f.jobRoot,'result.json'),{...f.result,provenance:{...f.result.provenance,generationStatus:'imported'}});
 await assert.rejects(validateOwnedLatentSource({dataDir:f.dataDir,sourceJobId}),e=>e.code==='SOURCE_NOT_GENERATED');
});

test('incomplete provider history, changed frames, and escaped ledger paths fail',async t=>{
 const f=await fixture(t);await f.save(join(f.stageRoot,'history.json'),{...f.history,status:{completed:false,status_str:'running'}});
 await assert.rejects(validateOwnedLatentSource({dataDir:f.dataDir,sourceJobId}),e=>e.code==='SOURCE_HISTORY_INCOMPLETE');
 await f.save(join(f.stageRoot,'history.json'),f.history);await writeFile(join(f.stageRoot,f.ledger[60].path),'changed');
 await assert.rejects(validateOwnedLatentSource({dataDir:f.dataDir,sourceJobId}),e=>e.code==='SOURCE_FRAME_CHANGED');
 await writeFile(join(f.stageRoot,f.ledger[60].path),Buffer.alloc(256));const ledger=structuredClone(f.ledger);ledger[0].path='../borrowed.png';await f.save(join(f.stageRoot,'frames.json'),ledger);
 await assert.rejects(validateOwnedLatentSource({dataDir:f.dataDir,sourceJobId}),e=>e.code==='SOURCE_FRAME_OWNERSHIP');
});

test('safetensors bounds, shape and embedded sampler workflow are checked',()=>{
 const workflow=wanWorkflow({frames:121,width:1024,height:576,prefix:`${namespace}/motion`}),bytes=latentBytes(workflow),options={width:1024,height:576,frames:121,workflowHash:hashJson(workflow)};
 assert.equal(inspectLatentHeader(bytes,options).dtype,'F32');
 assert.throws(()=>inspectLatentHeader(bytes.subarray(0,50),options),e=>e.code==='LATENT_FORMAT_INVALID');
 assert.throws(()=>inspectLatentHeader(bytes,{...options,width:512}),e=>e.code==='LATENT_SHAPE_MISMATCH');
 assert.throws(()=>inspectLatentHeader(bytes,{...options,workflowHash:'different'}),e=>e.code==='LATENT_PROMPT_MISMATCH');
});

test('input staging copies exact data, reuses only matching namespace and preserves conflicting file',async t=>{
 const f=await fixture(t),source=await validateOwnedLatentSource({dataDir:f.dataDir,sourceJobId}),inputDirectory=join(f.directory,'input');await mkdir(inputDirectory);
 const staged=await stageOwnedLatent({source,runtime:{inputDirectory},operationId});assert.equal(digest(await readFile(staged.path)),source.latentHash);
 assert.equal((await stageOwnedLatent({source,runtime:{inputDirectory},operationId})).name,staged.name);
 await writeFile(staged.path,'existing different bytes');await assert.rejects(stageOwnedLatent({source,runtime:{inputDirectory},operationId}),e=>e.code==='DECODE_INPUT_COLLISION');assert.equal(await readFile(staged.path,'utf8'),'existing different bytes');
});
