import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { recognitionFixture } from '../fixtures/recognition.mjs';
import { parseReceipt } from '../../src/data.mjs';

const key = 'dvr.events.v1';
const generated = () => {
  const [base] = parseReceipt(recognitionFixture().receipt);
  return ['a', 'b'].map(id => ({...base, id:`generated-${id}`, sourceId:id}));
};
const saved = page => page.evaluate(name => JSON.parse(localStorage.getItem(name)), key);
const dialog = page => page.getByRole('dialog', {name:'Review observation'});
const note = page => dialog(page).getByLabel('Review note', {exact:true});
const warning = page => page.evaluate(() => {
  const event = new Event('beforeunload', {cancelable:true});
  dispatchEvent(event);
  return event.defaultPrevented;
});
const open = async page => {
  await page.locator('.event-table-row').first().click();
  await expect(dialog(page)).toBeVisible();
};
async function setup(page, rows=generated()) {
  // Only generated metadata; no camera, recording, inference, or external request.
  await page.addInitScript(({key, rows}) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(rows));
    Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{
      enumerateDevices:async () => [], getUserMedia:async () => { throw Error('Device access forbidden in note test'); },
    }});
  }, {key, rows});
  await page.route('**/*', route => {
    const address = new URL(route.request().url());
    if (address.hostname !== '127.0.0.1') return route.abort();
    if (address.pathname.startsWith('/api/')) return route.fulfill({status:503, json:{error:{message:'Generated test has no service'}}});
    return route.continue();
  });
  await page.goto('/#events');
}

test('note drafts survive queue steps, every dialog close, and source inspection before a separate save', async ({page}) => {
  await setup(page); await open(page);
  await note(page).fill('Generated draft to inspect against its original source');
  await dialog(page).getByRole('button', {name:'Next →', exact:true}).click();
  await expect(note(page)).toHaveValue('');
  await dialog(page).getByRole('button', {name:'← Previous', exact:true}).click();
  await expect(note(page)).toHaveValue('Generated draft to inspect against its original source');
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
  expect(await warning(page)).toBe(true);
  await open(page); await expect(note(page)).toHaveValue('Generated draft to inspect against its original source');
  await dialog(page).getByRole('button', {name:'Close dialog'}).click();
  await open(page);
  await page.mouse.click(2, 2); await expect(dialog(page)).toHaveCount(0);
  await open(page);
  await dialog(page).getByRole('button', {name:'Open in Recognition'}).click();
  await expect(page).toHaveURL(/#recognition$/);
  await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:/^Events/}).click();
  await open(page); await expect(note(page)).toHaveValue('Generated draft to inspect against its original source');
  await dialog(page).getByRole('button', {name:'Save note', exact:true}).click();
  await expect.poll(async () => (await saved(page))[0].note).toBe('Generated draft to inspect against its original source');
  expect((await saved(page))[0].status).toBe('pending');
  expect((await saved(page))[0].reviewedAt).toBeUndefined();
  expect(await warning(page)).toBe(false);
  await page.reload(); await open(page);
  await expect(note(page)).toHaveValue('Generated draft to inspect against its original source');
});

test('discard releases only its draft and saved pending note survives an older reviewed export', async ({page}) => {
  const rows = generated(); rows[0].note = 'Earlier saved note';
  await setup(page, rows); await open(page);
  await note(page).fill('Discard this generated draft');
  await dialog(page).getByRole('button', {name:'Discard note draft'}).click();
  await expect(note(page)).toHaveValue('Earlier saved note');
  expect(await warning(page)).toBe(false);
  await note(page).fill('');
  await dialog(page).getByRole('button', {name:'Save note', exact:true}).click();
  await expect.poll(async () => (await saved(page))[0].note).toBe('');
  const revision = (await saved(page))[0].reviewRevision;
  await page.keyboard.press('Escape');
  await page.getByLabel('Import receipt or review export', {exact:true}).setInputFiles({
    name:'generated-older-review.json', mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({schema:'intelligent-dvr.review-export.v1', events:[{...rows[0], status:'confirmed', note:'Old exported decision'}]})),
  });
  await expect.poll(async () => (await saved(page))[0].reviewRevision).toBe(revision);
  await open(page); await expect(note(page)).toHaveValue('');
  expect((await saved(page))[0].status).toBe('pending');
});

test('storage failure keeps the saved-in-memory note exportable and warns before closing', async ({page}) => {
  await setup(page);
  await page.evaluate(name => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) {
      if (this === localStorage && k === name) throw new DOMException('Generated storage pressure', 'QuotaExceededError');
      return original.call(this, k, v);
    };
  }, key);
  await open(page); await note(page).fill('Generated note preserved through quota failure');
  await dialog(page).getByRole('button', {name:'Save note', exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Browser save needs attention', {exact:true})).toBeVisible();
  expect(await warning(page)).toBe(true);
  expect((await saved(page))[0].note).toBe('');
  const download = page.waitForEvent('download');
  await page.getByRole('alert').getByRole('button', {name:'Export reviews', exact:true}).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(exported.events[0].note).toBe('Generated note preserved through quota failure');
  expect(exported.events[0].status).toBe('pending');
});

test('another tab human edit is shown before a retained draft can replace it', async ({page, context}) => {
  await setup(page); await open(page); await note(page).fill('This tab’s generated draft');
  const other = await context.newPage();
  await other.goto('/#events');
  await other.evaluate(({name, rows}) => localStorage.setItem(name, JSON.stringify(rows)), {
    name:key, rows:generated().map((row, index) => index ? row : {...row, note:'Other tab’s saved note', reviewRevision:'e'.repeat(32)}),
  });
  await expect(dialog(page).getByRole('button', {name:'Save note', exact:true})).toBeDisabled();
  await expect(dialog(page).getByText('This saved observation changed while you were reviewing it. Your draft is kept.', {exact:true})).toBeVisible();
  await dialog(page).getByRole('button', {name:'Review saved version'}).click();
  await expect(note(page)).toHaveValue('This tab’s generated draft');
  await expect(dialog(page)).toContainText('Other tab’s saved note');
  await dialog(page).getByRole('button', {name:'Save note', exact:true}).click();
  await expect.poll(async () => (await saved(page))[0].note).toBe('This tab’s generated draft');
  await other.close();
});

test('reused observation ID with changed evidence makes the old draft read-only', async ({page, context}) => {
  await setup(page); await open(page); await note(page).fill('Draft for original generated evidence');
  const other = await context.newPage(); await other.goto('/#events');
  await other.evaluate(({name, rows}) => localStorage.setItem(name, JSON.stringify(rows)), {
    name:key, rows:generated().map((row, index) => index ? row : {...row, provenance:{...row.provenance, source_sha256:'f'.repeat(64)}}),
  });
  await expect(dialog(page)).toContainText('This observation is no longer in the queue with the same evidence.');
  await expect(dialog(page).getByRole('button', {name:'Save note', exact:true})).toBeDisabled();
  await expect(dialog(page).getByRole('button', {name:'Confirm observation', exact:true})).toBeDisabled();
  await page.keyboard.press('c');
  expect((await saved(page))[0].status).toBe('pending');
  expect((await saved(page))[0].note).toBe('');
  await dialog(page).getByRole('button', {name:'Discard note draft'}).click();
  expect(await warning(page)).toBe(false);
  await other.close();
});

test('orphaned drafts stay reachable, downloadable, and explicitly discardable after closing their review', async ({page, context}) => {
  await setup(page); await open(page); await note(page).fill('Generated orphan draft retained for recovery');
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
  const other = await context.newPage(); await other.goto('/#events');
  await other.evaluate(name => localStorage.setItem(name, '[]'), key);
  await expect(page.locator('.event-table-row')).toHaveCount(0);
  await page.getByRole('button', {name:'Review note drafts', exact:true}).click();
  const tray = page.getByRole('dialog', {name:'Unsaved review note drafts'});
  await expect(tray).toContainText('Generated orphan draft retained for recovery');
  const download = page.waitForEvent('download');
  await tray.getByRole('button', {name:'Download note drafts', exact:true}).click();
  const recovery = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(recovery.drafts[0].note).toBe('Generated orphan draft retained for recovery');
  expect(recovery.drafts[0].event.provenance.source_sha256).toBe('a'.repeat(64));
  await tray.getByRole('button', {name:'Resume note draft', exact:true}).click();
  await expect(note(page)).toHaveAttribute('readonly', '');
  await expect(dialog(page).getByRole('button', {name:'Save note', exact:true})).toBeDisabled();
  await dialog(page).getByRole('button', {name:'Discard note draft', exact:true}).click();
  expect(await warning(page)).toBe(false);
  await other.close();
});
