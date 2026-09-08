import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createYouTubeService } from './youtube-service.mjs';
import { youtubeError } from './youtube-errors.mjs';

const ID = '123456-vyrealm.apps.googleusercontent.com', CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';
async function fixture(t) {
 const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-youtube-service-')), mediaDir=path.join(dataDir,'media'); await fs.mkdir(mediaDir);
 const db=new DatabaseSync(path.join(dataDir,'projects.sqlite'));db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY,revision INTEGER,document TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT,document TEXT,path TEXT,created_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,revision INTEGER,type TEXT,status TEXT,progress REAL,stage TEXT,input TEXT,output TEXT,error TEXT,attempts INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT)');
 t.after(async()=>{db.close();if(path.dirname(dataDir)===path.resolve(os.tmpdir())&&path.basename(dataDir).startsWith('vyrealm-youtube-service-'))await fs.rm(dataDir,{recursive:true,force:true});});
 let data={},connected=false,complete; const calls=[];
 const vault={protection:()=>({protected:true,qualified:true,mechanism:'test-only'}),read:async()=>structuredClone(data),write:async x=>{data=structuredClone(x);},close(){}};
 const client={status:async()=>({configured:true,connected,code:connected?'YOUTUBE_AUTH_STORED':'YOUTUBE_NOT_CONNECTED'}),configureDesktopCredentials:async x=>{data.oauthClient=x.installed;return {configured:true,secretStored:true};},beginAuthorization:async()=>({authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?test=1',expiresAt:Date.now()+60000,completion:new Promise(resolve=>{complete=()=>{connected=true;resolve({connected:true,code:'YOUTUBE_AUTH_STORED'});};}),cancel:()=>{}}),disconnect:async()=>{connected=false;return {connected:false};},channels:async()=>[{id:CHANNEL,title:'My original channel'}],analytics:async x=>({status:'available',...x,columnHeaders:[],rows:[]}),beginPrivateUpload:async x=>{calls.push(x);return {id:'upload-1',state:'uploading',bytesTotal:100,bytesUploaded:0};},resumeUpload:async()=>({id:'upload-1',state:'uploaded_private',videoId:'abcdefghijk',bytesTotal:100,bytesUploaded:100,channelId:CHANNEL}),listUploads:async()=>[]};
 const service=await createYouTubeService({dataDir,mediaDir,db,vaultFactory:()=>vault,clientFactory:()=>client});
 return {service,db,dataDir,mediaDir,calls,complete:()=>complete(),connected:()=>{connected=true;},vault,client};
}
const call=(service,pathname,method='GET',body={},query={})=>service.handle({pathname,method,body,searchParams:new URLSearchParams(query)});

async function thumbnailFixture(t) {
 const f=await fixture(t),projectId='thumbnail-project',uploadJobId='private-video-job',thumbnailJobId='thumbnail-job',assetId='thumbnail-jpeg';
 const folder=path.join(f.dataDir,'jobs',thumbnailJobId);await fs.mkdir(folder,{recursive:true});
 const file=path.join(folder,'upload.jpg'),bytes=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4,0xff,0xd9]);await fs.writeFile(file,bytes);
 const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),sourceHash='a'.repeat(64);
 const upload={id:'retained-upload',state:'uploaded_private',videoId:'abcdefghijk',channelId:CHANNEL,sha256:sourceHash,privacyStatus:'private',bytesTotal:100,bytesUploaded:100,processingVerified:true,processing:{status:'succeeded'}};
 const thumbnail={sourceHash,artifacts:{upload:{mime:'image/jpeg',sha256}},assets:{upload:assetId}};
 const asset={jobId:thumbnailJobId,mime:'image/jpeg',provenance:{outputHash:sha256}};
 f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(projectId,4,JSON.stringify({id:projectId,title:'An owned film'}),'now','now');
 const insert=f.db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,output,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 insert.run(uploadJobId,projectId,4,'youtube-upload','succeeded',1,'Private video verified','{}',JSON.stringify(upload),'now','now');
 insert.run(thumbnailJobId,projectId,4,'thumbnail','succeeded',1,'Thumbnail prepared','{}',JSON.stringify(thumbnail),'now','now');
 f.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run(assetId,projectId,JSON.stringify(asset),file,'now');
 const result={...upload,thumbnail:{status:'uploaded',videoId:upload.videoId,sourceHash,thumbnailHash:sha256,uploadedAt:'2026-09-08T10:00:00.000Z'}};
 const body={thumbnailJobId,expectedThumbnailHash:sha256,confirmed:true};
 return {...f,projectId,uploadJobId,thumbnailJobId,assetId,file,asset,thumbnail,upload,result,body,endpoint:`/api/youtube/uploads/${uploadJobId}/thumbnail`};
}

test('thumbnail attachment requires explicit exact confirmation and persists the canonical owned JPEG receipt',async t=>{
 const f=await thumbnailFixture(t),attachments=[];
 f.client.setThumbnail=async(id,input)=>{attachments.push({id,input});return f.result;};
 for(const body of [{...f.body,confirmed:false},{...f.body,expectedThumbnailHash:'b'.repeat(64)},{...f.body,filePath:'C:/unrelated.jpg'}]){
  const rejected=await call(f.service,f.endpoint,'POST',body);assert.notEqual(rejected.status,200);
 }
 assert.equal(attachments.length,0);
 const response=await call(f.service,f.endpoint,'POST',f.body);assert.equal(response.status,200);assert.equal(attachments.length,1);
 assert.equal(attachments[0].id,f.upload.id);assert.equal(attachments[0].input.filePath,await fs.realpath(f.file));assert.deepEqual(attachments[0].input.thumbnail,f.thumbnail);
 const reopened=new DatabaseSync(path.join(f.dataDir,'projects.sqlite'));
 try{
  const stored=reopened.prepare('SELECT * FROM jobs WHERE id=?').get(f.uploadJobId),output=JSON.parse(stored.output);
  assert.equal(stored.status,'succeeded');assert.equal(output.videoId,f.upload.videoId);assert.equal(output.sha256,f.upload.sha256);
  assert.deepEqual(output.thumbnail,{...f.result.thumbnail,jobId:f.thumbnailJobId,assetId:f.assetId});
  assert.equal(reopened.prepare("SELECT count(*) n FROM jobs WHERE type='youtube-upload'").get().n,1);
  assert.equal(reopened.prepare('SELECT revision FROM projects WHERE id=?').get(f.projectId).revision,4);
 }finally{reopened.close();}
 assert.equal(f.calls.length,0);
});

test('thumbnail attachment rejects foreign receipts, changed sources and files outside their owned job before the client runs',async t=>{
 const f=await thumbnailFixture(t);let attachments=0;f.client.setThumbnail=async()=>{attachments++;return f.result;};
 const restore=()=>{
  f.db.prepare('UPDATE jobs SET project_id=?,output=? WHERE id=?').run(f.projectId,JSON.stringify(f.thumbnail),f.thumbnailJobId);
  f.db.prepare('UPDATE assets SET project_id=?,document=?,path=? WHERE id=?').run(f.projectId,JSON.stringify(f.asset),f.file,f.assetId);
 };
 const outside=path.join(f.dataDir,'outside.jpg');await fs.copyFile(f.file,outside);
 const cases=[
  {code:'YOUTUBE_THUMBNAIL_MISMATCH',mutate:()=>f.db.prepare('UPDATE jobs SET project_id=? WHERE id=?').run('another-project',f.thumbnailJobId)},
  {code:'YOUTUBE_THUMBNAIL_MISMATCH',mutate:()=>f.db.prepare('UPDATE jobs SET output=? WHERE id=?').run(JSON.stringify({...f.thumbnail,sourceHash:'b'.repeat(64)}),f.thumbnailJobId)},
  {code:'YOUTUBE_THUMBNAIL_MISMATCH',mutate:()=>f.db.prepare('UPDATE assets SET document=? WHERE id=?').run(JSON.stringify({...f.asset,jobId:'another-job'}),f.assetId)},
  {code:'YOUTUBE_THUMBNAIL_MISMATCH',mutate:()=>f.db.prepare('UPDATE assets SET project_id=? WHERE id=?').run('another-project',f.assetId)},
  {code:'YOUTUBE_ASSET_BOUNDARY',mutate:()=>f.db.prepare('UPDATE assets SET path=? WHERE id=?').run(outside,f.assetId)},
  {code:'YOUTUBE_LOCAL_SERVICE_FAILED',mutate:()=>f.db.prepare('UPDATE assets SET path=? WHERE id=?').run(path.join(path.dirname(f.file),'missing.jpg'),f.assetId)}
 ];
 for(const item of cases){restore();item.mutate();const response=await call(f.service,f.endpoint,'POST',f.body);assert.notEqual(response.status,200);assert.equal(response.body.code,item.code);assert.equal(attachments,0);}
 assert.deepEqual(JSON.parse(f.db.prepare('SELECT output FROM jobs WHERE id=?').get(f.uploadJobId).output),f.upload);assert.equal(f.calls.length,0);
});

test('thumbnail attachment never accepts a client confirmation for a different video, channel or hash',async t=>{
 const f=await thumbnailFixture(t);let attachments=0;
 for(const mismatch of [{videoId:'zyxwvutsrqp'},{channelId:'UCbbbbbbbbbbbbbbbbbbbbbb'},{sha256:'b'.repeat(64)},{thumbnail:{...f.result.thumbnail,thumbnailHash:'b'.repeat(64)}}]){
  f.db.prepare('UPDATE jobs SET output=? WHERE id=?').run(JSON.stringify(f.upload),f.uploadJobId);
  f.client.setThumbnail=async()=>{attachments++;return {...f.result,...mismatch};};
  const response=await call(f.service,f.endpoint,'POST',f.body);assert.equal(response.status,409);assert.equal(response.body.code,'YOUTUBE_UPLOAD_RECEIPT_MISMATCH');
  const row=f.db.prepare('SELECT * FROM jobs WHERE id=?').get(f.uploadJobId),retained=JSON.parse(row.output);
  assert.equal(row.status,'succeeded');assert.equal(retained.videoId,f.upload.videoId);assert.equal(retained.channelId,CHANNEL);assert.equal(retained.sha256,f.upload.sha256);assert.equal(retained.bytesUploaded,100);
  assert.equal(retained.thumbnail.status,'failed');assert.equal(retained.thumbnail.code,'YOUTUBE_UPLOAD_RECEIPT_MISMATCH');
 }
 assert.equal(attachments,4);assert.equal(f.calls.length,0);
});

test('thumbnail permission failure retains the existing private video and retry attaches only the thumbnail',async t=>{
 const f=await thumbnailFixture(t);let attachments=0;
 f.client.setThumbnail=async()=>{attachments++;throw youtubeError('THUMBNAIL_PERMISSION','Custom thumbnails are not enabled for this channel.');};
 const failed=await call(f.service,f.endpoint,'POST',f.body);assert.equal(failed.status,409);assert.equal(failed.body.code,'THUMBNAIL_PERMISSION');
 const row=f.db.prepare('SELECT * FROM jobs WHERE id=?').get(f.uploadJobId),retained=JSON.parse(row.output);
 assert.equal(row.status,'succeeded');assert.equal(retained.id,f.upload.id);assert.equal(retained.videoId,f.upload.videoId);assert.equal(retained.sha256,f.upload.sha256);assert.equal(retained.bytesUploaded,100);assert.equal(retained.privacyStatus,'private');assert.equal(retained.processingVerified,true);
 assert.equal(retained.thumbnail.status,'failed');assert.equal(retained.thumbnail.code,'THUMBNAIL_PERMISSION');
 f.client.setThumbnail=async(id,input)=>{attachments++;assert.equal(id,f.upload.id);assert.equal(input.filePath,await fs.realpath(f.file));return f.result;};
 const retried=await call(f.service,f.endpoint,'POST',f.body);assert.equal(retried.status,200);assert.equal(retried.body.output.thumbnail.status,'uploaded');assert.equal(attachments,2);
 assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE type='youtube-upload'").get().n,1);assert.equal(f.calls.length,0);
});

test('per-user Desktop configuration is public-only on disk and survives reopening',async t=>{
 const f=await fixture(t);const configured=await call(f.service,'/api/youtube/config','POST',{installed:{client_id:ID,client_secret:'SECRET_ONLY_IN_VAULT'}});assert.equal(configured.status,200);assert.equal(JSON.stringify(configured.body).includes('SECRET_ONLY'),false);
 const saved=await fs.readFile(path.join(f.dataDir,'integrations','youtube-client.json'),'utf8');assert.equal(saved.includes(ID),true);assert.equal(saved.includes('SECRET_ONLY'),false);
 const state=(await call(f.service,'/api/youtube/status')).body;assert.equal(state.profile,'local-user');assert.equal(state.clientId,ID);assert.equal(state.connectedChannel,null);
 f.connected();assert.equal((await call(f.service,'/api/youtube/config','POST',{installed:{client_id:ID}})).status,409);
});

test('authorization polling records an actual channel readback and requires disconnect to change account',async t=>{
 const f=await fixture(t);await call(f.service,'/api/youtube/config','POST',{installed:{client_id:ID}});
 const flow=await call(f.service,'/api/youtube/authorize','POST',{features:['upload','analytics']});assert.equal(flow.status,202);assert.equal(flow.body.authorizationUrl.startsWith('https://accounts.google.com/'),true);
 assert.equal((await call(f.service,'/api/youtube/status')).body.auth.phase,'pending');f.complete();await new Promise(resolve=>setTimeout(resolve,10));
 const status=(await call(f.service,'/api/youtube/status')).body;assert.equal(status.connectedChannel.id,CHANNEL);assert.equal(status.auth.phase,'connected');
 assert.equal((await call(f.service,'/api/youtube/authorize','POST',{features:['upload']})).status,409);
 await call(f.service,'/api/youtube/disconnect','POST');assert.equal((await call(f.service,'/api/youtube/status')).body.connectedChannel,null);
});

test('analytics input is restricted to supported query fields and does not invent results',async t=>{
 const f=await fixture(t);await call(f.service,'/api/youtube/config','POST',{installed:{client_id:ID}});
 const report=await call(f.service,'/api/youtube/analytics','GET',{}, {startDate:'2026-09-01',endDate:'2026-09-02',videoId:'abcdefghijk'});assert.equal(report.body.videoId,'abcdefghijk');assert.equal(report.body.status,'available');
 assert.equal((await call(f.service,'/api/youtube/analytics','GET',{}, {channelId:'other'})).status,400);
});

test('explicit verification reads the current channel and bound disconnect refuses a changed identity',async t=>{
 const f=await fixture(t);await call(f.service,'/api/youtube/config','POST',{installed:{client_id:ID}});f.connected();
 const verified=await call(f.service,'/api/youtube/verify','POST');assert.equal(verified.status,200);assert.equal(verified.body.channelVerification.status,'verified');assert.equal(verified.body.connectedChannel.id,CHANNEL);
 assert.equal((await call(f.service,'/api/youtube/disconnect','POST',{expectedChannelId:'UCbbbbbbbbbbbbbbbbbbbbbb'})).body.code,'YOUTUBE_CHANNEL_MISMATCH');assert.equal((await call(f.service,'/api/youtube/status')).body.connected,true);
 assert.equal((await call(f.service,'/api/youtube/disconnect','POST',{expectedChannelId:CHANNEL})).body.connected,false);
});

test('different local profiles cannot inherit another profile channel or uploaded file',async t=>{
 const first=await fixture(t),second=await fixture(t);first.connected();await call(first.service,'/api/youtube/verify','POST');
 assert.equal((await call(second.service,'/api/youtube/status')).body.connected,false);assert.equal((await call(second.service,'/api/youtube/status')).body.connectedChannel,null);
 const missing=await call(second.service,'/api/youtube/uploads/other-profile-job/verify','POST');assert.equal(missing.status,404);
});

for(const reason of ['YOUTUBE_UPLOAD_CHANNEL_MISMATCH','YOUTUBE_UPLOAD_PRIVACY_CHANGED','YOUTUBE_NETWORK_FAILED','YOUTUBE_UPLOAD_RECEIPT_MISMATCH']){
 test(`a previously verified private receipt is invalidated durably after ${reason}`,async t=>{
  const f=await fixture(t),jobId=crypto.randomUUID(),sha='a'.repeat(64);
  const receipt={id:'retained-upload',state:'uploaded_private',videoId:'abcdefghijk',channelId:CHANNEL,sha256:sha,privacyStatus:'private',bytesTotal:100,bytesUploaded:100,processingVerified:false};
  f.db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,progress,stage,input,output,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(jobId,'owned-project',4,'youtube-upload','succeeded',1,'Transfer completed','{}',JSON.stringify(receipt),'now','now');
  let failure=false,checks=0;
  f.client.verifyUploadedVideo=async id=>{
   assert.equal(id,receipt.id);checks++;
   if(failure){
    if(reason==='YOUTUBE_UPLOAD_RECEIPT_MISMATCH')return {...receipt,channelId:'UCbbbbbbbbbbbbbbbbbbbbbb',processingVerified:true,processing:{status:'succeeded'}};
    throw youtubeError(reason,'Fixture current verification failed.');
   }
   return {...receipt,processingVerified:true,processing:{status:'succeeded',checkedAt:'2026-09-08T10:00:00.000Z',source:'youtube-data-api'}};
  };
  const endpoint=`/api/youtube/uploads/${jobId}/verify`;
  const first=await call(f.service,endpoint,'POST');assert.equal(first.status,200);assert.equal(first.body.output.processingVerified,true);assert.equal(first.body.output.privacyStatus,'private');
  failure=true;const failed=await call(f.service,endpoint,'POST');assert.equal(failed.status,409);assert.equal(failed.body.code,reason);
  // Read from another SQLite connection: the invalidation must survive app reopening, not just alter a response.
  const reopened=new DatabaseSync(path.join(f.dataDir,'projects.sqlite'));
  try{
   const row=reopened.prepare('SELECT * FROM jobs WHERE id=?').get(jobId),retained=JSON.parse(row.output);
   assert.equal(row.status,'succeeded');assert.match(row.stage,/current privacy and processing are unverified/i);
   assert.equal(retained.processingVerified,false);assert.equal(retained.privacyStatus,'unverified');assert.equal(retained.processing.status,'unverified');assert.equal(retained.processing.code,reason);assert.ok(Number.isFinite(Date.parse(retained.processing.checkedAt)));
   assert.equal(retained.id,receipt.id);assert.equal(retained.videoId,receipt.videoId);assert.equal(retained.channelId,CHANNEL);assert.equal(retained.sha256,sha);assert.equal(retained.bytesUploaded,100);assert.equal(retained.state,'uploaded_private');
  }finally{reopened.close();}
  failure=false;const fresh=await call(f.service,endpoint,'POST');assert.equal(fresh.status,200);assert.equal(fresh.body.output.processingVerified,true);assert.equal(fresh.body.output.privacyStatus,'private');assert.equal(checks,3);assert.equal(f.calls.length,0);
 });
}

test('durable upload resolves the reviewed owned output and never accepts a supplied filesystem path',async t=>{
 const f=await fixture(t);await call(f.service,'/api/youtube/config','POST',{installed:{client_id:ID}});f.connected();const bytes=Buffer.alloc(100,7),sha=crypto.createHash('sha256').update(bytes).digest('hex'),file=path.join(f.mediaDir,'reviewed.mp4');await fs.writeFile(file,bytes);
 const receipt={provenance:{outputHash:sha},review:{verdict:'passed',outputHash:sha},assets:{video:'asset-1'}};
 f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-1',4,JSON.stringify({latestOutput:{videoAssetId:'asset-1',jobId:'source-job',status:'reviewed',provenance:{outputHash:sha}}}),'now','now');
 f.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run('asset-1','project-1',JSON.stringify({mime:'video/mp4',jobId:'source-job'}),file,'now');
 f.db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,output,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('source-job','project-1',3,'render','succeeded',JSON.stringify(receipt),'now','now');
 const body={projectId:'project-1',expectedRevision:4,expectedOutputHash:sha,expectedChannelId:CHANNEL,confirmed:true,containsSyntheticMedia:true,metadata:{title:'Reviewed original'},requestId:crypto.randomUUID()};
 assert.equal((await call(f.service,'/api/youtube/upload','POST',{...body,filePath:'C:/secret.txt'})).status,400);
 assert.equal((await call(f.service,'/api/youtube/upload','POST',{...body,expectedRevision:3})).status,409);
 const created=await call(f.service,'/api/youtube/upload','POST',body);assert.equal(created.status,202);const id=created.body.id;assert.equal(f.db.prepare('SELECT type FROM jobs WHERE id=?').get(id).type,'youtube-upload');
 const same=await call(f.service,'/api/youtube/upload','POST',body);assert.equal(same.body.id,id);assert.equal(f.db.prepare("SELECT count(*) n FROM jobs WHERE type='youtube-upload'").get().n,1);
 assert.equal((await call(f.service,'/api/youtube/upload','POST',{...body,metadata:{title:'Changed request'}})).body.code,'YOUTUBE_REQUEST_CONFLICT');
 await f.service.runJob(id);assert.equal(f.calls[0].filePath,file);assert.equal(f.calls[0].sha256,sha);assert.equal(f.db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'succeeded');
 assert.equal(f.db.prepare('SELECT revision FROM projects WHERE id=?').get('project-1').revision,4);
});

test('isolated actual HTTP API configures DPAPI, starts and cancels OAuth without contacting Google',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-youtube-http-'));const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:String(port),VYRELUM_DATA_DIR:dataDir,VYRELUM_RUNTIME_DIR:path.join(dataDir,'runtime'),OLLAMA_HOST:'http://127.0.0.1:1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const closed=new Promise(resolve=>child.once('close',resolve));
 t.after(async()=>{if(child.exitCode===null)child.send({type:'shutdown'});let timer;const ended=await Promise.race([closed.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);clearTimeout(timer);if(!ended){child.kill();await closed;}assert.equal(logs.includes('GOCSPX_TEST_FAKE_HTTP_SECRET'),false);if(path.dirname(dataDir)===path.resolve(os.tmpdir())&&path.basename(dataDir).startsWith('vyrealm-youtube-http-'))await fs.rm(dataDir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;let session;for(let i=0;i<80;i++){try{session=await(await fetch(base+'/api/session',{signal:AbortSignal.timeout(500)})).json();break;}catch{if(child.exitCode!==null)throw new Error('Isolated server did not start');await new Promise(resolve=>setTimeout(resolve,100));}}
 assert.ok(session?.token);const headers={'X-Vyrelum-Token':session.token,'Content-Type':'application/json'};
 const api=async(p,method='GET',body)=>{const r=await fetch(base+p,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.json()};};
 assert.equal((await fetch(base+'/api/youtube/status')).status,401);
 assert.equal((await api('/api/youtube/status')).body.code,'YOUTUBE_CLIENT_NOT_CONFIGURED');
 assert.equal((await api('/api/youtube/config','POST',{web:{client_id:ID}})).status,400);
 if(process.platform!=='win32'){assert.equal((await api('/api/youtube/config','POST',{installed:{client_id:ID}})).status,409);return;}
 const configured=await api('/api/youtube/config','POST',{installed:{client_id:ID,client_secret:'GOCSPX_TEST_FAKE_HTTP_SECRET'}});assert.equal(configured.status,200);assert.equal(JSON.stringify(configured.body).includes('TEST_FAKE_HTTP_SECRET'),false);
 const files=await fs.readdir(path.join(dataDir,'integrations'));for(const file of files)assert.equal((await fs.readFile(path.join(dataDir,'integrations',file),'utf8')).includes('GOCSPX_TEST_FAKE_HTTP_SECRET'),false);
 const flow=await api('/api/youtube/authorize','POST',{features:['upload','analytics']});assert.equal(flow.status,202);assert.equal(new URL(flow.body.authorizationUrl).hostname,'accounts.google.com');assert.equal((await api('/api/youtube/status')).body.auth.phase,'pending');
 assert.equal((await api('/api/youtube/disconnect','POST',{})).body.connected,false);assert.equal((await api('/api/jobs')).body.length,0);
 const analytics=await api('/api/youtube/analytics?startDate=2026-09-01&endDate=2026-09-02');assert.equal(analytics.status,409);assert.equal(analytics.body.code,'YOUTUBE_NOT_CONNECTED');
});
