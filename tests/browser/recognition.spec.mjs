import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { recognitionFixture } from '../fixtures/recognition.mjs';

const upload = value => ({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});

test('recognition keeps evidence separate, rejects wrong files, and sends observations to review', async ({page}) => {
  await page.goto('/#recognition');
  await expect(page.getByRole('heading', {name:'Recognition', exact:true})).toBeVisible();
  await page.getByLabel('Open recognition results').setInputFiles(upload(recognitionFixture()));
  await expect(page.getByText('No recording attached. Results alone are unverified metadata.')).toBeVisible();
  await expect(page.locator('.recognition-counts')).toContainText('person');
  await page.getByLabel('Match original recording').setInputFiles({name:'wrong.webm',mimeType:'video/webm',buffer:Buffer.from('wrong file')});
  await expect(page.getByRole('alert')).toContainText('does not match');
  await expect(page.locator('.recognition-boxes')).toHaveCount(0);
  await page.getByRole('button',{name:'Next sample'}).click();
  await expect(page.getByText('No detections meet this display threshold.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Send 1 observations to Events'}).click();
  await page.getByRole('button',{name:'Events',exact:false}).first().click();
  await expect(page.locator('.event-table-row').filter({hasText:'test-recording'})).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.events.v1')));
  expect(stored.find(e => e.id === 'import-fixture-observation')).toMatchObject({mode:'offline-model',camera:null});
});

test('recognition rejects mixed provenance and displays partial coverage on a narrow screen', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#recognition');
  const mixed = recognitionFixture(); mixed.trace.source_sha256 = 'f'.repeat(64);
  await page.getByLabel('Open recognition results').setInputFiles(upload(mixed));
  await expect(page.getByRole('alert')).toContainText('provenance');
  await expect(page.locator('.recognition-stage')).toHaveCount(0);
  const partial = recognitionFixture(); partial.receipt.state = partial.trace.state = 'partial';
  await page.getByLabel('Open recognition results').setInputFiles(upload(partial));
  await expect(page.getByText('PARTIAL — analysis limit reached')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('matching synthetic recording enables boxes only at paused analyzed samples', async ({page}) => {
  await page.goto('/#recognition');
  // Generated pixels only; this browser contract does not test recognition accuracy.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=240;
    const context=canvas.getContext('2d'), stream=canvas.captureStream(10), chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable=e=>chunks.push(e.data);
    const stopped=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start();
    for(let i=0;i<12;i++) { context.fillStyle=i%2 ? '#284b55' : '#182b35'; context.fillRect(0,0,320,240); await new Promise(r=>setTimeout(r,100)); }
    recorder.stop(); await stopped; stream.getTracks().forEach(t=>t.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  const buffer=Buffer.from(bytes), sha=createHash('sha256').update(buffer).digest('hex');
  await page.getByLabel('Open recognition results').setInputFiles(upload(recognitionFixture(sha)));
  await page.getByLabel('Match original recording').setInputFiles({name:'synthetic.webm',mimeType:'video/webm',buffer});
  await expect(page.getByRole('status')).toContainText('fingerprint matched');
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(2);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:/^Events/}).click();
  await expect(page.locator('video')).not.toBeVisible();
  expect(await page.locator('video').evaluate(el=>el.paused)).toBe(true);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Recognition'}).click();
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(2);
  await expect(page.getByText('Analyzer finished · recording fingerprint matched')).toBeVisible();
  await page.screenshot({path:'test-results/recognition-desktop.png',fullPage:true});
  await page.locator('video').evaluate(el=>el.play());
  await expect(page.locator('.recognition-boxes')).toHaveCount(0);
  await page.getByRole('button',{name:'Next sample'}).click();
  await expect(page.locator('.recognition-boxes')).toHaveCount(1);
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(0);
  await page.getByRole('button',{name:'Previous sample'}).click();
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(2);
  await page.getByLabel('Open recognition results').setInputFiles(upload(recognitionFixture('f'.repeat(64))));
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('.recognition-boxes')).toHaveCount(0);
});
