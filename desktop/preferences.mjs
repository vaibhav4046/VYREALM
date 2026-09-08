import { createServer } from 'node:net';
import { mkdir, lstat, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const defaults = { schemaVersion: 1, preferredPort: 4173, selectedProject: null, selectionRecorded: false, workspace: null };
const projectId = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function validate(value, persisted = false) {
  const keys = ['preferredPort', 'selectedProject', 'workspace', ...(persisted ? ['schemaVersion', 'selectionRecorded'] : [])];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) ||
      (persisted && value.schemaVersion !== 1) ||
      ('selectionRecorded' in value && typeof value.selectionRecorded !== 'boolean') ||
      ('preferredPort' in value && (!Number.isInteger(value.preferredPort) || value.preferredPort < 1024 || value.preferredPort > 65535)) ||
      ('selectedProject' in value && value.selectedProject !== null && (typeof value.selectedProject !== 'string' || !projectId.test(value.selectedProject))) ||
      ('workspace' in value && value.workspace !== null && !['creator', 'film'].includes(value.workspace))) {
    throw new Error('Invalid desktop preference');
  }
}

// This profile stores UI preferences only. Tokens, project documents and media
// remain in their existing protected vault and canonical project store.
export async function createDesktopPreferences(directory) {
  const file = join(directory, 'desktop-preferences.json');
  let state = { ...defaults }, pending = Promise.resolve();
  try {
    const info = await lstat(file);
    if (info.isFile() && !info.isSymbolicLink() && info.size <= 8192) {
      const saved = JSON.parse(await readFile(file, 'utf8')); validate(saved, true);
      state = { ...defaults, ...saved };
    }
  } catch { /* missing/corrupt preferences must not prevent opening projects */ }
  return {
    snapshot: () => ({ ...state }),
    save(update) {
      validate(update);
      state = { ...state, ...update, ...('selectedProject' in update ? { selectionRecorded: true } : {}) };
      const serialized = JSON.stringify(state, null, 2) + '\n';
      const write = pending.catch(() => {}).then(async () => {
        await mkdir(directory, { recursive: true });
        const temporary = join(directory, `.desktop-preferences-${randomUUID()}.tmp`);
        await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
      });
      pending = write;
      return write;
    },
    flush: () => pending,
  };
}

export function isOwnedDesktopFrame(event, window, port) {
  try {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    return url.origin === `http://127.0.0.1:${port}` && !url.username && !url.password;
  } catch { return false; }
}

export async function persistWindowPreferences(window, preferences, port) {
  if (!preferences) return;
  if (window && !window.isDestroyed()) {
    const frame = window.webContents.mainFrame;
    if (isOwnedDesktopFrame({ sender: window.webContents, senderFrame: frame }, window, port)) {
      // No arbitrary code or key list comes from the renderer. This final read
      // closes the gap between the last UI interaction and a fast app quit.
      let timeout;
      try {
        const value = await Promise.race([
          window.webContents.executeJavaScript("({selectedProject:localStorage.getItem('vyrelum:selectedProject'),workspace:localStorage.getItem('vyrealm:workspace')})"),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Desktop preference read timed out')), 2000); }),
        ]);
        await preferences.save(value);
      } finally { clearTimeout(timeout); }
    }
  }
  await preferences.flush();
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const chosen = server.address().port;
      server.close(error => error ? reject(error) : resolve(chosen));
    });
  });
}
export async function findOpenPort(preferred = 4173) {
  validate({ preferredPort: preferred });
  try { return await probePort(preferred); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  return probePort(0);
}
