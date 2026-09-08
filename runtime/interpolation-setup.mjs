import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, statfs, rename } from 'node:fs/promises';
import { resolve, join, isAbsolute, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedDownload, fileSha256 } from './verified-download.mjs';
import { inspectInterpolationRuntime, qualifyInterpolationDevice } from './frame-interpolation.mjs';
const app=fileURLToPath(new URL('..',import.meta.url));

export async function setupInterpolation({installDirectory,runtimeDir=process.env.VYRELUM_RUNTIME_DIR||resolve('data/runtime'),onProgress=()=>{}}){
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('INTERPOLATION_PLATFORM_UNQUALIFIED: Windows x64 only');
  if(typeof installDirectory!=='string'||!isAbsolute(installDirectory)||installDirectory.startsWith('\\\\')||resolve(installDirectory)===parse(resolve(installDirectory)).root)throw new Error('Choose a local runtime folder, not a drive root or network share');
  const base=join(resolve(installDirectory),'VYREALM-interpolation-20221029');await mkdir(base,{recursive:true});
  const marker=join(base,'vyrealm-setup.json');let prior;
  try{prior=JSON.parse(await readFile(marker,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!prior&&(await readdir(base)).length)throw new Error('SETUP_DIRECTORY_NOT_EMPTY');
  if(prior&&prior.profile!=='rife-v4.6-win64')throw new Error('SETUP_PROFILE_CHANGED');
  const disk=await statfs(base);if(Number(disk.bavail)*Number(disk.bsize)<1024**3)throw new Error('SETUP_DISK_SPACE: Allow 1 GB for the archive and selected runtime');
  await writeFile(marker,JSON.stringify({profile:'rife-v4.6-win64',startedAt:prior?.startedAt||new Date().toISOString()},null,2));
  const pins=JSON.parse(await readFile(join(app,'runtime/interpolation.lock.json'),'utf8')),archive=join(base,'official-release.zip');let last=0;
  onProgress({stage:'Downloading pinned local RIFE runtime',progress:0.05});
  await verifiedDownload({...pins.archive,path:archive,onProgress:p=>{if(Date.now()-last>1000){last=Date.now();onProgress({stage:`RIFE download · ${Math.round(p.bytes/p.total*100)}%`,progress:p.bytes/p.total*0.8});}}});
  onProgress({stage:'Extracting selected model and runtime; checking SHA-256',progress:0.85});
  const root=join(base,'runtime');
  await new Promise((ok,bad)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',join(app,'scripts/Extract-InterpolationRuntime.ps1'),'-Archive',archive,'-Destination',root],{windowsHide:true,stdio:['ignore','ignore','pipe']});let tail='';
    child.stderr.on('data',b=>tail=(tail+b).slice(-3000));child.on('error',bad);child.on('close',code=>code===0?ok():bad(new Error(`INTERPOLATION_EXTRACTION_FAILED: ${tail}`)));
  });
  for(const item of pins.artifacts)if(await fileSha256(join(root,item.path))!==item.sha256)throw new Error(`INTERPOLATION_RUNTIME_INTEGRITY_FAILED: ${item.path}`);
  onProgress({stage:'Checking CPU and available Vulkan devices with a small model test',progress:0.95});
  const deviceProbe=await qualifyInterpolationDevice(root,join(base,'qualification'));
  const config={schemaVersion:1,root,workRoot:join(base,'work'),gpuId:deviceProbe.gpuId,gpuName:deviceProbe.gpuName,qualification:deviceProbe.scope,deviceProbe,source:pins.archive.url};
  await mkdir(runtimeDir,{recursive:true});const path=join(runtimeDir,'interpolation.json');
  try{const old=await readFile(path);await writeFile(path+`.backup-${Date.now()}`,old);}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(path+'.tmp',JSON.stringify(config,null,2));await rename(path+'.tmp',path);
  const verified=await inspectInterpolationRuntime({runtimeDir,verify:true});if(verified.status!=='ready')throw new Error(verified.message);
  const report={status:'installed',root,model:pins.modelId,platform:'Windows x64',device:config.gpuName||'cpu',deviceProbe,credentialsRequired:false,frameInterpolationTest:'small-startup-probe-only',archiveSha256:pins.archive.sha256,message:'Pinned runtime installed. A real export and visual review are still required.'};
  await writeFile(marker,JSON.stringify({...report,profile:'rife-v4.6-win64'},null,2));return report;
}
