import test from 'node:test';import assert from 'node:assert/strict';
import {rawFramingFilter} from './raw-footage-plan.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {resolve} from 'node:path';
const exec=promisify(execFile);
test('clip crop coordinates are bounded data, never filter expressions',()=>{
 for(const pos of [null,{},[],{x:-1,y:0},{x:.5,y:2},{x:'0;movie=remote',y:0}])assert.throws(()=>rawFramingFilter(100,100,'crop-custom',pos),/Crop position/);
 assert.throws(()=>rawFramingFilter(100,100,'crop-custom'),/requires/);
});
test('FFmpeg cropping preserves the chosen left and right subjects in actual output pixels',async()=>{
 const filters="color=black:s=300x100:r=1:d=1,drawbox=x=0:y=0:w=100:h=100:c=red:t=fill,drawbox=x=200:y=0:w=100:h=100:c=blue:t=fill";
 for(const [x,red,blue] of [[0,true,false],[1,false,true]]){
  const result=await exec(resolve('workers/tools/ffmpeg.exe'),['-v','error','-threads','1','-f','lavfi','-i',filters,'-vf',rawFramingFilter(100,100,'crop-custom',{x,y:.5}),'-frames:v','1','-threads','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,encoding:'buffer',maxBuffer:100000,timeout:10000});
  assert.equal(result.stdout.length,30000);const centre=50*100*3+50*3;
  assert.equal(result.stdout[centre]>180,red);assert.equal(result.stdout[centre+2]>180,blue);
 }
});
