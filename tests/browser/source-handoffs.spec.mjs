import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {recognitionFixture, sharpeningFixture} from '../fixtures/recognition.mjs';
import {parseReceipt} from '../../src/data.mjs';

const nav = (page, name) => page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:new RegExp(`^${name}`)});
const tasks = page => page.getByRole('group', {name:'Recognition tasks'});
const upload = bundle => ({name:'generated-review.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(bundle))});
async function setup(page, bundle=recognitionFixture()) {
  const writes = [];
  await page.addInitScript(events => {
    if (localStorage.getItem('dvr.events.v1') === null) localStorage.setItem('dvr.events.v1', JSON.stringify(events));
    Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{
      enumerateDevices:async () => [], getUserMedia:async () => {throw Error('No device access in generated source handoff tests');},
    }});
  }, parseReceipt(bundle.receipt));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') writes.push(url.pathname);
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503, json:{error:{message:'Generated test has no native service'}}});
    return route.continue();
  });
  return writes;
}
async function followObservation(page) {
  await nav(page, 'Events').click();
  await page.locator('.event-table-row').first().click();
  await page.getByRole('dialog', {name:'Review observation', exact:true}).getByRole('button', {name:'Open in Recognition', exact:true}).click();
  await expect(page).toHaveURL(/#recognition$/);
  await expect(tasks(page).getByRole('button', {name:/^Open saved results/})).toHaveAttribute('aria-pressed', 'true');
}
async function stableFocus(page, target) {
  await expect(target).toBeFocused();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
}

test('a source request reveals and focuses imports after Backup, without starting or replacing anything', async ({page}) => {
  const writes = await setup(page);
  await page.goto('/#recognition');
  await tasks(page).getByRole('button', {name:/^Use my existing DVR/}).click();
  await followObservation(page);
  const panel = page.getByRole('region', {name:'Open saved recognition results', exact:true});
  await stableFocus(page, panel);
  await expect(page.getByLabel('Open recognition results', {exact:true})).toBeVisible();
  await expect(panel).toContainText('test-recording · Clip +0.0s');
  await expect(panel).toContainText('Open its results file, then match its original recording.');
  await expect(page).toHaveTitle('Recognition · Intelligent DVR');
  await expect(page.getByRole('status').filter({hasText:'Recognition workspace opened.'})).toBeVisible();
  expect(writes).toEqual([]);
});

test('a first visit from Events focuses its source step after the lazy workspace mounts', async ({page}) => {
  await setup(page); await page.goto('/#events');
  await followObservation(page);
  await stableFocus(page, page.getByRole('region', {name:'Open saved recognition results', exact:true}));
  await expect(page.getByLabel('Match original recording', {exact:true})).toBeDisabled();
});

test('unrelated loaded results remain intact until the operator opens the matching receipt', async ({page}) => {
  const requested = recognitionFixture();
  const writes = await setup(page, requested);
  const unrelated = recognitionFixture('e'.repeat(64));
  unrelated.receipt.camera = unrelated.trace.camera = 'Other generated recording';
  unrelated.receipt.events[0].camera = 'Other generated recording';
  await page.goto('/#recognition');
  await tasks(page).getByRole('button', {name:/^Open saved results/}).click();
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(unrelated));
  await page.getByRole('button', {name:'Next sample', exact:true}).click();
  await tasks(page).getByRole('button', {name:/^Record a LAN camera/}).click();
  await followObservation(page);
  await stableFocus(page, page.getByRole('region', {name:'Open saved recognition results', exact:true}));
  await expect(page.locator('.recognition-facts')).toContainText('Other generated recording');
  await expect(page.getByLabel('Analyzed sample', {exact:true})).toHaveValue('1');
  await expect(page.locator('.recognition-status')).toContainText('belongs to recording');
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(requested));
  await stableFocus(page, page.getByLabel('Match original recording', {exact:true}));
  await expect(page.locator('.recognition-status')).toContainText('matching results contain the observation');
  await expect(page.locator('.recognition-facts')).toContainText('test-recording');
  expect(writes).toEqual([]);
});

test('a matched source opens its original observation frame, then ordinary navigation preserves further review', async ({page}) => {
  // Generated canvas footage only; this does not exercise cameras or recognition quality.
  await page.goto('/#settings');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=240;
    const context=canvas.getContext('2d'), stream=canvas.captureStream(10), chunks=[];
    const recorder=new MediaRecorder(stream, {mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable=event => chunks.push(event.data);
    const stopped=new Promise(resolve => {recorder.onstop=resolve;}); recorder.start();
    for (let i=0; i<12; i++) {context.fillStyle=i%2 ? '#17483e' : '#22475d'; context.fillRect(0,0,320,240); await new Promise(resolve => setTimeout(resolve,100));}
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const buffer = Buffer.from(bytes), sha = createHash('sha256').update(buffer).digest('hex');
  const bundle = sharpeningFixture(sha); bundle.receipt.events[0].seconds = .5;
  const writes = await setup(page, bundle); await page.goto('/#recognition'); await page.reload();
  await tasks(page).getByRole('button', {name:/^Open saved results/}).click();
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(bundle));
  await page.getByLabel('Match original recording', {exact:true}).setInputFiles({name:'generated-source.webm', mimeType:'video/webm', buffer});
  await expect(page.locator('.recognition-status')).toContainText('fingerprint matched');
  await page.getByLabel('Detection input', {exact:true}).selectOption('sharpened');
  await tasks(page).getByRole('button', {name:/^Use my existing DVR/}).click();
  await followObservation(page);
  await stableFocus(page, page.getByRole('region', {name:'Source observation review', exact:true}));
  await expect(page.getByLabel('Analyzed sample', {exact:true})).toHaveValue('1');
  await expect(page.getByLabel('Detection input', {exact:true})).toHaveValue('original');
  await expect(page.locator('.recognition-status')).toContainText('source-matched sampled frame');
  await page.getByRole('button', {name:'Previous sample', exact:true}).click();
  await nav(page, 'Events').click(); await nav(page, 'Recognition').click();
  await expect(page.getByRole('main', {name:'Recognition workspace', exact:true})).toBeFocused();
  await expect(page.getByLabel('Analyzed sample', {exact:true})).toHaveValue('0');
  expect(writes).toEqual([]);
});

test('closing a source request keeps loaded results and releases the pending handoff', async ({page}) => {
  await setup(page); await page.goto('/#events'); await followObservation(page);
  await page.getByRole('button', {name:'Close source request', exact:true}).click();
  await expect(page.getByRole('region', {name:'Open saved recognition results', exact:true})).toBeFocused();
  await expect(page.getByText('Review the source observation', {exact:true})).toHaveCount(0);
  await tasks(page).getByRole('button', {name:/^Analyze a recording/}).click();
  await nav(page, 'Events').click(); await nav(page, 'Recognition').click();
  await expect(tasks(page).getByRole('button', {name:/^Analyze a recording/})).toHaveAttribute('aria-pressed', 'true');
});

test('a background analysis keeps its controller and directs a blocked recording step to readable guidance', async ({page}) => {
  const bundle = recognitionFixture(), writes = await setup(page, bundle);
  const job = {id:'f'.repeat(32), state:'running', recording:'Generated background analysis', frames_read:1, frames_analyzed:1, max_frames:100};
  await page.route('**/api/analysis/**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') writes.push(url.pathname);
    if (url.pathname === '/api/analysis/session') return route.fulfill({json:{
      token:'generated-token', ready:true, recordings:[], models:[], rules:[], job,
    }});
    if (url.pathname === `/api/analysis/jobs/${job.id}`) return route.fulfill({json:job});
    return route.fulfill({status:503, json:{error:{message:'No operation exists in this generated fixture'}}});
  });
  await page.goto('/#recognition');
  await tasks(page).getByRole('button', {name:/^Open saved results/}).click();
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(bundle));
  await tasks(page).getByRole('button', {name:/^Analyze a recording/}).click();
  await page.getByRole('button', {name:'Connect local analysis', exact:true}).click();
  await expect(page.getByRole('button', {name:'Cancel analysis', exact:true})).toBeVisible();
  await followObservation(page);
  await expect(page.getByLabel('Match original recording', {exact:true})).toBeDisabled();
  await stableFocus(page, page.getByRole('region', {name:'Open saved recognition results', exact:true}));
  await tasks(page).getByRole('button', {name:/^Analyze a recording/}).click();
  await expect(page.getByRole('button', {name:'Cancel analysis', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Refresh choices', exact:true})).toBeDisabled();
  expect(writes).toEqual([]);
});

test('hiding cancels pending results while preserving the loaded review, source request and ordinary return focus', async ({page}) => {
  const bundle = recognitionFixture(), writes = await setup(page, bundle);
  const previous = recognitionFixture('f'.repeat(64));
  previous.receipt.camera = previous.trace.camera = 'Previously loaded generated review';
  previous.receipt.events[0].camera = 'Previously loaded generated review';
  await page.goto('/#recognition');
  await tasks(page).getByRole('button', {name:/^Open saved results/}).click();
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(previous));
  await page.getByRole('button', {name:'Next sample', exact:true}).click();
  await followObservation(page);
  await stableFocus(page, page.getByRole('region', {name:'Open saved recognition results', exact:true}));
  await page.evaluate(text => {
    const original = File.prototype.text;
    File.prototype.text = function() {
      if (this.name === 'generated-delayed-review.json') return new Promise(resolve => {window.releaseGeneratedSourceReceipt = () => resolve(text);});
      return original.call(this);
    };
  }, JSON.stringify(bundle));
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles({...upload(bundle), name:'generated-delayed-review.json'});
  await expect.poll(() => page.evaluate(() => Boolean(window.releaseGeneratedSourceReceipt))).toBe(true);
  await nav(page, 'Events').click();
  await page.evaluate(() => window.releaseGeneratedSourceReceipt());
  await expect(page.locator('.recognition-status')).toContainText('Opening cancelled while Recognition was hidden');
  await nav(page, 'Recognition').click();
  await stableFocus(page, page.getByRole('main', {name:'Recognition workspace', exact:true}));
  await expect(page.locator('.recognition-facts')).toContainText('Previously loaded generated review');
  await expect(page.getByLabel('Analyzed sample', {exact:true})).toHaveValue('1');
  await expect(page.getByRole('region', {name:'Open saved recognition results', exact:true})).toContainText('Open its results file, then match its original recording.');
  await expect(tasks(page).getByRole('button', {name:/^Open saved results/})).toHaveAttribute('aria-pressed', 'true');
  // The pending source handoff still resolves when the operator explicitly
  // retries the matching file. That deliberate transition focuses its next step.
  await page.getByLabel('Open recognition results', {exact:true}).setInputFiles(upload(bundle));
  await stableFocus(page, page.getByLabel('Match original recording', {exact:true}));
  await expect(page.locator('.recognition-status')).toContainText('matching results contain the observation');
  await expect(page.locator('.recognition-facts')).toContainText('test-recording');
  expect(writes).toEqual([]);
});
