import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
test('standalone UI explains missing project, blocks duplicate submit and permits regeneration', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const source = await readFile(new URL('../thumbnail-studio.js', import.meta.url), 'utf8');
    await page.route('http://thumbnail.test/**', route => route.fulfill({ status: 200, contentType: route.request().url().endsWith('.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('.js') ? source : '<main id="studio"></main>' }));
    await page.goto('http://thumbnail.test/');
    await page.evaluate(async () => {
      const { createThumbnailStudio } = await import('/thumbnail-studio.js');
      window.store = { project: null, state: { assets: [] } }; window.calls = []; window.pending = [];
      window.studio = createThumbnailStudio({ store, api: (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return new Promise(resolve => pending.push(resolve)); }, refresh: async () => {} });
      document.querySelector('#studio').innerHTML = studio.html(); studio.bind(document.querySelector('#studio'));
    });
    assert.match(await page.locator('[role="status"]').innerText(), /Create or select a project/);
    await page.evaluate(() => { store.project = { id: 'project-1', revision: 7, name: 'Tea' }; const container = document.querySelector('#studio'); container.innerHTML = studio.html(); studio.bind(container); });
    await page.locator('[name="title"]').fill('A moment for tea');
    await page.locator('[name="style"]').selectOption('editorial');
    await page.evaluate(() => { const form = document.querySelector('form'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(await page.evaluate(() => calls.length), 1);
    assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
    await page.evaluate(() => pending.shift()({ thumbnail: { projectId: 'project-1', title: 'A moment for tea', method: 'prompt-typography', assets: { upload: 'upload', master: 'master', preview: 'preview' }, artifacts: { upload: { bytes: 5000 } }, attached: true } }));
    await page.getByRole('link', { name: 'Download 4K master' }).waitFor();
    assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
    await page.locator('[name="title"]').fill('Another moment');
    await page.getByRole('button', { name: 'Create thumbnail' }).click();
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.length, 2); assert.equal(calls[0].body.expectedRevision, 7); assert.equal(calls[0].body.style, 'editorial'); assert.equal(calls[1].body.title, 'Another moment');
  } finally { await browser.close(); }
});
