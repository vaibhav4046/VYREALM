import assert from 'node:assert/strict';
import test from 'node:test';
import { ComfyUIProvider } from './comfyui.mjs';
import { createProviderRegistry } from './registry.mjs';

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });

test('ComfyUI health reports loopback unavailable with a precise diagnostic', async () => {
  const provider = new ComfyUIProvider({ fetchImpl: async () => { throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }); } });
  const health = await provider.health_check();
  assert.equal(health.available, false);
  assert.equal(health.diagnostic.code, 'COMFYUI_UNAVAILABLE');
  assert.match(health.reason, /not reachable/);
});

test('ComfyUI health inventories nodes and model folders', async () => {
  const fetchImpl = async url => {
    if (url.endsWith('/system_stats')) return response({ system: { vram_total: 6442450944 }, devices: [] });
    if (url.endsWith('/object_info')) return response({ KSampler: {}, CheckpointLoaderSimple: {} });
    if (url.endsWith('/models/checkpoints')) return response([{ name: 'demo.safetensors' }]);
    if (url.includes('/models/')) return response([]);
    throw new Error(`unexpected ${url}`);
  };
  const provider = new ComfyUIProvider({ fetchImpl, hardware: { vramGb: 6 } });
  const health = await provider.health_check();
  assert.equal(health.available, true);
  assert.equal(health.nodeCount, 2);
  assert.deepEqual(health.installedModels.checkpoints, ['demo.safetensors']);
  assert.equal(health.modelCount, 1);
});

test('ComfyUI submission blocks missing nodes/models before POST', async () => {
  let posted = false;
  const fetchImpl = async url => {
    if (url.endsWith('/system_stats')) return response({});
    if (url.endsWith('/object_info')) return response({ KSampler: {} });
    if (url.includes('/models/')) return response([]);
    if (url.endsWith('/prompt')) { posted = true; return response({ prompt_id: 'nope' }); }
    throw new Error(`unexpected ${url}`);
  };
  const provider = new ComfyUIProvider({ fetchImpl });
  await assert.rejects(() => provider.generate_video({ workflow: { '1': {} }, requiredNodes: ['VideoHelperSuite'], requiredModels: ['wan.safetensors'] }), error => error.code === 'WORKFLOW_REQUIREMENTS_MISSING' && error.details.missingNodes[0] === 'VideoHelperSuite' && error.details.missingModels[0] === 'wan.safetensors');
  assert.equal(posted, false);
});

test('ComfyUI submits a workflow and retrieves/cancels the prompt', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/system_stats')) return response({});
    if (url.endsWith('/object_info')) return response({ KSampler: {} });
    if (url.includes('/models/')) return response([]);
    if (url.endsWith('/prompt')) return response({ prompt_id: 'abc-123' });
    if (url.endsWith('/history/abc-123')) return response({ 'abc-123': { status: { completed: true }, outputs: { '1': { images: [{ filename: 'out.png' }] } } } });
    if (url.endsWith('/interrupt')) return response({});
    if (url.endsWith('/queue')) return response({queue_running:[[0,'abc-123']],queue_pending:[]});
    throw new Error(`unexpected ${url}`);
  };
  const provider = new ComfyUIProvider({ fetchImpl });
  const queued = await provider.generate_image({ workflow: { '1': { class_type: 'KSampler' } }, width: 256, height: 256 });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.promptId, 'abc-123');
  const result = await provider.retrieve_result('abc-123');
  assert.equal(result.status, 'completed');
  assert.ok(result.outputs['1']);
  assert.equal((await provider.cancel('abc-123')).status, 'cancelled');
  assert.ok(calls.some(call => call.url.endsWith('/prompt')));
});

test('cancellation never interrupts another prompt and error history cannot complete', async () => {
  const calls=[];
  const provider=new ComfyUIProvider({fetchImpl:async(url,options)=>{
    calls.push(url);
    if(url.endsWith('/queue'))return response({queue_running:[[1,'someone-else']],queue_pending:[]});
    if(url.includes('/history/'))return response({mine:{status:{completed:true,status_str:'error'},outputs:{'10':{images:[]}}}});
    throw new Error('Unexpected provider mutation');
  }});
  assert.equal((await provider.cancel('mine')).status,'not-active');
  assert.equal((await provider.retrieve_result('mine')).status,'failed');
  assert.equal(calls.some(x=>x.endsWith('/interrupt')),false);
});

test('provider registry exposes ComfyUI as a local provider', async () => {
  const registry = createProviderRegistry({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.ok(registry.get('comfyui-local'));
  const report = await registry.inspect();
  assert.equal(report[0].id, 'comfyui-local');
  assert.equal(report[0].health.available, false);
});

test('provider registry honors an injected ComfyUI URL without touching process env', () => {
  const registry = createProviderRegistry({ env: { VYRELUM_COMFYUI_URL: 'http://localhost:9191' }, fetchImpl: async () => response({}) });
  assert.equal(registry.get('comfyui-local').baseUrl, 'http://localhost:9191');
});

test('resource preflight reports disk and VRAM warnings instead of guessing support', () => {
  const provider = new ComfyUIProvider({ hardware: { vramGb: 2, freeDiskGb: 1 }, fetchImpl: async () => response({}) });
  const estimate = provider.estimate_resources({ width: 1920, height: 1080, frames: 48, diskNeedGb: 2 });
  assert.equal(estimate.safe, false);
  assert.ok(estimate.warnings.some(warning => /VRAM/.test(warning)));
  assert.ok(estimate.warnings.some(warning => /disk/.test(warning)));
});
