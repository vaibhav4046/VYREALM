import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {receiveMediaUpload} from './media-upload.mjs';
const space=async()=>({bavail:8*1024**3,bsize:1});
async function fixture(t,chunks,headers={}){const dir=await mkdtemp(join(tmpdir(),'vyrealm-upload-'));t.after(()=>rm(dir,{recursive:true,force:true}));const request=Readable.from(chunks);request.headers={'x-filename':'camera.mp4','content-type':'video/mp4',...headers};return{request,mediaDir:dir,space};}
test('chunked media upload preserves every byte without accumulating the source in RAM',async t=>{
 const chunk=Buffer.alloc(64*1024,73),hash=createHash('sha256');for(let n=0;n<160;n++)hash.update(chunk);
 const f=await fixture(t,(async function*(){for(let n=0;n<160;n++)yield chunk;})()),result=await receiveMediaUpload(f);
 assert.equal(result.size,10*1024**2);assert.equal(createHash('sha256').update(await readFile(result.path)).digest('hex'),hash.digest('hex'));assert.equal((await readdir(f.mediaDir)).length,1);
});
test('over-budget declared or streamed imports leave no partial asset',async t=>{
 const f=await fixture(t,[Buffer.alloc(6),Buffer.alloc(6)]);await assert.rejects(receiveMediaUpload({...f,maxBytes:10}),{code:'MEDIA_UPLOAD_TOO_LARGE'});assert.deepEqual(await readdir(f.mediaDir),[]);
 const declared=await fixture(t,[],{'content-length':'99'});await assert.rejects(receiveMediaUpload({...declared,maxBytes:10}),{code:'MEDIA_UPLOAD_TOO_LARGE'});assert.deepEqual(await readdir(declared.mediaDir),[]);
});
test('interrupted streams clean only their owned partial file and preserve completed imports',async t=>{
 const f=await fixture(t,[Buffer.from('kept')]);const saved=await receiveMediaUpload(f);
 const broken=Readable.from((async function*(){yield Buffer.from('partial');throw Error('connection lost');})());broken.headers=f.request.headers;
 await assert.rejects(receiveMediaUpload({...f,request:broken}),/connection lost/);assert.deepEqual(await readdir(f.mediaDir),[saved.path.split(/[\\/]/).at(-1)]);assert.equal((await readFile(saved.path)).toString(),'kept');
});
test('path components and malformed names cannot escape the media directory',async t=>{
 const f=await fixture(t,[Buffer.from('media')],{'x-filename':encodeURIComponent('../../outside/movie.mp4')});const result=await receiveMediaUpload(f);assert.equal(result.name,'movie.mp4');assert.ok(result.path.startsWith(f.mediaDir));
 const bad=await fixture(t,[],{'x-filename':'%00%broken'});await assert.rejects(receiveMediaUpload(bad),{code:'MEDIA_UPLOAD_NAME'});
});
