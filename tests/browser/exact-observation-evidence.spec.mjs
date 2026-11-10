import {test, expect} from '@playwright/test';
import {adjacentFrameFixture} from '../fixtures/recognition.mjs';
import {parseRecognition} from '../../src/recognition.mjs';

const upload = value => ({name:'generated-observation.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(value))});
async function setup(page) {
  const review = {...parseRecognition(adjacentFrameFixture(0)).events[0], status:'confirmed', note:'Inspected the first sample only'};
  await page.addInitScript(event => localStorage.setItem('dvr.events.v1', JSON.stringify([event])), review);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503, json:{error:{message:'No local service in generated evidence tests'}}});
    return route.continue();
  });
  return review;
}

test('an adjacent-frame receipt cannot reuse the saved decision behind the same rounded time', async ({page}) => {
  const review = await setup(page);
  await page.goto('/#events');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', {name:'Import receipt or reviews', exact:true}).click();
  await (await choosing).setFiles(upload(adjacentFrameFixture(.04).receipt));
  await expect(page.locator('.toast')).toContainText('conflicts with different evidence');
  await expect(page.locator('.event-table-row')).toHaveCount(1);
  await page.locator('.event-table-row').click();
  await expect(page.getByRole('textbox', {name:'Review note', exact:true})).toHaveValue(review.note);
  await expect(page.getByRole('dialog', {name:'Review observation', exact:true}).getByRole('definition').filter({hasText:/^confirmed$/})).toHaveCount(1);
});

test('a report refuses another exact sample without crashing or transferring its reviewed note', async ({page}) => {
  const review = await setup(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#recognition');
  await page.getByRole('group', {name:'Recognition tasks'}).getByRole('button', {name:/^Open saved results/}).click();
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(adjacentFrameFixture(.04)));
  await expect(page.getByRole('alert')).toContainText('Report unavailable: An observation ID conflicts');
  await expect(page.getByRole('button', {name:'Download report JSON', exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading', {name:'Recognition', exact:true})).toBeVisible();
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(adjacentFrameFixture(0)));
  await expect(page.getByRole('region', {name:'Recognition report', exact:true})).toContainText('1 confirmed');
  await expect(page.getByRole('button', {name:'Download report JSON', exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
  // Both requests used metadata only; no recording or inference was opened.
  expect(review.seconds).toBe(0);
});
