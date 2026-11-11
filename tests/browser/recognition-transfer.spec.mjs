import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {recognitionFixture} from '../fixtures/recognition.mjs';

const nav = (page,name) => page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:new RegExp('^'+name)});
const upload = value => ({name:'generated-results.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
const queue = page => page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1') || '[]'));
const sending = page => page.getByRole('button',{name:'Saving stills…',exact:true});
const send = page => page.getByRole('button',{name:'Send 2 observations to Events',exact:true});

function twoObservations(sha, camera = 'test-recording') {
  const bundle = recognitionFixture(sha);
  const first = {...bundle.receipt.events[0],camera};
  bundle.receipt.camera = bundle.trace.camera = camera;
  bundle.receipt.events = bundle.trace.events = [first,{...first,id:'generated-second',seconds:.5,started_seconds:.5}];
  return bundle;
}

async function setup(page) {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    window.generatedWrites = 0; window.generatedCompletions = {};
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'thumbnails') {
        const index = ++window.generatedWrites;
        if (index <= 2) {
          const tx = this.transaction;
          Object.defineProperty(tx,'oncomplete',{set(handler) {
            tx.addEventListener('complete',event => {window.generatedCompletions[index] = () => handler(event);},{once:true});
          }});
        }
      }
      return put.apply(this,args);
    };
  });
  await page.goto('/#recognition');
  await page.getByRole('button',{name:/^Open saved results/}).click();
  // Generated canvas video only; no camera or external footage is used.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'), stream = canvas.captureStream(10), chunks = [];
    const recorder = new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => recorder.onstop = resolve);
    recorder.start();
    for (let i=0;i<12;i++) {
      context.fillStyle = i%2 ? '#206c76' : '#447783'; context.fillRect(0,0,320,240);
      await new Promise(resolve => setTimeout(resolve,100));
    }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const buffer = Buffer.from(bytes), sha = createHash('sha256').update(buffer).digest('hex');
  const file = {name:'generated.webm',mimeType:'video/webm',buffer};
  await page.getByLabel('Open recognition results').setInputFiles(upload(twoObservations(sha)));
  await page.getByLabel('Match original recording').setInputFiles(file);
  await expect(page.locator('#recognition-review-status')).toContainText('fingerprint matched');
  return file;
}
async function begin(page, double = false) {
  if (double) await send(page).evaluate(button => {button.click(); button.click();});
  else await send(page).click();
  await expect.poll(() => page.evaluate(() => typeof window.generatedCompletions[1])).toBe('function');
  expect(await page.evaluate(() => window.generatedWrites)).toBe(1);
}

test('cancelled Recognition stills cannot queue or clear a newer transfer', async ({page}) => {
  await setup(page); await begin(page,true);
  await page.screenshot({path:'qa-local/workspace-audit/recognition-transfer-pending.png',fullPage:true});
  await page.getByRole('button',{name:'Cancel sending to Events',exact:true}).click();
  await expect(send(page)).toBeEnabled();
  await expect(page.locator('#recognition-review-status')).toContainText('nothing was sent');
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({path:'qa-local/workspace-audit/recognition-transfer-cancelled.png',fullPage:true});
  await send(page).click();
  await expect.poll(() => page.evaluate(() => typeof window.generatedCompletions[2])).toBe('function');
  await page.evaluate(() => window.generatedCompletions[1]());
  await expect(sending(page)).toBeDisabled();
  expect(await queue(page)).toEqual([]);
  expect(await page.evaluate(() => window.generatedWrites)).toBe(2);
  await page.evaluate(() => window.generatedCompletions[2]());
  await expect(page).toHaveURL(/#events$/);
  await expect(page.locator('.event-table-row')).toHaveCount(2);
  expect(await page.evaluate(() => window.generatedWrites)).toBe(3);
});

for (const replacement of ['results','recording']) test(`replacing ${replacement} cancels the old Recognition handoff`, async ({page}) => {
  const file = await setup(page); await begin(page);
  if (replacement === 'results') await page.getByLabel('Open recognition results').setInputFiles(upload(twoObservations('f'.repeat(64),'replacement-view')));
  else await page.getByLabel('Match original recording').setInputFiles(file);
  await expect(send(page)).toBeEnabled();
  await page.evaluate(() => window.generatedCompletions[1]());
  await expect(page).toHaveURL(/#recognition$/);
  expect(await queue(page)).toEqual([]);
  expect(await page.evaluate(() => window.generatedWrites)).toBe(1);
  await page.screenshot({path:`qa-local/workspace-audit/recognition-replaced-${replacement}.png`,fullPage:true});
});

test('results that finish loading invalidate a Send started during that read', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    const text = File.prototype.text;
    File.prototype.text = function() {
      if(this.name === 'held-results.json') return new Promise(resolve => {window.completeGeneratedResults = async () => resolve(await text.call(this));});
      return text.call(this);
    };
  });
  await page.getByLabel('Open recognition results').setInputFiles({...upload(twoObservations('f'.repeat(64),'replacement-view')),name:'held-results.json'});
  await expect(page.locator('#recognition-review-status')).toContainText('Reading recognition results');
  await begin(page);
  await page.evaluate(() => window.completeGeneratedResults());
  await expect(send(page)).toBeEnabled();
  await page.evaluate(() => window.generatedCompletions[1]());
  expect(await queue(page)).toEqual([]);
  expect(await page.evaluate(() => window.generatedWrites)).toBe(1);
  await expect(page.locator('.recognition-facts')).toContainText('replacement-view');
});

for (const action of ['leaving Recognition','hiding the page']) test(`${action} cancels Send while retaining loaded review`, async ({page}) => {
  await setup(page); await begin(page);
  if (action === 'leaving Recognition') await nav(page,'Events').click();
  else await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.evaluate(() => window.generatedCompletions[1]());
  if (action === 'leaving Recognition') await nav(page,'Recognition').click();
  else await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(send(page)).toBeEnabled();
  await expect(page.locator('#recognition-review-status')).toContainText('nothing was sent');
  expect(await queue(page)).toEqual([]);
  await expect(page.locator('.recognition-facts')).toContainText('recording fingerprint matched');
});
