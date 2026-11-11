import {test, expect} from '@playwright/test';
import {generatedPreview} from '../fixtures/live-preview.mjs';

const nav = (page, name) => page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:new RegExp('^'+name)});
const tile = (page, number) => page.locator('.live-tile').filter({hasText:`Generated DVR ${number}`});

async function localSources(page) {
  const sources = Array.from({length:5}, (_, index) => ({id:`source-${index+1}`,name:`Generated DVR ${index+1}`,kind:'rtsp'}));
  const feeds = new Map(), sessions = new Map();
  const calls = {starts:[], stops:[], disconnects:[], connects:[]};
  await page.route('**/api/analysis/session', route => route.fulfill({json:{
    token:'generated-ai-token', live:{enabled:true, limits:{active_sessions:2},
      models:[{id:'generated-model',name:'Generated detector'}],
      rules:[{id:'presence',name:'Generated presence',models:['generated-model']}]},
  }}));
  await page.route('**/api/feeds/**', route => {
    const path = new URL(route.request().url()).pathname, id = path.split('/')[3];
    if (path.endsWith('/session')) return route.fulfill({json:{token:'generated-feed-token',ready:true,sources}});
    if (path.endsWith('/connect')) {
      const source = sources.find(source => source.id === route.request().postDataJSON().source);
      calls.connects.push(source.id);
      const feed = {id:source.id.padEnd(32,'0'),name:source.name,kind:'rtsp',state:'live',frame_age_seconds:0};
      feeds.set(feed.id,feed); return route.fulfill({json:feed});
    }
    if (path.endsWith('/disconnect')) {
      calls.disconnects.push(id); const feed = {...feeds.get(id),state:'stopped'};
      feeds.set(id,feed); return route.fulfill({json:feed});
    }
    if (path.endsWith('/frame')) return route.fulfill({contentType:'image/jpeg',body:generatedPreview});
    return route.fulfill({json:feeds.get(id)});
  });
  await page.route('**/api/live/**', route => {
    const path = new URL(route.request().url()).pathname, id = path.split('/')[3];
    if (path.endsWith('/start')) {
      const camera = route.request().postDataJSON().camera;
      calls.starts.push(camera);
      const session = {id:calls.starts.length.toString(16).padStart(32,'a'),state:'live',camera,
        model:'Generated detector',rules:'Generated presence',model_sha256:'b'.repeat(64),analyzed:1};
      sessions.set(session.id,{session,delivered:false}); return route.fulfill({json:session});
    }
    const item = sessions.get(id);
    if (path.endsWith('/stop')) {calls.stops.push(id); return route.fulfill({json:{...item.session,state:'stopped'}});}
    if (item.delivered) return; // Hold the next frame; Stop aborts it.
    item.delivered = true;
    return route.fulfill({json:{width:32,height:18,detector:'ran',detections:[],session:item.session,
      observations:[{id:id.replaceAll('a','c'),label:'person',score:.9,seconds:1,rule:'Generated presence'}]}});
  });
  await page.goto('/#monitor');
  return calls;
}

async function connect(page, number) {
  await page.getByRole('button', {name:'Set up local DVR',exact:true}).click();
  const load = page.getByRole('button', {name:'Load configured DVR sources',exact:true});
  if (await load.count()) await load.click();
  await page.getByLabel('DVR channel', {exact:true}).selectOption(`source-${number}`);
  await page.getByRole('button', {name:'Connect DVR channel',exact:true}).click();
  await expect(tile(page,number).getByAltText(`Generated DVR ${number} current preview frame`)).toBeVisible();
}

async function observe(page, number) {
  await tile(page,number).getByRole('button', {name:'Start AI',exact:true}).click();
  await expect(tile(page,number).getByRole('button', {name:'Send to Events',exact:true})).toBeVisible();
}

test('disconnect stops the source and AI while its unsent still stays reviewable', async ({page}) => {
  const calls = await localSources(page);
  await connect(page,1); await observe(page,1);
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  await tile(page,1).getByRole('button', {name:'Disconnect',exact:true}).click();
  await expect(page.locator('.camera-wall img,.camera-wall video')).toHaveCount(0);
  await expect(tile(page,1).getByRole('button', {name:'Send to Events',exact:true})).toBeVisible();
  await expect.poll(() => calls.stops.length).toBe(1);
  await expect.poll(() => calls.disconnects.length).toBe(1);
  await page.screenshot({path:'qa-local/workspace-audit/disconnected-live-review.png',fullPage:true});
  await tile(page,1).getByRole('button', {name:'Send to Events',exact:true}).click();
  await expect(tile(page,1)).toHaveCount(0);
  await nav(page,'Events').click();
  await expect(page.locator('.review-summary')).toContainText('1 live observations');
  await page.locator('.event-table-row').first().click();
  await expect(page.getByRole('dialog').getByAltText('Analyzed live frame for this observation')).toBeVisible();
  expect(calls.starts).toHaveLength(1);
});

test('pending live review protects workspace navigation until sent or explicitly discarded', async ({page}) => {
  const calls = await localSources(page);
  await connect(page,1); await observe(page,1);
  const dialogs = [];
  page.once('dialog', async dialog => {dialogs.push(dialog.message()); await dialog.dismiss();});
  await nav(page,'Events').click();
  await expect(page.getByRole('heading', {name:'Monitor',exact:false}).first()).toBeVisible();
  expect(dialogs).toHaveLength(1); expect(dialogs[0]).toContain('unsent live');
  await expect(tile(page,1).getByRole('button', {name:'Send to Events',exact:true})).toBeVisible();
  expect(calls.stops).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await nav(page,'Events').click();
  await expect(page.getByRole('heading', {name:'Event history',exact:true})).toBeVisible();
  await expect.poll(() => calls.stops.length).toBe(1);
  await nav(page,'Monitor').click();
  await expect(page.getByRole('region', {name:'Start camera monitoring'})).toBeVisible();
  expect(calls.starts).toHaveLength(1);
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
});

for (const action of ['Disconnect all','hide the page']) test(`${action} stops immediately while retaining pending review`, async ({page}) => {
  const calls = await localSources(page);
  await connect(page,1); await observe(page,1);
  const dialogs = [];
  page.on('dialog', async dialog => {dialogs.push(dialog.message()); await dialog.dismiss();});
  if (action === 'Disconnect all') await page.getByRole('button',{name:action,exact:true}).click();
  else {
    await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await expect.poll(() => calls.stops.length).toBe(1);
    await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  }
  await expect.poll(() => calls.stops.length).toBe(1);
  await expect.poll(() => calls.disconnects.length).toBe(1);
  await expect(page.locator('.camera-wall img,.camera-wall video')).toHaveCount(0);
  await expect(tile(page,1).getByRole('button',{name:'Send to Events',exact:true})).toBeVisible();
  expect(dialogs).toEqual([]); expect(calls.starts).toHaveLength(1); expect(calls.connects).toHaveLength(1);
});

test('a failed still save keeps the disconnected observation until a successful retry', async ({page}) => {
  await page.addInitScript(() => {window.generatedIDB = window.indexedDB; Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});});
  await localSources(page);
  await connect(page,1); await observe(page,1);
  await tile(page,1).getByRole('button',{name:'Disconnect',exact:true}).click();
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(page.locator('.toast')).toContainText('could not save the observation’s still');
  await expect(tile(page,1).getByRole('button',{name:'Send to Events',exact:true})).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1') || '[]'))).toEqual([]);
  await page.evaluate(() => Object.defineProperty(window,'indexedDB',{configurable:true,value:window.generatedIDB}));
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(tile(page,1)).toHaveCount(0);
  await nav(page,'Events').click();
  await expect(page.locator('.review-summary')).toContainText('1 live observations');
});

test('a slow Send blocks overlapping saves and Dismiss while camera Stop stays available', async ({page}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    window.generatedStillWrites = 0;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'thumbnails') {
        window.generatedStillWrites++;
        window.completeGeneratedSave = null;
        const tx = this.transaction;
        // Let the real local write finish, but delay its completion notification.
        Object.defineProperty(tx,'oncomplete',{set(handler) {
          tx.addEventListener('complete', event => {window.completeGeneratedSave = () => handler(event);},{once:true});
        }});
      }
      return put.apply(this,args);
    };
  });
  const calls = await localSources(page);
  await connect(page,1); await observe(page,1);
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(tile(page,1).getByRole('button',{name:'Saving still…',exact:true})).toBeDisabled();
  await expect(tile(page,1).getByRole('button',{name:'Dismiss this live observation',exact:true})).toBeDisabled();
  await tile(page,1).getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect.poll(() => calls.stops.length).toBe(1);
  await expect.poll(() => calls.disconnects.length).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await nav(page,'Events').click();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  await nav(page,'Monitor').click();
  await connect(page,2); await observe(page,2);
  await tile(page,2).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(page.locator('.toast')).toContainText('Another live still is being saved');
  expect(await page.evaluate(() => window.generatedStillWrites)).toBe(1);
  await expect.poll(() => page.evaluate(() => typeof window.completeGeneratedSave)).toBe('function');
  await page.evaluate(() => window.completeGeneratedSave());
  await expect(page.locator('.toast')).toContainText('1 new observations added');
  await tile(page,2).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.generatedStillWrites)).toBe(2);
  await expect.poll(() => page.evaluate(() => typeof window.completeGeneratedSave)).toBe('function');
  await page.evaluate(() => window.completeGeneratedSave());
  await expect(tile(page,2).getByText('In Events',{exact:true})).toBeVisible();
  await nav(page,'Events').click();
  await expect(page.locator('.review-summary')).toContainText('2 live observations');
});

test('a stalled still save releases Send without a late Event handoff, then permits retry', async ({page}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    let held = false;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'thumbnails' && !held) {
        held = true;
        const tx = this.transaction;
        // The real write completes; withhold the browser completion notification.
        Object.defineProperty(tx,'oncomplete',{set(handler) {
          tx.addEventListener('complete',event => {window.completeGeneratedStall = () => handler(event);},{once:true});
        }});
      }
      return put.apply(this,args);
    };
  });
  const calls = await localSources(page);
  await connect(page,1); await observe(page,1);
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(tile(page,1).getByRole('button',{name:'Saving still…',exact:true})).toBeDisabled();
  await tile(page,1).getByRole('button',{name:'Disconnect',exact:true}).click();
  await expect.poll(() => calls.stops.length).toBe(1);
  await expect.poll(() => calls.disconnects.length).toBe(1);
  await expect(page.locator('.toast')).toContainText('could not save the observation’s still',{timeout:9000});
  await expect(tile(page,1).getByRole('button',{name:'Send to Events',exact:true})).toBeEnabled();
  await expect(tile(page,1).getByRole('button',{name:'Dismiss this live observation',exact:true})).toBeEnabled();
  await page.screenshot({path:'qa-local/workspace-audit/still-save-timeout.png',fullPage:true});
  await expect.poll(() => page.evaluate(() => typeof window.completeGeneratedStall)).toBe('function');
  await page.evaluate(() => window.completeGeneratedStall());
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1') || '[]'))).toEqual([]);
  await expect(tile(page,1).getByRole('button',{name:'Send to Events',exact:true})).toBeEnabled();
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(tile(page,1)).toHaveCount(0);
  await nav(page,'Events').click();
  await expect(page.locator('.review-summary')).toContainText('1 live observations');
});

test('a stalled database open stays bounded and closes its late connection before retry', async ({page}) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open, close = IDBDatabase.prototype.close;
    let hold = true;
    window.generatedImageOpens = 0; window.generatedImageCloses = 0;
    window.resumeGeneratedImageOpen = () => {hold = false; window.completeGeneratedOpen();};
    IDBDatabase.prototype.close = function() {
      if (this.name === 'intelligent-dvr') window.generatedImageCloses++;
      return close.call(this);
    };
    IDBFactory.prototype.open = function(name,...args) {
      const request = open.call(this,name,...args);
      if (name === 'intelligent-dvr') {
        window.generatedImageOpens++;
        if (hold) Object.defineProperty(request,'onsuccess',{set(handler) {
          request.addEventListener('success',event => {window.completeGeneratedOpen = () => handler(event);},{once:true});
        }});
      }
      return request;
    };
  });
  await localSources(page); await connect(page,1); await observe(page,1);
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(page.locator('.toast')).toContainText('could not save the observation’s still',{timeout:9000});
  await expect(tile(page,1).getByRole('button',{name:'Send to Events',exact:true})).toBeEnabled();
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(tile(page,1).getByRole('button',{name:'Send to Events',exact:true})).toBeEnabled();
  expect(await page.evaluate(() => window.generatedImageOpens)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1') || '[]'))).toEqual([]);
  await expect.poll(() => page.evaluate(() => typeof window.completeGeneratedOpen)).toBe('function');
  await page.evaluate(() => window.resumeGeneratedImageOpen());
  expect(await page.evaluate(() => window.generatedImageCloses)).toBe(1);
  await tile(page,1).getByRole('button',{name:'Send to Events',exact:true}).click();
  await expect(tile(page,1).getByText('In Events',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => window.generatedImageOpens)).toBe(2);
  await nav(page,'Events').click();
  await expect(page.locator('.review-summary')).toContainText('1 live observations');
  await page.locator('.event-table-row').first().click();
  await expect(page.getByRole('dialog').getByAltText('Analyzed live frame for this observation')).toBeVisible();
});

test('four retained review sessions bound admission without blocking camera preview', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const calls = await localSources(page);
  for (let number=1; number<=4; number++) {
    await connect(page,number); await observe(page,number);
    await tile(page,number).getByRole('button', {name:'Disconnect',exact:true}).click();
    await expect(tile(page,number).getByRole('button', {name:'Send to Events',exact:true})).toBeVisible();
  }
  await connect(page,5);
  await expect(tile(page,5).getByRole('button', {name:'Start AI',exact:true})).toBeDisabled();
  await expect(page.getByText('Live review slots are full.', {exact:false})).toBeVisible();
  expect(calls.starts).toHaveLength(4);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({path:'qa-local/workspace-audit/full-live-review-mobile.png',fullPage:true});
  await page.locator('.live-source').filter({hasText:'Generated DVR 1'}).click();
  await tile(page,1).getByRole('button', {name:'Dismiss this live observation',exact:true}).click();
  await expect(tile(page,1)).toHaveCount(0);
  await expect(tile(page,5).getByRole('button', {name:'Start AI',exact:true})).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({path:'qa-local/workspace-audit/bounded-live-review-mobile.png',fullPage:true});
});
