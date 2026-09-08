import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { buildCreatorWorkflowPlan, saveCreatorWorkflowPlan, inspectCreatorWorkflows, validateCreatorWorkflowInput } from './creator-workflow.mjs';

const input = { projectId:'project-1', expectedRevision:3, workflowId:'tutorial', brief:'Show how to replace a bicycle inner tube.', durationSeconds:30, sourceMode:'uploaded-media', assetIds:['video-1'], captionsEnabled:true, narrationMode:'none', scriptText:'First remove the wheel. Inspect the tyre before fitting the new tube.' };
const project = { id:'project-1', revision:3, name:'Repair tutorial', brief:'Existing brief', settings:{fps:24}, timeline:[], latestOutput:null };
const assets = [{id:'video-1',projectId:'project-1',mime:'video/mp4',name:'My recorded demonstration.mp4',available:true}];
const capabilities = [{id:'timeline',implementation:'implemented',status:'configured'}, {id:'transcription',implementation:'implemented',status:'missing-runtime'}, {id:'generation',implementation:'implemented',status:'preflight-required'}];
async function removeTestDirectory(path){const target=resolve(path);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(target.includes('vyrealm-creator-'));await rm(target,{recursive:true,force:true});}

test('uploaded footage receives actionable offline planning without a neural gate',()=>{
 const plan=buildCreatorWorkflowPlan({input,project,assets,capabilities});
 assert.equal(plan.status,'planned');assert.equal(plan.generationStatus,'not-requested');assert.equal(plan.mediaGenerated,false);
 assert.equal(plan.script.source,'user-supplied');assert.equal(plan.script.text,input.scriptText);
 assert.equal(plan.shots.reduce((n,s)=>n+s.durationFrames,0),720);
 assert.equal(plan.stages.find(s=>s.id==='assets').status,'ready');
 assert.equal(plan.stages.some(s=>s.status==='completed'),false);
 assert.ok(plan.actions.some(a=>a.id==='edit-timeline'&&a.view==='timeline'));
 assert.ok(plan.actions.some(a=>a.id==='render-edit'&&a.endpoint==='/api/jobs'&&a.body.type==='render'));
 assert.equal(plan.actions.some(a=>a.id==='run-generation'),false);
});

test('brief outline is not reported as researched facts or an approved narration script',()=>{
 const {scriptText,...outline}=input;
 const plan=buildCreatorWorkflowPlan({input:{...outline,narrationMode:'piper',researchNotes:'Owner says the tool weighs 200g.'},project,assets,capabilities});
 assert.equal(plan.script.source,'brief-outline');assert.equal(plan.script.requiresReview,true);
 assert.equal(plan.research.verification,'unverified-user-context');
 assert.equal(plan.actions.find(a=>a.id==='generate-narration').status,'needs-input');
 assert.equal(plan.actions.find(a=>a.id==='generate-narration').body,undefined);
});

test('cinematic local generation remains ungenerated and requires real provider preflight',()=>{
 const plan=buildCreatorWorkflowPlan({input:{...input,workflowId:'cinematic',sourceMode:'local-generation',assetIds:[],characterContinuity:'Use the approved original character reference and the same saffron wardrobe.'},project,assets:[],capabilities});
 assert.equal(plan.generationStatus,'not-generated');assert.equal(plan.stages.find(s=>s.id==='assets').status,'needs-input');
 assert.ok(plan.actions.some(a=>a.id==='provider-preflight'&&a.endpoint==='/api/generation/preflight'));
 assert.equal(plan.characterContinuity.includes('approved original'),true);
 assert.ok(plan.shots.every(s=>s.generationStatus==='not-generated'));
 assert.equal(plan.shots.some(s=>s.route==='scene3d'),false);
});

test('unknown fields, foreign assets, invalid bounds and invalid choices fail closed',()=>{
 for(const patch of [{workflowId:'avatar'},{sourceMode:'cloud'},{expectedRevision:0},{durationSeconds:0},{durationSeconds:601},{captionsEnabled:'true'},{assetIds:['video-1','video-1']},{narrationMode:'paid'},{status:'completed'}])assert.throws(()=>validateCreatorWorkflowInput({...input,...patch}),{code:'CREATOR_INPUT_INVALID'});
 assert.throws(()=>buildCreatorWorkflowPlan({input,project,assets:[{...assets[0],projectId:'other-project'}],capabilities}),{code:'CREATOR_ASSET_INVALID'});
 assert.throws(()=>buildCreatorWorkflowPlan({input,project,assets:[{...assets[0],available:false}],capabilities}),{code:'CREATOR_ASSET_INVALID'});
});

test('chat form fields map to the saved plan and non-media receipt assets must be excluded',()=>{
 const fields={workflowId:'talking-head',sourceMode:'uploaded-media',durationSeconds:'30',researchNotes:'My recording; keep the original speaker.',scriptText:'Here is the repair demonstration.'};
 const request={...fields,projectId:project.id,expectedRevision:project.revision,brief:project.brief,durationSeconds:Number(fields.durationSeconds),narrationMode:'none',captionsEnabled:true,assetIds:['video-1']};
 const plan=buildCreatorWorkflowPlan({input:request,project,assets,capabilities});
 assert.equal(plan.workflowId,fields.workflowId);assert.equal(plan.sourceMode,fields.sourceMode);assert.equal(plan.research.notes,fields.researchNotes);assert.equal(plan.script.text,fields.scriptText);
 assert.ok(Array.isArray(plan.shots));assert.ok(plan.shots.every(s=>s.id&&s.description&&s.durationSeconds));assert.ok(plan.stages.every(s=>s.id&&s.label&&s.status));
 assert.throws(()=>buildCreatorWorkflowPlan({input:{...request,assetIds:['video-1','quality-json']},project,assets:[...assets,{id:'quality-json',projectId:project.id,mime:'application/json',available:true}],capabilities}),{code:'CREATOR_ASSET_INVALID'});
 for(const workflowId of ['talking-head','social-recut','tutorial'])assert.throws(()=>validateCreatorWorkflowInput({...request,workflowId,sourceMode:'local-generation'}),{code:'CREATOR_INPUT_INVALID'});
});

test('saving and reopening uses existing SQLite revisions without changing media or outputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-creator-'));const file=join(root,'source.mp4');await writeFile(file,'owned fixture media metadata; no render claimed');
 const db=new DatabaseSync(join(root,'projects.sqlite'));
 try{
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT,PRIMARY KEY(project_id,revision));CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT)');
  const original={...project,timeline:[{id:'keep',assetId:'video-1',duration:12}],latestOutput:{status:'review_required',videoAssetId:'retained-video'},script:'Keep this existing script',characterNotes:'Keep this design'};delete original.id;delete original.revision;
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(project.id,3,JSON.stringify(original),'old','old');
  db.prepare('INSERT INTO project_revisions VALUES (?,?,?,?)').run(project.id,3,JSON.stringify(original),'old');
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run('video-1',project.id,JSON.stringify({mime:'video/mp4',name:'source.mp4'}),file,'old');
  const result=saveCreatorWorkflowPlan({db,input,capabilities});assert.equal(result.project.revision,4);assert.equal(result.plan.revision,4);
  assert.deepEqual(result.project.timeline,original.timeline);assert.deepEqual(result.project.latestOutput,original.latestOutput);assert.equal(result.project.script,original.script);
  const reopened=JSON.parse(db.prepare('SELECT document FROM projects WHERE id=?').get(project.id).document);
  assert.deepEqual(reopened.creatorWorkflow,result.plan);assert.equal(db.prepare('SELECT count(*) AS n FROM project_revisions').get().n,2);
  assert.throws(()=>saveCreatorWorkflowPlan({db,input,capabilities}),{code:'CREATOR_REVISION_CONFLICT'});
  assert.equal(db.prepare('SELECT count(*) AS n FROM assets').get().n,1);
 }finally{db.close();await removeTestDirectory(root);}
});

test('runtime discovery reports configuration rather than inventing media capabilities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-creator-runtime-'));
 try{
  const empty=await inspectCreatorWorkflows({root,runtimeDirectory:join(root,'runtime')});assert.equal(empty.workflows.length,6);
  assert.equal(empty.capabilities.find(c=>c.id==='lip-sync').implementation,'missing');
  assert.equal(empty.capabilities.find(c=>c.id==='voiceover').status,'missing-runtime');
  await mkdir(join(root,'workers','tools'),{recursive:true});await writeFile(join(root,'workers','timeline.mjs'),'// fixture');await writeFile(join(root,'workers','tools',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),'fixture');await writeFile(join(root,'workers','tools',process.platform==='win32'?'ffprobe.exe':'ffprobe'),'fixture');
  const installed=await inspectCreatorWorkflows({root,runtimeDirectory:join(root,'runtime')});assert.equal(installed.capabilities.find(c=>c.id==='timeline').status,'configured');
  assert.equal(installed.capabilities.find(c=>c.id==='timeline').verifiedExecution,false);
 }finally{await removeTestDirectory(root);}
});

test('actual local HTTP journey plans uploaded media, reopens it and rejects a stale retry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-creator-http-')),repo=fileURLToPath(new URL('..',import.meta.url));
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:repo,env:{...process.env,PORT:String(port),VYRELUM_DATA_DIR:join(root,'data'),VYRELUM_RUNTIME_DIR:join(root,'runtime'),OLLAMA_HOST:'http://127.0.0.1:1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});const closed=new Promise(resolve=>child.once('close',resolve));
 const base=`http://127.0.0.1:${port}`;let session;
 try{
  for(let attempt=0;attempt<80;attempt++){try{session=await(await fetch(`${base}/api/session`,{signal:AbortSignal.timeout(500)})).json();break;}catch{if(child.exitCode!==null)throw new Error(output);await new Promise(resolve=>setTimeout(resolve,100));}}
  assert.ok(session?.token,output);const headers={'X-Vyrelum-Token':session.token,'content-type':'application/json'};
  const api=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return {status:response.status,data:await response.json()};};
  const catalogue=await api('/api/creator/workflows');assert.equal(catalogue.status,200);assert.equal(catalogue.data.workflows.length,6);assert.equal(catalogue.data.inspection.networkAccess,false);
  const created=await api('/api/projects','POST',{name:'Uploaded workflow HTTP test',brief:'My original recorded demonstration',mode:'cinematic',timeline:[]});assert.equal(created.status,201);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0S0AAAAASUVORK5CYII=','base64');
  const uploaded=await fetch(base+'/api/assets',{method:'POST',headers:{'X-Vyrelum-Token':session.token,'content-type':'image/png','x-filename':'owned-original-test.png','x-project-id':created.data.id},body:png});assert.equal(uploaded.status,201);const asset=await uploaded.json();
  const request={...input,projectId:created.data.id,expectedRevision:created.data.revision,assetIds:[asset.id]};
  const saved=await api('/api/creator/workflows/plan','POST',request);assert.equal(saved.status,201);assert.equal(saved.data.project.revision,2);assert.equal(saved.data.plan.mediaGenerated,false);
  const reopened=await api(`/api/projects/${created.data.id}`);assert.deepEqual(reopened.data.creatorWorkflow,saved.data.plan);assert.deepEqual(reopened.data.timeline,[]);assert.equal(reopened.data.latestOutput,null);
  assert.equal((await api('/api/jobs')).data.length,0);assert.equal((await api('/api/creator/workflows/plan','POST',request)).status,409);
 }finally{
  if(child.exitCode===null)child.send({type:'shutdown'});
  const timeout=Symbol('timeout');let timer;const result=await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),5000);})]);clearTimeout(timer);
  if(result===timeout){child.kill();await closed;}
  await removeTestDirectory(root);
 }
});
