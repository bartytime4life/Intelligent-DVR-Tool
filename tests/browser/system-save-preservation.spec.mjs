import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {DEFAULT_SETUP,parseSetup} from '../../src/resources.mjs';

const setupKey='dvr.setup.v1';
const cameras=page=>page.getByLabel('Planned cameras',{exact:true});
const apply=page=>page.getByRole('button',{name:'Apply workspace limits',exact:true}).click();
const conflict=page=>page.locator('.system-save-recovery');
const stored=page=>page.evaluate(key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}},setupKey);
const unloadBlocked=page=>page.evaluate(()=>{
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
});
async function setup(context,page,raw=JSON.stringify(DEFAULT_SETUP)) {
  await context.addInitScript(({key,raw})=>{
    if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);
    const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(name,value){
      if(name===key && window.failGeneratedSetupWrite)throw new DOMException('Generated quota failure','QuotaExceededError');
      return write.call(this,name,value);
    };
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      enumerateDevices:async()=>[],getUserMedia:()=>{throw Error('Camera access is forbidden in this generated test.');},
    }});
  },{key:setupKey,raw});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.hostname==='127.0.0.1' && !url.pathname.startsWith('/api/')?route.continue():route.abort();
  });
  await page.goto('/#system');
  await expect(cameras(page)).toBeVisible();
}
async function saveOther(context,number) {
  const other=await context.newPage();await other.goto('/#system');
  await cameras(other).fill(String(number));await apply(other);
  await expect.poll(async()=>(await stored(other))?.workload?.cameras).toBe(number);
  return other;
}
async function makeConflict(context,page) {
  await setup(context,page);
  await page.evaluate(()=>{window.failGeneratedSetupWrite=true;});
  await cameras(page).fill('123');await apply(page);
  await expect(page.locator('.workspace-storage-warning')).toContainText('Machine plan:');
  const other=await saveOther(context,234);
  await expect(conflict(page).getByRole('heading',{name:'Machine plan save conflict',exact:true})).toBeVisible();
  return other;
}
async function downloaded(page,action) {
  const waiting=page.waitForEvent('download');await action();const download=await waiting;
  return readFile(await download.path(),'utf8');
}

test('failed applied machine plans survive another tab, export both plain versions and persist an explicit local choice',async({context,page})=>{
  const other=await makeConflict(context,page);
  await expect(cameras(page)).toHaveValue('123');
  await expect(page.locator('.system-save-state')).toContainText('saving is paused');
  expect(await unloadBlocked(page)).toBe(true);
  const local=await downloaded(page,()=>conflict(page).getByRole('button',{name:'Download this version',exact:true}).click());
  const remote=await downloaded(page,()=>conflict(page).getByRole('button',{name:'Download other version',exact:true}).click());
  expect(parseSetup(local).workload.cameras).toBe(123);expect(parseSetup(remote).workload.cameras).toBe(234);
  await cameras(page).fill('345');await apply(page);
  await expect(cameras(page)).toHaveValue('345');expect((await stored(page)).workload.cameras).toBe(234);
  await page.evaluate(()=>{window.failGeneratedSetupWrite=false;});
  await conflict(page).getByRole('button',{name:'Keep this tab’s version',exact:true}).click();
  await expect.poll(async()=>(await stored(page))?.workload?.cameras).toBe(345);
  await expect(conflict(page)).toHaveCount(0);expect(await unloadBlocked(page)).toBe(false);
  const archived=await page.evaluate(key=>JSON.parse(localStorage.getItem(`${key}.conflict-backup.1`)).raw,setupKey);
  expect(parseSetup(archived).workload.cameras).toBe(234);
  await other.close();
});

test('an unapplied System draft disables conflict adoption until discarded and then loads the selected version',async({context,page})=>{
  const other=await makeConflict(context,page);
  await cameras(page).fill('345');
  await expect(conflict(page).getByRole('button',{name:'Use other tab’s version',exact:true})).toBeDisabled();
  await expect(conflict(page)).toContainText('Apply or discard your machine-plan draft');
  await expect(cameras(page)).toHaveValue('345');expect((await stored(page)).workload.cameras).toBe(234);
  await page.getByRole('button',{name:'Discard draft & use applied setup',exact:true}).click();
  await expect(cameras(page)).toHaveValue('123');
  await page.evaluate(()=>{window.failGeneratedSetupWrite=false;});
  await conflict(page).getByRole('button',{name:'Use other tab’s version',exact:true}).click();
  await expect(cameras(page)).toHaveValue('234');
  await expect(conflict(page)).toHaveCount(0);expect(await unloadBlocked(page)).toBe(false);
  const archived=await page.evaluate(key=>JSON.parse(localStorage.getItem(`${key}.conflict-backup.1`)).raw,setupKey);
  expect(parseSetup(archived).workload.cameras).toBe(123);
  await other.close();
});

test('a clean remote save updates the applied plan while preserving unfinished System form edits',async({context,page})=>{
  await setup(context,page);await cameras(page).fill('123');
  const other=await saveOther(context,234);
  await expect(page.locator('.system-save-state')).toContainText('Your draft is kept');
  await expect(cameras(page)).toHaveValue('123');expect(await unloadBlocked(page)).toBe(true);
  await page.getByRole('button',{name:'Discard draft & use applied setup',exact:true}).click();
  await expect(cameras(page)).toHaveValue('234');expect(await unloadBlocked(page)).toBe(false);
  expect((await stored(page)).workload.cameras).toBe(234);await other.close();
});

test('unreadable machine plans remain downloadable without a false unsaved warning and are backed up before an applied save',async({context,page})=>{
  const raw='{generated unreadable machine plan';await setup(context,page,raw);
  expect(await page.evaluate(key=>localStorage.getItem(key),setupKey)).toBe(raw);
  expect(await unloadBlocked(page)).toBe(false);
  const recovered=await downloaded(page,()=>page.getByRole('button',{name:'Download unreadable machine plan',exact:true}).click());
  expect(recovered).toBe(raw);
  await cameras(page).fill('123');await apply(page);
  await expect.poll(async()=>(await stored(page))?.workload?.cameras).toBe(123);
  expect(await page.evaluate(key=>localStorage.getItem(`${key}.unreadable`),setupKey)).toBe(raw);
  await expect(page.locator('.system-save-state')).not.toContainText('only in memory');
  expect(await unloadBlocked(page)).toBe(false);
  // The original recovery notice stays available independently of save success.
  await expect(page.getByRole('button',{name:'Download unreadable machine plan',exact:true})).toBeVisible();
});

test('explicit Apply repairs an unreadable plan with unchanged defaults and preserves the unreadable original',async({context,page})=>{
  const raw='{generated unreadable defaults';await setup(context,page,raw);
  await expect(cameras(page)).toHaveValue(String(DEFAULT_SETUP.workload.cameras));
  await apply(page);
  await expect.poll(async()=>stored(page)).toEqual(DEFAULT_SETUP);
  expect(await page.evaluate(key=>localStorage.getItem(`${key}.unreadable`),setupKey)).toBe(raw);
  expect(await unloadBlocked(page)).toBe(false);
  await page.reload();
  await expect(cameras(page)).toHaveValue(String(DEFAULT_SETUP.workload.cameras));
  await expect(page.getByRole('button',{name:'Download unreadable machine plan',exact:true})).toHaveCount(0);
  expect(await unloadBlocked(page)).toBe(false);
});
