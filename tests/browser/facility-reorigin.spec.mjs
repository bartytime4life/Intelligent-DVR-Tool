import {test,expect} from '@playwright/test';
import {blankFacility,validateFacility} from '../../src/facility.mjs';
import {createLibrary,LIBRARY_KEY} from '../../src/facility-library.mjs';
import {savedPlan} from './facility-test-helpers.mjs';

// A 15 × 10 m rotated rectangle with boundary-sharing room partitions.
// Every input coordinate is an exact binary fraction. The former independently
// rounded geographic conversions moved the room midpoint off its exterior edge.
const a=[300,200],b=[312,209],c=[306,217],d=[294,208],m=[306,204.5],n=[300,212.5];
const room=(id,footprint)=>({id,name:id,buildingId:'b',level:0,wallHeight:2.8,footprint});
const fixture=validateFacility({...blankFacility(),name:'Rotated boundary rooms',origin:[-98,38.5],
 buildings:[{id:'b',name:'Workshop',height:6,floors:2,footprint:[a,b,c,d,a]}],
 rooms:[room('A',[a,m,n,d,a]),room('B',[m,b,c,n,m])]});

async function openFixture(page){
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.addInitScript(({key,raw})=>{if(localStorage.getItem(key)===null)localStorage.setItem(key,raw);},
  {key:LIBRARY_KEY,raw:JSON.stringify(createLibrary(fixture))});
 await page.goto('/#facility');
 await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
 await page.getByLabel('Keep buildings at their map positions').check();
}

async function setOrigin(page,longitude,latitude){
 await page.getByLabel('Longitude',{exact:true}).fill(String(longitude));
 await page.getByLabel('Latitude',{exact:true}).fill(String(latitude));
 await page.getByRole('button',{name:'Save site',exact:true}).click();
}

for(const width of [1440,375])test(`Save site preserves rotated boundary rooms and recovers from a rejected origin at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:1000});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await openFixture(page);
 const before=await savedPlan(page);
 expect(before).toEqual(fixture);

 // A rejection must leave the original browser plan available for correction.
 await setOrigin(page,-97.9,38.5);
 await expect(page.getByRole('alert').filter({hasText:'outside the 2 km local grid'})).toBeVisible();
 expect(await savedPlan(page)).toEqual(before);
 await setOrigin(page,-97.99995,38.50005);
 await expect.poll(async()=>(await savedPlan(page)).origin).toEqual([-97.99995,38.50005]);
 await expect(page.getByRole('alert').filter({hasText:/Rooms must fit|outside the 2 km/})).toHaveCount(0);
 const moved=await savedPlan(page);
 expect(moved.rooms).toHaveLength(2);
 expect(moved.rooms[0].footprint[1]).toEqual(moved.rooms[1].footprint[0]);
 expect(moved.rooms[0].footprint[2]).toEqual(moved.rooms[1].footprint[3]);
 // A boundary point remains the midpoint of its original exterior edge.
 for(let axis=0;axis<2;axis++)expect(moved.rooms[0].footprint[1][axis]).toBeCloseTo((moved.buildings[0].footprint[0][axis]+moved.buildings[0].footprint[1][axis])/2,10);
 expect(()=>validateFacility(moved)).not.toThrow();
 await expect(page.getByRole('button',{name:'Undo edit',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('form').filter({has:page.getByRole('button',{name:'Save site',exact:true})})
  .screenshot({path:testInfo.outputPath(`reorigin-saved-${width}.png`)});
 await page.getByRole('button',{name:'Undo edit',exact:true}).click();
 await expect.poll(()=>savedPlan(page)).toEqual(before);

 // Save again, then verify persistence through an actual page reload.
 await page.getByLabel('Keep buildings at their map positions').check();
 await setOrigin(page,-97.99995,38.50005);
 await expect.poll(async()=>(await savedPlan(page)).origin).toEqual([-97.99995,38.50005]);
 const saved=await savedPlan(page);
 await page.reload();
 await expect(page.getByLabel('Latitude',{exact:true})).toHaveValue('38.50005');
 await expect(page.getByLabel('Longitude',{exact:true})).toHaveValue('-97.99995');
 expect(await savedPlan(page)).toEqual(saved);
 expect(errors).toEqual([]);
});
