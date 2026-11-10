import { test, expect } from '@playwright/test';
import { liveObservationEvent } from '../../src/live-ai.mjs';
import { observationImageKey } from '../../src/local-images.mjs';
import { THUMBNAIL_REFERENCES_LOCK, THUMBNAIL_PRUNE_LOCK } from '../../src/thumbnail-retention.mjs';

const generated = () => liveObservationEvent({id:'c'.repeat(32),label:'person',score:.91,seconds:3.2,rule:'generated presence'},
  {id:'a'.repeat(32),camera:'Generated gate',model_sha256:'b'.repeat(64)}, Date.UTC(2026,10,9,18));

test.beforeEach(async ({context}) => {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/generated-lock-host') return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Generated lock host</title>'});
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503,json:{error:{message:'No native service in generated retention tests'}}});
    return route.continue();
  });
  await context.addInitScript(({pruneLock}) => {
    window.generatedPruneAttempts = 0; window.generatedReviewReads = 0;
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) { if (key === 'dvr.events.v1') window.generatedReviewReads++; return get.call(this,key); };
    const request = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = (name,...args) => { if (name === pruneLock) window.generatedPruneAttempts++; return request(name,...args); };
  }, {pruneLock:THUMBNAIL_PRUNE_LOCK});
});

async function seed(host, event) {
  await host.goto('/generated-lock-host');
  await host.evaluate(async ({event,key}) => {
    localStorage.setItem('dvr.events.v1',JSON.stringify([event]));
    const canvas = document.createElement('canvas'); canvas.width=32; canvas.height=18;
    canvas.getContext('2d').fillRect(0,0,32,18);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg'));
    await new Promise((resolve,reject) => {
      const opening=indexedDB.open('intelligent-dvr',1);
      opening.onupgradeneeded=()=>{for(const name of ['thumbnails','zone-stills']) if(!opening.result.objectStoreNames.contains(name)) opening.result.createObjectStore(name);};
      opening.onerror=()=>reject(opening.error);
      opening.onsuccess=()=>{
        const db=opening.result,tx=db.transaction('thumbnails','readwrite');
        tx.objectStore('thumbnails').put({blob,at:Date.now()-120000},key);
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };
    });
  }, {event,key:observationImageKey(event)});
}
async function storedImage(page, event) {
  return page.evaluate(key => new Promise((resolve,reject) => {
    const opening=indexedDB.open('intelligent-dvr',1);opening.onerror=()=>reject(opening.error);
    opening.onsuccess=()=>{
      const db=opening.result,request=db.transaction('thumbnails','readonly').objectStore('thumbnails').get(key);
      request.onsuccess=()=>{db.close();resolve(Boolean(request.result?.blob));};request.onerror=()=>reject(request.error);
    };
  }),observationImageKey(event));
}
async function cleanupSettled(page) {
  // Waiting for an attempted prune is insufficient: drain its lock before
  // reading the image, so a delayed destructive cursor could not pass the test.
  await page.evaluate(name => navigator.locks.request(name,{mode:'exclusive'},()=>true),THUMBNAIL_PRUNE_LOCK);
}

test('another tab cannot prune an older live still while Clear queue Undo retains it',async ({page,context}) => {
  const event=generated(); await seed(page,event); await page.goto('/#events');
  const peer=await context.newPage(); await peer.goto('/#events');
  await expect(page.locator('.event-table-row img.event-still')).toHaveCount(1);
  await expect(peer.locator('.event-table-row img.event-still')).toHaveCount(1);
  const attempts=await peer.evaluate(()=>window.generatedPruneAttempts);
  await page.getByRole('button',{name:'Clear queue',exact:true}).click();
  await page.getByRole('button',{name:'Clear queue now',exact:true}).click();
  await expect(peer.getByRole('heading',{name:'Your review queue is empty',exact:true})).toBeVisible();
  await expect.poll(()=>peer.evaluate(()=>window.generatedPruneAttempts)).toBeGreaterThan(attempts);
  await cleanupSettled(peer);
  expect(await storedImage(page,event)).toBe(true);
  await page.getByRole('button',{name:'Undo clear',exact:true}).click();
  await expect(page.locator('.event-table-row img.event-still')).toHaveCount(1);
  expect(await storedImage(page,event)).toBe(true); await peer.close();
});

test('opening during an exclusive prune waits before reading the browser review queue',async ({page,context}) => {
  await page.goto('/generated-lock-host');
  await page.evaluate(name => {
    window.generatedExclusiveStarted=false;
    void navigator.locks.request(name,{mode:'exclusive'},async()=>{
      window.generatedExclusiveStarted=true;
      await new Promise(resolve=>{window.finishGeneratedExclusive=resolve;});
    });
  },THUMBNAIL_REFERENCES_LOCK);
  await expect.poll(()=>page.evaluate(()=>window.generatedExclusiveStarted)).toBe(true);
  const opening=await context.newPage();await opening.goto('/#settings');
  await expect(opening.getByRole('heading',{name:'Opening workspace…',exact:true})).toBeVisible();
  expect(await opening.evaluate(()=>window.generatedReviewReads)).toBe(0);
  await page.evaluate(()=>window.finishGeneratedExclusive());
  await expect(opening.getByRole('heading',{name:'Connections and local evidence',exact:true})).toBeVisible();
  expect(await opening.evaluate(()=>window.generatedReviewReads)).toBeGreaterThan(0);
  await opening.close();
});

test('an orphaned note draft keeps its live image while its saved queue entry is removed',async ({page,context}) => {
  const host=await context.newPage(),event=generated();await seed(host,event);await page.goto('/#events');
  await page.locator('.event-table-row').click();
  await page.getByLabel('Review note',{exact:true}).fill('Retained generated evidence note');
  await host.evaluate(()=>localStorage.setItem('dvr.events.v1','[]'));
  await expect(page.getByRole('dialog',{name:'Review observation',exact:true})).toContainText('no longer');
  await page.keyboard.press('Escape');
  const attempts=await page.evaluate(()=>window.generatedPruneAttempts);
  await expect.poll(()=>page.evaluate(()=>window.generatedPruneAttempts)).toBeGreaterThan(attempts);
  await cleanupSettled(page);
  expect(await storedImage(page,event)).toBe(true);
  await page.getByRole('button',{name:'Review note drafts',exact:true}).click();
  await page.getByRole('button',{name:'Resume note draft',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Review observation',exact:true}).locator('img.event-still')).toHaveCount(1);
  await host.close();
});
