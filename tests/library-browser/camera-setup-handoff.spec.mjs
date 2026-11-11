import {test, expect} from '@playwright/test';

// Navigation and availability only, with generated GET replies. Device access
// and every POST are forbidden: no source is saved, connected, or recorded.
const nav = (page, name) => page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name, exact:true});

async function setup(page) {
  const state = {requests:[], checks:0};
  await page.addInitScript(() => {
    window.handoffCameraCalls = 0;
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      enumerateDevices:async () => [], getUserMedia:() => {window.handoffCameraCalls++; throw Error('No camera activation in this fixture.');},
    }});
  });
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.requests.push({path, method:request.method()});
    if (request.method() !== 'GET') return route.fulfill({status:403,json:{error:{message:'Writes are forbidden in this navigation fixture.'}}});
    if (path === '/api/feeds/session') return route.fulfill({json:{token:'generated-feed-token', ready:true, sources:[]}});
    if (path === '/api/analysis/session' || path === '/api/library/session') {
      if (path === '/api/library/session') state.checks++;
      return route.fulfill({json:{token:'generated-setup-token', ready:true, recordings:[], models:[], rules:[], job:null, recorder_active:false}});
    }
    if (path === '/api/library/status') return route.fulfill({json:{configured:false, active:false, analyzing:false,
      state:'unconfigured', error:null, config:null, storage_bytes:0, disk_free_bytes:1024**3, waiting:0,
      scan_limited:false, unsupported:[], items:[], counters:{copied:0,duplicates:0}}});
    if (path === '/api/setup/cameras') return route.fulfill({json:{enabled:true,sources:[]}});
    return route.fulfill({status:503,json:{error:{message:'Unused generated endpoint.'}}});
  });
  await page.goto('/#monitor');
  return state;
}

async function handoff(page, loadEmpty = true) {
  await page.getByRole('button',{name:'Local DVR / IP camera',exact:false}).first().click();
  const dialog = page.getByRole('dialog',{name:'Connect a camera source'});
  if (loadEmpty) {
    await dialog.getByRole('button',{name:'Load configured DVR sources',exact:true}).click();
    await expect(dialog).toContainText('No DVR channels configured');
  }
  await dialog.getByRole('button',{name:'Add camera or DVR source',exact:true}).click();
  await expect(page).toHaveURL(/#recognition$/);
  await expect(page.getByRole('group',{name:'Recognition tasks'}).getByRole('button',{name:/^Use my existing DVR/})).toHaveAttribute('aria-pressed','true');
}

test('empty DVR chooser opens guided setup, keeps explicit connection pending, then focuses the source form without writes', async ({page}) => {
  const state = await setup(page);
  await handoff(page);
  const backup = page.getByRole('region',{name:'Existing DVR backup'});
  const connect = backup.getByRole('button',{name:'Connect to this computer',exact:true});
  await expect(connect).toBeFocused();
  await expect(backup.locator('.backup-camera-setup')).toHaveAttribute('open','');
  expect(state.checks).toBe(0);
  expect(state.requests.filter(request => request.method !== 'GET')).toEqual([]);
  await connect.click();
  const name = backup.locator('.backup-camera-fields').getByRole('textbox',{name:'Name',exact:true});
  await expect(name).toBeEnabled();
  await expect(name).toBeFocused();
  await name.fill('Unsubmitted generated camera name');
  expect(state.checks).toBe(1);
  expect(state.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(await page.evaluate(() => window.handoffCameraCalls)).toBe(0);

  // A fresh request revision returns to the already connected form and keeps
  // its unfinished fields instead of asking for another connection or saving.
  await nav(page,'Monitor').click();
  await handoff(page,false);
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Unsubmitted generated camera name');
  expect(state.checks).toBe(1);
  expect(state.requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(await page.evaluate(() => window.handoffCameraCalls)).toBe(0);
});
