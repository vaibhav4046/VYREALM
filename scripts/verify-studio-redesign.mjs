import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const directory=new URL('../outputs/verification/studio-redesign/',import.meta.url);await mkdir(directory,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[];const observations=[];
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
page.on('pageerror',error=>errors.push(error.message));
const noOverflow=async name=>{const sizes=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));assert.ok(sizes.page<=sizes.viewport+1,`${name} horizontally overflows: ${JSON.stringify(sizes)}`);observations.push({name,...sizes});};
try{
 await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('#refreshBtn:not(:disabled)').waitFor({timeout:90000});
 await page.locator('.sidebar [data-nav="Dashboard"]').click();
 await page.locator('.production-hero').waitFor();
 await noOverflow('Dashboard 1440');
 assert.equal(await page.locator('.sidebar [data-nav]').count(),15);
 await page.screenshot({path:new URL('dashboard-1440.png',directory).pathname.replace(/^\/([A-Z]:)/,'$1')});
 await page.locator('.workspace-switcher [data-workspace="creator"]').click();
 assert.equal(await page.locator('.workspace-switcher [data-workspace="creator"]').getAttribute('aria-pressed'),'true');
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#refreshBtn:not(:disabled)').waitFor({timeout:90000});
 assert.equal(await page.locator('.workspace-switcher [data-workspace="creator"]').getAttribute('aria-pressed'),'true');
 observations.push({name:'Workspace choice persists on reload',passed:true});
 await page.locator('.workspace-switcher [data-workspace="film"]').click();
 await page.locator('.sidebar [data-nav="Dashboard"]').click();
 await page.setViewportSize({width:390,height:844});
 await noOverflow('Dashboard 390');
 assert.equal(await page.locator('#sidebar').evaluate(el=>el.inert),true);
 await page.locator('#menuBtn').click();assert.equal(await page.locator('#mainContent').evaluate(el=>el.inert),true);
 await page.screenshot({path:new URL('navigation-390.png',directory).pathname.replace(/^\/([A-Z]:)/,'$1')});
 await page.keyboard.press('Escape');assert.equal(await page.locator('#menuBtn').getAttribute('aria-expanded'),'false');
 await page.locator('#bottomMenuBtn').click();await page.locator('#sidebarBackdrop').click({position:{x:375,y:160}});assert.equal(await page.locator('#sidebar').evaluate(el=>el.inert),true);
 await page.locator('#menuBtn').click();await page.locator('#closeMenuBtn').click();assert.equal(await page.locator('#mainContent').evaluate(el=>el.inert),false);
 assert.equal(await page.locator('.mobile-bottom-nav button').count(),4);
 await page.screenshot({path:new URL('dashboard-390.png',directory).pathname.replace(/^\/([A-Z]:)/,'$1')});
 observations.push({name:'Mobile drawer Escape, outside click, close, inert state and four navigation actions',passed:true});
 for(const view of ['Create','Production plan','Timeline','Assets','Jobs','Catalog']){
  await page.locator('#menuBtn').click();await page.locator(`.sidebar [data-nav="${view}"]`).click();await noOverflow(view+' 390');
 }
 await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>!document.querySelector('#sidebar').inert);assert.equal(await page.locator('#sidebar').evaluate(el=>el.inert),false);
 await page.locator('.sidebar [data-nav="Studio chat"]').click();
 observations.push({name:'Studio chat module',available:await page.locator('.studio-chat-shell').count()>0});
 await writeFile(new URL('browser-check.json',directory),JSON.stringify({date:new Date().toISOString(),observations,errors},null,2));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,observations,errors}));
}catch(error){await writeFile(new URL('browser-check-failure.json',directory),JSON.stringify({date:new Date().toISOString(),failure:error.message,observations,errors},null,2));throw error;}finally{await browser.close();}
