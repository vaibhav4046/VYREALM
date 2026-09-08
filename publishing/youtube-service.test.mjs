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

test('durable upload resolves the reviewed owned output and never accepts a supplied filesystem path',async t=>{
 const f=await fixture(t);await call(f.service,'/api/youtube/config','POST',{installed:{client_id:ID}});f.connected();const bytes=Buffer.alloc(100,7),sha=crypto.createHash('sha256').update(bytes).digest('hex'),file=path.join(f.mediaDir,'reviewed.mp4');await fs.writeFile(file,bytes);
 const receipt={provenance:{outputHash:sha},review:{verdict:'passed',outputHash:sha},assets:{video:'asset-1'}};
 f.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('project-1',4,JSON.stringify({latestOutput:{videoAssetId:'asset-1',jobId:'source-job',status:'reviewed',provenance:{outputHash:sha}}}),'now','now');
 f.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?)').run('asset-1','project-1',JSON.stringify({mime:'video/mp4',jobId:'source-job'}),file,'now');
 f.db.prepare('INSERT INTO jobs(id,project_id,revision,type,status,output,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('source-job','project-1',3,'render','succeeded',JSON.stringify(receipt),'now','now');
 const body={projectId:'project-1',expectedRevision:4,expectedOutputHash:sha,expectedChannelId:CHANNEL,confirmed:true,containsSyntheticMedia:true,metadata:{title:'Reviewed original'}};
 assert.equal((await call(f.service,'/api/youtube/upload','POST',{...body,filePath:'C:/secret.txt'})).status,400);
 assert.equal((await call(f.service,'/api/youtube/upload','POST',{...body,expectedRevision:3})).status,409);
 const created=await call(f.service,'/api/youtube/upload','POST',body);assert.equal(created.status,202);const id=created.body.id;assert.equal(f.db.prepare('SELECT type FROM jobs WHERE id=?').get(id).type,'youtube-upload');
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
