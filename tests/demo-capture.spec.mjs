import { test, expect } from '@playwright/test';

/**
 * Demo capture: a screen recording of the real product doing the real happy path.
 *
 * This is deliberately NOT the golden verification spec. local-engine-golden.spec.mjs
 * asserts every provenance and audio-layer invariant and must stay strict. This one
 * exists to produce a watchable recording, so it walks the flow a first-time user
 * walks and asserts only that each step genuinely happened. Nothing is staged: every
 * frame is the actual app against the actual local engine.
 */
test('demo: brief to verified export, recorded', async ({ page, request }, testInfo) => {
  test.skip(!process.env.VYREALM_TEST_MEDIA, 'Set VYREALM_TEST_MEDIA to a local clip.');

  const pause = async ms => page.waitForTimeout(ms); // legibility beats for the recording
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));

  await page.goto('/');
  await page.locator('#refreshBtn:not(:disabled)').waitFor();
  await pause(1200);

  // 1. The workspace
  await page.locator('.sidebar [data-nav=Dashboard]').click();
  await pause(1500);

  // 2. A brief becomes a project
  await page.locator('#newProject').click();
  await page.locator('#projectName').fill('Night Lines');
  await pause(600);
  await page.locator('#projectBrief').fill(
    'A visitor in a rainy night market hears footsteps, pauses, and looks back. ' +
    'Cut my local footage with original voiceover and readable captions.'
  );
  await pause(900);
  await page.locator('#createProjectBtn').click();
  await expect(page.locator('#produceBtn')).toBeVisible();
  await pause(1200);

  const projectId = await page.evaluate(() => localStorage.getItem('vyrelum:selectedProject'));
  const token = (await (await request.get('/api/session')).json()).token;
  const project = async () => (await request.get(`/api/projects/${projectId}`, { headers: { 'X-Vyrelum-Token': token } })).json();

  // 3. Footage in
  await page.locator('#mediaInput').setInputFiles(process.env.VYREALM_TEST_MEDIA);
  await expect(page.locator('.timeline-clip')).toHaveCount(1);
  await page.locator('#saveProject').click();
  await expect.poll(async () => (await project()).timeline?.length).toBe(1);
  await pause(1200);

  // 4. Local narration - Piper, on this machine
  await page.locator('.sidebar [data-nav=Audio]').click();
  await pause(900);
  await page.locator('#narrationText').fill('Someone is following me.');
  await pause(700);
  await page.locator('#generateNarration').click();
  await expect.poll(async () => Boolean((await project()).latestAudio?.assetId), { timeout: 180000 }).toBe(true);
  await page.locator('.sidebar [data-nav=Audio]').click();
  await expect(page.locator('audio')).toBeVisible();
  await pause(1800);

  // 5. Local captions - Whisper transcribes the narration we just made
  await page.locator('#transcribeAsset').selectOption((await project()).latestAudio.assetId);
  await pause(500);
  await page.locator('#transcribeMedia').click();
  await expect.poll(async () => Boolean((await project()).transcript?.length), { timeout: 180000 }).toBe(true);
  await page.locator('.sidebar [data-nav=Audio]').click();
  await pause(1200);

  await page.locator('.sidebar [data-nav=Jobs]').click();
  await pause(2600);

  // 6. Render a verified export
  await page.locator('.sidebar [data-nav=Export]').click();
  await pause(1200);
  await page.locator('#exportCanvas').selectOption('1080x1920');
  await page.locator('#exportFraming').selectOption('cover');
  await pause(700);
  const before = (await project()).latestOutput?.jobId;
  await page.locator('#renderBtn').click();
  await expect.poll(async () => {
    const p = await project();
    return p.latestOutput?.jobId && p.latestOutput.jobId !== before ? p.latestOutput.status : null;
  }, { timeout: 240000 }).toBe('verified');
  await pause(2500);

  // 7. The provenance receipt - the part that separates this from a cloud tool
  await page.locator('.sidebar [data-nav=Timeline]').click();
  await pause(1000);
  await expect(page.locator('.source-lineage')).toContainText('Shot 1');
  await page.locator('.source-evidence summary').click();
  await pause(2500);

  await page.screenshot({ path: `${process.env.VYREALM_TEST_OUTPUT || 'outputs/verification'}/demo-final.png`, fullPage: true });
  expect(failures, `page errors: ${failures.join(' | ')}`).toHaveLength(0);
});
