import { test, expect } from '@playwright/test';
import { recognitionFixture } from '../fixtures/recognition.mjs';
const upload = value => ({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
const nav = (page, name) => page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:new RegExp(`^${name}`)});
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1')));

test('maximum recognition run has an explicit clear, export, undo and successful handoff path', async ({page}) => {
  await page.goto('/#recognition');
  const bundle = recognitionFixture();
  bundle.receipt.events = bundle.trace.events = Array.from({length:1000}, (_, i) => ({...bundle.receipt.events[0],id:`maximum-${i}`}));
  await page.getByLabel('Open recognition results').setInputFiles(upload(bundle));
  await page.getByRole('button',{name:'Send 1000 observations to Events'}).click();
  await expect(page.locator('.toast')).toContainText('exceed 1,000');
  expect((await stored(page)).length).toBe(2);
  await nav(page,'Events').click();
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export all reviews'}).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('dvr-reviews.json');
  await page.getByRole('button',{name:'Clear queue now'}).click();
  await expect(page.getByRole('heading',{name:'Your review queue is empty'})).toBeVisible();
  await page.getByRole('button',{name:'Undo clear'}).click();
  expect((await stored(page)).length).toBe(2);
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  await page.getByRole('button',{name:'Clear queue now'}).click();
  await nav(page,'Recognition').click();
  await expect(page.getByText('Sample 1 of 2',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Send 1000 observations to Events'}).click();
  await expect(page).toHaveURL(/#events$/);
  await expect(page.getByLabel('Review queue summary')).toContainText('1000 / 1,000');
  expect((await stored(page)).length).toBe(1000);
  // At capacity, a sample test must not remove the oldest real review.
  await nav(page,'Zones').click();
  await page.getByRole('button',{name:'Try simulated event'}).click();
  await expect(page.locator('.toast')).toContainText('exceed 1,000');
  expect((await stored(page)).length).toBe(1000);
});

test('receipt import preserves review decisions and review exports restore an emptied queue', async ({page}) => {
  await page.goto('/#events');
  const receipt = recognitionFixture().receipt;
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(receipt));
  await page.locator('.event-table-row').filter({hasText:'test-recording'}).click();
  await page.getByLabel('Review note').fill('Checked the original recording');
  await page.getByRole('button',{name:'Dismiss event'}).click();
  const reviewed = (await stored(page)).find(e=>e.mode==='offline-model');
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(receipt));
  expect((await stored(page)).find(e=>e.id===reviewed.id)).toEqual(reviewed);
  const backup={schema:'intelligent-dvr.review-export.v1',events:await stored(page)};
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  await page.getByRole('button',{name:'Clear queue now'}).click();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Your review queue is empty'})).toBeVisible();
  // Restore after the receipt has re-created a matching pending entry.
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(receipt));
  expect((await stored(page)).find(e=>e.id===reviewed.id).status).toBe('pending');
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(backup));
  expect((await stored(page)).find(e=>e.id===reviewed.id)).toEqual(reviewed);
});

test('recognition session survives workspace changes and browser Back/Forward', async ({page}) => {
  await page.goto('/#recognition');
  await page.getByLabel('Open recognition results').setInputFiles(upload(recognitionFixture()));
  await page.getByRole('button',{name:'Next sample'}).click();
  await page.getByLabel('Display score threshold').press('End');
  await nav(page,'Events').click();
  await expect(page.getByRole('heading',{name:'Event history'})).toBeVisible();
  await expect(page.getByLabel('Analyzed sample')).not.toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Analyzed sample')).toHaveValue('1');
  await expect(page.getByLabel('Display score threshold')).toHaveValue('1');
  await page.goForward();
  await expect(page.getByRole('heading',{name:'Event history'})).toBeVisible();
  await nav(page,'Recognition').click();
  await expect(page.getByLabel('Analyzed sample')).toHaveValue('1');
});

test('save failures stay visible and never report a review as saved', async ({page}) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => {throw new DOMException('Quota exceeded','QuotaExceededError');}; });
  await page.goto('/#events');
  await expect(page.getByRole('alert')).toContainText('only in memory');
  await page.locator('.event-table-row').first().click();
  await page.getByRole('button',{name:'Dismiss event'}).click();
  await expect(page.locator('.toast')).not.toContainText('saved');
  await expect(page.getByRole('alert')).toContainText('Export before closing');
  await expect(page.getByRole('alert').getByRole('button',{name:'Export reviews'})).toBeVisible();
});

test('narrow-screen queue controls, source filters and empty states remain usable', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#events');
  await page.getByLabel('Observation source').selectOption('offline-model');
  await expect(page.getByRole('heading',{name:'No matching events'})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters'}).click();
  await expect(page.locator('.event-table-row')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/review-workspace-mobile.png',fullPage:true});
});

test('Back to the root URL restores Monitor and Forward restores Events', async ({page}) => {
  await page.goto('/');
  await expect(page.getByLabel('Sample camera wall')).toBeVisible();
  await nav(page,'Events').click();
  await expect(page).toHaveURL(/#events$/);
  await page.goBack();
  await expect(page).not.toHaveURL(/#/);
  await expect(page.getByLabel('Sample camera wall')).toBeVisible();
  await expect(nav(page,'Monitor')).toHaveAttribute('aria-current','page');
  await page.goForward();
  await expect(page.getByRole('heading',{name:'Event history'})).toBeVisible();
});
