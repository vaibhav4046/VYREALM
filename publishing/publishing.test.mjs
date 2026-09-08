import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReleaseStore, ReleaseValidationError, validateRelease } from './index.js';

const clock = () => new Date('2030-01-01T00:00:00.000Z');
const base = { state: 'draft',
  id: 'rel-1', project: { id: 'p1', revision: 'r1' }, output: { path: 'final.mp4', sha256: 'a'.repeat(64) },
  metadata: { channelId: 'ch1', title: 'Demo', privacyStatus: 'private', publishAt: '2030-01-02T00:00:00.000Z' },
  channel: { id: 'ch1', title: 'Channel', apiProject: { verified: true } },
  captions: [], thumbnail: null, aiDisclosure: { containsSyntheticMedia: false }, rightsLedger: []
};
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publishing-'));
const store = new ReleaseStore({ filePath: path.join(dir, 'releases.json'), clock, idFactory: () => 'rel-generated' });
let release = await store.create(base);
for (const state of ['rendered', 'reviewed', 'approved']) release = await store.transition(release.id, state);
release = await store.beginUpload(release.id, 'session://one');
assert.equal(release.state, 'uploading');
await assert.rejects(() => store.beginUpload(release.id, 'session://one'), e => e.code === 'DUPLICATE_RESUMABLE_SESSION');
const reloaded = new ReleaseStore({ filePath: path.join(dir, 'releases.json'), clock });
assert.equal((await reloaded.get('rel-1')).state, 'uploading');
assert.throws(() => validateRelease({ ...base, metadata: { ...base.metadata, publishAt: '2029-01-01T00:00:00.000Z' } }, { now: clock() }), e => e.code === 'STALE_PUBLISH_AT');
assert.throws(() => validateRelease({ ...base, metadata: { ...base.metadata, channelId: 'other' } }), e => e.code === 'WRONG_CHANNEL');
assert.throws(() => validateRelease({ ...base, channel: { ...base.channel, apiProject: { verified: false } } }, { targetState: 'published', now: clock() }), e => e.code === 'UNVERIFIED_API_PROJECT');
console.log('publishing deterministic tests passed');
