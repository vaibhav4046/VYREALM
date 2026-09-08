import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineSegments, locateTimelineTime, validateClipEdit, splitTimelineClip, moveTimelineClip, remapTimelineCaptions, createTimelineEditor } from '../timeline-editor.js';

const clips = [{ id:'a',assetId:'source',kind:'video',trimStart:2,duration:3,caption:'First' },{ id:'b',assetId:'other',kind:'video',trimStart:10,duration:5,caption:'' }];
test('cumulative timeline maps clip boundaries and source trim positions exactly',()=>{
  assert.deepEqual(timelineSegments(clips).map(s=>[s.start,s.end]),[[0,3],[3,8]]);
  assert.equal(locateTimelineTime(clips,1.25).sourceTime,3.25);
  assert.equal(locateTimelineTime(clips,3).clip.id,'b');
  assert.equal(locateTimelineTime(clips,3).sourceTime,10);
  assert.equal(locateTimelineTime(clips,999).sourceTime,15);
  assert.equal(locateTimelineTime(clips,-5).position,0);
  assert.equal(locateTimelineTime([],1),null);
});
test('split preserves source coverage, clip data, total length and frame alignment',()=>{
  const result=splitTimelineClip(clips,'a',1.21,'split',24);
  assert.equal(result.length,3);assert.equal(result[0].duration,29/24);
  assert.equal(result[1].trimStart,2+29/24);
  assert.equal(result[1].caption,'First');assert.equal(result[2],clips[1]);
  assert.equal(timelineSegments(result).at(-1).end,8);
  assert.throws(()=>splitTimelineClip(clips,'a',0,'split'),/inside/);
  assert.throws(()=>splitTimelineClip(clips,'a',3,'split'),/inside/);
  assert.throws(()=>splitTimelineClip(clips,'a',1,'a'),/Select/);
  assert.equal(clips[0].duration,3,'source sequence remains immutable');
});
test('clip edits validate real media bounds and finite duration',()=>{
  assert.equal(validateClipEdit(clips[0],{trimStart:3,duration:2},5).duration,2);
  assert.throws(()=>validateClipEdit(clips[0],{trimStart:4,duration:2},5),/source ends/);
  for(const duration of [0,-2,Infinity,NaN])assert.throws(()=>validateClipEdit(clips[0],{duration},5));
  assert.throws(()=>validateClipEdit(clips[0],{trimStart:-1},5));
  assert.equal(validateClipEdit({...clips[0],kind:'image'},{duration:20},5).duration,20);
});
test('reordering retains source trims and captions without mutating inputs',()=>{
  const after=moveTimelineClip(clips,'b',-1);assert.deepEqual(after.map(c=>c.id),['b','a']);assert.equal(after[0].trimStart,10);assert.deepEqual(clips.map(c=>c.id),['a','b']);
  assert.deepEqual(moveTimelineClip(clips,'a',-1),clips);
  const cues=remapTimelineCaptions(clips,after,[{start:0.5,end:2,text:'A'},{start:4,end:6,text:'B'}]);
  assert.deepEqual(cues,[{start:1,end:3,text:'B'},{start:5.5,end:7,text:'A'}]);
});
test('timed captions follow source trims and split only at the new cut',()=>{
  const split=splitTimelineClip(clips,'a',1.5,'split');
  const mapped=remapTimelineCaptions(clips,split,[{start:1,end:2,text:'Across cut'},{start:4,end:6,text:'B'}],{split:'a'});
  assert.deepEqual(mapped,[{start:1,end:1.5,text:'Across cut'},{start:1.5,end:2,text:'Across cut'},{start:4,end:6,text:'B'}]);
  const trimmed=[{...clips[0],trimStart:3,duration:2},clips[1]];
  assert.deepEqual(remapTimelineCaptions(clips,trimmed,[{start:0,end:0.8,text:'Removed'},{start:1,end:2.5,text:'Kept'},{start:4,end:6,text:'B'}]),[{start:0,end:1.5,text:'Kept'},{start:3,end:5,text:'B'}]);
});
test('editor uses actual media and only existing audio/caption tracks',()=>{
  const store={project:{id:'p',revision:2,name:'<unsafe>',timeline:[{...clips[0],caption:''}],settings:{fps:24}},state:{assets:[{id:'source',name:'Camera original',kind:'video',metadata:{duration:9}}]},selectedClip:'a'};
  const editor=createTimelineEditor({store,saveProject:async()=>true});
  const html=editor.html();assert.match(html,/id="tleVideo"/);assert.match(html,/flex:0 0 168px/);assert.doesNotMatch(html,/tle-audio-track|tle-caption-track/);assert.match(html,/&lt;unsafe&gt;/);assert.doesNotMatch(html,/data-clip=|data-field=/);
  store.project.transcript=[{start:0,end:2,text:'Original words'}];store.state.assets[0].metadata.hasAudio=true;
  const actual=editor.html();assert.match(actual,/tle-audio-track/);assert.match(actual,/tle-caption-track/);assert.match(actual,/Original words/);editor.dispose();
});

test('browser edits real source MP4, preserves trims across consecutive playback, saves and exports', {skip:process.env.VYREALM_TIMELINE_BROWSER_TEST!=='1',timeout:90000}, async()=>{
  const [{chromium},{createServer},{readFile,mkdir,writeFile},{resolve,join},{execFile},{promisify}]=await Promise.all([import('@playwright/test'),import('node:http'),import('node:fs/promises'),import('node:path'),import('node:child_process'),import('node:util')]);
  const directory=resolve('work/timeline-editor-proof',String(Date.now()));await mkdir(directory,{recursive:true});
  const mediaPath=join(directory,'source.mp4');await promisify(execFile)(resolve('workers/tools/ffmpeg.exe'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-shortest',mediaPath],{windowsHide:true,timeout:30000});
  const inputMedia=process.env.VYREALM_TIMELINE_SOURCE_FILE||mediaPath,mediaType=inputMedia.endsWith('.webm')?'video/webm':'video/mp4';
  const [module,media]=await Promise.all([readFile(resolve('timeline-editor.js')),readFile(inputMedia)]);
  const pageHtml=`<!doctype html><meta charset="utf-8"><style>body{background:#151219;color:#eee;font:16px sans-serif}button,input,textarea{margin:4px}.tle-main{display:flex}.tle-preview{width:65%}.tle-monitor{position:relative}video,img{width:100%;max-height:350px}.tle-inspector{width:30%}.field{display:block}.tle-scroll{overflow:auto;max-width:100%}.tle-clip{display:flex;flex-direction:column}.tle-caption{position:absolute;bottom:35px;left:20px;background:#0009;padding:8px}.tle-playhead{border-left:2px solid #f90} [hidden]{display:none}</style><main id="host"></main><script type="module">
    import{createTimelineEditor}from'/timeline-editor.js';
    window.errors=[];window.exports=0;window.saved=0;window.saveWait=false;
    window.store={project:{id:'p',revision:1,name:'Actual source fixture',timeline:[{id:'a',assetId:'source',kind:'video',trimStart:0.5,duration:0.8,caption:'',muted:true},{id:'b',assetId:'source',kind:'video',trimStart:2,duration:0.8,caption:'',muted:true}],transcript:[{start:0,end:0.8,text:'First'},{start:0.8,end:1.6,text:'Second'}],settings:{fps:24}},state:{assets:[{id:'source',name:'Source.mp4',kind:'video',metadata:{duration:4,hasAudio:true}}]},selectedClip:'a',dirty:false};
    window.editor=createTimelineEditor({store,onError:e=>errors.push(e.message),saveProject:async()=>{const project=store.project;saved++;if(saveWait)await new Promise(r=>window.resolveSave=r);project.revision++;if(store.project===project)store.dirty=false;return true;},onExport:async()=>exports++});
    document.querySelector('#host').innerHTML=editor.html();editor.bind();
  </script>`;
  const server=createServer((req,res)=>{if(req.url==='/timeline-editor.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(module);}else if(req.url==='/media/source'){const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);if(range){const start=Number(range[1]),end=range[2]?Number(range[2]):media.length-1;res.writeHead(206,{'content-type':mediaType,'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${media.length}`,'content-length':end-start+1});res.end(media.subarray(start,end+1));}else{res.writeHead(200,{'content-type':mediaType,'content-length':media.length,'accept-ranges':'bytes'});res.end(media);}}else{res.writeHead(200,{'content-type':'text/html'});res.end(pageHtml);}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:850}});const pageErrors=[],frameChecks=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#tleVideo').waitFor();await page.waitForFunction(()=>document.querySelector('#tleVideo').readyState>=2);assert.ok(Math.abs(await page.locator('#tleVideo').evaluate(v=>v.currentTime)-0.5)<0.05);
    const inspectFrame=async step=>{await page.waitForFunction(()=>document.querySelector('#vyTimelineEditor')?.dataset.previewState==='ready'&&!document.querySelector('#tleVideo').seeking);const result=await page.locator('#tleVideo').evaluate(v=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;const c=canvas.getContext('2d');c.drawImage(v,0,0,64,36);const pixels=c.getImageData(0,0,64,36).data;let visible=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]>45)visible++;return{readyState:v.readyState,time:v.currentTime,visiblePixelRatio:visible/(64*36)};});assert.ok(result.visiblePixelRatio>0.2,`${step}: source monitor must contain a decoded frame, ${JSON.stringify(result)}`);frameChecks.push({step,...result});};
    await inspectFrame('initial trim');await page.evaluate(()=>window.originalPreview=document.querySelector('#tleVideo'));
    await page.locator('#tlePlay').click();await page.waitForFunction(()=>document.querySelector('#tleTime').textContent.startsWith('00:01.60'),{timeout:10000});assert.equal(await page.locator('#tlePlay').textContent(),'Play');assert.ok((await page.locator('#tleVideo').evaluate(v=>v.currentTime))>=2.7,'second clip must seek to its real source start');
    await page.locator('#tleStart').click();await page.locator('#tleScrub').focus();await page.keyboard.press('Home');for(let n=0;n<10;n++)await page.keyboard.press('ArrowRight');await page.locator('#tleSplit').click();assert.equal(await page.locator('[data-tle-clip]').count(),3);
    assert.ok(Math.abs(await page.evaluate(()=>store.project.timeline[1].trimStart)-0.5-10/24)<0.001);await page.locator('#tleUndo').click();assert.equal(await page.locator('[data-tle-clip]').count(),2);
    await page.locator('#tleDuration').fill('99');await page.locator('#tleApply').click();assert.equal(await page.evaluate(()=>store.project.timeline[0].duration),0.8);assert.match(await page.evaluate(()=>errors.pop()),/source ends/);
    await page.locator('#tleDuration').fill('0.6');await page.locator('#tleClipCaption').fill('Revised words');await page.locator('#tleApply').click();assert.equal(await page.evaluate(()=>store.project.timeline[0].duration),0.6);assert.equal(await page.evaluate(()=>store.project.transcript[0].text),'Revised words');assert.equal(await page.evaluate(()=>store.dirty),true);
    await page.locator('#tleLater').click();assert.deepEqual(await page.evaluate(()=>store.project.timeline.map(c=>c.id)),['b','a']);await inspectFrame('reorder');assert.equal(await page.evaluate(()=>document.querySelector('#tleVideo')===originalPreview),true,'same-source redraw must preserve the decoded video element');await page.locator('#tleUndo').click();assert.deepEqual(await page.evaluate(()=>store.project.timeline.map(c=>c.id)),['a','b']);
    await page.locator('#tleExport').click();await page.waitForFunction(()=>exports===1);assert.equal(await page.evaluate(()=>saved),1);assert.equal(await page.evaluate(()=>store.dirty),false);
    await inspectFrame('save');await page.locator('[data-tle-clip]').nth(1).click();await inspectFrame('clip selection');await page.screenshot({path:join(directory,'timeline-editor-desktop.png'),fullPage:true});assert.deepEqual(pageErrors,[]);assert.deepEqual(await page.evaluate(()=>errors),[]);await writeFile(join(directory,'evidence.json'),JSON.stringify({passed:true,source:inputMedia,sourcePurpose:'Existing video or FFmpeg test fixture, not neural generation',steps:['real media metadata','trimmed sequential playback','split/undo','bounds rejection','caption and duration changes','reorder/undo','save then export','visible frame after save/select/reorder'],frameChecks,pageErrors},null,2));
    await page.evaluate(()=>{saveWait=true;});await page.locator('#tleExport').click();assert.equal(await page.locator('#tleApply').isDisabled(),true);await page.evaluate(()=>{store.project={id:'other',revision:10,timeline:[]};editor.updateStatus();resolveSave();});await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>exports),1,'late save must not export a different selected project');assert.equal(await page.evaluate(()=>store.project.revision),10);assert.deepEqual(await page.evaluate(()=>errors),[]);
    console.log(`Timeline browser evidence: ${directory}`);
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
});
