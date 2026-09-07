import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {verifiedDownload} from './verified-download.mjs';
test('verified downloads resume exact bytes, reuse offline and never promote corrupt content',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vyrealm-download-')),data=Buffer.from('pinned model bytes'),sha256=createHash('sha256').update(data).digest('hex'),args={url:'https://example.test/model',path:join(root,'model'),bytes:data.length,sha256};
 await writeFile(args.path+'.part',data.subarray(0,5));
 await verifiedDownload({...args,fetchImpl:async(url,options)=>{assert.equal(options.headers.Range,'bytes=5-');return new Response(data.subarray(5),{status:206,headers:{'content-range':`bytes 5-${data.length-1}/${data.length}`}});}});
 assert.deepEqual(await readFile(args.path),data);assert.equal((await verifiedDownload({...args,fetchImpl:()=>assert.fail('offline reuse')})).cached,true);
 const bad={...args,path:join(root,'bad'),fetchImpl:async()=>new Response(Buffer.alloc(data.length))};await assert.rejects(verifiedDownload(bad),/INTEGRITY/);await assert.rejects(stat(bad.path),e=>e.code==='ENOENT');assert.equal((await stat(bad.path+'.part')).size,data.length);
});
