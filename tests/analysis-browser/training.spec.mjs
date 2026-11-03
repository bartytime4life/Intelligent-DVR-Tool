import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({actionTimeout: 12000});

// Chromium supplies a generated camera. The first test runs the real import, CPU
// fixture model and source verification on both recordings. The fixture emits one
// 0.90 person box on every sample, even during the scripted empty-room prompt.
async function setVisibility(page, state) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function startCalibration(page, model) {
  await page.goto('/#train');
  await expect(page.getByRole('heading', {name: 'Train', exact: true})).toBeVisible();
  await expect(page.getByText(/This computer is ready/)).toBeVisible();
  await page.getByRole('button', {name: 'Start session', exact: true}).click();
  if (model) {
    await page.getByText('Detector and reference rule', {exact: true}).click();
    await page.getByRole('combobox', {name: 'Detector', exact: true}).selectOption(model);
  }
  await page.getByRole('button', {name: 'Connect camera', exact: true}).click();
  await page.getByRole('button', {name: 'Start guided recording', exact: true}).click();
}

async function recordFreshCheck(page) {
  await page.getByRole('button', {name: 'Check on a new recording'}).click();
  await page.getByRole('button', {name: 'Connect camera', exact: true}).click();
  await page.getByRole('button', {name: 'Start check recording', exact: true}).click();
  const confirm = page.getByRole('checkbox', {name: /I followed both prompts with the same camera and view/});
  await expect(confirm).toBeVisible({timeout: 100000});
  const compare = page.getByRole('button', {name: 'Compare settings', exact: true});
  await expect(compare).toBeDisabled();
  await confirm.check();
  await compare.click();
}

function ruleWrites(page) {
  const writes = [];
  page.on('request', req => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/analysis/training/rules') {
      writes.push(req.postDataJSON());
    }
  });
  return writes;
}

const firstResult = page => page.getByRole('heading', {name: 'Your first recording is scored'});
const apply = page => page.getByRole('button', {name: /^Use checked setting /});

test('the real synthetic CPU workflow pauses recording, checks a fresh take, and keeps the current rule', async ({page}, testInfo) => {
  test.setTimeout(230000);
  const writes = ruleWrites(page);
  await startCalibration(page);
  const prompt = page.getByRole('complementary', {name: 'Recording instructions'});
  await expect(prompt.getByRole('heading', {name: 'Stay in view as usual'})).toBeVisible({timeout: 10000});
  // Wait for active recording before hiding the page, beyond its initial countdown.
  await expect(prompt.locator('.take-phase')).toHaveText('Prompt 1 of 5', {timeout: 10000});
  await setVisibility(page, 'hidden');
  await expect(prompt.getByRole('heading', {name: 'Recording paused'})).toBeVisible();
  const pausedAt = await prompt.locator('.take-progress').evaluate(el => el.innerHTML);
  await page.waitForTimeout(1250);
  expect(await prompt.locator('.take-progress').evaluate(el => el.innerHTML)).toBe(pausedAt);
  await setVisibility(page, 'visible');
  await expect(prompt.locator('.take-phase')).toContainText('Get ready to resume');
  await expect(firstResult(page)).toBeVisible({timeout: 115000});
  await page.getByRole('checkbox', {name: /Add this session to the combined evidence/}).check();
  await expect(apply(page)).toHaveCount(0);
  await page.screenshot({path: testInfo.outputPath('calibration-scorecard.png'), fullPage: true});
  await recordFreshCheck(page);
  await expect(page.getByRole('heading', {name: 'Both settings gave the same counts'})).toBeVisible();
  await expect(apply(page)).toHaveCount(0);
  await page.screenshot({path: testInfo.outputPath('fresh-scorecard.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('fresh-scorecard-mobile.png'), fullPage: true});
  await page.getByRole('button', {name: 'Keep current setting'}).click();
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download measurement (JSON)', exact: true}).click();
  const download = await downloadReady;
  const receipt = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(receipt.schema).toBe('intelligent-dvr.guided-training-receipt.v1');
  expect(receipt.fresh_check.prompts_confirmed_by_operator).toBe(true);
  expect(receipt.fresh_check.verdict).toBe('unchanged');
  expect(receipt.fresh_check.source_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.fresh_check.source_sha256).not.toBe(receipt.calibration.source_sha256);
  expect(receipt.fresh_check.model_sha256).toBe(receipt.calibration.model_sha256);
  expect(receipt.fresh_check.rules_sha256).toBe(receipt.calibration.rules_sha256);
  expect(receipt.fresh_check.baseline.person_checks).toBeGreaterThanOrEqual(3);
  expect(receipt.fresh_check.baseline.empty_view_checks).toBeGreaterThanOrEqual(3);
  expect(receipt.fresh_check.candidate).toEqual(receipt.fresh_check.baseline);
  await page.getByRole('button', {name: 'Back to Train'}).click();
  await expect(page.locator('.training-history li')).toHaveCount(1);
  await expect(page.locator('.training-history li')).toContainText('Both settings scored the same');
  await page.reload();
  await expect(page.locator('.training-history li')).toHaveCount(1);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('dvr.analysis.defaultRules'))).toBeNull();
  await expect(page.getByRole('region', {name: 'Combined training evidence'})).toContainText('1 of 50 sessions saved');
  await startCalibration(page);
  await expect(firstResult(page)).toBeVisible({timeout: 115000});
  await expect(page.getByRole('region', {name: 'Combined session results'})).toContainText('1 earlier matching session');
  await page.getByRole('checkbox', {name: /Add this session to the combined evidence/}).check();
  await expect(page.getByRole('region', {name: 'Combined session results'})).toContainText('2 calibration sessions inform the suggestion');
  const combinedDownloadReady = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download calibration summary (JSON)', exact: true}).click();
  const combinedDownload = await combinedDownloadReady;
  const combinedReceipt = JSON.parse(await readFile(await combinedDownload.path(), 'utf8'));
  expect(combinedReceipt.combined_evidence.prior_sessions).toBe(1);
  expect(combinedReceipt.combined_evidence.calibration_included).toBe(true);
  expect(combinedReceipt.combined_evidence.recordings).toBe(3);
  expect(combinedReceipt.combined_evidence.regressions).toBe(0);
  expect(combinedReceipt.calibration.recommendation_basis).toBe('equally-weighted-confirmed-calibration-sessions');
  await page.getByRole('button', {name: 'Keep current setting'}).click();
  await page.getByRole('button', {name: 'Back to Train'}).click();
  await page.reload();
  await expect(page.getByRole('region', {name: 'Combined training evidence'})).toContainText('2 of 50 sessions saved');
  await expect(page.locator('.training-history li')).toHaveCount(2);
  const library = await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.training.library.v1')));
  expect(library.sessions).toHaveLength(2);
  expect(new Set(library.sessions.map(s => s.calibration.sourceHash)).size).toBe(2);
  expect(combinedReceipt.combined_evidence.prior_sources[0].calibration_sha256).toBe(library.sessions[0].calibration.sourceHash);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.screenshot({path: testInfo.outputPath('two-saved-sessions.png'), fullPage: true});
});

test('recorded synthetic pixels improve on an independent check and explicitly select the tested model and rule', async ({page}, testInfo) => {
  test.setTimeout(210000);
  // Render a gray field with a moving silhouette during the in-view prompts and
  // a dark field during the empty prompt. The fixture ONNX scores mean RGB. Both
  // recordings use native MediaRecorder, import, decode, inference and source verification.
  await page.addInitScript(() => {
    let fixtureCamera;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: async constraints => {
      if (constraints.audio !== false) throw Error('Synthetic training camera requires video only');
      // Reconnect to the same generated device. Creating another canvas source
      // would correctly trigger the product's different-camera rejection.
      if (fixtureCamera) return fixtureCamera.clone();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 320;
      const context = canvas.getContext('2d');
      let frame = 0;
      function paint() {
        const prompt = document.querySelector('[aria-label="Recording instructions"] h2')?.textContent || '';
        const empty = prompt.includes('Leave the camera');
        context.fillStyle = empty ? '#202020' : '#9e9e9e';
        context.fillRect(0, 0, 320, 320);
        if (!empty) {
          const x = 130 + Math.round(22 * Math.sin(frame / 12));
          context.fillStyle = '#686868';
          context.beginPath(); context.arc(x, 115, 14, 0, 2 * Math.PI); context.fill();
          context.fillRect(x - 12, 131, 24, 65);
        }
        context.fillStyle = '#eee'; context.fillRect((frame++) % 320, 309, 3, 3);
      }
      paint();
      fixtureCamera = canvas.captureStream(16);
      const timer = setInterval(paint, 60);
      window.addEventListener('pagehide', () => {
        clearInterval(timer);
        fixtureCamera.getTracks().forEach(track => track.stop());
      }, {once:true});
      return fixtureCamera.clone();
    }});
  });
  const jobs = [], sources = [], opened = [];
  page.on('request', req => {
    const path = new URL(req.url()).pathname;
    if (path === '/api/analysis/jobs' && req.method() === 'POST') jobs.push(req.postDataJSON());
    if (path === '/api/analysis/recordings' && req.method() === 'POST') sources.push(req.headers()['x-dvr-sha256']);
    if (/^\/api\/analysis\/jobs\/[a-f0-9]{32}\/result$/.test(path) && req.method() === 'GET') opened.push(path);
  });
  const writes = ruleWrites(page);
  await startCalibration(page, 'synthetic-light');
  await expect(firstResult(page)).toBeVisible({timeout: 115000});
  await page.getByRole('checkbox', {name: /Add this session to the combined evidence/}).check();
  await expect(apply(page)).toHaveCount(0);
  await recordFreshCheck(page);
  await expect(page.getByRole('heading', {name: 'Better on the fresh check'})).toBeVisible();
  await expect(apply(page)).toBeEnabled();
  expect(writes).toEqual([]);
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download check comparison (JSON)', exact: true}).click();
  const download = await downloadReady;
  const receiptPath = testInfo.outputPath('generated-light-response-comparison.json');
  await download.saveAs(receiptPath);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  expect(receipt.fresh_check.verdict).toBe('improved');
  expect(receipt.fresh_check.prompts_confirmed_by_operator).toBe(true);
  expect(sources).toEqual([receipt.calibration.source_sha256, receipt.fresh_check.source_sha256]);
  expect(new Set(sources).size).toBe(2);
  expect(receipt.calibration.model_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.fresh_check.model_sha256).toBe(receipt.calibration.model_sha256);
  expect(receipt.calibration.prompt_alignment).toBe('source-pts');
  expect(receipt.fresh_check.prompt_alignment).toBe('source-pts');
  expect(receipt.fresh_check.baseline.person_found).toBe(0);
  expect(receipt.fresh_check.candidate.person_found).toBeGreaterThanOrEqual(3);
  expect(receipt.fresh_check.candidate.empty_view_detections).toBeLessThanOrEqual(receipt.fresh_check.baseline.empty_view_detections);
  expect(jobs.map(j => [j.model, j.rules])).toEqual([['synthetic-light','presence'], ['synthetic-light','presence']]);
  expect(opened).toHaveLength(2);
  expect(new Set(opened).size).toBe(2);
  await page.screenshot({path: testInfo.outputPath('improved-scorecard.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('improved-scorecard-mobile.png'), fullPage: true});
  const savedRule = page.waitForResponse(r => new URL(r.url()).pathname === '/api/analysis/training/rules' && r.request().method() === 'POST');
  await apply(page).click();
  const response = await savedRule;
  expect(response.ok()).toBe(true);
  const {rule} = await response.json();
  await page.getByRole('button', {name: 'Back to Train'}).click();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({label: 'person', threshold: receipt.fresh_check.candidate.threshold, rect: [0,0,1,1], dwell: 1, max_gap: 2});
  await expect(page.locator('.training-history li')).toContainText('Candidate improved this check');
  await page.reload();
  await expect(page.locator('.training-history li')).toHaveCount(1);
  expect(rule.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dvr.analysis.defaultRules')))).toEqual({
    modelId: 'synthetic-light', rulesId: rule.id,
    modelHash: receipt.fresh_check.model_sha256, labelHash: receipt.fresh_check.labels_sha256,
    rulesHash: rule.sha256, profile: receipt.fresh_check.inference_profile,
  });
  await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('button', {name: /^Recognition/}).click();
  await page.getByRole('button', {name: 'Connect local analysis'}).click();
  await expect(page.getByLabel('Analysis rules')).toHaveValue(rule.id);
  await expect(page.getByLabel('Analysis model')).toHaveValue('synthetic-light');

  // Only after the native captures, comparison, save and first reopen, simulate
  // an operator replacing the detector bytes under the same catalog ID.
  await page.route('**/api/analysis/session', async route => {
    const response = await route.fetch();
    const catalog = await response.json();
    const replaced = catalog.models.find(model => model.id === 'synthetic-light');
    expect(replaced.sha256).toBe(receipt.fresh_check.model_sha256);
    replaced.sha256 = 'a'.repeat(64);
    await route.fulfill({response, json: catalog});
  });
  await page.reload();
  await page.getByRole('button', {name: 'Connect local analysis'}).click();
  await expect(page.getByLabel('Analysis rules')).toHaveValue('presence');
  await expect(page.getByLabel('Analysis model')).toHaveValue('synthetic');
  expect(writes).toHaveLength(1);
});

test('service unavailability exposes a retry, preserves a legacy session, and fits a phone viewport', async ({page}, testInfo) => {
  const legacy = {at: '2026-10-01T12:00:00Z', kind: 'detection', threshold: .7, detectionRate: .75, falseAlarms: 2, applied: true};
  await page.addInitScript(entry => localStorage.setItem('dvr.training.history.v1', JSON.stringify([entry])), legacy);
  await page.route('**/api/analysis/session', route => route.fulfill({status: 503, json: {error: {message: 'Fixture service is offline.'}}}));
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/#train');
  await expect(page.getByRole('status').filter({hasText: 'Local setup needs attention'})).toContainText('Fixture service is offline.');
  await expect(page.getByRole('button', {name: 'Start session'})).toBeDisabled();
  await expect(page.locator('.training-history li')).toContainText('Single recording');
  await page.unroute('**/api/analysis/session');
  await page.getByRole('button', {name: 'Check again'}).click();
  await expect(page.getByRole('button', {name: 'Start session'})).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('train-mobile-home.png'), fullPage: true});
});
