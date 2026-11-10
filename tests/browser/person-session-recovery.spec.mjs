import {test, expect} from '@playwright/test';

const person = {id:'b'.repeat(16), name:'Generated Person', created:'2026-11-09T12:00:00.000Z', views:2};
const nav = (page, name) => page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name, exact:true});
async function setup(page, {kind='enroll', hold='import', shortDeadline=false, failureStatus=null}={}) {
  const state = {writes:[], imports:0, release:null};
  await page.addInitScript(({shortDeadline}) => {
    // Generated canvas tracks and recorder bytes only; no browser/device camera.
    window.generatedCameraRequests = 0; window.generatedClock = 0;
    Object.defineProperty(performance, 'now', {configurable:true, value:() => window.generatedClock});
    Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{
      enumerateDevices:async () => [], getUserMedia:async () => {
        window.generatedCameraRequests++;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        canvas.getContext('2d').fillRect(0, 0, 64, 64); return canvas.captureStream(1);
      },
    }});
    window.MediaRecorder = class {
      static isTypeSupported() {return true;}
      constructor(stream, {mimeType}) {this.mimeType=mimeType; this.state='inactive';}
      start() {this.state='recording';} pause() {this.state='paused';} resume() {this.state='recording';}
      stop() {
        this.state='inactive'; queueMicrotask(() => {
          this.ondataavailable?.({data:new Blob(['generated video-only recording bytes'], {type:'video/webm'})}); this.onstop?.();
        });
      }
    };
    if (shortDeadline) {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      Object.defineProperty(AbortSignal, 'timeout', {configurable:true, value:ms => timeout([120000,180000].includes(ms) ? 200 : ms)});
    }
  }, {shortDeadline});
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/analysis/session') return route.fulfill({json:{
      token:'generated-token', ready:true, recording_import:{enabled:true}, training:{enabled:true},
      models:[{id:'generated', name:'Generated detector', profile:'opencv-zoo-yolox-generated'}],
      rules:[{id:'generated-rule', name:'Generated rule', models:['generated']}],
      people:{enabled:true, statement:'Generated test consent'},
    }});
    if (path === '/api/analysis/people' && request.method() === 'GET') return route.fulfill({json:{people:kind === 'baseline' ? [person] : []}});
    if (path === '/api/analysis/recordings') {
      state.imports++;
      if (hold === 'import' && state.imports === 1) await new Promise(resolve => {state.release=resolve;});
      return route.fulfill({json:{sha256:request.headers()['x-dvr-sha256'], recording:{id:'a'.repeat(32)}}}).catch(() => {});
    }
    if (request.method() === 'POST') {
      state.writes.push(path);
      if (failureStatus) {state.release=() => {}; return route.fulfill({status:failureStatus,json:{error:{message:'Generated template response failure'}}});}
      if (hold === 'template') await new Promise(resolve => {state.release=resolve;});
      return route.fulfill({json:{person, baseline:{usable:2,matched:2,rate:1}}}).catch(() => {});
    }
    return route.fulfill({status:503, json:{error:{message:'No native operation exists in this generated fixture.'}}});
  });
  await page.goto('/#train');
  await expect(page.getByRole('button', {name:'Start session', exact:true})).toBeEnabled();
  if (kind === 'baseline') await page.getByRole('button', {name:'Check baseline', exact:true}).click();
  else {
    await page.getByRole('button', {name:'Enroll a person', exact:true}).click();
    await page.getByLabel('Person’s name', {exact:true}).fill(person.name);
    await page.getByRole('checkbox', {name:'Generated Person is here and agrees to enrollment', exact:true}).check();
    await page.getByRole('button', {name:'Continue to face capture', exact:true}).click();
  }
  await page.getByRole('button', {name:'Connect camera', exact:true}).click();
  await page.getByRole('button', {name:kind === 'baseline' ? 'Start baseline check' : 'Start face capture', exact:true}).click();
  await page.evaluate(() => {window.generatedClock=3000;});
  await expect(page.locator('.take-phase')).toContainText('Prompt 1');
  await page.evaluate(end => {window.generatedClock=end;}, kind === 'baseline' ? 15000 : 23000);
  await expect.poll(() => Boolean(state.release)).toBe(true);
  return state;
}

async function leave(page, target) {
  const ready = page.waitForEvent('dialog');
  const action = target === 'Exit' ? page.getByRole('button', {name:'Exit', exact:true}).click() : nav(page, 'Events').click();
  const dialog = await ready; await dialog.accept(); await action;
}

for (const kind of ['enroll', 'baseline']) for (const target of ['Exit', 'Events']) test(`${kind}: ${target} during import aborts the request before any new template write`, async ({page}) => {
  const state = await setup(page, {kind});
  const cancelled = page.waitForEvent('requestfailed', {predicate:request => new URL(request.url()).pathname === '/api/analysis/recordings'});
  await leave(page, target); state.release(); await cancelled;
  await expect(page.getByRole('heading', {name:target === 'Exit' ? 'Train' : 'Event history', exact:true})).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('a timed-out person import keeps the same recording available for a successful retry', async ({page}) => {
  const state = await setup(page, {shortDeadline:true});
  const retained = page.getByRole('region', {name:'Retained person recording'});
  await expect(retained).toBeVisible();
  await expect(retained.getByRole('button', {name:'Save person recording', exact:true})).toBeEnabled();
  expect(state.writes).toEqual([]); state.release();
  await retained.getByRole('button', {name:'Retry this recording', exact:true}).click();
  await expect(page.getByRole('button', {name:'Run the baseline check', exact:true})).toBeVisible();
  expect(state.imports).toBe(2); expect(state.writes).toEqual(['/api/analysis/people']);
  expect(await page.evaluate(() => window.generatedCameraRequests)).toBe(1);
});

test('a timed-out submitted template operation stays uncertain and preserves its recording without offering a duplicate write', async ({page}) => {
  const state = await setup(page, {hold:'template', shortDeadline:true});
  await expect(page.getByRole('alert')).toContainText('already submitted and may still finish');
  const retained = page.getByRole('region', {name:'Retained person recording'});
  await expect(retained.getByRole('button', {name:'Save person recording', exact:true})).toBeEnabled();
  await expect(retained.getByRole('button', {name:'Retry this recording', exact:true})).toHaveCount(0);
  expect(state.writes).toEqual(['/api/analysis/people']); state.release();
  await expect(page.getByRole('button', {name:'Run the baseline check', exact:true})).toHaveCount(0);
});

for (const failureStatus of [500,409,422]) test(`a submitted template response ${failureStatus} ${failureStatus === 500 ? 'stays uncertain without duplicate retry' : 'keeps the refused recording retryable'}`, async ({page}) => {
  const state = await setup(page, {hold:'none',failureStatus});
  const retained = page.getByRole('region', {name:'Retained person recording'});
  await expect(retained.getByRole('button', {name:'Save person recording', exact:true})).toBeEnabled();
  if (failureStatus === 500) {
    await expect(page.getByRole('alert')).toContainText('already submitted and may still finish');
    await expect(retained.getByRole('button', {name:'Retry this recording', exact:true})).toHaveCount(0);
  } else await expect(retained.getByRole('button', {name:'Retry this recording', exact:true})).toBeEnabled();
  expect(state.writes).toEqual(['/api/analysis/people']);
});
