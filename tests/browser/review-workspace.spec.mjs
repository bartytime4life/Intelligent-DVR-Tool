import { test, expect } from '@playwright/test';
import { initialEvents } from '../../src/data.mjs';
import { recognitionFixture } from '../fixtures/recognition.mjs';
const upload = value => ({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
const nav = (page, name) => page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:new RegExp(`^${name}`)});
test.beforeEach(async ({page}) => { await page.addInitScript(events => { if (!localStorage.getItem('dvr.events.v1')) localStorage.setItem('dvr.events.v1', JSON.stringify(events)); }, initialEvents); });
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1')));

test('maximum recognition run has an explicit clear, export, undo and successful handoff path', async ({page}) => {
  await page.goto('/#recognition');
  const bundle = recognitionFixture();
  bundle.receipt.events = bundle.trace.events = Array.from({length:1000}, (_, i) => ({...bundle.receipt.events[0],id:`maximum-${i}`}));
  await page.getByLabel('Open recognition results').setInputFiles(upload(bundle));
  await page.getByRole('button',{name:'Send 1000 observations to Events'}).click();
  await expect(page.locator('.toast')).toContainText('exceed 1,000');
  await expect.poll(async () => (await stored(page)).length).toBe(2);
  await nav(page,'Events').click();
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export all reviews'}).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('dvr-reviews.json');
  await page.getByRole('button',{name:'Clear queue now'}).click();
  await expect(page.getByRole('heading',{name:'Your review queue is empty'})).toBeVisible();
  await expect.poll(() => stored(page)).toEqual([]);
  await page.getByRole('button',{name:'Undo clear'}).click();
  await expect.poll(async () => (await stored(page)).length).toBe(2);
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  await page.getByRole('button',{name:'Clear queue now'}).click();
  await expect.poll(() => stored(page)).toEqual([]);
  await nav(page,'Recognition').click();
  await expect(page.getByText('Sample 1 of 2',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Send 1000 observations to Events'}).click();
  await expect(page).toHaveURL(/#events$/);
  await expect(page.getByLabel('Review queue summary')).toContainText('1000 / 1,000');
  await expect.poll(async () => (await stored(page)).length).toBe(1000);
  // A second distinct import must still refuse overflow without discarding reviews.
  const extra = recognitionFixture().receipt;
  extra.events[0].id = 'extra-at-capacity';
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(extra));
  await expect(page.locator('.toast')).toContainText('exceed 1,000');
  await expect.poll(async () => (await stored(page)).length).toBe(1000);
});

test('receipt import preserves review decisions and review exports restore an emptied queue', async ({page}) => {
  await page.goto('/#events');
  const receipt = recognitionFixture().receipt;
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(receipt));
  await expect.poll(async () => (await stored(page)).find(e => e.mode === 'offline-model')?.status).toBe('pending');
  await page.locator('.event-table-row').filter({hasText:'test-recording'}).click();
  await page.getByLabel('Review note').fill('Checked the original recording');
  await page.getByRole('button',{name:'Dismiss event'}).click();
  // Review advances to the next item awaiting review (a retained sample here); close it.
  await expect(page.getByRole('dialog',{name:'Review observation'})).toContainText('Legacy sample observation');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Modal updates precede the asynchronous shared-lock save. Capture the
  // reviewed snapshot only after its exact decision and note have committed.
  await expect.poll(async () => (await stored(page)).find(e => e.mode === 'offline-model'))
    .toMatchObject({status:'dismissed', note:'Checked the original recording'});
  const reviewed = (await stored(page)).find(e=>e.mode==='offline-model');
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(receipt));
  await expect(page.locator('.toast')).toContainText('0 new observations added. Existing decisions kept.');
  await expect.poll(async () => (await stored(page)).find(e=>e.id===reviewed.id)).toEqual(reviewed);
  const backup={schema:'intelligent-dvr.review-export.v1',events:await stored(page)};
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  await page.getByRole('button',{name:'Clear queue now'}).click();
  await expect.poll(() => stored(page)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Your review queue is empty'})).toBeVisible();
  // Restore after the receipt has re-created a matching pending entry.
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(receipt));
  await expect.poll(async () => (await stored(page)).find(e=>e.id===reviewed.id)?.status).toBe('pending');
  await page.getByLabel('Import receipt or review export').setInputFiles(upload(backup));
  await expect.poll(async () => (await stored(page)).find(e=>e.id===reviewed.id)).toEqual(reviewed);
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
  await page.goto('/#events');
  const before = await stored(page), warning = page.locator('.workspace-storage-warning');
  await expect(warning).toHaveCount(0);
  // Fail the actual review edit, after the generated queue has been seeded.
  // Opening an unchanged workspace must not write merely to discover a quota error.
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'dvr.events.v1') throw new DOMException('Quota exceeded','QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.locator('.event-table-row').first().click();
  await page.getByLabel('Review note', {exact:true}).fill('Generated note retained only in this tab');
  await page.getByRole('button',{name:'Dismiss event'}).click();
  await page.keyboard.press('Escape'); // Close the next pending review.
  await expect(page.getByRole('dialog', {name:'Review observation'})).toHaveCount(0);
  await expect(page.locator('.event-table-row .status').first()).toHaveText('dismissed');
  await expect(warning).toContainText('only in memory');
  await expect(page.locator('.toast')).toContainText('Event dismissed');
  await expect(page.locator('.toast')).not.toContainText('saved');
  await expect(warning).toContainText('Export before closing');
  await expect(warning.getByRole('button',{name:'Export reviews'})).toBeVisible();
  await expect.poll(() => stored(page)).toEqual(before);
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
  await expect(page.getByLabel('Camera wall')).toBeVisible();
  await nav(page,'Events').click();
  await expect(page).toHaveURL(/#events$/);
  await page.goBack();
  await expect(page).not.toHaveURL(/#/);
  await expect(page.getByLabel('Camera wall')).toBeVisible();
  await expect(nav(page,'Monitor')).toHaveAttribute('aria-current','page');
  await page.goForward();
  await expect(page.getByRole('heading',{name:'Event history'})).toBeVisible();
});
