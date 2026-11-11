import {test, expect} from '@playwright/test';

// Chromium's built-in generated video is stable across headless CI. No physical
// webcam or camera permission dialog is involved.
test.use({permissions:['camera'], launchOptions:{args:[
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
]}});

const session = {id:'a'.repeat(32), state:'live', camera:'This computer’s webcam', model:'Generated detector',
  rules:'Generated rules', model_sha256:'b'.repeat(64), analyzed:1};

async function generatedMonitor(page, {startReply = session, waitForFrame = true} = {}) {
  let starts = 0;
  const stops = [];
  const frames = [];
  await page.route('**/api/analysis/session', route => route.fulfill({json:{
    token:'generated-token', live:{enabled:true, limits:{active_sessions:2},
      models:[{id:'generated-model',name:'Generated detector'}],
      rules:[{id:'generated-rule',name:'Generated rules',models:['generated-model']}]},
  }}));
  await page.route('**/api/live/start', route => {starts++; return route.fulfill({json:startReply});});
  await page.route('**/api/live/*/stop', route => {stops.push(route.request().url()); return route.fulfill({json:{...session,state:'stopped'}});});
  await page.route('**/api/live/*/frame', route => {frames.push(route);});
  await page.goto('/#monitor');
  await page.getByRole('button', {name:'Connect source', exact:true}).click();
  await page.getByRole('button', {name:'Connect webcam', exact:true}).click();
  await expect(page.locator('.feed-setup-body [role="status"]')).toContainText('Webcam preview · audio off');
  await page.getByRole('button', {name:'View camera wall', exact:true}).click();
  await expect(page.getByRole('button', {name:'Start AI', exact:true})).toBeEnabled();
  expect(starts).toBe(0);
  await page.getByRole('button', {name:'Start AI', exact:true}).click();
  if (waitForFrame) await expect.poll(() => frames.length).toBeGreaterThan(0);
  return {
    frames, stops,
    ai:page.locator('.live-ai'),
    async reply(data, status = 200) {
      await expect.poll(() => frames.length).toBeGreaterThan(0);
      await frames.shift().fulfill({status,json:status === 200
        ? {width:64,height:64,detector:'ran',observations:[],detections:[],timing:{total_ms:5},session,...data}
        : data});
    },
  };
}

for (const [problem, badReply, width = 1440] of [
  ['malformed detections', {detections:{label:'person'}}],
  ['malformed observation score', {observations:[{id:'d'.repeat(32),label:'person',score:{value:.9},seconds:1,rule:'Generated invalid rule'}]}],
  ['a mismatched session', {session:{...session,id:'e'.repeat(32)}}],
  ['malformed detections on a narrow screen', {detections:{label:'person'}},390],
]) test(`Monitor rejects ${problem} while retaining preview and earlier review`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  const {ai, reply, stops} = await generatedMonitor(page);
  const track = await page.locator('.live-picture video').evaluate(el => el.srcObject.getVideoTracks()[0].id);
  await reply({observations:[{id:'c'.repeat(32),label:'person',score:.9,seconds:1,rule:'Generated valid rule'}]});
  await expect(ai.getByRole('listitem')).toHaveCount(1);
  await reply(badReply);
  await expect(ai.getByRole('alert')).toContainText('invalid or mismatched reply');
  await expect(ai.getByRole('listitem')).toHaveCount(1);
  await expect(ai.getByRole('listitem')).toContainText('Generated valid rule');
  await expect(page.getByRole('img',{name:'Live AI detections on the analyzed frame'})).toHaveCount(0);
  expect(await page.locator('.live-picture video').evaluate(el => ({id:el.srcObject.getVideoTracks()[0].id,state:el.srcObject.getVideoTracks()[0].readyState}))).toEqual({id:track,state:'live'});
  await expect.poll(() => stops.length).toBe(1);
  expect(stops[0]).toContain(`/api/live/${session.id}/stop`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (problem.startsWith('malformed detections')) {
    await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({path:`qa-local/live-reply-validation/recovery-${width}.png`,fullPage:true});
  }
  await ai.getByRole('button',{name:'Start AI',exact:true}).click();
  await expect(ai).toContainText('Waiting for the first analyzed frame');
  await reply({});
  await ai.getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(ai.getByText('In Events',{exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Events/}).click();
  await expect(page.locator('.review-summary')).toContainText('1 live observations');
});

test('a malformed successful startup cannot submit camera frames', async ({page}) => {
  const {ai,frames} = await generatedMonitor(page,{startReply:{...session,id:'invalid-session'},waitForFrame:false});
  await expect(ai.getByRole('alert')).toContainText('invalid or mismatched reply');
  expect(frames).toHaveLength(0);
  await expect(page.locator('.live-picture video')).toBeVisible();
});

test('live counts wait for a reply, expire with boxes and recover on a fresh frame', async ({page}) => {
  const {ai, reply} = await generatedMonitor(page);
  await expect(ai).toContainText('Waiting for the first analyzed frame');
  await expect(ai).not.toContainText('Nothing detected');
  await reply({detections:[{label:'person',score:.9,box:[.1,.1,.2,.5],track:1}]});
  await expect(ai.locator('.live-ai-count')).toHaveText('1 person');
  await expect(page.getByRole('img', {name:'Live AI detections on the analyzed frame'})).toBeVisible();
  await expect(ai).toContainText('AI delayed · counts and boxes hidden');
  await expect(ai.locator('.live-ai-count')).toHaveCount(0);
  await expect(page.getByRole('img', {name:'Live AI detections on the analyzed frame'})).toHaveCount(0);
  // This outstanding frame was captured before we waited for expiry. Its late
  // reply must stay stale; only a newly captured frame can restore fresh counts.
  await reply({});
  await expect(ai).toContainText('AI delayed · counts and boxes hidden');
  await reply({});
  await expect(ai).toContainText('Nothing detected in the analyzed frame');
  await reply({error:{code:'FRAME_INVALID',message:'Generated rejected frame'}},400);
  await expect(ai).toContainText('1 rejected frame');
  await reply({error:{code:'BUSY',message:'Generated busy worker'}},429);
  await expect(ai).toContainText('1 dropped while busy');
});

for (const width of [1440,390]) test(`unsent live-observation overflow remains visible after stop and restart at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  const {ai, reply} = await generatedMonitor(page);
  await reply({observations:Array.from({length:21}, (_, index) => ({
    id:index.toString(16).padStart(32,'0'), label:'person',score:.9,seconds:index,
    rule:`Generated rule ${index}.`,
  }))});
  const warning = ai.getByRole('status').filter({hasText:'1 unsent observation was replaced'});
  await expect(warning).toBeVisible();
  await expect(ai.getByRole('list', {name:'Live AI observations'}).getByRole('listitem')).toHaveCount(20);
  await expect(ai.getByRole('list', {name:'Live AI observations'})).not.toContainText('Generated rule 0.');
  await expect(ai.getByRole('list', {name:'Live AI observations'})).toContainText('Generated rule 20.');
  await page.getByRole('button', {name:'Stop AI', exact:true}).click();
  await expect(warning).toBeVisible();
  await page.getByRole('button', {name:'Start AI', exact:true}).click();
  await expect(warning).toBeVisible();
  await expect(ai).toContainText('Waiting for the first analyzed frame');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:`qa-local/workspace-audit/live-ai-overflow-${width}.png`,fullPage:true});
});
