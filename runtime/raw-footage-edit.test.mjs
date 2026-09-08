import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { editRawFootage, planRawRanges } from './raw-footage-edit.mjs';
test('chronological real ranges preserve total duration without overlaps',()=>{
  const ranges=planRawRanges([{id:'source',durationSeconds:22.883}],20);
  assert.equal(ranges.length,4);assert.equal(ranges.reduce((sum,r)=>sum+r.duration,0),20);
  ranges.slice(1).forEach((r,i)=>assert.ok(r.start>=ranges[i].start+ranges[i].duration));
  assert.throws(()=>planRawRanges([{id:'short',durationSeconds:19}],20),error=>error.code==='RAW_SOURCE_TOO_SHORT');
  assert.equal(planRawRanges([{id:'one',durationSeconds:1.5}],1)[0].duration,1);
});
const ffmpeg=process.env.VYRELUM_FFMPEG,ffprobe=process.env.VYRELUM_FFPROBE,audioConfigPath=process.env.VYRELUM_AUDIO_CONFIG;
test('real raw edit preserves source lineage and natural noise without hallucinated captions',{skip:![ffmpeg,ffprobe,audioConfigPath].every(p=>p&&existsSync(p)),timeout:180000},async()=>{
  const exec=promisify(execFile),dir=await mkdtemp(join(tmpdir(),'raw-edit-'));
  try{
    const path=join(dir,'uploaded-noise.mp4');await exec(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=24:d=7','-f','lavfi','-i','anoisesrc=color=pink:amplitude=0.06:duration=7','-c:v','libx264','-preset','veryfast','-c:a','aac','-shortest',path],{windowsHide:true});
    const sourceHash=createHash('sha256').update(await readFile(path)).digest('hex');
    const request={projectId:'p',revision:1,brief:'Edit my uploaded footage.',sourceAssets:[{id:'original',path,mime:'video/mp4',sha256:sourceHash}],durationSeconds:6,aspect:'16:9',captionsEnabled:true,audioConfigPath,outputDir:join(dir,'job')};
    const result=await editRawFootage(request,{ffmpeg,ffprobe});
    assert.equal(result.verification.ok,true);assert.equal(result.captionStatus,'no-speech');assert.equal(result.outputs.captions,null);assert.equal(result.timeline.length,2);assert.ok(result.timeline.every(clip=>clip.assetId==='original'));assert.equal(result.provenance.sources[0].sourceHash,sourceHash);
    assert.equal(result.provenance.neuralVideoGenerated,false);assert.equal(result.provenance.captions.vadEnabled,true);
    assert.equal(result.width,1920);assert.equal(result.height,1080);
    await assert.rejects(()=>editRawFootage({...request,sourceAssets:[{...request.sourceAssets[0],sha256:'0'.repeat(64)}]},{ffmpeg,ffprobe}),error=>error.code==='RAW_SOURCE_HASH');
    console.log(JSON.stringify({rawCpuIntegration:result.provenance.timings,captionStatus:result.captionStatus}));
  }finally{await rm(dir,{recursive:true,force:true});}
});
