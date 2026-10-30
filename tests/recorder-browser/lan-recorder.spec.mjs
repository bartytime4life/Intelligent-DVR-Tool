import {test, expect} from '@playwright/test';

test('explicit native RTSP recording, existing CPU analysis, source-matched review and stop', async ({page}) => {
  await page.goto('/#recognition');
  const panel = page.getByRole('region',{name:'LAN camera recorder'});
  await panel.getByRole('button',{name:'Connect LAN recorder'}).click();
  await expect(panel.locator('.local-analysis-badge')).toHaveText('stopped');
  await expect(panel.getByRole('button',{name:'Start recording & analysis'})).toBeEnabled();
  await panel.getByRole('button',{name:'Start recording & analysis'}).click();
  await expect(panel.getByRole('button',{name:'Start recording & analysis'})).toBeDisabled();
  await expect(panel.getByRole('button',{name:'Review segment'}).first()).toBeVisible({timeout:35000});
  await panel.getByRole('button',{name:'Review segment'}).first().click();
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(1);
  await expect(page.locator('.recognition-status')).toContainText('fingerprint matched');
  await expect.poll(()=>page.locator('video').evaluate(el=>el.readyState)).toBe(4);
  await page.screenshot({path:'test-results/recorder/desktop.png',fullPage:true});
  await page.reload();
  await panel.getByRole('button',{name:'Connect LAN recorder'}).click();
  await expect(panel.getByRole('button',{name:'Stop recording & analysis'})).toBeEnabled();
  await panel.getByRole('button',{name:'Stop recording & analysis'}).click();
  await expect(panel.locator('.local-analysis-badge')).toHaveText('stopped');
  await page.setViewportSize({width:390,height:844});
  await expect(panel.getByRole('button',{name:'Review segment'}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/recorder/mobile.png',fullPage:true});
});

test('lost status is visible and never starts recording by retry', async ({page}) => {
  await page.goto('/#recognition');
  const panel = page.getByRole('region',{name:'LAN camera recorder'});
  await panel.getByRole('button',{name:'Connect LAN recorder'}).click();
  await page.route('**/api/recorder/status', route=>route.abort());
  await expect(panel.getByRole('alert')).toContainText('recording may still be running');
  await expect(panel.getByRole('button',{name:'Start recording & analysis'})).toBeDisabled();
  await page.unroute('**/api/recorder/status');
  await panel.getByRole('button',{name:'Refresh recorder status'}).click();
  await expect(panel.locator('.local-analysis-badge')).toHaveText('stopped');
});
