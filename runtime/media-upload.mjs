import {open,rename,unlink,statfs,mkdir} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
export const MAX_MEDIA_UPLOAD_BYTES=2*1024**3,MEDIA_DISK_RESERVE_BYTES=2*1024**3;
const fail=(code,message)=>Object.assign(new Error(message),{code});
/** Streams one owned import to a temporary file. No complete media buffer or execution. */
export async function receiveMediaUpload({request,mediaDir,id=randomUUID(),space=statfs,maxBytes=MAX_MEDIA_UPLOAD_BYTES,reserveBytes=MEDIA_DISK_RESERVE_BYTES}){
 if(!/^[a-f0-9-]{36}$/.test(id))throw fail('MEDIA_UPLOAD_ID','Invalid owned import identifier.');
 let name;try{name=decodeURIComponent(request.headers['x-filename']||'asset.bin');}catch{throw fail('MEDIA_UPLOAD_NAME','The source filename is invalid.');}
 name=basename(name.replaceAll('\\','/')).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120).trim();if(!name||['.','..'].includes(name))throw fail('MEDIA_UPLOAD_NAME','Choose a named source file.');
 const directory=resolve(mediaDir);await mkdir(directory,{recursive:true});const disk=await space(directory),free=Number(disk.bavail)*Number(disk.bsize),budget=Math.min(maxBytes,Math.max(0,free-reserveBytes));
 if(!Number.isFinite(budget)||budget<1)throw fail('MEDIA_DISK_LOW','Free at least 2 GiB of storage before importing media.');
 const declared=request.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>budget))throw fail('MEDIA_UPLOAD_TOO_LARGE','This import exceeds the 2 GiB file limit or available storage reserve.');
 const temporary=join(directory,`.${id}.upload.partial`),target=join(directory,id+'-'+name);let handle,bytes=0,complete=false;
 try{
  handle=await open(temporary,'wx');
  const iterable=typeof request.iterator==='function'?request.iterator({destroyOnReturn:false}):request;
  for await(const chunk of iterable){bytes+=chunk.length;if(bytes>budget)throw fail('MEDIA_UPLOAD_TOO_LARGE','This import exceeded its bounded storage allowance.');await handle.writeFile(chunk);}
  if(bytes===0)throw fail('MEDIA_UPLOAD_EMPTY','The selected file is empty.');
  if(declared!==undefined&&bytes!==Number(declared))throw fail('MEDIA_UPLOAD_INTERRUPTED','The upload ended before all source bytes arrived.');
  await handle.close();handle=null;await rename(temporary,target);complete=true;
  return{name,path:target,size:bytes,mime:String(request.headers['content-type']||'application/octet-stream').split(';')[0].slice(0,100)};
 }finally{await handle?.close().catch(()=>{});if(!complete)await unlink(temporary).catch(()=>{});}
}
