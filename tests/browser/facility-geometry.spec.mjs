import {test,expect} from '@playwright/test';
import {savedPlan as saved, openExample} from './facility-test-helpers.mjs';
import {toLngLat} from '../../src/facility.mjs';
const origin=[-98,38.5],box=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const member=(ring,role,ref)=>({type:'way',role,ref,geometry:ring.map(p=>{const [lon,lat]=toLngLat(p,origin);return {lon,lat};})});
const extract={elements:[{type:'relation',id:900,tags:{type:'multipolygon',building:'yes',name:'Courtyard test',height:'12',min_height:'2','building:levels':'3'},members:[member(box(-30,-30,60,60),'outer',1),member(box(-10,-10,20,20),'inner',2)]}]};
async function setup(page){
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/#facility');await expect(page.getByRole('heading',{name:'Locate your facility'})).toBeVisible();
  await openExample(page);
}
async function review(page,data){await page.getByText('Draft buildings from OpenStreetMap',{exact:true}).click();await page.getByText('Open an offline OSM file or paste JSON',{exact:true}).click();await page.getByLabel('OSM extract JSON',{exact:true}).fill(JSON.stringify(data));await page.getByRole('button',{name:'Review extract',exact:true}).click();}

test('courtyard apply, transform, base edits and Undo preserve the complete advanced plan',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'Save site',exact:true}).click();const before=await saved(page);
  await review(page,extract);await page.getByRole('button',{name:'Use 1 selected buildings',exact:true}).click();
  const imported=await saved(page);expect(imported.schema).toBe('intelligent-dvr.facility.v6');expect(imported.buildings.at(-1).holes).toHaveLength(1);expect(imported.cameras).toEqual(before.cameras);
  await page.getByRole('button',{name:/^2 Buildings/}).click();await page.getByRole('button',{name:/Courtyard test/}).click();
  await page.getByLabel('Shape center east',{exact:true}).fill('100');await page.getByLabel('Building base',{exact:true}).fill('3');await page.getByRole('button',{name:'Save building',exact:true}).click();
  const moved=(await saved(page)).buildings.at(-1);expect(moved.holes[0][0]).toEqual([90,-10]);expect(moved.base).toBe(3);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();expect(await saved(page)).toEqual(imported);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();expect(await saved(page)).toEqual(before);
});
test('keyboard polygon editing excludes bbox-only shells and invalidates stale drafts',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'Save site',exact:true}).click();const before=await saved(page);
  await review(page,extract);await expect(page.getByRole('button',{name:'Use 1 selected buildings',exact:true})).toBeEnabled();
  await page.getByLabel('Area shape',{exact:true}).selectOption('polygon');
  await expect(page.getByRole('button',{name:/^Use \d+ selected buildings$/})).toHaveCount(0);
  await page.getByLabel('Area vertices',{exact:true}).fill('60,60\n100,60\n60,100');
  await page.getByRole('button',{name:'Review extract',exact:true}).click();await expect(page.getByText(/No new supported footprints found/)).toBeVisible();
  await page.getByLabel('Area vertices',{exact:true}).fill('0,0\n100,100\n0,100\n100,0');await expect(page.getByRole('button',{name:'Review extract',exact:true})).toBeDisabled();
  expect(await saved(page)).toEqual(before);
});
test('pointer area and site pin suggest changes without saving the plan',async({page})=>{
  await setup(page);await expect(page.getByRole('button',{name:'Grid',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Save site',exact:true}).click();const before=await saved(page);
  await page.getByText('Draft buildings from OpenStreetMap',{exact:true}).click();await page.getByRole('button',{name:'Draw search area',exact:true}).click();
  const canvas=page.locator('.facility-map canvas');const rect=await canvas.boundingBox();
  const points=[[.35,.4],[.65,.4],[.65,.65],[.35,.65],[.35,.4]];
  // Map pitch animates for 250 ms when starting a drawing tool.
  await page.waitForTimeout(350);
  for(const [x,y] of points)await canvas.click({position:{x:rect.width*x,y:rect.height*y}});
  await expect(page.getByLabel('Area shape',{exact:true})).toHaveValue('polygon');await expect(page.getByLabel('Area vertices',{exact:true})).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await page.getByRole('button',{name:'Pick site on map',exact:true}).click();await canvas.click({position:{x:rect.width*.6,y:rect.height*.5}});
  await expect(page.getByText('Map pin suggestion. Review coordinates, then Save site.',{exact:true})).toBeVisible();expect(await saved(page)).toEqual(before);
});
test('missing WebGL preserves keyboard polygon and offline review recovery',async({page})=>{
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return /webgl/.test(kind)?null:original.call(this,kind,...args);};});
  await setup(page);await page.getByRole('button',{name:'Save site',exact:true}).click();await review(page,extract);
  await expect(page.getByRole('button',{name:'Draw search area',exact:true})).toBeDisabled();
  await page.getByLabel('Area shape',{exact:true}).selectOption('polygon');await page.getByLabel('Area vertices',{exact:true}).fill('-100,-100\n100,-100\n100,100\n-100,100');
  await page.getByRole('button',{name:'Review extract',exact:true}).click();await page.getByRole('button',{name:'Use 1 selected buildings',exact:true}).click();expect((await saved(page)).buildings.at(-1).holes).toHaveLength(1);
});
