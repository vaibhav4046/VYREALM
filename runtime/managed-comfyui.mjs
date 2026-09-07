import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, appendFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createComfyUIProvider } from './providers/comfyui.mjs';

const START_ARGS = ['--listen', '127.0.0.1', '--port', '8188', '--lowvram', '--disable-dynamic-vram', '--disable-smart-memory', '--cache-none', '--disable-api-nodes', '--disable-all-custom-nodes', '--whitelist-custom-nodes', 'ComfyUI-GGUF', '--disable-auto-launch', '--reserve-vram', '1', '--disable-async-offload', '--use-pytorch-cross-attention'];
let ownedProcess, pendingStart;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function within(root, target) { const r = relative(resolve(root), resolve(target)); return r && r !== '..' && !r.startsWith('..\\') && !r.startsWith('../') && !isAbsolute(r); }

// Configuration is written by local onboarding, never supplied in a workflow.
// Only the pinned Python entrypoint and reviewed custom node may be launched.
export async function ensureManagedComfyUI({ runtimeDir = process.env.VYRELUM_RUNTIME_DIR || resolve('data/runtime'), provider = createComfyUIProvider(), timeoutMs = 180000 } = {}) {
  if (pendingStart) return pendingStart;
  const health = await provider.health_check();
  if (health.available) return { status: 'ready', ownership: ownedProcess ? 'managed' : 'external', health };
  pendingStart = (async () => {
    let config;
    try { config = JSON.parse(await readFile(join(runtimeDir, 'comfyui.json'), 'utf8')); }
    catch { return { status: 'blocked', code: 'LOCAL_RUNTIME_NOT_INSTALLED', message: 'Install the local video runtime in Settings before starting neural generation.' }; }
    if (config.schemaVersion !== 1 || config.enabled !== true || !isAbsolute(config.root || '') || !isAbsolute(config.python || '')) throw new Error('LOCAL_RUNTIME_CONFIG_INVALID');
    const runtimeRoot = resolve(config.root), entry = join(runtimeRoot, 'ComfyUI', 'main.py');
    if (!within(runtimeRoot, config.python)) throw new Error('LOCAL_RUNTIME_PYTHON_OUTSIDE_INSTALL');
    const inventory = JSON.parse(await readFile(join(runtimeRoot, 'installation.json'), 'utf8'));
    if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.code) || !inventory.code.length || !Array.isArray(inventory.models) || inventory.models.length !== 3) throw new Error('LOCAL_RUNTIME_INTEGRITY_MISSING');
    for (const item of inventory.code) {
      const path = resolve(runtimeRoot, item.path);
      if (!within(runtimeRoot, path) || sha(await readFile(path)) !== item.sha256) throw new Error(`LOCAL_RUNTIME_CODE_CHANGED: ${item.path}`);
    }
    for (const item of inventory.models) {
      const path = resolve(runtimeRoot, item.path);
      if (!within(runtimeRoot, path)) throw new Error('LOCAL_MODEL_OUTSIDE_INSTALL');
      const s = await stat(path);
      // Full hashes are checked during onboarding. Changed files require repair.
      if (s.size !== item.bytes || Math.abs(s.mtimeMs - item.mtimeMs) > 2) throw new Error(`LOCAL_MODEL_CHANGED_REPAIR_REQUIRED: ${item.path}`);
    }
    await mkdir(join(runtimeDir, 'logs'), { recursive: true });
    const log = join(runtimeDir, 'logs', 'comfyui.log');
    const env = { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1' };
    // The desktop parent already strips hosted credentials from its environment.
    ownedProcess = spawn(config.python, [entry, ...START_ARGS], { cwd: join(runtimeRoot, 'ComfyUI'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const launched = ownedProcess;
    let startupError;
    launched.stdout.on('data', b => void appendFile(log, b));
    launched.stderr.on('data', b => void appendFile(log, b));
    launched.on('error', e => { startupError = e; });
    launched.on('exit', () => { if (ownedProcess === launched) ownedProcess = undefined; });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (startupError || launched.exitCode !== null) throw new Error(`LOCAL_RUNTIME_START_FAILED: ${startupError?.message || `exit ${launched.exitCode}`}`);
      const current = await provider.health_check();
      if (current.available) return { status: 'ready', ownership: 'managed', health: current };
      await new Promise(r => setTimeout(r, 1500));
    }
    await stopManagedComfyUI();
    throw new Error('LOCAL_RUNTIME_START_TIMEOUT');
  })();
  try { return await pendingStart; } catch(error) { await stopManagedComfyUI();throw error; } finally { pendingStart = undefined; }
}

export async function stopManagedComfyUI() {
  const child=ownedProcess;ownedProcess=undefined;if(!child?.pid)return;
  if(process.platform==='win32'){
    try{await promisify(execFile)('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,timeout:10000});}catch(error){if(child.exitCode===null)throw error;}
  }else child.kill('SIGTERM');
}
