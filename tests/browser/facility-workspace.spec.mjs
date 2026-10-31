import {test, expect} from '@playwright/test';
import {savedPlan as saved, openExample} from './facility-test-helpers.mjs';

async function openFacility(page) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility'})).toBeVisible();
  await openExample(page);
  await page.getByRole('button',{name:'Save site',exact:true}).click();
}

test('dimensions follow selected polygon, switch units, and hide without altering geometry',async({page})=>{
  await openFacility(page);
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.locator('.facility-dimension-label').first()).toBeVisible();
  await expect(page.locator('.facility-measurement-summary').first()).toContainText('m²');
  const before=await saved(page);
  await page.getByLabel('Measurement units',{exact:true}).selectOption('imperial');
  await expect(page.locator('.facility-measurement-summary').first()).toContainText('ft²');
  await page.getByRole('checkbox',{name:'Dimensions',exact:true}).uncheck();
  await expect(page.locator('.facility-dimension-label')).toHaveCount(0);
  await page.getByRole('button',{name:'Point map north',exact:true}).click();
  await page.getByRole('button',{name:'Reset map view',exact:true}).click();
  expect(await saved(page)).toEqual(before);
});

test('copy rooms upstairs, add a level, and undo preserve lower floor elevations',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openFacility(page);
  await page.getByRole('button',{name:/^3 Floors & labels/}).click();
  await page.getByLabel('Building for floor editing',{exact:true}).selectOption('b2');
  const before=await saved(page), office=before.buildings.find(b=>b.id==='b2');
  await page.getByRole('button',{name:'Copy rooms upstairs',exact:true}).click();
  let next=await saved(page);
  expect(next.rooms.filter(r=>r.buildingId==='b2'&&r.level===1)).toHaveLength(2);
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('1');
  await page.getByRole('button',{name:'Add top level',exact:true}).click();
  next=await saved(page);
  const edited=next.buildings.find(b=>b.id==='b2');
  expect(edited.floors).toBe(office.floors+1);
  expect(edited.height/edited.floors).toBeCloseTo(office.height/office.floors);
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('3');
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('2');
  expect(errors).toEqual([]);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect(await saved(page)).toEqual(before);
  expect(errors).toEqual([]);
});

// The compass icon mirrors the map pitch (NavigationControl visualizePitch), so it reports the settled tilt.
const compassPitch = page => page.evaluate(() => {
  const match = /rotateX\((-?[\d.]+)deg\)/.exec(document.querySelector('.maplibregl-ctrl-compass .maplibregl-ctrl-icon')?.style.transform || '');
  return match ? Number(match[1]) : null;
});

test('centering right after a view switch settles at that view\'s pitch',async({page})=>{
  await openFacility(page);
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await expect.poll(()=>compassPitch(page)).toBe(52);
  // Press 2D and centre before the 350 ms pitch animation finishes: the map must still end flat.
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.getByRole('button',{name:'Center camera',exact:true}).click();
  await expect.poll(()=>compassPitch(page)).toBe(0);
  await page.waitForTimeout(500);
  expect(await compassPitch(page)).toBe(0);
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await page.getByRole('button',{name:'Center camera',exact:true}).click();
  await expect.poll(()=>compassPitch(page)).toBe(52);
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.getByRole('button',{name:'Point map north',exact:true}).click();
  await expect.poll(()=>compassPitch(page)).toBe(0);
  await page.waitForTimeout(500);
  expect(await compassPitch(page)).toBe(0);
});

test('camera edits retain unsaved changes across center and aim tools',async({page})=>{
  await openFacility(page);
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  await page.getByLabel('Direction from north',{exact:true}).fill('90');
  await page.getByRole('button',{name:'Center camera',exact:true}).click();
  await expect(page.getByLabel('Direction from north',{exact:true})).toHaveValue('90');
  await page.getByRole('button',{name:'Aim on map',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'2D',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByRole('heading',{name:'Aim this camera',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Save or discard');
  await page.getByRole('button',{name:'Save camera',exact:true}).click();
  expect((await saved(page)).cameras.find(c=>c.id==='C-07').bearing).toBe(90);
});

test('zone configuration is saved, exported as a real rule, and pending edits block navigation',async({page})=>{
  await openFacility(page);
  await page.getByRole('button',{name:/^7 Zones & objects/}).click();
  await page.getByRole('button',{name:'Add rectangular zone',exact:true}).click();
  await page.getByLabel('Zone name',{exact:true}).fill('Secure loading area');
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByRole('heading',{name:'Zones & object rules',exact:true})).toBeVisible();
  await expect(page.getByLabel('Zone name',{exact:true})).toHaveValue('Secure loading area');
  await page.getByText('Camera image region for recognition',{exact:true}).click();
  await page.getByRole('checkbox',{name:'Configure image rectangle',exact:true}).check();
  await page.getByRole('button',{name:'Save zone',exact:true}).click();
  const zone=(await saved(page)).zones[0];
  expect(zone.name).toBe('Secure loading area');
  expect(zone.imageRegion.rect).toEqual([.1,.1,.8,.8]);
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export recognition rules',exact:true}).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^dvr-zone-.*-rules\.json$/);
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  await page.getByLabel('Selected camera',{exact:true}).selectOption(zone.imageRegion.cameraId);
  await page.getByRole('button',{name:/^Remove camera/}).click();
  const removed=await saved(page);
  expect(removed.zones[0].imageRegion).toBeUndefined();
  expect(removed.zones[0].footprint).toEqual(zone.footprint);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect((await saved(page)).zones[0].imageRegion).toEqual(zone.imageRegion);
});

test('narrow layout keeps map controls and zone setup reachable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openFacility(page);
  await expect(page.getByRole('button',{name:'Reset map view',exact:true})).toBeVisible();
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^7 Zones & objects/}).click();
  await page.getByRole('button',{name:'Add rectangular zone',exact:true}).click();
  await expect(page.getByLabel('Zone name',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

async function openOfficeFloors(page) {
  await openFacility(page);
  await page.getByRole('button',{name:/^3 Floors & labels/}).click();
  await page.getByLabel('Building for floor editing',{exact:true}).selectOption('b2');
}

test('stair length entry converts feet to metres and unsaved stair edits protect navigation',async({page})=>{
  await openOfficeFloors(page);
  await page.getByRole('button',{name:'Add straight stair',exact:true}).click();
  const before=await saved(page);
  await page.getByLabel('Measurement units',{exact:true}).selectOption('imperial');
  await page.getByLabel('Stair clear width (ft)',{exact:true}).fill('4');
  await page.getByLabel('Active floor',{exact:true}).selectOption('1');
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('0');
  await expect(page.getByText('Save or discard your preview before changing floors.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  await expect(page.getByRole('heading',{name:'Define floors & labels',exact:true})).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await page.getByRole('button',{name:'Save stair',exact:true}).click();
  expect((await saved(page)).stairs[0].width).toBeCloseTo(1.2192,8);
  await page.getByLabel('Measurement units',{exact:true}).selectOption('metric');
  await expect(page.getByLabel('Stair clear width (m)',{exact:true})).toHaveValue('1.2192');
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect((await saved(page)).stairs[0]).toEqual(before.stairs[0]);
});

test('stair cutout becomes a ceiling opening below and supports exact dimensions with dirty protection',async({page})=>{
  await openOfficeFloors(page);
  await page.getByRole('button',{name:'Add straight stair',exact:true}).click();
  const before=await saved(page);
  await page.getByRole('button',{name:'Cut upper floor over stair run',exact:true}).click();
  let next=await saved(page);
  expect(next.openings).toHaveLength(1);
  const opening=next.openings[0];
  expect(opening.buildingId).toBe('b2');expect(opening.level).toBe(1);
  expect(next.stairs).toEqual(before.stairs);
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('1');
  await expect(page.getByLabel('Opening name',{exact:true})).toBeVisible();
  await page.getByLabel('Measurement units',{exact:true}).selectOption('imperial');
  await page.getByLabel('Shape east-west span',{exact:true}).fill('4');
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByLabel('Opening name',{exact:true})).toBeVisible();
  expect((await saved(page)).openings[0]).toEqual(opening);
  await page.getByRole('button',{name:'Save opening',exact:true}).click();
  const resized=(await saved(page)).openings[0].footprint;
  expect(Math.max(...resized.map(p=>p[0]))-Math.min(...resized.map(p=>p[0]))).toBeCloseTo(1.2192,8);
  await page.getByLabel('Active floor',{exact:true}).selectOption('0');
  await expect(page.locator('.facility-level-summary')).toContainText('1 ceiling openings from above');
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect((await saved(page)).openings[0]).toEqual(opening);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect((await saved(page)).openings).toHaveLength(0);
  await expect(page.locator('.facility-level-summary')).toContainText('0 ceiling openings from above');
});

test('whole-floor toggle removes only its slab, retains partial openings, and Undo restores it',async({page})=>{
  await openOfficeFloors(page);
  await page.getByRole('button',{name:'Add straight stair',exact:true}).click();
  await page.getByRole('button',{name:'Cut upper floor over stair run',exact:true}).click();
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('1');
  const before=await saved(page);
  await page.getByRole('checkbox',{name:'Solid floor at this level',exact:true}).uncheck();
  const openPlan=await saved(page),building=openPlan.buildings.find(b=>b.id==='b2');
  expect(building.openFloors).toEqual([1]);
  expect(openPlan.openings).toEqual(before.openings);
  expect(openPlan.stairs).toEqual(before.stairs);
  await expect(page.getByRole('button',{name:'Draw floor pathway',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Draw floor opening',exact:true})).toBeDisabled();
  await expect(page.getByText('Level 2 · open floor · no slab',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect(await saved(page)).toEqual(before);
  await expect(page.getByRole('checkbox',{name:'Solid floor at this level',exact:true})).toBeChecked();
  await expect(page.getByRole('button',{name:'Draw floor pathway',exact:true})).toBeEnabled();
  await page.screenshot({path:test.info().outputPath('facility-floor-controls.png'),fullPage:true});
});
