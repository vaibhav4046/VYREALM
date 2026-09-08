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

test('bound controls authorize in the injected browser, import a file, fetch analytics and disconnect', async () => {
  const requests = [], opened = [], controlsUI = controls();
  let status = { configured: true, connected: false, auth: { phase: 'idle' } };
  const controller = createYouTubeSettings({
    render() {},
    openExternal: async url => { opened.push(url); return true; },
    api: async (path, options) => {
      requests.push({ path, options });
      if (path === '/youtube/status') return status;
      if (path === '/youtube/authorize') { status = { ...status, auth: { phase: 'pending' } }; return { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test-only' }; }
      if (path === '/youtube/config') return { configured: true };
      if (path.startsWith('/youtube/analytics?')) return { columnHeaders: [{ name: 'views' }], rows: [[25]], startDate: '2026-08-01', endDate: '2026-08-28' };
      if (path === '/youtube/disconnect') { status = { configured: true, connected: false, auth: { phase: 'idle' } }; return { connected: false }; }
      throw new Error('Unexpected local route');
    },
  });
  await controller.update();
  controller.bind(controlsUI.root);
  await controlsUI.element('#youtubeConnect').onclick();
  assert.deepEqual(JSON.parse(requests.find(request => request.path === '/youtube/authorize').options.body), { features: ['upload', 'analytics'] });
  assert.equal(opened.length, 1);
  assert.match(controller.html(), /Waiting for authorization/);
  assert.doesNotMatch(controller.html(), /state=test-only|<iframe/);
  status = { configured: true, connected: true, analytics: 'authorized-not-verified', connectedChannel: { id: 'UC-example', title: 'My channel' }, auth: { phase: 'connected' } };
  await controller.update();
  const input = { value: 'selected.json', files: [{ name: 'desktop.json', size: 150, text: async () => '{"installed":{"client_id":"123.apps.googleusercontent.com","client_secret":"never-displayed"}}' }] };
  await controlsUI.element('#youtubeCredentials').onchange({ target: input });
  assert.equal(input.value, '');
  assert.deepEqual(JSON.parse(requests.find(request => request.path === '/youtube/config').options.body), { installed: { client_id: '123.apps.googleusercontent.com', client_secret: 'never-displayed' } });
  assert.doesNotMatch(controller.html(), /never-displayed|123\.apps/);
  for (const [selector, value] of [['#youtubeStartDate', '2026-08-01'], ['#youtubeEndDate', '2026-08-28'], ['#youtubeVideoId', 'AbCdEfG_123']]) controlsUI.element(selector).oninput({ target: { value } });
  await controlsUI.element('#youtubeAnalyticsForm').onsubmit({ preventDefault() {} });
  assert.ok(requests.some(request => request.path === '/youtube/analytics?startDate=2026-08-01&endDate=2026-08-28&videoId=AbCdEfG_123'));
  assert.match(controller.html(), /<td[^>]*>25<\/td>/);
  await controlsUI.element('#youtubeDisconnect').onclick();
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
