import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {renderTimeline} from './timeline.mjs';
const exec=promisify(execFile),ffmpeg=process.env.VYRELUM_FFMPEG,ffprobe=process.env.VYRELUM_FFPROBE;
test('raw profile preserves framing, invalidates crop cache and targets -16 LUFS',{skip:!ffmpeg||!ffprobe,timeout:180000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'timeline-profile-'));
 try{
  const path=join(dir,'source.mp4');
  await exec(ffmpeg,['-v','error','-f','lavfi','-i','color=red:s=320x180:r=24:d=5,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill,hue=b=0.2*sin(2*PI*t),drawgrid=w=40:h=40:t=4:c=white','-f','lavfi','-i','sine=frequency=330:sample_rate=48000:d=5','-c:v','libx264','-c:a','aac','-shortest',path],{windowsHide:true});
  const request={schemaVersion:1,kind:'timeline',settings:{width:180,height:320,fps:24,rawEditProfile:{framing:'crop-left',audioTargetLUFS:-16}},timeline:{clips:[{path,kind:'video',duration:5}]}};
  const render=async(name,r)=>renderTimeline(r,{output:join(dir,name),cacheDir:dir,ffmpeg,ffprobe});
  const left=await render('left',request);
  assert.equal(left.audioNormalization.targetLufs,-16);assert.ok(Math.abs(Number(left.audioNormalization.deliveryMeasurement.input_i)+16)<.9);
  const right=await render('right',{...request,settings:{...request.settings,framing:'crop-right'}});
  assert.notEqual(left.cache.clips[0].cacheKey,right.cache.clips[0].cacheKey);assert.equal(right.cache.clips[0].cacheHit,false);
  const pixel=async(name)=>{const {stdout}=await exec(ffmpeg,['-v','error','-ss','1','-i',join(dir,name,'render.mp4'),'-vf','crop=2:2:90:160,format=rgb24','-frames:v','1','-f','rawvideo','-'],{encoding:'buffer',windowsHide:true});return [...stdout.subarray(0,3)];};
  assert.ok((await pixel('left'))[0]>200);assert.ok((await pixel('right'))[2]>200);
  const fitted=await render('fit',{...request,settings:{width:360,height:640,fps:24,rawEditProfile:{framing:'fit',audioTargetLUFS:-16,captionStyle:'minimal-lower'}},timeline:{...request.timeline,captions:[{start:0,end:2,text:'Hello'}]}});
  assert.equal(fitted.renderProfile.captionStyle,'minimal-lower');assert.equal(fitted.verification.ok,true);
  const ordinary=await render('default',{...request,settings:{width:180,height:320,fps:24}});
  assert.equal(ordinary.audioNormalization.targetLufs,-14);assert.equal(ordinary.renderProfile.framing,'fit');
  await assert.rejects(()=>render('invalid',{...request,settings:{...request.settings,framing:'injected'}}),/framing/);
  await assert.rejects(()=>render('invalid',{...request,settings:{...request.settings,audioTargetLUFS:10}}),/audioTargetLUFS/);
 }finally{await rm(dir,{recursive:true,force:true});}
});


