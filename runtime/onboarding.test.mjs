import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { replaceWithVerified, storageUsage } from './onboarding.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vyrelum-onboarding-'));
const source = path.join(dir, 'source.bin'), destination = path.join(dir, 'runtime.bin');
await fs.writeFile(source, Buffer.from('verified runtime artifact'));
const digest = createHash('sha256').update(await fs.readFile(source)).digest('hex');
const result = await replaceWithVerified(source, destination, digest);
assert.equal(result.sha256, digest); assert.equal(await fs.readFile(destination, 'utf8'), 'verified runtime artifact');
await assert.rejects(() => replaceWithVerified(source, path.join(dir, 'bad.bin'), '0'.repeat(64)), error => error.code === 'INTEGRITY_MISMATCH');
assert.equal(await storageUsage(dir) > 0, true);
console.log('onboarding integrity/storage tests passed');
