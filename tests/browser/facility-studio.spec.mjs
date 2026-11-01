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

test('transparent local PNGs are composited before analysis and lossless frame export',async({page})=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'Cameras',exact:true}).click();
  await page.locator('.facility-image-lab summary').click();
  const picture = async alpha => page.evaluate(value => {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(255,255,255,' + value + ')';
    context.fillRect(0,0,16,16);
    return canvas.toDataURL('image/png').split(',')[1];
  }, alpha);
  const half=await picture(0.5);
  await page.getByLabel('Open image for diagnostics').setInputFiles({
    name:'transparent.png',mimeType:'image/png',buffer:Buffer.from(half,'base64')
  });
  const mean = page.locator('.facility-lab-metrics > div').first().locator('strong');
  await expect(mean).toContainText('128.0');
  await expect(page.locator('.facility-lab-metrics')).toContainText('0.0%');
  const frozen=await page.locator('.facility-lab-image-stage img').evaluate(async img=>{
    const bitmap=await createImageBitmap(img);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);
    const sample=Array.from(context.getImageData(0,0,1,1).data);
    bitmap.close();
    return {sample,format:img.src.slice(0,22)};
  });
  expect(frozen.format).toBe('data:image/png;base64,');
  expect(frozen.sample).toEqual([128,128,128,255]);
  await page.getByRole('button',{name:/Frame B/}).click();
  const opaque=await picture(1);
  await page.getByLabel('Open image for diagnostics').setInputFiles({
    name:'opaque.png',mimeType:'image/png',buffer:Buffer.from(opaque,'base64')
  });
  await expect(page.getByText(/mean absolute luma change/)).toBeVisible();
  const comparison=await page.locator('.facility-lab-result').last().innerText();
  expect(comparison).toContain('100.0%');
  expect(errors).toEqual([]);
});

test('calibrated map ruler requires withheld check and independent measured reference declaration',async({page})=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.getByRole('button',{name:'Cameras',exact:true}).click();
  await page.locator('.facility-image-lab summary').click();
  const picture=await image(page,false);
  await page.getByLabel('Open image for diagnostics').setInputFiles({name:'ground.png',mimeType:'image/png',buffer:Buffer.from(picture,'base64')});
  const cal=page.locator('.facility-calibration');
  await cal.locator('summary').click();
  await expect(cal.getByText(/Four|4 fit points/i).first()).toBeVisible();
  const points=[[10,10,1,1],[90,10,9,1],[90,90,9,9],[10,90,1,9],[50,50,5,5]];
  for(let i=0;i<points.length;i++){
    const number=i+1,[u,v,e,n]=points[i];
    await page.getByLabel('Reference '+number+' Image X %').fill(String(u));
    await page.getByLabel('Reference '+number+' Image Y %').fill(String(v));
    await page.getByLabel('Reference '+number+' East metres').fill(String(e));
    await page.getByLabel('Reference '+number+' North metres').fill(String(n));
  }
  await cal.getByRole('button',{name:'Compute planar transform'}).click();
  await expect(cal).toContainText('Independent check (1)');
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toBeDisabled();
  await cal.locator('.facility-calibration-declaration input').check();
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toBeEnabled();
  await page.getByLabel('Ground ruler Start X').fill('25');
  await page.getByLabel('Ground ruler Start Y').fill('25');
  await page.getByLabel('Ground ruler End X').fill('75');
  await page.getByLabel('Ground ruler End Y').fill('25');
  await expect(cal).toContainText('Plane-only estimated distance: 5.00 m');
  await page.getByLabel('Ground ruler End X').fill('99');
  await expect(cal).toContainText('Extrapolation is refused');
  await page.getByLabel('Reference 1 East metres').fill('2');
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a chosen ground reference accepts an explicit local map pick, without activating recording',async({page})=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.getByRole('button',{name:'Cameras',exact:true}).click();
  await page.locator('.facility-image-lab summary').click();
  const picture=await image(page,false);
  await page.getByLabel('Open image for diagnostics').setInputFiles({name:'map-ref.png',mimeType:'image/png',buffer:Buffer.from(picture,'base64')});
  const cal=page.locator('.facility-calibration');await cal.locator('summary').click();
  await cal.locator('.facility-calibration-ref').first().getByRole('button',{name:'Pick on map'}).click();
  await expect(page.locator('.facility-draw-hint')).toContainText('Select the measured ground marker');
  await expect(page.getByRole('button',{name:'2D',exact:true})).toHaveAttribute('aria-pressed','true');
  const box=await page.locator('.facility-map').boundingBox();
  await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);
  await expect(page.locator('.facility-draw-hint')).toHaveCount(0);
  await expect(page.getByLabel('Reference 1 East metres')).not.toHaveValue('');
  await expect(page.getByLabel('Reference 1 North metres')).not.toHaveValue('');
  expect(errors).toEqual([]);
});
