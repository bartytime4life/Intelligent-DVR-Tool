import {test,expect} from '@playwright/test';
import {blankFacility, ringsOverlap} from '../../src/facility.mjs';
import {shapeBounds,rotateShape,translateShape} from '../../src/facility-shape-edit.mjs';
import {savedPlan} from './facility-test-helpers.mjs';

const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function open(page) {
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/#facility');
  await expect(page.getByRole('button',{name:'Grid',exact:true})).toBeEnabled();
}
async function placeOnMap(page, fraction, modifiers=[]) {
  const canvas=page.locator('.facility-map canvas').first();
  const box=await canvas.boundingBox();
  await canvas.click({position:{x:Math.round(box.width*fraction),y:Math.round(box.height*.62)},modifiers});
}

test('first building previews a template, picks a snapped center and saves only on Add',async({page},info)=>{
  await open(page);
  await button(page,'Add first building').click();
  await button(page,'L wing').click();
  await page.getByLabel('Shape width (m)',{exact:true}).fill('45');
  await expect(page.getByText('Footprint preview',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('building-picker.png')});
  await button(page,'Pick on map').click();
  await page.keyboard.press('Escape');
  await expect(button(page,'Pick on map')).toBeFocused();
  expect((await savedPlan(page)).buildings).toEqual([]);
  await button(page,'Pick on map').click();
  await placeOnMap(page,.7,['Shift']);
  await expect(page.getByText(/Using your chosen position/)).toBeVisible();
  expect((await savedPlan(page)).buildings).toEqual([]);
  await button(page,'Add selected shape').click();
  const saved=await savedPlan(page), b=saved.buildings[0], bounds=shapeBounds(b);
  expect(b.footprint).toHaveLength(7);
  expect(bounds.width).toBe(45);
  expect(Number.isInteger(bounds.x) && Number.isInteger(bounds.y)).toBe(true);
  expect(Math.abs(bounds.x)+Math.abs(bounds.y)).toBeGreaterThan(0);
  await button(page,'Add rectangle').click();
  await button(page,'Add rectangle').click();
  const buildings=(await savedPlan(page)).buildings;
  expect(new Set(buildings.map(b=>b.name)).size).toBe(3);
  for(let i=1;i<buildings.length;i++) for(const other of buildings.slice(0,i))
    expect(ringsOverlap(buildings[i].footprint,other.footprint)).toBe(false);
  await button(page,'Undo edit').click();
  await button(page,'Undo edit').click();
  expect(await savedPlan(page)).toEqual(saved);
});

test('moving, rotating and copying a courtyard building preserves its rooms and source',async({page})=>{
  const shell={id:'b1',name:'Shop',height:8,floors:2,base:1,footprint:[[-20,-15],[20,-15],[20,15],[-20,15],[-20,-15]],
    holes:[[[-4,-4],[4,-4],[4,4],[-4,4],[-4,-4]]],
    source:{provider:'OpenStreetMap',id:'way/42',license:'ODbL-1.0',retrieved:'',updated:'',heightBasis:'estimate',floorsBasis:'estimate'}};
  const plan={...blankFacility(),buildings:[shell],rooms:[{id:'r1',name:'Office',buildingId:'b1',level:0,wallHeight:2.8,
    footprint:[[-15,-10],[-10,-10],[-10,-5],[-15,-5],[-15,-10]]}]};
  await page.addInitScript(plan=>localStorage.setItem('dvr.facility.v1',JSON.stringify(plan)),plan);
  await open(page);
  const before=await savedPlan(page);
  await page.getByRole('combobox',{name:'Jump to facility task'}).selectOption('1');
  await button(page,'Rotate 90°').click();
  await button(page,'Move on map').click();
  await placeOnMap(page,.7);
  expect(await savedPlan(page)).toEqual(before);
  await button(page,'Save building').click();
  const moved=await savedPlan(page), b=moved.buildings[0], center=shapeBounds(b);
  expect(center.width).toBeCloseTo(30);
  expect(center.depth).toBeCloseTo(40);
  expect(Math.hypot(center.x,center.y)).toBeGreaterThan(1);
  const expectedHole=translateShape(rotateShape(shell,-90),center.x,center.y).holes[0];
  b.holes[0].forEach(([x,y],i)=>{
    expect(x).toBeCloseTo(expectedHole[i][0],8);
    expect(y).toBeCloseTo(expectedHole[i][1],8);
  });
  const room=moved.rooms[0].footprint[0];
  expect(room[0]).toBeCloseTo(-10 + center.x);
  expect(room[1]).toBeCloseTo(15 + center.y);
  await button(page,'Copy building outline').click();
  const copied=await savedPlan(page), other=copied.buildings[1];
  expect(other.id).not.toBe(b.id);
  expect(other.source).toEqual(shell.source);
  expect(other.holes).toHaveLength(1);
  expect(other.base).toBe(1);
  expect(ringsOverlap(b.footprint,other.footprint)).toBe(false);
  expect(copied.rooms).toEqual(moved.rooms);
  await button(page,'Undo edit').click();
  expect(await savedPlan(page)).toEqual(moved);
  await button(page,'Undo edit').click();
  expect(await savedPlan(page)).toEqual(before);
});

test('mobile building picker accepts precise dimensions without map input',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page);
  await button(page,'Add first building').click();
  await button(page,'Round').click();
  await page.getByText('Height, floors & exact position',{exact:true}).click();
  await page.getByLabel('Shape input units',{exact:true}).selectOption('imperial');
  await page.getByLabel('Shape width (ft)',{exact:true}).fill('40');
  await page.getByLabel('Shape east (ft)',{exact:true}).fill('72');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await button(page,'Add selected shape').click();
  const b=(await savedPlan(page)).buildings[0];
  expect(b.footprint).toHaveLength(33);
  expect(shapeBounds(b).width).toBeCloseTo(12.192);
  expect(shapeBounds(b).x).toBeCloseTo(21.9456);
});
