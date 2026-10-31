import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { recognitionFixture, sharpeningFixture } from '../fixtures/recognition.mjs';

async function connect(page) {
  await page.goto('/#recognition');
  await page.getByRole('button',{name:'Connect local analysis'}).click();
  await expect(page.getByLabel('Recording to analyze')).toBeEnabled();
}
async function select(page, filename='synthetic.webm') {
  const value = await page.getByLabel('Recording to analyze').locator('option').evaluateAll((options, filename) => options.find(o => o.textContent.includes(filename)).value, filename);
  await page.getByLabel('Recording to analyze').selectOption(value);
}

test('real local HTTP job invokes CPU analyzer and automatically opens verified video and boxes', async ({page}) => {
  await connect(page);
  await expect(page.getByRole('button',{name:'Analyze recording',exact:true})).toBeDisabled();
  await select(page);
  await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('fingerprint matched');
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(1);
  await expect(page.locator('.recognition-facts')).toContainText('6 sampled frames');
  await expect(page.locator('.recognition-facts')).toContainText('CPU analysis');
  await expect.poll(() => page.locator('video').evaluate(el => el.readyState)).toBe(4);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({path:'test-results/local-analysis-desktop.png',fullPage:true});
  await page.reload();
  await page.getByRole('button',{name:'Connect local analysis'}).click();
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(1);
  await page.getByRole('button',{name:'Send 1 observations to Events'}).click();
  await expect(page).toHaveURL(/#events$/);
  await expect(page.locator('.event-table-row').filter({hasText:'local-recording'})).toBeVisible();
});

test('invalid file produces an actionable error and the next valid job succeeds', async ({page}) => {
  await connect(page); await select(page,'invalid.mp4');
  await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  await expect(page.locator('.local-analysis-job')).toContainText('Playlists and text files are not supported');
  await expect(page.getByRole('button',{name:'Analyze recording',exact:true})).toBeEnabled();
  await select(page);
  await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(1);
});

test('explicit sharpening comparison uses native analysis, survives export and labels original footage', async ({page}) => {
  await connect(page); await select(page);
  const option=page.getByRole('checkbox',{name:'Compare mild sharpening (experimental)'});
  await expect(option).not.toBeChecked();
  await option.check();
  await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  await expect(page.getByLabel('Sharpening comparison')).toBeVisible();
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(1);
  await page.getByLabel('Detection input').selectOption('sharpened');
  await expect(page.locator('.recognition-caption')).toContainText('Original footage · sharpened-input detections');
  await expect(page.getByLabel('Sharpening report')).toContainText('Original detections');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download sharpening CSV'}).click();
  const file=await downloaded; expect(file.suggestedFilename()).toMatch(/-sharpening.csv$/);
  await expect(page.getByRole('button',{name:'Send 1 observations to Events'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/sharpening-mobile.png',fullPage:true});
});

test('candidate overlays stay separate and a malformed replacement preserves the current review', async ({page}) => {
  await page.goto('/#recognition');
  const bytes=await readFile('qa-local/analysis-browser/recordings/synthetic.webm');
  const fixture=sharpeningFixture(createHash('sha256').update(bytes).digest('hex'));
  const load=async value=>page.getByLabel('Open recognition results').setInputFiles({name:'paired.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await load(fixture);
  await page.getByLabel('Match original recording').setInputFiles('qa-local/analysis-browser/recordings/synthetic.webm');
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(2);
  await page.getByRole('button',{name:'Next sample',exact:true}).click();
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(0);
  await page.getByLabel('Detection input').selectOption('sharpened');
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(1);
  await expect(page.locator('.recognition-scene')).toContainText('truck');
  fixture.trace.enhancement_comparison.implementation_sha256='0'.repeat(64);
  await load(fixture);
  await expect(page.getByRole('alert')).toContainText('sharpening declarations do not match');
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(1);
  await page.locator('.recognition-event').first().click();
  await expect(page.getByLabel('Detection input')).toHaveValue('original');
  await expect(page.locator('.recognition-boxes rect')).toHaveCount(2);
});

// Controlled transport faults exercise the UI state machine. The first two
// scenarios above exercise the real local service and synthetic native model.
async function controlled(page, {fail=false, mismatch=false} = {}) {
  const bytes = await readFile('qa-local/analysis-browser/recordings/synthetic.webm');
  const sha = createHash('sha256').update(bytes).digest('hex');
  let job = null, posts=0, lose=false;
  const catalog={token:'test',ready:true,recordings:[{id:'video',name:'synthetic.webm',bytes:bytes.length}],
    models:[{id:'model',name:'Synthetic test model'}],rules:[{id:'rules',name:'Presence',summary:['person ≥ 0.7'],models:['model']}]};
  await page.route('**/api/analysis/**',async route=>{
    const path = new URL(route.request().url()).pathname;
    if(path.endsWith('/session')) return route.fulfill({json:{...catalog,job}});
    if(path.endsWith('/jobs')) { posts++; job={id:'a'.repeat(32),state:'running',phase:'analyzing',recording:'synthetic.webm',frames_read:6,frames_analyzed:2,max_frames:6000,elapsed_seconds:1}; return route.fulfill({status:202,json:job}); }
    if(path.endsWith('/cancel')) {job={...job,state:'cancelled',phase:'cancelled',error:{message:'Analysis cancelled. No results were opened.'}}; return route.fulfill({json:job});}
    if(path.endsWith('/result')) return route.fulfill({json:recognitionFixture(mismatch?'f'.repeat(64):sha)});
    if(path.endsWith('/source')) return route.fulfill({contentType:'video/webm',body:bytes});
    if(lose) return route.abort();
    if(fail) job={...job,state:'failed',phase:'failed',error:{message:'Analyzer stopped. Check the model and retry.'}};
    return route.fulfill({json:job});
  });
  return {posts:()=>posts,lose:()=>{lose=true;},recover:()=>{lose=false;},complete:()=>{job={...job,state:'completed',phase:'completed'};}};
}

test('progress, cancellation, disconnected recovery and narrow controls stay usable without duplicate starts', async ({page}) => {
  const mock=await controlled(page);
  await page.setViewportSize({width:390,height:844});
  await connect(page); await select(page);
  await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  await expect(page.getByLabel('Analysis frame budget')).toHaveAttribute('value','6');
  await expect(page.getByLabel('Recording to analyze')).toBeDisabled();
  mock.lose();
  await expect(page.getByRole('alert')).toContainText('Reconnect to resume progress');
  mock.recover();
  await page.getByRole('button',{name:'Connect local analysis'}).click();
  expect(mock.posts()).toBe(1);
  await page.getByRole('button',{name:'Cancel analysis',exact:true}).click();
  await expect(page.locator('.local-analysis-job')).toContainText('Analysis cancelled');
  await expect(page.getByRole('button',{name:'Analyze recording',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({path:'test-results/local-analysis-mobile.png',fullPage:true});
});

test('process failure returns controls for an explicit retry', async ({page}) => {
  await controlled(page,{fail:true}); await connect(page); await select(page);
  await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  await expect(page.locator('.local-analysis-job')).toContainText('Check the model and retry');
  await expect(page.locator('.local-analysis-message')).toContainText('Analysis stopped');
  await expect(page.getByRole('button',{name:'Analyze recording',exact:true})).toBeEnabled();
  await expect(page.locator('.recognition-boxes')).toHaveCount(0);
});

test('a mismatched job result preserves the previous review and never attaches boxes', async ({page}) => {
  const mock=await controlled(page,{mismatch:true});
  await connect(page);
  await page.getByLabel('Open recognition results').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recognitionFixture()))});
  await expect(page.getByLabel('Analyzed sample')).toBeVisible();
  await select(page); await page.getByRole('button',{name:'Analyze recording',exact:true}).click();
  mock.complete();
  await expect(page.getByRole('alert')).toContainText('does not match');
  await expect(page.getByRole('alert')).toContainText('previous review has been preserved');
  await expect(page.getByLabel('Analyzed sample')).toBeVisible();
  await expect(page.locator('.recognition-boxes')).toHaveCount(0);
});
