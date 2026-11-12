import { test, expect } from '@playwright/test';
import {readFileSync} from 'node:fs';
import { readFile } from 'node:fs/promises';
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

async function exportMetrics(page) {
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export metrics JSON',exact:true}).click();
  const result=await downloaded;
  expect(result.suggestedFilename()).toBe('facility-image-diagnostics.json');
  return JSON.parse(readFileSync(await result.path(),'utf8'));
}

async function patchImage(page, maximum=false) {
  return page.evaluate(max => {
    const canvas=document.createElement('canvas');canvas.width=3;canvas.height=3;
    const ctx=canvas.getContext('2d'), data=ctx.createImageData(3,3);
    const levels=max ? [0,0,255,0,0,255,0,255,255] : Array(9).fill(128);
    levels.forEach((v,i)=>data.data.set([v,v,v,255],4*i));ctx.putImageData(data,0,0);
    return canvas.toDataURL('image/png').split(',')[1];
  },maximum);
}

for (const width of [1440,375]) test(`image edge strength distinguishes no support from measured zero at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000});
  await openStudio(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
  await page.locator('.facility-image-lab summary').click();
  const picture=await image(page,false);
  await page.getByLabel('Open image for diagnostics').setInputFiles({name:'generated-step.png',mimeType:'image/png',buffer:Buffer.from(picture,'base64')});
  await page.getByLabel('Diagnostics region height').fill('10');
  const strength=page.getByRole('group',{name:'Sobel edge strength',exact:true}),metrics=page.locator('.facility-lab-metrics');
  await expect(strength.locator('strong')).toHaveText('Unavailable');
  await expect(strength).toContainText('Needs a region of at least 3 × 3 pixels.');
  await expect(metrics).toContainText('16 × 2 pixels');
  const thin=await exportMetrics(page);
  expect(thin.schema).toBe('intelligent-dvr-image-diagnostics-v2');
  expect(thin.metrics).toMatchObject({sobel:null,sobelSamples:0,sobelMeanMagnitude:null,width:16,height:2,method:'srgb-luma-sobel-max-v2'});
  expect(thin.processing).toMatchObject({background:'opaque-black',exportFormat:'image/png',downsampleMaxSide:720,
    analysisMethod:'srgb-luma-sobel-max-v2',sobel:{units:'percent-of-maximum-8bit-response',kernel:[3,3],aggregation:'mean-magnitude',support:'selected-region-interior-no-padding',unavailable:'null-with-zero-samples'}});
  expect(thin.metrics.sobelMaximum).toBeCloseTo(1140.3946685248927,9);
  expect(thin.processing.sobel.maximumMagnitude).toBe(thin.metrics.sobelMaximum);
  expect(thin.source).toBe('generated-step.png');expect(thin.frame).toBe('A');
  expect(thin.originalPixels).toEqual([16,16]);expect(thin.sampledPixels).toEqual([16,16]);
  expect(thin.region.height).toBe(.1);expect(thin.difference).toBeNull();expect(thin.rulerPixels).toBeNull();
  await metrics.scrollIntoViewIfNeeded();
  expect(await metrics.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await metrics.screenshot({path:testInfo.outputPath(`sobel-unavailable-${width}.png`)});
  await page.getByRole('button',{name:'Full frame',exact:true}).click();
  await expect(strength.locator('strong')).not.toHaveText('Unavailable');
  await expect(strength).toContainText('196 interior pixels');
  await page.getByRole('button',{name:/Frame B/}).click();
  const flat=await patchImage(page);
  await page.getByLabel('Open image for diagnostics').setInputFiles({name:'generated-flat.png',mimeType:'image/png',buffer:Buffer.from(flat,'base64')});
  await expect(strength.locator('strong')).toHaveText('0.0%');
  await expect(strength).toContainText('1 interior pixel');
  await expect(page.getByText('Different sampled dimensions; pixel-aligned comparison is unavailable.')).toBeVisible();
  const zero=await exportMetrics(page);
  expect(zero.frame).toBe('B');expect(zero.metrics).toMatchObject({sobel:0,sobelSamples:1,sobelMeanMagnitude:0,width:3,height:3});
  expect(zero.difference).toBeNull();expect(zero.originalPixels).toEqual([3,3]);
  await metrics.screenshot({path:testInfo.outputPath(`sobel-measured-zero-${width}.png`)});
  expect(errors).toEqual([]);
});

test('maximum Sobel response is bounded at 100 percent and versioned in exported metrics',async({page},testInfo)=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
  await page.locator('.facility-image-lab summary').click();
  const maximum=await patchImage(page,true);
  await page.getByLabel('Open image for diagnostics').setInputFiles({name:'generated-maximum.png',mimeType:'image/png',buffer:Buffer.from(maximum,'base64')});
  const strength=page.getByRole('group',{name:'Sobel edge strength',exact:true});
  await expect(strength.locator('strong')).toHaveText('100.0%');
  await expect(strength).toContainText('1 interior pixel');
  const report=await exportMetrics(page);
  expect(report.schema).toBe('intelligent-dvr-image-diagnostics-v2');
  expect(report.metrics.sobel).toBe(100);expect(report.metrics.sobelSamples).toBe(1);
  expect(report.metrics.sobelMeanMagnitude).toBe(report.metrics.sobelMaximum);
  expect(report.metrics.sobelMaximum).toBeCloseTo(1140.3946685248927,9);
  await page.locator('.facility-lab-metrics').screenshot({path:testInfo.outputPath('sobel-maximum.png')});
  expect(errors).toEqual([]);
});

async function calibrationPanel(page) {
  await openStudio(page);
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
  await page.locator('.facility-image-lab summary').click();
  const picture=await image(page,false);
  await page.getByLabel('Open image for diagnostics').setInputFiles({
    name:'generated-plane.png',mimeType:'image/png',buffer:Buffer.from(picture,'base64')
  });
  const panel=page.locator('.facility-calibration');
  await panel.locator('summary').click();
  return panel;
}
async function enterCalibrationReferences(page,points) {
  for(let i=0;i<points.length;i++) {
    for(const [j,label] of ['Image X %','Image Y %','East metres','North metres'].entries()) {
      await page.getByLabel(`Reference ${i+1} ${label}`,{exact:true}).fill(String(points[i][j]));
    }
  }
}

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
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
  await expect(page.getByRole('heading',{name:'Aim this camera'})).toBeVisible();
  await page.keyboard.press('5');
  await expect(page.getByRole('heading',{name:'Check estimated coverage'})).toBeVisible();
  await page.getByLabel('Selected camera',{exact:true}).focus();
  await page.keyboard.press('4');
  // Typing in a form does not trigger a global task shortcut.
  await expect(page.getByRole('heading',{name:'Check estimated coverage'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('intermediate window widths keep the full map and every map-layer choice reachable', async({page})=>{
  await page.setViewportSize({width:662,height:900});
  await openStudio(page);
  await expect(page.getByRole('button',{name:'Grid',exact:true})).toBeEnabled();
  for (const width of [662,800]) {
    await page.setViewportSize({width,height:900});
    const workspace=await page.locator('.facility-workspace').boundingBox();
    const stage=await page.locator('.facility-stage').boundingBox();
    const inspector=await page.locator('.facility-properties').boundingBox();
    expect(Math.abs(stage.width-workspace.width)).toBeLessThan(2);
    expect(inspector.y).toBeGreaterThanOrEqual(stage.y+stage.height-1);
    const layers=page.locator('.facility-stage').getByRole('group',{name:'Map layer',exact:true});
    const bounds=await layers.boundingBox();
    await expect(layers.getByRole('button')).toHaveCount(4);
    for (const button of await layers.getByRole('button').all()) {
      const box=await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(stage.x-1);
      expect(box.x+box.width).toBeLessThanOrEqual(stage.x+stage.width+1);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y-1);
      expect(box.y+box.height).toBeLessThanOrEqual(bounds.y+bounds.height+1);
      expect(box.height).toBeGreaterThanOrEqual(38);
      await button.focus();await expect(button).toBeFocused();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.getByRole('button',{name:'Focus facility map'}).click();
  await expect(page.locator('.facility-properties')).toBeHidden();
  await page.getByRole('button',{name:'Show facility panels'}).click();
  await expect(page.locator('.facility-properties')).toBeVisible();
});

test('image laboratory imports only on request, reports ROI and compares two local frames',async({page})=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
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
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
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
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
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

test('safe perspective calibration with zero origin denominator measures and exports through existing gates',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  const cal=await calibrationPanel(page);
  // Independently generated from east=1/u, north=v/u. The horizon u=0
  // stays outside the reference square; all five measured points are finite.
  await enterCalibrationReferences(page,[[20,20,5,1],[80,20,1.25,.25],
    [80,80,1.25,1],[20,80,5,4],[50,50,2,1]]);
  await cal.getByRole('button',{name:'Compute planar transform'}).click();
  await expect(cal.getByRole('alert')).toHaveCount(0);
  await expect(cal).toContainText('Independent check (1)');
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toBeDisabled();
  await cal.locator('.facility-calibration-declaration input').check();
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toBeEnabled();
  await page.getByLabel('Ground ruler Start X',{exact:true}).fill('25');
  await page.getByLabel('Ground ruler Start Y',{exact:true}).fill('50');
  await page.getByLabel('Ground ruler End X',{exact:true}).fill('50');
  await page.getByLabel('Ground ruler End Y',{exact:true}).fill('50');
  // Ground endpoints are (4,2) and (2,1): distance sqrt(5).
  await expect(cal).toContainText('Plane-only estimated distance: 2.24 m');
  const download=page.waitForEvent('download');
  await cal.getByRole('button',{name:'Export calibration JSON'}).click();
  const document=JSON.parse(await readFile(await (await download).path(),'utf8'));
  expect(document.schema).toBe('intelligent-dvr.planar-calibration.v1');
  expect(document.operatorAcceptance).toBe(true);
  expect(document.method).toBe('normalized-householder-dlt-v2');
  expect(document.matrix).toHaveLength(9);
  expect(document.matrix.every(Number.isFinite)).toBe(true);
  expect(Math.abs(document.matrix[8])).toBeLessThan(1e-10);
  expect(document.ruler.metres).toBeCloseTo(Math.sqrt(5),10);
  expect(document.sourceSampleRGBAsha256).toMatch(/^[a-f0-9]{64}$/);
  await cal.locator('.facility-calibration-ruler').screenshot({path:testInfo.outputPath('calibration-projective-safe.png')});
  await page.getByLabel('Ground ruler End X',{exact:true}).fill('99');
  await expect(cal).toContainText('Extrapolation is refused');
  expect(errors).toEqual([]);
});

test('a collapsed ground plane cannot unlock the ruler and corrected markers recover',async({page})=>{
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  const cal=await calibrationPanel(page);
  await cal.getByRole('button',{name:'Add fit point',exact:true}).click();
  // Five distinct image fits all map to a single ground line; the independent
  // check also lies on that line. Tiny residuals cannot make this a plane.
  await enterCalibrationReferences(page,[[10,10,.1,.2],[90,15,.9,1.8],
    [80,90,.8,1.6],[20,80,.2,.4],[50,50,.5,1],[40,30,.4,.8]]);
  await cal.getByRole('button',{name:'Compute planar transform'}).click();
  await expect(cal.getByRole('alert')).toContainText(/non-collinear|degenerate|singular/i);
  await expect(cal.getByRole('region',{name:'Fitted ground-plane transform'})).toHaveCount(0);
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toHaveCount(0);
  await expect(cal.getByRole('button',{name:'Export calibration JSON'})).toHaveCount(0);
  await enterCalibrationReferences(page,[[10,10,1,1],[90,15,9,1.5],
    [80,90,8,9],[20,80,2,8],[50,50,5,5],[40,30,4,3]]);
  await cal.getByRole('button',{name:'Compute planar transform'}).click();
  await expect(cal.getByRole('alert')).toHaveCount(0);
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toBeDisabled();
  await cal.locator('.facility-calibration-declaration input').check();
  await expect(cal.getByRole('button',{name:'Measure within reference boundary'})).toBeEnabled();
  await page.getByLabel('Ground ruler Start X',{exact:true}).fill('25');
  await page.getByLabel('Ground ruler Start Y',{exact:true}).fill('25');
  await page.getByLabel('Ground ruler End X',{exact:true}).fill('75');
  await page.getByLabel('Ground ruler End Y',{exact:true}).fill('25');
  await expect(cal).toContainText('Plane-only estimated distance: 5.00 m');
  expect(errors).toEqual([]);
});

test('a chosen ground reference accepts an explicit local map pick, without activating recording',async({page})=>{
  await openStudio(page);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
  // The map's WebGL readiness is independent from rendering the React toolbar.
  await expect(page.getByRole('button',{name:'Place camera'})).toBeEnabled();
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

test('image reference numbering follows full row positions even when earlier markers are blank',async({page})=>{
  await openStudio(page);
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('3');
  await page.locator('.facility-image-lab summary').click();
  const picture=await image(page,false);
  await page.getByLabel('Open image for diagnostics').setInputFiles({
    name:'marker-numbers.png',mimeType:'image/png',buffer:Buffer.from(picture,'base64')
  });
  await page.locator('.facility-calibration summary').click();
  await page.getByLabel('Reference 5 Image X %').fill('50');
  await page.getByLabel('Reference 5 Image Y %').fill('50');
  await expect(page.locator('.facility-calibration-marker')).toHaveCount(1);
  await expect(page.locator('.facility-calibration-marker')).toHaveText('5');
});

test('Facility Studio has one compact task selector plus descriptive sidebar steps',async({page})=>{
  await openStudio(page);
  await expect(page.locator('.facility-workbench-tasks button')).toHaveCount(0);
  const task=page.getByRole('combobox',{name:'Jump to facility task'});
  await expect(task).toHaveValue('0');
  await expect(page.locator('.facility-task-progress')).toContainText('STEP 1 / 7');
  await task.selectOption('3');
  await expect(task).toHaveValue('3');
  await expect(page.locator('.facility-task-progress')).toContainText('STEP 4 / 7');
  await expect(page.getByRole('heading',{name:'Aim this camera'})).toBeVisible();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(task).toHaveValue('1');
  await expect(page.getByRole('heading',{name:'Shape a building'})).toBeVisible();
});
