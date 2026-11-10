import { test, expect } from '@playwright/test';

const nav = (page,name) => page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true});
const finder = page => page.getByRole('dialog',{name:'Find a task',exact:true});
async function search(page,query) {
  await page.getByRole('button',{name:'Find a task',exact:true}).click();
  await finder(page).getByRole('combobox',{name:'Search tasks'}).fill(query);
}
async function offline(page) {
  await page.route('**/*',route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
}

test('keyboard task search opens the exact Recognition path without starting a service',async({page}) => {
  await offline(page);
  const writes=[];
  page.on('request',request => { if(request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/#settings');
  await page.keyboard.press('Control+k');
  const input=finder(page).getByRole('combobox',{name:'Search tasks'});
  await expect(input).toBeFocused();
  await input.fill('backup folders');
  await expect(finder(page).getByRole('option')).toHaveCount(1);
  await input.press('Enter');
  await expect(finder(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#recognition$/);
  await expect(page.getByRole('group',{name:'Recognition tasks'}).getByRole('button',{name:/Use my existing DVR/})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('main',{name:'Recognition workspace'})).toBeFocused();
  await expect(page).toHaveTitle('Recognition · Intelligent DVR');
  await search(page,'saved results');
  await finder(page).getByRole('option').click();
  await expect(page.getByRole('group',{name:'Recognition tasks'}).getByRole('button',{name:/Open saved results/})).toHaveAttribute('aria-pressed','true');
  expect(writes).toEqual([]);
});

test('finder supports arrow selection, empty search recovery, Escape and focus return',async({page}) => {
  await offline(page);
  await page.goto('/#monitor');
  const opener=page.getByRole('button',{name:'Find a task',exact:true});
  await opener.click();
  const input=finder(page).getByRole('combobox');
  await input.press('ArrowDown');
  await expect(finder(page).getByRole('option',{selected:true})).toContainText('Record a LAN camera');
  await input.press('ArrowUp');
  await expect(finder(page).getByRole('option',{selected:true})).toContainText('Watch cameras');
  await input.fill('volcano sandwich');
  await expect(finder(page).getByText('No matching tasks')).toBeVisible();
  await input.press('Enter');
  await expect(finder(page)).toBeVisible();
  await finder(page).getByRole('button',{name:'Show all tasks'}).click();
  await expect(finder(page).getByRole('option')).toHaveCount(11);
  await input.press('Escape');
  await expect(finder(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole('button',{name:'About this pilot'}).click();
  await page.keyboard.press('Control+k');
  await expect(finder(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'About this pilot'})).toBeFocused();
});

test('canceling a task handoff keeps the editor and search intact',async({page}) => {
  await offline(page);
  await page.goto('/#zones');
  await page.getByLabel('Zone name',{exact:true}).fill('Unapplied zone draft');
  await search(page,'GPU');
  page.once('dialog',dialog => dialog.dismiss());
  await finder(page).getByRole('option').click();
  await expect(page).toHaveURL(/#zones$/);
  await expect(finder(page)).toBeVisible();
  await expect(finder(page).getByRole('combobox')).toHaveValue('GPU');
  await expect(finder(page).getByRole('combobox')).toBeFocused();
  await finder(page).getByRole('combobox').press('Escape');
  await expect(page.getByLabel('Zone name',{exact:true})).toHaveValue('Unapplied zone draft');
  await search(page,'GPU');
  page.once('dialog',dialog => dialog.accept());
  await finder(page).getByRole('combobox').press('Enter');
  await expect(page).toHaveURL(/#system$/);
  await expect(page.getByRole('main',{name:'System workspace'})).toBeFocused();
});

test('workspace handoffs and browser history update title, landmark focus and announcements',async({page}) => {
  await offline(page);
  await page.goto('/#settings');
  await page.getByRole('button',{name:'Plan this machine',exact:true}).click();
  await expect(page.getByRole('main',{name:'System workspace'})).toBeFocused();
  await expect(page).toHaveTitle('System · Intelligent DVR');
  await expect(page.getByRole('status').filter({hasText:'System workspace opened.'})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveTitle('Settings · Intelligent DVR');
  await expect(page.getByRole('main',{name:'Settings workspace'})).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('main',{name:'System workspace'})).toBeFocused();
  await page.getByRole('button',{name:'Export setup plan',exact:true}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.keyboard.press('Control+k');
  await finder(page).getByRole('combobox').fill('review observations');
  await finder(page).getByRole('combobox').press('Enter');
  await expect(page).toHaveURL(/#events$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await nav(page,'Monitor').click();
  await page.getByRole('button',{name:'Analyze a recording',exact:true}).click();
  await expect(page.getByRole('group',{name:'Recognition tasks'}).getByRole('button',{name:/Analyze a recording/})).toHaveAttribute('aria-pressed','true');
});

for (const width of [320,390,662,1024,1440]) {
  test(`task navigator stays reachable and scrolls at ${width}px`,async({page}) => {
    await offline(page);
    await page.setViewportSize({width,height:844});
    await page.goto('/#settings');
    await page.getByRole('button',{name:'Find a task',exact:true}).click();
    const input=finder(page).getByRole('combobox');
    await input.press('ArrowUp');
    const selected=finder(page).getByRole('option',{selected:true});
    await expect(selected).toContainText('Connections and local evidence');
    await expect(selected).toBeInViewport();
    const bounds=await finder(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    if(width===390 || width===1440) await page.screenshot({path:`qa-local/workspace-experience/task-finder-${width}.png`});
    await input.fill('floor plan');
    await input.press('Enter');
    await expect(page).toHaveURL(/#facility$/);
    await expect(page.getByRole('main',{name:'Facility workspace'})).toBeFocused();
    await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
  });
}
