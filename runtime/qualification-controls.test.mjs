import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\ninit\(\);\s*$/, '\n');
test('qualification jobs expose runner ownership and never offer generic Retry/Cancel', () => {
  const context = vm.createContext({ document: { activeElement: null, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } } });
  vm.runInContext(app, context);
  for (const status of ['running', 'failed', 'cancelled', 'blocked']) {
    context.row = { id: 'qualification', type: 'ltx-qualification', projectId: 'film', status };
    const html = vm.runInContext('store.state.jobs=[row];jobs()', context);
    assert.doesNotMatch(html, /data-job-(cancel|retry)/);
    assert.match(html, /qualification runner/i);
  }
  context.row = { id: 'normal', type: 'generation-shot', status: 'running' };
  assert.match(vm.runInContext('store.state.jobs=[row];jobs()', context), /data-job-cancel/);
});

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = server.indexOf(" const jm=path.match(");
const end = server.indexOf(" if(path==='/api/generation/apply-retained'", start);
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const handler = new AsyncFunction('path', 'req', 'db', 'send', 'res', server.slice(start, end));
test('actual API guard returns 409 before mutating or controlling a qualification process', async () => {
  for (const action of ['retry', 'cancel']) {
    const row = { id: 'qualification', type: 'ltx-qualification', status: action === 'retry' ? 'failed' : 'running' };
    const db = { prepare(sql) { assert.match(sql, /^SELECT/); return { get() { return row; } }; } };
    const result = await handler(`/api/jobs/qualification/${action}`, { method: 'POST' }, db, (_res, status, body) => ({ status, body }), {});
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'QUALIFICATION_RUNNER_CONTROL_REQUIRED');
  }
});
