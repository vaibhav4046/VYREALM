import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { createProviderRegistry } from './providers/registry.mjs';
const execFileAsync = promisify(execFile);

const EXE = {
  node: process.execPath,
  python: process.platform === 'win32' ? 'C:/Users/lalwa/AppData/Local/Programs/Python/Python313/python.exe' : 'python3',
  ollama: process.platform === 'win32' ? 'C:/Users/lalwa/AppData/Local/Programs/Ollama/ollama.exe' : 'ollama',
  nvidiaSmi: process.platform === 'win32' ? 'C:/Windows/system32/nvidia-smi.exe' : 'nvidia-smi',
  ffmpeg: 'ffmpeg', blender: 'blender',
};
async function run(file, args) { try { const r = await execFileAsync(file, args, { timeout: 15000, windowsHide: true }); return { ok: true, stdout: r.stdout.trim() }; } catch (e) { return { ok: false, error: e.code || e.message }; } }
export async function doctor({ ollamaUrl = 'http://127.0.0.1:11434' } = {}) {
  const [node, python, ollamaVersion, gpu, ffmpeg, blender, tags] = await Promise.all([
    run(EXE.node, ['--version']), run(EXE.python, ['--version']), run(EXE.ollama, ['--version']),
    run(EXE.nvidiaSmi, ['--query-gpu=name,driver_version,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits']),
    run(EXE.ffmpeg, ['-version']), run(EXE.blender, ['--version']),
    fetch(`${ollamaUrl}/api/tags`).then(async r => ({ ok: r.ok, json: await r.json() })).catch(e => ({ ok: false, error: e.message })),
  ]);
  const providers = await createProviderRegistry({}).inspect();
  return { timestamp: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, os: os.version(), cpu: os.cpus()[0]?.model, cpus: os.cpus().length, totalRamBytes: os.totalmem(), freeRamBytes: os.freemem() }, executables: { node, python, ollamaVersion, nvidiaSmi: gpu, ffmpeg, blender }, ollama: tags, providers, policy: { loopbackOnly: true, downloadsPerformed: 0, paidInference: false } };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/doctor.mjs')) console.log(JSON.stringify(await doctor(), null, 2));
