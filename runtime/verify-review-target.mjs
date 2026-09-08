import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { normalizeLegacyDelivery, generatedSourceProvenance } from './generation-delivery.mjs';
import { fileSha256 } from './verified-download.mjs';
import { verifyMedia } from './media-verifier.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const hashPattern = /^[a-f0-9]{64}$/;
const completed = new Set(['review_required', 'rejected', 'succeeded']);
const fail = (suffix, message) => { throw Object.assign(new Error(`REVIEW_TARGET_${suffix}: ${message}`), { code: `REVIEW_TARGET_${suffix}` }); };
function parse(value) {
  try {
    const result = typeof value === 'string' || Buffer.isBuffer(value) ? JSON.parse(String(value)) : value;
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch { fail('DOCUMENT_INVALID', 'A saved job, asset or result document is invalid'); }
}
async function inside(base, path) {
  if (typeof path !== 'string' || !path) fail('OWNERSHIP', 'The output path is missing');
  const actual = await realpath(resolve(base, path)), rel = relative(base, actual);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) fail('OWNERSHIP', 'An output or receipt resolves outside its configured store');
  if (!(await stat(actual)).isFile()) fail('OWNERSHIP', 'The output or receipt is not a regular file');
  return actual;
}
function snapshot(db, job, output) {
  const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
  if (!row || !completed.has(row.status) || row.status !== job.status || row.project_id !== job.project_id || !isDeepStrictEqual(parse(row.output), output)) fail('CHANGED', 'The job changed; refresh before recording its review');
  const asset = typeof output.assets?.video === 'string' && db.prepare('SELECT * FROM assets WHERE id=?').get(output.assets.video);
  if (!asset || asset.project_id != null && asset.project_id !== row.project_id) fail('OWNERSHIP', 'The playback asset belongs to another project or is unavailable');
  const metadata = parse(asset.document);
  if (metadata.jobId !== row.id || !/^video\//.test(metadata.mime || '')) fail('OWNERSHIP', 'The registered playback asset must belong to this video job');
  return { row, asset };
}

/** Read-only verification of exactly the bytes an operator is about to review.
 * A legacy generated delivery is normalized only after its source and Lanczos
 * lineage pass the existing audit. Callers persist both returned documents
 * together with their review; this function never changes project history.
 */
export async function verifyReviewTarget({ db, jobsDir, mediaDir, job, output, expectedOutputHash, ffmpeg = process.env.VYRELUM_FFMPEG || join(root, 'workers/tools/ffmpeg.exe'), ffprobe = process.env.VYRELUM_FFPROBE || join(root, 'workers/tools/ffprobe.exe') } = {}) {
  if (!db || !job || !/^[a-zA-Z0-9-]+$/.test(job.id || '') || !completed.has(job.status)) fail('INCOMPLETE', 'A completed VYREALM job is required');
  const original = parse(output);
  if (!original.outputs?.video || !hashPattern.test(original.provenance?.outputHash || '') || original.verification?.ok !== true) fail('RECEIPT_INVALID', 'A hashed, technically verified video receipt is required');
  if (expectedOutputHash !== undefined && !hashPattern.test(expectedOutputHash)) fail('EXPECTED_HASH', 'The requested review hash is invalid');
  const initial = snapshot(db, job, original);
  let jobRoot, jobVideoPath, servedVideoPath, receiptPath, receiptText, receipt;
  try {
    const jobsRoot = await realpath(jobsDir), mediaRoot = await realpath(mediaDir);
    jobRoot = await realpath(join(jobsRoot, job.id));
    const rel = relative(jobsRoot, jobRoot);
    if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) fail('OWNERSHIP', 'The job resolves outside the configured job store');
    jobVideoPath = await inside(jobRoot, original.outputs.video);
    servedVideoPath = await inside(mediaRoot, initial.asset.path);
    receiptPath = await inside(jobRoot, 'result.json');
    receiptText = await readFile(receiptPath, 'utf8');
    receipt = parse(receiptText);
  } catch (error) { if (error.code?.startsWith('REVIEW_TARGET_')) throw error; fail('OWNERSHIP', 'The owned job output, receipt and playback copy must all exist'); }
  // Compare before any migration, including provider evidence and native hash.
  // DB-only evidence cannot replace the worker's recorded receipt.
  for (const key of ['outputs', 'provenance', 'verification', 'durationSeconds', 'review']) {
    if (!isDeepStrictEqual(receipt[key], original[key])) fail('RECEIPT_MISMATCH', `The saved worker and database ${key} disagree`);
  }
  let checkedReceipt = structuredClone(receipt), checkedOutput = structuredClone(original);
  if (original.provenance.generationStatus === 'generated') {
    const source = generatedSourceProvenance(original.provenance);
    if (original.outputs.sourceVideo && original.outputs.sourceVideo !== original.outputs.video) {
      checkedReceipt = await normalizeLegacyDelivery({ jobRoot, receipt: checkedReceipt, ffmpeg, ffprobe });
      checkedOutput.provenance = checkedReceipt.provenance;
    } else if (await inside(jobRoot, source.outputPath) !== jobVideoPath || source.outputHash !== original.provenance.outputHash) fail('RECEIPT_MISMATCH', 'Native generated output must identify the exact provider-owned file');
  }
  const hash = checkedOutput.provenance.outputHash;
  if (expectedOutputHash !== undefined && hash !== expectedOutputHash) fail('EXPECTED_HASH', 'The reviewed delivery no longer matches the expected output hash');
  const [jobHash, servedHash] = await Promise.all([fileSha256(jobVideoPath), fileSha256(servedVideoPath)]);
  if (jobHash !== hash || servedHash !== hash) fail('HASH_MISMATCH', 'The in-job output and registered playback copy must match the receipt hash');
  const p = checkedOutput.provenance, canvas = p.deliveryResolution || p.resolution || {};
  const verified = await verifyMedia({ videoPath: jobVideoPath, ffmpeg, ffprobe, expected: { width: canvas.width, height: canvas.height, fps: p.targetFps || p.fps, durationSeconds: checkedOutput.durationSeconds || p.durationSeconds } });
  if (!verified.ok) fail('MEDIA_INVALID', verified.diagnostics.map(item => item.message).join('; '));
  try {
    await exec(ffmpeg, ['-v', 'error', '-xerror', '-threads', '2', '-i', jobVideoPath, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], { windowsHide: true, timeout: 300_000, maxBuffer: 1_000_000 });
  } catch { fail('DECODE_FAILED', 'The complete output could not be decoded by FFmpeg'); }
  // Decode is asynchronous. Check both file bytes, symlink destinations,
  // receipt and database ownership again before allowing the caller to write.
  const current = snapshot(db, job, original);
  if (!isDeepStrictEqual(current.asset, initial.asset) || await inside(jobRoot, original.outputs.video) !== jobVideoPath || await inside(await realpath(mediaDir), current.asset.path) !== servedVideoPath || await inside(jobRoot, 'result.json') !== receiptPath || await readFile(receiptPath, 'utf8') !== receiptText) fail('CHANGED', 'Review target or receipt changed during verification');
  const [finalJobHash, finalServedHash] = await Promise.all([fileSha256(jobVideoPath), fileSha256(servedVideoPath)]);
  if (finalJobHash !== hash || finalServedHash !== hash) fail('CHANGED', 'Output bytes changed during verification');
  return { output: checkedOutput, receipt: checkedReceipt, jobVideoPath, servedVideoPath, hash };
}
