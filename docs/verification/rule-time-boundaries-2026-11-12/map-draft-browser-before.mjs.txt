import {test,expect} from '@playwright/test';
import {blankFacility,toLngLat} from '../../src/facility.mjs';
import {createLibrary} from '../../src/facility-library.mjs';
import {savedPlan} from './facility-test-helpers.mjs';

const plan=blankFacility(),ring=[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]];
const extract={elements:[{type:'way',id:987654321,tags:{building:'yes',name:'Generated draft shell',height:'8'},
  geometry:ring.map(point=>{const [lon,lat]=toLngLat(point,plan.origin);return {lon,lat};})}]};
const raw=JSON.stringify(extract);
const panel=page=>page.getByText('Draft buildings from OpenStreetMap',{exact:true});
const discard=page=>page.getByRole('button',{name:'Discard map draft',exact:true});
const pending=page=>page.getByText('Map draft not added. Apply the selected buildings or discard this draft before changing tasks.',{exact:true});

async function setup(page,{webgl=false}={}) {
  await page.addInitScript(({library,webgl})=>{
    localStorage.setItem('dvr.facilities.v1',library);
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
      enumerateDevices:async()=>[],getUserMedia:()=>{throw Error('Camera access is forbidden in this generated test.');},
    }});
    if(!webgl){
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){
        return /webgl/.test(kind)?null:getContext.call(this,kind,...args);
      };
    }
  },{library:JSON.stringify(createLibrary(plan)),webgl});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return url.hostname==='127.0.0.1' && !url.pathname.startsWith('/api/')?route.continue():route.abort();
  });
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
  await panel(page).click();
  await expect(pending(page)).toHaveCount(0);
}
async function openOffline(page) {
  await page.getByText('Open an offline OSM file or paste JSON',{exact:true}).click();
}
async function holdLookup(page) {
  await page.addInitScript(({text})=>{
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=(input,options={})=>{
      if(String(input).startsWith('https://overpass.private.coffee/')) {
        window.generatedMapAborted=false;
        options.signal.addEventListener('abort',()=>{window.generatedMapAborted=true;},{once:true});
        // Deliberately resolve after abort to verify the stale-result guard too.
        return new Promise(resolve=>{window.releaseGeneratedMap=()=>resolve(new Response(text,{headers:{'Content-Type':'application/json'}}));});
      }
      return fetchOriginal(input,options);
    };
  },{text:raw});
}
async function holdFile(page) {
  await page.addInitScript(({text})=>{
    const readOriginal=File.prototype.text;
    File.prototype.text=function(){
      if(this.name==='generated-delayed-map.json')return new Promise(resolve=>{window.releaseGeneratedMapFile=()=>resolve(text);});
      return readOriginal.call(this);
    };
  },{text:raw});
}
const chooseDelayedFile=page=>page.getByLabel('Offline OSM file',{exact:true}).setInputFiles({
  name:'generated-delayed-map.json',mimeType:'application/json',buffer:Buffer.from(raw),
});

test('unreviewed map JSON and area edits block task changes and remain available until explicit discard',async({page})=>{
  await setup(page);const before=await savedPlan(page);
  await page.getByLabel('Search width (m)',{exact:true}).fill('300');
  await openOffline(page);
  await page.getByLabel('OSM extract JSON',{exact:true}).fill(raw);
  await expect(pending(page)).toBeVisible();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('Measurement units',{exact:true})).toBeDisabled();
  await page.getByLabel('Jump to facility task',{exact:true}).selectOption('1');
  await expect(page.getByLabel('Jump to facility task',{exact:true})).toHaveValue('0');
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
  const dialogReady=page.waitForEvent('dialog');
  const navigate=page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Events',exact:true}).click();
  const dialog=await dialogReady;expect(dialog.message()).toContain('Leave the facility builder?');
  await dialog.dismiss();await navigate;
  await expect(page.getByLabel('OSM extract JSON',{exact:true})).toHaveValue(raw);
  await expect(page.getByLabel('Search width (m)',{exact:true})).toHaveValue('300');
  expect(await savedPlan(page)).toEqual(before);
  await page.getByLabel('OSM extract JSON',{exact:true}).fill('');
  await expect(pending(page)).toBeVisible();
  await discard(page).click();
  await expect(pending(page)).toHaveCount(0);
  await expect(page.getByLabel('Search width (m)',{exact:true})).toHaveValue('250');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  await page.getByLabel('Jump to facility task',{exact:true}).selectOption('1');
  await expect(page.getByRole('heading',{name:'Shape a building',exact:true})).toBeVisible();
  expect(await savedPlan(page)).toEqual(before);
});

test('collapsed or fully excluded map candidates keep their review choices and can still be applied',async({page})=>{
  await setup(page);const before=await savedPlan(page);
  await page.getByLabel('Search width (m)',{exact:true}).fill('300');
  await openOffline(page);await page.getByLabel('OSM extract JSON',{exact:true}).fill(raw);
  await page.getByRole('button',{name:'Review extract',exact:true}).click();
  const included=page.getByLabel('Include Generated draft shell',{exact:true});
  await included.uncheck();
  await panel(page).click();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
  await panel(page).click();
  await expect(included).not.toBeChecked();
  await expect(page.getByRole('button',{name:'Use 0 selected buildings',exact:true})).toBeDisabled();
  await included.check();
  expect(await savedPlan(page)).toEqual(before);
  await page.getByRole('button',{name:'Use 1 selected buildings',exact:true}).click();
  await expect.poll(async()=>(await savedPlan(page)).buildings.map(building=>building.name)).toEqual(['Generated draft shell']);
  await expect(pending(page)).toHaveCount(0);
  await expect(page.getByLabel('OSM extract JSON',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await expect(page.getByRole('heading',{name:'Shape a building',exact:true})).toBeVisible();
});

test('collapsing the map-draft panel keeps a partial pointer area until it is finished or explicitly cancelled',async({page})=>{
  await setup(page,{webgl:true});const before=await savedPlan(page);
  await expect(page.getByRole('button',{name:'Grid',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Draw search area',exact:true}).click();
  const canvas=page.locator('.facility-map canvas'),rect=await canvas.boundingBox();
  const corner=([x,y])=>canvas.click({position:{x:rect.width*x,y:rect.height*y}});
  // The overhead drawing view animates for 250 ms before accepting corners.
  await page.waitForTimeout(350);
  await corner([.35,.4]);await corner([.65,.4]);
  await panel(page).click();
  await expect(page.locator('.facility-draw-hint')).toContainText('Click the area corners');
  await page.getByLabel('Jump to facility task',{exact:true}).selectOption('1');
  await expect(page.getByLabel('Jump to facility task',{exact:true})).toHaveValue('0');
  await panel(page).click();
  await corner([.65,.65]);await corner([.35,.65]);await corner([.35,.4]);
  await expect(page.getByLabel('Area shape',{exact:true})).toHaveValue('polygon');
  await expect(page.getByLabel('Area vertices',{exact:true})).toHaveValue(/^.+\n.+\n.+\n.+$/);
  await expect(pending(page)).toBeVisible();
  expect(await savedPlan(page)).toEqual(before);
  await discard(page).click();
  await expect(pending(page)).toHaveCount(0);
  await page.getByLabel('Jump to facility task',{exact:true}).selectOption('1');
  await expect(page.getByRole('heading',{name:'Shape a building',exact:true})).toBeVisible();
});

test('site changes require explicit map-draft discard instead of silently dropping reviewed outlines',async({page})=>{
  await setup(page);await openOffline(page);const before=await savedPlan(page);
  await page.getByLabel('OSM extract JSON',{exact:true}).fill(raw);
  await page.getByRole('button',{name:'Review extract',exact:true}).click();
  await page.getByLabel('Facility name',{exact:true}).fill('Generated site name edit');
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await expect(page.getByText('Apply or discard the map draft before saving site changes.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Include Generated draft shell',{exact:true})).toBeChecked();
  await expect(page.getByLabel('OSM extract JSON',{exact:true})).toHaveValue(raw);
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue('Generated site name edit');
  expect(await savedPlan(page)).toEqual(before);
  await discard(page).click();
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await expect.poll(async()=>(await savedPlan(page)).name).toBe('Generated site name edit');
  expect((await savedPlan(page)).buildings).toEqual(before.buildings);
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeEnabled();
});

test('discard aborts a pending map lookup and ignores even a late result from that lookup',async({page})=>{
  await holdLookup(page);
  await setup(page);const before=await savedPlan(page);
  await page.getByRole('button',{name:'Load open building drafts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cancel map request',exact:true})).toBeVisible();
  await expect(pending(page)).toBeVisible();
  await page.getByLabel('Jump to facility task',{exact:true}).selectOption('1');
  await expect(page.getByLabel('Jump to facility task',{exact:true})).toHaveValue('0');
  await discard(page).click();
  expect(await page.evaluate(()=>window.generatedMapAborted)).toBe(true);
  await page.evaluate(()=>window.releaseGeneratedMap());
  await expect(pending(page)).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Use \d+ selected buildings$/})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Cancel map request',exact:true})).toHaveCount(0);
  expect(await savedPlan(page)).toEqual(before);
  await page.getByLabel('Jump to facility task',{exact:true}).selectOption('1');
  await expect(page.getByRole('heading',{name:'Shape a building',exact:true})).toBeVisible();
});

test('discard invalidates an unfinished offline-file read without restoring its candidates later',async({page})=>{
  await holdFile(page);
  await setup(page);await openOffline(page);const before=await savedPlan(page);
  await chooseDelayedFile(page);
  await expect(pending(page)).toBeVisible();
  await expect(page.getByLabel('Saved facility',{exact:true})).toBeDisabled();
  await discard(page).click();
  await page.evaluate(()=>window.releaseGeneratedMapFile());
  await expect(pending(page)).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Use \d+ selected buildings$/})).toHaveCount(0);
  expect(await savedPlan(page)).toEqual(before);
  await page.getByLabel('Jump to facility task',{exact:true}).selectOption('1');
  await expect(page.getByRole('heading',{name:'Shape a building',exact:true})).toBeVisible();
});

test('a newer accepted map lookup supersedes a delayed offline read without being cancelled by it',async({page})=>{
  await holdFile(page);await holdLookup(page);
  await setup(page);await openOffline(page);
  await chooseDelayedFile(page);
  await expect(pending(page)).toBeVisible();
  await page.getByRole('button',{name:'Load open building drafts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cancel map request',exact:true})).toBeVisible();
  await page.evaluate(async()=>{window.releaseGeneratedMapFile();await Promise.resolve();await Promise.resolve();});
  expect(await page.evaluate(()=>window.generatedMapAborted)).toBe(false);
  await expect(page.getByRole('button',{name:'Cancel map request',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Use \d+ selected buildings$/})).toHaveCount(0);
  await page.evaluate(()=>window.releaseGeneratedMap());
  await expect(page.getByLabel('Include Generated draft shell',{exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Use 1 selected buildings',exact:true}).click();
  await expect.poll(async()=>(await savedPlan(page)).buildings.map(building=>building.name)).toEqual(['Generated draft shell']);
  await expect(pending(page)).toHaveCount(0);
});
