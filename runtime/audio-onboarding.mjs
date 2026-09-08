import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const OWNER = 'vyrealm-audio-onboarding-v1';
const SAMPLE_TEXT = 'Your story starts here.';
const DISK_REQUIREMENT = 2 * 1024 ** 3;
const ACTIVE = new Set(['running', 'cancelling']);
const exec = promisify(execFile);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const timestamp = () => new Date().toISOString();
const redact = value => String(value || '').slice(-65536)
  .replace(/\b(?:hf_|gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{12,}/g, '[REDACTED_TOKEN]')
  .replace(/(\bBearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
  .replace(/((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)["']?\s*[:=]\s*["']?)[^\s"',}\r\n]+/gi, '$1[REDACTED]')
  .replace(/(https?:\/\/)[^/\s:@]+:[^/@\s]+@/gi, '$1[REDACTED]@');
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const alive = pid => { if (!Number.isSafeInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function boundedJSON(file, limit = 65536) {
  const info = await fs.stat(file); if (!info.isFile() || info.size > limit) fail('AUDIO_CONFIG_INVALID', 'The audio configuration or receipt is not a bounded regular file.');
  const bytes = await fs.readFile(file); try { return { value: JSON.parse(bytes.toString('utf8')), bytes }; } catch { fail('AUDIO_CONFIG_INVALID', 'An audio configuration or receipt contains invalid JSON.'); }
}
async function atomicJSON(file, value) {
  const pending = `${file}.${crypto.randomUUID()}.tmp`; await fs.writeFile(pending, JSON.stringify(value, null, 2), { flag: 'wx' });
  // Windows can briefly deny replacement while another status reader closes its handle.
  for (let attempt = 0; ; attempt++) { try { await fs.rename(pending, file); return; } catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 20) throw error; await new Promise(resolve => setTimeout(resolve, 10)); } }
}
async function fileHash(file, signal) { const hash = crypto.createHash('sha256'); for await (const bytes of createReadStream(file)) { signal?.throwIfAborted(); hash.update(bytes); } return hash.digest('hex'); }
async function freeBytes(directory) { let target = directory; while (!await exists(target)) { const parent = path.dirname(target); if (parent === target) break; target = parent; } const info = await fs.statfs(target); return Number(info.bavail) * Number(info.bsize); }

/** Only the ChildProcess created here may be stopped. Stored PIDs are never killed during recovery. */
async function runOwnedProcess({ executable, args, cwd, env, signal, onLine = () => {} }) {
  signal.throwIfAborted();
  const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', pending = '', closed = false, stopping;
  const completion = new Promise((resolve, reject) => {
    child.once('error', error => { closed = true; reject(Object.assign(new Error('A local audio setup process could not start.'), { code: error.code || 'AUDIO_PROCESS_START' })); });
    child.stdout.on('data', bytes => { stdout = (stdout + bytes).slice(-65536); pending = (pending + bytes).slice(-8192); let end; while ((end = pending.indexOf('\n')) >= 0) { onLine(pending.slice(0, end)); pending = pending.slice(end + 1); } });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4096); });
    child.once('close', exitCode => { closed = true; resolve({ exitCode, stdout, stderr }); });
  });
  const stop = () => {
    if (closed || !child.pid || stopping) return;
    stopping = (async () => {
      if (process.platform === 'win32') {
        const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe');
        await exec(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 15000, maxBuffer: 8192 }).catch(() => { if (!closed) child.kill(); });
      } else child.kill('SIGTERM');
    })();
  };
  signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
  try { const result = await completion; if (stopping) await stopping; return result; }
  finally { signal.removeEventListener('abort', stop); }
}

function validateConfigShape(config, modelCount) {
  if (config?.schemaVersion !== 1 || !['python', 'voice', 'whisper'].every(key => typeof config[key] === 'string' && path.isAbsolute(config[key]) && !config[key].startsWith('\\\\') && !config[key].includes('\0')) || path.basename(config.python).toLowerCase() !== 'python.exe' || !Array.isArray(config.files) || config.files.length !== modelCount) fail('AUDIO_CONFIG_INVALID', 'The local audio configuration does not describe the pinned Windows CPU runtime.');
}
async function verifyModels(config, manifest, signal) {
  validateConfigShape(config, manifest.models.length);
  if (!(await fs.stat(config.python).catch(() => null))?.isFile()) fail('AUDIO_PYTHON_MISSING', 'The registered audio Python executable is missing. Existing files were retained.');
  const modelRoot = await fs.realpath(path.resolve(path.dirname(config.voice), '..')).catch(() => null);
  if (!modelRoot) fail('AUDIO_MODEL_MISSING', 'The registered audio model directory is missing.');
  const requiredVoice = path.join(modelRoot, 'piper/en_US-ljspeech-high.onnx'), requiredWhisper = path.join(modelRoot, 'whisper-tiny.en');
  if (await fs.realpath(config.voice).catch(() => null) !== requiredVoice || await fs.realpath(config.whisper).catch(() => null) !== requiredWhisper) fail('AUDIO_CONFIG_INVALID', 'Voice and caption models must use the pinned audio model layout.');
  const records = [], seen = new Set();
  for (const pin of manifest.models) {
    signal.throwIfAborted(); const target = path.resolve(modelRoot, pin.destination), actual = await fs.realpath(target).catch(() => null);
    if (!actual || !inside(modelRoot, actual) || !(await fs.stat(actual)).isFile()) fail('AUDIO_MODEL_MISSING', `Pinned audio file is missing: ${pin.destination}.`);
    const entries = config.files.filter(item => typeof item?.path === 'string' && path.resolve(item.path) === target);
    if (entries.length !== 1 || entries[0].sha256 !== pin.sha256 || seen.has(actual)) fail('AUDIO_CONFIG_INVALID', 'The configuration must list every pinned model file exactly once with its bundled checksum.');
    seen.add(actual); const info = await fs.stat(actual);
    if (info.size !== pin.bytes || await fileHash(actual, signal) !== pin.sha256) fail('AUDIO_MODEL_INTEGRITY', `Pinned audio file failed its size or SHA-256 check: ${pin.destination}. It was retained for repair.`);
    records.push({ file: pin.destination, bytes: info.size, sha256: pin.sha256 });
  }
  return records;
}
function inspectWave(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 > bytes.length) fail('AUDIO_SAMPLE_INVALID', 'Piper did not produce a complete WAV file.');
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) { const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8; if (start + size > bytes.length) fail('AUDIO_SAMPLE_INVALID', 'The narration WAV is truncated.'); if (id === 'fmt ' && size >= 16) format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) }; if (id === 'data') pcm = bytes.subarray(start, start + size); offset = start + size + size % 2; }
  if (!format || format.encoding !== 1 || format.bits !== 16 || ![1, 2].includes(format.channels) || format.sampleRate < 8000 || format.sampleRate > 96000 || format.blockAlign !== format.channels * 2 || !pcm?.length || pcm.length % format.blockAlign) fail('AUDIO_SAMPLE_INVALID', 'The narration must contain valid 16-bit PCM samples.');
  const durationSeconds = pcm.length / format.blockAlign / format.sampleRate;
  if (durationSeconds < .2 || durationSeconds > 30) fail('AUDIO_SAMPLE_INVALID', 'The short narration sample has an invalid duration.');
  let energy = 0; for (let offset = 0; offset < pcm.length; offset += 2) energy += (pcm.readInt16LE(offset) / 32768) ** 2;
  if (Math.sqrt(energy / (pcm.length / 2)) < .0001) fail('AUDIO_SAMPLE_SILENT', 'The local narration sample is silent.');
  return { durationSeconds, sampleRate: format.sampleRate, channels: format.channels, frames: pcm.length / format.blockAlign };
}
async function checkSample(directory, manifest) {
  const voiceRoot = path.join(directory, 'voice'), transcriptRoot = path.join(directory, 'transcript');
  const voice = (await boundedJSON(path.join(voiceRoot, 'result.json'))).value, transcription = (await boundedJSON(path.join(transcriptRoot, 'result.json'))).value;
  if (voice.validated !== true || voice.status !== 'review_required' || voice.outputs?.audio !== 'narration.wav' || voice.provenance?.providerId !== 'piper-local-cpu' || voice.provenance?.modelId !== 'en_US-ljspeech-high' || voice.provenance?.prompt !== SAMPLE_TEXT || voice.provenance?.modelHash !== manifest.models.find(pin => pin.destination === 'piper/en_US-ljspeech-high.onnx').sha256) fail('AUDIO_VOICE_RECEIPT', 'The sample does not have an owned Piper generation receipt.');
  const audioPath = path.join(voiceRoot, 'narration.wav'), info = await fs.stat(audioPath); if (info.size > 12 * 1024 ** 2) fail('AUDIO_SAMPLE_INVALID', 'The short audio sample exceeds its size limit.');
  const audio = await fs.readFile(audioPath), outputHash = digest(audio), wave = inspectWave(audio);
  if (outputHash !== voice.provenance.outputHash) fail('AUDIO_OUTPUT_INTEGRITY', 'The narration sample does not match its receipt hash.');
  if (Math.abs(wave.durationSeconds - voice.durationSeconds) > .02 || wave.sampleRate !== voice.provenance.sampleRate) fail('AUDIO_SAMPLE_INVALID', 'The narration receipt does not match the actual WAV format.');
  if (transcription.validated !== true || transcription.status !== 'review_required' || transcription.outputs?.captions !== 'captions.srt' || transcription.provenance?.providerId !== 'faster-whisper-local-cpu' || transcription.provenance?.modelId !== 'tiny.en' || transcription.provenance?.sourceHash !== outputHash) fail('AUDIO_TRANSCRIPT_RECEIPT', 'Whisper did not transcribe this owned narration sample.');
  const rows = transcription.segments;
  if (!Array.isArray(rows) || !rows.length || rows.length > 30 || Math.abs(transcription.durationSeconds - wave.durationSeconds) > .1) fail('AUDIO_TRANSCRIPT_INVALID', 'Whisper did not return a timed transcript for the complete sample.');
  let end = 0;
  for (const row of rows) { if (typeof row.text !== 'string' || !row.text.trim() || !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < end || row.end <= row.start || row.end > wave.durationSeconds + .1 || !Array.isArray(row.words) || !row.words.length || row.words.some(word => typeof word.word !== 'string' || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < row.start - .1 || word.end < word.start || word.end > row.end + .1)) fail('AUDIO_TRANSCRIPT_INVALID', 'Whisper returned invalid segment or word timing.'); end = row.end; }
  const text = rows.map(row => row.text).join(' '); if (text.length > 1000 || !/\bstory\b/i.test(text) || !/\bstart(?:s)?\b/i.test(text)) fail('AUDIO_TRANSCRIPT_MISMATCH', 'Whisper could not recognize the expected short test phrase. Review the retained sample; the runtime was not qualified.');
  const captionsPath = path.join(transcriptRoot, 'captions.srt'); if ((await fs.stat(captionsPath)).size > 65536) fail('AUDIO_TRANSCRIPT_INVALID', 'The caption sample exceeds its size limit.');
  const captions = await fs.readFile(captionsPath), captionsHash = digest(captions);
  if (captionsHash !== transcription.provenance.outputHash || !captions.toString('utf8').includes('-->')) fail('AUDIO_OUTPUT_INTEGRITY', 'The timed caption file does not match the Whisper receipt.');
  return { voice: { ...wave, outputHash, providerId: 'piper-local-cpu', file: 'voice/narration.wav' }, transcription: { text, segments: rows.length, sourceHash: outputHash, outputHash: captionsHash, providerId: 'faster-whisper-local-cpu', file: 'transcript/captions.srt' } };
}

/** CPU-only audio setup. Installation and model verification are separate from subjective voice review. */
export async function createAudioOnboarding({ root, runtimeDir, installDirectory, dependencies = {} }) {
  root = path.resolve(root); runtimeDir = path.resolve(runtimeDir);
  installDirectory ??= path.resolve(process.env.LOCALAPPDATA || runtimeDir, 'VYREALM/audio');
  if (!path.isAbsolute(installDirectory) || installDirectory.startsWith('\\\\') || installDirectory.includes('\0') || path.resolve(installDirectory) === path.parse(path.resolve(installDirectory)).root) fail('AUDIO_SETUP_DIRECTORY', 'Use a controlled local audio runtime directory, not a drive root or network share.');
  installDirectory = path.resolve(installDirectory);
  const supported = (dependencies.platform || process.platform) === 'win32' && (dependencies.arch || process.arch) === 'x64';
  const stateDir = path.join(runtimeDir, 'audio-onboarding'), activeConfig = path.join(runtimeDir, 'audio.json'), latestFile = path.join(stateDir, 'latest.json'), lockFile = path.join(stateDir, 'setup.lock');
  const { value: manifest, bytes: manifestBytes } = await boundedJSON(path.join(root, 'runtime/audio-models.lock.json'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.models) || !manifest.models.length || manifest.models.length > 64 || manifest.models.some(pin => typeof pin.destination !== 'string' || path.isAbsolute(pin.destination) || !inside(installDirectory, path.resolve(installDirectory, pin.destination)) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || !/^[a-f0-9]{64}$/.test(pin.sha256)) || !manifest.models.some(pin => pin.destination === 'piper/en_US-ljspeech-high.onnx')) fail('AUDIO_MANIFEST_INVALID', 'The bundled audio model manifest is invalid.');
  const manifestHash = digest(manifestBytes), modelDownloadBytes = manifest.models.reduce((sum, pin) => sum + pin.bytes, 0);
  const requirementsFile = path.join(root, 'runtime/audio-requirements-windows.lock.txt'), requirementBytes = await fs.readFile(requirementsFile);
  const requirements = requirementBytes.toString('utf8').split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#')).map(line => { const match = line.match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)$/); if (!match) fail('AUDIO_REQUIREMENTS_INVALID', 'Audio dependencies must have exact pinned versions.'); return { name: match[1], version: match[2] }; });
  const processRunner = dependencies.runProcess || runOwnedProcess, diskFree = dependencies.freeBytes || freeBytes, isAlive = dependencies.isAlive || alive;
  let control = null, starting = false, closing = false, storageFailure = null;
  async function readJob() { try { const job = (await boundedJSON(latestFile, 128 * 1024)).value; if (job.owner !== OWNER || !/^[a-f0-9-]{36}$/.test(job.id) || !['install', 'verify'].includes(job.mode)) return null; return job; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async function readLease() { try { return (await boundedJSON(lockFile)).value; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async function save(job) { await fs.mkdir(path.join(stateDir, job.id), { recursive: true }); await atomicJSON(path.join(stateDir, job.id, 'status.json'), job); await atomicJSON(latestFile, job); }
  async function configState() {
    if (!await exists(activeConfig)) return { configured: false, configurationStatus: 'missing' };
    try { const config = await boundedJSON(activeConfig); validateConfigShape(config.value, manifest.models.length); return { configured: true, configurationStatus: 'installed', configurationHash: digest(config.bytes), ...config }; }
    catch { return { configured: true, configurationStatus: 'invalid', diagnostic: 'The existing audio configuration needs repair. It was not replaced.' }; }
  }
  const prior = await readJob(), priorLease = await readLease();
  if (prior && ACTIVE.has(prior.status) && !(priorLease?.owner === OWNER && isAlive(priorLease.pid))) { prior.status = 'failed'; prior.stage = 'Interrupted; setup files retained'; prior.error = 'AUDIO_SETUP_INTERRUPTED: The app stopped before qualification finished. Existing configuration was retained. Verify an existing runtime, or retry an unregistered installation.'; prior.errorCode = 'AUDIO_SETUP_INTERRUPTED'; prior.finishedAt = timestamp(); await save(prior); }
  async function status() {
    const current = await configState(), job = storageFailure || await readJob();
    if (current.configurationStatus === 'installed' && job?.status === 'succeeded' && job.evidence?.configurationHash === current.configurationHash && job.evidence?.manifestHash === manifestHash && job.evidence?.requirementsHash === digest(requirementBytes)) current.configurationStatus = 'verified';
    if (current.configurationStatus === 'installed' && job?.mode === 'verify' && job.status === 'failed' && job.configurationHash === current.configurationHash) current.configurationStatus = 'invalid';
    return { supported, configured: current.configured, configurationStatus: current.configurationStatus, modelDownloadBytes, diskRequirementBytes: DISK_REQUIREMENT, diskEstimateOnly: true, installDirectory, voiceModel: 'en_US-ljspeech-high', captionModel: 'tiny.en', job, ...(current.diagnostic ? { diagnostic: current.diagnostic } : {}), verificationMeaning: 'Last successful local model and sample test; not continuous integrity monitoring or subjective audio review.', dependencyIntegrity: 'Model and uv digests are pinned; Python packages have pinned versions without wheel digest pins.' };
  }
  async function takeLease(id) {
    await fs.mkdir(stateDir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try { const handle = await fs.open(lockFile, 'wx'); try { await handle.writeFile(JSON.stringify({ owner: OWNER, pid: process.pid, id, createdAt: timestamp() })); } finally { await handle.close(); } return; }
      catch (error) { if (error.code !== 'EEXIST') throw error; const lease = await readLease(); if (lease?.owner !== OWNER || isAlive(lease.pid)) fail('AUDIO_SETUP_BUSY', 'Another local audio setup is running.'); if (attempt) fail('AUDIO_SETUP_BUSY', 'The audio setup lease changed. Retry after the other setup finishes.'); await fs.unlink(lockFile); }
    }
  }
  async function releaseLease(id) { const lease = await readLease(); if (lease?.owner === OWNER && lease.id === id && lease.pid === process.pid) await fs.unlink(lockFile); }
  async function prepareInstallation(candidateFile, signal) {
    const models = path.join(installDirectory, 'models'), python = path.join(installDirectory, 'venv/Scripts/python.exe');
    const complete = await exists(python) && (await Promise.all(manifest.models.map(pin => exists(path.join(models, pin.destination))))).every(Boolean);
    if (complete) {
      const config = { schemaVersion: 1, python, voice: path.join(models, 'piper/en_US-ljspeech-high.onnx'), whisper: path.join(models, 'whisper-tiny.en'), files: manifest.models.map(pin => ({ path: path.join(models, pin.destination), sha256: pin.sha256 })) };
      await verifyModels(config, manifest, signal);
      await fs.writeFile(candidateFile, JSON.stringify(config, null, 2), { flag: 'wx' });
      return 'reuse-existing-files';
    }
    await fs.mkdir(installDirectory, { recursive: true }); const marker = path.join(installDirectory, 'vyrealm-audio-setup.json');
    if (await exists(marker)) {
      const value = (await boundedJSON(marker)).value;
      if (value.owner !== OWNER || value.manifestHash !== manifestHash || value.requirementsHash !== digest(requirementBytes)) fail('AUDIO_INSTALL_PROFILE_CHANGED', 'The existing setup directory belongs to a different audio profile. Its files were retained.');
    } else {
      if ((await fs.readdir(installDirectory)).length) fail('AUDIO_INSTALL_DIRECTORY_UNOWNED', 'The audio setup directory contains incomplete files from another setup. They were retained; this installer will not modify an unowned runtime.');
      await fs.writeFile(marker, JSON.stringify({ owner: OWNER, manifestHash, requirementsHash: digest(requirementBytes), createdAt: timestamp() }), { flag: 'wx' });
    }
    return 'install-or-resume';
  }
  async function run(job, configuration) {
    const own = control, jobRoot = path.join(stateDir, job.id), signal = own.controller.signal;
    const timer = setTimeout(() => own.controller.abort(Object.assign(new Error('Audio setup exceeded its bounded time limit. Partial files were retained.'), { code: 'AUDIO_SETUP_TIMEOUT' })), dependencies.maxRuntimeMs || (job.mode === 'install' ? 45 * 60000 : 5 * 60000)); timer.unref?.();
    const update = async (stage, progress) => { signal.throwIfAborted(); job.stage = stage; job.progress = progress; await save(job); };
    // Windows PowerShell 5 must not import incompatible PowerShell 7 modules inherited from a development host.
    // This scopes module discovery to the OS modules for this child; execution policy is unchanged.
    const env = { ...process.env, PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'), UV_PYTHON_INSTALL_DIR: path.join(installDirectory, 'python'), UV_PYTHON_PREFERENCE: 'only-managed', UV_LINK_MODE: 'copy', UV_CACHE_DIR: path.join(installDirectory, 'cache'), PYTHONDONTWRITEBYTECODE: '1', CUDA_VISIBLE_DEVICES: '-1', HIP_VISIBLE_DEVICES: '-1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
    async function call(kind, executable, args) {
      signal.throwIfAborted(); let result;
      try { result = await processRunner({ kind, executable, args, cwd: root, env, signal }); }
      catch (error) { result = { exitCode: null, stdout: '', stderr: `${error.code || 'PROCESS_START'}: ${error.message || 'A local process could not start.'}` }; }
      const stderr = redact(result?.stderr), stdout = redact(result?.stdout), text = `Audio setup process: ${kind}\nExit code: ${result?.exitCode ?? 'unknown'}\n\nSTDOUT (bounded, redacted)\n${stdout}\n\nSTDERR (bounded, redacted)\n${stderr}\n`, complete = Buffer.from(text), bytes = complete.subarray(Math.max(0, complete.length - 65536)), file = `process-${kind}.log`;
      await fs.writeFile(path.join(jobRoot, file), bytes); job.processDiagnostics ??= []; job.processDiagnostics.push({ kind, exitCode: result?.exitCode ?? null, file, bytes: bytes.length, truncated: complete.length > bytes.length, sha256: digest(bytes) }); await save(job);
      signal.throwIfAborted();
      if (result?.exitCode !== 0) {
        const detail = stderr.trim().slice(-600) || stdout.trim().slice(-600) || 'No process error text was returned.';
        fail('AUDIO_PROCESS_FAILED', `The local ${kind} process failed with exit ${result?.exitCode ?? 'unknown'}. ${detail} Retained diagnostic: ${file}. No runtime was qualified.`);
      }
      return result;
    }
    try {
      const configDirectory = path.join(jobRoot, 'config'); await fs.mkdir(configDirectory, { recursive: true }); const candidateFile = path.join(configDirectory, 'audio.json');
      if (job.mode === 'install') {
        if (await exists(activeConfig)) fail('AUDIO_CONFIG_EXISTS', 'An audio configuration appeared after setup started. It was retained.');
        await update('Checking for reusable local audio files', .04); job.installMethod = await prepareInstallation(candidateFile, signal);
        if (job.installMethod === 'install-or-resume') {
          await update('Installing pinned CPU audio dependencies and models', .08);
          const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
          await call('install', powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/Setup-AudioRuntime.ps1'), '-InstallDir', installDirectory, '-ConfigDir', configDirectory, '-ModelDir', path.join(installDirectory, 'models')]);
        }
      } else await fs.writeFile(candidateFile, configuration.bytes, { flag: 'wx' });
      const candidate = await boundedJSON(candidateFile); await update('Checking all pinned audio model files', .55); const modelFiles = await verifyModels(candidate.value, manifest, signal);
      await update('Checking installed CPU package versions', .67);
      const packageScript = 'import importlib.metadata,json,pathlib,sys\nrows=[]\nfor line in pathlib.Path(sys.argv[1]).read_text().splitlines():\n if not line.strip() or line.startswith("#"): continue\n name,version=line.split("==")\n actual=importlib.metadata.version(name)\n if actual!=version: raise RuntimeError("AUDIO_PACKAGE_VERSION_MISMATCH: "+name)\n rows.append({"name":name,"version":actual})\nprint(json.dumps({"packages":rows}))';
      const packages = await call('packages', candidate.value.python, ['-I', '-B', '-c', packageScript, requirementsFile]);
      let packageReceipt; try { packageReceipt = JSON.parse(packages.stdout); } catch { fail('AUDIO_PACKAGES_INVALID', 'The local Python package check did not return valid evidence.'); }
      if (JSON.stringify(packageReceipt.packages) !== JSON.stringify(requirements)) fail('AUDIO_PACKAGES_INVALID', 'Installed Python package versions do not match the pinned CPU requirements.');
      const worker = path.join(root, 'workers/audio-local.py'), workerHash = await fileHash(worker, signal), voiceRequest = path.join(jobRoot, 'voice-request.json'), transcriptionRequest = path.join(jobRoot, 'transcript-request.json');
      await fs.writeFile(voiceRequest, JSON.stringify({ operation: 'voiceover', text: SAMPLE_TEXT })); await update('Testing local Piper narration on CPU', .76);
      await call('voice', candidate.value.python, ['-B', worker, '--request', voiceRequest, '--output', path.join(jobRoot, 'voice'), '--config', candidateFile]);
      await fs.writeFile(transcriptionRequest, JSON.stringify({ operation: 'transcribe', inputPath: path.join(jobRoot, 'voice/narration.wav') })); await update('Testing local Whisper transcription on CPU', .86);
      await call('transcribe', candidate.value.python, ['-B', worker, '--request', transcriptionRequest, '--output', path.join(jobRoot, 'transcript'), '--config', candidateFile]);
      await update('Verifying narration, timed captions and model provenance', .95); const sample = await checkSample(jobRoot, manifest); await verifyModels(candidate.value, manifest, signal);
      if (await fileHash(worker, signal) !== workerHash || digest((await boundedJSON(candidateFile)).bytes) !== digest(candidate.bytes)) fail('AUDIO_SETUP_SOURCE_CHANGED', 'The worker or staged configuration changed during qualification.');
      if (job.mode === 'verify' && (!await exists(activeConfig) || digest((await boundedJSON(activeConfig)).bytes) !== job.configurationHash)) fail('AUDIO_CONFIG_CHANGED', 'The active audio configuration changed during verification. It was not modified by this test.');
      signal.throwIfAborted();
      if (job.mode === 'install') {
        const promotion = path.join(jobRoot, 'audio.verified.json'); await fs.writeFile(promotion, candidate.bytes, { flag: 'wx' });
        signal.throwIfAborted(); own.promoting = true;
        try { await fs.link(promotion, activeConfig); } catch (error) { if (error.code === 'EEXIST') fail('AUDIO_CONFIG_EXISTS', 'Another audio configuration was registered during setup. It was retained.'); throw error; }
        await fs.unlink(promotion);
      }
      job.status = 'succeeded'; job.stage = 'Local narration and captions tested'; job.progress = 1; job.finishedAt = timestamp(); job.error = null;
      const reused = job.mode === 'verify' || job.installMethod === 'reuse-existing-files';
      job.evidence = { schemaVersion: 1, status: 'verified', configurationHash: digest(candidate.bytes), manifestHash, requirementsHash: digest(requirementBytes), workerHash, modelFiles, packages: packageReceipt.packages, ...sample, modelDownloadBytes: reused ? 0 : null, modelReuse: reused, subjectiveAudioReview: false, note: 'CPU model execution, file integrity and timed transcription passed. Listen to pronunciation before production. Lip-sync, dubbing and diarization are not included.' };
      await save(job);
    } catch (error) {
      const reason = signal.aborted ? signal.reason : error; job.status = reason?.code === 'AUDIO_SETUP_CANCELLED' ? 'cancelled' : 'failed'; job.errorCode = reason?.code || 'AUDIO_SETUP_FAILED'; job.error = `${job.errorCode}: ${String(reason?.message || 'Local audio setup did not complete.').slice(0,900)}`; job.stage = job.status === 'cancelled' ? 'Cancelled; setup files retained' : 'Setup needs attention; files retained'; job.finishedAt = timestamp(); await save(job);
    } finally { clearTimeout(timer); await releaseLease(job.id); if (control === own) control = null; }
  }
  async function start(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'mode') || !['install', 'verify'].includes(input.mode)) fail('AUDIO_SETUP_INPUT', 'Choose only install or verify; commands, model URLs and paths are not accepted.');
    if (!supported) fail('AUDIO_SETUP_PLATFORM', 'Audio onboarding is qualified for Windows x64 only.');
    if (closing) fail('AUDIO_SETUP_CLOSED', 'The audio setup service is shutting down.');
    if (starting || control) fail('AUDIO_SETUP_BUSY', 'An audio setup or verification is already running.');
    starting = true; let leasedId;
    try {
      const configuration = await configState();
      if (input.mode === 'install' && configuration.configured) fail('AUDIO_CONFIG_EXISTS', 'An audio configuration already exists and was left unchanged. Use Verify existing audio tools.');
      if (input.mode === 'verify' && !configuration.configured) fail('AUDIO_CONFIG_MISSING', 'Install the local audio tools before verification.');
      if (input.mode === 'verify' && configuration.configurationStatus === 'invalid') fail('AUDIO_CONFIG_INVALID', 'The existing audio configuration is invalid and was retained for repair.');
      if (input.mode === 'install' && await diskFree(installDirectory) < DISK_REQUIREMENT) fail('AUDIO_SETUP_DISK', 'Allow an estimated 2 GiB free for CPU audio models, Python, packages and installation cache.');
      const job = { schemaVersion: 1, owner: OWNER, id: crypto.randomUUID(), mode: input.mode, status: 'running', stage: input.mode === 'install' ? 'Preparing audio installation' : 'Preparing offline audio verification', progress: 0, startedAt: timestamp(), finishedAt: null, error: null, evidence: null, configurationHash: configuration.configurationHash || null };
      await takeLease(job.id); leasedId = job.id; await save(job); storageFailure = null; control = { controller: new AbortController(), done: null, id: job.id };
      control.done = run(job, configuration).catch(() => {
        // A full or unavailable disk must not crash the server or leave an in-memory success claim.
        storageFailure = { ...job, status: 'failed', stage: 'Audio setup evidence could not be saved', errorCode: 'AUDIO_STATE_WRITE', error: 'AUDIO_STATE_WRITE: Setup state could not be persisted. Files were retained; free storage and verify the runtime again.', finishedAt: timestamp() };
        control = null;
      });
      return { job: structuredClone(job) };
    } catch (error) { if (leasedId && !control) await releaseLease(leasedId); throw error; } finally { starting = false; }
  }
  async function cancel(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) fail('AUDIO_SETUP_JOB', 'Choose the active audio setup job.');
    const job = await readJob(); if (!job || job.id !== id) fail('AUDIO_SETUP_JOB', 'The audio setup job was not found.');
    if (!control || control.id !== id) { if (ACTIVE.has(job.status)) fail('AUDIO_SETUP_BUSY', 'This audio setup belongs to another running app instance.'); return { job }; }
    const own = control; if (!own.promoting) own.controller.abort(Object.assign(new Error('Audio setup was cancelled. Existing configuration and partial setup files were retained.'), { code: 'AUDIO_SETUP_CANCELLED' })); await own.done; return { job: await readJob() };
  }
  async function close() { closing = true; if (control) await cancel(control.id); }
  return { status, start, cancel, close };
}
