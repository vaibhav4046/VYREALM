import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const blockedFolders=new Set(['.git','node_modules','data','work','outputs','release','assets','models','cache','__pycache__']);
const blockedFile=/\.(?:sqlite(?:-(?:shm|wal))?|db|exe|dll|onnx|safetensors|gguf|pt|ckpt|zip|7z|mp4|wav|png|jpg|pem|pfx)$/i;
const reviewedBrandAssets=new Set(['desktop/resources/icon.png']);
const credentials=[
  ['PRIVATE_KEY',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['GITHUB_TOKEN',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['GOOGLE_CLIENT_SECRET',/\bGOCSPX_[A-Za-z0-9_-]{16,}\b/g],
  ['GOOGLE_API_KEY',/\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ['OPENAI_KEY',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g]
];

export async function auditPublicSource(directory) {
  const root=resolve(directory),findings=[],manifest=JSON.parse(await readFile(join(root,'source-manifest.json'),'utf8')),expected=new Map();
  const note=(file,rule,line)=>findings.push({file,rule,...(line?{line}:{})});
  if(!Array.isArray(manifest.files))throw new Error('Source manifest files must be an array');
  for(const item of manifest.files) {
    if(typeof item.file!=='string'||isAbsolute(item.file)||item.file.includes('\\')||item.file.split('/').some(x=>!x||x==='..'||x==='.')||!/^[a-f0-9]{64}$/.test(item.sha256||'')||expected.has(item.file)){note('(manifest)','INVALID_MANIFEST_PATH');continue;}
    expected.set(item.file,item.sha256);
  }
  const seen=new Set();
  async function inspect(directoryName='') {
    for(const entry of await readdir(join(root,directoryName),{withFileTypes:true})) {
      const name=directoryName?`${directoryName}/${entry.name}`:entry.name;
      if(entry.isSymbolicLink()){note(name,'SYMLINK');continue;}
      if(entry.isDirectory()){if(blockedFolders.has(entry.name))note(name,'DISALLOWED_DIRECTORY');else await inspect(name);continue;}
      if(name==='source-manifest.json')continue;
      seen.add(name);
      if(blockedFile.test(name)&&!reviewedBrandAssets.has(name)||/^\.env(?:\.|$)/.test(entry.name)&&entry.name!=='.env.example'||/^(?:credentials|client_secret.*)\.json$/i.test(entry.name)){note(name,'DISALLOWED_FILE');continue;}
      if(!expected.has(name))note(name,'UNLISTED_FILE');
      const path=join(root,name);if((await stat(path)).size>2*1024*1024){note(name,'OVERSIZED_SOURCE');continue;}
      const bytes=await readFile(path);
      if(expected.has(name)&&createHash('sha256').update(bytes).digest('hex')!==expected.get(name))note(name,'HASH_MISMATCH');
      const text=bytes.toString('utf8');
      for(const [rule,pattern] of credentials) {
        pattern.lastIndex=0;
        for(const match of text.matchAll(pattern)) {
          // Existing backend tests use a named synthetic Desktop secret.
          if(rule==='GOOGLE_CLIENT_SECRET'&&/\.test\.mjs$/.test(name)&&match[0].startsWith('GOCSPX_TEST_'))continue;
          note(name,rule,text.slice(0,match.index).split('\n').length);
        }
      }
    }
  }
  await inspect();
  for(const name of expected.keys())if(!seen.has(name))note(name,'MISSING_FILE');
  const license=await readFile(join(root,'LICENSE'),'utf8').catch(()=>null);
  if(!license?.startsWith('MIT License')||!license.includes('VYREALM contributors'))note('LICENSE','APPLICATION_LICENSE_MISSING');
  return {createdAt:new Date().toISOString(),ok:findings.length===0,checkedFiles:seen.size,scope:'Read-only staged-source manifest, file-boundary and known credential-pattern checks; human provenance/licensing review still required',findings};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Usage: node scripts/audit-public-source.mjs <staged-source-directory>');
  const report=await auditPublicSource(process.argv[2]);console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1;
}
