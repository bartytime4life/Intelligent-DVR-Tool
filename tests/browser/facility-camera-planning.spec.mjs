import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {savedPlan as saved} from './facility-test-helpers.mjs';
import {blankFacility, validateFacility, wallObstacles} from '../../src/facility.mjs';
import {createLibrary, LIBRARY_KEY} from '../../src/facility-library.mjs';
import {coverageMetrics, fanCache} from '../../src/facility-coverage.mjs';

const rect = (x0,y0,x1,y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const zone = (id,name,footprint,extra={}) => ({id,name,type:'restricted',footprint,enabled:true,expectedClasses:['person'],dwellSeconds:2,...extra});
const fixture = validateFacility({...blankFacility(),name:'Coverage fixture',
  buildings:[{id:'b1',name:'Hall',footprint:rect(40,40,60,60),height:6,floors:1}],
  cameras:[{id:'C1',name:'North yard',x:0,y:0,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:50,enabled:true,pixelsWide:1920,channel:'NVR-1 ch 1'}],
  zones:[zone('z-yard','Yard apron',rect(-30,10,30,20)),zone('z-hall','Hall store',rect(45,45,50,50),{buildingId:'b1',level:0})],
  route:[[0,-10],[0,20]]});
const expected = coverageMetrics(fixture, fanCache()(wallObstacles(fixture)));
const percent = v => `${(Math.round(v*1000)/10).toFixed(1)}%`;
const value = async (page,label) => Number(await page.getByLabel(label,{exact:true}).inputValue());

async function openFixture(page) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(({key,raw})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);},{key:LIBRARY_KEY,raw:JSON.stringify(createLibrary(fixture))});
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility'})).toBeVisible();
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Coverage fixture');
}
// Overhead view centred on the selected camera, so the camera sits at the map centre.
async function centreCamera(page) {
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.waitForTimeout(600);
  await page.getByRole('button',{name:'Center camera',exact:true}).click();
  await page.waitForTimeout(700);
  const box = await page.locator('.facility-map').boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

test('drag, rotate handle and keyboard edits change only the camera draft until Save camera',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openFixture(page);
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  await expect(page.getByLabel('Selected camera',{exact:true})).toHaveValue('C1');
  const before=await saved(page), [cx,cy]=await centreCamera(page);
  await page.mouse.move(cx,cy);await page.mouse.down();
  await page.mouse.move(cx+30,cy+10,{steps:4});await page.mouse.move(cx+60,cy+20,{steps:4});
  await expect(page.locator('.facility-drag-hint')).toContainText('Moving the selected camera');
  await page.mouse.up();
  await expect(page.locator('.facility-drag-hint')).toHaveCount(0);
  await expect.poll(()=>value(page,'Camera east')).toBeGreaterThan(5);
  const east=await value(page,'Camera east'), north=await value(page,'Camera north');
  expect(north).toBeLessThan(-1);
  await expect(page.getByText('Previewing unsaved edits',{exact:true})).toBeVisible();
  expect(await saved(page)).toEqual(before);
  // The handle follows the settled preview to the heading tip, 12 m north of the moved camera.
  const handle=page.locator('.facility-rotate-handle');
  await expect.poll(async()=>{const b=await handle.boundingBox();return b && Math.abs(b.x+b.width/2-(cx+60));}).toBeLessThan(3);
  const h=await handle.boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
  await page.mouse.move(cx+90,cy+60,{steps:4});await page.mouse.move(cx+60,cy+140,{steps:4});await page.mouse.up();
  await expect.poll(()=>value(page,'Direction from north')).toBeGreaterThan(179);
  expect(await value(page,'Direction from north')).toBeLessThan(181);
  expect(await value(page,'Camera east')).toBe(east);
  // Alt+Arrow nudges 0.5 m and [ ] rotate 5° outside text fields only.
  await page.getByRole('button',{name:'Center camera',exact:true}).focus();
  const bearing=await value(page,'Direction from north');
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(()=>value(page,'Camera north')).toBeCloseTo(north+.5,5);
  await page.keyboard.press('[');
  await expect.poll(()=>value(page,'Direction from north')).toBeCloseTo(bearing-5,5);
  await page.getByLabel('Camera name',{exact:true}).focus();
  await page.keyboard.press(']');
  await expect(page.getByLabel('Camera name',{exact:true})).toHaveValue('North yard]');
  expect(await value(page,'Direction from north')).toBeCloseTo(bearing-5,5);
  expect(await saved(page)).toEqual(before);
  await page.getByLabel('Camera name',{exact:true}).fill('North yard');
  await page.getByRole('button',{name:'Save camera',exact:true}).click();
  const camera=(await saved(page)).cameras[0];
  expect(camera.x).toBe(east);expect(camera.y).toBeCloseTo(north+.5,5);expect(camera.bearing).toBeCloseTo(bearing-5,5);
  expect(camera.pixelsWide).toBe(1920);expect(camera.channel).toBe('NVR-1 ch 1');
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect(await saved(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('touch drag moves the selected camera draft',async({page})=>{
  await openFixture(page);
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  const [cx,cy]=await centreCamera(page);
  await page.evaluate(([x,y])=>{
    const target=document.querySelector('.facility-map .maplibregl-canvas-container');
    const touch=(cx,cy)=>new Touch({identifier:1,target,clientX:cx,clientY:cy});
    const fire=(node,type,cx,cy,list=true)=>node.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list?[touch(cx,cy)]:[],targetTouches:list?[touch(cx,cy)]:[],changedTouches:[touch(cx,cy)]}));
    fire(target,'touchstart',x,y);
    for (let i=1;i<=6;i++) fire(target,'touchmove',x-i*10,y);
    fire(target,'touchend',x-60,y,false);
  },[cx,cy]);
  await expect.poll(()=>value(page,'Camera east')).toBeLessThan(-5);
  expect((await saved(page)).cameras[0].x).toBe(0);
});

test('coverage step reports zone and route coverage, marks indoor zones and toggles blind spots',async({page})=>{
  await openFixture(page);
  await page.getByRole('button',{name:/^5 Coverage/}).click();
  const metrics=page.getByRole('region',{name:'Estimated coverage metrics'});
  const yard=expected.zones.find(z=>z.id==='z-yard');
  expect(yard.coverage).toBeGreaterThan(.45);expect(yard.coverage).toBeLessThan(.55);
  await expect(metrics.getByRole('row',{name:/Yard apron/})).toContainText(percent(yard.coverage));
  await expect(metrics.getByRole('row',{name:/Yard apron/})).toContainText('0.0%');
  await expect(metrics.getByRole('row',{name:/Hall store/})).toContainText('Not estimated · ground-plane only');
  await expect(metrics.getByRole('row',{name:/Handoff route/})).toContainText(percent(36/61));
  await expect(page.locator('.blind-spot-key')).toHaveCount(0);
  const toggle=metrics.getByRole('button',{name:'Blind spots for Yard apron',exact:true});
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect(metrics.getByRole('status')).toContainText('Map shows uncovered sample cells in Yard apron');
  await expect(page.locator('.facility-map-legend')).toContainText('Blind spot · estimate');
  // A turned draft camera updates the estimate before saving.
  await page.getByLabel('Direction from north',{exact:true}).fill('180');
  await expect(metrics.getByRole('row',{name:/Yard apron/})).toContainText('0.0%0.0%');
  await expect(metrics).toContainText('Includes the unsaved camera preview.');
  await page.getByRole('button',{name:'Discard preview',exact:true}).click();
  await expect(metrics.getByRole('row',{name:/Yard apron/})).toContainText(percent(yard.coverage));
  await toggle.click();
  await expect(page.locator('.blind-spot-key')).toHaveCount(0);
});

test('pixel density table, lens preset and installer sheet download use the saved plan',async({page})=>{
  await openFixture(page);
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  const density=page.getByRole('group',{name:'Pixel density estimate'});
  await expect(density).toContainText('Planning estimate — assumes ideal focus and no compression');
  await expect(density.getByRole('row',{name:/Detect/})).toContainText('2.3 m–38.2 m');
  await expect(density.getByRole('row',{name:/Identify/})).toContainText('Not reached');
  await expect(page.locator('.facility-dori-label').first()).toBeAttached();
  await page.getByLabel('Lens preset (typical)',{exact:true}).selectOption('6');
  await expect(page.getByLabel('Horizontal field of view',{exact:true})).toHaveValue('54');
  const sheet=page.getByRole('button',{name:'Download installer sheet',exact:true});
  await expect(sheet).toBeDisabled();
  await page.getByRole('button',{name:'Discard preview',exact:true}).click();
  await page.getByLabel('Horizontal resolution',{exact:true}).fill('');
  await expect(density).toHaveCount(0);
  await page.getByRole('button',{name:'Discard preview',exact:true}).click();
  await expect(sheet).toBeEnabled();
  const downloaded=page.waitForEvent('download');
  await sheet.click();
  const download=await downloaded;
  expect(download.suggestedFilename()).toBe('dvr-coverage-fixture-installer-sheet.html');
  const html=readFileSync(await download.path(),'utf8');
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`);
  expect(html).toContain('<svg class="plan"');
  expect(html).toContain('NVR-1 ch 1');
  expect(html).toContain('≤ 38.2 m');
  expect(html).toContain('Planning estimate — assumes ideal focus and no compression');
  expect(html).not.toMatch(/<script|<img|data:/);
});
