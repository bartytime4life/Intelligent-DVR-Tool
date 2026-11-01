import {test,expect} from '@playwright/test';
import {savedPlan} from './facility-test-helpers.mjs';
import {readFileSync} from 'node:fs';

// A 1×1 PNG stands in for every map picture; no real provider is contacted.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwSCgAAAHEAQHpOvu6AAAAAElFTkSuQmCC','base64');
const hosts=['tile.openstreetmap.org','basemap.nationalmap.gov','imagery.nationalmap.gov'];
const place={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[-94.7844298,38.9698085]},properties:{name:'Recorded municipal campus (mock search result)',city:'Lenexa',state:'Kansas'}}]};

async function open(page,{pictures='ok'}={}) {
  const requests=[];
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    if(url.hostname==='photon.komoot.io')return route.fulfill({json:place});
    if(hosts.includes(url.hostname)){requests.push(url);return pictures==='ok'?route.fulfill({body:png,contentType:'image/png'}):route.abort();}
    return route.abort();
  });
  await page.goto('/#facility');
  await expect(page.getByRole('button',{name:'Grid',exact:true})).toBeEnabled();
  return requests;
}
const pill=page=>page.locator('.facility-map-context small');

test('a blank facility requests no map pictures until a real layer is chosen, then remembers it',async({page},info)=>{
  const requests=await open(page);
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(0);
  await expect(pill(page)).toContainText('no map pictures requested');
  await page.getByRole('button',{name:'Find my site on the map',exact:true}).click();
  await expect(page.getByRole('button',{name:'Aerial',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('Address or place name',{exact:true})).toBeFocused();
  await expect(page.getByRole('heading',{name:'Your facility starts here'})).toHaveCount(0);
  await expect(pill(page)).toContainText('site photo');
  await expect.poll(()=>requests.filter(u=>u.hostname==='basemap.nationalmap.gov').length).toBeGreaterThan(0);
  const photos=requests.filter(u=>u.hostname==='imagery.nationalmap.gov');
  expect(photos).toHaveLength(1);
  expect(photos[0].searchParams.get('size')).toBe('1360,1360');
  expect(requests.some(u=>u.hostname==='tile.openstreetmap.org')).toBe(false);
  await page.screenshot({path:info.outputPath('aerial-layer.png')});
  await page.reload();
  await expect(page.getByRole('button',{name:'Aerial',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('radio',{name:'Aerial · USGS The National Map'})).toBeChecked();
  await page.getByRole('button',{name:'Grid',exact:true}).click();
  await expect(pill(page)).toContainText('no map pictures requested');
  expect(await page.evaluate(()=>localStorage.getItem('dvr.facility.basemap'))).toBe('grid');
});

test('a chosen address is previewed on the map before Save site commits it',async({page})=>{
  await open(page);
  await page.getByRole('radio',{name:'Streets · OpenStreetMap'}).check();
  await expect(pill(page)).toContainText('Streets · OpenStreetMap');
  const before=await savedPlan(page);
  await page.getByLabel('Address or place name',{exact:true}).fill('Recorded municipal campus');
  await page.getByLabel('Address or place name',{exact:true}).press('Enter');
  await page.getByRole('button',{name:/Recorded municipal campus \(mock search result\)/}).click();
  await expect(page.locator('.facility-site-preview')).toBeVisible();
  expect((await savedPlan(page)).origin).toEqual(before.origin);
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await expect(page.locator('.facility-site-preview')).toHaveCount(0);
  expect((await savedPlan(page)).origin).toEqual([-94.7844298,38.9698085]);
  await page.getByRole('button',{name:'Trace a building',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Shape a building'})).toBeVisible();
  await expect(page.locator('.facility-draw-hint')).toContainText('roof corner');
});

test('unavailable map pictures leave the plan editable and offer a way back',async({page})=>{
  await open(page,{pictures:'offline'});
  await page.getByRole('button',{name:'Streets',exact:true}).click();
  const notice=page.locator('.facility-layer-notice');
  await expect(notice).toContainText('Some map pictures could not load');
  await expect(page.locator('.facility-map-error')).toHaveCount(0);
  await notice.getByRole('button',{name:'Use Grid',exact:true}).click();
  await expect(notice).toHaveCount(0);
  await page.getByRole('button',{name:'Aerial',exact:true}).click();
  await expect(notice).toContainText(/aerial photo|Could not reach/i);
  await expect(notice.getByRole('button',{name:'Retry photo',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save site',exact:true})).toBeEnabled();
});

test('aerial photos are not requested outside their coverage',async({page})=>{
  const requests=await open(page);
  await page.getByLabel('Longitude',{exact:true}).fill('11.2574936');
  await page.getByLabel('Latitude',{exact:true}).fill('46.45528628');
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await page.getByRole('button',{name:'Aerial',exact:true}).click();
  const notice=page.locator('.facility-layer-notice');
  await expect(notice).toContainText('contiguous United States');
  expect(requests.filter(u=>u.hostname==='imagery.nationalmap.gov')).toHaveLength(0);
  await notice.getByRole('button',{name:'Use Streets',exact:true}).click();
  await expect(page.getByRole('button',{name:'Streets',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('returning to Aerial reuses the loaded site photo; Grid discards it',async({page})=>{
  const requests=await open(page);
  const photos=()=>requests.filter(u=>u.hostname==='imagery.nationalmap.gov').length;
  await page.getByRole('button',{name:'Aerial',exact:true}).click();
  await expect(pill(page)).toContainText('site photo');
  await page.getByRole('button',{name:'Streets',exact:true}).click();
  await page.getByRole('button',{name:'Aerial',exact:true}).click();
  await expect(pill(page)).toContainText('site photo ≈');
  expect(photos()).toBe(1);
  await page.getByRole('button',{name:'Grid',exact:true}).click();
  await page.getByRole('button',{name:'Aerial',exact:true}).click();
  await expect(pill(page)).toContainText('site photo ≈');
  expect(photos()).toBe(2);
});

test('Find mapped buildings loads drafts in one click; map clicks include or exclude them before adding',async({page},info)=>{
  const exteriors=JSON.parse(readFileSync(new URL('../fixtures/facility/eppan-exteriors.json',import.meta.url)));
  const footprintRequests=[];
  await open(page);
  // Registered after open()'s catch-all so it takes precedence.
  await page.route('https://overpass.private.coffee/**',route=>{footprintRequests.push(route.request().postData());return route.fulfill({json:exteriors});});
  await page.getByLabel('Longitude',{exact:true}).fill('11.2574936');
  await page.getByLabel('Latitude',{exact:true}).fill('46.45528628');
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  expect(footprintRequests).toHaveLength(0); // Saving a site alone never looks up buildings.
  await page.getByRole('button',{name:'Find mapped buildings',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use 2 selected buildings',exact:true})).toBeEnabled();
  expect(footprintRequests).toHaveLength(1);
  await expect(page.getByRole('button',{name:'2D',exact:true})).toHaveAttribute('aria-pressed','true');
  const banner=page.locator('.facility-draft-banner');
  await expect(banner).toContainText('2 of 2 mapped buildings selected');
  await expect(page.locator('.facility-next-callout')).toHaveCount(0);
  // Clicking an included draft excludes it; clicking the same spot again includes it again.
  const label=page.locator('.facility-map-label').filter({hasText:/^Mapped building 105582211$/});
  await expect(label).toBeVisible();
  await page.waitForTimeout(600); // the map frames the drafts with a 500 ms ease
  const box=await label.boundingBox(), spot={x:box.x+box.width/2,y:box.y+box.height/2};
  await page.mouse.click(spot.x,spot.y);
  await expect(banner).toContainText('1 of 2 mapped buildings selected');
  await expect(page.getByRole('checkbox',{name:'Include Mapped building 105582211'})).not.toBeChecked();
  await page.screenshot({path:info.outputPath('draft-review.png')});
  await page.mouse.click(spot.x,spot.y);
  await expect(banner).toContainText('2 of 2 mapped buildings selected');
  await page.mouse.click(spot.x,spot.y);
  await page.getByRole('button',{name:'Use 1 selected buildings',exact:true}).click();
  const plan=await savedPlan(page);
  expect(plan.buildings.map(b=>b.id)).toEqual(['osm-way-106227181']);
  await expect(banner).toHaveCount(0);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  expect((await savedPlan(page)).buildings).toHaveLength(0);
});

test('the start card steps aside once a site is suggested or saved without using it',async({page})=>{
  await open(page);
  const card=page.getByRole('heading',{name:'Your facility starts here'});
  await expect(card).toBeVisible();
  await page.getByLabel('Address or place name',{exact:true}).fill('Recorded municipal campus');
  await page.getByLabel('Address or place name',{exact:true}).press('Enter');
  await page.getByRole('button',{name:/Recorded municipal campus \(mock search result\)/}).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  await expect(card).toHaveCount(0);
});
