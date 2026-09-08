import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname, sep } from 'node:path';

test('Audio refreshes delayed narration and captions without replacing focused drafts', {skip:process.env.VYREALM_AUDIO_BROWSER_TEST!=='1',timeout:60000}, async()=>{
  const {chromium}=await import('@playwright/test');
  const root=resolve('.'), directory=join(root,'work/audio-workspace-proof',String(Date.now()));await mkdir(directory,{recursive:true});
  const project={id:'audio-refresh-fixture',name:'Solar audio fixture',revision:1,mode:'creator',brief:'An original science short.',narrationText:'Watch the Sun move.',transcript:[],captionsEnabled:true,timeline:[],settings:{width:1080,height:1920,fps:24}};
  const state={projects:[project],assets:[{id:'source-video',projectId:project.id,name:'Solar source.mp4',kind:'video',mime:'video/mp4',url:'/media/source-video'}],jobs:[],capabilities:[],flagships:[],features:{}};
  const requests=[], errors=[];
  // Tiny PCM test audio verifies the browser playback element, not model inference.
  const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);
  const server=createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    if(pathname.startsWith('/api/')){
      let body='';for await(const chunk of req)body+=chunk;
      if(req.method==='POST'&&pathname==='/api/audio/transcribe'){
        requests.push(JSON.parse(body));state.jobs=[{id:'transcription-fixture',type:'transcribe',projectId:project.id,status:'queued',progress:0}];
        res.setHeader('content-type','application/json');res.end(JSON.stringify(state.jobs[0]));return;
      }
      const data=pathname==='/api/state'?state:pathname==='/api/session'?{token:'isolated-ui-fixture'}:pathname==='/api/jobs'?state.jobs:pathname==='/api/releases'?[]:pathname===`/api/projects/${project.id}`?project:{};
      res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return;
    }
    if(pathname.startsWith('/media/narration-')){res.setHeader('content-type','audio/wav');res.end(wav);return;}
    const file=resolve(root,pathname==='/'?'index.html':'.'+pathname);if(!file.startsWith(root+sep))throw Error('Outside fixture');
    let body=await readFile(file);if(pathname==='/app.js')body=Buffer.from(body.toString()+'\nwindow.__audioFixture={store,refresh,render};\n');
    res.setHeader('content-type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(body);
  }catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1365,height:950}});page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(id=>localStorage.setItem('vyrelum:selectedProject',id),project.id);
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-nav="Audio"]').first().click();await page.locator('#transcribeAsset').waitFor();
    await page.evaluate(()=>{window.savedAudioNodes={panel:document.querySelector('#localAudioPanel'),select:document.querySelector('#transcribeAsset'),narration:document.querySelector('#narrationText')};});
    await page.locator('#transcribeAsset').focus();
    state.assets.push({id:'narration-1',projectId:project.id,name:'Local narration.wav',kind:'audio',mime:'audio/wav',url:'/media/narration-1'});project.latestAudio={assetId:'narration-1'};project.revision=2;
    await page.evaluate(()=>__audioFixture.refresh());
    assert.equal(await page.locator('#transcribeAsset option[value="narration-1"]').count(),1,'completed narration must arrive while SELECT remains focused');
    assert.equal(await page.evaluate(()=>document.activeElement===savedAudioNodes.select&&document.querySelector('#localAudioPanel')===savedAudioNodes.panel),true);
    await page.waitForFunction(()=>document.querySelector('audio[aria-label="Generated local narration"]')?.readyState>=2);
    await page.locator('#transcribeAsset').selectOption('narration-1');await page.locator('#transcribeMedia').click();
    await page.waitForFunction(()=>document.querySelector('[data-nav="Jobs"]')?.classList.contains('active'));
    assert.deepEqual(requests,[{projectId:project.id,expectedRevision:2,assetId:'narration-1'}]);
    state.jobs[0].status='succeeded';project.revision=3;project.transcript=[{start:0,end:1.4,text:'Watch the Sun move.'}];
    await page.locator('[data-nav="Audio"]').first().click();await page.evaluate(()=>__audioFixture.refresh());
    assert.equal(await page.getByLabel('Caption 1 text',{exact:true}).inputValue(),'Watch the Sun move.');
    await page.evaluate(()=>window.savedAudioNodes.audio=document.querySelector('audio[aria-label="Generated local narration"]'));
    await page.locator('#narrationText').fill('My unfinished narration draft');
    await page.getByLabel('Caption 1 text',{exact:true}).fill('Keep my caption correction');
    await page.getByLabel('Caption 1 text',{exact:true}).evaluate(el=>{el.focus();el.setSelectionRange(5,5);window.captionDraftNode=el;});
    state.assets.push({id:'narration-2',projectId:project.id,name:'Second local narration.wav',kind:'audio',mime:'audio/wav',url:'/media/narration-2'});project.latestAudio={assetId:'narration-2'};project.revision=4;
    await page.evaluate(()=>__audioFixture.refresh());
    assert.equal(await page.locator('#transcribeAsset option[value="narration-2"]').count(),1);
    assert.equal(await page.locator('#transcribeAsset').inputValue(),'narration-1','retain the user-selected transcription source');
    assert.equal(await page.locator('#narrationText').inputValue(),'My unfinished narration draft');
    assert.equal(await page.getByLabel('Caption 1 text',{exact:true}).inputValue(),'Keep my caption correction');
    assert.equal(await page.evaluate(()=>document.activeElement===captionDraftNode&&captionDraftNode.selectionStart===5),true,'caption focus and caret must survive polling');
    assert.equal(await page.locator('audio[aria-label="Generated local narration"]').getAttribute('src'),'/media/narration-2');
    await page.evaluate(()=>window.currentAudio=document.querySelector('audio[aria-label="Generated local narration"]'));await page.evaluate(()=>__audioFixture.refresh());
    assert.equal(await page.evaluate(()=>document.querySelector('audio[aria-label="Generated local narration"]')===currentAudio),true,'unchanged playback must not be replaced on each poll');
    assert.equal(await page.evaluate(()=>__audioFixture.store.dirty),true);assert.deepEqual(errors,[]);
    await page.screenshot({path:join(directory,'audio-delayed-assets.png'),fullPage:true});
    await writeFile(join(directory,'evidence.json'),JSON.stringify({passed:true,fixture:'Actual app.js and modules; isolated HTTP state and transcription queue; tiny PCM playback fixture; no real models or canonical data touched',checks:['focused select receives completed narration','existing panel and focused controls retained','browser decodes narration audio','transcribe request names the new asset and current revision','completed transcription appears','dirty narration and caption drafts preserved','caption caret retained','explicit transcription selection retained','new narration preview updates','unchanged audio element retained'],requests,pageErrors:errors},null,2));
    console.log(`Audio workspace evidence: ${directory}`);
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
