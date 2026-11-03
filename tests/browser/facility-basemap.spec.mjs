import {test,expect} from '@playwright/test';
import {savedPlan} from './facility-test-helpers.mjs';
import {readFileSync} from 'node:fs';

// A 1×1 PNG stands in for every map picture; no real provider is contacted.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwSCgAAAHEAQHpOvu6AAAAAElFTkSuQmCC','base64');
const hosts=['tiles.maps.eox.at','tile.openstreetmap.org','basemap.nationalmap.gov','imagery.nationalmap.gov'];
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

test('Streets sends only the app origin and stops on an HTTP 200 policy tile',async({page})=>{
  await open(page);
  // Exercise the installed Python service's document policy on the normal editor.
  await page.route('**/index.html*',async route=>{
    const result=await route.fetch();
    await route.fulfill({response:result,headers:{...result.headers(),'referrer-policy':'no-referrer'}});
  });
  const referrers=[];
  await page.route('https://tile.openstreetmap.org/**',async route=>{
    referrers.push(await route.request().headerValue('referer'));
    await route.fulfill({contentType:'image/png',body:png,headers:{
      'access-control-allow-origin':'*','access-control-expose-headers':'x-blocked','x-blocked':'Access denied'
    }});
  });
  await page.goto('/index.html?private=omit#facility');
  const before=await savedPlan(page);
  await page.getByRole('button',{name:'Streets',exact:true}).click();
  const notice=page.locator('.facility-layer-notice');
  await expect(notice).toContainText('OpenStreetMap declined');
  await expect(pill(page)).toContainText('showing the local grid');
  expect(referrers.length).toBeGreaterThan(0);
  expect([...new Set(referrers)]).toEqual([new URL(page.url()).origin+'/']);
  expect(await savedPlan(page)).toEqual(before);
  await expect(page.getByRole('button',{name:'Save site',exact:true})).toBeEnabled();
  await notice.getByRole('button',{name:'Use Grid',exact:true}).click();
  await expect(notice).toHaveCount(0);
  await page.unroute('https://tile.openstreetmap.org/**');
  await page.getByRole('button',{name:'Streets',exact:true}).click();
  await expect(pill(page)).toContainText('Streets · OpenStreetMap');
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

test('a coarse device position keeps the site in place until a precise fix arrives and is saved',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'geolocation',{value:{
      watchPosition(success, failure, options) { window.deviceFix = success; window.deviceFailure = failure; window.locationOptions = options; return 7; },
      clearWatch(id) { window.clearedWatch = id; }
    }});
  });
  await open(page);
  const before = await savedPlan(page);
  const lat = page.getByLabel('Latitude',{exact:true});
  const lng = page.getByLabel('Longitude',{exact:true});
  const original = [await lng.inputValue(), await lat.inputValue()];
  const send = (longitude,latitude,accuracy)=>page.evaluate(coords=>window.deviceFix({coords,timestamp:Date.now()}),{longitude,latitude,accuracy});
  await page.getByRole('button',{name:'Use my location',exact:true}).click();
  expect(await page.evaluate(()=>window.locationOptions)).toMatchObject({enableHighAccuracy:true,maximumAge:0});
  await send(-101,37,95000);
  await expect(page.getByText(/reports a 95 km radius/)).toBeVisible();
  expect([await lng.inputValue(),await lat.inputValue()]).toEqual(original);
  await expect(page.locator('.facility-site-preview')).toHaveCount(0);
  await send(-95.678,39.0483,12);
  await expect(lat).toHaveValue('39.0483');
  await expect(lng).toHaveValue('-95.678');
  await expect(page.locator('.facility-site-preview')).toBeVisible();
  await expect(page.getByText(/Device estimate within 12 m/)).toBeVisible();
  expect(await savedPlan(page)).toEqual(before);
  expect(await page.evaluate(()=>window.clearedWatch)).toBe(7);
  await page.getByRole('button',{name:'Save site',exact:true}).click();
  expect((await savedPlan(page)).origin).toEqual([-95.678,39.0483]);
  await page.reload();
  await expect(lat).toHaveValue('39.0483');
  await expect(lng).toHaveValue('-95.678');
});

test('a failed device fix cannot save the default as GPS or overwrite a manual correction',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator,'geolocation',{value:{
      watchPosition(success,error) {window.fix=success;window.fail=error;return 1;}, clearWatch(){}
    }});
  });
  await open(page);
  const locate=page.getByRole('button',{name:'Use my location',exact:true});
  const save=page.getByRole('button',{name:'Save site',exact:true});
  await locate.click();
  await page.evaluate(()=>{window.fix({coords:{longitude:-101,latitude:37,accuracy:48000},timestamp:Date.now()});window.fail({code:3});});
  await expect(page.getByText(/best reported accuracy was 48 km/)).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByRole('button',{name:'Find by address',exact:true}).click();
  await expect(page.getByLabel('Address or place name',{exact:true})).toBeFocused();
  await locate.click();
  await page.getByLabel('Latitude',{exact:true}).fill('39.0483');
  await page.evaluate(()=>window.fix({coords:{longitude:-102,latitude:38,accuracy:5},timestamp:Date.now()}));
  await expect(page.getByLabel('Latitude',{exact:true})).toHaveValue('39.0483');
  await expect(page.locator('.facility-site-preview')).toHaveCount(0);
  await expect(save).toBeEnabled();
});

test('Satellite loads georeferenced roof tiles as the operator pans, with a working grid fallback',async({page})=>{
  const requests=await open(page);
  const roofRequests=()=>requests.filter(u=>u.hostname==='imagery.nationalmap.gov' && u.searchParams.get('size')==='512,512');
  expect(requests).toHaveLength(0);
  await page.getByRole('button',{name:'Satellite',exact:true}).click();
  await expect.poll(()=>requests.filter(u=>u.hostname==='tiles.maps.eox.at').length).toBeGreaterThan(0);
  await expect.poll(()=>roofRequests().length).toBeGreaterThan(0);
  const first=roofRequests()[0], bounds=first.searchParams.get('bbox').split(',').map(Number);
  expect(bounds.every(Number.isFinite)).toBe(true);
  expect(bounds[0]).toBeLessThan(bounds[2]);
  expect(first.searchParams.get('bboxSR')).toBe('3857');
  await expect(pill(page)).toContainText('USGS/USDA aerial');
  const before=await savedPlan(page);
  await page.getByRole('button',{name:'2D',exact:true}).click();
  const seen=new Set(roofRequests().map(u=>u.href));
  const map=page.locator('.maplibregl-canvas');
  const box=await map.boundingBox();
  const x=box.x+box.width*.8, y=box.y+box.height*.65;
  for(let i=0;i<3;i++){await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-box.width*.6,y,{steps:7});await page.mouse.up();}
  await expect.poll(()=>roofRequests().some(u=>!seen.has(u.href))).toBe(true);
  expect(await savedPlan(page)).toEqual(before);
  await page.reload();
  await expect(page.getByRole('button',{name:'Satellite',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Grid',exact:true}).click();
  await expect(pill(page)).toContainText('no map pictures requested');
});

test('Satellite keeps overseas views on Sentinel-2 and reports a U.S. roof outage',async({page})=>{
  const requests=await open(page);
  const save=page.getByRole('button',{name:'Save site',exact:true});
  const setPlace=async(lng,lat)=>{
    await page.getByLabel('Longitude',{exact:true}).fill(String(lng));
    await page.getByLabel('Latitude',{exact:true}).fill(String(lat));
    await save.click();
  };
  await setPlace(11.26,46.45);
  await page.getByRole('button',{name:'Satellite',exact:true}).click();
  await expect(pill(page)).toContainText('Sentinel-2 satellite overview');
  await expect.poll(()=>requests.filter(u=>u.hostname==='tiles.maps.eox.at').length).toBeGreaterThan(0);
  expect(requests.some(u=>u.hostname==='imagery.nationalmap.gov')).toBe(false);
  await page.route('https://imagery.nationalmap.gov/**',r=>r.abort());
  await setPlace(-95.678,39.0483);
  await expect(page.locator('.facility-layer-notice')).toContainText('Some roof images could not load');
  await expect(page.locator('.facility-map-error')).toHaveCount(0);
  expect((await savedPlan(page)).origin).toEqual([-95.678,39.0483]);
  await page.getByRole('button',{name:'Grid',exact:true}).click();
  await expect(page.locator('.facility-layer-notice')).toHaveCount(0);
});
