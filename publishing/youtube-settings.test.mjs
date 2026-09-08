import test from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeSettings, parseYouTubeDesktopCredentials, renderYouTubeAnalytics } from '../youtube-settings.js';

test('settings render channel identity as text and keep authorization separate from browser sign-in', async () => {
  let status = { configured: true, connected: true, connectedChannel: { id: 'UC<channel>', title: '<img src=x onerror="alert(1)">' }, auth: { phase: 'connected' } };
  const controller = createYouTubeSettings({ api: async () => status, render() {} });
  await controller.update();
  const html = controller.html();
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /UC&lt;channel&gt;/);
  assert.doesNotMatch(html, /<img|<iframe|<textarea|localStorage/);
  assert.match(html, /local user profile/);
  status = { configured: true, connected: true, connectedChannel: null, auth: { phase: 'connected' } };
  await controller.update();
  assert.match(controller.html(), /Channel identity has not been confirmed/);
  controller.dispose();
});

test('API errors never echo raw transport details or credentials', async () => {
  const controller = createYouTubeSettings({ api: async () => { throw new Error('client_secret=do-not-render <script>bad()</script>'); }, render() {} });
  await controller.update();
  assert.match(controller.html(), /Could not read YouTube connection status/);
  assert.doesNotMatch(controller.html(), /do-not-render|<script>/);
  controller.dispose();
});

test('Desktop credential import selects only expected fields and rejects Web credentials', () => {
  const parsed = parseYouTubeDesktopCredentials(JSON.stringify({ installed: { client_id: '123-example.apps.googleusercontent.com', client_secret: 'test-secret', project_id: 'discard', redirect_uris: ['http://localhost'] }, unwanted: 'discard' }));
  assert.deepEqual(parsed, { installed: { client_id: '123-example.apps.googleusercontent.com', client_secret: 'test-secret' } });
  assert.deepEqual(parseYouTubeDesktopCredentials('{"installed":{"client_id":"123-example.apps.googleusercontent.com"}}'), { installed: { client_id: '123-example.apps.googleusercontent.com' } });
  for (const input of ['{"web":{"client_id":"x"}}', '{bad json', '{"installed":{"client_id":"bad"}}', '{"installed":{"client_id":"123.apps.googleusercontent.com","client_secret":42}}']) {
    assert.throws(() => parseYouTubeDesktopCredentials(input), /Desktop app credential JSON/);
  }
});

test('analytics table escapes server headers and cells and explains data availability', () => {
  const html = renderYouTubeAnalytics({ columnHeaders: [{ name: '<img src=x>' }, { name: 'views' }], rows: [['<script>alert(1)</script>', 12]], startDate: '2026-08-01', endDate: '2026-08-28' });
  assert.match(html, /<table/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script|virality|viral score/i);
  assert.match(html, /Recent data can be delayed/);
  assert.match(renderYouTubeAnalytics({ columnHeaders: [{ name: 'views' }], rows: [] }), /No rows are available/);
});

test('authorization polling stops after completion and disposal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const controller = createYouTubeSettings({ api: async () => { calls++; return { configured: true, connected: false, auth: { phase: calls === 1 ? 'pending' : 'failed' } }; }, render() {} });
  await controller.update();
  assert.equal(calls, 1);
  t.mock.timers.tick(2500);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 2);
  t.mock.timers.tick(15000);
  assert.equal(calls, 2);
  controller.dispose();
  const pending = createYouTubeSettings({ api: async () => { calls++; return { auth: { phase: 'pending' } }; }, render() {} });
  await pending.update();
  pending.dispose();
  t.mock.timers.tick(15000);
  assert.equal(calls, 3);
});

function controls() {
  const elements = new Map();
  const panel = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, {}); return elements.get(selector); } };
  return { root: { querySelector() { return panel; } }, element: selector => panel.querySelector(selector) };
}

test('reconnect requires named confirmation and disconnects the exact channel before a new consent flow', async () => {
 const ui=controls(),posts=[];let status={configured:true,connected:true,connectedChannel:{id:'UC-owned',title:'My own channel'},auth:{phase:'connected'}};
 const controller=createYouTubeSettings({render(){},openExternal:async()=>true,api:async(path,options)=>{
  if(!options)return status;posts.push({path,body:JSON.parse(options.body)});
  if(path==='/youtube/disconnect'){status={configured:true,connected:false,auth:{phase:'idle'}};return status;}
  if(path==='/youtube/authorize'){status.auth={phase:'pending'};return{authorizationUrl:oauthUrl()};}
 }});
 await controller.update();controller.bind(ui.root);await ui.element('#youtubeConnect').onclick();
 assert.deepEqual(posts,[]);assert.match(controller.html(),/Disconnect and continue/);assert.match(controller.html(),/My own channel/);
 await ui.element('#youtubeKeepChannel').onclick();assert.deepEqual(posts,[]);
 await ui.element('#youtubeConnect').onclick();await ui.element('#youtubeConfirmDisconnect').onclick();
 assert.deepEqual(posts.map(p=>p.path),['/youtube/disconnect','/youtube/authorize']);assert.deepEqual(posts[0].body,{expectedChannelId:'UC-owned'});controller.dispose();
});

function oauthUrl(){const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const[key,value]of Object.entries({client_id:'123-test.apps.googleusercontent.com',redirect_uri:'http://127.0.0.1:54321/oauth/youtube/callback',response_type:'code',scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly',state:'s'.repeat(43),code_challenge:'c'.repeat(43),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account'}))url.searchParams.set(key,value);return url.href;}

test('bound controls authorize in the injected browser, import a file, fetch analytics and disconnect', async () => {
  const requests = [], opened = [], controlsUI = controls();
  let status = { configured: true, connected: false, auth: { phase: 'idle' } };
  const controller = createYouTubeSettings({
    render() {},
    openExternal: async url => { opened.push(url); return true; },
    api: async (path, options) => {
      requests.push({ path, options });
      if (path === '/youtube/status') return status;
      if (path === '/youtube/authorize') { status = { ...status, auth: { phase: 'pending' } }; return { authorizationUrl: oauthUrl() }; }
      if (path === '/youtube/config') return { configured: true };
      if (path.startsWith('/youtube/analytics?')) return { columnHeaders: [{ name: 'views' }], rows: [[25]], startDate: '2026-08-01', endDate: '2026-08-28' };
      if (path === '/youtube/disconnect') { status = { configured: true, connected: false, auth: { phase: 'idle' } }; return { connected: false }; }
      throw new Error('Unexpected local route');
    },
  });
  await controller.update();
  controller.bind(controlsUI.root);
  const input = { value: 'selected.json', files: [{ name: 'desktop.json', size: 150, text: async () => '{"installed":{"client_id":"123.apps.googleusercontent.com","client_secret":"never-displayed"}}' }] };
  await controlsUI.element('#youtubeCredentials').onchange({ target: input });
  assert.equal(input.value, '');
  assert.deepEqual(JSON.parse(requests.find(request => request.path === '/youtube/config').options.body), { installed: { client_id: '123.apps.googleusercontent.com', client_secret: 'never-displayed' } });
  assert.doesNotMatch(controller.html(), /never-displayed|123\.apps/);
  controlsUI.element('#youtubeAnalyticsPermission').onchange({target:{checked:true}});
  await controlsUI.element('#youtubeConnect').onclick();
  assert.deepEqual(JSON.parse(requests.find(request => request.path === '/youtube/authorize').options.body), { features: ['upload', 'analytics'] });
  assert.equal(opened.length, 1);
  assert.match(controller.html(), /Waiting for authorization/);
  assert.doesNotMatch(controller.html(), /state=test-only|<iframe/);
  status = { configured: true, connected: true, analytics: 'authorized-not-verified', connectedChannel: { id: 'UC-example', title: 'My channel' }, auth: { phase: 'connected' } };
  await controller.update();
  for (const [selector, value] of [['#youtubeStartDate', '2026-08-01'], ['#youtubeEndDate', '2026-08-28'], ['#youtubeVideoId', 'AbCdEfG_123']]) controlsUI.element(selector).oninput({ target: { value } });
  await controlsUI.element('#youtubeAnalyticsForm').onsubmit({ preventDefault() {} });
  assert.ok(requests.some(request => request.path === '/youtube/analytics?startDate=2026-08-01&endDate=2026-08-28&videoId=AbCdEfG_123'));
  assert.match(controller.html(), /<td[^>]*>25<\/td>/);
  await controlsUI.element('#youtubeDisconnect').onclick();
  await controlsUI.element('#youtubeConfirmDisconnect').onclick();
  assert.match(controller.html(), /No YouTube account is connected/);
  assert.doesNotMatch(controller.html(), /<td[^>]*>25<\/td>/);
  controller.dispose();
  assert.equal(controlsUI.element('#youtubeConnect').onclick, null);
});

test('an unsafe authorization destination never reaches the system browser', async () => {
  const controlsUI = controls();
  let opens = 0;
  const controller = createYouTubeSettings({ render() {}, openExternal: async () => { opens++; }, api: async path => path === '/youtube/authorize' ? { authorizationUrl: 'https://accounts.google.com.evil.test/o/oauth2/v2/auth' } : { configured: true, auth: { phase: 'idle' } } });
  await controller.update();
  controller.bind(controlsUI.root);
  await controlsUI.element('#youtubeConnect').onclick();
  assert.equal(opens, 0);
  assert.match(controller.html(), /Could not start YouTube authorization/);
  controller.dispose();
});

test('known denial, cancellation, expiry and revoked-access states give safe recovery instructions', async () => {
 for(const [code,pattern]of [['YOUTUBE_AUTH_DENIED',/permission was declined/],['YOUTUBE_AUTH_CANCELLED',/Sign-in was cancelled/],['YOUTUBE_AUTH_EXPIRED',/attempt expired/],['YOUTUBE_AUTH_INVALID',/no longer valid/],['YOUTUBE_TOKEN_REFRESH_FAILED',/could not renew access/],['YOUTUBE_CHANNEL_SELECTION_REQUIRED',/one YouTube channel/]]){
  const controller=createYouTubeSettings({api:async()=>({configured:true,auth:{phase:'failed',code},diagnostic:'secret=do-not-display'}),render(){}});
  await controller.update();assert.match(controller.html(),pattern);assert.doesNotMatch(controller.html(),/do-not-display/);controller.dispose();
 }
});

test('a changed channel invalidates confirmation without disconnecting either account', async()=>{
 const ui=controls(),writes=[];let channel='UC-original';const controller=createYouTubeSettings({render(){},api:async(path,options)=>{if(options)writes.push(path);return{configured:true,connected:true,connectedChannel:{id:channel,title:channel},auth:{phase:'connected'}};}});
 await controller.update();controller.bind(ui.root);await ui.element('#youtubeDisconnect').onclick();channel='UC-other';await ui.element('#youtubeConfirmDisconnect').onclick();
 assert.deepEqual(writes,[]);assert.match(controller.html(),/connected channel changed/);assert.match(controller.html(),/UC-other/);controller.dispose();
});

test('blocked browser opening preserves one pending consent for an explicit gesture retry',async()=>{
 const ui=controls();let opens=0,authorizations=0,pending=false;const controller=createYouTubeSettings({render(){},openExternal:async()=>++opens>1,api:async(path)=>{if(path==='/youtube/authorize'){authorizations++;pending=true;return{authorizationUrl:oauthUrl()};}return{configured:true,auth:{phase:pending?'pending':'idle'}};}});
 await controller.update();controller.bind(ui.root);await ui.element('#youtubeConnect').onclick();assert.match(controller.html(),/fresh click/);assert.match(controller.html(),/id="youtubeOpenBrowser"/);
 await ui.element('#youtubeOpenBrowser').onclick();assert.equal(authorizations,1);assert.equal(opens,2);assert.doesNotMatch(controller.html(),/state=|code_challenge=|123-test/);controller.dispose();
});

test('Google URLs with unsafe scopes, callbacks or secret fields never reach the opener',async()=>{
 for(const mutate of [u=>u.searchParams.set('scope','https://www.googleapis.com/auth/drive'),u=>u.searchParams.set('redirect_uri','https://evil.test/callback'),u=>u.searchParams.set('client_secret','do-not-render'),u=>u.searchParams.append('state','duplicate'),u=>u.searchParams.set('code_challenge_method','plain')]){
  const url=new URL(oauthUrl());mutate(url);const ui=controls();let opens=0;
  const controller=createYouTubeSettings({render(){},openExternal:async()=>opens++,api:async(path)=>path==='/youtube/authorize'?{authorizationUrl:url.href}:{configured:true,auth:{phase:'idle'}}});
  await controller.update();controller.bind(ui.root);await ui.element('#youtubeConnect').onclick();assert.equal(opens,0);assert.doesNotMatch(controller.html(),/do-not-render|evil.test/);controller.dispose();
 }
});

test('verify is an explicit online action, reports revoked access safely, and does not silently disconnect',async()=>{
 const ui=controls(),writes=[];const saved={configured:true,connected:true,connectedChannel:{id:'UC-owned',title:'My channel'},upload:'authorized-not-verified',analytics:'consent-required',auth:{phase:'connected'}};
 const controller=createYouTubeSettings({render(){},api:async(path,options)=>{if(options)writes.push(path);return path==='/youtube/verify'?{...saved,channelVerification:{status:'failed',code:'YOUTUBE_TOKEN_REFRESH_FAILED'}}:saved;}});
 await controller.update();controller.bind(ui.root);assert.deepEqual(writes,[]);await ui.element('#youtubeRefresh').onclick();assert.deepEqual(writes,['/youtube/verify']);assert.match(controller.html(),/could not renew access/);assert.match(controller.html(),/My channel/);controller.dispose();
});
