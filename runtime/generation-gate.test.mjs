import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { preflightGeneration, recordGeneratedProvenance, hashJson, NEURAL_MODEL_IDS, NEURAL_REQUIRED_NODES } from './generation-gate.mjs';
import { wanWorkflow } from './neural-production.mjs';
const gpu={gpu:{gpu:'RTX 3050',vramGb:6}};
const providerFetch=(qualified=false)=>async url=>{
  const p=new URL(url).pathname;
  if(p==='/system_stats')return Response.json({devices:[{name:'RTX 3050',type:'cuda',vram_total:6*1024**3}]});
  if(p==='/object_info')return Response.json(Object.fromEntries((qualified?NEURAL_REQUIRED_NODES:['KSampler']).map(n=>[n,{}])));
  if(p.startsWith('/models/'))return Response.json(p.endsWith('/checkpoints')?(qualified?NEURAL_MODEL_IDS:['unrelated-image-model.safetensors']):[]);
  return new Response('',{status:404});
};
test('nested workflow hashes preserve values and ignore object key order',()=>{
  assert.equal(hashJson({b:{z:2,a:1},a:[3,4]}),hashJson({a:[3,4],b:{a:1,z:2}}));
  assert.notEqual(hashJson({node:{inputs:{seed:1}}}),hashJson({node:{inputs:{seed:2}}}));
});
test('offline and unrelated checkpoints cannot qualify the fixed neural route',async()=>{
  assert.equal((await preflightGeneration({env:{},hardware:gpu,fetchImpl:async()=>{throw Error('offline')}})).status,'blocked');
  assert.equal((await preflightGeneration({env:{},hardware:gpu,fetchImpl:providerFetch()})).status,'blocked');
  const ready=await preflightGeneration({env:{},hardware:gpu,fetchImpl:providerFetch(true)});
  assert.equal(ready.status,'ready');assert.equal(ready.modelId,NEURAL_MODEL_IDS[0]);
});
test('a random file inside a job is never evidence of model generation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vyrealm-gate-')),file=join(root,'fake.mp4');await writeFile(file,'generated');
  const result=await recordGeneratedProvenance({jobRoot:root,outputPath:file,providerId:'comfyui-local'});
  assert.equal(result.status,'blocked');assert.equal(result.code,'PROVIDER_EVIDENCE_MISSING');
});
test('provider audit binds history, frame hashes and playable clip lineage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vyrealm-audit-fixture-')),stage=join(root,'motion'),frames=join(stage,'frames');await mkdir(frames,{recursive:true});
  const ffmpeg=resolve('workers/tools/ffmpeg.exe'),ffprobe=resolve('workers/tools/ffprobe.exe');
  // Synthetic test fixture only: never a model run or catalogue asset.
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=8','-frames:v','33','-start_number','0',join(frames,'%05d.png')],{windowsHide:true});
  const clip=join(root,'source.mp4');
  execFileSync(ffmpeg,['-v','error','-framerate','8','-i',join(frames,'%05d.png'),'-frames:v','32','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',clip],{windowsHide:true});
  const workflow=wanWorkflow({prompt:'test fixture',seed:42,frames:33,width:96,height:64,prefix:'vyrealm/fixture/motion'}),workflowHash=hashJson(workflow),promptId='test-provider-fixture';
  const ledger=[];for(let i=0;i<33;i++){const path=`frames/${String(i).padStart(5,'0')}.png`;ledger.push({index:i,path,sha256:createHash('sha256').update(await readFile(join(stage,path))).digest('hex'),providerOutput:{subfolder:'vyrealm\\fixture',filename:`motion_${i}.png`,type:'output'}});}
  const history={prompt:[0,promptId,workflow],status:{completed:true,status_str:'success'},outputs:{'10':{images:ledger.map(f=>f.providerOutput)}}};
  const e={stageRoot:stage,promptId,historyPath:join(stage,'history.json'),framesPath:join(stage,'frames.json'),logPath:join(stage,'provider.jsonl')};
  await writeFile(join(stage,'workflow.json'),JSON.stringify(workflow));await writeFile(e.historyPath,JSON.stringify(history));await writeFile(e.framesPath,JSON.stringify(ledger));
  const log=['submitted','completed'].map(event=>JSON.stringify({event,promptId,workflowHash})).join('\n');await writeFile(e.logPath,log);
  const options={jobRoot:root,outputPath:clip,providerId:'comfyui-local',modelId:NEURAL_MODEL_IDS[0],workflow,seed:42,prompt:'test fixture',width:96,height:64,fps:8,durationSeconds:4,ffmpeg,ffprobe,providerEvidence:e};
  const receipt=await recordGeneratedProvenance(options);assert.equal(receipt.status,'generated',JSON.stringify(receipt));assert.equal(receipt.frameCount,32);assert.equal(receipt.lineage.length,3);
  await writeFile(e.logPath,'');assert.equal((await recordGeneratedProvenance(options)).status,'blocked');await writeFile(e.logPath,log);
  assert.equal((await recordGeneratedProvenance({...options,modelId:'wrong-model'})).code,'MODEL_INVOCATION_MISMATCH');
  await writeFile(e.historyPath,JSON.stringify({...history,prompt:[0,'someone-else',workflow]}));assert.equal((await recordGeneratedProvenance(options)).code,'PROVIDER_WORKFLOW_MISMATCH');await writeFile(e.historyPath,JSON.stringify(history));
  execFileSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','color=red:size=96x64:rate=8','-frames:v','32','-c:v','libx264','-pix_fmt','yuv420p',clip],{windowsHide:true});
  assert.equal((await recordGeneratedProvenance(options)).code,'GENERATED_CLIP_LINEAGE_MISMATCH');
  await writeFile(clip,'not a video');assert.equal((await recordGeneratedProvenance(options)).status,'blocked');
});
