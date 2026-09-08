import assert from 'node:assert/strict';
import test from 'node:test';
import { TOOL_DEFINITIONS, dispatchTool, validateInput } from './automation-tools.mjs';
import { createMcpHandler } from '../mcp-server.mjs';
import { buildViralHooks, inferViralFormat } from './viral-formats.mjs';
import { buildViralVariants } from './viral-variants.mjs';

test('uploaded-footage MCP tool admits only the local edit route at a checked revision', async () => {
  const calls = [], args = { projectId: 'project-1', expectedRevision: 4, brief: 'Make a 20 second landscape edit without captions' };
  const job = { id: 'edit-1', projectId: args.projectId, type: 'raw-footage-edit', status: 'queued' };
  const api = async (path, method, body) => { calls.push({ path, method, body }); return method === 'POST' ? { project: { id: args.projectId, revision: 5 }, job } : { id: args.projectId, revision: 4 }; };
  const receipt = await dispatchTool('edit_uploaded_footage', args, { api });
  assert.equal(receipt.status, 'queued');
  assert.equal(receipt.verification.status, 'not-run');
  assert.equal(receipt.metadata.job, job);
  assert.equal(receipt.metadata.provenance, null);
  assert.equal(receipt.metadata.nextTool, 'get_production_run');
  assert.deepEqual(calls[1], { path: '/api/projects/project-1/production-run', method: 'POST', body: { expectedRevision: 4, brief: args.brief, sourceMode: 'uploaded-media' } });
  for (const invalid of [{ ...args, sourcePath: 'C:/outside.mp4' }, { ...args, sourceMode: 'local-generation' }, { ...args, brief: '   ' }, { ...args, projectId: '../outside' }, { ...args, expectedRevision: 0 }]) {
    const result = await dispatchTool('edit_uploaded_footage', invalid, { api });
    assert.equal(result.status, 'failed'); assert.equal(result.diagnostics[0].code, 'INVALID_INPUT');
  }
  assert.equal(calls.length, 2, 'invalid calls cannot admit a job');
  const stale = await dispatchTool('edit_uploaded_footage', { ...args, expectedRevision: 3 }, { api });
  assert.equal(stale.diagnostics[0].code, 'REVISION_CONFLICT');
  assert.equal(calls.length, 3, 'stale revision performs a read but no POST');
});

test('production MCP inspection preserves edited provenance and unapproved playable status', async () => {
  const provenance = { generationStatus: 'edited', sourceMediaMethod: 'imported', nativeAIGeneration: false, outputHash: 'a'.repeat(64) };
  const state = { project: { id: 'p', revision: 7 }, plan: { cuts: ['source-1'] }, job: { id: 'j', projectId: 'p', status: 'review_required', type: 'raw-footage-edit', output: { provenance, outputs: { video: 'owned/edit.mp4' }, verification: { ok: true } } } };
  const calls = [], handle = createMcpHandler({ api: async (...args) => { calls.push(args); return state; }, dispatch: dispatchTool });
  const result = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_production_run', arguments: { projectId: 'p' } } });
  const receipt = JSON.parse(result.result.content[0].text);
  assert.equal(receipt.status, 'review_required');
  assert.deepEqual(receipt.metadata.provenance, provenance);
  assert.deepEqual(receipt.metadata.plan, state.plan);
  assert.equal(receipt.verification.kind, 'worker-media-verification');
  assert.equal(receipt.verification.visualRealismEvaluated, false);
  assert.equal(receipt.diagnostics[0].code, 'VISUAL_REVIEW_REQUIRED');
  assert.deepEqual(calls, [['/api/projects/p/production-run']]);
});

test('production inspection reports absent, cancelled and failed jobs without fabricated completion', async () => {
  for (const status of [null, 'cancelled', 'failed']) {
    const state = { project: { id: 'p', revision: 2 }, job: status ? { id: 'j', projectId: 'p', status, error: status === 'failed' ? 'No uploaded source video' : null } : null };
    const receipt = await dispatchTool('get_production_run', { projectId: 'p' }, { api: async () => state });
    assert.equal(receipt.status, status || 'not_started');
    assert.equal(receipt.verification.status, 'not-run');
    assert.deepEqual(receipt.outputPaths, []);
    if (!status) assert.equal(receipt.diagnostics[0].code, 'NO_PRODUCTION_RUN');
    if (status === 'failed') assert.equal(receipt.diagnostics[0].message, 'No uploaded source video');
  }
});

test('production MCP rejects wrong-project responses, non-edit admission and failed worker verification', async () => {
  const args = { projectId: 'p', expectedRevision: 2, brief: 'Edit my footage' };
  for (const invalid of [{ project: { id: 'other', revision: 3 }, job: null }, { project: { id: 'p', revision: 3 }, job: { id: 'j', projectId: 'p', status: 'queued', type: 'generation-keyframe' } }]) {
    const result = await dispatchTool('edit_uploaded_footage', args, { api: async (_, method) => method === 'POST' ? invalid : { id: 'p', revision: 2 } });
    assert.equal(result.status, 'failed');
  }
  const result = await dispatchTool('get_production_run', { projectId: 'p' }, { api: async () => ({ project: { id: 'p', revision: 3 }, job: { id: 'j', projectId: 'p', status: 'succeeded', output: { verification: { ok: false } } } }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.verification.status, 'failed');
});

test('viral variant planner creates reproducible editable recipes without claiming renders', () => {
  const result = buildViralVariants({ brief: 'a courier crossing a flooded neon market', count: 120, platform: 'instagram-reel' });
  assert.equal(result.variants.length, 120);
  assert.equal(result.source, 'deterministic-local-variation-plan');
  assert.equal(result.variants[0].platform, 'instagram-reel');
  assert.equal(result.variants[0].renderStatus, 'planned');
  assert.ok(result.variants.every(item => item.shotPlan.length >= 3));
  assert.equal(result.variants[0].provenance.generatedBy, 'not-rendered');
  assert.equal(new Set(result.variants.map(item => item.id)).size, 120);
});

test('generate_variations persists a bounded matrix and read-after-write verifies it', async () => {
  const calls = [];
  let document = { id: 'p', revision: 2, brief: 'a courier crossing a flooded neon market' };
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === 'PATCH') document = { ...document, revision: 3, ...body.patch };
    return document;
  };
  const receipt = await dispatchTool('generate_variations', { projectId: 'p', expectedRevision: 2, count: 121, platform: 'youtube-short' }, { api });
  assert.equal(receipt.status, 'succeeded');
  const patch = calls.find(call => call.method === 'PATCH').body.patch;
  assert.equal(patch.variationCount, 121);
  assert.equal(patch.variationSource, 'deterministic-local-variation-plan');
  assert.equal(patch.variations.length, 121);
  assert.equal(patch.variations[0].delivery.aspectRatio, '9:16');
  assert.equal(patch.variations[0].renderStatus, 'planned');
});

test('viral hook builder keeps a format-specific, original micro-story premise', () => {
  const result = buildViralHooks({ brief: 'a courier crossing a flooded neon market', format: 'micro-horror' });
  assert.equal(result.format, 'micro-horror');
  assert.equal(result.hooks.length, 3);
  assert.equal(new Set(result.hooks).size, 3);
  assert.ok(result.hooks.every(hook => hook.includes('flooded neon market')));
  assert.ok(result.hooks.some(hook => hook.toLowerCase().includes('watching')));
  assert.equal(inferViralFormat('film a product demo for a new camera'), 'product-proof');
});

test('generate_hooks persists the selected viral format and evidence source', async () => {
  const calls = [];
  let document = { id: 'p', revision: 2, brief: 'a courier crossing a flooded neon market' };
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === 'PATCH') document = { ...document, revision: 3, ...body.patch };
    return document;
  };
  const receipt = await dispatchTool('generate_hooks', { projectId: 'p', expectedRevision: 2, format: 'micro-horror' }, { api });
  assert.equal(receipt.status, 'succeeded');
  const patch = calls.find(call => call.method === 'PATCH').body.patch;
  assert.equal(patch.hooksFormat, 'micro-horror');
  assert.equal(patch.hooksSource, 'deterministic-local-format-template');
  assert.equal(patch.hooks.length, 3);
});

test('automation surface exposes typed tools and required MCP names', () => {
  const names = new Set(TOOL_DEFINITIONS.map(tool => tool.name));
  for (const name of ['create_project', 'inspect_project', 'generate_keyframe', 'generate_video_shot', 'run_quality_check', 'repair_failed_job', 'export_project']) assert(names.has(name), name);
  assert.equal(TOOL_DEFINITIONS.find(tool => tool.name === 'create_project').inputSchema.additionalProperties, false);
  assert.throws(() => validateInput(TOOL_DEFINITIONS.find(tool => tool.name === 'create_project').inputSchema, { name: 'x', brief: 'b', unexpected: true }), /not supported/);
});

test('blocked neural operation returns precise diagnostic without an API call', async () => {
  let calls = 0;
  const receipt = await dispatchTool('edit_region', { prompt: 'rain market' }, { api: async () => { calls++; } });
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.diagnostics[0].code, 'INPAINTING_NOT_CONNECTED');
  assert.equal(calls, 0);
});

test('next-shot tools retain checked reference and reject caller paths',async()=>{
  for(const name of ['generate_next_shot','generate_video_shot']){
    const calls=[],args={projectId:'project-1',expectedRevision:4,referenceJobId:'reviewed-1',brief:'Run through the market',seed:12};
    const api=async(path,method,body)=>{calls.push({path,method,body});return method==='POST'?{id:'job-2',status:'queued'}:{id:'project-1',revision:4}};
    const result=await dispatchTool(name,args,{api});assert.equal(result.status,'queued');assert.equal(result.verification.status,'not-run');assert.equal(result.metadata.nextTool,'inspect_job');assert.deepEqual(calls[1],{path:'/api/generation/shot',method:'POST',body:args});
    const rejected=await dispatchTool(name,{...args,referencePath:'C:/outside.png'},{api});assert.equal(rejected.status,'failed');assert.equal(calls.length,2);
    const stale=await dispatchTool(name,{...args,expectedRevision:3},{api});assert.equal(stale.status,'failed');assert.equal(calls.length,3,'revision conflict must not post an inference job');
  }
});

test('MCP timeline accepts generated source-video assets by their media type',async()=>{
 const calls=[],args={projectId:'p',expectedRevision:2,clips:[{id:'clip',assetId:'source',kind:'video',duration:5}]};
 let doc={id:'p',revision:2};const api=async(path,method,body)=>{calls.push({path,method,body});if(path==='/api/state')return{assets:[{id:'source',kind:'sourceVideo',mime:'video/mp4'}]};if(method==='PATCH')doc={id:'p',revision:3,...body.patch};return doc;};
 const result=await dispatchTool('edit_timeline',args,{api});assert.equal(result.status,'succeeded');assert.equal(calls.find(c=>c.method==='PATCH').body.patch.timeline[0].assetId,'source');
 const failed=await dispatchTool('write_script',{projectId:'p',expectedRevision:2,text:'New script'},{api:async()=>({id:'p',revision:2})});assert.equal(failed.status,'failed');assert.equal(failed.diagnostics[0].code,'SAVE_VERIFICATION_FAILED');
});

test('MCP handler preserves project arguments and emits review-required diagnostics', async () => {
  const calls = [];
  const api = async (path, method = 'GET', body) => { calls.push({ path, method, body }); return { id: 'job-1', projectId: 'project-1', revision: 3, status: 'review_required', output: { outputs: { video: 'render.mp4' } } }; };
  const handle = createMcpHandler({ api, dispatch: dispatchTool });
  await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'render_video', arguments: { projectId: 'project-1', expectedRevision: 3 } } });
  const result = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'inspect_job', arguments: { jobId: 'job-1' } } });
  const receipt = JSON.parse(result.result.content[0].text);
  assert.equal(receipt.status, 'review_required');
  assert.equal(receipt.diagnostics[0].code, 'VISUAL_REVIEW_REQUIRED');
  assert.equal(calls[1].body.projectId, 'project-1');
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
});

test('interpolation queues the owned reviewed export, with strict paths and revision checks',async()=>{
 const calls=[],args={projectId:'p',expectedRevision:2,device:'cpu'};
 const api=async(path,method,body)=>{calls.push({path,method,body});return method==='POST'?{id:'rife-1',status:'queued'}:{id:'p',revision:2};};
 const result=await dispatchTool('interpolate_video',args,{api});
 assert.equal(result.status,'queued');assert.equal(result.verification.status,'not-run');assert.equal(result.metadata.nextTool,'inspect_job');
 assert.deepEqual(calls[1],{path:'/api/video/interpolate',method:'POST',body:args});
 const bad=await dispatchTool('interpolate_video',{...args,sourcePath:'C:/outside.mp4'},{api});assert.equal(bad.status,'failed');assert.equal(calls.length,2);
 const stale=await dispatchTool('interpolate_video',{...args,expectedRevision:1},{api});assert.equal(stale.status,'failed');assert.equal(calls.length,3);
 const wrongDevice=await dispatchTool('interpolate_video',{...args,device:'cloud'},{api});assert.equal(wrongDevice.status,'failed');assert.equal(calls.length,3);
});
