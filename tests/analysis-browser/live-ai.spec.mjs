import {test,expect} from '@playwright/test';

// Chromium's synthetic camera and the constant-output fixture model: this checks the
// explicit start, overlay, tracking, observation hand-off and stop path, never accuracy.
test('live AI starts only on request, tracks the box, hands an observation to Events and stops',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Connect source',exact:true}).first().click();
  await page.getByRole('button',{name:'Connect webcam',exact:true}).click();
  await expect(page.locator('.feed-setup-body [role="status"]')).toContainText('Webcam preview · audio off');
  await page.getByRole('button',{name:'View camera wall',exact:true}).click();
  const settings=page.getByLabel('Live AI settings',{exact:true});
  await expect(settings).toContainText('Live AI · Synthetic test model');
  await expect(settings).toContainText('Rules: Person presence');
  await expect(page.getByRole('img',{name:'Live AI detections on the analyzed frame'})).toHaveCount(0);
  const requests=[];page.on('request',r=>{if(r.url().includes('/api/live/'))requests.push(r.url());});
  await page.waitForTimeout(500);
  expect(requests).toEqual([]); // Connecting a camera never starts AI.
  await page.getByRole('button',{name:'Start AI',exact:true}).click();
  const overlay=page.getByRole('img',{name:'Live AI detections on the analyzed frame'});
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('text')).toHaveText(['person #1 0.90']);
  await expect(page.locator('.live-ai-status')).toContainText('1 person');
  await expect(page.locator('.live-ai-meta')).toContainText('tracks so far: 1 person');
  const observation=page.getByLabel('Live AI observations',{exact:true}).locator('li').first();
  await expect(observation).toContainText('person present in whole frame for 1s',{timeout:10000});
  await observation.getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(observation).toContainText('In Events');
  await page.getByRole('button',{name:'Stop AI',exact:true}).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Start AI',exact:true})).toBeVisible();
  const stops=requests.filter(u=>u.endsWith('/stop'));expect(stops).toHaveLength(1);
  await page.goto('/#events');
  await expect(page.locator('.review-summary')).toContainText('1 live observations');
  const row=page.locator('.event-table-row').first();
  await expect(row).toContainText('person observed live');
  await expect(row).toContainText('Live AI');
  await row.click();
  await expect(page.getByRole('heading',{name:'Live AI observation · still only'})).toBeVisible();
  await expect(page.locator('.missing-evidence img.event-still')).toBeVisible(); // The analyzed still, kept in this browser.
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
