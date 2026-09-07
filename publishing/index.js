import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RELEASE_STATES = Object.freeze([
  'draft', 'rendered', 'reviewed', 'approved', 'uploading', 'uploaded_private',
  'processing', 'scheduled', 'published', 'blocked'
]);

const TRANSITIONS = Object.freeze({
  draft: ['rendered', 'blocked'], rendered: ['reviewed', 'blocked'],
  reviewed: ['approved', 'blocked'], approved: ['uploading', 'blocked'],
  uploading: ['uploaded_private', 'blocked'], uploaded_private: ['processing', 'blocked'],
  processing: ['scheduled', 'published', 'blocked'], scheduled: ['published', 'blocked'],
  published: [], blocked: ['draft']
});

export class ReleaseValidationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ReleaseValidationError'; this.code = code; this.details = details; }
}

const id = () => crypto.randomUUID();
const sha256File = async file => {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
};

/**
 * Local, deterministic release package store. It deliberately has no network/upload implementation.
 * `clock` and `idFactory` are injectable to make tests reproducible.
 */
export class ReleaseStore {
  constructor({ filePath = path.resolve('data/releases.json'), clock = () => new Date(), idFactory = id } = {}) {
    this.filePath = filePath; this.clock = clock; this.idFactory = idFactory; this._data = null;
  }
  async _load() {
    if (this._data) return this._data;
    try { this._data = JSON.parse(await fs.readFile(this.filePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this._data = { schemaVersion: 1, releases: [] }; }
    if (!Array.isArray(this._data.releases)) this._data.releases = [];
    return this._data;
  }
  async _save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this._data, null, 2) + '\n', 'utf8');
    await fs.rename(temp, this.filePath);
  }
  async list() { return [...(await this._load()).releases]; }
  async get(releaseId) { return (await this._load()).releases.find(r => r.id === releaseId) ?? null; }

  async create(input = {}) {
    const release = normalizeRelease(input, this.idFactory, this.clock);
    validateRelease(release, { now: this.clock() });
    const data = await this._load();
    if (data.releases.some(r => r.id === release.id)) throw new ReleaseValidationError('DUPLICATE_RELEASE_ID', `Release ${release.id} already exists`);
    data.releases.push(release); await this._save(); return release;
  }

  async update(releaseId, patch) {
    const data = await this._load(); const index = data.releases.findIndex(r => r.id === releaseId);
    if (index < 0) throw new ReleaseValidationError('RELEASE_NOT_FOUND', `Release ${releaseId} not found`);
    if (patch.state && patch.state !== data.releases[index].state) throw new ReleaseValidationError('INVALID_TRANSITION', 'Use transition() to change release state');
    const current = data.releases[index];
    const nested = ['project', 'output', 'metadata', 'aiDisclosure', 'channel', 'upload'];
    const mergedPatch = { ...patch };
    for (const key of nested) if (patch[key] && current[key] && typeof patch[key] === 'object' && typeof current[key] === 'object') mergedPatch[key] = { ...current[key], ...patch[key] };
    const next = { ...current, ...mergedPatch, id: releaseId, updatedAt: this.clock().toISOString() };
    validateRelease(next, { now: this.clock() }); data.releases[index] = next; await this._save(); return next;
  }

  async transition(releaseId, target, { reason, actor = 'local' } = {}) {
    const data = await this._load(); const release = data.releases.find(r => r.id === releaseId);
    if (!release) throw new ReleaseValidationError('RELEASE_NOT_FOUND', `Release ${releaseId} not found`);
    if (!RELEASE_STATES.includes(target)) throw new ReleaseValidationError('INVALID_STATE', `Unknown release state: ${target}`);
    if (!(TRANSITIONS[release.state] ?? []).includes(target)) throw new ReleaseValidationError('INVALID_TRANSITION', `${release.state} cannot transition to ${target}`);
    validateRelease(release, { now: this.clock(), targetState: target });
    release.state = target; release.updatedAt = this.clock().toISOString();
    release.history.push({ from: release.history.at(-1)?.to ?? 'draft', to: target, at: release.updatedAt, actor, ...(reason ? { reason } : {}) });
    await this._save(); return release;
  }

  /** Persist server-side upload identifiers/progress supplied by an external adapter. */
  async recordUpload(releaseId, patch = {}) {
    const release = await this.get(releaseId);
    if (!release) throw new ReleaseValidationError('RELEASE_NOT_FOUND', 'Release ' + releaseId + ' not found');
    if (!release.upload) throw new ReleaseValidationError('MISSING_SESSION_URI', 'No resumable upload session is registered');
    return this.update(releaseId, { upload: { ...release.upload, ...patch } });
  }

  /** Register a resumable upload session after an external adapter has created it. */
  async beginUpload(releaseId, sessionUri) {
    if (!sessionUri || typeof sessionUri !== 'string') throw new ReleaseValidationError('MISSING_SESSION_URI', 'A resumable session URI is required');
    const data = await this._load();
    const existing = data.releases.find(r => r.upload?.sessionUri === sessionUri);
    if (existing) throw new ReleaseValidationError('DUPLICATE_RESUMABLE_SESSION', `Session already belongs to release ${existing.id}`, { releaseId: existing.id });
    const release = data.releases.find(r => r.id === releaseId);
    if (!release) throw new ReleaseValidationError('RELEASE_NOT_FOUND', `Release ${releaseId} not found`);
    if (release.state !== 'approved') throw new ReleaseValidationError('INVALID_TRANSITION', 'Only approved releases can begin uploading');
    validateRelease(release, { now: this.clock(), targetState: 'uploading' });
    release.upload = { sessionUri, bytesUploaded: 0, startedAt: this.clock().toISOString() };
    release.state = 'uploading'; release.updatedAt = this.clock().toISOString();
    release.history.push({ from: 'approved', to: 'uploading', at: release.updatedAt, actor: 'local' });
    await this._save(); return release;
  }
}

export function validateRelease(release, { now = new Date(), targetState: requestedState } = {}) {
  if (!release || typeof release !== 'object') throw new ReleaseValidationError('INVALID_PACKAGE', 'Release package must be an object');
  const targetState = requestedState ?? release.state;
  if (!RELEASE_STATES.includes(targetState)) throw new ReleaseValidationError('INVALID_STATE', 'Unknown release state: ' + targetState);
  if (!release.project?.id || !release.project?.revision) throw new ReleaseValidationError('MISSING_PROJECT', 'project.id and project.revision are required');
  if (!release.output?.path || !release.output?.sha256) throw new ReleaseValidationError('MISSING_OUTPUT', 'output.path and output.sha256 are required');
  if (typeof release.metadata?.title !== 'string' || !release.metadata.title.trim()) throw new ReleaseValidationError('MISSING_TITLE', 'metadata.title is required');
  if (!release.metadata?.channelId) throw new ReleaseValidationError('MISSING_CHANNEL', 'metadata.channelId is required');
  if (!release.channel?.id) throw new ReleaseValidationError('MISSING_CHANNEL', 'channel.id is required');
  if (release.metadata.channelId !== release.channel.id) throw new ReleaseValidationError('WRONG_CHANNEL', 'metadata.channelId does not match selected channel', { expected: release.channel.id, actual: release.metadata.channelId });
  if (!RELEASE_STATES.includes(release.state)) throw new ReleaseValidationError('INVALID_STATE', `Unknown release state: ${release.state}`);
  if (targetState === 'scheduled' && (!release.metadata.publishAt || release.metadata.privacyStatus !== 'private')) throw new ReleaseValidationError('SCHEDULE_REQUIRES_PRIVATE', 'scheduled state requires a future publishAt and private privacyStatus');
  if (release.metadata.publishAt != null) {
    const publishAt = Date.parse(release.metadata.publishAt);
    if (!Number.isFinite(publishAt)) throw new ReleaseValidationError('INVALID_PUBLISH_AT', 'metadata.publishAt must be an ISO timestamp');
    if (publishAt <= new Date(now).getTime()) throw new ReleaseValidationError('STALE_PUBLISH_AT', 'publishAt must be in the future; YouTube would publish immediately for a past timestamp');
    if (release.metadata.privacyStatus && release.metadata.privacyStatus !== 'private') throw new ReleaseValidationError('SCHEDULE_REQUIRES_PRIVATE', 'Scheduled releases must use private privacyStatus');
  }
  const apiProject = release.channel.apiProject;
  if ((targetState === 'scheduled' || targetState === 'published') && apiProject && (apiProject.verified === false || apiProject.auditStatus === 'unverified')) {
    throw new ReleaseValidationError('UNVERIFIED_API_PROJECT', 'Unverified API projects are restricted to private viewing until audit approval', { channelId: release.channel.id });
  }
  if (targetState === 'published' && release.metadata.publishAt && Date.parse(release.metadata.publishAt) <= new Date(now).getTime()) throw new ReleaseValidationError('STALE_PUBLISH_AT', 'publishAt is stale');
  if (!release.aiDisclosure || typeof release.aiDisclosure.containsSyntheticMedia !== 'boolean') throw new ReleaseValidationError('MISSING_AI_DISCLOSURE', 'Explicit AI disclosure decision is required');
  if (!Array.isArray(release.rightsLedger)) throw new ReleaseValidationError('MISSING_RIGHTS_LEDGER', 'rightsLedger must be an array');
  if (!Array.isArray(release.captions)) throw new ReleaseValidationError('MISSING_CAPTIONS', 'captions must be an array');
  return true;
}

function normalizeRelease(input, idFactory, clock) {
  const createdAt = clock().toISOString();
  const release = {
    schemaVersion: 1, id: input.id ?? idFactory(), state: input.state ?? 'draft',
    project: input.project ?? {}, output: input.output ?? {}, metadata: input.metadata ?? {},
    captions: input.captions ?? [], thumbnail: input.thumbnail ?? null,
    aiDisclosure: input.aiDisclosure ?? {}, rightsLedger: input.rightsLedger ?? [],
    channel: input.channel ?? {}, upload: input.upload ?? null,
    approvals: input.approvals ?? [], history: input.history ?? [], createdAt, updatedAt: createdAt
  };
  return release;
}

export async function hashOutput(filePath) { return sha256File(filePath); }
export const allowedTransitions = TRANSITIONS;

/** @typedef {{id:string, revision:string}} ProjectRef */
/** @typedef {{path:string, sha256:string, mimeType?:string, durationSeconds?:number}} OutputRef */
/** @typedef {{channelId:string, title:string, description?:string, tags?:string[], privacyStatus?:'private'|'unlisted'|'public', publishAt?:string}} ReleaseMetadata */
/** @typedef {{language:string, path:string, sha256?:string, name?:string}} CaptionTrack */
/** @typedef {{path:string, sha256?:string}} ThumbnailRef */
/** @typedef {{containsSyntheticMedia:boolean, rationale?:string}} AiDisclosure */
/** @typedef {{assetId:string, kind:string, source:string, evidence?:string}} RightsEntry */
/** @typedef {{id:string, title?:string, apiProject?:{verified?:boolean, auditStatus?:string}}} ChannelRef */
/** @typedef {{schemaVersion:number,id:string,state:string,project:ProjectRef,output:OutputRef,metadata:ReleaseMetadata,captions:CaptionTrack[],thumbnail:ThumbnailRef|null,aiDisclosure:AiDisclosure,rightsLedger:RightsEntry[],channel:ChannelRef,upload:object|null,approvals:object[],history:object[],createdAt:string,updatedAt:string}} ReleasePackage */

/** JSON-schema-like contract for adapters and UI forms. */
export const RELEASE_PACKAGE_SCHEMA = Object.freeze({
  type: 'object', required: ['id', 'state', 'project', 'output', 'metadata', 'captions', 'aiDisclosure', 'rightsLedger', 'channel'],
  properties: { state: { enum: RELEASE_STATES }, project: { required: ['id', 'revision'] }, output: { required: ['path', 'sha256'] }, metadata: { required: ['channelId', 'title'] }, aiDisclosure: { required: ['containsSyntheticMedia'] }, rightsLedger: { type: 'array' }, captions: { type: 'array' } }
});

/** Build and validate a package without writing it to disk. */
export function createReleasePackage(input, { clock = () => new Date(), idFactory = id } = {}) {
  const release = normalizeRelease(input, idFactory, clock);
  validateRelease(release, { now: clock() });
  return release;
}








