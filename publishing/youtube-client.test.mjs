import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createYouTubeClient, YOUTUBE_SCOPES, validateUploadSessionUrl } from './youtube-client.mjs';
import { createYouTubeVault, windowsDataProtection } from './youtube-vault.mjs';

const CLIENT = '123456-test.apps.googleusercontent.com';
const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const VIDEO = 'abcdefghijk';
const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test-session';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const response = (status, body = null, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers });
const credentials = () => ({ accessToken: 'TEST_ACCESS_NEVER_LOG', refreshToken: 'TEST_REFRESH_NEVER_LOG', expiresAt: Date.now() + 3600000, scopes: Object.values(YOUTUBE_SCOPES) });
function vault(initial = { tokens: credentials(), uploads: {} }) {
  let state = structuredClone(initial);
  return { protection: () => ({ protected: true, qualified: true, mechanism: 'injected-test-only' }), read: async () => structuredClone(state), write: async value => { state = structuredClone(value); }, clear: async () => { state = {}; } };
}
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vyrealm-youtube-'));
  t.after(async () => { if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('vyrealm-youtube-')) await fs.rm(dir, { recursive: true, force: true }); });
  return dir;
}
async function videoFile(t, bytes = 600000) {
  const filePath = path.join(await temp(t), 'original.mp4'); const data = Buffer.alloc(bytes, 19); await fs.writeFile(filePath, data);
  return { filePath, sha256: digest(data), expectedChannelId: CHANNEL, confirmed: true, metadata: { title: 'Original VYREALM film', description: 'Local test', tags: ['original'] }, containsSyntheticMedia: true };
}
const completed = () => response(201, { id: VIDEO, snippet: { channelId: CHANNEL }, status: { privacyStatus: 'private' } });
function makeClient(options = {}) { return createYouTubeClient({ clientId: CLIENT, vault: vault(), sleep: async () => {}, ...options }); }

async function thumbnailFixture(t){
 const filePath=path.join(await temp(t),'reviewed-thumb.jpg'),bytes=Buffer.from([0xff,0xd8,0xff,0xe0,0,4,0x4a,0x46,0xff,0xd9]);await fs.writeFile(filePath,bytes);
 const upload={id:'thumb-video-one',state:'uploaded_private',videoId:VIDEO,channelId:CHANNEL,filePath:path.resolve('retained-video.mp4'),sha256:'a'.repeat(64),size:100,offset:100};
 return{filePath,bytes,upload,thumbnail:{sourceHash:upload.sha256,artifacts:{upload:{mime:'image/jpeg',sha256:digest(bytes)}}}};
}

test('thumbnail upload binds exact retained video and JPEG bytes and saves only a real thumbnail receipt',async t=>{
 const f=await thumbnailFixture(t),store=vault({tokens:credentials(),uploads:{[f.upload.id]:f.upload}}),calls=[];
 const transport=async(url,init)=>{calls.push({url,method:init.method});if(url.includes('/channels'))return response(200,{items:[{id:CHANNEL}]});
  if(url.includes('/youtube/v3/videos?'))return response(200,{items:[{id:VIDEO,snippet:{channelId:CHANNEL},status:{privacyStatus:'private',uploadStatus:'processed'},processingDetails:{processingStatus:'succeeded'}}]});
  const endpoint=new URL(url);assert.equal(endpoint.origin,'https://www.googleapis.com');assert.equal(endpoint.pathname,'/upload/youtube/v3/thumbnails/set');assert.deepEqual([...endpoint.searchParams],[['videoId',VIDEO],['uploadType','media']]);assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.headers['Content-Type'],'image/jpeg');assert.equal(init.headers['Content-Length'],String(f.bytes.length));assert.equal(digest(init.body),f.thumbnail.artifacts.upload.sha256);
  assert.equal((await store.read()).uploads[f.upload.id].thumbnail,undefined);return response(200,{kind:'youtube#thumbnailSetResponse',items:[{default:{width:120,height:90}}]});
 };
 const client=makeClient({vault:store,transport}),result=await client.setThumbnail(f.upload.id,{thumbnail:f.thumbnail,filePath:f.filePath});
 assert.deepEqual({...result.thumbnail,uploadedAt:null},{status:'uploaded',videoId:VIDEO,sourceHash:f.upload.sha256,thumbnailHash:f.thumbnail.artifacts.upload.sha256,uploadedAt:null});assert.equal(result.state,'uploaded_private');assert.equal(result.bytesUploaded,100);
 assert.deepEqual((await makeClient({vault:store}).listUploads())[0].thumbnail,result.thumbnail);assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.ok(calls.every(call=>!call.url.includes('/upload/youtube/v3/videos')));
});

test('thumbnail upload rejects different source, changed file, wrong video/channel and public video before mutation',async t=>{
 const f=await thumbnailFixture(t);let reads=0,posts=0,mode='normal';const store=vault({tokens:credentials(),uploads:{[f.upload.id]:f.upload}});
 const client=makeClient({vault:store,transport:async(url,init)=>{reads++;if(init.method==='POST'){posts++;assert.fail('No thumbnail mutation permitted');}if(url.includes('/channels'))return response(200,{items:[{id:mode==='channel'?'UCbbbbbbbbbbbbbbbbbbbbbb':CHANNEL}]});return response(200,{items:[{id:mode==='video'?'different12':VIDEO,snippet:{channelId:CHANNEL},status:{privacyStatus:mode==='public'?'public':'private',uploadStatus:'processed'},processingDetails:{processingStatus:'succeeded'}}]});}});
 await assert.rejects(client.setThumbnail(f.upload.id,{thumbnail:{...f.thumbnail,sourceHash:'b'.repeat(64)},filePath:f.filePath}),{code:'THUMBNAIL_VIDEO_MISMATCH'});assert.equal(reads,0);
 await fs.writeFile(f.filePath,Buffer.from([0xff,0xd8,0,0,0]));await assert.rejects(client.setThumbnail(f.upload.id,{thumbnail:f.thumbnail,filePath:f.filePath}),{code:'THUMBNAIL_CHANGED'});assert.equal(reads,0);await fs.writeFile(f.filePath,f.bytes);
 for(const [value,code]of [['video','YOUTUBE_UPLOAD_CHANNEL_MISMATCH'],['channel','YOUTUBE_CHANNEL_MISMATCH'],['public','YOUTUBE_UPLOAD_PRIVACY_CHANGED']]){mode=value;await assert.rejects(client.setThumbnail(f.upload.id,{thumbnail:f.thumbnail,filePath:f.filePath}),{code});}
 assert.equal(posts,0);assert.equal((await store.read()).uploads[f.upload.id].thumbnail,undefined);assert.equal((await client.getUploadStatus(f.upload.id)).videoId,VIDEO);
});

test('thumbnail eligibility, redirect and invalid receipt failures retain video and retry only the thumbnail',async t=>{
 const f=await thumbnailFixture(t),store=vault({tokens:credentials(),uploads:{[f.upload.id]:f.upload}});let mode='forbidden',posts=0;
 const client=makeClient({vault:store,transport:async(url,init)=>{if(url.includes('/channels'))return response(200,{items:[{id:CHANNEL}]});if(url.includes('/youtube/v3/videos?'))return response(200,{items:[{id:VIDEO,snippet:{channelId:CHANNEL},status:{privacyStatus:'private',uploadStatus:'processed'},processingDetails:{processingStatus:'succeeded'}}]});assert.ok(url.includes('/thumbnails/set?'));assert.equal(init.redirect,'error');posts++;return mode==='forbidden'?response(403,{error:{message:'SECRET remote detail'}}):mode==='redirect'?response(302,null,{Location:'https://evil.test/SECRET'}):mode==='invalid'?response(200,{kind:'wrong',items:[]}):response(200,{kind:'youtube#thumbnailSetResponse',items:[{}]});}});
 for(const[value,code]of [['forbidden','THUMBNAIL_PERMISSION'],['redirect','YOUTUBE_UNSAFE_REDIRECT'],['invalid','THUMBNAIL_INVALID_RESPONSE']]){mode=value;await assert.rejects(client.setThumbnail(f.upload.id,{thumbnail:f.thumbnail,filePath:f.filePath}),error=>{assert.equal(error.code,code);assert.doesNotMatch(error.message,/SECRET|evil/);if(value==='forbidden')assert.match(error.message,/custom-thumbnail eligibility/);return true;});assert.equal((await client.getUploadStatus(f.upload.id)).state,'uploaded_private');assert.equal((await client.getUploadStatus(f.upload.id)).thumbnail,undefined);}
 mode='okay';assert.equal((await client.setThumbnail(f.upload.id,{thumbnail:f.thumbnail,filePath:f.filePath})).thumbnail.status,'uploaded');assert.equal(posts,4);
});

test('thumbnail verification rejects a retained video whose binding changed after preparation',async t=>{
 const f=await thumbnailFixture(t),base=vault({tokens:credentials(),uploads:{[f.upload.id]:f.upload}});let reads=0,posts=0;
 const store={...base,read:async()=>{if(++reads===2){const changed=await base.read();changed.uploads[f.upload.id].sha256='b'.repeat(64);await base.write(changed);}return base.read();}};
 const client=makeClient({vault:store,transport:async(url,init)=>{if(init.method==='POST')posts++;if(url.includes('/channels'))return response(200,{items:[{id:CHANNEL}]});return response(200,{items:[{id:VIDEO,snippet:{channelId:CHANNEL},status:{privacyStatus:'private',uploadStatus:'processed'},processingDetails:{processingStatus:'succeeded'}}]});}});
 await assert.rejects(client.setThumbnail(f.upload.id,{thumbnail:f.thumbnail,filePath:f.filePath}),{code:'THUMBNAIL_VIDEO_MISMATCH'});assert.equal(posts,0);assert.equal((await base.read()).uploads[f.upload.id].thumbnail,undefined);
});

test('native fetch treats resumable 308 as progress without following its Location or duplicating bytes',async t=>{
 const input=await videoFile(t,300000),chunks=[],ranges=[];let redirected=0;
 const server=http.createServer(async(req,res)=>{
  if(req.url!=='/session'){redirected++;res.statusCode=500;return res.end();}
  const data=[];for await(const chunk of req)data.push(chunk);const bytes=Buffer.concat(data);ranges.push(req.headers['content-range']);
  if(!bytes.length){res.writeHead(308,{Location:'/must-never-follow','Content-Length':'0'});return res.end();}
  chunks.push(bytes);const transferred=chunks.reduce((sum,part)=>sum+part.length,0);
  if(transferred<300000){res.writeHead(308,{Location:'/must-never-follow',Range:`bytes=0-${transferred-1}`,'Content-Length':'0'});return res.end();}
  res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({id:VIDEO,snippet:{channelId:CHANNEL},status:{privacyStatus:'private'}}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const client=makeClient({chunkBytes:262144,maxRetries:0,transport:async(url,init)=>{
  if(url.includes('/channels'))return response(200,{items:[{id:CHANNEL}]});
  if(init.method==='POST')return response(200,null,{Location:SESSION});
  return fetch(`http://127.0.0.1:${server.address().port}/session`,init);
 }});
 const started=await client.beginPrivateUpload(input),done=await client.resumeUpload(started.id);
 assert.equal(done.state,'uploaded_private');assert.equal(done.bytesUploaded,300000);assert.equal(redirected,0);assert.equal(digest(Buffer.concat(chunks)),input.sha256);
 assert.deepEqual(ranges,['bytes */300000','bytes 0-262143/300000','bytes 262144-299999/300000']);
});

test('non-progress redirects remain blocked and network diagnostics reveal only phase and allowlisted cause',async t=>{
 const input=await videoFile(t,300000);let mode='redirect';
 const client=makeClient({maxRetries:0,transport:async(url,init)=>{
  if(url.includes('/channels'))return response(200,{items:[{id:CHANNEL}]});
  if(init.method==='POST')return response(200,null,{Location:SESSION});
  assert.equal(init.redirect,'manual');
  if(mode==='redirect')return response(307,null,{Location:'https://evil.test/secret-session'});
  throw Object.assign(new TypeError('SECRET transport URL and token'),{cause:Object.assign(Error('SECRET headers'),{code:mode==='known'?'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH':'SECRET_NOT_ALLOWED'})});
 }});
 const upload=await client.beginPrivateUpload(input);
 await assert.rejects(client.resumeUpload(upload.id),{code:'YOUTUBE_UNSAFE_REDIRECT'});
 for(const [value,cause]of [['known','UND_ERR_REQ_CONTENT_LENGTH_MISMATCH'],['unknown','TRANSPORT_FAILED']]){mode=value;await assert.rejects(client.resumeUpload(upload.id),error=>{assert.equal(error.code,'YOUTUBE_NETWORK_FAILED');assert.deepEqual(error.details,{phase:'resumable-status',cause});assert.doesNotMatch(error.message+JSON.stringify(error.details),/SECRET|evil|https:|test-session/);return true;});}
 assert.equal((await client.getUploadStatus(upload.id)).bytesUploaded,0);
});

test('private transfer and processing are verified separately against the retained video and channel',async()=>{
 const upload={id:'upload-1',state:'uploaded_private',videoId:VIDEO,channelId:CHANNEL,filePath:path.resolve('fixture.mp4'),sha256:'a'.repeat(64),size:100,offset:100};
 const store=vault({tokens:credentials(),uploads:{'upload-1':upload}});let processing='processing',uploadStatus='uploaded',wrongChannel=false,privacy='private';const calls=[];
 const transport=async(url)=>{calls.push(url);if(url.includes('/channels?'))return response(200,{items:[{id:CHANNEL}]});assert.match(url,/\/youtube\/v3\/videos\?/);return response(200,{items:[{id:VIDEO,snippet:{channelId:wrongChannel?'UCbbbbbbbbbbbbbbbbbbbbbb':CHANNEL},status:{privacyStatus:privacy,uploadStatus},processingDetails:{processingStatus:processing}}]});};
 const client=makeClient({vault:store,transport});
 assert.equal((await client.getUploadStatus('upload-1')).processingVerified,false);
 const pending=await client.verifyUploadedVideo('upload-1');assert.equal(pending.processingVerified,false);assert.equal(pending.processing.status,'pending');
 processing='succeeded';uploadStatus='processed';const ready=await client.verifyUploadedVideo('upload-1');assert.equal(ready.processingVerified,true);assert.equal(ready.watchUrl,`https://www.youtube.com/watch?v=${VIDEO}`);
 const reopened=makeClient({vault:store,transport});assert.equal((await reopened.getUploadStatus('upload-1')).processingVerified,true);
 wrongChannel=true;await assert.rejects(client.verifyUploadedVideo('upload-1'),{code:'YOUTUBE_UPLOAD_CHANNEL_MISMATCH'});wrongChannel=false;privacy='public';await assert.rejects(client.verifyUploadedVideo('upload-1'),{code:'YOUTUBE_UPLOAD_PRIVACY_CHANGED'});
 assert.ok(calls.every(url=>url.startsWith('https://www.googleapis.com/youtube/v3/')));
 await assert.rejects(client.verifyUploadedVideo('__proto__'),{code:'YOUTUBE_UPLOAD_NOT_FOUND'});
});

test('new OAuth flow asks Google to select the user account and never inherits an old refresh token',async t=>{
 const store=vault({uploads:{}}),client=makeClient({vault:store});const flow=await client.beginAuthorization();t.after(()=>flow.cancel());assert.equal(new URL(flow.authorizationUrl).searchParams.get('prompt'),'consent select_account');
});

test('failed re-verification clears prior private-ready proof in retained uploads without reupload',async()=>{
 const upload={id:'retained-one',state:'uploaded_private',filePath:path.resolve('already-uploaded.mp4'),size:300000,offset:300000,sha256:'a'.repeat(64),channelId:CHANNEL,videoId:VIDEO};
 const store=vault({tokens:credentials(),uploads:{[upload.id]:upload}});let failure='',writes=0;
 const transport=async(url,init)=>{if(init.method!=='GET')writes++;if(url.includes('/channels'))return response(200,{items:[{id:CHANNEL}]});
  if(failure==='network')throw Object.assign(new TypeError('SECRET cause'),{cause:{code:'ECONNRESET',message:'SECRET upload URL'}});
  return response(200,{items:[{id:VIDEO,snippet:{channelId:failure==='channel'?'UCbbbbbbbbbbbbbbbbbbbbbb':CHANNEL},status:{privacyStatus:failure==='privacy'?'public':'private',uploadStatus:'processed'},processingDetails:{processingStatus:'succeeded'}}]});
 };
 const client=makeClient({vault:store,transport});
 for(const [mode,code]of [['network','YOUTUBE_NETWORK_FAILED'],['channel','YOUTUBE_UPLOAD_CHANNEL_MISMATCH'],['privacy','YOUTUBE_UPLOAD_PRIVACY_CHANGED']]){
  failure='';assert.equal((await client.verifyUploadedVideo(upload.id)).processingVerified,true);failure=mode;
  await assert.rejects(client.verifyUploadedVideo(upload.id),{code});
  const reopened=makeClient({vault:store,transport}),saved=(await reopened.listUploads())[0];
  assert.equal(saved.processingVerified,false);assert.equal(saved.privacyStatus,'unverified');assert.equal(saved.processing.status,'unverified');assert.equal(saved.processing.code,code);assert.equal(saved.videoId,VIDEO);assert.equal(saved.sha256,upload.sha256);assert.equal(saved.bytesUploaded,300000);assert.doesNotMatch(JSON.stringify(saved),/SECRET/);
 }
 assert.equal(writes,0);
});

test('configuration and protected storage gates do not make network requests', async () => {
  const missing = createYouTubeClient({ vault: vault(), transport: () => assert.fail('network') });
  assert.equal((await missing.status()).code, 'YOUTUBE_CLIENT_NOT_CONFIGURED');
  await assert.rejects(missing.beginAuthorization(), { code: 'YOUTUBE_CLIENT_NOT_CONFIGURED' });
  const unsafe = makeClient({ vault: { ...vault(), protection: () => ({ protected: false }) }, transport: () => assert.fail('network') });
  assert.equal((await unsafe.status()).code, 'YOUTUBE_PROTECTED_STORE_REQUIRED');
  assert.equal(JSON.stringify(await makeClient().status()).includes('TEST_ACCESS'), false);
});

test('optional Desktop client secret is protected, never returned, and used in exchange and refresh only', async t => {
  const store = vault({ uploads: {} }); let now = Date.now(); const grants = [];
  const client = makeClient({ vault: store, clock: () => now, transport: async (url, init) => {
    if (url.endsWith('/token')) { const body = new URLSearchParams(init.body); grants.push(body.get('grant_type')); assert.equal(body.get('client_secret'), 'GOCSPX_TEST_DESKTOP_SECRET'); return response(200, { access_token: 'ACCESS_TEST', refresh_token: 'REFRESH_TEST', expires_in: 3600, token_type: 'Bearer', scope: `${YOUTUBE_SCOPES.analytics} ${YOUTUBE_SCOPES.readonly}` }); }
    assert.equal(init.headers.client_secret, undefined); return response(200, { columnHeaders: [], rows: [] });
  } });
  await assert.rejects(client.configureDesktopCredentials({ web: { client_id: CLIENT, client_secret: 'WRONG' } }), { code: 'YOUTUBE_DESKTOP_CREDENTIALS_REQUIRED' });
  await assert.rejects(client.configureDesktopCredentials({ installed: { client_id: 'different.apps.googleusercontent.com', client_secret: 'WRONG' } }), { code: 'YOUTUBE_CLIENT_MISMATCH' });
  const configured = await client.configureDesktopCredentials({ installed: { client_id: CLIENT, client_secret: 'GOCSPX_TEST_DESKTOP_SECRET' } }); assert.equal(configured.secretStored, true); assert.equal(JSON.stringify(configured).includes('GOCSPX'), false);
  const flow = await client.beginAuthorization({ features: ['analytics'] }); t.after(() => flow.cancel()); const url = new URL(flow.authorizationUrl); assert.equal(url.searchParams.has('client_secret'), false);
  await fetch(`${flow.redirectUri}?state=${url.searchParams.get('state')}&code=once`); assert.equal((await flow.completion).connected, true);
  now += 3600001; await client.analytics({ startDate: '2026-09-01', endDate: '2026-09-02' }); assert.deepEqual(grants, ['authorization_code', 'refresh_token']);
  assert.equal(JSON.stringify(await client.status()).includes('GOCSPX'), false);
});

test('real loopback callback verifies PKCE, rejects bad state, consumes a valid code once', async t => {
  const store = vault({ uploads: {} }); let exchanges = 0; let authorization;
  const client = makeClient({ vault: store, transport: async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token'); exchanges++;
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('code'), 'original-code'); assert.equal(body.get('redirect_uri'), authorization.redirectUri);
    assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'), new URL(authorization.authorizationUrl).searchParams.get('code_challenge'));
    assert.equal(init.redirect, 'error');
    return response(200, { access_token: 'TEST_NEW_ACCESS', refresh_token: 'TEST_NEW_REFRESH', expires_in: 3600, token_type: 'Bearer', scope: `${YOUTUBE_SCOPES.upload} ${YOUTUBE_SCOPES.readonly}` });
  } });
  authorization = await client.beginAuthorization({ features: ['upload'] }); t.after(() => authorization.cancel());
  const url = new URL(authorization.authorizationUrl); assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(new URL(authorization.redirectUri).hostname, '127.0.0.1');
  const bad = await fetch(`${authorization.redirectUri}?state=bad&code=original-code`); assert.equal(bad.status, 400); assert.equal(exchanges, 0);
  const valid = `${authorization.redirectUri}?state=${url.searchParams.get('state')}&code=original-code`;
  const accepted = await fetch(valid); assert.equal(accepted.status, 200);
  assert.equal((await authorization.completion).connected, true); assert.equal(exchanges, 1);
  try { await fetch(valid); } catch {} assert.equal(exchanges, 1);
  assert.equal((await store.read()).tokens.refreshToken, 'TEST_NEW_REFRESH');
});

test('cancel and expired authorization never exchange a code', async t => {
  let now = Date.now(); const client = makeClient({ clock: () => now, transport: () => assert.fail('network') });
  const flow = await client.beginAuthorization({ features: ['analytics'] }); t.after(() => flow.cancel());
  now += 11 * 60000; const url = new URL(flow.authorizationUrl);
  const result = await fetch(`${flow.redirectUri}?state=${url.searchParams.get('state')}&code=x`);
  assert.equal(result.status, 400); assert.equal((await flow.completion).code, 'YOUTUBE_AUTH_EXPIRED');
  const next = await client.beginAuthorization(); next.cancel(); assert.equal((await next.completion).code, 'YOUTUBE_AUTH_CANCELLED');
});

test('cancelling during code exchange cannot restore credentials after disconnect', async t => {
  let release; let announce; const exchanging = new Promise(resolve => { announce = resolve; }); const delayed = new Promise(resolve => { release = resolve; });
  const store = vault({ uploads: {} });
  const client = makeClient({ vault: store, transport: async () => { announce(); await delayed; return response(200, { access_token: 'DELAYED_ACCESS', refresh_token: 'DELAYED_REFRESH', expires_in: 3600, token_type: 'Bearer' }); } });
  const flow = await client.beginAuthorization(); t.after(() => flow.cancel()); const auth = new URL(flow.authorizationUrl);
  const callback = fetch(`${flow.redirectUri}?state=${auth.searchParams.get('state')}&code=once`);
  await exchanging; await client.disconnect(); release(); await callback;
  assert.equal((await flow.completion).connected, false); assert.equal((await store.read()).tokens, undefined);
});

test('session URLs cannot exfiltrate tokens through redirects, credentials, host or path changes', () => {
  assert.equal(validateUploadSessionUrl(SESSION), SESSION);
  for (const bad of ['http://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=x', 'https://www.googleapis.com.evil.test/upload/youtube/v3/videos?uploadType=resumable&upload_id=x', 'https://user@www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=x', SESSION + '#fragment', SESSION.replace('/upload/', '/other/'), 'https://127.0.0.1/upload/youtube/v3/videos?uploadType=resumable&upload_id=x']) assert.throws(() => validateUploadSessionUrl(bad), { code: 'YOUTUBE_UNSAFE_SESSION_URL' });
});

test('upload needs explicit confirmation, unchanged file hash and the selected authorized channel', async t => {
  const input = await videoFile(t); let calls = 0;
  const client = makeClient({ transport: async () => { calls++; return response(200, { items: [{ id: 'UCbbbbbbbbbbbbbbbbbbbbbb' }] }); } });
  await assert.rejects(client.beginPrivateUpload({ ...input, confirmed: false }), { code: 'YOUTUBE_UPLOAD_NOT_CONFIRMED' });
  await assert.rejects(client.beginPrivateUpload({ ...input, sha256: '0'.repeat(64) }), { code: 'YOUTUBE_FILE_CHANGED' });
  assert.equal(calls, 0);
  await assert.rejects(client.beginPrivateUpload(input), { code: 'YOUTUBE_CHANNEL_MISMATCH' }); assert.equal(calls, 1);
});

test('bounded resumable upload follows server Range and stores private receipt, never a public upload', async t => {
  const input = await videoFile(t); const store = vault(); const sent = []; let uploads = 0; const bodies = [];
  const client = makeClient({ vault: store, chunkBytes: 262144, transport: async (url, init) => {
    if (url.includes('/youtube/v3/channels')) return response(200, { items: [{ id: CHANNEL }] });
    if (init.method === 'POST') { const body = JSON.parse(init.body); assert.equal(body.status.privacyStatus, 'private'); assert.equal(body.status.containsSyntheticMedia, true); assert.equal(body.status.publishAt, undefined); return response(200, null, { Location: SESSION }); }
    assert.equal(url, SESSION); const range = init.headers['Content-Range']; sent.push(range);
    if (range.startsWith('bytes */')) return uploads ? response(308, null, { Range: 'bytes=0-262143' }) : response(308);
    bodies.push(Buffer.from(init.body)); uploads++;
    if (uploads === 1) return response(308, null, { Range: 'bytes=0-262143' });
    if (uploads === 2) return response(308, null, { Range: 'bytes=0-524287' });
    return completed();
  } });
  const start = await client.beginPrivateUpload(input); assert.equal(start.state, 'uploading'); assert.equal(start.sessionUri, undefined);
  const first = await client.resumeUpload(start.id, { maxChunks: 1 }); assert.equal(first.bytesUploaded, 262144); assert.equal(first.state, 'uploading');
  const final = await client.resumeUpload(start.id); assert.equal(final.state, 'uploaded_private'); assert.equal(final.videoId, VIDEO); assert.equal(final.bytesUploaded, 600000);
  assert.deepEqual(sent, ['bytes */600000', 'bytes 0-262143/600000', 'bytes */600000', 'bytes 262144-524287/600000', 'bytes 524288-599999/600000']);
  assert.equal(digest(Buffer.concat(bodies)), input.sha256); assert.equal((await store.read()).uploads[start.id].sessionUri, SESSION);
});

test('interrupted chunks query remote progress before retrying, cancellation retains resumability', async t => {
  const input = await videoFile(t, 300000); let query = 0; let writes = 0; const client = makeClient({ chunkBytes: 262144, transport: async (url, init) => {
    if (url.includes('/channels')) return response(200, { items: [{ id: CHANNEL }] });
    if (init.method === 'POST') return response(200, null, { Location: SESSION });
    if (init.headers['Content-Range'].includes('*')) { query++; return query === 1 ? response(308) : response(308, null, { Range: 'bytes=0-262143' }); }
    writes++; if (writes === 1) throw new TypeError('simulated network loss');
    assert.equal(init.headers['Content-Range'], 'bytes 262144-299999/300000'); return completed();
  } });
  const start = await client.beginPrivateUpload(input);
  const controller = new AbortController(); controller.abort(); await assert.rejects(client.resumeUpload(start.id, { signal: controller.signal }), { code: 'YOUTUBE_CANCELLED' });
  assert.equal((await client.resumeUpload(start.id)).state, 'uploaded_private'); assert.equal(query, 2); assert.equal(writes, 2);
});

test('resuming after an account switch rejects the wrong channel before querying or transferring', async t => {
  const input = await videoFile(t); let changed = false; const client = makeClient({ transport: async (url, init) => {
    if (url.includes('/channels')) return response(200, { items: [{ id: changed ? 'UCbbbbbbbbbbbbbbbbbbbbbb' : CHANNEL }] });
    if (init.method === 'POST') return response(200, null, { Location: SESSION });
    assert.fail('No upload requests are allowed after the selected account changes');
  } });
  const upload = await client.beginPrivateUpload(input); changed = true;
  await assert.rejects(client.resumeUpload(upload.id), { code: 'YOUTUBE_CHANNEL_MISMATCH' });
});

test('invalid ranges, expired sessions and endless server failures never mark an upload complete', async t => {
  const input = await videoFile(t); let mode = 'range'; let queries = 0;
  const client = makeClient({ maxRetries: 2, transport: async (url, init) => {
    if (url.includes('/channels')) return response(200, { items: [{ id: CHANNEL }] });
    if (init.method === 'POST') return response(200, null, { Location: SESSION });
    queries++;
    if (mode === 'range') return response(308, null, { Range: 'bytes=0-999999999' });
    if (mode === 'expired') return response(404);
    return response(503, null, { 'Retry-After': '1' });
  } });
  const upload = await client.beginPrivateUpload(input);
  await assert.rejects(client.resumeUpload(upload.id), { code: 'YOUTUBE_INVALID_UPLOAD_RANGE' });
  mode = 'expired'; await assert.rejects(client.resumeUpload(upload.id), { code: 'YOUTUBE_SESSION_EXPIRED' });
  mode = 'busy'; queries = 0; await assert.rejects(client.resumeUpload(upload.id), { code: 'YOUTUBE_RETRYABLE' }); assert.equal(queries, 3);
  assert.equal((await client.getUploadStatus(upload.id)).state, 'uploading');
});

test('expired token refresh is protected, redacted and invalid grants require reconnect', async () => {
  const store = vault({ tokens: { ...credentials(), expiresAt: 0 }, uploads: {} }); let refresh = 0;
  const client = makeClient({ vault: store, transport: async (url, init) => {
    if (url.endsWith('/token')) { refresh++; assert.equal(new URLSearchParams(init.body).get('grant_type'), 'refresh_token'); return response(200, { access_token: 'REFRESHED_TOKEN', expires_in: 3600, token_type: 'Bearer' }); }
    assert.equal(init.headers.Authorization, 'Bearer REFRESHED_TOKEN'); return response(200, { columnHeaders: [], rows: [] });
  } });
  const report = await client.analytics({ startDate: '2026-09-01', endDate: '2026-09-02' }); assert.equal(report.status, 'available'); assert.equal(refresh, 1); assert.equal((await store.read()).tokens.refreshToken, 'TEST_REFRESH_NEVER_LOG');
  const badStore = vault({ tokens: { ...credentials(), expiresAt: 0 }, uploads: {} });
  const bad = makeClient({ vault: badStore, transport: async () => response(400, { error: 'invalid_grant', error_description: 'SECRET never surface' }) });
  await assert.rejects(bad.analytics({ startDate: '2026-09-01', endDate: '2026-09-02' }), error => error.code === 'YOUTUBE_REAUTH_REQUIRED' && !error.message.includes('SECRET'));
  assert.equal((await badStore.read()).tokens, undefined);
});

test('analytics reads only own channel with permitted dates and granted scopes', async () => {
  const client = makeClient({ transport: async (url, init) => { const u = new URL(url); assert.equal(u.origin, 'https://youtubeanalytics.googleapis.com'); assert.equal(u.searchParams.get('ids'), 'channel==MINE'); assert.equal(u.searchParams.get('filters'), `video==${VIDEO}`); assert.equal(init.method, 'GET'); return response(200, { columnHeaders: [{ name: 'views' }], rows: [[5]] }); } });
  assert.equal((await client.analytics({ startDate: '2026-09-01', endDate: '2026-09-02', videoId: VIDEO })).rows[0][0], 5);
  await assert.rejects(client.analytics({ startDate: '2026-02-30', endDate: '2026-03-01' }), { code: 'YOUTUBE_INVALID_ANALYTICS_QUERY' });
  const noScope = makeClient({ vault: vault({ tokens: { ...credentials(), scopes: [YOUTUBE_SCOPES.upload] }, uploads: {} }), transport: () => assert.fail('network') });
  await assert.rejects(noScope.analytics({ startDate: '2026-09-01', endDate: '2026-09-02' }), { code: 'YOUTUBE_SCOPE_REQUIRED' });
});

test('protected vault wraps its encryption key once per session and detects tampered ciphertext', async t => {
  const filePath = path.join(await temp(t), 'fast-vault.json'); let wraps = 0; let unwraps = 0;
  const protection = { information: { protected: true, qualified: true, mechanism: 'injected-test-key-wrapper' }, encrypt: async bytes => { wraps++; return Buffer.from(bytes).reverse(); }, decrypt: async bytes => { unwraps++; return Buffer.from(bytes).reverse(); } };
  const store = createYouTubeVault({ filePath, protection });
  await store.write({ tokens: credentials(), progress: 0 }); await store.write({ tokens: credentials(), progress: 1 });
  assert.equal(wraps, 1); assert.equal((await store.read()).progress, 1); assert.equal(unwraps, 0);
  const reopened = createYouTubeVault({ filePath, protection }); assert.equal((await reopened.read()).progress, 1); assert.equal(unwraps, 1); await reopened.read(); assert.equal(unwraps, 1);
  const envelope = JSON.parse(await fs.readFile(filePath, 'utf8')); const ciphertext = Buffer.from(envelope.ciphertext, 'base64'); ciphertext[0] ^= 1; envelope.ciphertext = ciphertext.toString('base64'); await fs.writeFile(filePath, JSON.stringify(envelope));
  await assert.rejects(reopened.read(), { code: 'YOUTUBE_VAULT_INVALID' });
});

test('vault persists ciphertext, rejects unsupported platforms, and round-trips Windows CurrentUser DPAPI', async t => {
  const dir = await temp(t); const filePath = path.join(dir, 'youtube-vault.json');
  const unsupported = createYouTubeVault({ filePath, platform: 'darwin' }); assert.equal(unsupported.protection().qualified, false); await assert.rejects(unsupported.write({ refreshToken: 'secret' }), { code: 'YOUTUBE_PROTECTED_STORE_REQUIRED' });
  if (process.platform !== 'win32') return;
  const real = createYouTubeVault({ filePath, protection: windowsDataProtection() });
  assert.equal(real.protection().mechanism, 'windows-dpapi-current-user');
  const value = { tokens: credentials(), uploads: {} }; await real.write(value);
  const disk = await fs.readFile(filePath, 'utf8'); assert.equal(disk.includes('TEST_REFRESH'), false); assert.equal(disk.includes('TEST_ACCESS'), false);
  assert.deepEqual(await real.read(), value);
  const reopened = createYouTubeVault({ filePath, protection: windowsDataProtection() }); assert.deepEqual(await reopened.read(), value);
  await real.clear(); assert.deepEqual(await real.read(), {});
});
