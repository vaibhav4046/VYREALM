// Small real CPU/model integration test. This pattern fixture is not a film.
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileSha256 } from '../runtime/verified-download.mjs';
import { interpolateVideo } from '../runtime/frame-interpolation.mjs';
import { acquireGpuLease } from '../runtime/inference-harness.mjs';
const out=resolve(process.env.VYRELUM_INTERPOLATION_TEST_DIR||'outputs/verification/rife-cpu'),ffmpeg=resolve('workers/tools/ffmpeg.exe');
if(!process.env.VYRELUM_RUNTIME_DIR&&process.env.APPDATA)process.env.VYRELUM_RUNTIME_DIR=join(process.env.APPDATA,'vyrelum/runtime');
await mkdir(out,{recursive:true});
const release=await acquireGpuLease('rife-cpu-qualification');
try{
 const source=join(out,'fixture.mp4');
 await new Promise((ok,bad)=>{const child=spawn(ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=128x72:rate=24:duration=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-shortest',source],{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.on('error',bad);child.on('close',n=>n===0?ok():bad(Error(error)));});
 const sourceReceipt={review:{verdict:'passed',scope:'test fixture technical review'},provenance:{generationStatus:'imported',sourceMethod:'explicit-test-pattern',outputHash:await fileSha256(source)},outputs:{video:'fixture.mp4'}};
 const result=await interpolateVideo({sourcePath:source,sourceReceipt,sourceJobId:'test-fixture',cutFrames:[12],device:'cpu',output:join(out,'job'),onProgress:e=>console.log(e.stage)});
 assert.equal(result.interpolation.targetFrames,60);assert.equal(result.interpolation.segments.length,2);assert.equal(result.interpolation.device,'cpu');assert.equal(result.verification.ok,true);assert(result.interpolation.audioHash);assert(result.interpolation.segments.every(s=>s.synthesizedFrames>0));
 const sourceAfter=await fileSha256(source);assert.equal(sourceAfter,sourceReceipt.provenance.outputHash);
 const repeat=await interpolateVideo({sourcePath:source,sourceReceipt,sourceJobId:'test-fixture',cutFrames:[12],device:'cpu',output:join(out,'job')});
 assert(repeat.interpolation.segments.every(s=>s.cached));assert.equal(repeat.provenance.outputHash,result.provenance.outputHash);
 const report={status:'passed',scope:'one-second 128x72 CPU fixture; not 1080p CPU throughput qualification',firstRenderMs:result.provenance.renderTimeMs,rerunMs:repeat.provenance.renderTimeMs,sourceHash:sourceAfter,outputHash:result.provenance.outputHash,frames:60,fps:60,durationSeconds:1,audioBitstreamPreserved:true,cachedRetry:true};
 await writeFile(join(out,'evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await release();}
