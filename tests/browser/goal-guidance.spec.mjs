import { test, expect } from '@playwright/test';

const nav = (page, name) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true });
const goals = page => page.getByRole('group', { name: 'Choose your next task' });

async function offline(page) {
  await page.addInitScript(() => {
    window.goalGuideCameraCalls = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      enumerateDevices: async () => [],
      getUserMedia: () => { window.goalGuideCameraCalls++; throw Error('Camera activation is forbidden in this navigation test.'); },
    } });
  });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
}

async function delayMonitorModule(page) {
  let release, requested;
  const hold = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { requested = resolve; });
  await page.route('**/src/LiveMonitor.jsx*', async route => {
    requested();
    await hold;
    await route.continue();
  });
  return { release, seen };
}

async function chooseWatchFromSystem(page) {
  await page.goto('/#system');
  await page.getByRole('button', { name: 'Find a task', exact: true }).click();
  const input = page.getByRole('dialog', { name: 'Find a task', exact: true }).getByRole('combobox');
  await input.fill('Watch cameras');
  await input.press('Enter');
  await expect(page).toHaveURL(/#monitor$/);
}

test('cold Watch handoff waits for the lazy Monitor control without activating a camera or service', async ({ page }) => {
  await offline(page);
  const delayed = await delayMonitorModule(page), writes = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  try {
    await chooseWatchFromSystem(page);
    await delayed.seen;
    await expect(page.getByRole('main', { name: 'Monitor workspace' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Connect source', exact: true })).toHaveCount(0);
    delayed.release();
    await expect(page.getByRole('button', { name: 'Connect source', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.goalGuideCameraCalls)).toBe(0);
    expect(writes).toEqual([]);
  } finally { delayed.release(); }
});

test('a delayed Watch handoff cannot take focus from another operator control', async ({ page }) => {
  await offline(page);
  const delayed = await delayMonitorModule(page);
  try {
    await chooseWatchFromSystem(page);
    await delayed.seen;
    await expect(page.getByRole('main', { name: 'Monitor workspace' })).toBeFocused();
    await page.getByRole('button', { name: 'Find a task', exact: true }).click();
    const input = page.getByRole('dialog', { name: 'Find a task', exact: true }).getByRole('combobox');
    await expect(input).toBeFocused();
    delayed.release();
    await expect(page.getByRole('button', { name: 'Connect source', exact: true })).toHaveCount(1);
    await expect(input).toBeFocused();
    await input.press('Escape');
    await expect(page.getByRole('button', { name: 'Find a task', exact: true })).toBeFocused();
  } finally { delayed.release(); }
});

test('a new navigation cancels a delayed Watch focus request before an ordinary Monitor visit', async ({ page }) => {
  await offline(page);
  const delayed = await delayMonitorModule(page);
  try {
    await chooseWatchFromSystem(page);
    await delayed.seen;
    await expect(page.getByRole('main', { name: 'Monitor workspace' })).toBeFocused();
    await nav(page, 'Settings').click();
    await expect(page.getByRole('main', { name: 'Settings workspace' })).toBeFocused();
    delayed.release();
    await nav(page, 'Monitor').click();
    await expect(page.getByRole('button', { name: 'Connect source', exact: true })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Monitor workspace' })).toBeFocused();
  } finally { delayed.release(); }
});

test('goal shortcuts open exact existing tasks and Watch cameras focuses an explicit control without starting it', async ({ page }) => {
  await offline(page);
  const writes = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/#monitor');
  await expect(page.getByRole('button', { name: 'Connect source', exact: true })).toBeVisible();
  const watch = goals(page).getByRole('button', { name: /^Watch cameras/ });
  await watch.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Connect source', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await goals(page).getByRole('button', { name: /^Analyze saved video/ }).click();
  await expect(page).toHaveURL(/#recognition$/);
  await expect(page.getByRole('group', { name: 'Recognition tasks' }).getByRole('button', { name: /^Analyze a recording/ })).toHaveAttribute('aria-pressed', 'true');
  await nav(page, 'Monitor').click();
  await goals(page).getByRole('button', { name: /^Keep DVR copies/ }).click();
  await expect(page.getByRole('group', { name: 'Recognition tasks' }).getByRole('button', { name: /^Use my existing DVR/ })).toHaveAttribute('aria-pressed', 'true');
  await nav(page, 'Monitor').click();
  await goals(page).getByRole('button', { name: /^Plan coverage/ }).click();
  await expect(page).toHaveURL(/#facility$/);
  await expect(page.getByRole('main', { name: 'Facility workspace' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Locate your facility', exact: true })).toBeVisible();
  await expect(page.locator('.footer')).toContainText('Coverage is a planning estimate.');
  expect(await page.evaluate(() => window.goalGuideCameraCalls)).toBe(0);
  expect(writes).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  test(`goal shortcuts reflow within a ${width}px viewport`, async ({ page }) => {
    await offline(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#monitor');
    await expect(goals(page).getByRole('button')).toHaveCount(4);
    const guideBounds = await goals(page).boundingBox();
    expect(guideBounds.x).toBeGreaterThanOrEqual(0);
    expect(guideBounds.x + guideBounds.width).toBeLessThanOrEqual(width + 1);
    for (const button of await goals(page).getByRole('button').all()) {
      await expect(button).toBeVisible();
      const bounds = await button.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(guideBounds.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(guideBounds.x + guideBounds.width + 1);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  });
}

test('footer guidance follows workspaces and never implies that advanced planning starts camera AI', async ({ page }) => {
  await offline(page);
  await page.goto('/#events');
  await expect(page.locator('.footer')).toContainText('saving a decision or note');
  await nav(page, 'System').click();
  await expect(page.locator('.footer')).toContainText('Estimate storage and workload');
  await expect(page.locator('.footer')).not.toContainText('Start AI');
  await nav(page, 'Settings').click();
  await expect(page.locator('.footer')).toContainText('privacy information');
});
