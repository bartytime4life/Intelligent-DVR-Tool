import {test, expect} from '@playwright/test';

async function generatedWebcam(page) {
  await page.addInitScript(() => {
    window.generatedCameraRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{
      enumerateDevices:async () => [],
      getUserMedia:() => {
        window.generatedCameraRequests++;
        return new Promise(resolve => {
          window.finishGeneratedCamera = () => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
            canvas.getContext('2d').fillRect(0, 0, 64, 64);
            const stream = canvas.captureStream(1);
            window.generatedCameraTrack = stream.getVideoTracks()[0]; resolve(stream);
          };
        });
      },
    }});
  });
  await page.route('**/api/**', route => route.fulfill({json:{live:{enabled:false}}}));
  await page.goto('/#monitor');
  await page.getByRole('button', {name:'Connect source', exact:true}).click();
  await page.getByRole('button', {name:'Connect webcam', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.generatedCameraRequests)).toBe(1);
}

for (const source of ['Local DVR / IP camera', 'Public internet webcam']) test(`switching to ${source} cancels a pending webcam permission result`, async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await generatedWebcam(page);
  const dialog = page.getByRole('dialog', {name:'Connect a camera source'});
  await dialog.getByRole('button', {name:source, exact:true}).click();
  await page.evaluate(() => window.finishGeneratedCamera());
  await expect.poll(() => page.evaluate(() => window.generatedCameraTrack.readyState)).toBe('ended');
  await expect(page.getByLabel('Webcam video', {exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('changing setup source leaves an already connected generated webcam running', async ({page}) => {
  await generatedWebcam(page);
  await page.evaluate(() => window.finishGeneratedCamera());
  await expect(page.getByRole('button', {name:'View camera wall', exact:true})).toBeVisible();
  const dialog = page.getByRole('dialog', {name:'Connect a camera source'});
  await dialog.getByRole('button', {name:'Local DVR / IP camera', exact:true}).click();
  expect(await page.evaluate(() => window.generatedCameraTrack.readyState)).toBe('live');
  await dialog.getByRole('button', {name:'Close connection setup', exact:true}).click();
  await expect(page.getByLabel('Webcam video', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Disconnect all', exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.generatedCameraTrack.readyState)).toBe('ended');
});
