import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectTranscriptionUpdate} from './project-transcription.mjs';
import {createCaptionPages} from './caption-pages.mjs';
import {prepareTimedCaptions} from './timed-captions.mjs';

// Exercise the actual server completion callback and PATCH handler, with only
// file IO simulated. SQLite, caption paging and placement are real. No server,
// media model, canonical data, or worker subprocess is started by this fixture.
const source=(await readFile(new URL('../server.js',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE project_revisions(project_id TEXT,revision INTEGER,document TEXT,created_at TEXT,PRIMARY KEY(project_id,revision));CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,status TEXT,progress REAL,stage TEXT,error TEXT,output TEXT,updated_at TEXT);CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);');
 const now=()=>new Date().toISOString(),json=value=>JSON.parse(String(value));
 const pdoc=row=>({...json(row.document),id:row.id,revision:row.revision});
 const context={db,now,json,Buffer,join,basename,randomUUID,prepareTimedCaptions,projectTranscriptionUpdate,pdoc};
 const insert=project=>{db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(project.id,project.revision,JSON.stringify(project),now(),now());db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run(project.id,project.revision,JSON.stringify(project),now());};
 return{db,context,insert,pdoc};
}
const baseProject=()=>({id:'project',revision:2,settings:{width:1920,height:1080,fps:24},timeline:[{id:'trim',assetId:'source',kind:'video',trimStart:5,duration:5}],transcript:[{start:0,end:.2,text:'Previous caption'}]});

async function complete(f,interleave=()=>{},override={}){
 const id='caption-job',out='fixture-output',r={project_id:'project',revision:2,type:override.type||'transcribe'},raw={assetId:'source'};
 f.db.prepare('INSERT INTO jobs(id,project_id,revision,status,progress,stage) VALUES(?,?,?,?,?,?)').run(id,r.project_id,2,'running',.5,'transcribing');
 const segments=createCaptionPages([{start:5.25,end:6.25,text:'Retained words',words:[{start:5.25,end:5.75,word:'Retained',probability:.98},{start:5.75,end:6.25,word:' words',probability:.97}]}]);
 const result=override.result||{status:'review_required',validated:true,segments,outputs:{captions:'captions.srt',quality:'audio-evidence.json'},provenance:{mediaType:'transcript',providerId:'faster-whisper-local-cpu',modelId:'tiny.en',outputHash:'a'.repeat(64)}};
 let copies=0;
 const context={...f.context,registration:Promise.resolve(),children:new Map(),id,gpuLease:null,releaseFileLease:async()=>{},cancelling:new Set(),out,r,raw,mediaDir:'fixture-media',workerStderr:'',inputData:{},existsSync:()=>true,readFile:async path=>basename(path)==='result.json'?Buffer.from(JSON.stringify(result)):Buffer.from('Controlled worker fixture'),writeFile:async()=>{if(copies++===0)await interleave(f.db);}};
 const marker="child.on('exit',async code=>{",start=source.indexOf(marker),end=source.indexOf('\n  });\n}async function api',start);assert.ok(start>=0&&end>start,'completion callback boundary must be found');
 const callback=runInNewContext('(async code=>{'+source.slice(start+marker.length,end)+'\n})',context);await callback(0);
 return{job:f.db.prepare('SELECT * FROM jobs WHERE id=?').get(id),project:f.pdoc(f.db.prepare('SELECT * FROM projects WHERE id=?').get('project')),assets:f.db.prepare('SELECT * FROM assets').all(),copies};
}

test('actual worker page shape promotes mapped captions for the exact saved revision',async()=>{
 const f=fixture();try{f.insert(baseProject());const result=await complete(f);assert.equal(result.project.revision,3);assert.equal(result.project.transcript[0].start,.25);assert.equal(result.project.transcript[0].end,1.25);assert.equal(result.project.transcript[0].words[0].start,.25);assert.equal(result.project.transcript[0].words[1].end,1.25);assert.equal(result.project.transcriptSource.coordinateSpace,'timeline');assert.equal(JSON.parse(result.job.output).promoted,true);assert.ok(result.assets.every(a=>a.project_id==='project'));}finally{f.db.close();}
});
test('a project already stale before completion keeps its transcript and unowned result assets',async()=>{
 const f=fixture();try{const p=baseProject();p.revision=3;f.insert(p);const result=await complete(f);assert.equal(result.project.revision,3);assert.equal(result.project.transcript[0].text,'Previous caption');assert.equal(JSON.parse(result.job.output).promoted,false);assert.ok(result.assets.every(a=>a.project_id===null));}finally{f.db.close();}
});
test('an edit during awaited asset copying cannot promote stale transcription or overwrite history',async()=>{
 const f=fixture();try{f.insert(baseProject());const result=await complete(f,db=>{const p=baseProject();p.revision=3;p.timeline[0].trimStart=6;p.transcript=[{start:.1,end:.3,text:'New user correction'}];db.prepare('UPDATE projects SET revision=3,document=? WHERE id=?').run(JSON.stringify(p),'project');db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run('project',3,JSON.stringify(p),new Date().toISOString());});
  assert.equal(result.project.revision,3,'stale completion must not manufacture revision4');assert.equal(result.project.transcript[0].text,'New user correction');assert.equal(JSON.parse(result.job.output).promoted,false);assert.deepEqual(JSON.parse(result.job.output).diagnostics,['STALE_PROJECT_REVISION_OUTPUT_RETAINED']);assert.equal(result.assets.length,2);assert.ok(result.assets.every(a=>a.project_id===null&&JSON.parse(a.document).projectRevisionMatch===false));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM project_revisions').get().n,2);
 }finally{f.db.close();}
});
test('cancellation during result copying retains artifacts without reviving the job or changing the project',async()=>{
 const f=fixture();try{f.insert(baseProject());const result=await complete(f,db=>db.prepare("UPDATE jobs SET status='cancelled' WHERE id='caption-job'").run());assert.equal(result.job.status,'cancelled');assert.equal(result.project.revision,2);assert.equal(JSON.parse(result.job.output).promoted,false);assert.ok(result.assets.every(a=>a.project_id===null));}finally{f.db.close();}
});
test('a revision change immediately before the write transaction cannot overwrite another saved revision',async()=>{
 const f=fixture();try{f.insert(baseProject());let edited=false;f.context.db={prepare:sql=>f.db.prepare(sql),exec:sql=>{if(sql==='BEGIN IMMEDIATE'&&!edited){edited=true;const p=baseProject();p.revision=3;p.transcript=[{start:.1,end:.3,text:'Other writer saved'}];f.db.prepare('UPDATE projects SET revision=3,document=? WHERE id=?').run(JSON.stringify(p),'project');f.db.prepare('INSERT INTO project_revisions VALUES(?,?,?,?)').run('project',3,JSON.stringify(p),new Date().toISOString());}return f.db.exec(sql);}};
  const result=await complete(f);assert.equal(edited,true);assert.equal(result.project.revision,3);assert.equal(result.project.transcript[0].text,'Other writer saved');assert.equal(JSON.parse(result.job.output).promoted,false);assert.ok(result.assets.every(a=>a.project_id===null));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM project_revisions').get().n,2);
 }finally{f.db.close();}
});
test('ordinary render completion retains existing promotion behavior',async()=>{
 const f=fixture();try{f.insert(baseProject());const result=await complete(f,()=>{},{type:'render',result:{validated:true,status:'verified',outputs:{video:'render.mp4',poster:'poster.png'},provenance:{generationStatus:'edited',outputHash:'b'.repeat(64)}}});assert.equal(result.project.revision,3);assert.equal(result.job.status,'succeeded');assert.equal(result.project.latestOutput.provenance.outputHash,'b'.repeat(64));assert.equal(result.project.transcript[0].text,'Previous caption');assert.equal(JSON.parse(result.job.output).promoted,true);assert.ok(result.assets.every(a=>a.project_id==='project'));}finally{f.db.close();}
});
test('ordinary voiceover completion adds narration without replacing the video receipt',async()=>{
 const f=fixture();try{const p=baseProject();p.latestOutput={jobId:'existing-render',status:'reviewed'};f.insert(p);const result=await complete(f,()=>{},{type:'voiceover',result:{validated:true,status:'review_required',outputs:{audio:'narration.wav'},provenance:{mediaType:'audio',outputHash:'c'.repeat(64)}}});assert.equal(result.project.revision,3);assert.equal(result.job.status,'review_required');assert.equal(result.project.latestOutput.jobId,'existing-render');assert.equal(result.project.latestAudio.provenance.outputHash,'c'.repeat(64));assert.equal(result.project.soundtrack.assetId,result.assets[0].id);assert.equal(JSON.parse(result.job.output).promoted,true);}finally{f.db.close();}
});

async function patchProject(f,body){
 const line=source.split('\n').find(line=>line.includes('const pm=path.match('));assert.ok(line,'actual PATCH route must be found');let received;
 const context={...f.context,readBody:async()=>Buffer.from(JSON.stringify(body)),send:(res,status,value)=>{received={status,value};}};
 const handler=runInNewContext('(async(req,res,path)=>{'+line+'\n})',context);await handler({method:'PATCH'},null,'/api/projects/project');return received;
}
test('generic project PATCH accepts valid captions at frame-rounded edit duration',async()=>{
 const f=fixture();try{const p=baseProject();p.timeline=[...Array.from({length:36},(_,i)=>({id:'lead'+i,assetId:'other',kind:'video',trimStart:0,duration:.04})),{id:'end',assetId:'source',kind:'video',trimStart:5,duration:1}];f.insert(p);
  const update=projectTranscriptionUpdate({project:p,sourceAssetId:'source',jobId:'fixture',segments:[{start:5,end:6,text:'Final words'}],provenance:{}});assert.equal(update.transcript[0].end,2.5);
  const result=await patchProject(f,{expectedRevision:2,patch:{transcript:update.transcript}});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.value.transcript[0].end,2.5);
 }finally{f.db.close();}
});
test('PATCH frame duration follows patched FPS and still rejects out-of-range cues',async()=>{
 const f=fixture();try{const p=baseProject();p.timeline=Array.from({length:36},(_,i)=>({id:'clip'+i,assetId:'source',kind:'video',trimStart:0,duration:.04}));f.insert(p);
  const result=await patchProject(f,{expectedRevision:2,patch:{settings:{...p.settings,fps:30},transcript:[{start:1.25,end:1.45,text:'Past new end'}]}});assert.equal(result.status,400);assert.equal(f.db.prepare('SELECT revision FROM projects WHERE id=?').get('project').revision,2);
 }finally{f.db.close();}
});
