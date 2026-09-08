import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { creatorTemplateCatalog, verifyCreatorTemplatePreview } from './creator-template-catalog.mjs';
import { FORMATS } from './format-library.mjs';

test('catalog reuses real recipes and never invents preview URLs or readiness', () => {
 const catalog = creatorTemplateCatalog(); assert.equal(catalog.templates.length, 6);
 for (const item of catalog.templates) { assert.ok(FORMATS[item.recipe.id]); assert.equal(item.preview.status, 'unavailable'); assert.equal(item.preview.url, null); assert.equal(item.mediaGenerated, false); }
 const forged = creatorTemplateCatalog({ verifiedPreviews: [{ templateId: 'cinematic-mood', status: 'available', inspection: 'bytes-hash-and-ffprobe; representative content supplied by reviewed receipt', url: 'https://fake.example/preview.mp4' }] });
 assert.equal(forged.templates[0].preview.status, 'unavailable');
});
test('preview qualification checks actual playable bytes, review binding and placeholder provenance', async t => {
 const root = fileURLToPath(new URL('..', import.meta.url)), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vyrealm-preview-proof-'));
 t.after(async () => { if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('vyrealm-preview-proof-')) await fs.rm(dir, { recursive: true, force: true }); });
 const filePath = path.join(dir, 'fixture.mp4');
 await promisify(execFile)(path.join(root, 'workers/tools/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=12:d=1', '-c:v', 'libx264', '-threads', '1', filePath], { windowsHide: true });
 const expectedHash = createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
 const request = { templateId: 'cinematic-mood', filePath, assetId: 'fixture-only', expectedHash, ffprobe: path.join(root, 'workers/tools/ffprobe.exe'), review: { verdict: 'passed', templateId: 'cinematic-mood', outputHash: expectedHash, notes: 'Test-only trusted-review fixture, never a public preview.' }, provenance: { generationStatus: 'edited', sourceMethod: 'local-timeline-edit', outputHash: expectedHash } };
 await assert.rejects(verifyCreatorTemplatePreview({ ...request, review: { ...request.review, outputHash: '0'.repeat(64) } }), { code: 'CREATOR_PREVIEW_REVIEW' });
 await assert.rejects(verifyCreatorTemplatePreview({ ...request, provenance: { ...request.provenance, sourceMethod: 'placeholder-title-card' } }), { code: 'CREATOR_PREVIEW_PROVENANCE' });
 const verified = await verifyCreatorTemplatePreview(request), catalog = creatorTemplateCatalog({ verifiedPreviews: [verified] });
 assert.equal(catalog.templates[0].preview.status, 'available'); assert.equal(verified.width, 320); assert.equal(verified.durationSeconds, 1);
 assert.throws(()=>{verified.templateId='anime-character';},TypeError);
 await fs.appendFile(filePath, 'modified'); await assert.rejects(verifyCreatorTemplatePreview(request), { code: 'CREATOR_PREVIEW_CHANGED' });
});
