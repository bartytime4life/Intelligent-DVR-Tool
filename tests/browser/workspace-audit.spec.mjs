import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { recognitionFixture } from '../fixtures/recognition.mjs';
import { parseReceipt } from '../../src/data.mjs';

// Offline browser-only audit. No camera permission, RTSP access, or live provider calls.
const nav = (page,label) => page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:new RegExp('^'+label)});
const views = [
  ['Monitor',/^Monitor/],
  ['Recognition',/^Recognition$/],
  ['Facility',/^Locate your facility$/],
  ['Events',/^Event history$/],
  ['Zones',/^Define what needs attention$/],
  ['System',/^Give every camera room to work\.$/],
  ['Settings',/^Connections and local evidence$/]
];
async function offline(page) {
  await page.route('**/*', route => {
    const address=new URL(route.request().url());
    return address.hostname==='127.0.0.1' ? route.continue() : route.abort();
  });
}
async function auditView(page,label,heading,form,emit=false) {
  await nav(page,label).click();
  await expect(page).toHaveURL(new RegExp('#'+label.toLowerCase()+'$'));
  await expect(nav(page,label)).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('heading',{name:heading}).first()).toBeVisible();
  await expect(page.locator('main#workspace')).toBeVisible();
  const sizing=await page.evaluate(() => ({
    width:innerWidth,document:document.documentElement.scrollWidth,
    body:document.body.scrollWidth,focusable:document.querySelectorAll('button:not([disabled]),a[href],input:not([disabled])').length
  }));
  console.log('AUDIT_WORKSPACE '+JSON.stringify({view:label,form,...sizing}));
  expect(sizing.document, label+' document viewport overflow').toBeLessThanOrEqual(sizing.width+1);
  await page.screenshot({path:'qa-local/workspace-audit/'+form+'-'+label.toLowerCase()+'.png',fullPage:false});
  if(emit) console.log('AUDIT_JPEG '+form+'-'+label.toLowerCase()+' '+(await page.screenshot({type:'jpeg',quality:25})).toString('base64'));
}

for(const [form,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
  test('seven-workspace '+form+' navigation, visible headings, overflow and screenshots',async({page})=>{
    test.setTimeout(120000);
    await offline(page);
    await mkdir('qa-local/workspace-audit',{recursive:true});
    await page.setViewportSize({width,height});
    await page.goto('/#settings');
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const [label,heading] of views) {
      await auditView(page,label,heading,form,
        (form==='desktop'&&['Monitor','Facility'].includes(label))||(form==='mobile'&&label==='System'));
    }
    await page.goBack();
    await expect(page).toHaveURL(/#system$/);
    await expect(nav(page,'System')).toHaveAttribute('aria-current','page');
    await page.goForward();
    await expect(page).toHaveURL(/#settings$/);
    expect(errors).toEqual([]);
  });
}

test('Monitor source dialog and Settings navigation stay keyboard-usable without connecting cameras',async({page})=>{
  await offline(page);
  await page.goto('/#monitor');
  const opener=page.getByRole('button',{name:'Connect source'}).first();
  await opener.click();
  const dialog=page.getByRole('dialog',{name:'Connect a camera source'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Local DVR / IP camera'}).click();
  await expect(dialog).toContainText('Choose an RTSP channel');
  await dialog.getByRole('button',{name:'Public internet webcam'}).click();
  await expect(dialog).toContainText('Choose an approved public webcam');
  await dialog.getByRole('button',{name:'This computer’s webcam'}).click();
  await expect(dialog).toContainText('Use a built-in or USB webcam');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await nav(page,'Settings').click();
  await page.getByRole('button',{name:'Open camera connections'}).click();
  await expect(page).toHaveURL(/#monitor$/);
  await nav(page,'Settings').click();
  await page.getByRole('button',{name:'Plan this machine'}).click();
  await expect(page).toHaveURL(/#system$/);
});

test('unsaved Zones and System drafts require explicit permission to navigate or switch plans',async({page})=>{
  await offline(page);
  await page.goto('/#zones');
  const zoneName=page.getByLabel('Zone name',{exact:true});
  const savedName=await zoneName.inputValue();
  await zoneName.fill('Draft only – not yet saved');
  await expect(page.getByText('Unsaved review rule changes.',{exact:false})).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());
  await nav(page,'Monitor').click();
  await expect(page).toHaveURL(/#zones$/);
  await expect(zoneName).toHaveValue('Draft only – not yet saved');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByLabel('Camera for zone').selectOption('2');
  await expect(page.getByLabel('Camera for zone')).toHaveValue('1');
  await expect(zoneName).toHaveValue('Draft only – not yet saved');
  page.once('dialog',dialog=>dialog.accept());
  await nav(page,'Monitor').click();
  await nav(page,'Zones').click();
  await expect(page.getByLabel('Zone name',{exact:true})).toHaveValue(savedName);
  await nav(page,'System').click();
  const cameraCount=page.getByLabel('Planned cameras');
  const savedCount=await cameraCount.inputValue();
  await cameraCount.fill(String(Number(savedCount)+1));
  await expect(page.getByText('Draft changed.',{exact:false})).toBeVisible();
  page.once('dialog',dialog=>dialog.dismiss());
  await nav(page,'Monitor').click();
  await expect(page).toHaveURL(/#system$/);
  await expect(cameraCount).toHaveValue(String(Number(savedCount)+1));
  page.once('dialog',dialog=>dialog.accept());
  await nav(page,'Monitor').click();
  await nav(page,'System').click();
  await expect(page.getByLabel('Planned cameras')).toHaveValue(savedCount);
});

test('deferred Events deep link resolves when matching recording results arrive',async({page})=>{
  await offline(page);
  const bundle=recognitionFixture();
  const [event]=parseReceipt(bundle.receipt);
  await page.addInitScript(raw=>{if(!sessionStorage.getItem('audit-seed')){
    localStorage.setItem('dvr.events.v1',raw);
    sessionStorage.setItem('audit-seed','1');
  }},JSON.stringify([event]));
  await page.goto('/#events');
  await page.locator('.event-table-row').first().click();
  await page.getByRole('dialog',{name:'Review observation'}).getByRole('button',{name:'Open in Recognition'}).click();
  await expect(page).toHaveURL(/#recognition$/);
  await expect(page.locator('.recognition-status')).toContainText('belongs to recording');
  await page.getByLabel('Open recognition results').setInputFiles({
    name:'audit-review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))
  });
  await expect(page.locator('.recognition-status')).toContainText('matching results contain the observation');
  await expect(page.locator('.recognition-observations')).toContainText('Rule observations');
  await expect(page.getByRole('button',{name:'Previous sample'})).toBeDisabled();
});

test('Browser Back respects the active dirty editor instead of jumping to Facility',async({page})=>{
  await offline(page);
  await page.goto('/#monitor');
  await nav(page,'Zones').click();
  await page.getByLabel('Zone name',{exact:true}).fill('Back navigation draft');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/#zones$/);
  await expect(page.getByLabel('Zone name',{exact:true})).toHaveValue('Back navigation draft');
  page.once('dialog',dialog=>dialog.accept());
  await nav(page,'System').click();
  const setting=page.getByLabel('Planned cameras');
  const current=Number(await setting.inputValue());
  await setting.fill(String(current+2));
  page.once('dialog',dialog=>dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/#system$/);
  await expect(setting).toHaveValue(String(current+2));
});
