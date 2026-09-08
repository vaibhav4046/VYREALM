import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { auditPublicSource } from './audit-public-source.mjs';
async function fixture(t,extra={}) {
  const root=await mkdtemp(join(tmpdir(),'vyrealm-publish-audit-'));
  t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true});});
  const files={'LICENSE':'MIT License\nCopyright (c) 2026 VYREALM contributors\n','app.js':'console.log(1);\n',...extra};
  for(const [name,text] of Object.entries(files)){await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),text);}
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

const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64');
test('allows the exact reviewed desktop icon while unrelated PNGs stay blocked',async t=>{
 const root=await fixture(t,{'desktop/resources/icon.png':tinyPng});
 assert.equal((await auditPublicSource(root)).ok,true);
 for(const name of ['preview.png','desktop/resources/icon-copy.png','desktop/resources/nested/icon.png','other/icon.png']){
  await t.test(name,async t=>{const directory=await fixture(t,{'desktop/resources/icon.png':tinyPng,[name]:tinyPng}),result=await auditPublicSource(directory);assert.equal(result.ok,false);assert.deepEqual(result.findings,[{file:name,rule:'DISALLOWED_FILE'}]);});
 }
});
test('a differently cased icon filename does not widen the reviewed-path exception',async t=>{
 const result=await auditPublicSource(await fixture(t,{'desktop/resources/ICON.PNG':tinyPng}));assert.equal(result.ok,false);assert.deepEqual(result.findings,[{file:'desktop/resources/ICON.PNG',rule:'DISALLOWED_FILE'}]);
});
test('the reviewed icon still requires a matching manifest entry and hash',async t=>{
 const root=await fixture(t,{'desktop/resources/icon.png':tinyPng});await writeFile(join(root,'desktop/resources/icon.png'),Buffer.concat([tinyPng,Buffer.from('changed')]));const altered=await auditPublicSource(root);assert.ok(altered.findings.some(f=>f.file==='desktop/resources/icon.png'&&f.rule==='HASH_MISMATCH'));
 const unlisted=await fixture(t);await mkdir(join(unlisted,'desktop/resources'),{recursive:true});await writeFile(join(unlisted,'desktop/resources/icon.png'),tinyPng);const result=await auditPublicSource(unlisted);assert.equal(result.ok,false);assert.ok(result.findings.some(f=>f.file==='desktop/resources/icon.png'&&f.rule==='UNLISTED_FILE'));
});
test('the icon exception does not bypass source-size or credential checks',async t=>{
 const large=await auditPublicSource(await fixture(t,{'desktop/resources/icon.png':Buffer.alloc(2*1024*1024+1)}));assert.ok(large.findings.some(f=>f.file==='desktop/resources/icon.png'&&f.rule==='OVERSIZED_SOURCE'));
 const synthetic='ghp_'+'B'.repeat(36),root=await fixture(t,{'desktop/resources/icon.png':Buffer.concat([tinyPng,Buffer.from('\n'+synthetic)])}),result=await auditPublicSource(root);assert.equal(result.ok,false);assert.ok(result.findings.some(f=>f.file==='desktop/resources/icon.png'&&f.rule==='GITHUB_TOKEN'));assert.equal(JSON.stringify(result).includes(synthetic),false);
});
