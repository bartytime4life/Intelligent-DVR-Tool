import {test,expect} from '@playwright/test';
import {blankFacility,validateFacility} from '../../src/facility.mjs';
import {createLibrary,LIBRARY_KEY} from '../../src/facility-library.mjs';

const camera=id=>({id,name:id,x:0,y:-25,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:55,enabled:true});
const fixture=validateFacility({...blankFacility(),name:'Diagnostics recovery',cameras:[camera('C1'),camera('C2')]});
async function openLab(page){
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(({key,raw})=>localStorage.setItem(key,raw),{key:LIBRARY_KEY,raw:JSON.stringify(createLibrary(fixture))});
  await page.goto('/#facility');
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
  await page.locator('.facility-image-lab summary').click();
}
async function loadImage(page,name='original.png'){
  const data=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=16;c.height=16;
    const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,16,16);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Open image for diagnostics').setInputFiles({name,mimeType:'image/png',buffer:Buffer.from(data,'base64')});
}
async function delayDecode(page){
  await page.evaluate(()=>{
    const decode=window.createImageBitmap.bind(window);window.originalDecode=decode;
    window.bitmapClosed=false;window.finishDecode=null;
    window.createImageBitmap=async(...args)=>{
      const bitmap=await decode(...args),close=bitmap.close.bind(bitmap);
      bitmap.close=()=>{window.bitmapClosed=true;close();};
      return new Promise(resolve=>{window.finishDecode=()=>resolve(bitmap);});
    };
  });
}
test('clearing frames retires a pending decode and still closes its bitmap',async({page})=>{
  await openLab(page);await loadImage(page);
  await expect(page.locator('.facility-lab-source')).toContainText('original.png');
  await delayDecode(page);await loadImage(page,'late.png');
  await page.waitForFunction(()=>window.finishDecode);
  await page.getByRole('button',{name:'Clear frames',exact:true}).click();
  await page.evaluate(()=>window.finishDecode());
  await expect.poll(()=>page.evaluate(()=>window.bitmapClosed)).toBe(true);
  await expect(page.locator('.facility-lab-source')).toHaveCount(0);
  await expect(page.locator('.facility-lab-empty')).toBeVisible();
});
test('frame switching preserves each region and retires an unfinished import',async({page})=>{
  await openLab(page);await loadImage(page,'a.png');
  await page.getByLabel('Diagnostics region left').fill('25');
  await page.getByRole('button',{name:'Pixel ruler',exact:true}).click();
  const stage=page.locator('.facility-lab-image-stage');await stage.scrollIntoViewIfNeeded();
  const box=await stage.boundingBox();
  await page.mouse.move(box.x+box.width*.25,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.75,box.y+box.height*.5);await page.mouse.up();
  await expect(page.getByText(/Pixel ruler:/)).toContainText('8.0 px');
  await page.getByRole('button',{name:/^Frame B/}).click();await loadImage(page,'b.png');
  await expect(page.getByText(/Pixel ruler:/)).toHaveCount(0);
  await page.getByLabel('Diagnostics region top').fill('50');
  await page.getByRole('button',{name:/^Frame A/}).click();
  await expect(page.getByLabel('Diagnostics region left')).toHaveValue('25');
  await expect(page.getByLabel('Diagnostics region top')).toHaveValue('0');
  await expect(page.getByText(/Pixel ruler:/)).toContainText('8.0 px');
  await delayDecode(page);await loadImage(page,'late-a.png');
  await page.waitForFunction(()=>window.finishDecode);
  await page.getByRole('button',{name:/^Frame B/}).click();
  await page.evaluate(()=>window.finishDecode());
  await expect.poll(()=>page.evaluate(()=>window.bitmapClosed)).toBe(true);
  await expect(page.locator('.facility-lab-source')).toContainText('b.png');
  await expect(page.getByLabel('Diagnostics region top')).toHaveValue('50');
  await page.getByRole('button',{name:/^Frame A/}).click();
  await expect(page.locator('.facility-lab-source')).toContainText('a.png');
});
test('cancelled import cannot replace a newer image or its exported inspection region',async({page})=>{
  await openLab(page);await delayDecode(page);await loadImage(page,'cancelled.png');
  await page.waitForFunction(()=>window.finishDecode);
  await page.getByRole('button',{name:'Cancel image import',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open local image',exact:true})).toBeEnabled();
  await page.evaluate(()=>{window.createImageBitmap=window.originalDecode;});
  await loadImage(page,'newer.png');
  await expect(page.locator('.facility-lab-source')).toContainText('newer.png');
  await page.getByLabel('Diagnostics region left').fill('25');
  await page.evaluate(()=>window.finishDecode());
  await expect.poll(()=>page.evaluate(()=>window.bitmapClosed)).toBe(true);
  await expect(page.locator('.facility-lab-source')).toContainText('newer.png');
  await expect(page.getByLabel('Diagnostics region left')).toHaveValue('25');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export metrics JSON',exact:true}).click();
  const {readFile}=await import('node:fs/promises');
  const report=JSON.parse(await readFile(await (await download).path(),'utf8'));
  expect(report.source).toBe('newer.png');expect(report.frame).toBe('A');expect(report.region.x).toBe(.25);
});
test('a decode error after cancellation cannot replace the current feedback',async({page})=>{
  await openLab(page);
  await page.evaluate(()=>{window.createImageBitmap=()=>new Promise((_,reject)=>{window.failDecode=()=>reject(Error('Retired decoder error'));});});
  await loadImage(page);await page.waitForFunction(()=>window.failDecode);
  await page.getByRole('button',{name:'Cancel image import',exact:true}).click();
  await page.evaluate(()=>window.failDecode());
  await expect(page.locator('.facility-image-lab [role="alert"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open local image',exact:true})).toBeEnabled();
});
test('changing planned cameras cannot relabel old image measurements',async({page})=>{
  await openLab(page);await loadImage(page);
  await expect(page.locator('.facility-calibration')).toBeVisible();
  await page.getByLabel('Selected camera',{exact:true}).selectOption('C2');
  await page.locator('.facility-image-lab summary').click();
  await expect(page.locator('.facility-lab-source')).toHaveCount(0);
  await expect(page.locator('.facility-calibration')).toHaveCount(0);
});
test('image and video pickers have one visible keyboard stop and still open files',async({page})=>{
  await openLab(page);
  const image=page.getByRole('button',{name:'Open local image',exact:true}),video=page.getByRole('button',{name:'Open local video',exact:true});
  await image.focus();await page.keyboard.press('Tab');await expect(video).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(image).toBeFocused();
  const chooser=page.waitForEvent('filechooser');await page.keyboard.press('Enter');
  expect((await chooser).isMultiple()).toBe(false);
  await video.focus();const videoChooser=page.waitForEvent('filechooser');await page.keyboard.press('Enter');
  expect((await videoChooser).isMultiple()).toBe(false);
});
