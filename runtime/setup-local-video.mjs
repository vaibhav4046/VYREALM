import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, statfs, stat, realpath } from 'node:fs/promises';
import { join, resolve, isAbsolute, parse, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSha256, verifiedDownload } from './verified-download.mjs';
const app=fileURLToPath(new URL('..',import.meta.url));

function run(executable,args,{env,cwd,onProgress=()=>{},timeout=3600000}={}){
 return new Promise((ok,bad)=>{
  const child=spawn(executable,args,{env,cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let tail='';
  const consume=b=>{tail=(tail+b.toString()).slice(-3000);onProgress({stage:b.toString().trim().slice(-180)});};child.stdout.on('data',consume);child.stderr.on('data',consume);
  const timer=setTimeout(()=>child.kill(),timeout);child.on('error',error=>{clearTimeout(timer);bad(error);});child.on('close',code=>{clearTimeout(timer);code===0?ok():bad(new Error(`LOCAL_SETUP_PROCESS_FAILED: ${tail}`));});
 });
}

export async function verifyRegisteredRuntime(runtimeDir,onProgress=()=>{}){
 const config=JSON.parse(await readFile(join(runtimeDir,'comfyui.json'),'utf8'));
 const base=await realpath(config.root),inventory=JSON.parse(await readFile(join(base,'installation.json'),'utf8'));
 if(inventory.schemaVersion!==1||!Array.isArray(inventory.code)||!inventory.code.length||!Array.isArray(inventory.models)||inventory.models.length!==3)throw new Error('RUNTIME_INVENTORY_INVALID');
 for(const item of [...inventory.code,...inventory.models]){
  const path=await realpath(resolve(base,item.path)),rel=relative(base,path);if(!rel||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw new Error('INTEGRITY_PATH_OUTSIDE_RUNTIME');
  onProgress({stage:`Checking ${item.path}`});if(await fileSha256(path)!==item.sha256)throw new Error(`RUNTIME_INTEGRITY_FAILED: ${item.path}`);
 }
 return {status:'verified',codeFiles:inventory.code.length,models:inventory.models.length,root:base};
}

export async function setupLocalVideo({installDirectory,mode='install',runtimeDir=process.env.VYRELUM_RUNTIME_DIR||resolve('data/runtime'),onProgress=()=>{}}){
 if(mode==='verify')return verifyRegisteredRuntime(runtimeDir,onProgress);
 if(mode!=='install'||process.platform!=='win32'||process.arch!=='x64')throw new Error('SETUP_PLATFORM_UNQUALIFIED: This setup route targets Windows x64 only');
 if(typeof installDirectory!=='string'||!isAbsolute(installDirectory)||installDirectory.startsWith('\\\\')||resolve(installDirectory)===parse(resolve(installDirectory)).root)throw new Error('Select a local folder for the runtime, not a drive root or network share');
 const base=join(resolve(installDirectory),'VYREALM-local-video-v1');await mkdir(base,{recursive:true});
 const marker=join(base,'vyrealm-setup.json');let registered;
 try{registered=JSON.parse(await readFile(marker,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!registered&&(await readdir(base)).length)throw new Error('SETUP_DIRECTORY_NOT_EMPTY: Choose a new folder; existing files were retained');
 const bootstrap=JSON.parse(await readFile(join(app,'runtime/bootstrap.lock.json'),'utf8'));
 if(registered&&registered.profile!=='wan22-win64-v1')throw new Error('SETUP_PROFILE_CHANGED');
 const disk=await statfs(base);if(Number(disk.bavail)*Number(disk.bsize)<25*1024**3)throw new Error('SETUP_DISK_SPACE: Allow at least 25 GB free for models, Python and installation cache');
 const uv=join(app,'runtime',bootstrap.uv.path);if(await fileSha256(uv)!==bootstrap.uv.sha256)throw new Error('BOOTSTRAP_INTEGRITY_FAILED');
 await writeFile(marker,JSON.stringify({profile:'wan22-win64-v1',startedAt:registered?.startedAt||new Date().toISOString()},null,2));
 const env={...process.env,UV_PYTHON_INSTALL_DIR:join(base,'python'),UV_CACHE_DIR:join(base,'.cache'),UV_NO_PROGRESS:'1',UV_LINK_MODE:'copy',UV_PYTHON_PREFERENCE:'only-managed',HF_HUB_DISABLE_TELEMETRY:'1'};
 onProgress({stage:'Setup · installing private Python 3.12.13',progress:0.03});
 const venv=join(base,'venv'),python=join(venv,'Scripts/python.exe');
 if(!await stat(python).catch(()=>null))await run(uv,['--no-config','venv',venv,'--python','3.12.13'],{env,cwd:base,onProgress});
 for(const archive of bootstrap.archives){
  onProgress({stage:`Setup · downloading pinned ${archive.id}`,progress:0.1});const path=join(base,'.downloads',`${archive.id}.zip`);let last=0;
  await verifiedDownload({...archive,path,onProgress:p=>{if(Date.now()-last>1000){last=Date.now();onProgress({stage:`Setup · ${archive.id} ${Math.round(p.bytes/p.total*100)}%`});}}});
  await run(python,[join(app,'scripts/extract-runtime.py'),'--archive',path,'--prefix',archive.prefix,'--destination',join(base,archive.destination)],{env,cwd:base,onProgress});
 }
 onProgress({stage:'Setup · pinned CUDA/Python packages',progress:0.2});
 await run(uv,['--no-config','pip','install','--only-binary',':all:','--python',python,'--index-url','https://download.pytorch.org/whl/cu128','torch==2.8.0+cu128','torchvision==0.23.0+cu128','torchaudio==2.8.0+cu128'],{env,cwd:base,onProgress});
 const requirements=(await readFile(join(app,'runtime/neural-requirements-windows.lock.txt'),'utf8')).split(/\r?\n/).filter(line=>! /^(torch|torchvision|torchaudio)==/.test(line)).join('\n');const req=join(base,'requirements-pinned.txt');await writeFile(req,requirements);
 await run(uv,['--no-config','pip','install','--only-binary',':all:','--python',python,'--index-url','https://pypi.org/simple','-r',req],{env,cwd:base,onProgress});
 const manifest=JSON.parse(await readFile(join(app,'runtime/neural-runtime.lock.json'),'utf8'));
 for(const model of manifest.models){let last=0;onProgress({stage:`Setup · ${model.file}`,progress:0.45});await verifiedDownload({...model,url:`https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.file}`,path:join(base,'ComfyUI/models',model.destination),onProgress:p=>{if(Date.now()-last>2000){last=Date.now();onProgress({stage:`Downloading ${model.destination.split('/').at(-1)} · ${Math.round(p.bytes/p.total*100)}%`});}}});}
 onProgress({stage:'Setup · private CPU narration and transcription runtime',progress:0.75});
 const audioVenv=join(base,'audio-venv'),audioPython=join(audioVenv,'Scripts/python.exe');
 if(!await stat(audioPython).catch(()=>null))await run(uv,['--no-config','venv',audioVenv,'--python','3.12.13'],{env,cwd:base,onProgress});
 await run(uv,['--no-config','pip','install','--only-binary',':all:','--python',audioPython,'--index-url','https://pypi.org/simple','-r',join(app,'runtime/audio-requirements-windows.lock.txt')],{env,cwd:base,onProgress});
 await run(audioPython,[join(app,'scripts/install-audio-models.py'),'--root',join(base,'audio-models'),'--python',audioPython,'--config-dir',runtimeDir],{env,cwd:base,onProgress});
 onProgress({stage:'Setup · verifying installed code and model hashes',progress:0.9});
 await run(python,[join(app,'scripts/register-archive-runtime.py'),'--root',base,'--config-dir',runtimeDir],{env,cwd:base,onProgress});
 return{status:'installed',root:base,models:3,credentialsRequired:false,neuralSmokeTest:'not-run',message:'Runtime installed and verified. Run a real generation test to qualify this machine.'};
}
