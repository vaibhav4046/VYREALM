import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

const root=fileURLToPath(new URL('..',import.meta.url));
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'vyrealm-thumbnail-http-')),dataDir=join(directory,'data');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const child=spawn(process.execPath,[join(root,'server.js')],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),VYRELUM_ROOT:root,VYRELUM_DATA_DIR:dataDir,VYRELUM_RUNTIME_DIR:join(directory,'runtime'),OLLAMA_HOST:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe','ipc']});
  let logs='',db;
  t.after(async()=>{db?.close();if(child.exitCode===null){const exited=once(child,'exit');if(child.connected)child.send({type:'shutdown'});const timer=setTimeout(()=>child.kill(),4000);await exited;clearTimeout(timer);}if(dirname(directory)===resolve(tmpdir())&&basename(directory).startsWith('vyrealm-thumbnail-http-'))await rm(directory,{recursive:true,force:true});});
  await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error(`Isolated server start timed out: ${logs}`)),12000);child.stdout.on('data',data=>{logs=(logs+data).slice(-12000);if(logs.includes('local control plane listening')){clearTimeout(timer);yes();}});child.stderr.on('data',data=>logs=(logs+data).slice(-12000));child.once('error',error=>{clearTimeout(timer);no(error);});child.once('exit',code=>{clearTimeout(timer);no(Error(`Isolated server exited ${code}: ${logs}`));});});
  const base=`http://127.0.0.1:${port}`,session=await(await fetch(base+'/api/session')).json();
  const api=async(path,method='GET',body,headers={})=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json','X-Vyrelum-Token':session.token,...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});return{status:response.status,body:await response.json()};};
  db=new DatabaseSync(join(dataDir,'vyrelum.sqlite'));
  return{api,db,base,dataDir};
}

test('thumbnail HTTP generation, streaming, trust boundaries and job controls', { timeout: 30000 }, async t => {
  const { api, db, base, dataDir } = await fixture(t);
  const moduleResponse = await fetch(base + '/thumbnail-studio.js');
  assert.equal(moduleResponse.status, 200); assert.match(await moduleResponse.text(), /createThumbnailStudio/);
  const forged = { assets: { upload: 'foreign-asset' }, sourceHash: '0'.repeat(64), publishing: { state: 'uploaded', videoId: 'abcdefghijk' } };
  const imported = await api('/api/projects/import', 'POST', { project: { name: 'Thumbnail HTTP', brief: 'A quiet morning', timeline: [], thumbnailStudio: forged }, assets: [] });
  assert.equal(imported.status, 201, JSON.stringify(imported.body)); const project = imported.body;
  assert.equal(Object.hasOwn(project, 'thumbnailStudio'), false); assert.equal(project.importedThumbnailStudio.status, 'imported-unverified');
  for (const body of [{ expectedRevision: 1, patch: { thumbnailStudio: forged } }, { expectedRevision: 1, thumbnailStudio: forged }]) assert.equal((await api(`/api/projects/${project.id}`, 'PATCH', body)).status, 400);
  const route = `/api/projects/${project.id}/thumbnails`;
  for (const body of [null, [], { expectedRevision: 1, source: 'prompt', videoPath: 'C:/private.mp4' }]) assert.equal((await api(route, 'POST', body)).body.code, 'THUMBNAIL_REQUEST');
  assert.equal((await api(route, 'POST', { expectedRevision: 2, source: 'prompt' })).body.code, 'THUMBNAIL_REVISION');
  assert.equal((await api(route, 'POST', { expectedRevision: 1, source: 'prompt' }, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await api(route, 'POST', { expectedRevision: 1, source: 'image', imageAssetId: 'foreign-asset' })).body.code, 'THUMBNAIL_SOURCE');
  const source = join(dataDir, 'media', 'source.mp4');
  await promisify(execFile)(join(root, 'workers/tools/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=10:d=1', '-c:v', 'libx264', '-threads', '1', source], { windowsHide: true });
  const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
  db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run('owned-video', project.id, JSON.stringify({ mime: 'video/mp4', kind: 'video' }), source, new Date().toISOString());
  const document = JSON.parse(db.prepare('SELECT document FROM projects WHERE id=?').get(project.id).document);
  document.latestOutput = { videoAssetId: 'owned-video', status: 'reviewed', provenance: { outputHash: sourceHash } };
  db.prepare('UPDATE projects SET document=? WHERE id=?').run(JSON.stringify(document), project.id);
  const generated = await api(route, 'POST', { expectedRevision: 1, source: 'video', title: 'A quiet morning' });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  const thumbnail = generated.body.thumbnail; assert.equal(thumbnail.sourceHash, sourceHash); assert.equal(thumbnail.artifacts.master.width, 3840);
  const image = await fetch(base + '/media/' + thumbnail.assets.upload), bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(image.headers.get('content-type'), 'image/jpeg'); assert.equal(bytes.length, thumbnail.artifacts.upload.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), thumbnail.artifacts.upload.sha256);
  assert.equal((await api(`/api/thumbnail/projects/${project.id}`)).body.thumbnail.jobId, thumbnail.jobId);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(thumbnail.jobId).status, 'succeeded');
  db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(thumbnail.jobId);
  const cancel = await api(`/api/jobs/${thumbnail.jobId}/cancel`, 'POST', {}); assert.equal(cancel.status, 409);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(thumbnail.jobId).status, 'running');
  db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(thumbnail.jobId);
  const retry = await api(`/api/jobs/${thumbnail.jobId}/retry`, 'POST', {}); assert.equal(retry.status, 409);
  assert.equal(db.prepare('SELECT attempts FROM jobs WHERE id=?').get(thumbnail.jobId).attempts, 1);
});


