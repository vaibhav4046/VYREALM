import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';

function authorizationUrl(){const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const[key,value]of Object.entries({client_id:'123-fixture.apps.googleusercontent.com',redirect_uri:'http://127.0.0.1:54321/oauth/youtube/callback',response_type:'code',scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',state:'s'.repeat(43),code_challenge:'c'.repeat(43),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account'}))url.searchParams.set(key,value);return url.href;}

test('YouTube onboarding browser journey protects current channel, handles consent failures and remains usable on mobile',{timeout:45000},async t=>{
 const script=await readFile(new URL('../youtube-settings.js',import.meta.url)),css=await readFile(new URL('../styles.css',import.meta.url));
 const proof=path.resolve('work/youtube-onboarding-ui-proof');await mkdir(proof,{recursive:true});
 let status={configured:false,connected:false,auth:{phase:'idle'}},verifyFailure=false;
 const calls=[],errors=[],browserRequests=[];
 const server=createServer(async(req,res)=>{
  if(req.url==='/youtube-settings.js'){res.setHeader('content-type','text/javascript');return res.end(script);}
  if(req.url==='/styles.css'){res.setHeader('content-type','text/css');return res.end(css);}
  if(req.url?.startsWith('/api/youtube/')){
   res.setHeader('content-type','application/json');let body={};if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;body=JSON.parse(text||'{}');}
   calls.push({method:req.method,path:req.url,...(req.url==='/api/youtube/config'?{configReceived:true}:req.method==='POST'?{body}:{})});
   if(req.url==='/api/youtube/status')return res.end(JSON.stringify(status));
   if(req.url==='/api/youtube/config'){assert.ok(body.installed.client_secret);status={configured:true,connected:false,auth:{phase:'idle'}};return res.end(JSON.stringify(status));}
   if(req.url==='/api/youtube/authorize'){assert.equal(status.connected,false);status={...status,auth:{phase:'pending'}};return res.end(JSON.stringify({authorizationUrl:authorizationUrl()}));}
   if(req.url==='/api/youtube/disconnect'){if(status.connected && body.expectedChannelId!==status.connectedChannel?.id){res.statusCode=409;return res.end(JSON.stringify({code:'YOUTUBE_CHANNEL_MISMATCH'}));}status={configured:true,connected:false,auth:{phase:'idle'}};return res.end(JSON.stringify(status));}
   if(req.url==='/api/youtube/verify'){status={...status,channelVerification:verifyFailure?{status:'failed',code:'YOUTUBE_TOKEN_REFRESH_FAILED'}:{status:'verified',checkedAt:'2026-09-08T12:00:00.000Z'}};return res.end(JSON.stringify(status));}
   res.statusCode=404;return res.end('{}');
  }
  if(req.url!=='/'){res.statusCode=404;return res.end();}
  res.setHeader('content-type','text/html');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{display:block;padding:24px}main{max-width:1100px;margin:auto;min-width:0}@media(max-width:650px){body{padding:12px}}</style><main id="fixture"></main><script type="module">import{createYouTubeSettings}from'/youtube-settings.js';window.opens=0;let controller;const paint=()=>{document.querySelector('#fixture').innerHTML=controller.html();controller.bind();};controller=createYouTubeSettings({api:async(p,o)=>{const r=await fetch('/api'+p,o);const data=await r.json();if(!r.ok)throw Object.assign(Error('Redacted fixture error'),{code:data.code});return data;},render:paint,openExternal:async()=>++window.opens>1});window.controller=controller;paint();</script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>browserRequests.push(request.url()));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('#youtubeCredentials:not([disabled])').waitFor();assert.equal(await page.locator('#youtubeConnect').isDisabled(),true);
 assert.equal(await page.locator('#youtubeDeveloper').evaluate(el=>el.open),true);
 await page.screenshot({path:path.join(proof,'desktop-first-install.png'),fullPage:true});
 await page.locator('#youtubeCredentials').setInputFiles({name:'wrong-web.json',mimeType:'application/json',buffer:Buffer.from('{"web":{"client_id":"wrong"}}')});
 await page.getByRole('alert').filter({hasText:'Could not import'}).waitFor();assert.equal(calls.filter(c=>c.path==='/api/youtube/config').length,0);
 await page.locator('#youtubeCredentials').setInputFiles({name:'desktop.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({installed:{client_id:'123-fixture.apps.googleusercontent.com',client_secret:'FIXTURE_PRIVATE_NEVER_RENDER'}}))});
 await page.locator('#youtubeConnect:not([disabled])').waitFor();assert.equal(await page.locator('#youtubeAnalyticsPermission').isChecked(),false);
 assert.equal(await page.locator('#youtubeCredentials').inputValue(),'');
 await page.locator('#youtubeConnect').focus();await page.keyboard.press('Enter');
 await page.getByText(/fresh click/).waitFor();assert.deepEqual(calls.find(c=>c.path==='/api/youtube/authorize').body,{features:['upload']});
 await page.locator('#youtubeOpenBrowser').focus();await page.keyboard.press('Enter');
 await page.getByText('Finish authorization in your system browser, then return here.').waitFor();assert.equal(await page.evaluate(()=>window.opens),2);
 assert.equal(calls.filter(c=>c.path==='/api/youtube/authorize').length,1);
 await page.reload();await page.getByText(/Waiting for authorization/).waitFor();assert.equal(await page.locator('#youtubeConnect').isDisabled(),true);assert.equal(await page.locator('#youtubeOpenBrowser').count(),0);
 await page.locator('#youtubeDisconnect').click();await page.locator('#youtubeConnect:not([disabled])').waitFor();assert.deepEqual(calls.find(c=>c.path==='/api/youtube/disconnect').body,{});
 await page.locator('#youtubeConnect').click();await page.getByText(/Waiting for authorization/).waitFor();
 status={configured:true,connected:false,auth:{phase:'failed',code:'YOUTUBE_AUTH_DENIED'}};
 await page.getByText(/Google permission was declined/).waitFor({timeout:6000});
 assert.equal(await page.locator('#youtubeConnect').isDisabled(),false);
 status={configured:true,connected:false,auth:{phase:'failed',code:'YOUTUBE_AUTH_EXPIRED'}};await page.evaluate(()=>controller.update());await page.getByText(/attempt expired/).waitFor();
 const channelTitle='The very long original creator channel — '+ 'Science journeys and thoughtful filmmaking '.repeat(8);
 status={configured:true,connected:true,connectedChannel:{id:'UC_OWN_CHANNEL_12345678901',title:channelTitle},upload:'authorized-not-verified',analytics:'consent-required',auth:{phase:'connected'}};
 await page.evaluate(()=>controller.update());await page.locator('.yt-channel').waitFor();assert.equal(await page.locator('#youtubeCredentials').isDisabled(),true);
 await page.locator('#youtubeRefresh').click();await page.getByText('Confirmed with YouTube',{exact:true}).waitFor();
 await page.screenshot({path:path.join(proof,'desktop-own-channel-verified.png'),fullPage:true});
 const before=calls.filter(c=>c.method==='POST').length;
 await page.locator('#youtubeConnect').click();await page.locator('#youtubeConfirmDisconnect').waitFor();assert.equal(calls.filter(c=>c.method==='POST').length,before);
 await page.waitForFunction(()=>document.activeElement?.id==='youtubeKeepChannel');await page.keyboard.press('Enter');assert.equal(await page.locator('#youtubeConfirmDisconnect').count(),0);
 await page.locator('#youtubeConnect').click();await page.locator('#youtubeAnalyticsPermission').check();
 await page.locator('#youtubeConfirmDisconnect').focus();await page.keyboard.press('Enter');await page.getByText(/Waiting for authorization/).waitFor();
 assert.deepEqual(calls.filter(c=>c.method==='POST').slice(-2).map(c=>[c.path,c.body]),[['/api/youtube/disconnect',{expectedChannelId:'UC_OWN_CHANNEL_12345678901'}],['/api/youtube/authorize',{features:['upload','analytics']}]]);
 status={configured:true,connected:true,connectedChannel:{id:'UC_NEW_CHANNEL_12345678901',title:channelTitle},upload:'authorized-not-verified',analytics:'authorized-not-verified',auth:{phase:'connected'}};
 await page.evaluate(()=>controller.update());verifyFailure=true;await page.locator('#youtubeRefresh').click();await page.getByText(/could not renew access/).waitFor();
 const beforeStale=calls.filter(c=>c.path==='/api/youtube/disconnect').length;await page.locator('#youtubeDisconnect').click();
 status={...status,connectedChannel:{id:'UC_CHANGED_CHANNEL_1234567',title:channelTitle}};
 await page.locator('#youtubeConfirmDisconnect').click();await page.getByRole('alert').filter({hasText:'connected channel changed'}).waitFor();assert.equal(calls.filter(c=>c.path==='/api/youtube/disconnect').length,beforeStale);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(proof,'mobile-long-channel-recovery.png'),fullPage:true});
 assert.equal(await page.locator('.yt-channel strong').innerText(),channelTitle.trim());
 const pageState=await page.evaluate(()=>JSON.stringify({html:document.body.innerHTML,local:{...localStorage},session:{...sessionStorage}}));
 assert.doesNotMatch(pageState,/FIXTURE_PRIVATE_NEVER_RENDER|123-fixture\.apps|code_challenge=|state=ssss/);
 assert.deepEqual(errors,[]);assert.equal(browserRequests.some(url=>new URL(url).hostname==='accounts.google.com'),false);
 await writeFile(path.join(proof,'evidence.json'),JSON.stringify({scope:'Isolated browser and API fixtures; no live account, credentials, consent or channel changed',checks:['missing configuration and Desktop-only import','credentials absent from DOM and browser storage','upload-only default; analytics opt-in','blocked opener retries same sign-in on explicit keyboard gesture','pending reload and cancellation','denied and expired consent recovery','explicit live verification status','named reconnect confirmation and keep action','exact channel bound disconnect before authorization','stale confirmation cannot remove another channel','revoked-access guidance','390px layout and long channel title','keyboard focus and activation'],calls,errors,externalGoogleRequests:0},null,2));
 await page.evaluate(()=>controller.dispose());
});
