import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Export keeps playback running when completed output arrives, without seeking on metadata refresh', {skip:process.env.VYREALM_EXPORT_BROWSER_TEST!=='1',timeout:45000}, async()=>{
  const {chromium}=await import('@playwright/test');
  const root=resolve('.'), directory=join(root,'work/export-playback-proof',String(Date.now()));await mkdir(directory,{recursive:true});
  const mediaPath=join(directory,'fixture.mp4');
  await promisify(execFile)(resolve('workers/tools/ffmpeg.exe'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-c:v','libx264','-threads','1','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-shortest',mediaPath],{windowsHide:true,timeout:20000});
  const media=await readFile(mediaPath);
  const project={id:'export-refresh-fixture',name:'Playback fixture',revision:1,mode:'creator',brief:'Synthetic browser regression fixture; not a catalogue film.',timeline:[],settings:{width:320,height:180,fps:24},latestOutput:{status:'review_required',videoAssetId:'export-a',jobId:'job-a'}};
  const state={projects:[project],assets:[{id:'export-a',projectId:project.id,name:'Earlier export.mp4',kind:'video',mime:'video/mp4',url:'/media/export-a'}],jobs:[],capabilities:[],flagships:[],features:{}};
  const errors=[],requests=[];
  const server=createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname.startsWith('/api/')){
      requests.push({method:req.method,path:pathname});
      const data=pathname==='/api/state'?state:pathname==='/api/session'?{token:'isolated-export-fixture'}:pathname==='/api/jobs'?state.jobs:pathname==='/api/releases'?[]:pathname===`/api/projects/${project.id}`?project:{};
      res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return;
    }
    if(pathname.startsWith('/media/export-')){res.setHeader('content-type','video/mp4');res.setHeader('content-length',media.length);res.end(media);return;}
    const file=resolve(root,pathname==='/'?'index.html':'.'+pathname);if(!file.startsWith(root+sep))throw Error('Outside fixture');
    let body=await readFile(file);if(pathname==='/app.js')body=Buffer.from(body.toString()+'\nwindow.__exportFixture={store,refresh,update:()=>updateDynamic()};\n');
    res.setHeader('content-type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(body);
  }catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(id=>{localStorage.setItem('vyrelum:selectedProject',id);window.exportMediaEvents=[];for(const event of ['play','pause','seeking','seeked','ended','error'])document.addEventListener(event,e=>{if(e.target instanceof HTMLVideoElement)exportMediaEvents.push({event,src:e.target.getAttribute('src'),time:e.target.currentTime});},true);},project.id);
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#refreshBtn:not(:disabled)').waitFor();await page.locator('.sidebar [data-nav="Export"]').click();
    const video=page.locator('video.media-preview').first();await video.waitFor();
    await video.evaluate(async v=>{v.muted=true;v.volume=.35;v.playbackRate=1.25;await v.play();});await page.waitForFunction(()=>document.querySelector('video.media-preview').currentTime>.4);
    state.assets.push({id:'export-b',projectId:project.id,name:'Completed export.mp4',kind:'video',mime:'video/mp4',url:'/media/export-b'});project.latestOutput.videoAssetId='export-b';project.latestOutput.jobId='job-b';project.revision=2;
    await page.evaluate(()=>__exportFixture.refresh());
    assert.equal(await video.getAttribute('src'),'/media/export-b');
    await page.waitForFunction(()=>{const v=document.querySelector('video.media-preview');return !v.paused&&v.currentTime>.15;},null,{timeout:2500});
    assert.equal(await video.evaluate(v=>v.muted),true);assert.equal(await video.evaluate(v=>v.volume),.35);assert.equal(await video.evaluate(v=>v.playbackRate),1.25);
    assert.match(await page.locator('.preview-update-notice').innerText(),/New export loaded.*restarted/);
    await page.waitForFunction(()=>document.querySelector('video.media-preview').ended,null,{timeout:6500});
    const completed=await video.evaluate(v=>({src:v.getAttribute('src'),duration:v.duration,currentTime:v.currentTime,ended:v.ended,decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames}));assert.equal(completed.ended,true);assert.ok(completed.decodedFrames>=90);
    // A changing project receipt must not rewind, re-seek or replace unchanged media.
    await video.evaluate(v=>{window.retainedExport=v;window.exportEventsBefore=exportMediaEvents.length;});project.revision=3;project.updatedAt='A changed receipt after playback';await page.evaluate(()=>__exportFixture.refresh());await page.waitForTimeout(150);
    assert.equal(await video.evaluate(v=>v===retainedExport),true);
    assert.deepEqual(await page.evaluate(()=>exportMediaEvents.slice(exportEventsBefore).filter(e=>e.event==='seeking')),[],'unchanged output refresh must not initiate a seek');
    assert.equal(await video.evaluate(v=>v.ended),true,'the completed playback state must survive a metadata update');
    // A deliberately paused player must stay paused when another output appears.
    state.assets.push({id:'export-c',projectId:project.id,name:'Next export.mp4',kind:'video',mime:'video/mp4',url:'/media/export-c'});project.latestOutput.videoAssetId='export-c';project.revision=4;await page.evaluate(()=>__exportFixture.refresh());await page.waitForTimeout(150);
    assert.equal(await video.evaluate(v=>v.paused&&v.currentTime===0),true);assert.equal(await video.evaluate(v=>v.muted),true);
    await video.evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video.media-preview').currentTime>.15);
    await page.evaluate(()=>{const {store}=__exportFixture;store.state.assets.push({id:'export-d',projectId:'other-project',name:'Other project.mp4',kind:'video',mime:'video/mp4',url:'/media/export-d'});store.project={...store.project,id:'other-project',latestOutput:{videoAssetId:'export-d',status:'review_required'}};__exportFixture.update();});await page.waitForTimeout(150);
    assert.equal(await video.evaluate(v=>v.paused&&v.currentTime===0),true,'switching projects must not autoplay another film');
    await page.locator('.sidebar [data-nav="Dashboard"]').click();await page.locator('.sidebar [data-nav="Export"]').click();assert.equal(await video.evaluate(v=>v.paused),true,'navigation back to Export requires an explicit play');
    assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'),'fixture must not write projects or queue work');
    await page.screenshot({path:join(directory,'export-refresh.png')});
    await writeFile(join(directory,'evidence.json'),JSON.stringify({passed:true,fixture:'Actual app and browser, isolated state, four-second FFmpeg test-pattern MP4; no model or canonical writes.',completed,checks:['new output resumes an already playing preview with a visible notice','mute, volume and playback speed retained','new asset completes and emits ended','same-source refresh preserves the media element without seek','ended state remains intact','paused preview is not autoplayed','different projects are not autoplayed','navigation back requires explicit play'],events:await page.evaluate(()=>exportMediaEvents),errors},null,2));
    console.log('Export playback evidence: '+directory);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
