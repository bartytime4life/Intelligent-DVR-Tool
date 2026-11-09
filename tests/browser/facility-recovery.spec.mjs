import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {savedFacilities,savedPlan} from './facility-test-helpers.mjs';

const key='dvr.facilities.v1';
const recovery=page=>page.getByRole('region',{name:'Facilities save conflict'});
async function open(page) {
  await page.route('**/api/**',route=>route.abort());
  await page.goto('/#facility');
  await expect(page.getByLabel('Facility name',{exact:true})).toBeVisible();
}
async function rename(page,name) {
  await page.getByLabel('Facility name',{exact:true}).fill(name);
  await page.getByRole('button',{name:'Save site',exact:true}).click();
}
async function download(page,name) {
  const ready=page.waitForEvent('download');
  await recovery(page).getByRole('button',{name,exact:true}).click();
  return JSON.parse(await readFile(await (await ready).path(),'utf8'));
}
async function copies(page) {
  return page.evaluate(name=>Object.keys(localStorage).filter(k=>k.startsWith(name+'.conflict-backup.'))
    .map(k=>JSON.parse(JSON.parse(localStorage.getItem(k)).raw)),key);
}

for(const choice of ['Keep this tab’s version','Use other tab’s version'])test(`two facility tabs recover with ${choice} and preserve both collections`,async({page,context},info)=>{
  await page.addInitScript(name=>{
    const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(this===localStorage && key===name && window.blockFacilityWrites)throw new DOMException('Generated quota pressure','QuotaExceededError');return write.call(this,key,value);};
  },key);
  await open(page);await expect.poll(async()=>Boolean(await savedFacilities(page))).toBe(true);
  const other=await context.newPage();await open(other);
  await page.evaluate(()=>{window.blockFacilityWrites=true;});
  await rename(page,'Generated local facility');
  await expect(page.getByText('Memory only · export a backup',{exact:true})).toBeVisible();
  await rename(other,'Generated remote facility');
  await expect.poll(async()=>(await savedPlan(other)).name).toBe('Generated remote facility');
  await expect(recovery(page)).toBeVisible();
  expect((await download(page,'Download this version')).facilities[0].plan.name).toBe('Generated local facility');
  expect((await download(page,'Download other version')).facilities[0].plan.name).toBe('Generated remote facility');
  await page.screenshot({path:info.outputPath('facility-conflict.png'),fullPage:true});
  await page.evaluate(()=>{window.blockFacilityWrites=false;});
  await recovery(page).getByRole('button',{name:choice,exact:true}).click();
  await expect(recovery(page)).toHaveCount(0);
  const expected=choice==='Keep this tab’s version'?'Generated local facility':'Generated remote facility';
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue(expected);
  await expect.poll(async()=>(await savedPlan(page)).name).toBe(expected);
  expect((await copies(page)).some(value=>value.facilities[0].plan.name===(choice==='Keep this tab’s version'?'Generated remote facility':'Generated local facility'))).toBe(true);
  await other.close();
});

test('unreadable facility storage can be explicitly recovered with the original bytes preserved',async({page})=>{
  await page.addInitScript(name=>{if(localStorage.getItem(name)===null)localStorage.setItem(name,'{generated-broken');},key);
  await open(page);await expect(recovery(page)).toBeVisible();
  await rename(page,'Recovered generated plan');
  await expect(recovery(page).getByRole('button',{name:'Keep this tab’s version',exact:true})).toBeEnabled();
  expect(await page.evaluate(name=>localStorage.getItem(name),key)).toBe('{generated-broken');
  await recovery(page).getByRole('button',{name:'Keep this tab’s version',exact:true}).click();
  await expect(recovery(page)).toHaveCount(0);
  expect((await savedPlan(page)).name).toBe('Recovered generated plan');
  expect(await page.evaluate(name=>JSON.parse(localStorage.getItem(name+'.conflict-backup.1')).raw,key)).toBe('{generated-broken');
  await page.reload();await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Recovered generated plan');
});

test('new previews entered while a conflict choice waits for the lock are kept',async({page,context})=>{
  await open(page);await expect.poll(async()=>Boolean(await savedFacilities(page))).toBe(true);
  const other=await context.newPage();await open(other);await rename(other,'Remote generated plan');
  await expect(recovery(page)).toBeVisible();
  await page.evaluate(name=>{
    window.facilityLockEntered=false;
    navigator.locks.request('intelligent-dvr.workspace-save:'+name,()=>new Promise(resolve=>{window.releaseFacilityLock=resolve;window.facilityLockEntered=true;}));
  },key);
  await page.waitForFunction(()=>window.facilityLockEntered);
  await recovery(page).getByRole('button',{name:'Use other tab’s version',exact:true}).click();
  await page.getByLabel('Facility name',{exact:true}).fill('Draft typed during recovery');
  await page.evaluate(()=>window.releaseFacilityLock());
  await expect(recovery(page)).toContainText('Save or discard your preview');
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Draft typed during recovery');
  expect((await savedPlan(page)).name).toBe('Remote generated plan');
  await other.close();
});
