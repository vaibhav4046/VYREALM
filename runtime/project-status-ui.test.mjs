import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { jobProgressPercent } from '../cinematic-studio.js';

// Exercise the shipped rendering functions with inert DOM boundaries. No local
// project, provider, browser recording or GPU job is changed by this fixture.
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import[^\n]*\r?\n/gm,'').replace(/\ninit\(\);\s*$/,'\n');
function fixture(){
 const content={innerHTML:'',querySelector:()=>null};
 const context=vm.createContext({jobProgressPercent,document:{activeElement:null,addEventListener(){},querySelector:s=>s==='.content'?content:null,querySelectorAll:()=>[]}});
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run(`store.active='Dashboard';store.state.projects=[{id:'film',name:'Between Two Armies',revision:5,timeline:[],latestOutput:{jobId:'retry',status:'blocked',reason:'Provider history timed out'}}];`);
 const jobs=value=>{context.fixtureJobs=value;run('store.state.jobs=fixtureJobs');};
 return {run,jobs,content};
}
const job=(extra={})=>({id:'retry',projectId:'film',type:'generation-test',status:'running',progress:0.25,stage:'Local Wan motion',createdAt:'2026-09-07T22:00:00Z',updatedAt:'2026-09-08T01:30:00Z',...extra});

test('retry progress replaces the historical blocked card without altering project history',()=>{
 const f=fixture();f.jobs([job()]);
 const before=f.run('JSON.stringify(store.state.projects)');
 const card=f.run('projectCard(store.state.projects[0])');
 assert.match(card,/<span class="tag">RUNNING<\/span>/);
 assert.match(card,/25% · Local Wan motion/);
 assert.doesNotMatch(card,/generation blocked|RENDERED/);
 const preview=f.run('preview(store.state.projects[0],null)');
 assert.match(preview,/RUNNING · local production/);
 assert.match(preview,/Previous output remains blocked: Provider history timed out/);
 assert.equal(f.run('JSON.stringify(store.state.projects)'),before);
});

test('production plan does not call blocked or still-running empty projects rendered',()=>{
 const f=fixture();f.run('store.project=store.state.projects[0]');f.jobs([job()]);
 assert.match(f.run('cinema()'),/STATE<\/span><strong>RUNNING/);
 assert.doesNotMatch(f.run('cinema()'),/>Rendered</);
 f.jobs([job({status:'blocked'})]);assert.match(f.run('cinema()'),/STATE<\/span><strong>BLOCKED/);
});

test('cinematic shot plans are not treated as format recipes and appear in director and storyboard',()=>{
 const f=fixture();f.run("store.project=store.state.projects[0];store.project.productionPlan={shots:[{id:'01-chariot',keyframePrompt:'A detailed timber chariot at dawn',durationSeconds:5,generationStatus:'needs-casting-revision'}]}");
 assert.equal(f.run('recipePlanMarkup(store.project)'),'');
 assert.match(f.run('cinema()'),/PLANNED SHOTS<\/span><strong>1/);
 assert.match(f.run('cinema()'),/0 clips on the timeline/);
 assert.match(f.run('storyboard()'),/A detailed timber chariot at dawn/);
 assert.match(f.run('storyboard()'),/needs-casting-revision/);
 assert.doesNotMatch(f.run('storyboard()'),/No storyboard yet|RENDERED/);
});

test('job selection uses retry update times and ignores other projects',()=>{
 const f=fixture();f.jobs([job({id:'other',projectId:'another',progress:0.99}),job({id:'newer-created',status:'queued',createdAt:'2026-09-08T01:00:00Z',updatedAt:'2026-09-08T01:00:00Z'}),job()]);
 assert.equal(f.run('projectDisplayStatus(store.state.projects[0]).activeJob.id'),'retry');
 assert.match(f.run('projectCard(store.state.projects[0])'),/25%/);
});

test('terminal failed retry does not claim a completed or active film',()=>{
 const f=fixture();f.jobs([job({status:'failed',progress:0.9,error:'Provider unavailable'})]);
 assert.equal(f.run('projectDisplayStatus(store.state.projects[0]).label'),'BLOCKED');
 assert.match(f.run('projectCard(store.state.projects[0])'),/generation blocked/);
});

test('retained completion is presented as reviewable or retained, not an attached render',()=>{
 const f=fixture();f.jobs([job({status:'review_required',output:{promoted:false,assets:{video:'clip'}}})]);
 assert.match(f.run('projectCard(store.state.projects[0])'),/REVIEW.*Retained shot needs visual review/);
 f.jobs([job({status:'succeeded',output:{promoted:false,review:{verdict:'passed'},assets:{video:'clip'}}})]);
 assert.match(f.run('projectCard(store.state.projects[0])'),/RETAINED.*apply it from Jobs/);
 assert.doesNotMatch(f.run('projectCard(store.state.projects[0])'),/RENDERED/);
});

test('active stages are escaped and displayed progress stays bounded',()=>{
 const f=fixture();f.jobs([job({progress:1.4,stage:'<script>unsafe</script>'})]);
 const card=f.run('projectCard(store.state.projects[0])');
 assert.match(card,/100%/);assert.match(card,/&lt;script&gt;/);assert.doesNotMatch(card,/<script>/);
});

test('applying a retained shot clears the retained card state without changing its job receipt',()=>{
 const f=fixture();f.jobs([job({status:'succeeded',output:{promoted:false,review:{verdict:'passed'},assets:{video:'clip'}}})]);
 f.run("store.state.assets=[{id:'clip'}];store.state.projects[0].latestOutput={status:'reviewed',videoAssetId:'clip'};store.state.projects[0].operations=[{type:'apply_generated_shot',jobId:'retry'}]");
 assert.equal(f.run('projectDisplayStatus(store.state.projects[0]).label'),'RENDERED');
 assert.equal(f.run('store.state.jobs[0].output.promoted'),false);
});

test('Dashboard polling rerenders the current queue and its project cards',()=>{
 const f=fixture();f.jobs([job({status:'blocked'})]);
 f.run('updateDynamicView()');assert.match(f.content.innerHTML,/<span class="tag">BLOCKED<\/span>/);
 f.jobs([job()]);f.run('updateDynamicView()');
 assert.match(f.content.innerHTML,/<span class="tag">RUNNING<\/span>/);
 assert.match(f.content.innerHTML,/25% · Local Wan motion/);
 assert.match(f.content.innerHTML,/Active jobs<\/div><div class="metric-value">1<\/div>/);
});

test('review requests bind actual delivery hashes while legacy source hashes are omitted',()=>{
 const f=fixture(),hash='a'.repeat(64);f.run(`globalThis.hash='${hash}'`);
 assert.equal(f.run("reviewOutputHash({generationStatus:'generated',outputHash:hash})"),undefined);
 assert.equal(f.run("reviewOutputHash({generationStatus:'generated',source:{outputHash:'native'},outputHash:hash})"),hash);
 assert.equal(f.run("reviewOutputHash({generationStatus:'edited',outputHash:hash})"),hash);
 assert.equal(f.run("reviewOutputHash({generationStatus:'edited',outputHash:'unverified'})"),undefined);
 assert.match(source,/expectedOutputHash:reviewOutputHash\(provenance\)/);
 assert.match(source,/expectedOutputHash:reviewOutputHash\(p.latestOutput.provenance\)/);
});

test('new-shot requests default to reuse and require a reviewed prerequisite in both modes',()=>{
 const f=fixture();
 const locked=f.run("nextShotRequest({project:{id:'film',revision:7},brief:' A chariot wheel at dawn ',referenceJobId:'reviewed'})");
 assert.equal(locked.sourceMode,'locked-keyframe');assert.equal(locked.referenceJobId,'reviewed');assert.equal(locked.expectedRevision,7);assert.equal(locked.brief,'A chariot wheel at dawn');
 f.run('store.state.features={independentKeyframes:true}');
 const fresh=f.run("nextShotRequest({project:{id:'film',revision:8},brief:'Krishna listens beside the chariot',referenceJobId:'reviewed',sourceMode:'new-keyframe'})");
 assert.equal(fresh.sourceMode,'new-keyframe');assert.equal(fresh.referenceJobId,'reviewed');
 for(const mode of ['locked-keyframe','new-keyframe'])assert.throws(()=>f.run(`nextShotRequest({project:{id:'film',revision:8},brief:'Dawn',sourceMode:'${mode}'})`),/reviewed local generation/);
 assert.throws(()=>f.run("nextShotRequest({project:{id:'film',revision:8},brief:'Dawn',referenceJobId:'reviewed',sourceMode:'automatic-fallback'})"),/supported keyframe source/);
});

test('fresh-keyframe copy describes independent generation without promising identity continuity',()=>{
 const f=fixture(),fresh=f.run("nextShotSourceConfig('new-keyframe')"),locked=f.run('nextShotSourceConfig()');
 assert.match(fresh.help,/fresh independent image/);assert.match(fresh.help,/its image is not reused/);assert.match(fresh.help,/not guaranteed/);
 assert.equal(fresh.referenceLabel,'PASSED GENERATION CHECK');
 assert.match(locked.help,/Reuse the selected shot’s keyframe/);
});

test('next-shot prerequisites exclude unreviewed, imported, failed and foreign project receipts',()=>{
 const f=fixture();
 const generated={review:{verdict:'passed'},provenance:{generationStatus:'generated',keyframe:{outputHash:'keyframe'},evidenceHash:'evidence'}};
 f.jobs([
   job({id:'accepted',status:'succeeded',output:generated}),
   job({id:'wrong-project',projectId:'another',status:'succeeded',output:generated}),
   job({id:'wrong-type',type:'render',status:'succeeded',output:generated}),
   job({id:'failed',status:'failed',output:generated}),
   job({id:'unreviewed',status:'succeeded',output:{...generated,review:{verdict:'pending'}}}),
   job({id:'imported',status:'succeeded',output:{...generated,provenance:{...generated.provenance,generationStatus:'imported'}}}),
 ]);
 assert.equal(f.run("nextShotReferences({id:'film'}).map(job=>job.id).join(',')"),'accepted');
});

test('old running servers cannot receive a fresh-keyframe request from the updated UI',()=>{
 const f=fixture();
 assert.equal(f.run('independentKeyframesAvailable()'),false);
 assert.equal(f.run("availableNextShotSourceMode('new-keyframe')"),'locked-keyframe');
 assert.throws(()=>f.run("nextShotRequest({project:{id:'film',revision:8},brief:'Dawn',referenceJobId:'reviewed',sourceMode:'new-keyframe'})"),/running local engine does not support independent keyframes/);
 assert.equal(f.run("nextShotRequest({project:{id:'film',revision:8},brief:'Dawn',referenceJobId:'reviewed'}).sourceMode"),'locked-keyframe');
 f.run("store.state.features={independentKeyframes:'true'}");
 assert.equal(f.run('independentKeyframesAvailable()'),false);
});

test('new-keyframe choice requires an explicit current-server capability and revokes stale drafts',()=>{
 const f=fixture();f.run('store.state.features={independentKeyframes:true}');
 assert.equal(f.run("availableNextShotSourceMode('new-keyframe')"),'new-keyframe');
 assert.equal(f.run("availableNextShotSourceMode('locked-keyframe')"),'locked-keyframe');
 f.run('store.state.features={independentKeyframes:false}');
 assert.equal(f.run("availableNextShotSourceMode('new-keyframe')"),'locked-keyframe');
 assert.match(source,/draft\.sourceMode=sourceMode/);
 assert.match(source,/independentReady\?'':'disabled'/);
});
