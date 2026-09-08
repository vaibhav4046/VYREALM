import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_TEMPLATE_PRESETS, templateDraft, validateTemplateDraft, createTemplateProjectFlow, createCreatorTemplates } from '../creator-templates.js';
import { CREATOR_WORKFLOWS, validateCreatorWorkflowInput, buildCreatorWorkflowPlan } from './creator-workflow.mjs';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

test('six presets match actual workflows and default to media upload without model calls',()=>{
 assert.deepEqual(CREATOR_TEMPLATE_PRESETS.map(p=>p.id),CREATOR_WORKFLOWS.map(p=>p.id));
 for(const preset of CREATOR_TEMPLATE_PRESETS){const v=validateTemplateDraft(templateDraft(preset.id));assert.equal(v.sourceMode,'uploaded-media');assert.equal(v.narrationMode,'none');assert.deepEqual(preset.sourceModes,[...CREATOR_WORKFLOWS.find(w=>w.id===preset.id).sourceModes]);assert.ok(preset.requirements.length);}
});
test('draft validation rejects invalid settings and unsupported workflow/source combinations',()=>{
 const v=templateDraft('talking-head');
 for(const patch of [{name:''},{brief:''},{durationSeconds:0},{durationSeconds:601},{durationSeconds:NaN},{aspect:'4K'},{sourceMode:'local-generation'},{narrationMode:'cloud'},{captionsEnabled:'true'},{extra:'ignored?' }])assert.throws(()=>validateTemplateDraft({...v,...patch}));
 assert.throws(()=>templateDraft('invented'));assert.equal(validateTemplateDraft({...v,name:'  My interview  '}).name,'My interview');
});
function fixture({failPlan=false,conflict=false}={}){
 let saved=null,creates=0,plans=0;const calls=[];
 const api=async(endpoint,options={})=>{const body=options.body&&JSON.parse(options.body);calls.push({endpoint,body,method:options.method||'GET'});
  if(endpoint==='/projects'){creates++;saved={...body,id:'project-1',revision:1};return saved;}
  if(endpoint==='/projects/project-1'){if(conflict)saved={...saved,revision:4};return saved;}
  if(endpoint==='/creator/workflows/plan'){plans++;if(failPlan&&plans===1)throw new Error('Temporary plan save failure');const input=validateCreatorWorkflowInput(body),plan=buildCreatorWorkflowPlan({input,project:saved});saved={...saved,revision:plan.revision,creatorWorkflow:plan};return{project:saved,plan};}
  throw new Error('Unexpected endpoint '+endpoint);
 };return{api,calls,counts:()=>({creates,plans}),project:()=>saved};
}
test('creating a template saves the exact editable draft and aspect through the real workflow schema',async()=>{
 const f=fixture(),flow=createTemplateProjectFlow({api:f.api}),value={...templateDraft('faceless'),name:'Ocean questions',brief:'Explain tides using my recorded shoreline clips.',durationSeconds:45,aspect:'9:16',captionsEnabled:true,narrationMode:'piper'};
 const result=await flow.submit(value);assert.equal(result.project.revision,2);assert.equal(result.plan.inputs.brief,value.brief);assert.equal(result.plan.inputs.durationSeconds,45);assert.equal(result.plan.inputs.narrationMode,'piper');assert.equal(result.plan.inputs.captionsEnabled,true);assert.deepEqual(result.project.settings,{width:1080,height:1920,fps:24});assert.equal(result.plan.mediaGenerated,false);assert.equal(result.plan.inputs.assetIds.length,0);assert.equal(flow.state().status,'saved');assert.equal(f.calls.length,2);
});
test('a failed plan retains its created project and retries that ID with the current revision',async()=>{
 const f=fixture({failPlan:true,conflict:true}),flow=createTemplateProjectFlow({api:f.api}),value=templateDraft('tutorial');await assert.rejects(flow.submit(value),/Temporary/);assert.equal(flow.state().project.id,'project-1');assert.equal(flow.state().status,'plan-failed');const result=await flow.retry();assert.equal(result.project.revision,5);assert.deepEqual(f.counts(),{creates:1,plans:2});assert.equal(f.calls.at(-1).body.expectedRevision,4);
});
test('repeated submits never create duplicates after success or while a request is in flight',async()=>{
 const f=fixture(),flow=createTemplateProjectFlow({api:f.api}),v=templateDraft('social-recut');const [a,b]=await Promise.all([flow.submit(v),flow.submit(v)]);assert.equal(a.project.id,b.project.id);await flow.submit(v);assert.equal(f.counts().creates,1);
});
test('an ambiguous creation error cannot silently create a second project',async()=>{
 let calls=0;const flow=createTemplateProjectFlow({api:async()=>{calls++;throw new Error('Connection lost');}});await assert.rejects(flow.submit(templateDraft('cinematic')));await assert.rejects(flow.retry(),/creation|created|project/i);assert.equal(calls,1);assert.equal(flow.state().status,'creation-uncertain');
});
test('retry recognizes a plan already committed before a response was lost',async()=>{
 const f=fixture(),base=f.api;let lost=true;const flow=createTemplateProjectFlow({api:async(...args)=>{const value=await base(...args);if(args[0]==='/creator/workflows/plan'&&lost){lost=false;throw new Error('response lost');}return value;}});await assert.rejects(flow.submit(templateDraft('product-ad')));const result=await flow.retry();assert.equal(result.project.revision,2);assert.deepEqual(f.counts(),{creates:1,plans:1});
});
test('a plan response cannot switch the retained project identity',async()=>{
 const f=fixture(),base=f.api,flow=createTemplateProjectFlow({api:async(...args)=>{const result=await base(...args);return args[0]==='/creator/workflows/plan'?{...result,project:{...result.project,id:'another-project'}}:result;}});await assert.rejects(flow.submit(templateDraft('cinematic')),/project|match/i);assert.equal(flow.state().project.id,'project-1');assert.equal(flow.state().status,'plan-failed');
});
test('picker HTML exposes labelled inputs, plain plan previews and source requirements',()=>{
 const picker=createCreatorTemplates({store:{state:{projects:[]}},api:async()=>{throw new Error('not called');}}),html=picker.html();assert.equal((html.match(/data-template-select=/g)||[]).length,6);assert.match(html,/Create project from template/);assert.match(html,/aria-live="polite"/);for(const id of ['ctName','ctBrief','ctDuration','ctAspect','ctSource','ctNarration','ctCaptions'])assert.match(html,new RegExp(`id="${id}"`));assert.doesNotMatch(html,/<video|<img/);assert.match(html,/No media is generated/);picker.dispose();
});

test('isolated browser creates a saved plan, retries without duplicates, preserves drafts and fits mobile',async t=>{
 const script=await readFile(new URL('../creator-templates.js',import.meta.url)),css=await readFile(new URL('../creator-templates.css',import.meta.url));let saved=null,creates=0,plans=0,callbacks=0;const requests=[],errors=[];
 const server=createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/creator-templates.js'||req.url==='/creator-templates.css'){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':'text/css'});return res.end(req.url.endsWith('.js')?script:css);}
  if(req.url.startsWith('/api/')){try{const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;requests.push({url:req.url,method:req.method,body});if(req.url==='/api/projects'&&req.method==='POST'){creates++;saved={...body,id:'fixture-project',revision:1};return send(201,saved);}if(req.url==='/api/projects/fixture-project')return send(200,saved);if(req.url==='/api/creator/workflows/plan'){plans++;if(plans===1)return send(503,{error:'Fixture disk retry'});const plan=buildCreatorWorkflowPlan({input:body,project:saved});saved={...saved,revision:plan.revision,creatorWorkflow:plan};return send(201,{project:saved,plan});}if(req.url==='/api/opened'){callbacks++;return send(200,{ok:true});}return send(404,{error:'Unknown fixture route'});}catch(e){return send(500,{error:e.message});}}
  res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Template picker fixture</title><link rel="stylesheet" href="/creator-templates.css"><style>body{margin:0;padding:24px;background:#0b0b10;color:#eee;font:14px Arial,sans-serif}</style></head><body><main id="fixture"></main><script type="module">import {createCreatorTemplates} from '/creator-templates.js';const store={state:{projects:[{id:'existing',name:'Preserved work'}]}};const api=async(path,options={})=>{const r=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json'}});const v=await r.json();if(!r.ok)throw new Error(v.error);return v;};const controller=createCreatorTemplates({store,api,onProjectCreated:async()=>api('/opened',{method:'POST'}),onError:()=>{}});document.querySelector('#fixture').innerHTML=controller.html();controller.bind();</script></body></html>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#ctName').waitFor();
 assert.equal(await page.locator('[data-template-select]').count(),6);await page.locator('[data-template-select="product-ad"]').click();await page.getByLabel('Project name',{exact:true}).fill('A reusable product draft');await page.locator('[data-template-select="social-recut"]').click();await page.locator('[data-template-select="product-ad"]').click();assert.equal(await page.getByLabel('Project name',{exact:true}).inputValue(),'A reusable product draft');
 await page.getByLabel('Your brief',{exact:true}).fill('Show my own product demonstration. Keep claims factual.');await page.getByLabel('Aspect ratio',{exact:true}).selectOption('9:16');await page.getByLabel('Target duration · seconds',{exact:true}).fill('35');await page.getByLabel('Plan captions',{exact:true}).check();await page.getByRole('button',{name:'Create project from template',exact:true}).click();await page.getByRole('button',{name:'Retry saving this plan',exact:true}).waitFor();assert.match(await page.getByRole('status').innerText(),/created and kept/);assert.equal(creates,1);assert.equal(saved.captionsEnabled,true);assert.equal(await page.getByLabel('Your brief',{exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Retry saving this plan',exact:true}).click();await page.getByRole('button',{name:'Start another plan',exact:true}).waitFor();assert.equal(creates,1);assert.equal(plans,2);assert.equal(callbacks,1);assert.equal(saved.creatorWorkflow.inputs.durationSeconds,35);assert.equal(saved.settings.width,1080);assert.equal(saved.settings.height,1920);assert.equal(saved.creatorWorkflow.inputs.sourceMode,'uploaded-media');assert.equal(saved.creatorWorkflow.mediaGenerated,false);
 await page.getByRole('button',{name:'Start another plan',exact:true}).click();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.getByLabel('Your brief',{exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Create project from template',exact:true}).isEnabled(),true);assert.equal(requests.some(r=>/jobs|audio|generation/.test(r.url)),false);
 const proof=path.resolve('work/ui-quality-audit-2026-09-08/creator-templates');await mkdir(proof,{recursive:true});await page.screenshot({path:path.join(proof,'mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(proof,'desktop.png'),fullPage:true});await writeFile(path.join(proof,'evidence.json'),JSON.stringify({scope:'Isolated HTTP/browser fixture; actual production workflow builder; no canonical projects changed',creates,plans,callbacks,errors,checks:['six template choices','editable draft persists when switching','source requirement visible','failed plan retains same project','retry revision respected','exact duration/aspect/caption settings','no model or rendering requests','labelled fields','no mobile overflow']},null,2));assert.deepEqual(errors,[]);
});
