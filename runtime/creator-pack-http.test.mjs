import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

const root=fileURLToPath(new URL('..',import.meta.url));
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'vyrealm-creator-pack-http-')),dataDir=join(directory,'data');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const child=spawn(process.execPath,[join(root,'server.js')],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),VYRELUM_ROOT:root,VYRELUM_DATA_DIR:dataDir,VYRELUM_RUNTIME_DIR:join(directory,'runtime'),OLLAMA_HOST:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe','ipc']});
  let logs='',db;
  t.after(async()=>{db?.close();if(child.exitCode===null){const exited=once(child,'exit');if(child.connected)child.send({type:'shutdown'});const timer=setTimeout(()=>child.kill(),4000);await exited;clearTimeout(timer);}if(dirname(directory)===resolve(tmpdir())&&basename(directory).startsWith('vyrealm-creator-pack-http-'))await rm(directory,{recursive:true,force:true});});
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error(`Isolated server start timed out: ${logs}`)),12000);child.stdout.on('data',data=>{logs=(logs+data).slice(-12000);if(logs.includes('local control plane listening')){clearTimeout(timer);yes();}});child.stderr.on('data',data=>logs=(logs+data).slice(-12000));child.once('error',error=>{clearTimeout(timer);no(error);});child.once('exit',code=>{clearTimeout(timer);no(Error(`Isolated server exited ${code}: ${logs}`));});});
  const base=`http://127.0.0.1:${port}`,session=await(await fetch(base+'/api/session')).json();
  const api=async(path,method='GET',body,headers={})=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json','X-Vyrelum-Token':session.token,...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return{status:response.status,body:await response.json()};};
  db=new DatabaseSync(join(dataDir,'vyrelum.sqlite'));
  return{api,db};
}

test('creator pack HTTP trust boundaries use isolated SQLite and never start rendering', {timeout:30000},async t=>{
  const {api,db}=await fixture(t);
  const forged={assets:{thumbnail:'another-project-thumbnail',draft:'foreign-copy',manifest:'foreign-manifest'},metadata:{title:'Forged pack',description:'Unverified imported content',hashtags:'malformed-not-array'},source:{provenance:{nativeAIGeneration:true,generationStatus:'generated'}},status:'approved'};
  let project;
  await t.test('malformed imported pack is preserved only as unverified evidence',async()=>{
    const imported=await api('/api/projects/import','POST',{project:{id:'external-project',name:'Creator pack import fixture',brief:'A saved original test brief.',timeline:[],creatorPack:forged},assets:[]});
    assert.equal(imported.status,201,JSON.stringify(imported.body));project=imported.body;
    assert.equal(Object.hasOwn(project,'creatorPack'),false);
    assert.equal(project.importedCreatorPackEvidence.status,'imported-unverified');
    assert.deepEqual(project.importedCreatorPackEvidence.value,forged);
    const reopened=await api(`/api/projects/${project.id}`);assert.equal(Object.hasOwn(reopened.body,'creatorPack'),false);assert.equal(reopened.body.importedCreatorPackEvidence.status,'imported-unverified');
    assert.equal((await api('/api/jobs')).body.length,0);
  });
  await t.test('both generic project patch formats reject forged active creator packs',async()=>{
    for(const body of [{expectedRevision:1,patch:{creatorPack:forged}},{expectedRevision:1,creatorPack:forged}]){
      const response=await api(`/api/projects/${project.id}`,'PATCH',body);assert.equal(response.status,400);assert.match(response.body.error,/managed by workers/);
    }
    assert.equal((await api(`/api/projects/${project.id}`)).body.revision,1);
  });
  await t.test('admission rejects arbitrary file paths, stale revision, missing output and foreign origin before job creation',async()=>{
    const path=`/api/projects/${project.id}/creator-pack`;
    assert.equal((await api(path,'POST',{expectedRevision:1,videoPath:'C:/private-source.mp4'})).body.code,'CREATOR_PACK_REVISION');
    assert.equal((await api(path,'POST',{expectedRevision:99})).body.code,'CREATOR_PACK_REVISION');
    assert.equal((await api(path,'POST',{expectedRevision:1})).body.code,'CREATOR_PACK_SOURCE');
    assert.equal((await api(path,'POST',{expectedRevision:1},{origin:'https://foreign.example'})).status,403);
    assert.equal((await api('/api/jobs')).body.length,0);
  });
  await t.test('generic cancel cannot falsely cancel an active creator pack',async()=>{
    const time=new Date().toISOString();db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('pack-running-fixture',project.id,1,'creator-pack','running',0,'Fixture only; no worker exists','{}',1,time,time);
    const response=await api('/api/jobs/pack-running-fixture/cancel','POST',{});assert.equal(response.status,409);assert.equal(response.body.code,'CREATOR_PACK_CONTROL');
    const row=db.prepare('SELECT status,attempts,stage FROM jobs WHERE id=?').get('pack-running-fixture');assert.equal(row.status,'running');assert.equal(row.attempts,1);assert.equal(row.stage,'Fixture only; no worker exists');
  });
  await t.test('generic retry cannot send a failed creator pack to the render dispatcher',async()=>{
    const time=new Date().toISOString();db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('pack-failed-fixture',project.id,1,'creator-pack','failed',0,'Fixture only; no worker exists','{}',1,time,time);
    const response=await api('/api/jobs/pack-failed-fixture/retry','POST',{});assert.equal(response.status,409);assert.equal(response.body.code,'CREATOR_PACK_CONTROL');
    const row=db.prepare('SELECT status,attempts,stage FROM jobs WHERE id=?').get('pack-failed-fixture');assert.equal(row.status,'failed');assert.equal(row.attempts,1);assert.equal(row.stage,'Fixture only; no worker exists');
    assert.equal((await api(`/api/projects/${project.id}`)).body.revision,1);
  });
});
