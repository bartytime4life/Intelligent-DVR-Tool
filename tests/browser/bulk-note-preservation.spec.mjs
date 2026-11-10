import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {parseReceipt} from '../../src/data.mjs';
import {recognitionFixture} from '../fixtures/recognition.mjs';

const storageKey = 'dvr.events.v1';
const generatedRows = () => {
  const [event] = parseReceipt(recognitionFixture().receipt);
  return [
    {...event, id:'generated-bulk-a', sourceId:'generated-bulk-a', note:'Check the original entrance view before closing this review.', reviewRevision:'a'.repeat(32)},
    {...event, id:'generated-bulk-b', sourceId:'generated-bulk-b', note:'Keep this second operator note and its source evidence.', reviewRevision:'b'.repeat(32)},
  ];
};
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
async function setup(page) {
  const rows = generatedRows();
  await page.addInitScript(({key, rows}) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(rows));
    Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{
      enumerateDevices:async () => [], getUserMedia:async () => {throw Error('No device access in generated bulk-note test');},
    }});
  }, {key:storageKey, rows});
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503, json:{error:{message:'No native service in generated bulk-note test'}}});
    return route.continue();
  });
  await page.goto('/#events');
  return rows;
}
async function dismissBoth(page) {
  await page.getByRole('button', {name:'Dismiss 2 shown awaiting review', exact:true}).click();
  const confirmation = page.getByRole('dialog', {name:'Dismiss 2 observations?', exact:true});
  await expect(confirmation).toContainText('Saved review notes are kept.');
  await confirmation.getByRole('button', {name:'Dismiss 2', exact:true}).click();
  await expect.poll(async () => (await stored(page)).every(row => row.status === 'dismissed')).toBe(true);
}

test('bulk dismissal keeps both saved human notes in exports and Undo restores their exact prior reviews', async ({page}) => {
  const before = await setup(page); await dismissBoth(page);
  const dismissed = await stored(page);
  expect(dismissed.map(row => row.note)).toEqual(before.map(row => row.note));
  expect(dismissed.map(row => row.provenance)).toEqual(before.map(row => row.provenance));
  expect(dismissed[0].reviewRevision).not.toBe(before[0].reviewRevision);
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export reviews', exact:true}).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(exported.events).toEqual(dismissed);
  await page.getByRole('button', {name:'Undo bulk dismissal', exact:true}).click();
  await expect.poll(() => stored(page)).toEqual(before);
});

test('Undo keeps a later individual note edit while restoring the other bulk-dismissed review', async ({page}) => {
  const before = await setup(page); await dismissBoth(page);
  await page.locator('.event-table-row').first().click();
  const review = page.getByRole('dialog', {name:'Review observation', exact:true});
  await review.getByLabel('Review note', {exact:true}).fill('A later operator edit after bulk dismissal.');
  await review.getByRole('button', {name:'Save note', exact:true}).click();
  await expect.poll(async () => (await stored(page))[0].note).toBe('A later operator edit after bulk dismissal.');
  const later = (await stored(page))[0];
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Undo bulk dismissal', exact:true}).click();
  await expect.poll(async () => (await stored(page))[1]).toEqual(before[1]);
  expect((await stored(page))[0]).toEqual(later);
  expect(later.status).toBe('dismissed');
});
