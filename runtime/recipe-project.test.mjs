import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { FORMATS, PLATFORM_SPECS } from './format-library.mjs';
import { prepareRecipeProject, createRecipeProject } from './recipe-project.mjs';

const input = (formatId='product-proof-15',platform='instagram-reels') => ({formatId,platform,name:'Original lantern workshop',brief:'Show my handmade lantern illuminating a reading corner. Use my product photos and a clear demonstration.',sourceMode:'local-media'});
const schema=`CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE project_revisions(project_id TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,revision)); CREATE TABLE jobs(id TEXT); CREATE TABLE assets(id TEXT);`;

test('recipe draft carries its exact canvas, duration, planned beats and unresolved source requirements',()=>{
 const draft=prepareRecipeProject(input());
 assert.equal(draft?.name,'Original lantern workshop');assert.equal(draft.productionPlan.status,'planned');
 assert.deepEqual(draft.settings,PLATFORM_SPECS['instagram-reels'].canvas);assert.equal(draft.durationSeconds,15);
 assert.equal(draft.productionPlan.timeline.length,FORMATS['product-proof-15'].beats.length);
 assert.equal(draft.productionPlan.renderable,false);assert.ok(draft.productionPlan.sourceRequirements.length>0);
 assert.ok(draft.productionPlan.sourceRequirements.every(x=>x.status==='missing'&&x.acceptedMethods.includes('uploaded-local-media')));
 assert.deepEqual(draft.timeline,[]);assert.deepEqual(draft.assets,[]);assert.equal(draft.latestOutput,null);assert.equal(draft.demo,false);
 assert.equal(draft.productionPlan.generationRequested,false);assert.equal(draft.productionPlan.importRequested,false);
});
test('all shipped recipes create unrendered plans for their supported platforms',()=>{
 for(const [formatId,format] of Object.entries(FORMATS))for(const platform of format.platforms){
  const draft=prepareRecipeProject({...input(formatId,platform),sourceMode:'mixed'});
  assert.equal(draft.durationSeconds,format.seconds);assert.deepEqual(draft.settings,PLATFORM_SPECS[platform].canvas);
  assert.equal(draft.productionPlan.renderable,false);assert.equal(draft.productionPlan.status,'planned');
  assert.ok(draft.productionPlan.timeline.every(x=>x.assetId===null));assert.equal(draft.latestOutput,null);
 }
});
test('source intent and captions are explicit without asserting installed neural models',()=>{
 const local=prepareRecipeProject({...input('anime-action-beat','youtube-shorts'),sourceMode:'local-generation',captionsEnabled:false});
 assert.equal(local.captionsEnabled,false);assert.equal(local.productionPlan.captionStyle.id,'none');
 assert.ok(local.productionPlan.sourceRequirements.every(x=>x.acceptedMethods.includes('qualified-local-generation')));
 assert.equal(local.productionPlan.providerQualification,'required-before-generation');
});
test('invalid combinations and injected output/media fields are rejected',()=>{
 for(const patch of [{formatId:'no-format'},{formatId:'constructor'},{platform:'not-a-platform'},{formatId:'anime-short-film',platform:'tiktok'},{brief:' '},{brief:'a'.repeat(6001)},{name:' '},{sourceMode:'paid-api'},{captionsEnabled:'yes'},{latestOutput:{status:'completed'}},{assets:[{url:'https://higgsfield.ai/film.mp4'}]},{timeline:[{assetId:'imported'}]},{format:{}}])assert.throws(()=>prepareRecipeProject({...input(),...patch}));
});
test('canonical draft and revision reopen unchanged without touching existing projects or queueing jobs',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'vyrealm-recipe-')),file=join(directory,'vyrelum.sqlite');let db;
 try{
  db=new DatabaseSync(file);db.exec(schema);
  const original=JSON.stringify({name:'Keep this film',latestOutput:{videoAssetId:'existing'},timeline:[{assetId:'old'}]});db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run('existing',3,original,'before','before');
  const created=createRecipeProject({db,input:input()});assert.equal(created.revision,1);assert.ok(created.id);
  assert.equal(db.prepare('SELECT document FROM projects WHERE id=?').get('existing').document,original);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assets').get().n,0);
  db.close();db=new DatabaseSync(file,{readOnly:true});
  const saved=JSON.parse(db.prepare('SELECT document FROM projects WHERE id=?').get(created.id).document),revision=JSON.parse(db.prepare('SELECT document FROM project_revisions WHERE project_id=? AND revision=1').get(created.id).document);
  assert.deepEqual(saved,revision);assert.deepEqual(saved.productionPlan,created.productionPlan);assert.equal(saved.productionPlan.status,'planned');assert.equal(saved.latestOutput,null);
 }finally{db?.close();const root=await realpath(tmpdir()),target=await realpath(directory),rel=relative(root,target);assert.ok(rel&&!isAbsolute(rel)&&!rel.startsWith('..')&&rel.startsWith('vyrealm-recipe-'));await rm(target,{recursive:true,force:true});}
});
test('a revision-write failure rolls back the project insert',()=>{
 const db=new DatabaseSync(':memory:');db.exec(schema);db.exec("CREATE TRIGGER fail_revision BEFORE INSERT ON project_revisions BEGIN SELECT RAISE(ABORT,'fixture revision failure'); END;");
 try{assert.throws(()=>createRecipeProject({db,input:input()}),/fixture revision failure/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,0);}finally{db.close();}
});
