import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {exampleFacility,createFloorPath} from '../../src/facility.mjs';
import {createFacilityZone} from '../../src/facility-zones.mjs';
import {savedFacilities,savedPlan,openExample} from './facility-test-helpers.mjs';

const collectionKey='dvr.facilities.v1',legacyKey='dvr.facility.v1';
async function openBlank(page) {
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
}
async function createNamed(page,name) {
  await page.getByRole('button',{name:'New facility',exact:true}).click();
  await page.getByLabel('New facility name',{exact:true}).fill(name);
  await page.getByRole('button',{name:'Create blank facility',exact:true}).click();
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue(name);
}
async function backupMenu(page) {
  if(!await page.getByRole('button',{name:'Export all facilities',exact:true}).isVisible())
    await page.getByText('Backup & examples',{exact:true}).click();
}

test('new installs start with one blank facility and no sample map features',async({page},info)=>{
  await openBlank(page);
  await expect(page.getByRole('heading',{name:'Your facility starts here',exact:true})).toBeVisible();
  await expect.poll(async()=> (await savedFacilities(page))?.facilities.length).toBe(1);
  const plan=await savedPlan(page);
  for(const key of ['buildings','cameras','rooms','labels','zones','openings','stairs','paths','route'])expect(plan[key]).toEqual([]);
  await expect(page.locator('.facility-map-label')).toHaveCount(0);
  await expect(page.locator('.facility-dimension-label')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Draw first building',exact:true})).toBeVisible();
  expect(await page.evaluate(key=>localStorage.getItem(key),legacyKey)).toBeNull();
  await page.screenshot({path:info.outputPath('blank-facility-start.png'),fullPage:true});
  await page.reload();
  await expect(page.getByRole('heading',{name:'Your facility starts here',exact:true})).toBeVisible();
  expect((await savedFacilities(page)).facilities).toHaveLength(1);
});

test('named facilities keep independent geometry and the active facility survives reload',async({page},info)=>{
  await openBlank(page);
  await page.getByLabel('Facility name',{exact:true}).fill('Warehouse A');
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  const firstId=(await savedFacilities(page)).activeId;
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await page.getByRole('button',{name:'Add rectangle',exact:true}).click();
  const firstPlan=await savedPlan(page);
  await createNamed(page,'Office B');
  const secondId=(await savedFacilities(page)).activeId;
  expect(secondId).not.toBe(firstId);
  expect((await savedPlan(page)).buildings).toHaveLength(0);
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await page.getByRole('button',{name:'Add rectangle',exact:true}).click();
  await page.getByLabel('Building height',{exact:true}).fill('12');
  await page.getByRole('button',{name:'Save building',exact:true}).click();
  const secondPlan=await savedPlan(page);
  await page.getByLabel('Saved facility',{exact:true}).selectOption(firstId);
  expect(await savedPlan(page)).toEqual(firstPlan);
  await page.reload();
  await expect(page.getByLabel('Saved facility',{exact:true})).toHaveValue(firstId);
  await page.getByLabel('Saved facility',{exact:true}).selectOption(secondId);
  expect(await savedPlan(page)).toEqual(secondPlan);
  await page.screenshot({path:info.outputPath('named-facility-selected.png'),fullPage:true});
  await page.getByRole('button',{name:'Duplicate facility',exact:true}).click();
  const library=await savedFacilities(page),copy=library.facilities.find(f=>f.id===library.activeId);
  expect(library.facilities).toHaveLength(3);
  expect(copy.id).not.toBe(secondId);
  expect(copy.plan.buildings).toEqual(secondPlan.buildings);
  expect(library.facilities.find(f=>f.id===firstId).plan).toEqual(firstPlan);
});

test('named save files and collection backups import as additional facilities without replacing originals',async({page})=>{
  await openBlank(page);
  await page.getByLabel('Facility name',{exact:true}).fill('Campus North');
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await page.getByRole('button',{name:'Add rectangle',exact:true}).click();
  const before=await savedFacilities(page),firstPlan=await savedPlan(page);
  const exporting=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export plan',exact:true}).click();
  const file=await exporting;
  expect(file.suggestedFilename()).toMatch(/campus[-_]north.*\.json$/i);
  const bytes=await readFile(await file.path());
  expect(JSON.parse(bytes.toString())).toEqual(firstPlan);
  await page.getByLabel('Import facility plan',{exact:true}).setInputFiles({name:file.suggestedFilename(),mimeType:'application/json',buffer:bytes});
  await expect.poll(async()=> (await savedFacilities(page))?.facilities.length).toBe(2);
  let library=await savedFacilities(page);
  expect(library.facilities).toHaveLength(2);
  expect(library.activeId).not.toBe(before.activeId);
  expect(library.facilities.find(f=>f.id===before.activeId).plan).toEqual(firstPlan);
  expect(await savedPlan(page)).toEqual(firstPlan);
  await backupMenu(page);
  const backingUp=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export all facilities',exact:true}).click();
  const backup=await backingUp,backupBytes=await readFile(await backup.path()),savedBackup=JSON.parse(backupBytes.toString());
  expect(savedBackup.schema).toBe('intelligent-dvr.facilities.v1');
  expect(savedBackup.facilities).toHaveLength(2);
  await page.getByLabel('Import facility plan',{exact:true}).setInputFiles({name:backup.suggestedFilename(),mimeType:'application/json',buffer:backupBytes});
  await expect.poll(async()=> (await savedFacilities(page))?.facilities.length).toBe(4);
  library=await savedFacilities(page);
  expect(library.facilities).toHaveLength(4);
  expect(new Set(library.facilities.map(f=>f.id)).size).toBe(4);
  for(const original of savedBackup.facilities)expect(library.facilities.find(f=>f.id===original.id).plan).toEqual(original.plan);
});

test('an existing saved plan migrates once and the original legacy save stays intact',async({page})=>{
  const legacy=exampleFacility();legacy.name='Existing facility';const raw=JSON.stringify(legacy);
  await page.addInitScript(({key,raw})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);},{key:legacyKey,raw});
  await openBlank(page);
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Existing facility');
  await expect.poll(async()=> (await savedFacilities(page))?.facilities.length).toBe(1);
  expect(await savedPlan(page)).toEqual(legacy);
  await page.getByLabel('Facility name',{exact:true}).fill('Existing facility updated');
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  expect(await page.evaluate(key=>localStorage.getItem(key),legacyKey)).toBe(raw);
  await page.reload();
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Existing facility updated');
  expect((await savedFacilities(page)).facilities).toHaveLength(1);
});

for(const [source,key] of [['collection',collectionKey],['legacy plan',legacyKey]])test(`corrupt ${source} data stays untouched and is downloadable for recovery`,async({page})=>{
  const corrupt='{broken-library';
  await page.addInitScript(({key,raw})=>localStorage.setItem(key,raw),{key,raw:corrupt});
  await openBlank(page);
  await expect(page.getByRole('heading',{name:'Your facility starts here',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Download stored data',exact:true})).toBeVisible();
  const recovering=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download stored data',exact:true}).click();
  expect(await readFile(await (await recovering).path(),'utf8')).toBe(corrupt);
  const save=page.getByRole('button',{name:'Save site',exact:true});
  if(await save.isEnabled())await save.click();
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(corrupt);
  if(key===legacyKey)expect(await page.evaluate(key=>localStorage.getItem(key),collectionKey)).toBeNull();
});

test('unsaved site and shape edits block facility switching and creation',async({page})=>{
  await openBlank(page);
  await createNamed(page,'Second location');
  const before=await savedFacilities(page);
  await page.getByLabel('Facility name',{exact:true}).fill('Unsaved site name');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'New facility',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Duplicate facility',exact:true})).toBeDisabled();
  expect(await savedFacilities(page)).toEqual(before);
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await page.getByRole('button',{name:'Add rectangle',exact:true}).click();
  const committed=await savedFacilities(page);
  await page.getByLabel('Building name',{exact:true}).fill('Uncommitted building');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  expect(await savedFacilities(page)).toEqual(committed);
  await page.getByRole('button',{name:'Discard preview',exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
});

test('file reads recheck current drafts before selecting an imported facility',async({page})=>{
  await page.addInitScript(()=>{
    const read=File.prototype.text;
    File.prototype.text=async function(){
      if(this.name==='delayed-facility.json')await new Promise(resolve=>{window.finishFacilityFileRead=resolve;});
      return read.call(this);
    };
  });
  await openBlank(page);
  await expect.poll(async()=> (await savedFacilities(page))?.facilities.length).toBe(1);
  const before=await savedFacilities(page);
  await page.getByLabel('Import facility plan',{exact:true}).setInputFiles({name:'delayed-facility.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exampleFacility()))});
  await page.waitForFunction(()=>typeof window.finishFacilityFileRead==='function');
  await page.getByLabel('Facility name',{exact:true}).fill('Draft entered during file read');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await page.evaluate(()=>window.finishFacilityFileRead());
  await expect(page.getByText('Save or discard your preview before importing facilities.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Draft entered during file read');
  expect(await savedFacilities(page)).toEqual(before);
});

test('custom shape drafts survive collapsed controls and block navigation until applied or discarded',async({page})=>{
  await openBlank(page);
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await page.getByText('Common building shapes',{exact:true}).click();
  await page.getByLabel('Shape width (m)',{exact:true}).fill('50');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Add selected shape',exact:true})).toBeEnabled();
  await page.getByText('Common building shapes',{exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  await expect(page.getByRole('heading',{name:'Shape a building',exact:true})).toBeVisible();
  await page.getByText('Common building shapes',{exact:true}).click();
  await expect(page.getByLabel('Shape width (m)',{exact:true})).toHaveValue('50');
  await page.getByRole('button',{name:'Discard shape draft',exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  await page.getByLabel('Shape width (m)',{exact:true}).fill('60');
  await page.getByRole('button',{name:'Add selected shape',exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  const ring=(await savedPlan(page)).buildings[0].footprint;
  expect(Math.max(...ring.map(p=>p[0]))-Math.min(...ring.map(p=>p[0]))).toBe(60);
});

test('unapplied line measurements protect navigation while Apply and Discard remain available',async({page})=>{
  await openBlank(page);await openExample(page);
  await page.getByRole('button',{name:/^6 Handoffs/}).click();
  const before=await savedPlan(page);
  await page.getByLabel('Segment length',{exact:true}).fill('50');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Apply segment length',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByRole('heading',{name:'Test camera handoffs',exact:true})).toBeVisible();
  await expect(page.getByLabel('Segment length',{exact:true})).toHaveValue('50');
  await page.getByRole('button',{name:'Discard line edits',exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  expect(await savedPlan(page)).toEqual(before);
  await page.getByLabel('Segment length',{exact:true}).fill('50');
  await page.getByRole('button',{name:'Apply segment length',exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  const [a,b]=(await savedPlan(page)).route;
  expect(Math.hypot(b[0]-a[0],b[1]-a[1])).toBeCloseTo(50,6);
});

test('pending floor-path measurements protect levels, units and surfaces until Apply and Save',async({page})=>{
  const plan=exampleFacility();
  plan.paths=[createFloorPath(plan,'b2',1,[[-75,-60],[-65,-60]],'Fixture corridor')];
  await page.addInitScript(({key,plan})=>localStorage.setItem(key,JSON.stringify(plan)),{key:legacyKey,plan});
  await openBlank(page);
  await page.getByRole('button',{name:/^3 Floors & labels/}).click();
  await page.getByLabel('Building for floor editing',{exact:true}).selectOption('b2');
  await page.getByLabel('Active floor',{exact:true}).selectOption('1');
  await page.getByRole('button',{name:/^Fixture corridor/}).click();
  const before=await savedPlan(page),levels=page.getByRole('region',{name:'Building levels',exact:true});
  await page.getByLabel('Segment length',{exact:true}).fill('15');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeDisabled();
  await expect(levels.getByRole('button',{name:/^Level 3/})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Add top level',exact:true})).toBeDisabled();
  await expect(page.getByRole('checkbox',{name:'Solid floor at this level',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Save pathway',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:/^Remove pathway/})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Apply segment length',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Discard line edits',exact:true})).toBeEnabled();
  await page.getByLabel('Active floor',{exact:true}).selectOption('2');
  await expect(page.getByLabel('Active floor',{exact:true})).toHaveValue('1');
  await expect(page.getByLabel('Segment length',{exact:true})).toHaveValue('15');
  expect(await savedPlan(page)).toEqual(before);
  await page.getByRole('button',{name:'Apply segment length',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save pathway',exact:true})).toBeEnabled();
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeEnabled();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  expect(await savedPlan(page)).toEqual(before);
  await page.getByRole('button',{name:'Save pathway',exact:true}).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  await expect(levels.getByRole('button',{name:/^Level 3/})).toBeEnabled();
  await expect(page.getByRole('checkbox',{name:'Solid floor at this level',exact:true})).toBeEnabled();
  const [a,b]=(await savedPlan(page)).paths[0].points;
  expect(Math.hypot(b[0]-a[0],b[1]-a[1])).toBeCloseTo(15,6);
});

test('selecting a zone on the map preserves a pending shape draft',async({page})=>{
  const plan=exampleFacility();
  plan.zones=[createFacilityZone([[-135,-15],[-105,-15],[-105,15],[-135,15],[-135,-15]],{name:'Navigation zone'})];
  await page.addInitScript(({key,plan})=>localStorage.setItem(key,JSON.stringify(plan)),{key:legacyKey,plan});
  await openBlank(page);
  await expect(page.getByRole('checkbox',{name:/^Online street map/})).toBeEnabled();
  await page.getByRole('button',{name:'2D',exact:true}).click();
  const clickZone=async()=>{
    // View changes and centering animate for up to 400 ms.
    await page.waitForTimeout(450);
    const marker=page.locator('.facility-zone-label').filter({hasText:'Navigation zone'});
    await expect(marker).toBeVisible();
    // Zone labels sit over their polygon centroid. Click the rendered map there.
    const bounds=await marker.boundingBox();
    await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  };
  await clickZone();
  await expect(page.getByRole('heading',{name:'Zones & object rules',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await page.getByText('Common building shapes',{exact:true}).click();
  await page.getByLabel('Shape width (m)',{exact:true}).fill('50');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  const before=await savedPlan(page);
  await clickZone();
  await expect(page.getByText('Save or discard your preview before selecting another item.',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Shape a building',exact:true})).toBeVisible();
  await expect(page.getByLabel('Shape width (m)',{exact:true})).toHaveValue('50');
  expect(await savedPlan(page)).toEqual(before);
});

test('example layouts are opt-in and keep the existing blank facility',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await openBlank(page);
  await expect.poll(async()=> (await savedFacilities(page))?.facilities.length).toBe(1);
  const before=await savedFacilities(page);
  await openExample(page);
  const library=await savedFacilities(page);
  expect(library.facilities).toHaveLength(2);
  expect(library.facilities.find(f=>f.id===before.activeId).plan).toEqual(before.facilities[0].plan);
  expect((await savedPlan(page)).buildings).toHaveLength(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('facility-switcher-mobile.png'),fullPage:true});
});
