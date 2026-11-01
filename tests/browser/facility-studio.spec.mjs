import { test, expect } from '@playwright/test';
import { blankFacility, validateFacility } from '../../src/facility.mjs';
import { createLibrary, LIBRARY_KEY } from '../../src/facility-library.mjs';

const rect = [[-20,-15],[20,-15],[20,15],[-20,15],[-20,-15]];
const fixture = validateFacility({...blankFacility(),name:'Studio fixture',
  buildings:[{id:'b1',name:'Workshop',footprint:rect,height:7,floors:1}],
  cameras:[{id:'C1',name:'Dock',x:0,y:-25,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:55,enabled:true,pixelsWide:1280}]});
async function openStudio(page) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(({key,raw})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);},{key:LIBRARY_KEY,raw:JSON.stringify(createLibrary(fixture))});
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility'})).toBeVisible();
}
const image = (data, white=false) => data.evaluate(isWhite => {
  const c=document.createElement('canvas');c.width=16;c.height=16;
  const ctx=c.getContext('2d');ctx.fillStyle=isWhite?'white':'black';ctx.fillRect(0,0,16,16);
  if(!isWhite){ctx.fillStyle='white';ctx.fillRect(8,0,8,16);}
  return c.toDataURL('image/png').split(',')[1];
},white);

test('Facility Studio focus map and navigation are reversible and keyboard accessible', async({page})=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.getByRole('button',{name:'Focus facility map'}).click();
  await expect(page.locator('.facility-guide')).toBeHidden();
  await expect(page.locator('.facility-properties')).toBeHidden();
  await expect(page.locator('.facility-map')).toBeVisible();
  await page.getByRole('button',{name:'Show facility panels'}).click();
  await expect(page.locator('.facility-guide')).toBeVisible();
  await page.getByRole('button',{name:'Help',exact:true}).click();
  await expect(page.getByRole('region',{name:'Facility keyboard and map help'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region',{name:'Facility keyboard and map help'})).toHaveCount(0);
  await page.getByRole('button',{name:'Cameras',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Aim this camera'})).toBeVisible();
  await page.keyboard.press('5');
  await expect(page.getByRole('heading',{name:'Check estimated coverage'})).toBeVisible();
  await page.getByLabel('Selected camera',{exact:true}).focus();
  await page.keyboard.press('4');
  // Typing in a form does not trigger a global task shortcut.
  await expect(page.getByRole('heading',{name:'Check estimated coverage'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('image laboratory imports only on request, reports ROI and compares two local frames',async({page})=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.getByRole('button',{name:'Cameras',exact:true}).click();
  await page.locator('.facility-image-lab summary').click();
  await expect(page.getByRole('button',{name:/Freeze live frame into A/})).toBeDisabled();
  const a=await image(page,false);
  await page.getByLabel('Open image for diagnostics').setInputFiles({name:'test-a.png',mimeType:'image/png',buffer:Buffer.from(a,'base64')});
  await expect(page.locator('.facility-lab-metrics')).toContainText('Mean luma');
  await expect(page.locator('.facility-lab-metrics')).toContainText('Selected area');
  await page.getByLabel('Diagnostics region left').fill('50');
  await page.getByLabel('Diagnostics region width').fill('50');
  await expect(page.locator('.facility-lab-metrics')).toContainText('255.0');
  await page.getByRole('button',{name:/Frame B/}).click();
  const b=await image(page,true);
  await page.getByLabel('Open image for diagnostics').setInputFiles({name:'test-b.png',mimeType:'image/png',buffer:Buffer.from(b,'base64')});
  await expect(page.getByText(/mean absolute luma change/)).toBeVisible();
  await page.getByRole('button',{name:'Pixel ruler'}).click();
  await expect(page.locator('.facility-lab-image-stage')).toBeVisible();
  await page.getByRole('button',{name:'Clear frames'}).click();
  await expect(page.getByText(/No frame selected/)).toBeVisible();
  expect(errors).toEqual([]);
});
