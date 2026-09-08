import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildCreatorWorkflowPlan, saveCreatorWorkflowPlan, inspectCreatorWorkflows, validateCreatorWorkflowInput } from './creator-workflow.mjs';

const input = { projectId:'project-1', expectedRevision:3, workflowId:'tutorial', brief:'Show how to replace a bicycle inner tube.', durationSeconds:30, sourceMode:'uploaded-media', assetIds:['video-1'], captionsEnabled:true, narrationMode:'none', scriptText:'First remove the wheel. Inspect the tyre before fitting the new tube.' };
const project = { id:'project-1', revision:3, name:'Repair tutorial', brief:'Existing brief', settings:{fps:24}, timeline:[], latestOutput:null };
const assets = [{id:'video-1',projectId:'project-1',mime:'video/mp4',name:'My recorded demonstration.mp4',available:true}];
const capabilities = [{id:'timeline',implementation:'implemented',status:'configured'}, {id:'transcription',implementation:'implemented',status:'missing-runtime'}, {id:'generation',implementation:'implemented',status:'preflight-required'}];

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
 }finally{db.close();await rm(root,{recursive:true,force:true});}
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
 }finally{await rm(root,{recursive:true,force:true});}
});
