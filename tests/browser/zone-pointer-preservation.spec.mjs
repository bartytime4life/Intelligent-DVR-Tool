import {test, expect} from '@playwright/test';

const geometry = page => Promise.all(['Left', 'Top', 'Width', 'Height'].map(label => page.getByLabel(`${label} (%)`, {exact:true}).inputValue()));
async function setup(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{
    enumerateDevices:async () => [], getUserMedia:async () => {throw Error('No device access in generated zone-pointer test');},
  }}));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503, json:{error:{message:'No native service in generated zone-pointer test'}}});
    return route.continue();
  });
  await page.goto('/#zones');
  const canvas = page.locator('.zone-editor canvas');
  await expect(canvas).toBeVisible();
  await canvas.evaluate(element => element.addEventListener('pointerdown', event => {
    if (event.isPrimary && event.button === 0) window.generatedZonePointer = event.pointerId;
  }));
  return canvas;
}
async function startDraw(page, canvas, button='left') {
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.2, box.y+box.height*.2);
  await page.mouse.down({button});
  await page.mouse.move(box.x+box.width*.6, box.y+box.height*.6);
  return box;
}

test('right-button drags leave the zone untouched and a primary drag still saves only its draft', async ({page}) => {
  const canvas = await setup(page), before = await geometry(page);
  await startDraw(page, canvas, 'right'); await page.mouse.up({button:'right'});
  expect(await geometry(page)).toEqual(before);
  await startDraw(page, canvas); await page.mouse.up();
  await expect.poll(() => geometry(page)).toEqual(['20', '20', '40', '40']);
  await expect(page.getByText('Unsaved review rule changes. Save before changing screens or camera plans.', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dvr.rules.v1'))).toBeNull();
});

test('Escape cancels a tentative draw without changing existing numeric draft edits', async ({page}) => {
  const canvas = await setup(page);
  await page.getByLabel('Left (%)', {exact:true}).fill('15');
  const before = await geometry(page);
  await startDraw(page, canvas); await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await geometry(page)).toEqual(before);
  await page.getByRole('button', {name:'Save review rule', exact:true}).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dvr.rules.v1'))?.[0].rect[0])).toBe(.15);
});

for (const interruption of ['pointercancel', 'lostpointercapture']) test(`${interruption} discards the tentative draw and leaves the next draw usable`, async ({page}) => {
  const canvas = await setup(page), before = await geometry(page);
  await startDraw(page, canvas);
  await canvas.evaluate((element, interruption) => {
    if (interruption === 'pointercancel') element.dispatchEvent(new PointerEvent('pointercancel', {pointerId:window.generatedZonePointer, isPrimary:true, bubbles:true}));
    else element.releasePointerCapture(window.generatedZonePointer);
  }, interruption);
  await page.mouse.up();
  expect(await geometry(page)).toEqual(before);
  await startDraw(page, canvas); await page.mouse.up();
  await expect.poll(() => geometry(page)).toEqual(['20', '20', '40', '40']);
});

test('a secondary contact cannot replace or finish a primary zone draw', async ({page}) => {
  const canvas = await setup(page), before = await geometry(page);
  const box = await startDraw(page, canvas);
  await canvas.evaluate((element, box) => {
    const options = {pointerId:777, pointerType:'touch', isPrimary:false, button:0, buttons:1, clientX:box.x+box.width*.8, clientY:box.y+box.height*.8, bubbles:true};
    element.dispatchEvent(new PointerEvent('pointerdown', options));
    element.dispatchEvent(new PointerEvent('pointerup', {...options, buttons:0}));
  }, box);
  expect(await geometry(page)).toEqual(before);
  await page.mouse.up();
  await expect.poll(() => geometry(page)).toEqual(['20', '20', '40', '40']);
});
