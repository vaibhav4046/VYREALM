import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { auditPublicSource } from './audit-public-source.mjs';
async function fixture(t,extra={}) {
  const root=await mkdtemp(join(tmpdir(),'vyrealm-publish-audit-'));
  t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true});});
  const files={'LICENSE':'MIT License\nCopyright (c) 2026 VYREALM contributors\n','app.js':'console.log(1);\n',...extra};
  for(const [name,text] of Object.entries(files))await writeFile(join(root,name),text);
  await writeFile(join(root,'source-manifest.json'),JSON.stringify({files:Object.entries(files).map(([file,text])=>({file,sha256:createHash('sha256').update(text).digest('hex')}))}));
  return root;
}
test('accepts a matching lean source manifest and MIT notice',async t=>{
  assert.equal((await auditPublicSource(await fixture(t))).ok,true);
});
test('rejects changed or unlisted private files without printing their content',async t=>{
  const root=await fixture(t);await writeFile(join(root,'app.js'),'changed');await writeFile(join(root,'private.sqlite'),'PRIVATE_TEST_CONTENT');
  const result=await auditPublicSource(root);assert.equal(result.ok,false);assert.ok(result.findings.some(x=>x.rule==='HASH_MISMATCH'));assert.ok(result.findings.some(x=>x.rule==='DISALLOWED_FILE'));assert.equal(JSON.stringify(result).includes('PRIVATE_TEST_CONTENT'),false);
});
test('redacts detected credentials even when a manifest lists them',async t=>{
  const secret='ghp_'+'A'.repeat(36),root=await fixture(t,{'config.js':`const token='${secret}';`});
  const result=await auditPublicSource(root);assert.ok(result.findings.some(x=>x.rule==='GITHUB_TOKEN'));assert.equal(JSON.stringify(result).includes(secret),false);
});
test('rejects path traversal and an absent application license',async t=>{
  const root=await fixture(t);await writeFile(join(root,'source-manifest.json'),JSON.stringify({files:[{file:'../private.js',sha256:'a'.repeat(64)}]}));await rm(join(root,'LICENSE'));
  const result=await auditPublicSource(root);assert.equal(result.ok,false);assert.ok(result.findings.some(x=>x.rule==='INVALID_MANIFEST_PATH'));assert.ok(result.findings.some(x=>x.rule==='APPLICATION_LICENSE_MISSING'));
});
