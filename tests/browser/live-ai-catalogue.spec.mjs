import {test, expect} from '@playwright/test';

test.use({permissions:['camera'], launchOptions:{args:[
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
]}});

const catalogue = () => ({token:'generated-token', live:{enabled:true,
  limits:{active_sessions:2}, models:[{id:'generated-model',name:'Generated detector'}],
  rules:[{id:'generated-rules',name:'Generated rules',models:['generated-model']}]}});

for (const [name, width, damage] of [
  ['missing session limits', 1440, value => {delete value.live.limits;}],
  ['invalid rule choices', 390, value => {value.live.rules[0].models = null;}],
]) test(`Monitor keeps its preview and recovers from ${name}`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  let reply = catalogue(); damage(reply);
  const starts = [];
  await page.route('**/api/analysis/session', route => route.fulfill({json:reply}));
  await page.route('**/api/live/**', route => {starts.push(route.request().url()); return route.fulfill({json:{}});});
  await page.goto('/#monitor');
  await page.getByRole('button', {name:'Connect source', exact:true}).click();
  await page.getByRole('button', {name:'Connect webcam', exact:true}).click();
  await expect(page.getByRole('button', {name:'View camera wall', exact:true})).toBeVisible();
  await page.getByRole('button', {name:'View camera wall', exact:true}).click();
  const video = page.getByLabel('Webcam video', {exact:true});
  await expect(video).toBeVisible();
  const track = await video.evaluate(element => element.srcObject.getVideoTracks()[0].id);
  await expect(page.getByRole('heading', {name:'This workspace stopped unexpectedly'})).toHaveCount(0);
  await expect(page.getByLabel('Live AI settings', {exact:true})).toContainText('Live AI setup needs attention');
  await expect(page.getByRole('button', {name:'Start AI', exact:true})).toBeDisabled();
  expect(await page.getByRole('button', {name:'Disconnect', exact:true}).evaluate(button => {
    const control = button.getBoundingClientRect(), tile = button.closest('.live-tile').getBoundingClientRect();
    return control.bottom <= tile.bottom && control.left >= tile.left && control.right <= tile.right;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`qa-local/workspace-audit/catalogue-${name.replaceAll(' ','-')}-unavailable.png`,fullPage:true});
  reply = catalogue();
  await page.getByRole('button', {name:'Check again', exact:true}).click();
  await expect(page.getByLabel('Live AI settings', {exact:true})).toContainText('Generated detector');
  await expect(page.getByRole('button', {name:'Start AI', exact:true})).toBeEnabled();
  expect(await video.evaluate(element => ({id:element.srcObject.getVideoTracks()[0].id,
    state:element.srcObject.getVideoTracks()[0].readyState}))).toEqual({id:track,state:'live'});
  expect(starts).toEqual([]);
  await page.screenshot({path:`qa-local/workspace-audit/catalogue-${name.replaceAll(' ','-')}-recovered.png`,fullPage:true});
});

test('an older catalogue reply cannot replace a newer successful check', async ({page}) => {
  // Hold the first response in the page, even after abort. This makes the
  // stale-completion check independent of how quickly Chrome cancels a request.
  await page.addInitScript(value => {
    const nativeFetch = window.fetch.bind(window);
    window.catalogueReads = 0;
    window.fetch = (url, options) => {
      if (url === '/api/analysis/session') {
        if (++window.catalogueReads === 1) return new Promise(resolve => {
          window.finishOlderCatalogue = () => resolve(new Response(JSON.stringify({live:{enabled:false}})));
        });
        return Promise.resolve(new Response(JSON.stringify(value)));
      }
      return nativeFetch(url, options);
    };
  }, catalogue());
  await page.goto('/#monitor');
  // StrictMode replaces the first mount's request. The newer catalogue owns
  // the UI even if the first request finishes after cleanup.
  await expect.poll(() => page.evaluate(() => window.catalogueReads)).toBeGreaterThan(1);
  await page.getByRole('button', {name:'Connect source', exact:true}).click();
  await page.getByRole('button', {name:'Connect webcam', exact:true}).click();
  await page.getByRole('button', {name:'View camera wall', exact:true}).click();
  await expect(page.getByLabel('Live AI settings', {exact:true})).toContainText('Generated detector');
  await page.evaluate(() => window.finishOlderCatalogue());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('button', {name:'Start AI', exact:true})).toBeEnabled();
  await expect(page.getByRole('button', {name:'Check again', exact:true})).toHaveCount(0);
});
