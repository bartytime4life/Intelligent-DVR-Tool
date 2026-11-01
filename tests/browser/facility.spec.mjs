import { test, expect } from '@playwright/test';
import {savedPlan as saved, openExample} from './facility-test-helpers.mjs';
import { readFileSync } from 'node:fs';
const fixture = name => JSON.parse(readFileSync(new URL('../fixtures/facility/'+name+'.json',import.meta.url)));
const exterior=fixture('eppan-exteriors'), courtyard=fixture('eppan-courtyard');
const photon={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[11.2574936,46.45528628]},properties:{name:'Recorded exterior example (mock search result)',city:'Eppan / Appiano'}}]};

async function setup(page,{address=photon,footprints=exterior}={}) {
  const requests=[];
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='photon.komoot.io'){requests.push({kind:'address',url:url.href});return route.fulfill({json:address});}
    if(url.hostname==='overpass.private.coffee'){requests.push({kind:'footprint',body:route.request().postData()});return route.fulfill({json:footprints});}
    if(url.hostname==='127.0.0.1')return route.continue();
    return route.abort();
  });
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility'})).toBeVisible();
  await openExample(page);
  return requests;
}
async function saveOrigin(page){await page.getByLabel('Longitude',{exact:true}).fill('11.2574936');await page.getByLabel('Latitude',{exact:true}).fill('46.45528628');await page.getByRole('button',{name:'Save site',exact:true}).click();}
async function pasteExtract(page,data){
  await page.getByText('Open an offline OSM file or paste JSON',{exact:true}).click();
  await page.getByLabel('OSM extract JSON',{exact:true}).fill(JSON.stringify(data));
  await page.getByRole('button',{name:'Review extract',exact:true}).click();
}

test('submitted address search is keyboard accessible and does not send text while typing',async({page})=>{
  const requests=await setup(page),before=await saved(page);
  await page.getByText('Find an address or place',{exact:true}).click();
  await page.getByLabel('Address or place name',{exact:true}).fill('Recorded exterior example');
  expect(requests).toHaveLength(0);
  await page.getByLabel('Address or place name',{exact:true}).press('Enter');
  const suggestion=page.getByRole('button',{name:/Recorded exterior example \(mock search result\)/});
  await expect(suggestion).toBeVisible();
  expect(requests).toHaveLength(1);expect(requests[0].url).not.toMatch(/lat=|lon=/);
  await expect(page.locator('[role="status"][tabindex="-1"]')).toBeFocused();
  await suggestion.press('Enter');
  await expect(page.getByLabel('Longitude',{exact:true})).toHaveValue('11.2574936');
  expect(await saved(page)).toEqual(before); // Suggestion alone never changes a saved facility.
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await expect(page.getByLabel('Search width (m)',{exact:true})).toBeVisible();
  expect((await saved(page)).cameras).toHaveLength(5);
});

test('real pinned shells review, select, append, edit and undo without changing camera plans',async({page},info)=>{
  const requests=await setup(page);
  await expect(page.getByRole('button',{name:'Grid',exact:true})).toBeEnabled();
  const start=Date.now();
  await saveOrigin(page);
  const before=await saved(page);
  await pasteExtract(page,exterior);
  await expect(page.getByRole('button',{name:'Use 2 selected buildings',exact:true})).toBeEnabled();
  const choices=page.getByRole('checkbox',{name:/^Include Mapped building/});
  await choices.nth(0).uncheck();await choices.nth(1).uncheck();
  await expect(page.getByRole('button',{name:'Use 0 selected buildings',exact:true})).toBeDisabled();
  await choices.nth(0).check();await choices.nth(1).check();
  await page.getByRole('button',{name:'Use 2 selected buildings',exact:true}).click();
  const after=await saved(page);
  expect(after.buildings).toHaveLength(5);expect(after.cameras).toEqual(before.cameras);expect(after.rooms).toEqual(before.rooms);
  expect(after.buildings.at(-1).source.license).toBe('ODbL-1.0');
  const draftMs=Date.now()-start, correctionStart=Date.now();
  await page.getByRole('button',{name:/^2 Buildings/}).click();
  await page.getByRole('button',{name:/Mapped building 105582211/}).click();
  await page.getByLabel('Building height',{exact:true}).fill('7');
  await page.getByRole('button',{name:'Save building',exact:true}).click();
  expect((await saved(page)).buildings.find(b=>b.id==='osm-way-105582211').height).toBe(7);
  const correctionMs=Date.now()-correctionStart;
  await page.screenshot({path:info.outputPath('reviewed-exteriors.png'),fullPage:true});
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect((await saved(page)).buildings.find(b=>b.id==='osm-way-105582211').height).toBe(6);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect(await saved(page)).toEqual(before);
  expect(requests).toHaveLength(0);
  const effort={draftMs,correctionMs,scriptedCorrectionFields:1,scriptedCorrectionSaves:1,noviceStudy:false,accuracyMeasured:false};
  console.log('SCRIPTED_FACILITY_EFFORT '+JSON.stringify(effort));
  await info.attach('scripted-effort',{body:JSON.stringify(effort),contentType:'application/json'});
});

test('courtyard and malformed imports never add invented buildings or retain old drafts',async({page})=>{
  await setup(page);await saveOrigin(page);const before=await saved(page);
  await pasteExtract(page,exterior);
  await page.getByLabel('OSM extract JSON',{exact:true}).fill('{bad');
  await page.getByRole('button',{name:'Review extract',exact:true}).click();
  await expect(page.getByRole('button',{name:/^Use \d+ selected buildings$/})).toHaveCount(0);
  await page.getByLabel('OSM extract JSON',{exact:true}).fill(JSON.stringify(courtyard));
  await page.getByRole('button',{name:'Review extract',exact:true}).click();
  await expect(page.getByText(/No new supported footprints found/)).toBeVisible();
  expect(await saved(page)).toEqual(before);
});

test('file import, boundary changes and replacement remain explicit and undoable',async({page})=>{
  await setup(page);await saveOrigin(page);const before=await saved(page);
  await page.getByText('Open an offline OSM file or paste JSON',{exact:true}).click();
  await page.getByLabel('Offline OSM file',{exact:true}).setInputFiles({name:'exterior.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exterior))});
  await expect(page.getByRole('button',{name:'Use 2 selected buildings',exact:true})).toBeVisible();
  await page.getByLabel('Search width (m)',{exact:true}).fill('200');
  await expect(page.getByRole('button',{name:/^Use \d+ selected buildings$/})).toHaveCount(0);
  await page.getByLabel('Offline OSM file',{exact:true}).setInputFiles({name:'exterior.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exterior))});
  await page.getByLabel('Apply building drafts',{exact:true}).selectOption('new');
  await page.getByRole('button',{name:'Use 2 selected buildings',exact:true}).click();
  expect((await saved(page)).cameras).toHaveLength(0);expect((await saved(page)).buildings).toHaveLength(2);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();expect(await saved(page)).toEqual(before);
});

test('partial service failure and cancellation preserve the saved plan',async({page})=>{
  await setup(page,{footprints:{elements:[],remark:'runtime timeout'}});await saveOrigin(page);const before=await saved(page);
  await page.getByRole('button',{name:'Load open building drafts',exact:true}).click();
  await expect(page.getByText(/Incomplete or oversized map response/)).toBeVisible();
  expect(await saved(page)).toEqual(before);
  await page.getByText('Find an address or place',{exact:true}).click();
  let release,started;const held=new Promise(r=>{release=r;}),intercepted=new Promise(r=>{started=r;});
  let finished;const lateFinished=new Promise(r=>{finished=r;});
  await page.route('https://photon.komoot.io/**',async route=>{started();await held;await route.fulfill({json:photon}).catch(()=>{});finished();});
  await page.getByLabel('Address or place name',{exact:true}).fill('Delayed suggestion');
  await page.getByRole('button',{name:'Search address',exact:true}).click();
  await intercepted;
  await page.getByRole('button',{name:'Cancel address search',exact:true}).click();
  release();await lateFinished;
  await expect(page.getByText('Search cancelled.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Recorded exterior example/})).toHaveCount(0);
  expect(await saved(page)).toEqual(before);
});

test('narrow screen keeps numeric area and offline review controls reachable',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);await saveOrigin(page);
  await page.getByLabel('Search width (m)',{exact:true}).fill('150');
  await pasteExtract(page,exterior);
  await expect(page.getByRole('button',{name:'Use 2 selected buildings',exact:true})).toBeVisible();
});
