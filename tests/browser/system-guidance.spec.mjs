import { test, expect } from '@playwright/test';

const advanced = page => page.locator('.system-advanced');
const summary = page => advanced(page).locator('> summary');
const threads = page => page.getByLabel('OpenCV threads per analyzer', { exact: true });
const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });

test('System keeps basic controls visible and preserves invalid advanced edits through collapse and canceled navigation', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/#system');
  await expect(page.getByLabel('Planned cameras', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Camera wall tiles', exact: true })).toBeVisible();
  await expect(threads(page)).toHaveCount(1);
  await expect(threads(page)).toBeHidden();
  await expect(summary(page)).toContainText('Optional');
  await summary(page).focus();
  await page.keyboard.press('Enter');
  await expect(threads(page)).toBeVisible();
  await threads(page).fill('');
  await summary(page).click();
  await expect(advanced(page)).not.toHaveAttribute('open');
  await expect(summary(page)).toContainText('Unapplied advanced changes');
  await expect(page.locator('.system-page').getByRole('alert')).toContainText('threads');
  await expect(page.getByRole('button', { name: 'Apply workspace limits', exact: true })).toBeDisabled();
  page.once('dialog', dialog => dialog.dismiss());
  await nav(page, 'Monitor').click();
  await expect(page).toHaveURL(/#system$/);
  await summary(page).click();
  await expect(threads(page)).toHaveValue('');
  await threads(page).fill('2');
  await summary(page).click();
  await expect(summary(page)).toContainText('Unapplied advanced changes');
  await page.getByRole('button', { name: 'Apply workspace limits', exact: true }).click();
  await expect(summary(page)).toContainText('Optional');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dvr.setup.v1'))?.compute?.threads)).toBe(2);
  await summary(page).click();
  await expect(threads(page)).toHaveValue('2');
});

test('advanced warnings stay visible when planning details are closed', async ({ page }) => {
  await page.goto('/#system');
  await summary(page).click();
  await page.getByLabel('Installed RAM plan (GiB)', { exact: true }).fill('33');
  await summary(page).click();
  await expect(advanced(page)).not.toHaveAttribute('open');
  await expect(page.locator('.system-warnings')).toContainText('Estimated workers and queue exceed the RAM planning allowance.');
  await expect(summary(page)).toContainText('Unapplied advanced changes');
});
