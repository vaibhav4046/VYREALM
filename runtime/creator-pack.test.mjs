import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildCreatorPack } from './creator-pack.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),exec=promisify(execFile),ffmpeg=path.join(root,'workers/tools/ffmpeg.exe'),ffprobe=path.join(root,'workers/tools/ffprobe.exe'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const project={id:'project-1',revision:4,name:'Coastal cycling',brief:'A cycle ride along a coastal route in morning light.',script:'A quiet morning. The road follows the coastline.',latestOutput:{provenance:{generationStatus:'edited',sourceMethod:'local-raw-footage-edit',sources:[{assetId:'original-1',sourceHash:'a'.repeat(64)}]}}};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vyrealm-creator-pack-')),videoPath=path.join(dir,'source.mp4'),outputDir=path.join(dir,'pack');await exec(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=24:d=2','-c:v','libx264','-preset','ultrafast','-threads','1',videoPath],{windowsHide:true,timeout:30000});t.after(async()=>{if(path.dirname(dir)===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('vyrealm-creator-pack-'))await fs.rm(dir,{recursive:true,force:true});});return {dir,videoPath,outputDir,ffmpeg,ffprobe,project};}

test('creator pack extracts a real 1280x720 frame and writes saved-text-only publishing drafts',async t=>{
 const f=await fixture(t),pack=await buildCreatorPack(f);assert.equal(pack.status,'draft');assert.equal(pack.source.sha256,sha(await fs.readFile(f.videoPath)));assert.equal(pack.source.provenance.generationStatus,'edited');assert.equal(pack.thumbnail.method,'extracted-video-frame');assert.equal(pack.thumbnail.atSeconds,1);assert.equal(pack.metadata.title,project.name);assert.equal(pack.metadata.script,project.script);assert.equal(pack.metadata.description,project.brief);assert.equal(pack.metadata.hashtags.length,5);assert.equal(new Set(pack.metadata.hashtags).size,5);assert.ok(pack.metadata.hashtags.some(tag=>/coastal/i.test(tag)));assert.equal(pack.campaigns.length,3);assert.ok(pack.campaigns.every(item=>item.status==='draft'&&item.method==='deterministic-template'));
 const thumbnail=path.join(f.outputDir,pack.outputs.thumbnail),probe=JSON.parse((await exec(ffprobe,['-v','error','-show_entries','stream=width,height','-of','json',thumbnail],{windowsHide:true})).stdout);assert.equal(probe.streams[0].width,1280);assert.equal(probe.streams[0].height,720);await exec(ffmpeg,['-v','error','-xerror','-i',thumbnail,'-f','null','-'],{windowsHide:true});assert.equal(pack.thumbnail.sha256,sha(await fs.readFile(thumbnail)));
 const manifest=JSON.parse(await fs.readFile(path.join(f.outputDir,pack.outputs.manifest),'utf8')),draft=await fs.readFile(path.join(f.outputDir,pack.outputs.draft),'utf8');assert.equal(manifest.source.sha256,pack.source.sha256);assert.match(draft,/not published/i);assert.match(draft,/No trend research/i);assert.ok(draft.includes(project.brief));assert.ok(draft.includes(project.script));assert.ok(!JSON.stringify(manifest).includes(f.videoPath));assert.ok(!draft.includes(f.videoPath));
});

test('empty context, missing media and an incorrect saved output hash fail honestly',async t=>{
 const f=await fixture(t);await assert.rejects(buildCreatorPack({...f,project:{}}),{code:'CREATOR_PACK_PROJECT'});await assert.rejects(buildCreatorPack({...f,videoPath:path.join(f.dir,'missing.mp4')}),{code:'CREATOR_PACK_VIDEO_MISSING'});await assert.rejects(buildCreatorPack({...f,project:{...project,latestOutput:{provenance:{generationStatus:'edited',outputHash:'0'.repeat(64)}}}}),{code:'CREATOR_PACK_SOURCE_MISMATCH'});assert.equal(await fs.stat(path.join(f.outputDir,'creator-pack.json')).then(()=>true,()=>false),false);
});

test('title overlay uses a text file with expansion disabled and never executes filter-like title text',async t=>{
 const f=await fixture(t),title="100% %{eif:7:d} [x]; movie's launch";const pack=await buildCreatorPack({...f,project:{...project,name:title},fontPath:'C:/Windows/Fonts/segoeuib.ttf',titleOverlay:true});assert.equal(pack.metadata.title,title);assert.equal(pack.thumbnail.titleOverlay,true);assert.equal(pack.thumbnail.method,'extracted-video-frame');assert.ok((await fs.stat(path.join(f.outputDir,pack.outputs.thumbnail))).size>1000);await assert.rejects(buildCreatorPack({...f,outputDir:path.join(f.dir,'other-pack'),titleOverlay:true}),{code:'CREATOR_PACK_FONT_REQUIRED'});
});

test('existing creator pack artifacts are never overwritten',async t=>{
 const f=await fixture(t),first=await buildCreatorPack(f),before=await fs.readFile(path.join(f.outputDir,first.outputs.manifest));await assert.rejects(buildCreatorPack({...f,project:{...project,name:'Changed title'}}),{code:'CREATOR_PACK_EXISTS'});assert.deepEqual(await fs.readFile(path.join(f.outputDir,first.outputs.manifest)),before);
});

test('saved publishing description takes precedence over production instructions, and can stand alone',async t=>{
 const f=await fixture(t),description='A calm ride beside the sea, filmed in the morning.';
 const pack=await buildCreatorPack({...f,project:{...project,brief:'source 1 from 0s to 2s; horizontal; fit',description}});assert.equal(pack.metadata.description,description);assert.ok(pack.campaigns.every(campaign=>campaign.copy.includes(description)));assert.ok(!JSON.stringify(pack.metadata).includes('source 1 from'));assert.ok(!JSON.stringify(pack.campaigns).includes('source 1 from'));
 const onlyDescription=await buildCreatorPack({...f,outputDir:path.join(f.dir,'description-only'),project:{...project,brief:'',description}});assert.equal(onlyDescription.metadata.description,description);
});
