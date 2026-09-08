import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createYouTubeClient } from './youtube-client.mjs';
import { createYouTubeService } from './youtube-service.mjs';
import { validatePublisherDesktopConfig, readPublisherDesktopConfig } from './youtube-desktop-config.mjs';

const CLIENT='123456-publisher.apps.googleusercontent.com', OTHER='123456-developer.apps.googleusercontent.com';
const SECRET='fixture_release_registration_value';
const configuration={installed:{client_id:CLIENT,project_id:'vyrealm-test',client_secret:SECRET,auth_uri:'https://accounts.google.com/o/oauth2/auth',token_uri:'https://oauth2.googleapis.com/token',auth_provider_x509_cert_url:'https://www.googleapis.com/oauth2/v1/certs',redirect_uris:['http://localhost']}};

async function fixture(t,{existing,stored={}}={}){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-desktop-config-'));
 const db=new DatabaseSync(':memory:');let data=structuredClone(stored),writes=0,network=0;
 const vault={protection:()=>({protected:true,qualified:true,mechanism:'isolated-test'}),read:async()=>structuredClone(data),write:async value=>{writes++;data=structuredClone(value);},close(){}};
 const configurationPath=path.join(dataDir,'integrations','youtube-client.json'),publisherConfigPath=path.join(dataDir,'release-desktop.json');
 await fs.writeFile(publisherConfigPath,JSON.stringify(configuration));
 if(existing!==undefined){await fs.mkdir(path.dirname(configurationPath),{recursive:true});await fs.writeFile(configurationPath,typeof existing==='string'?existing:JSON.stringify(existing));}
 const factory=options=>createYouTubeClient({...options,transport:async()=>{network++;throw new Error('No network is allowed during bootstrap.');}});
 const start=()=>createYouTubeService({dataDir,mediaDir:path.join(dataDir,'media'),db,publisherConfigPath,vaultFactory:()=>vault,clientFactory:factory});
 t.after(async()=>{db.close();if(path.dirname(dataDir)===path.resolve(os.tmpdir())&&path.basename(dataDir).startsWith('vyrealm-desktop-config-'))await fs.rm(dataDir,{recursive:true,force:true});});
 return {dataDir,publisherConfigPath,configurationPath,start,state:()=>structuredClone(data),writes:()=>writes,network:()=>network};
}

test('release Desktop configuration accepts Google installed export and strips unused metadata',()=>{
 assert.deepEqual(validatePublisherDesktopConfig(configuration),{installed:{client_id:CLIENT,client_secret:SECRET}});
 for(const bad of [
  {web:configuration.installed}, {...configuration,tokens:{refresh_token:'never_import'}},
  {installed:{...configuration.installed,access_token:'never_import'}},
  {installed:{...configuration.installed,token_uri:'https://unrelated.example/token'}},
  {installed:{...configuration.installed,auth_uri:'https://accounts.google.com.evil.example/auth'}},
  {installed:{...configuration.installed,redirect_uris:['https://unrelated.example/callback']}},
  {installed:{...configuration.installed,client_secret:'bad\nsecret'}},
  {installed:{...configuration.installed,client_id:'not-a-google-client'}},
  {installed:{...configuration.installed,client_secret:undefined}},
 ])assert.throws(()=>validatePublisherDesktopConfig(bad),error=>error.code==='YOUTUBE_PUBLISHER_CONFIGURATION_INVALID'&&!error.message.includes(SECRET));
});

test('fresh profile is configured offline and remains disconnected; only public registration metadata is persisted outside the vault',async t=>{
 const f=await fixture(t),service=await f.start();const status=await service.readConnection();
 assert.equal(status.configured,true);assert.equal(status.connected,false);assert.equal(status.registrationSource,'bundled');assert.equal(status.credentialsBundled,true);assert.equal(status.clientId,CLIENT);
 assert.deepEqual(f.state().oauthClient,{clientId:CLIENT,clientSecret:SECRET});assert.equal(f.state().tokens,undefined);
 const saved=JSON.parse(await fs.readFile(f.configurationPath,'utf8'));
 assert.deepEqual(saved,{schemaVersion:1,clientId:CLIENT,type:'desktop',registrationSource:'bundled'});
 assert.equal(JSON.stringify(status).includes(SECRET),false);assert.equal(f.writes(),1);assert.equal(f.network(),0);
 await service.close();const reopened=await f.start();assert.equal((await reopened.readConnection()).registrationSource,'bundled');assert.equal(f.writes(),1);await reopened.close();
});

test('existing connected developer profile and its tokens are unchanged even when release configuration is malformed',async t=>{
 const stored={oauthClient:{clientId:OTHER,clientSecret:'existing_private_fixture'},tokens:{accessToken:'existing_access_fixture',refreshToken:'existing_refresh_fixture',scopes:[],expiresAt:Date.now()+60000},connectedChannel:{id:'UCaaaaaaaaaaaaaaaaaaaaaa',title:'Existing channel'}};
 const existing={schemaVersion:1,clientId:OTHER,type:'desktop'};
 const f=await fixture(t,{existing,stored});await fs.writeFile(f.publisherConfigPath,'malformed publisher configuration');
 const before=await fs.readFile(f.configurationPath),service=await f.start(),status=await service.readConnection();
 assert.equal(status.clientId,OTHER);assert.equal(status.connected,true);assert.equal(status.connectedChannel.title,'Existing channel');assert.equal(status.registrationSource,'developer');assert.equal(status.credentialsBundled,false);
 assert.deepEqual(await fs.readFile(f.configurationPath),before);assert.deepEqual(f.state(),stored);assert.equal(f.writes(),0);assert.equal(f.network(),0);
 assert.equal(JSON.stringify(status).includes('existing_refresh_fixture'),false);assert.equal(JSON.stringify(status).includes('existing_private_fixture'),false);await service.close();
});

test('malformed release, missing file and unsafe local path fail closed without copying credentials or leaking source text',async t=>{
 const f=await fixture(t);await fs.writeFile(f.publisherConfigPath,JSON.stringify({installed:{...configuration.installed,refresh_token:'NEVER_LEAK_FIXTURE'}}));
 await assert.rejects(readPublisherDesktopConfig('relative-file.json'),error=>error.code==='YOUTUBE_PUBLISHER_CONFIGURATION_INVALID');
 const service=await f.start(),status=await service.readConnection();assert.equal(status.configured,false);assert.equal(status.code,'YOUTUBE_CONFIGURATION_INVALID');assert.equal(status.registrationSource,null);assert.equal(JSON.stringify(status).includes('NEVER_LEAK_FIXTURE'),false);assert.equal(f.writes(),0);
 await assert.rejects(fs.stat(f.configurationPath),{code:'ENOENT'});await service.close();
 await fs.unlink(f.publisherConfigPath);await assert.rejects(readPublisherDesktopConfig(f.publisherConfigPath),error=>error.code==='YOUTUBE_PUBLISHER_CONFIGURATION_INVALID');assert.equal(f.network(),0);
});

test('invalid existing configuration or orphaned protected credentials are never overwritten by a bundled registration',async t=>{
 for(const item of [{existing:'broken existing config',stored:{}},{stored:{tokens:{refreshToken:'KEEP_ORPHAN_TOKEN'}}}]){
  const f=await fixture(t,item),before=f.state(),service=await f.start(),status=await service.readConnection();
  assert.equal(status.configured,false);assert.equal(status.code,'YOUTUBE_CONFIGURATION_INVALID');assert.equal(f.writes(),0);assert.deepEqual(f.state(),before);assert.equal(f.network(),0);assert.equal(JSON.stringify(status).includes('KEEP_ORPHAN_TOKEN'),false);
  if(item.existing)assert.equal(await fs.readFile(f.configurationPath,'utf8'),item.existing);else await assert.rejects(fs.stat(f.configurationPath),{code:'ENOENT'});
  await service.close();
 }
});
