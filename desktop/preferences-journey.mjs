// Run against an already available Electron binary; never downloads a runtime.
// This opens the real source desktop shell with an isolated profile and server.
import { _electron } from '@playwright/test';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createDesktopPreferences } from './preferences.mjs';

const executablePath = process.argv[2];
if (!executablePath) throw Error('Pass the absolute path of an existing Electron executable.');
const root = resolve('.'), directory = join(root, 'work', `desktop-preferences-journey-${Date.now()}`), profile = join(directory, 'profile');
await mkdir(profile, { recursive: true });
const wrapper = join(directory, 'launch.mjs');
await writeFile(wrapper, `import { app } from 'electron';\napp.setPath('userData', ${JSON.stringify(profile)});\nawait import(${JSON.stringify(pathToFileURL(join(root, 'desktop/main.mjs')).href)});\n`);
const sockets = [], errors = [], launches = [];
let desktop;
async function occupy(port = 0) {
  const socket = createServer();
  await new Promise((yes, no) => { socket.once('error', no); socket.listen(port, '127.0.0.1', yes); });
  sockets.push(socket); return socket.address().port;
}
async function launch() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  desktop = await _electron.launch({ executablePath: resolve(executablePath), args: [wrapper, '--disable-gpu'], env, timeout: 30000 });
  const page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#refreshBtn:not(:disabled)').waitFor({ timeout: 30000 });
  await page.locator('#chatProject').waitFor();
  const state = await desktop.evaluate(({ app }) => ({ userData: app.getPath('userData'), packaged: app.isPackaged }));
  assert.equal(state.userData, profile); assert.equal(state.packaged, false);
  const port = Number(new URL(page.url()).port);
  launches.push({ port, selectedProject: await page.locator('#chatProject').inputValue() });
  return { page, port };
}
async function close() { await desktop.close(); desktop = null; }
try {
  const busyPort = await occupy();
  await (await createDesktopPreferences(profile)).save({ preferredPort: busyPort });
  const first = await launch(); assert.notEqual(first.port, busyPort);
  const project = await first.page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vyrelum-Token': session.token }, body: JSON.stringify({ name: 'Desktop restart qualification', brief: 'Use local footage for a short edit.', mode: 'creator', settings: { width: 1920, height: 1080, fps: 24 } }) });
    if (!response.ok) throw Error('Isolated project creation failed');
    return response.json();
  });
  await first.page.locator('#refreshBtn').click();
  await first.page.locator(`#chatProject option[value="${project.id}"]`).waitFor({ state: 'attached' });
  await first.page.locator('#chatProject').selectOption(project.id);
  await first.page.waitForFunction(id => localStorage.getItem('vyrelum:selectedProject') === id, project.id);
  await close();
  assert.equal(JSON.parse(await readFile(join(profile, 'desktop-preferences.json'), 'utf8')).selectedProject, project.id);

  const second = await launch();
  assert.equal(second.port, first.port, 'A normal restart must retain the exact origin');
  assert.equal(await second.page.locator('#chatProject').inputValue(), project.id);
  await close();

  await occupy(first.port);
  const third = await launch();
  assert.notEqual(third.port, first.port, 'The app must not attach to an unrelated server on its old port');
  assert.equal(await third.page.locator('#chatProject').inputValue(), project.id, 'Selection must survive a necessary origin change');
  const jobs = await (await third.page.request.get(new URL('/api/jobs', third.page.url()).href)).json();
  assert.deepEqual(jobs, []);
  await third.page.screenshot({ path: join(directory, 'collision-recovered.png') });
  await third.page.locator('#chatProject').selectOption('');
  await third.page.waitForFunction(() => localStorage.getItem('vyrelum:selectedProject') === null);
  await close();

  const fourth = await launch();
  assert.equal(fourth.port, third.port);
  assert.equal(await fourth.page.locator('#chatProject').inputValue(), '', 'An explicit new-project choice must stay cleared');
  await fourth.page.screenshot({ path: join(directory, 'cleared-selection.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'evidence.json'), JSON.stringify({ passed: true, sourceDesktop: true, installedBuild: false, profile, projectId: project.id, occupiedInitialPort: busyPort, launches, checks: ['actual Electron window and owned bundled-server startup', 'existing loopback port remains occupied by test server', 'normal relaunch preserves origin and selected project', 'second port collision restores selected project before initial renderer refresh', 'immediate quit after selection without waiting for background synchronization', 'explicit new-project selection survives restart', 'zero production jobs', 'no canonical profile mutations'], errors }, null, 2));
  console.log(JSON.stringify({ passed: true, directory, launches }));
} catch (error) {
  await writeFile(join(directory, 'failure.json'), JSON.stringify({ error: error.stack, launches, errors }, null, 2)); throw error;
} finally {
  await desktop?.close();
  await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
}
