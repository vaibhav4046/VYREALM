import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function ownedPath(jobRoot, path) {
  if (typeof path !== 'string' || !path) throw fail('DELIVERY_PATH_REQUIRED');
  const absolute = await realpath(isAbsolute(path) ? path : resolve(jobRoot, path));
  const rel = relative(jobRoot, absolute);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw fail('DELIVERY_OUTPUT_OUTSIDE_JOB');
  return { absolute, relative: rel.replaceAll('\\', '/') };
}

/** Return native provider evidence, never substitute an encoded delivery hash. */
export function generatedSourceProvenance(provenance) {
  if (!provenance || (provenance.generationStatus ?? provenance.status) !== 'generated') throw fail('VERIFIED_NEURAL_SOURCE_REQUIRED');
  const source = provenance.source || provenance;
  if (!source || (source.generationStatus ?? source.status) !== 'generated' || !validHash(source.outputHash) || !validHash(source.evidenceHash) || !source.providerId || !source.modelId || !source.providerPromptId) throw fail('VERIFIED_NEURAL_SOURCE_REQUIRED');
  if (provenance.sourceHash !== undefined && provenance.sourceHash !== source.outputHash) throw fail('SOURCE_PROVENANCE_HASH_MISMATCH');
  if (provenance.sourceOutputPath !== undefined && String(provenance.sourceOutputPath).replaceAll('\\', '/') !== String(source.outputPath).replaceAll('\\', '/')) throw fail('SOURCE_PROVENANCE_PATH_MISMATCH');
  if (provenance.semanticQuality?.startsWith('rejected') || source.semanticQuality?.startsWith('rejected')) throw fail('VERIFIED_NEURAL_SOURCE_REQUIRED');
  return source;
}

async function checkDelivery({ sourcePath, deliveryPath, provenance, resolution, ffmpeg, ffprobe }) {
  if (!resolution || !Number.isInteger(resolution.width) || !Number.isInteger(resolution.height) || resolution.width < 1 || resolution.height < 1 || resolution.width * resolution.height > 3840 * 2160) throw fail('DELIVERY_RESOLUTION_INVALID');
  const frames = Number(provenance.frameCount), fps = Number(provenance.fps), duration = Number(provenance.durationSeconds);
  if (!Number.isSafeInteger(frames) || frames < 2 || !Number.isFinite(fps) || fps < 1 || fps > 60 || !Number.isFinite(duration) || duration <= 0 || duration > 90 || Math.round(duration * fps) !== frames) throw fail('DELIVERY_SOURCE_TIMING_INVALID');
  const options = { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 };
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', deliveryPath], options);
  const probe = JSON.parse(stdout), video = probe.streams?.find(stream => stream.codec_type === 'video');
  const [n, d] = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
  if (!video || video.width !== resolution.width || video.height !== resolution.height || Number(video.nb_read_frames) !== frames || !Number.isFinite(n / d) || Math.abs(n / d - fps) > 0.01 || Math.abs(Number(video.duration || probe.format?.duration) - duration) > 0.1) throw fail('DELIVERY_MEDIA_MISMATCH');
  await exec(ffmpeg, ['-v', 'error', '-xerror', '-i', deliveryPath, '-f', 'null', '-'], options);
  const lineage = [];
  for (const index of [...new Set([0, Math.floor(frames / 2), frames - 1])]) {
    // Compare a decoded delivery sample against the declared Lanczos resize of
    // the exact hash-verified native clip. This prevents an unrelated in-job
    // file from being promoted merely because it has the requested dimensions.
    const select = `select=eq(n\\,${index})`;
    const decode = async (input, filter) => (await exec(ffmpeg, ['-v', 'error', '-i', input, '-vf', filter, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { ...options, encoding: 'buffer' })).stdout;
    const expected = await decode(sourcePath, `${select},scale=${resolution.width}:${resolution.height}:flags=lanczos,scale=256:144:flags=area`);
    const delivered = await decode(deliveryPath, `${select},scale=256:144:flags=area`);
    if (!expected.length || expected.length !== delivered.length) throw fail('DELIVERY_LINEAGE_MISMATCH');
    let error = 0;
    for (let i = 0; i < expected.length; i++) error += (expected[i] - delivered[i]) ** 2;
    const rmse = Math.sqrt(error / expected.length);
    if (rmse > 8) throw fail('DELIVERY_LINEAGE_MISMATCH', `Delivery frame ${index} differs from its source resize (RGB RMSE ${rmse.toFixed(2)})`);
    lineage.push({ index, rgbRmse: Number(rmse.toFixed(4)), threshold: 8, comparisonResolution: { width: 256, height: 144 } });
  }
  return { method: 'lanczos-source-comparison-v1', resolution, fps, frameCount: frames, durationSeconds: duration, fullyDecoded: true, lineage };
}

/** Bind a rendered delivery to already verified provider source evidence.
 * The generated label describes source origin; deliveryMethod describes the
 * post-processing. It is never evidence that the model generated native 1080p.
 */
export async function bindGeneratedDelivery({ jobRoot, provenance, sourcePath, deliveryPath, deliveryResolution = { width: 1920, height: 1080 }, deliveryMethod, expectedDeliveryHash, ffmpeg = process.env.VYRELUM_FFMPEG || join(root, 'workers/tools/ffmpeg.exe'), ffprobe = process.env.VYRELUM_FFPROBE || join(root, 'workers/tools/ffprobe.exe') }) {
  const base = await realpath(resolve(jobRoot)), native = generatedSourceProvenance(provenance);
  const source = await ownedPath(base, sourcePath || native.outputPath), declaredSource = await ownedPath(base, native.outputPath), delivery = await ownedPath(base, deliveryPath);
  if (source.absolute !== declaredSource.absolute) throw fail('SOURCE_PROVENANCE_PATH_MISMATCH');
  if (source.absolute === delivery.absolute) throw fail('DELIVERY_MUST_BE_SEPARATE_FROM_SOURCE');
  const sourceHash = hash(await readFile(source.absolute));
  if (sourceHash !== native.outputHash) throw fail('SOURCE_PROVENANCE_HASH_MISMATCH');
  const outputHash = hash(await readFile(delivery.absolute));
  if (expectedDeliveryHash !== undefined && (!validHash(expectedDeliveryHash) || expectedDeliveryHash !== outputHash)) throw fail('DELIVERY_PROVENANCE_HASH_MISMATCH');
  const expectedMethod = `1080p-lanczos-from-${native.resolution?.width}x${native.resolution?.height}`;
  if (deliveryMethod !== expectedMethod || !deliveryResolution || deliveryResolution.width !== 1920 || deliveryResolution.height !== 1080) throw fail('DELIVERY_METHOD_UNSUPPORTED');
  const deliveryVerification = await checkDelivery({ sourcePath: source.absolute, deliveryPath: delivery.absolute, provenance: native, resolution: deliveryResolution, ffmpeg, ffprobe });
  // The audit was performed on these bytes, so detect a concurrent change
  // before attaching the resulting hashes to a receipt.
  if (hash(await readFile(source.absolute)) !== sourceHash) throw fail('SOURCE_PROVENANCE_HASH_MISMATCH');
  if (hash(await readFile(delivery.absolute)) !== outputHash) throw fail('DELIVERY_PROVENANCE_HASH_MISMATCH');
  const { source: ignoredSource, sourceHash: ignoredHash, sourceOutputPath: ignoredPath, deliveryMethod: ignoredMethod, deliveryResolution: ignoredResolution, deliveryVerification: ignoredVerification, deliveryEvidenceHash: ignoredEvidence, ...sourceRecord } = native;
  const providerSource = { ...sourceRecord, generationStatus: 'generated', outputPath: source.relative, outputHash: sourceHash };
  const deliveryEvidenceHash = hash(Buffer.from(JSON.stringify({ sourceEvidenceHash: native.evidenceHash, sourceHash, outputHash, deliveryMethod, deliveryVerification })));
  return {
    ...provenance, generationStatus: 'generated', sourceGenerationStatus: 'generated',
    source: providerSource, sourceHash, sourceOutputPath: source.relative,
    outputHash, outputPath: delivery.relative, resolution: native.resolution,
    deliveryResolution, deliveryMethod, evidenceScope: 'source', deliveryEvidenceHash, deliveryVerification,
  };
}

/** Pure receipt migration: verifies files and returns an updated object. The
 * caller chooses when to atomically persist it after safe job completion.
 */
export async function normalizeLegacyDelivery({ jobRoot, receipt, ffmpeg, ffprobe }) {
  if (!receipt?.outputs?.sourceVideo || !receipt?.outputs?.video || !receipt.provenance) throw fail('DELIVERY_RECEIPT_REQUIRED');
  const provenance = await bindGeneratedDelivery({
    jobRoot, provenance: receipt.provenance, sourcePath: receipt.outputs.sourceVideo, deliveryPath: receipt.outputs.video,
    deliveryResolution: receipt.provenance.deliveryResolution,
    deliveryMethod: receipt.provenance.deliveryMethod,
    ...(receipt.provenance.source ? { expectedDeliveryHash: receipt.provenance.outputHash } : {}),
    ffmpeg, ffprobe,
  });
  return { ...receipt, provenance };
}
