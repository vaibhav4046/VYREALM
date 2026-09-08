import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { createOAuthOpener } from './oauth.mjs';
import { blenderRuntimePath } from './runtime-paths.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// Child Node cannot resolve Electron's virtual asar filesystem. Keep the
// executable engine and web assets in app.asar.unpacked for a real release.
const appRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : join(here, '..');
const allowedHost = (url, port) => {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && Number(u.port || 80) === port;
  } catch { return false; }
};

function findOpenPort(preferred = 4173) {
  return new Promise(resolve => {
    const probe = createServer();
    probe.once('error', () => {
      const fallback = createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const p = fallback.address().port;
        fallback.close(() => resolve(p));
      });
    });
    probe.listen(preferred, '127.0.0.1', () => {
      probe.close(() => resolve(preferred));
    });
  });
}

let serverProcess;
let serverPort;
let mainWindow;
let stopping = false;

ipcMain.handle('open-google-oauth', createOAuthOpener({
  getWindow: () => mainWindow,
  getPort: () => serverPort,
  openExternal: url => shell.openExternal(url)
}));

ipcMain.handle('open-local-url', (_event, url) => {
  // The preload validates this too; keep the main-process boundary strict.
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(String(url))) return false;
  return true;
});

async function logLine(line) {
  try {
    const logDir = join(app.getPath('userData'), 'logs');
    await mkdir(logDir, { recursive: true });
    await appendFile(join(logDir, 'vyrelum-server.log'), line);
  } catch { /* logging must never block startup */ }
}

async function startServer() {
  serverPort = await findOpenPort();
  const serverEntry = join(appRoot, 'server.js');
  if (!existsSync(serverEntry)) throw new Error(`Bundled server is missing: ${serverEntry}`);
  const runtimeNode = process.platform === 'win32'
    ? join(appRoot, 'runtime', 'node', 'node.exe')
    : join(appRoot, 'runtime', 'node', 'bin', 'node');
  const executable = existsSync(runtimeNode) ? runtimeNode : process.execPath;
  // Pass only runtime essentials to the child. Host API keys and unrelated
  // shell configuration must not become ambient capabilities of generated jobs.
  const env = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    TEMP: process.env.TEMP || '',
    TMP: process.env.TMP || '',
    HOME: process.env.HOME || '',
    USERPROFILE: process.env.USERPROFILE || '',
    LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    APPDATA: process.env.APPDATA || '',
    ELECTRON_RUN_AS_NODE: executable === process.execPath ? '1' : undefined,
    PORT: String(serverPort),
    VYRELUM_ROOT: appRoot,
    VYRELUM_DATA_DIR: join(app.getPath('userData'), 'data'),
    VYRELUM_RUNTIME_DIR: join(app.getPath('userData'), 'runtime'),
    VYRELUM_BLENDER: blenderRuntimePath({configured:process.env.VYRELUM_BLENDER,bundled:app.isPackaged?join(process.resourcesPath,'blender-runtime','blender.exe'):undefined}),
    VYRELUM_FFMPEG: join(appRoot, 'workers', 'tools', 'ffmpeg.exe'),
    VYRELUM_FFPROBE: join(appRoot, 'workers', 'tools', 'ffprobe.exe'),
    NODE_ENV: app.isPackaged ? 'production' : 'development'
  };
  if (!env.ELECTRON_RUN_AS_NODE) delete env.ELECTRON_RUN_AS_NODE;
  serverProcess = spawn(executable, [serverEntry], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true
  });
  serverProcess.stdout.on('data', data => void logLine(`[stdout] ${data}`));
  serverProcess.stderr.on('data', data => void logLine(`[stderr] ${data}`));
  serverProcess.on('error', err => void logLine(`[process-error] ${err.stack || err}`));
  serverProcess.on('exit', (code, signal) => {
    void logLine(`[exit] code=${code} signal=${signal}\n`);
    if (!stopping && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('VYRELUM local engine stopped', 'The bundled production engine exited. Reopen the app to repair the runtime.');
    }
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/session`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('The bundled local engine did not become ready within 15 seconds.');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#07050d',
    title: 'VYRELUM',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedHost(url, serverPort)) return { action: 'allow' };
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  return mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed = allowedHost(url, serverPort) || /^(file|data|blob|devtools):/.test(url);
    callback({ cancel: !allowed });
  });
  try {
    await startServer();
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('VYRELUM could not start', error.stack || String(error));
    app.quit();
  }
});

app.on('before-quit', event => {
  if(stopping)return;
  stopping = true;
  if(serverProcess&&!serverProcess.killed&&serverProcess.connected){
    event.preventDefault();
    const timer=setTimeout(()=>{serverProcess.kill();app.quit();},15000);
    serverProcess.once('exit',()=>{clearTimeout(timer);app.quit();});
    serverProcess.send({type:'shutdown'});
  }else if(serverProcess&&!serverProcess.killed)serverProcess.kill();
});
app.on('activate', () => { if (!mainWindow) void createWindow(); });
app.on('will-quit', () => { if (serverProcess && !serverProcess.killed) serverProcess.kill(); });

// Exposed for smoke tests without opening a window.
export const desktopRuntime = { get port() { return serverPort; }, get root() { return appRoot; } };
