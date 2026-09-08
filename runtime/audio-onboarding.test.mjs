import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createAudioOnboarding } from './audio-onboarding.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const destinations = ['piper/MODEL_CARD', 'piper/en_US-ljspeech-high.onnx', 'piper/en_US-ljspeech-high.onnx.json', 'whisper-tiny.en/README.md', 'whisper-tiny.en/config.json', 'whisper-tiny.en/model.bin', 'whisper-tiny.en/tokenizer.json', 'whisper-tiny.en/vocabulary.txt'];
function wave() {
  const samples = 22050, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(22050, 24); data.writeUInt32LE(44100, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i / 10) * 1200), 44 + i * 2);
  return data;
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'vyrealm-audio-onboarding-'));
  const root = path.join(directory, 'app'), runtimeDir = path.join(directory, 'profile/runtime'), installDirectory = path.join(directory, 'audio'), models = path.join(installDirectory, 'models');
  for (const dir of ['runtime', 'scripts', 'workers']) await fs.mkdir(path.join(root, dir), { recursive: true });
  const entries = destinations.map((destination, i) => { const bytes = Buffer.from(`fixture model ${i}`); return { destination, repository: 'fixture/audio', revision: 'a'.repeat(40), file: destination, bytes: bytes.length, sha256: digest(bytes) }; });
  await fs.writeFile(path.join(root, 'runtime/audio-models.lock.json'), JSON.stringify({ schemaVersion: 1, piper: '1.8.0', fasterWhisper: '1.2.1', models: entries }));
  await fs.writeFile(path.join(root, 'runtime/audio-requirements-windows.lock.txt'), 'piper-tts==1.8.0\nfaster-whisper==1.2.1\n');
  await fs.writeFile(path.join(root, 'scripts/Setup-AudioRuntime.ps1'), '# fixture only\n');
  await fs.writeFile(path.join(root, 'workers/audio-local.py'), '# fixture only\n');
  const config = { schemaVersion: 1, python: path.join(installDirectory, 'venv/Scripts/python.exe'), voice: path.join(models, 'piper/en_US-ljspeech-high.onnx'), whisper: path.join(models, 'whisper-tiny.en'), files: entries.map(item => ({ path: path.join(models, item.destination), sha256: item.sha256 })) };
  async function createRuntime(configDirectory) {
    await fs.mkdir(path.dirname(config.python), { recursive: true }); await fs.writeFile(config.python, 'fixture executable');
    for (let i = 0; i < entries.length; i++) { const target = path.join(models, entries[i].destination); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, `fixture model ${i}`); }
    await fs.mkdir(configDirectory, { recursive: true }); await fs.writeFile(path.join(configDirectory, 'audio.json'), JSON.stringify(config, null, 2));
  }
  const calls = [];
  async function runProcess(request) {
    calls.push(request);
    const arg = key => request.args[request.args.indexOf(key) + 1];
    if (request.kind === 'install') { await createRuntime(arg('-ConfigDir')); return { exitCode: 0, stdout: '', stderr: '' }; }
    if (request.kind === 'packages') return { exitCode: 0, stdout: JSON.stringify({ packages: [{ name: 'piper-tts', version: '1.8.0' }, { name: 'faster-whisper', version: '1.2.1' }] }), stderr: '' };
    const input = JSON.parse(await fs.readFile(arg('--request'), 'utf8')), output = arg('--output'); await fs.mkdir(output, { recursive: true });
    if (request.kind === 'voice') {
      const audio = wave(); await fs.writeFile(path.join(output, 'narration.wav'), audio);
      await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ validated: true, status: 'review_required', durationSeconds: 1, outputs: { audio: 'narration.wav' }, provenance: { providerId: 'piper-local-cpu', modelId: 'en_US-ljspeech-high', prompt: input.text, modelHash: entries[1].sha256, outputHash: digest(audio), sampleRate: 22050 } }));
    } else {
      const captions = '1\n00:00:00,000 --> 00:00:01,000\nYour story starts here.\n'; await fs.writeFile(path.join(output, 'captions.srt'), captions);
      await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ validated: true, status: 'review_required', durationSeconds: 1, segments: [{ start: 0, end: 1, text: 'Your story starts here.', words: [{ start: 0, end: .2, word: 'Your' }, { start: .2, end: .5, word: 'story' }, { start: .5, end: .7, word: 'starts' }, { start: .7, end: 1, word: 'here.' }] }], outputs: { captions: 'captions.srt' }, provenance: { providerId: 'faster-whisper-local-cpu', modelId: 'tiny.en', sourceHash: digest(await fs.readFile(input.inputPath)), outputHash: digest(captions) } }));
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  if (options.configured) await createRuntime(runtimeDir);
  const dependencies = { platform: 'win32', arch: 'x64', freeBytes: async () => 8 * 1024 ** 3, runProcess, ...options.dependencies };
  const service = await createAudioOnboarding({ root, runtimeDir, installDirectory, dependencies });
  t.after(async () => { await service.close(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, root, runtimeDir, installDirectory, models, config, entries, createRuntime, runProcess, calls, service, dependencies };
}
async function terminal(service) {
  for (let i = 0; i < 500; i++) { const value = await service.status(); if (value.job && ['succeeded', 'failed', 'cancelled'].includes(value.job.status)) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('Audio setup did not reach a terminal state');
}

test('missing-runtime status is cheap and install accepts only a fixed mode', async t => {
  const f = await fixture(t), status = await f.service.status(); assert.equal(status.supported, true); assert.equal(status.configured, false); assert.equal(status.configurationStatus, 'missing'); assert.equal(status.modelDownloadBytes, f.entries.reduce((n, p) => n + p.bytes, 0)); assert.equal(f.calls.length, 0);
  await assert.rejects(f.service.start({ mode: 'install', url: 'https://invalid.test/model' }), { code: 'AUDIO_SETUP_INPUT' });
  await assert.rejects(f.service.start({ mode: 'run-command' }), { code: 'AUDIO_SETUP_INPUT' });
  await assert.rejects(f.service.start({ mode: 'verify' }), { code: 'AUDIO_CONFIG_MISSING' });
});
test('installation promotes only after real receipt checks and retains durable evidence across reopen', async t => {
  const f = await fixture(t); await f.service.start({ mode: 'install' }); const result = await terminal(f.service);
  assert.equal(result.job.status, 'succeeded', result.job.error); assert.equal(result.configurationStatus, 'verified'); assert.equal(result.job.evidence.voice.outputHash, digest(wave())); assert.equal(result.job.evidence.subjectiveAudioReview, false);
  assert.deepEqual(f.calls.map(c => c.kind), ['install', 'packages', 'voice', 'transcribe']);
  assert.ok(f.calls[0].args.includes('-NonInteractive')); assert.ok(!f.calls[0].args.includes('-ExecutionPolicy'));
  assert.notEqual(f.calls[0].args[f.calls[0].args.indexOf('-ConfigDir') + 1], f.runtimeDir);
  await f.service.close(); const reopened = await createAudioOnboarding(f); t.after(() => reopened.close()); assert.equal((await reopened.status()).job.id, result.job.id); assert.equal((await reopened.status()).configurationStatus, 'verified');
});
test('existing-runtime verification reuses models offline and leaves configuration bytes unchanged', async t => {
  const f = await fixture(t, { configured: true }), original = await fs.readFile(path.join(f.runtimeDir, 'audio.json'));
  await assert.rejects(f.service.start({ mode: 'install' }), { code: 'AUDIO_CONFIG_EXISTS' });
  await f.service.start({ mode: 'verify' }); const result = await terminal(f.service); assert.equal(result.job.status, 'succeeded', result.job.error);
  assert.deepEqual(f.calls.map(c => c.kind), ['packages', 'voice', 'transcribe']); for (const call of f.calls) { assert.equal(call.env.HF_HUB_OFFLINE, '1'); assert.equal(call.env.TRANSFORMERS_OFFLINE, '1'); assert.equal(call.env.CUDA_VISIBLE_DEVICES, '-1'); }
  assert.deepEqual(await fs.readFile(path.join(f.runtimeDir, 'audio.json')), original);
});
test('a failed narration or transcription check never registers an installation', async t => {
  const f = await fixture(t); f.dependencies.runProcess = async request => { const result = await f.runProcess(request); if (request.kind === 'transcribe') await fs.writeFile(path.join(request.args[request.args.indexOf('--output') + 1], 'captions.srt'), 'tampered'); return result; };
  await f.service.close(); const service = await createAudioOnboarding(f); t.after(() => service.close()); await service.start({ mode: 'install' }); const result = await terminal(service); assert.equal(result.job.status, 'failed'); assert.match(result.job.error, /AUDIO_OUTPUT_INTEGRITY/); assert.equal(result.configured, false); assert.ok(await fs.stat(path.join(f.runtimeDir, 'audio-onboarding', result.job.id, 'config/audio.json')));
});
test('registering a complete existing runtime never reinstalls packages or copies model weights', async t => {
  const f = await fixture(t); await f.createRuntime(path.join(f.directory, 'other-profile')); const before = await Promise.all(f.config.files.map(item => fs.stat(item.path)));
  await f.service.start({ mode: 'install' }); const result = await terminal(f.service); assert.equal(result.job.status, 'succeeded', result.job.error); assert.equal(result.job.installMethod, 'reuse-existing-files'); assert.equal(result.job.evidence.modelDownloadBytes, 0); assert.deepEqual(f.calls.map(call => call.kind), ['packages', 'voice', 'transcribe']);
  for (let index = 0; index < before.length; index++) { const current = await fs.stat(f.config.files[index].path); assert.equal(current.mtimeMs, before[index].mtimeMs); assert.equal(current.size, before[index].size); }
});
test('incomplete unmanaged installation files are retained without package mutation', async t => {
  const f = await fixture(t); await fs.mkdir(f.installDirectory, { recursive: true }); await fs.writeFile(path.join(f.installDirectory, 'original.txt'), 'retain'); await f.service.start({ mode: 'install' }); const result = await terminal(f.service); assert.equal(result.job.status, 'failed'); assert.equal(result.job.errorCode, 'AUDIO_INSTALL_DIRECTORY_UNOWNED'); assert.equal(f.calls.length, 0); assert.equal(await fs.readFile(path.join(f.installDirectory, 'original.txt'), 'utf8'), 'retain');
});
test('failed setup retains bounded redacted process diagnostics without reporting success', async t => {
  const token = 'hf_' + 'z'.repeat(36), secret = 'secret-value-123';
  const f = await fixture(t, { dependencies: { runProcess: async () => ({ exitCode: 1, stdout: 'x'.repeat(100000), stderr: `Native setup failed\nAuthorization: Bearer ${token}\nclient_secret=${secret}\nThe required helper could not be loaded.` }) } });
  await f.service.start({ mode: 'install' }); const result = await terminal(f.service); assert.equal(result.job.status, 'failed'); assert.equal(result.configured, false); assert.equal(result.job.processDiagnostics.length, 1);
  const info = result.job.processDiagnostics[0], bytes = await fs.readFile(path.join(f.runtimeDir, 'audio-onboarding', result.job.id, info.file)); assert.ok(bytes.length <= 65536); assert.equal(info.sha256, digest(bytes)); assert.equal(bytes.includes(Buffer.from(token)), false); assert.equal(bytes.includes(Buffer.from(secret)), false); assert.match(bytes.toString(), /required helper could not be loaded/); assert.equal(JSON.stringify(result).includes(token), false); assert.equal(JSON.stringify(result).includes(secret), false); assert.match(result.job.error, /required helper could not be loaded/);
});
test('corrupt existing models fail offline verification before invoking any model and are retained', async t => {
  const f = await fixture(t, { configured: true }); await fs.writeFile(f.config.voice, 'changed'); await f.service.start({ mode: 'verify' }); const result = await terminal(f.service); assert.equal(result.job.status, 'failed'); assert.match(result.job.error, /AUDIO_MODEL_INTEGRITY/); assert.equal(result.configurationStatus, 'invalid'); assert.equal(f.calls.length, 0); assert.equal(await fs.readFile(f.config.voice, 'utf8'), 'changed');
});
test('a concurrent configuration wins and is never replaced by a staged install', async t => {
  const f = await fixture(t); const later = JSON.stringify({ createdElsewhere: true }); f.dependencies.runProcess = async request => { const result = await f.runProcess(request); if (request.kind === 'transcribe') await fs.writeFile(path.join(f.runtimeDir, 'audio.json'), later); return result; };
  await f.service.close(); const service = await createAudioOnboarding(f); t.after(() => service.close()); await service.start({ mode: 'install' }); const result = await terminal(service); assert.equal(result.job.status, 'failed'); assert.match(result.job.error, /AUDIO_CONFIG_EXISTS/); assert.equal(await fs.readFile(path.join(f.runtimeDir, 'audio.json'), 'utf8'), later);
});
test('cancellation stops only the owned process and holds the one-flight lock until it settles', async t => {
  let entered, released; const ready = new Promise(resolve => { entered = resolve; }); let aborted = false;
  const f = await fixture(t, { dependencies: { runProcess: async request => { entered(); await new Promise(resolve => { released = resolve; request.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }); }); return { exitCode: 1 }; } } });
  const { job } = await f.service.start({ mode: 'install' }); await ready; await assert.rejects(f.service.start({ mode: 'install' }), { code: 'AUDIO_SETUP_BUSY' });
  await f.service.cancel(job.id); const result = await terminal(f.service); assert.equal(aborted, true); assert.equal(result.job.status, 'cancelled'); assert.equal(result.configured, false); released();
});
test('unsupported platforms and low disk never start installers', async t => {
  const unsupported = await fixture(t, { dependencies: { platform: 'darwin', arch: 'arm64' } }); assert.equal((await unsupported.service.status()).supported, false); await assert.rejects(unsupported.service.start({ mode: 'install' }), { code: 'AUDIO_SETUP_PLATFORM' });
  const low = await fixture(t, { dependencies: { freeBytes: async () => 10 } }); await assert.rejects(low.service.start({ mode: 'install' }), { code: 'AUDIO_SETUP_DISK' }); assert.equal(low.calls.length, 0);
});
test('restart marks an interrupted job failed without killing an unowned stored PID', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.runtimeDir, 'audio-onboarding'), { recursive: true }); const id = crypto.randomUUID(), interrupted = { schemaVersion: 1, owner: 'vyrealm-audio-onboarding-v1', id, mode: 'install', status: 'running', stage: 'Installing', startedAt: new Date().toISOString() };
  await fs.writeFile(path.join(f.runtimeDir, 'audio-onboarding/latest.json'), JSON.stringify(interrupted)); await f.service.close(); const reopened = await createAudioOnboarding(f); t.after(() => reopened.close()); const result = await reopened.status(); assert.equal(result.job.status, 'failed'); assert.match(result.job.error, /AUDIO_SETUP_INTERRUPTED/); assert.equal(f.calls.length, 0);
});

test('the bounded timeout fails without promoting a runtime', async t => {
  const f = await fixture(t, { dependencies: { maxRuntimeMs: 30, runProcess: request => new Promise(resolve => { request.signal.addEventListener('abort', () => resolve({ exitCode: 1 }), { once: true }); }) } });
  await f.service.start({ mode: 'install' }); const result = await terminal(f.service); assert.equal(result.job.status, 'failed'); assert.equal(result.job.errorCode, 'AUDIO_SETUP_TIMEOUT'); assert.equal(result.configured, false);
});
test('a second service cannot replace or cancel the first service’s active job', async t => {
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { dependencies: { runProcess: request => new Promise(resolve => { entered(); request.signal.addEventListener('abort', () => resolve({ exitCode: 1 }), { once: true }); }) } });
  const { job } = await f.service.start({ mode: 'install' }); await ready; const second = await createAudioOnboarding(f); t.after(() => second.close());
  assert.equal((await second.status()).job.status, 'running'); await assert.rejects(second.start({ mode: 'install' }), { code: 'AUDIO_SETUP_BUSY' }); await assert.rejects(second.cancel(job.id), { code: 'AUDIO_SETUP_BUSY' });
  await second.close(); assert.equal((await f.service.status()).job.status, 'running'); await f.service.cancel(job.id); assert.equal((await second.status()).job.status, 'cancelled');
});
test('a changed active configuration invalidates verification without rewriting it', async t => {
  const f = await fixture(t, { configured: true }), changed = JSON.stringify({ ...f.config, userNote: 'preserve this edit' });
  f.dependencies.runProcess = async request => { const result = await f.runProcess(request); if (request.kind === 'transcribe') await fs.writeFile(path.join(f.runtimeDir, 'audio.json'), changed); return result; };
  await f.service.close(); const service = await createAudioOnboarding(f); t.after(() => service.close()); await service.start({ mode: 'verify' }); const result = await terminal(service); assert.equal(result.job.status, 'failed'); assert.equal(result.job.errorCode, 'AUDIO_CONFIG_CHANGED'); assert.equal(await fs.readFile(path.join(f.runtimeDir, 'audio.json'), 'utf8'), changed);
});
test('real hidden PowerShell setup cancellation terminates its owned descendant', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const f = await fixture(t, { dependencies: { runProcess: undefined } });
  const script = `param([string]$InstallDir,[string]$ConfigDir,[string]$ModelDir)\n$ErrorActionPreference='Stop'\nNew-Item -ItemType Directory -Force $ConfigDir | Out-Null\n$ownedChild = Start-Process -FilePath '${process.execPath.replaceAll("'", "''")}' -ArgumentList @('-e','setInterval(()=>{},1000)') -WindowStyle Hidden -PassThru\n[IO.File]::WriteAllText((Join-Path $ConfigDir 'descendant.pid'),[string]$ownedChild.Id)\nWait-Process -Id $ownedChild.Id\n`;
  await fs.writeFile(path.join(f.root, 'scripts/Setup-AudioRuntime.ps1'), script); const { job } = await f.service.start({ mode: 'install' }), pidFile = path.join(f.runtimeDir, 'audio-onboarding', job.id, 'config/descendant.pid');
  let pid; for (let i = 0; i < 100; i++) { try { pid = Number(await fs.readFile(pidFile, 'utf8')); if (pid) break; } catch {} const current = await f.service.status(); if (current.job.status === 'failed') assert.fail(current.job.error); await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(pid > 0, 'The owned descendant should have started'); await f.service.cancel(job.id); assert.equal((await f.service.status()).job.status, 'cancelled');
  let running = true; for (let i = 0; i < 30; i++) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') { running = false; break; } throw error; } await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.equal(running, false, 'Cancellation must stop the child process tree, not just the PowerShell wrapper'); assert.equal((await f.service.status()).configured, false);
});
test('Windows PowerShell setup resolves its own built-in hashing module, not inherited PowerShell 7 modules', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const f = await fixture(t, { dependencies: { runProcess: undefined } });
  await fs.writeFile(path.join(f.root, 'scripts/Setup-AudioRuntime.ps1'), "param([string]$InstallDir,[string]$ConfigDir,[string]$ModelDir)\n$ErrorActionPreference='Stop'\n$hash = Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256\nWrite-Output ('BuiltinHash=' + $hash.Hash)\nWrite-Output ('UtilityVersion=' + (Get-Command Get-FileHash).Version)\n");
  await f.service.start({ mode: 'install' }); const result = await terminal(f.service), install = result.job.processDiagnostics.find(item => item.kind === 'install');
  assert.equal(install.exitCode, 0, result.job.error); const log = await fs.readFile(path.join(f.runtimeDir, 'audio-onboarding', result.job.id, install.file), 'utf8'); assert.match(log, /BuiltinHash=[A-F0-9]{64}/); assert.match(log, /UtilityVersion=3\.1\.0\.0/);
  assert.equal(result.configured, false); // This helper-only fixture deliberately creates no model configuration.
});
