import { test, expect } from '@playwright/test';

// Generated catalog/consent input only: there is no recording or model worker.
// Accidental camera access fails immediately instead of consulting a device.
const nav = (page, name) => page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name, exact:true});
async function generatedSetup(page) {
  const writes = [];
  await page.addInitScript(() => {
    window.generatedCameraRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{
      enumerateDevices:async () => [],
      getUserMedia:() => {
        window.generatedCameraRequests++;
        return Promise.reject(new DOMException('Camera access is forbidden in this test', 'NotAllowedError'));
      },
    }});
  });
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST') writes.push(path);
    if (path === '/api/analysis/session') return route.fulfill({json:{
      token:'generated-catalog-token', ready:true, recording_import:{enabled:true}, training:{enabled:true},
      models:[{id:'generated-detector', name:'Generated detector', profile:'opencv-zoo-yolox-generated'}],
      rules:[{id:'generated-rule', name:'Generated person rule', models:['generated-detector']}],
      people:{enabled:true, statement:'Generated agreement for a test-only person'},
    }});
    if (path === '/api/analysis/people') return route.fulfill({json:{people:[]}});
    return route.fulfill({status:503, json:{error:{message:'No service operation exists in this generated test.'}}});
  });
  await page.goto('/#train');
  await expect(page.getByRole('heading', {name:'Train', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Start session', exact:true})).toBeEnabled();
  return writes;
}

async function chooseConfirmation(page, action, accept) {
  const ready = page.waitForEvent('dialog');
  const click = action();
  const dialog = await ready;
  expect(dialog.type()).toBe('confirm');
  const message = dialog.message();
  await (accept ? dialog.accept() : dialog.dismiss());
  await click;
  return message;
}

test('edited enrollment survives cancelled navigation and Exit, then leaves only after explicit confirmation', async ({page}) => {
  const writes = await generatedSetup(page);
  await page.getByRole('button', {name:'Enroll a person', exact:true}).click();
  const name = page.getByRole('textbox', {name:'Person’s name', exact:true});
  await name.fill('Generated Person');
  const navigationWarning = await chooseConfirmation(page, () => nav(page, 'Events').click(), false);
  expect(navigationWarning).toContain('Leave Train?');
  await expect(page).toHaveURL(/#train$/);
  await expect(name).toHaveValue('Generated Person');
  const exitWarning = await chooseConfirmation(page, () => page.getByRole('button', {name:'Exit', exact:true}).click(), false);
  expect(exitWarning).toContain('unfinished person session');
  await expect(name).toHaveValue('Generated Person');
  await chooseConfirmation(page, () => nav(page, 'Events').click(), true);
  await expect(page).toHaveURL(/#events$/);
  await expect(page.getByRole('heading', {name:'Event history', exact:true})).toBeVisible();
  expect(await page.evaluate(() => window.generatedCameraRequests)).toBe(0);
  expect(writes).toEqual([]);
});

test('initial camera setup can exit or change workspaces without an abandonment prompt or camera access', async ({page}) => {
  const writes = await generatedSetup(page), dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.getByRole('button', {name:'Start session', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Camera check', exact:true})).toBeVisible();
  await page.getByLabel('Camera view name', {exact:true}).fill('Generated empty camera setup');
  await page.getByRole('button', {name:'Exit session', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Train', exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Start session', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Camera check', exact:true})).toBeVisible();
  await nav(page, 'Events').click();
  await expect(page).toHaveURL(/#events$/);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => window.generatedCameraRequests)).toBe(0);
  expect(writes).toEqual([]);
});
