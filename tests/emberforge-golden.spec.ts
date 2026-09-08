import { test, expect } from '@playwright/test';

test('golden offline creator journey', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/');
  await page.getByRole('button', { name: /Create/ }).click();
  await page.getByPlaceholder('A name for this production').fill('VYREALM Golden Trailer');
  await page.getByPlaceholder('Subject, setting, action, mood, and intended audience...').fill('An original coastal city game trailer with a neon street, chase, dialogue, rain, and title reveal.');
  await page.getByRole('button', { name: /Create project/ }).click();
  await expect(page.getByText(/Revision/)).toBeVisible();
  await page.getByRole('button', { name: /Production plan/ }).click();
  await expect(page.getByRole('heading', { name: /Direct the sequence/ })).toBeVisible();
});

