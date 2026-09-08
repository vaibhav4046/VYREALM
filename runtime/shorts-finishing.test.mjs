import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finishShorts, speechCaptionCues } from './shorts-finishing.mjs';

test('speech captions preserve silence and refuse overflowing speech',()=>{
  const cues=speechCaptionCues([{start:5,end:10,text:'She stopped.',speechDurationSeconds:1.2}]);
  assert.equal(cues[0].start,5);assert.equal(cues.at(-1).end,6.2);
  assert.throws(()=>speechCaptionCues([{start:5,end:6,text:'Too long.',speechDurationSeconds:2}]),/fit/);
});
const ffmpeg=process.env.VYRELUM_FFMPEG,ffprobe=process.env.VYRELUM_FFPROBE,audioConfigPath=process.env.VYRELUM_AUDIO_CONFIG;
const ready=[ffmpeg,ffprobe,audioConfigPath].every(value=>value&&existsSync(value));
test('real Piper and FFmpeg produce captioned and uncaptained 20s exports from verified fixtures',{skip:!ready,timeout:180000},async()=>{
  const exec=promisify(execFile), dir=process.env.VYRELUM_FINISH_TEST_OUTPUT?resolve(process.env.VYRELUM_FINISH_TEST_OUTPUT):await mkdtemp(join(tmpdir(),'shorts-finish-'));
  await mkdir(dir,{recursive:true});
  try{
    const sources=[];
    for(let i=0;i<4;i++){
      const path=join(dir,`technical-fixture-${i}.mp4`);
      await exec(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=s=320x568:r=24:d=5','-vf',`hue=h=${i*60}`,'-c:v','libx264','-preset','veryfast',path],{windowsHide:true});
      const hash=createHash('sha256').update(await readFile(path)).digest('hex');
      sources.push({id:`fixture-${i}`,path,sha256:hash,reviewedHash:hash,review:'passed',sourceMethod:'FFmpeg technical test pattern; NOT creative demo',generationMs:null});
    }
    const args={sources,narration:['She heard footsteps.','So she ran.','Then she stopped.','The footsteps continued.'],audioConfigPath,ffmpeg,ffprobe,width:720,height:1280};
    const first=await finishShorts({...args,outputDir:join(dir,'captioned'),sound:{preset:'epic-dawn-v1'}});
    assert.equal(first.verification.ok,true);assert.equal(first.captions.enabled,true);assert.equal(first.durationSeconds,20);assert.equal(first.timings.sourceGenerationMs,null);
    assert.ok(first.captions.cues.at(-1).end<20);assert.equal(first.sound.preset,'epic-dawn-v1');
    const second=await finishShorts({...args,outputDir:join(dir,'no-captions'),captionsEnabled:false});
    assert.equal(second.verification.ok,true);assert.deepEqual(second.captions.cues,[]);
    const bad=sources.map((source,i)=>i?source:{...source,reviewedHash:'0'.repeat(64)});
    await assert.rejects(()=>finishShorts({...args,sources:bad,outputDir:join(dir,'bad')}),/passed review/);
    console.log(JSON.stringify({technicalFixture:true,captioned:first.timings,noCaptions:second.timings,output:dir}));
  }finally{if(!process.env.VYRELUM_FINISH_TEST_OUTPUT)await rm(dir,{recursive:true,force:true});}
});
