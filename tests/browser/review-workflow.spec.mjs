import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { recognitionFixture } from '../fixtures/recognition.mjs';
import { parseReceipt } from '../../src/data.mjs';

const upload = value => ({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
// Three pending observations from one fixture receipt, ordered as the queue stores them.
const seeded = () => {
  const [base] = parseReceipt(recognitionFixture().receipt);
  return [['a', 4, .91], ['b', 2, .62], ['c', 7, .77]].map(([id, seconds, score]) =>
    ({...base, id:`import-${id}`, sourceId:id, seconds, time:`Clip +${seconds.toFixed(1)}s`, score}));
};
const seed = (page, events) => page.addInitScript(value => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('dvr.events.v1', value); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(events));
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1')));

test('keyboard review confirms, dismisses and advances through pending observations', async ({page}) => {
  await seed(page, seeded());
  await page.goto('/#events');
  await page.locator('.event-table-row').first().click();
  const dialog = page.getByRole('dialog', {name:'Review observation'});
  await expect(dialog).toContainText('1 of 3 awaiting review');
  await page.keyboard.press('c');
  await expect(dialog).toContainText('1 of 2 awaiting review');
  await page.keyboard.press('j');
  await expect(dialog).toContainText('2 of 2 awaiting review');
  // Shortcuts never fire while typing a note.
  await dialog.getByPlaceholder('What did you observe?').fill('cd');
  await expect(dialog).toContainText('2 of 2 awaiting review');
  await dialog.getByRole('button', {name:'Dismiss event'}).click();
  await expect(dialog).toContainText('1 of 1 awaiting review');
  await page.keyboard.press('d');
  await expect(dialog).toHaveCount(0);
  const statuses = Object.fromEntries((await stored(page)).map(e => [e.id, e.status]));
  expect(statuses).toEqual({'import-a':'confirmed', 'import-b':'dismissed', 'import-c':'dismissed'});
  expect((await stored(page)).find(e => e.id === 'import-c').note).toBe('cd');
});

test('events sort, export shown rows as CSV, and bulk dismissal can be undone', async ({page}) => {
  await seed(page, seeded());
  await page.goto('/#events');
  await page.getByLabel('Sort events').selectOption('score');
  await expect(page.locator('.event-row-title small').first()).toContainText('Clip +4.0s');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export shown as CSV'}).click();
  const csv = (await readFile(await (await downloading).path())).toString();
  expect(csv.split('\r\n')[0]).toContain('"event_id","status"');
  expect(csv.trim().split('\r\n')).toHaveLength(4);
  await page.getByRole('button', {name:'Dismiss 3 shown awaiting review'}).click();
  await page.getByRole('button', {name:'Dismiss 3', exact:true}).click();
  await expect.poll(async () => (await stored(page)).every(e => e.status === 'dismissed')).toBe(true);
  await page.getByRole('button', {name:'Undo bulk dismissal'}).click();
  await expect.poll(async () => (await stored(page)).every(e => e.status === 'pending')).toBe(true);
});

test('observations sent from a matched recording keep a local still in Events', async ({page}) => {
  await page.goto('/#recognition');
  // Generated pixels only; this checks still capture and storage, not recognition quality.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=240;
    const context=canvas.getContext('2d'), stream=canvas.captureStream(10), chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable=e=>chunks.push(e.data);
    const stopped=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start();
    for(let i=0;i<12;i++) { context.fillStyle=i%2 ? '#d0603a' : '#3a8ad0'; context.fillRect(0,0,320,240); await new Promise(r=>setTimeout(r,100)); }
    recorder.stop(); await stopped; stream.getTracks().forEach(t=>t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const buffer=Buffer.from(bytes), sha=createHash('sha256').update(buffer).digest('hex');
  await page.getByLabel('Open recognition results').setInputFiles(upload(recognitionFixture(sha)));
  await page.getByLabel('Match original recording').setInputFiles({name:'synthetic.webm',mimeType:'video/webm',buffer});
  await expect(page.getByRole('status')).toContainText('fingerprint matched');
  await page.getByRole('button',{name:'Send 1 observations to Events'}).click();
  await expect(page).toHaveURL(/#events$/);
  const still = page.locator('.event-table-row img.event-still');
  await expect(still).toHaveCount(1);
  expect(await still.evaluate(img => img.complete && img.naturalWidth)).toBe(160);
  // Clearing the queue keeps the still for Undo, then Undo shows it again.
  await page.getByRole('button',{name:'Clear queue'}).click();
  await page.getByRole('button',{name:'Clear queue now'}).click();
  await page.getByRole('button',{name:'Undo clear'}).click();
  await expect(page.locator('.event-table-row img.event-still')).toHaveCount(1);
});
