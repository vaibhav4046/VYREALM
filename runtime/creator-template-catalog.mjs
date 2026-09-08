import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FORMATS, validateFormat } from './format-library.mjs';
import { creatorCaptionOptions } from './creator-brief.mjs';

const entries = [
  { id: 'cinematic-mood', label: 'Cinematic mood', family: 'cinematic', recipeId: 'establishing-mood', limitation: 'Requires inspected source shots; camera motion and continuity are not guaranteed by the recipe.' },
  { id: 'anime-character', label: 'Anime character introduction', family: 'anime', recipeId: 'anime-character-intro', limitation: 'Needs representative anime sources or qualified local generation. No anime preview is implied by a title card.' },
  { id: 'anime-story', label: 'Anime short film', family: 'anime', recipeId: 'anime-short-film', limitation: 'Multiple reviewed character/action shots required. Identity continuity must be inspected.' },
  { id: 'music-visuals', label: 'Music visuals', family: 'music', recipeId: 'music-video-loop', limitation: 'Uses supplied music and visuals. No automatic beat detection, singing or neural song generation.' },
  { id: 'short-explainer', label: 'Short explainer', family: 'shorts', recipeId: 'cold-open-question', limitation: 'Requires a reviewed script and matching media; no automatic highlight selection or reach prediction.' },
  { id: 'longform-chapter', label: 'Long-form chapter', family: 'longform', recipeId: 'documentary-chapter', limitation: 'Plans a chapter, not an automatically generated full-length documentary. Evidence and sufficient footage are required.' }
];
const qualifiedPreviews = new WeakSet();
const hashFile = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Only a server-owned, hash-bound review plus actual playable media can qualify a preview. */
export async function verifyCreatorTemplatePreview({ templateId, filePath, assetId, expectedHash, review, provenance, ffprobe } = {}) {
  if (!entries.some(entry => entry.id === templateId)) fail('CREATOR_PREVIEW_TEMPLATE', 'Unknown template.');
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(assetId || '') || !/^[a-f0-9]{64}$/.test(expectedHash || '')) fail('CREATOR_PREVIEW_BINDING', 'A registered asset and SHA-256 are required.');
  if (review?.verdict !== 'passed' || review?.outputHash !== expectedHash || review?.templateId !== templateId || typeof review?.notes !== 'string' || !review.notes.trim()) fail('CREATOR_PREVIEW_REVIEW', 'A representative-output review for this exact template and hash is required.');
  if (!['edited', 'generated', 'upscaled'].includes(provenance?.generationStatus) || provenance?.outputHash !== expectedHash || /placeholder|proxy|title.card|testsrc|synthetic.fixture/i.test(provenance?.sourceMethod || '') || !provenance?.sourceMethod) fail('CREATOR_PREVIEW_PROVENANCE', 'Placeholder and unverified media cannot represent a template.');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || /^[/\\]{2}/.test(filePath) || typeof ffprobe !== 'string' || !path.isAbsolute(ffprobe)) fail('CREATOR_PREVIEW_PATH', 'Local server-owned media and FFprobe paths are required.');
  const info = await fs.stat(filePath); if (!info.isFile() || info.size <= 0 || info.size > 250 * 1024 * 1024) fail('CREATOR_PREVIEW_SIZE', 'Use a short representative preview below 250 MB.');
  if (await hashFile(filePath) !== expectedHash) fail('CREATOR_PREVIEW_CHANGED', 'Preview bytes changed after review.');
  const probe = JSON.parse((await promisify(execFile)(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })).stdout);
  const stream = probe.streams?.find(item => item.codec_type === 'video'), durationSeconds = Number(probe.format?.duration || stream?.duration);
  if (!stream?.width || !stream?.height || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 600) fail('CREATOR_PREVIEW_MEDIA', 'A playable 1–600 second video or animated image is required.');
  if (await hashFile(filePath) !== expectedHash) fail('CREATOR_PREVIEW_CHANGED', 'Preview changed during inspection.');
  const receipt = { templateId, status: 'available', assetId, url: `/media/${encodeURIComponent(assetId)}`, sha256: expectedHash, width: stream.width, height: stream.height, durationSeconds, mediaType: stream.codec_name === 'gif' ? 'image/gif' : 'video', review: { verdict: 'passed', notes: review.notes, outputHash: expectedHash }, provenance: { generationStatus: provenance.generationStatus, sourceMethod: provenance.sourceMethod }, inspection: 'bytes-hash-and-ffprobe; representative content supplied by reviewed receipt' };
  Object.freeze(receipt.review); Object.freeze(receipt.provenance); Object.freeze(receipt);
  qualifiedPreviews.add(receipt); return receipt;
}

/** UI data only. Recipes are never presented as generated footage. */
export function creatorTemplateCatalog({ verifiedPreviews = [] } = {}) {
  if (!Array.isArray(verifiedPreviews)) fail('CREATOR_PREVIEW_INPUT', 'Preview receipts must be an array.');
  return { schemaVersion: 1, kind: 'creator-template-catalog', modelInvoked: false, captionOptions: { timeline: creatorCaptionOptions('timeline'), format: creatorCaptionOptions('format') }, templates: entries.map(entry => {
    const recipe = validateFormat(entry.recipeId, FORMATS[entry.recipeId]);
    const preview = verifiedPreviews.find(item => qualifiedPreviews.has(item) && item.templateId === entry.id);
    return { ...entry, status: 'recipe-available', preview: preview || { status: 'unavailable', url: null, reason: 'No verified representative animated preview has been supplied.' }, recipe: { id: entry.recipeId, durationSeconds: recipe.seconds, platforms: [...recipe.platforms], captionStyle: recipe.captions, audioBed: recipe.audio, beatCount: recipe.beats.length, needsGeneratedShots: recipe.beats.some(beat => beat.route === 'neural'), requiredShotRoles: [...new Set(recipe.beats.map(beat => beat.shot).filter(role => role !== 'black'))] }, renderStatus: 'source-selection-and-preflight-required', mediaGenerated: false };
  }) };
}
