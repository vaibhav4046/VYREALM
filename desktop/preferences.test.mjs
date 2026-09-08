import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { runInNewContext } from 'node:vm';
import { createDesktopPreferences, findOpenPort, isOwnedDesktopFrame, persistWindowPreferences } from './preferences.mjs';

const projectId = '92fb2b09-d53b-44ce-98db-f6518b76e451';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vyrealm-desktop-preferences-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function occupy(t, port = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}
test('a real occupied preferred port is replaced once and reused on the next launch', async t => {
  const directory = await fixture(t), occupied = await occupy(t);
  const first = await createDesktopPreferences(directory);
  await first.save({ preferredPort: occupied });
  const chosen = await findOpenPort(first.snapshot().preferredPort);
  assert.notEqual(chosen, occupied);
  await first.save({ preferredPort: chosen, selectedProject: projectId, workspace: 'film' });
  const restarted = await createDesktopPreferences(directory);
  assert.equal(await findOpenPort(restarted.snapshot().preferredPort), chosen);
  assert.equal(restarted.snapshot().selectedProject, projectId);
  await occupy(t, chosen);
  const newPort = await findOpenPort(chosen);
  assert.notEqual(newPort, chosen);
  await restarted.save({ preferredPort: newPort });
  assert.equal((await createDesktopPreferences(directory)).snapshot().selectedProject, projectId);
});
test('preferences validate and serialize bounded updates without accepting arbitrary keys or locations', async t => {
  const directory = await fixture(t), prefs = await createDesktopPreferences(directory);
  assert.deepEqual(prefs.snapshot(), { schemaVersion: 1, preferredPort: 4173, selectedProject: null, selectionRecorded: false, workspace: null });
  await Promise.all([prefs.save({ selectedProject: projectId }), prefs.save({ preferredPort: 45678 }), prefs.save({ workspace: 'creator' })]);
  await prefs.flush();
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'desktop-preferences.json'), 'utf8')), { schemaVersion: 1, preferredPort: 45678, selectedProject: projectId, selectionRecorded: true, workspace: 'creator' });
  for (const value of [{ selectedProject: '../secrets' }, { selectedProject: 123 }, { preferredPort: 80 }, { preferredPort: '4173' }, { workspace: 'https://evil.test' }, { token: 'secret' }, { file: '../elsewhere' }, null]) {
    assert.throws(() => prefs.save(value), /Invalid desktop preference/);
  }
});
test('corrupt or oversized files do not change startup defaults', async t => {
  const directory = await fixture(t), file = join(directory, 'desktop-preferences.json');
  for (const data of ['not json', JSON.stringify({ schemaVersion: 1, preferredPort: 7, selectedProject: 'bad' }), ' '.repeat(8193)]) {
    await writeFile(file, data);
    assert.equal((await createDesktopPreferences(directory)).snapshot().preferredPort, 4173);
  }
});
test('only the current main frame on the exact loopback origin owns preference IPC', () => {
  const frame = { url: 'http://127.0.0.1:4173/' }, sender = { mainFrame: frame }, window = { webContents: sender, isDestroyed: () => false };
  assert.equal(isOwnedDesktopFrame({ sender, senderFrame: frame }, window, 4173), true);
  assert.equal(isOwnedDesktopFrame({ sender: {}, senderFrame: frame }, window, 4173), false);
  assert.equal(isOwnedDesktopFrame({ sender, senderFrame: { url: frame.url } }, window, 4173), false);
  for (const url of ['http://localhost:4173/', 'http://127.0.0.1:4174/', 'https://127.0.0.1:4173/', 'file:///x', 'http://a@127.0.0.1:4173/']) {
    frame.url = url; assert.equal(isOwnedDesktopFrame({ sender, senderFrame: frame }, window, 4173), false);
  }
});
test('preload restores only selected project/workspace before scripts and persists subsequent changes', async () => {
  const values = new Map([['unrelated-token', 'untouched']]), listeners = {}, sent = []; let tick;
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  runInNewContext(await readFile(new URL('./preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { invoke() {}, sendSync: channel => channel === 'desktop-preferences:read' ? { selectedProject: projectId, workspace: 'film' } : null, send: (...args) => sent.push(args) } }),
    process: { platform: 'win32', versions: { electron: 'test' } }, navigator: {}, URL,
    window: { localStorage, addEventListener: (name, handler) => listeners[name] = handler },
    setInterval: handler => { tick = handler; },
  });
  assert.equal(values.get('vyrelum:selectedProject'), projectId);
  assert.equal(values.get('vyrealm:workspace'), 'film');
  assert.equal(values.get('unrelated-token'), 'untouched');
  const nextId = '61762639-5739-4e7a-a901-786886f44143';
  values.set('vyrelum:selectedProject', nextId); tick();
  assert.equal(sent.at(-1)[0], 'desktop-preferences:save');
  assert.equal(sent.at(-1)[1].selectedProject, nextId);
  const count = sent.length; tick(); assert.equal(sent.length, count);
  values.set('vyrealm:workspace', 'creator'); listeners.pagehide();
  assert.equal(sent.at(-1)[1].workspace, 'creator');
  values.delete('vyrelum:selectedProject'); tick();
  assert.equal(sent.at(-1)[1].selectedProject, null);
});
test('an explicit new-project selection stays cleared while an older profile can migrate its selection', async () => {
  for (const saved of [{ selectedProject: null, selectionRecorded: true }, { selectedProject: null, selectionRecorded: false }]) {
    const values = new Map([['vyrelum:selectedProject', projectId]]);
    runInNewContext(await readFile(new URL('./preload.cjs', import.meta.url), 'utf8'), {
      require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { sendSync: () => saved, send() {} } }),
      process: { platform: 'win32', versions: { electron: 'test' } },
      window: { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, addEventListener() {} }, setInterval() {},
    });
    assert.equal(values.get('vyrelum:selectedProject'), saved.selectionRecorded ? undefined : projectId);
  }
});
test('closing immediately saves the current selection before the periodic preload update', async t => {
  const directory = await fixture(t), preferences = await createDesktopPreferences(directory);
  await preferences.save({ selectedProject: projectId });
  let read = false;
  const window = { isDestroyed: () => false, webContents: {
    mainFrame: { url: 'http://127.0.0.1:4173/' },
    executeJavaScript: async source => { assert.ok(source.includes('vyrelum:selectedProject')); read = true; return { selectedProject: null, workspace: 'creator' }; },
  } };
  await persistWindowPreferences(window, preferences, 4173);
  assert.equal(read, true);
  assert.equal((await createDesktopPreferences(directory)).snapshot().selectedProject, null);
  window.webContents.mainFrame.url = 'http://127.0.0.1:4999/'; read = false;
  await persistWindowPreferences(window, preferences, 4173);
  assert.equal(read, false);
});
test('a hung renderer cannot indefinitely block desktop shutdown', async t => {
  const directory = await fixture(t), preferences = await createDesktopPreferences(directory);
  await preferences.save({ selectedProject: projectId });
  const window = { isDestroyed: () => false, webContents: { mainFrame: { url: 'http://127.0.0.1:4173/' }, executeJavaScript: () => new Promise(() => {}) } };
  await assert.rejects(persistWindowPreferences(window, preferences, 4173), /read timed out/);
  assert.equal((await createDesktopPreferences(directory)).snapshot().selectedProject, projectId);
});
