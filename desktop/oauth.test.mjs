import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { validateGoogleOAuthUrl, createOAuthOpener } from './oauth.mjs';
import { createYouTubeClient } from '../publishing/youtube-client.mjs';

function authorization() {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({ client_id: '123-test.apps.googleusercontent.com', redirect_uri: 'http://127.0.0.1:54321/oauth/youtube/callback', response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', state: 's'.repeat(43), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}
test('accepts only the backend Google YouTube PKCE authorization shape', () => {
  assert.equal(validateGoogleOAuthUrl(authorization().href), authorization().href);
  for (const mutate of [u=>u.hostname='evil.test', u=>u.protocol='http:', u=>u.pathname='/other', u=>u.username='user', u=>u.hash='fragment', u=>u.port='444', u=>u.searchParams.set('redirect_uri','https://evil.test/callback'), u=>u.searchParams.set('scope','https://www.googleapis.com/auth/drive'), u=>u.searchParams.set('code_challenge_method','plain'), u=>u.searchParams.delete('state'), u=>u.searchParams.append('state','duplicate'), u=>u.searchParams.set('client_secret','secret'), u=>u.searchParams.set('redirect_uri','http://127.0.0.1:54321/other')]) {
    const url=authorization(); mutate(url); assert.equal(validateGoogleOAuthUrl(url.href),null);
  }
  for (const value of [null, {}, 'file:///C:/x', 'javascript:alert(1)']) assert.equal(validateGoogleOAuthUrl(value),null);
});
test('accepts actual backend authorization URLs without a grant or external request', async () => {
  for (const features of [['upload'], ['analytics'], ['upload','analytics']]) {
    const client=createYouTubeClient({clientId:'123-test.apps.googleusercontent.com',vault:{protection:()=>({protected:true,qualified:true}),read:async()=>({}),write:async()=>{}},transport:()=>assert.fail('No external request allowed')});
    const flow=await client.beginAuthorization({features});
    try { assert.equal(validateGoogleOAuthUrl(flow.authorizationUrl),flow.authorizationUrl); }
    finally { flow.cancel(); await flow.completion; }
  }
});
test('opens only for an active click in the owned main frame; shell errors are contained', async () => {
  const opened=[], frame={url:'http://127.0.0.1:4173/'}, sender={mainFrame:frame,executeJavaScript:async()=>true}, window={webContents:sender,isDestroyed:()=>false};
  const event={sender,senderFrame:frame};
  const open=createOAuthOpener({getWindow:()=>window,getPort:()=>4173,openExternal:async url=>opened.push(url)});
  assert.equal(await open(event,authorization().href),true); assert.equal(opened.length,1);
  assert.equal(await open({...event,sender:{}},authorization().href),false);
  assert.equal(await open({...event,senderFrame:{url:frame.url}},authorization().href),false);
  frame.url='http://127.0.0.1:9999/'; assert.equal(await open(event,authorization().href),false); frame.url='http://127.0.0.1:4173/';
  sender.executeJavaScript=async()=>false; assert.equal(await open(event,authorization().href),false); assert.equal(opened.length,1);
  sender.executeJavaScript=async()=>true;
  assert.equal(await createOAuthOpener({getWindow:()=>window,getPort:()=>4173,openExternal:async()=>{throw Error('OS failed');}})(event,authorization().href),false);
});
test('preload requires active user activation and exposes only the dedicated IPC operation', async () => {
  let bridge, active=false; const calls=[];
  runInNewContext(await readFile(new URL('./preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return true;}}}),process:{platform:'win32',versions:{electron:'test'}},navigator:{userActivation:{get isActive(){return active;}}},URL});
  assert.equal(await bridge.openOAuth(authorization().href),false); assert.equal(calls.length,0);
  active=true; assert.equal(await bridge.openOAuth(authorization().href),true); assert.deepEqual(calls[0],['open-google-oauth',authorization().href]);
  assert.equal(await bridge.openOAuth('https://evil.test/'),false); assert.equal(calls.length,1);
});
