import { test, expect } from '@playwright/test';

// Chromium's generated camera and the synthetic CPU model (one person at 0.9 in every
// frame), so the empty-room segment deliberately reports false alarms.
async function setVisibility(page, state) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('guided training records the script, pauses while hidden, analyzes and saves a setting Recognition preselects', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/#train');
  await expect(page.getByRole('heading', {name: 'Train', exact: true})).toBeVisible();
  await expect(page.getByText('This computer is ready')).toBeVisible();
  await page.getByRole('button', {name: 'Start session'}).click();
  await expect(page.locator('.training-steps [aria-current="step"]')).toContainText('Camera check');
  await page.getByRole('button', {name: 'Connect camera'}).click();
  await page.getByRole('button', {name: 'Start guided recording'}).click();
  await expect(page.locator('.training-prompt strong')).toHaveText('Stay in view as usual', {timeout: 10000});
  await expect(page.locator('.training-rec')).toBeVisible();

  await setVisibility(page, 'hidden');
  await expect(page.locator('.training-prompt strong')).toHaveText('Paused');
  const pausedAt = await page.locator('.training-segments').evaluate(el => el.innerHTML);
  await page.waitForTimeout(1500);
  expect(await page.locator('.training-segments').evaluate(el => el.innerHTML)).toBe(pausedAt);
  await setVisibility(page, 'visible');
  await expect(page.locator('.training-prompt p').first()).toContainText('Resuming');
  await expect(page.locator('.training-rec')).toBeVisible({timeout: 6000});

  await expect(page.getByRole('heading', {name: /Found you in 100% of checks/})).toBeVisible({timeout: 120000});
  // Every prompt received checks: frames are placed by position, whatever frame rate the file declares.
  for (const item of await page.locator('.training-segment-results li span').allTextContents()) expect(item).not.toContain('Not enough');
  await expect(page.locator('.training-segment-results li')).toHaveCount(5);
  // The synthetic model scores the empty room like a person, so the current setting (0.70) is kept.
  await expect(page.locator('.training-sensitivity')).toContainText('Something in the empty room looks like a person');
  await expect(page.locator('.training-sensitivity output')).toHaveText('0.70');
  await page.screenshot({path: 'test-results/training-results.png', fullPage: true});
  await page.locator('.training-sensitivity input[type=range]').fill('0.75');
  await page.getByRole('button', {name: 'Use 0.75 from now on'}).click();
  await expect(page.getByRole('heading', {name: 'Saved'})).toBeVisible();
  await expect(page.locator('.training-done')).toContainText('sensitivity 0.75');
  await page.getByRole('button', {name: 'Back to Train'}).click();
  await expect(page.locator('.training-health')).toContainText('0.75');
  await expect(page.locator('.training-history li')).toHaveCount(1);
  await page.screenshot({path: 'test-results/training-home.png', fullPage: true});

  await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('button', {name: /^Recognition/}).click();
  await page.getByRole('button', {name: 'Connect local analysis'}).click();
  await expect(page.getByLabel('Analysis rules').locator('option:checked')).toContainText('trained');
});
