import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseReceipt } from '../../src/data.mjs';
import { recognitionFixture } from '../fixtures/recognition.mjs';

// Isolated generated reviews only. These cases never open Recognition, request
// camera permission, contact a local analysis service, or use owner recordings.
const key = 'dvr.events.v1';
const localNote = 'Generated review retained only in the first tab';
const remoteNote = 'Generated different review saved by the other tab';
const conflict = page => page.getByRole('region', {name:'Reviews save conflict'});
const savedReviews = page => page.evaluate(name => JSON.parse(localStorage.getItem(name)), key);
const backupReviews = page => page.evaluate(name => Object.keys(localStorage)
  .filter(item => item.startsWith(name + '.conflict-backup.'))
  .map(item => JSON.parse(JSON.parse(localStorage.getItem(item)).raw)), key);

async function decide(page, status, note) {
  await page.locator('.event-table-row').click();
  await page.getByLabel('Review note', {exact:true}).fill(note);
  await page.getByRole('button', {name:status === 'confirmed' ? 'Confirm observation' : 'Dismiss event', exact:true}).click();
  await expect(page.getByRole('dialog', {name:'Review observation'})).toHaveCount(0);
  await expect(page.locator('.event-table-row .status')).toHaveText(status);
}

async function makeConflict(page, context) {
  const [event] = parseReceipt(recognitionFixture().receipt);
  await page.addInitScript(({name, generated}) => {
    const write = Storage.prototype.setItem;
    localStorage.setItem(name, JSON.stringify([generated]));
    window.blockGeneratedReviewSave = true;
    Storage.prototype.setItem = function (item, value) {
      if (this === localStorage && item === name && window.blockGeneratedReviewSave) {
        throw new DOMException('Generated storage-pressure test', 'QuotaExceededError');
      }
      return write.call(this, item, value);
    };
  }, {name:key, generated:event});
  await page.route('**/api/**', route => route.abort());
  await page.goto('/#events');
  const other = await context.newPage();
  await other.route('**/api/**', route => route.abort());
  await other.goto('/#events');
  await decide(page, 'confirmed', localNote);
  await expect(page.locator('.workspace-storage-warning')).toContainText('only in memory');
  expect((await savedReviews(page))[0].status).toBe('pending');
  await decide(other, 'dismissed', remoteNote);
  await expect.poll(async () => (await savedReviews(other))[0].note).toBe(remoteNote);
  await expect(conflict(page)).toBeVisible();
  await expect(page.locator('.event-table-row .status')).toHaveText('confirmed');
  expect((await savedReviews(page))[0].note).toBe(remoteNote);
  return other;
}

async function downloadVersion(page, label) {
  const ready = page.waitForEvent('download');
  await conflict(page).getByRole('button', {name:label, exact:true}).click();
  const path = await (await ready).path();
  const exported = JSON.parse(await readFile(path, 'utf8'));
  return Array.isArray(exported) ? exported : exported.events;
}

test('a failed local review survives another tab save and both versions remain exportable before choosing', async ({page, context}) => {
  const other = await makeConflict(page, context);
  try {
    const local = await downloadVersion(page, 'Download this version');
    const remote = await downloadVersion(page, 'Download other version');
    expect(local[0]).toMatchObject({status:'confirmed', note:localNote});
    expect(remote[0]).toMatchObject({status:'dismissed', note:remoteNote});
    await conflict(page).getByRole('button', {name:'Use other tab’s version', exact:true}).click();
    await expect(conflict(page)).toHaveCount(0);
    await expect(page.locator('.event-table-row .status')).toHaveText('dismissed');
    expect((await savedReviews(page))[0]).toMatchObject({status:'dismissed', note:remoteNote});
    expect((await backupReviews(page)).some(rows => rows[0]?.note === localNote && rows[0]?.status === 'confirmed')).toBe(true);
  } finally { await other.close(); }
});

test('keeping this tab refuses a failed write, preserves the other saved version, and succeeds after storage recovers', async ({page, context}) => {
  const other = await makeConflict(page, context);
  try {
    const keep = conflict(page).getByRole('button', {name:'Keep this tab’s version', exact:true});
    await keep.click();
    await expect(keep).toBeEnabled();
    await expect(conflict(page).locator('.workspace-conflict-error')).toContainText('storage');
    await expect(page.locator('.event-table-row .status')).toHaveText('confirmed');
    expect((await savedReviews(page))[0]).toMatchObject({status:'dismissed', note:remoteNote});
    expect((await backupReviews(page)).some(rows => rows[0]?.note === remoteNote)).toBe(true);
    await page.evaluate(() => { window.blockGeneratedReviewSave = false; });
    await keep.click();
    await expect(conflict(page)).toHaveCount(0);
    await expect.poll(async () => (await savedReviews(page))[0].note).toBe(localNote);
    await expect(other.locator('.event-table-row .status')).toHaveText('confirmed');
    expect((await savedReviews(other))[0]).toMatchObject({status:'confirmed', note:localNote});
  } finally { await other.close(); }
});
