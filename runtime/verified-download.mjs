import { createReadStream } from 'node:fs';
import { open, stat, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

export async function fileSha256(path) { const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex'); }
async function size(path){try{return(await stat(path)).size;}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export async function verifiedDownload({url,path,bytes,sha256,fetchImpl=fetch,onProgress=()=>{}}){
 if(!url.startsWith('https://')||!Number.isSafeInteger(bytes)||bytes<1||! /^[a-f0-9]{64}$/.test(sha256))throw new Error('INVALID_DOWNLOAD_PIN');
 await mkdir(dirname(path),{recursive:true});
 const valid=async p=>(await size(p))===bytes&&await fileSha256(p)===sha256;
 if(await size(path)!==null){if(!await valid(path))throw new Error('EXISTING_ARTIFACT_CHANGED_REPAIR_REQUIRED');return{path,cached:true,sha256};}
 const partial=path+'.part';let offset=(await size(partial))||0;
 if(offset===bytes&&await valid(partial)){await rename(partial,path);return{path,cached:true,sha256};}
 if(offset>=bytes)throw new Error('INVALID_PARTIAL_REPAIR_REQUIRED');
 const response=await fetchImpl(url,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:AbortSignal.timeout(3600000)});
 if(!response.ok)throw new Error(`DOWNLOAD_HTTP_${response.status}`);
 if(response.status===206){if(!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))throw new Error('DOWNLOAD_RANGE_MISMATCH');}else if(response.status===200)offset=0;else throw new Error('DOWNLOAD_STATUS_INVALID');
 const handle=await open(partial,offset?'a':'w');
 try {for await(const chunk of response.body){offset+=chunk.length;if(offset>bytes)throw new Error('DOWNLOAD_SIZE_EXCEEDED');await handle.writeFile(chunk);onProgress({bytes:offset,total:bytes});}}
 finally{await handle.close();}
 if(!await valid(partial))throw new Error('DOWNLOAD_INTEGRITY_FAILED');
 await rename(partial,path);return{path,sha256,bytes};
}
