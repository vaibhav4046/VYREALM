import assert from 'node:assert/strict';
import { VyrelumEngine } from './engine.js';

const engine = new VyrelumEngine({ dbName: `vyrelum-test-${Date.now()}` });
const project = await engine.createProject({ name: 'Engine test', brief: 'smoke test' });
assert.equal((await engine.getProject(project.id)).name, 'Engine test');
const job = await engine.enqueueJob('render', { frame: 1 }, { projectId: project.id, maxRetries: 1 });
await engine.runJob(job.id, async ({ checkpoint }) => { await checkpoint({ stage: 'rendering' }, 0.5); return { file: 'out.mp4' }; });
const finished = await engine.getJob(job.id);
assert.equal(finished.status, 'completed');
assert.equal(finished.progress, 1);
const bundle = await engine.exportProject(project.id);
assert.match(bundle, /vyrelum\.project/);
const imported = new VyrelumEngine({ dbName: `vyrelum-import-${Date.now()}` });
assert.equal((await imported.importProject(bundle)).id, project.id);
console.log('engine smoke test passed');
