import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('a camera still sets exact full-frame zone coordinates and exports analyzer rules', async ({page}) => {
  await page.goto('/#zones');
  // A generated 640×360 image stands in for a camera still; nothing leaves the browser.
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d'); context.fillStyle = '#20405a'; context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#f0b44c'; context.fillRect(320, 0, 320, 360);
    return Array.from(new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))).arrayBuffer()));
  });
  await page.getByLabel('Choose a camera still image').setInputFiles({name:'gate.png', mimeType:'image/png', buffer:Buffer.from(png)});
  await expect(page.getByRole('status')).toContainText('640×360');
  await page.getByRole('button', {name:'Use for Plan 1'}).click();
  const editor = page.locator('.zone-editor');
  await expect(editor.locator('img.zone-still')).toBeVisible();
  await expect(editor).toContainText('CAMERA STILL · 640×360');
  // The editor takes the still's aspect ratio, so the drawn box maps to the full frame.
  const box = await editor.boundingBox();
  expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(.02);
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .9, box.y + box.height * .75, {steps:4});
  await page.mouse.up();
  await expect(page.getByLabel('Left (%)')).toHaveValue('50');
  await expect(page.getByLabel('Width (%)')).toHaveValue('40');
  await page.getByLabel('Observe').selectOption('car');
  await page.getByLabel('Allowed gap between sightings (seconds)').fill('1.5');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export analyzer rules'}).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe('dvr-rules-plan-1-car.json');
  const rules = JSON.parse((await readFile(await file.path())).toString());
  expect(rules).toHaveLength(1);
  expect(Object.keys(rules[0]).sort()).toEqual(['dwell', 'label', 'max_gap', 'name', 'rect', 'threshold']);
  expect(rules[0]).toMatchObject({label:'car', max_gap:1.5});
  const [x, y, w, h] = rules[0].rect;
  expect(Math.abs(x - .5)).toBeLessThan(.01); expect(Math.abs(w - .4)).toBeLessThan(.01);
  expect(Math.abs(y - .25)).toBeLessThan(.01); expect(Math.abs(h - .5)).toBeLessThan(.01);
  expect(x + w).toBeLessThanOrEqual(1);
  // The still persists for this plan across reloads and can be removed.
  await page.reload();
  await expect(page.locator('.zone-editor img.zone-still')).toBeVisible();
  await page.getByRole('button', {name:'Remove still'}).click();
  await expect(page.locator('.zone-editor img.zone-still')).toHaveCount(0);
});

test('legacy object rules load but must choose a model class before analyzer export', async ({page}) => {
  await page.goto('/#zones');
  await page.getByLabel('Camera for zone').selectOption('3');
  await expect(page.getByLabel('Observe')).toHaveValue('object');
  await page.getByRole('button', {name:'Export analyzer rules'}).click();
  await expect(page.getByRole('alert')).toContainText('model class');
});
