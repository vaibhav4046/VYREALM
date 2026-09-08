import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile, statfs } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { acquireGpuLease } from '../runtime/inference-harness.mjs';
import { verifyReviewTarget } from '../runtime/verify-review-target.mjs';
import { canonicalLtxJobsRoot, ltxWorkflow, LTX_MODELS, LTX_PROFILES, produceLocalLtxShot, verifyOwnedLtxReference } from '../runtime/ltx-production.mjs';
import { createComfyUIProvider } from '../runtime/providers/comfyui.mjs';
import { verifyOwnedGeneratedKeyframe } from '../runtime/keyframe-production.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const now = () => new Date().toISOString();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const emit = value => console.log(JSON.stringify(value));

export function parseBenchmarkArgs(args) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    run: { type: 'boolean', default: false }, 'data-dir': { type: 'string' },
    'source-job': { type: 'string' }, 'prompt-file': { type: 'string' }, seed: { type:'string' },
    profile: { type: 'string', default: 'draft-512' }, 'queue-policy': { type: 'string', default: 'idle' },
    'tiled-decode': { type: 'boolean', default: false }, 'stop-job': { type: 'string' },
  } });
  if ((!values['stop-job'] && !uuid.test(values['source-job'] || '')) || values['source-job'] && !uuid.test(values['source-job']) || values['stop-job'] && !uuid.test(values['stop-job'])) fail('LTX_JOB_ID', 'Explicitly select a reviewed VYREALM source job UUID; no character is selected by default');
  if (!Object.hasOwn(LTX_PROFILES, values.profile) || !['idle', 'fifo'].includes(values['queue-policy'])) fail('LTX_PROFILE', 'Use a fixed LTX profile and idle/fifo queue policy');
  if (values.run && values['stop-job']) fail('LTX_ARGUMENTS', 'Run and stop are separate qualification operations');
  const seed = values.seed === undefined ? 730241 : Number(values.seed);
  if (!Number.isSafeInteger(seed) || seed < 0) fail('LTX_SEED','Seed must be a nonnegative safe integer');
  return { run: values.run, dataDir: values['data-dir'] || process.env.VYRELUM_DATA_DIR || join(process.env.APPDATA || join(homedir(), '.local', 'state'), 'vyrelum', 'data'), sourceJobId: values['source-job'], profile: values.profile, queuePolicy: values['queue-policy'], tiledDecode: values['tiled-decode'], stopJobId: values['stop-job'], promptFile:values['prompt-file'], seed };
}

export async function acquireQualificationLease({ owner, isStopped = () => false, onWait = () => {}, timeoutMs = 3600000, pollIntervalMs = 2000, acquire = acquireGpuLease }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) fail('LTX_LEASE_TIMEOUT', 'Qualification GPU lease wait must be bounded to one hour');
  const started = Date.now();
  while (true) {
    if (isStopped()) fail('LTX_STOP_REQUESTED', 'LTX_STOP_REQUESTED: Qualification stopped while waiting for the shared GPU');
    try { return await acquire(owner); }
    catch (error) {
      if (error.message !== 'GPU_LEASE_BUSY') throw error;
      if (Date.now() - started >= timeoutMs) fail('LTX_LEASE_TIMEOUT', 'LTX_LEASE_TIMEOUT: The shared GPU remained owned by another job; this qualification was not submitted');
      onWait({ elapsedSeconds: Math.floor((Date.now() - started) / 1000), maximumSeconds: timeoutMs / 1000 });
      await new Promise(resolveWait => setTimeout(resolveWait, Math.min(pollIntervalMs, Math.max(1, timeoutMs - (Date.now() - started)))));
    }
  }
}

async function storePaths(dataDir) {
  const databasePath = await realpath(join(resolve(dataDir), 'vyrelum.sqlite'));
  const canonicalData = dirname(databasePath);
  return { databasePath, dataDir: canonicalData, jobsDir: await canonicalLtxJobsRoot(join(canonicalData, 'jobs')), mediaDir: await realpath(join(canonicalData, 'media')) };
}

export async function inspectLtxBenchmark(options) {
  const paths = await storePaths(options.dataDir), db = new DatabaseSync(paths.databasePath, { readOnly: true });
  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(options.sourceJobId);
    if (!job || job.status !== 'succeeded' || !['generation-test', 'generation-shot','generation-keyframe'].includes(job.type)) fail('LTX_SOURCE_NOT_REVIEWED', 'The source must be a succeeded, visually reviewed VYREALM generation job');
    const output = JSON.parse(job.output || 'null');
    if (output?.review?.verdict !== 'passed' || output.provenance?.generationStatus !== 'generated') fail('LTX_SOURCE_NOT_REVIEWED', 'The source must have a passed local-generation review');
    await verifyBenchmarkSource({db,paths,job,output});
    const project = db.prepare('SELECT id,revision FROM projects WHERE id=?').get(job.project_id);
    if (!project) fail('LTX_SOURCE_PROJECT', 'The original project is missing');
    const sourceRoot = join(paths.jobsDir, job.id);
    let referencePath = join(sourceRoot, 'keyframe', 'frames', '00000.png');
    try { await realpath(referencePath); } catch (error) { if (error.code !== 'ENOENT') throw error; referencePath = join(sourceRoot, 'reference.png'); }
    const reference = { path: referencePath, sha256: output.provenance.keyframe?.outputHash, promptId: output.provenance.keyframe?.promptId, sourceJobId: job.id };
    await verifyOwnedLtxReference({ jobsDir: paths.jobsDir, projectId: project.id, reference });
    const prompt = options.promptFile ? (await readFile(options.promptFile,'utf8')).trim() : output.provenance.source?.prompt || output.provenance.prompt;
    const seed = options.seed ?? 730241;
    const workflow = ltxWorkflow({ prompt, seed, profile: options.profile, tiledDecode: options.tiledDecode, imageName: 'preflight.png', prefix: 'vyrealm/preflight/motion' });
    const provider = createComfyUIProvider(), health = await provider.health_check();
    if (!health.available) fail('LTX_PROVIDER_UNAVAILABLE', health.reason);
    const installed = Object.values(health.installedModels || {}).flat();
    const missingModels = Object.values(LTX_MODELS).filter(name => !installed.includes(name));
    const missingNodes = [...new Set(Object.values(workflow).map(node => node.class_type))].filter(name => !health.nodes.includes(name));
    if (missingModels.length || missingNodes.length) fail('LTX_DEPENDENCIES_MISSING', JSON.stringify({ missingModels, missingNodes }));
    const devices = health.system?.devices || [];
    if (!devices.some(device => device.type === 'cuda')) fail('LTX_CUDA_UNAVAILABLE', 'This Windows qualification requires the installed CUDA device');
    const disk = await statfs(paths.jobsDir), freeBytes = Number(disk.bavail) * Number(disk.bsize);
    if (freeBytes < 2 * 1024 ** 3) fail('LTX_DISK_SPACE', 'At least 2 GiB of free job storage is required');
    return { ...paths, projectId: project.id, revision: project.revision, reference, prompt, seed, provider, sourceOutputHash: output.provenance.outputHash, sourceStoredOutput: job.output, profile: options.profile, queuePolicy: options.queuePolicy, tiledDecode: options.tiledDecode, hardware: { devices, freeDiskGb: freeBytes / 1024 ** 3 } };
  } finally { db.close(); }
}

async function verifyBenchmarkSource({db,paths,job,output}) {
  if(job.type==='generation-keyframe') return verifyOwnedGeneratedKeyframe({...paths,db,sourceJobId:job.id,projectId:job.project_id,expectedHash:output.provenance.outputHash});
  return verifyReviewTarget({db,jobsDir:paths.jobsDir,mediaDir:paths.mediaDir,job,output,expectedOutputHash:output.provenance.outputHash});
}

async function requestStop(options) {
  const paths = await storePaths(options.dataDir), db = new DatabaseSync(paths.databasePath, { readOnly: true });
  try {
    const job = db.prepare('SELECT type,status FROM jobs WHERE id=?').get(options.stopJobId);
    if (!job || job.type !== 'ltx-qualification' || job.status !== 'running') fail('LTX_STOP_TARGET', 'Only an active LTX qualification may be stopped with this runner');
    const jobRoot = await realpath(join(paths.jobsDir, options.stopJobId));
    if (dirname(jobRoot).toLowerCase() !== paths.jobsDir.toLowerCase()) fail('LTX_STOP_TARGET', 'Qualification folder is outside the canonical store');
    await writeFile(join(jobRoot, 'stop.requested'), JSON.stringify({ requestedAt: now(), operation: 'stop-owned-qualification' }));
    return { status: 'stop_requested', jobId: options.stopJobId };
  } finally { db.close(); }
}

export async function runLtxBenchmark(options) {
  if (options.stopJobId) return requestStop(options);
  const prepared = await inspectLtxBenchmark(options);
  if (!options.run) return { status: 'ready_for_opt_in_qualification', sourceJobId: prepared.reference.sourceJobId, projectId: prepared.projectId, profile: prepared.profile, referenceHash: prepared.reference.sha256, seed: prepared.seed, models: LTX_MODELS, hardware: prepared.hardware, queuePolicy: prepared.queuePolicy, tiledDecode: prepared.tiledDecode, modelInvoked: false, filesChanged: false };
  const id = randomUUID(), jobRoot = join(prepared.jobsDir, id), db = new DatabaseSync(prepared.databasePath);
  db.exec('PRAGMA busy_timeout=5000');
  let release, monitor, registered = false, stopping = false, stopPromise = null;
  const request = { kind: 'ltx-qualification', projectId: prepared.projectId, revision: prepared.revision, sourceJobId: prepared.reference.sourceJobId, sourceReviewedOutputHash: prepared.sourceOutputHash, reference: prepared.reference, brief: prepared.prompt, seed: prepared.seed, profile: prepared.profile, tiledDecode: prepared.tiledDecode, queuePolicy: prepared.queuePolicy, append: false };
  const stopOwned = () => {
    stopping = true;
    if (!stopPromise) stopPromise = (async () => {
      try {
        const events = (await readFile(join(jobRoot, 'motion', 'provider.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
        const submitted = events.find(event => event.event === 'submitted');
        if (submitted?.promptId) await prepared.provider.cancel(submitted.promptId);
      } catch (error) { if (error.code !== 'ENOENT') emit({ jobId: id, stage: 'owned cancellation diagnostic', message: error.message }); }
    })();
    return stopPromise;
  };
  const signal = () => { void stopOwned(); };
  try {
    const current = db.prepare('SELECT status,output FROM jobs WHERE id=?').get(prepared.reference.sourceJobId);
    if (current?.status !== 'succeeded' || current.output !== prepared.sourceStoredOutput) fail('LTX_SOURCE_CHANGED', 'The source review changed during preflight; run inspection again');
    await mkdir(jobRoot, { recursive: false });
    await writeFile(join(jobRoot, 'request.json'), JSON.stringify(request, null, 2), { flag: 'wx' });
    const created = now();
    db.prepare('INSERT INTO jobs (id,project_id,revision,type,status,progress,stage,input,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, prepared.projectId, prepared.revision, 'ltx-qualification', 'running', 0, 'waiting for the shared local GPU lease', JSON.stringify(request), created, created);
    registered = true;
    process.once('SIGINT', signal); process.once('SIGTERM', signal);
    monitor = setInterval(() => { void readFile(join(jobRoot, 'stop.requested')).then(stopOwned).catch(error => { if (error.code !== 'ENOENT') emit({ jobId: id, code: 'STOP_FILE_READ_FAILED', message: error.message }); }); }, 1000);
    emit({ jobId: id, status: 'waiting_for_gpu_lease', sourceJobId: prepared.reference.sourceJobId, profile: prepared.profile, outputDirectory: jobRoot, control: `node scripts/benchmark-ltx-shot.mjs --data-dir "${prepared.dataDir}" --stop-job ${id}` });
    const leaseWaitStarted = Date.now();
    release = await acquireQualificationLease({ owner: `ltx-qualification:${id}`, isStopped: () => stopping || db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status !== 'running', onWait: timing => {
      const stage = `Waiting for shared GPU lease (${timing.elapsedSeconds}s; maximum ${timing.maximumSeconds}s)`;
      db.prepare("UPDATE jobs SET stage=?,updated_at=? WHERE id=? AND status='running'").run(stage, now(), id);
      emit({ jobId: id, stage, ...timing });
    } });
    const leaseWaitMs = Date.now() - leaseWaitStarted;
    await release.registerChild(process.pid);
    db.prepare("UPDATE jobs SET stage='local LTX qualification',updated_at=? WHERE id=? AND status='running'").run(now(), id);
    // The shared lease may have required a long wait. Recheck the exact
    // reviewed DB/file/served-asset snapshot immediately before inference.
    const sourceAfterWait = db.prepare('SELECT * FROM jobs WHERE id=?').get(prepared.reference.sourceJobId);
    if (sourceAfterWait?.status !== 'succeeded' || sourceAfterWait.output !== prepared.sourceStoredOutput) fail('LTX_SOURCE_CHANGED', 'The source changed while waiting for the GPU; no LTX prompt was submitted');
    await verifyBenchmarkSource({db,paths:prepared,job:sourceAfterWait,output:JSON.parse(sourceAfterWait.output)});
    const receipt = await produceLocalLtxShot({ ...prepared, output: jobRoot, onProgress: progress => {
      if (stopping) fail('LTX_STOP_REQUESTED', 'Qualification stop requested; no output will be promoted');
      const currentJob = db.prepare('SELECT status FROM jobs WHERE id=?').get(id);
      if (currentJob?.status !== 'running') { void stopOwned(); fail('LTX_JOB_STATE_CHANGED', 'The durable qualification state changed; stopping its owned provider prompt'); }
      const value = Math.max(0, Math.min(1, Number(progress.progress) || 0));
      db.prepare("UPDATE jobs SET progress=MAX(progress,?),stage=?,updated_at=? WHERE id=? AND status='running'").run(value, progress.stage || 'local LTX qualification', now(), id);
      void writeFile(join(jobRoot, 'progress.json'), JSON.stringify(progress)).catch(() => {});
      emit({ jobId: id, ...progress });
    } });
    if (stopping || db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status !== 'running') fail('LTX_STOP_REQUESTED', 'Qualification stopped before registration');
    receipt.qualification = { kind: 'ltx-qualification', sourceJobId: prepared.reference.sourceJobId, experimental: true, approvedForCatalog: false, engineModule: 'runtime/ltx-production.mjs', leaseWaitMs };
    await writeFile(join(jobRoot, 'result.json'), JSON.stringify(receipt, null, 2));
    await writeFile(join(jobRoot, 'verification.json'), JSON.stringify(receipt, null, 2));
    const createdAssets = {}, assets = [];
    for (const [kind, name] of Object.entries(receipt.outputs)) {
      if (!['video', 'sourceVideo', 'poster', 'quality'].includes(kind) || basename(name) !== name) fail('LTX_OUTPUT_REGISTRATION', 'Unexpected qualification output');
      const assetId = randomUUID(), bytes = await readFile(join(jobRoot, name)), path = join(prepared.mediaDir, `${assetId}-${name}`);
      await writeFile(path, bytes, { flag: 'wx' });
      const mime = ['video', 'sourceVideo'].includes(kind) ? 'video/mp4' : kind === 'poster' ? 'image/png' : 'application/json';
      assets.push([assetId, prepared.projectId, JSON.stringify({ name, mime, size: bytes.length, kind, jobId: id, qualification: true, projectRevisionMatch: prepared.revision === db.prepare('SELECT revision FROM projects WHERE id=?').get(prepared.projectId)?.revision }), path, now()]);
      createdAssets[kind] = assetId;
    }
    if (stopping) fail('LTX_STOP_REQUESTED', 'Qualification stopped before registration');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT status FROM jobs WHERE id=?').get(id)?.status !== 'running') fail('LTX_JOB_STATE_CHANGED', 'Qualification state changed before registration');
      for (const asset of assets) db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(...asset);
      db.prepare("UPDATE jobs SET status='review_required',progress=1,stage='LTX qualification requires visual review',output=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify({ ...receipt, assets: createdAssets }), now(), id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { jobId: id, status: 'review_required', sourceJobId: prepared.reference.sourceJobId, outputDirectory: jobRoot, video: join(jobRoot, receipt.outputs.video), assets: createdAssets, outputHash: receipt.provenance.outputHash, qualification: receipt.qualification };
  } catch (error) {
    if (stopping) await stopOwned();
    if (registered) {
      const result = { status: 'blocked', validated: false, code: error.code || 'LTX_QUALIFICATION_FAILED', provenance: { generationStatus: 'blocked' }, qualification: { kind: 'ltx-qualification', sourceJobId: prepared.reference.sourceJobId, experimental: true }, diagnostics: [{ code: error.code || 'LTX_QUALIFICATION_FAILED', message: error.message }] };
      await writeFile(join(jobRoot, 'result.json'), JSON.stringify(result, null, 2));
      db.prepare("UPDATE jobs SET status='blocked',stage='LTX qualification stopped',output=?,error=?,updated_at=? WHERE id=?").run(JSON.stringify(result), error.message, now(), id);
      error.jobId = id;
    }
    throw error;
  } finally {
    clearInterval(monitor); process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
    if (stopPromise) await stopPromise;
    if (release) await release();
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { emit(await runLtxBenchmark(parseBenchmarkArgs(process.argv.slice(2)))); }
  catch (error) { emit({ status: 'blocked', code: error.code || 'LTX_QUALIFICATION_FAILED', message: error.message, jobId: error.jobId || null }); process.exitCode = 1; }
}
