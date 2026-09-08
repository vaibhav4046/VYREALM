import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { validateKeyframeRequest } from './keyframe-production.mjs';
import { wanWorkflow } from './neural-production.mjs';
import { hashJson } from './generation-gate.mjs';
import { readOriginalWorkerFailure } from './original-generation-monitor.mjs';
import { ORIGINAL_GENERATION_OWNER } from './reviewed-keyframe-motion.mjs';
import { createHash } from 'node:crypto';

test('actual worker CLI preserves a terminal provider error in its invocation-bound receipt without submitting inference',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-worker-protocol-')),jobId='00000000-0000-4000-8000-000000000001',runId='00000000-0000-4000-8000-000000000002',jobRoot=path.join(directory,'jobs',jobId);await fs.mkdir(path.join(jobRoot,'keyframe'),{recursive:true});
 const request=validateKeyframeRequest({projectId:'project-1',expectedRevision:2,prompt:'A ceramic cup in an isolated error fixture.',seed:1,width:1024,height:576,steps:20}),workflow=wanWorkflow({...request,frames:1,prefix:`vyrealm/${jobId}/keyframe`});
 await fs.writeFile(path.join(jobRoot,'request.json'),JSON.stringify(request));await fs.writeFile(path.join(jobRoot,'keyframe/workflow.json'),JSON.stringify(workflow));await fs.writeFile(path.join(jobRoot,'keyframe/provider.jsonl'),JSON.stringify({event:'submitted',promptId:'retained-owned-prompt',workflowHash:hashJson(workflow)})+'\n');
 const db=new DatabaseSync(path.join(directory,'vyrelum.sqlite'));db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,input TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER)');db.prepare('INSERT INTO projects VALUES(?,?)').run('project-1',2);db.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(jobId,'project-1','running',JSON.stringify({serviceOwner:ORIGINAL_GENERATION_OWNER,stageKind:'keyframe',request}));db.close();
 const urls=[],server=createServer((req,res)=>{urls.push(req.url);res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'Intentional terminal fixture error'}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const startedAt=Date.now(),deadlineAt=startedAt+10000,child=spawn(process.execPath,['workers/original-generation.mjs','--job-root',jobRoot,'--kind','keyframe','--run-id',runId,'--started-at',String(startedAt),'--deadline-at',String(deadlineAt)],{cwd:new URL('..',import.meta.url),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,VYRELUM_COMFYUI_URL:`http://127.0.0.1:${server.address().port}`}});let stderr='';child.stderr.on('data',b=>stderr+=b);child.stdout.resume();const timer=setTimeout(()=>child.kill(),12000);
 t.after(async()=>{clearTimeout(timer);if(child.exitCode===null){child.kill();await once(child,'close');}await new Promise(r=>server.close(r));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
 const [exitCode]=await once(child,'close');clearTimeout(timer);assert.equal(exitCode,1,stderr);assert.deepEqual(urls,['/history/retained-owned-prompt']);
 const error=await readOriginalWorkerFailure({jobRoot,kind:'keyframe',request,runId,workerPid:child.pid});assert.equal(error?.code,'PROVIDER_HISTORY_FAILED',stderr);assert.equal(error.requestHash,hashJson(request));await assert.rejects(fs.access(path.join(jobRoot,'result.json')));
});

test('actual worker receives owned sampler/decode progress over native WebSocket but still rejects failed HTTP history',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-worker-ws-')),jobId='00000000-0000-4000-8000-000000000003',runId='00000000-0000-4000-8000-000000000004',jobRoot=path.join(directory,'jobs',jobId);await fs.mkdir(path.join(jobRoot,'keyframe'),{recursive:true});
 const request=validateKeyframeRequest({projectId:'project-1',expectedRevision:2,prompt:'Original ceramic cup native socket protocol fixture.',seed:1,width:1024,height:576,steps:20}),workflow=wanWorkflow({...request,frames:1,prefix:`vyrealm/${jobId}/keyframe`}),promptId='retained-progress-prompt',clientId='retained-owned-client';
 await fs.writeFile(path.join(jobRoot,'request.json'),JSON.stringify(request));await fs.writeFile(path.join(jobRoot,'keyframe/workflow.json'),JSON.stringify(workflow));await fs.writeFile(path.join(jobRoot,'keyframe/provider.jsonl'),JSON.stringify({event:'submitted',promptId,clientId,workflowHash:hashJson(workflow)})+'\n');
 const db=new DatabaseSync(path.join(directory,'vyrelum.sqlite'));db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,input TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER)');db.prepare('INSERT INTO projects VALUES(?,?)').run('project-1',2);db.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(jobId,'project-1','running',JSON.stringify({serviceOwner:ORIGINAL_GENERATION_OWNER,stageKind:'keyframe',request}));db.close();
 const urls=[],sockets=new Set(),server=createServer((req,res)=>{urls.push(req.url);response=res;rejectIfObserved();});let response,observedDecode=false;
 function rejectIfObserved(){if(response&&observedDecode&&!response.writableEnded){response.writeHead(400,{'content-type':'application/json'});response.end(JSON.stringify({error:'Owned history fixture deliberately failed'}));}}
 function send(socket,value){const bytes=Buffer.from(JSON.stringify(value));assert.ok(bytes.length<126);socket.write(Buffer.concat([Buffer.from([0x81,bytes.length]),bytes]));}
 server.on('upgrade',(req,socket)=>{
  urls.push(req.url);sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on('data',bytes=>{if((bytes[0]&0x0f)===8)socket.end(Buffer.from([0x88,0]));else assert.fail('Telemetry sent an application message');});
  send(socket,{type:'progress',data:{prompt_id:'foreign',node:'8',value:19,max:20}});send(socket,{type:'progress',data:{prompt_id:promptId,node:'8',value:7,max:20}});send(socket,{type:'executing',data:{prompt_id:promptId,node:'9'}});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const startedAt=Date.now(),child=spawn(process.execPath,['workers/original-generation.mjs','--job-root',jobRoot,'--kind','keyframe','--run-id',runId,'--started-at',String(startedAt),'--deadline-at',String(startedAt+10000)],{cwd:new URL('..',import.meta.url),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,VYRELUM_COMFYUI_URL:`http://127.0.0.1:${server.address().port}`}});let stdout='',stderr='';child.stderr.on('data',b=>stderr+=b);child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('Decoding generated pixels')){observedDecode=true;rejectIfObserved();}});const timer=setTimeout(()=>child.kill(),12000);
 t.after(async()=>{clearTimeout(timer);if(child.exitCode===null){child.kill();await once(child,'close');}for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
 const[exitCode]=await once(child,'close');clearTimeout(timer);assert.equal(exitCode,1,stderr);assert.match(stdout,/7\/20 steps/);assert.match(stdout,/Decoding generated pixels/);assert.doesNotMatch(stdout,/19\/20/);
 assert.deepEqual(urls.sort(),[`/history/${promptId}`,`/ws?clientId=${clientId}`].sort());assert.ok(!urls.some(u=>u.startsWith('/prompt')));
 const progress=(await fs.readFile(path.join(jobRoot,'provider-progress.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(progress.some(p=>p.samplerStep===7));assert.ok(progress.some(p=>p.nodeType==='VAEDecode'));assert.ok(progress.every(p=>p.jobId===jobId&&p.promptId===promptId&&p.workflowHash===hashJson(workflow)));
 assert.equal((await readOriginalWorkerFailure({jobRoot,kind:'keyframe',request,runId,workerPid:child.pid}))?.code,'PROVIDER_HISTORY_FAILED');await assert.rejects(fs.access(path.join(jobRoot,'result.json')));
});
