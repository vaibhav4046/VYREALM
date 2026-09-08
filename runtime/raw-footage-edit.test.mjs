import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { editRawFootage, planRawRanges, buildRawEditPlan } from './raw-footage-edit.mjs';
test('chronological real ranges preserve total duration without overlaps',()=>{
  const ranges=planRawRanges([{id:'source',durationSeconds:22.883}],20);
  assert.equal(ranges.length,4);assert.equal(ranges.reduce((sum,r)=>sum+r.duration,0),20);
  ranges.slice(1).forEach((r,i)=>assert.ok(r.start>=ranges[i].start+ranges[i].duration));
  assert.throws(()=>planRawRanges([{id:'short',durationSeconds:19}],20),error=>error.code==='RAW_SOURCE_TOO_SHORT');
  assert.equal(planRawRanges([{id:'one',durationSeconds:1.5}],1)[0].duration,1);
});
const ffmpeg=process.env.VYRELUM_FFMPEG,ffprobe=process.env.VYRELUM_FFPROBE,audioConfigPath=process.env.VYRELUM_AUDIO_CONFIG;
test('explicit saved plan renders reversed sources and letterbox pixels',{skip:![ffmpeg,ffprobe].every(p=>p&&existsSync(p)),timeout:180000},async()=>{
 const exec=promisify(execFile),dir=await mkdtemp(join(tmpdir(),'raw-plan-'));
 try{
  const assets=[];
  for(const color of ['red','blue']){
   const path=join(dir,`${color}.mp4`);
   await exec(ffmpeg,['-v','error','-f','lavfi','-i',`color=${color}:s=320x180:r=24:d=3`,'-c:v','libx264',path],{windowsHide:true});
   assets.push({id:color,path,mime:'video/mp4'});
  }
  const request={projectId:'p',revision:1,brief:'source 2 from 1s to 2s; then source 1 from 0s to 1s; portrait; fit',durationSeconds:20,aspect:'16:9',captionsEnabled:false,sourceAssets:assets,outputDir:join(dir,'job')};
  request.editPlan=buildRawEditPlan({...request,sources:assets.map(a=>({id:a.id,durationSeconds:3}))});
  const result=await editRawFootage(request,{ffmpeg,ffprobe});
  assert.equal(result.durationSeconds,2);assert.equal(result.width,1080);assert.equal(result.height,1920);
  assert.deepEqual(result.timeline.map(r=>r.assetId),['blue','red']);assert.deepEqual(result.timeline.map(r=>r.trimStart),[1,0]);
  const pixel=async(t,x,y)=>{
   const {stdout}=await exec(ffmpeg,['-v','error','-ss',String(t),'-i',join(request.outputDir,'edited.mp4'),'-vf',`crop=2:2:${x}:${y},format=rgb24`,'-frames:v','1','-f','rawvideo','-'],{encoding:'buffer',windowsHide:true});return [...stdout.subarray(0,3)];
  };
  const blue=await pixel(.5,500,900),red=await pixel(1.5,500,900),black=await pixel(.5,10,10);
  assert.ok(blue[2]>200&&blue[0]<20,JSON.stringify(blue));assert.ok(red[0]>200&&red[2]<20,JSON.stringify(red));assert.ok(black.every(n=>n<10));
  await assert.rejects(()=>editRawFootage({...request,editPlan:{...request.editPlan,framing:'crop-left'}},{ffmpeg,ffprobe}),e=>e.code==='RAW_PLAN_MISMATCH');
 }finally{await rm(dir,{recursive:true,force:true});}
});
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
    assert.equal(result.audioStatus,'original-audio');assert.ok(result.sourceAudioLevels.peakDbFS>-80);
    const silent=join(dir,'silent.mp4');await exec(ffmpeg,['-y','-v','error','-i',path,'-c:v','copy','-af','volume=0','-c:a','aac',silent],{windowsHide:true});
    const silentHash=createHash('sha256').update(await readFile(silent)).digest('hex');
    const silentResult=await editRawFootage({...request,durationSeconds:1,outputDir:join(dir,'silent-job'),sourceAssets:[{id:'silent',path:silent,mime:'video/mp4',sha256:silentHash}]},{ffmpeg,ffprobe});
    assert.equal(silentResult.audioStatus,'silent-source');assert.equal(silentResult.captionStatus,'no-speech');assert.equal(silentResult.provenance.captions,null);assert.ok(silentResult.diagnostics.some(d=>d.code==='RAW_SOURCE_SILENT'));assert.ok(silentResult.outputAudioLevels.peakDbFS<=-80);
    await assert.rejects(()=>editRawFootage({...request,sourceAssets:[{...request.sourceAssets[0],sha256:'0'.repeat(64)}]},{ffmpeg,ffprobe}),error=>error.code==='RAW_SOURCE_HASH');
    console.log(JSON.stringify({rawCpuIntegration:result.provenance.timings,captionStatus:result.captionStatus}));
  }finally{await rm(dir,{recursive:true,force:true});}
});
