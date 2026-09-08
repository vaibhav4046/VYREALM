import { readdir, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { join, extname, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Copies an explicit source allowlist into a NEW directory. It neither commits
// nor uploads anything; the publication owner must audit secrets and licences.
const root=fileURLToPath(new URL('..',import.meta.url));
const destination=join(root,'work',`public-source-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);
const names=new Set(['.gitignore','.env.example','README.md','package.json','package-lock.json','electron-builder.yml','playwright.config.mjs','index.html','styles.css','asset-library.css', 'creator-templates.css', 'local-automations.css', 'desktop/resources/icon.svg', 'desktop/resources/icon.ico', 'desktop/resources/icon.png','app.js','studio-chat.js','youtube-settings.js','server.js','engine.js','engine.test.mjs','cli.mjs','mcp-server.mjs','capabilities/manifest.json','runtime/manifest.json','workers/default-scene.json','docs/EMBERFORGE_TROUBLESHOOTING.md','docs/VYREALM_ARCHITECTURE.md','docs/HACKATHON_VERIFICATION.md','docs/PUBLICATION_CHECKLIST.md']);
const extensions=new Set(['.js','.mjs','.cjs','.ts','.py','.ps1','.css','.html']);
const excluded=new Set(['node_modules','tools','node','assets','models','__pycache__','.venv','venv']);
async function scan(directory) {
  for(const entry of await readdir(join(root,directory),{withFileTypes:true})) {
    const name=`${directory}/${entry.name}`;
    if(entry.isDirectory()) { if(!excluded.has(entry.name)) await scan(name); }
    else if(extensions.has(extname(entry.name)) || directory==='runtime'&&/\.lock\.(json|txt)$/.test(entry.name) || directory==='runtime/notices'&&entry.name.endsWith('.txt')) names.add(name);
  }
}
for(const directory of ['desktop','runtime','workers','publishing','capabilities','scripts','tests','public']) await scan(directory);
const browserModules=new Set();
async function includeBrowserModule(name) {
  if(browserModules.has(name))return;
  assert.ok(!name.startsWith('../') && name.endsWith('.js'),`Unsupported browser dependency: ${name}`);
  browserModules.add(name);names.add(name);
  const text=await readFile(join(root,name),'utf8');
  for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g))await includeBrowserModule(relative(root,resolve(dirname(join(root,name)),match[1])).replaceAll('\\','/'));
}
await includeBrowserModule('app.js');
for(const name of ['LICENSE','LICENSE.md','NOTICE','THIRD_PARTY_NOTICES.md']) { try { await readFile(join(root,name)); names.add(name); } catch(error) { if(error.code!=='ENOENT')throw error; } }
const records=[];
for(const name of [...names].sort()) {
  assert.ok(!name.split('/').some(part=>['data','work','outputs','release'].includes(part)));
  assert.ok((await lstat(join(root,name))).isFile(),`Source must be a regular file: ${name}`);
  const bytes=await readFile(join(root,name));
  assert.ok(bytes.length<2*1024*1024,`Unexpectedly large source file: ${name}`);
  records.push({name,bytes,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await mkdir(destination,{recursive:true});
for(const {name,bytes} of records) { const file=join(destination,name); await mkdir(join(file,'..'),{recursive:true});await writeFile(file,bytes); }
for(const {name,sha256} of records) assert.equal(createHash('sha256').update(await readFile(join(root,name))).digest('hex'),sha256,`Source changed during snapshot: ${name}; do not publish this copy`);
await writeFile(join(destination,'source-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),status:'SOURCE_SNAPSHOT_REQUIRES_PUBLICATION_AUDIT',excludes:['user projects','SQLite databases','OAuth credentials','model weights','executable tools','caches','creative media','git history'],files:records.map(({name,bytes,sha256})=>({file:name,bytes:bytes.length,sha256}))},null,2));
console.log(`Staged ${records.length} source files in ${relative(root,destination)}. No commit or upload performed.`);
