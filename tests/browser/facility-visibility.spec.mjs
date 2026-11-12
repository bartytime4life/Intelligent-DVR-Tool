import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blankFacility,validateFacility} from '../../src/facility.mjs';
import {createLibrary,LIBRARY_KEY} from '../../src/facility-library.mjs';
import {savedPlan} from './facility-test-helpers.mjs';

const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const camera={id:'C1',name:'Planned camera',x:0,y:0,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:50,enabled:true,pixelsWide:1920};
const zone=(id,name,footprint)=>({id,name,type:'restricted',footprint,enabled:true,expectedClasses:['person'],dwellSeconds:2});
function fixture({name='Projected ground fixture',cameras=[camera],buildings=[],zones=[],route=[]}={}) {
  return validateFacility({...blankFacility(),name,cameras,buildings,zones,route});
}
async function open(page,plan) {
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.fallback() : route.abort());
  await page.addInitScript(({key,raw})=>localStorage.setItem(key,raw),{key:LIBRARY_KEY,raw:JSON.stringify(createLibrary(plan))});
  await page.goto('/#facility');
  await expect(page.getByRole('heading',{name:'Locate your facility',exact:true})).toBeVisible();
  await expect(page.getByLabel('Facility name',{exact:true})).toHaveValue(plan.name);
}
const metrics=page=>page.getByRole('region',{name:'Estimated coverage metrics'});

// These are interior physical checks, independent of the implementation's
// polygon output: image-plane bounds, finite-height shadows and raised walls.
const physical=[
  {name:'off-axis image corner',width:1440,plan:fixture({zones:[zone('off-axis','Image corner',[[5.2,5],[5.5,5],[9.5,9],[9.2,9],[5.2,5]])]}),rows:[['Image corner','100.0%']]},
  {name:'nadir view behind bearing',width:375,plan:fixture({cameras:[{...camera,tilt:89}],zones:[zone('rear','Behind bearing',rect(-.5,-2,.5,-1))]}),rows:[['Behind bearing','100.0%']]},
  {name:'finite low wall',width:1440,plan:fixture({buildings:[{id:'wall',name:'Low wall',footprint:rect(-1,5,1,6),height:1,floors:1}],zones:[zone('near','Near shadow',rect(-.5,6.1,.5,7.1)),zone('far','Beyond shadow',rect(-.5,12,.5,13))]}),rows:[['Near shadow','0.0%'],['Beyond shadow','100.0%']]},
  {name:'raised wall',width:375,plan:fixture({buildings:[{id:'wall',name:'Raised wall',footprint:rect(-1,5,1,6),base:2,height:3,floors:1}],zones:[zone('under','Below raised wall',rect(-.5,7,.5,8)),zone('blocked','Raised shadow',rect(-.5,15,.5,16))]}),rows:[['Below raised wall','100.0%'],['Raised shadow','0.0%']]},
];
for(const item of physical) test(`shared visibility renders ${item.name} at ${item.width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width:item.width,height:1000});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,item.plan);await page.getByRole('button',{name:/^5 Coverage/}).click();
  const table=metrics(page);
  for(const [name,coverage] of item.rows) {
    const row=table.getByRole('row',{name:new RegExp(name)});
    await expect(row.getByRole('cell').first()).toHaveText(coverage);
    await expect(row).not.toContainText('Not estimated');
  }
  const before=await savedPlan(page);
  await table.getByRole('button',{name:`Blind spots for ${item.rows[0][0]}`,exact:true}).click();
  await expect(table.getByRole('status')).toContainText(item.rows[0][1]==='100.0%' ? 'No uncovered area' : 'Map shows uncovered areas');
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.getByRole('button',{name:'Center camera',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download installer sheet',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.facility-stage').screenshot({path:testInfo.outputPath(`${item.name.replaceAll(' ','-')}-${item.width}.png`)});
  expect(await savedPlan(page)).toEqual(before);expect(errors).toEqual([]);
});

test('visibility failure withholds rehearsal, totals and export and retry restores the saved plan',async({page},testInfo)=>{
  await page.setViewportSize({width:375,height:1000});
  const plan=fixture({zones:[zone('yard','Yard',rect(-1,10,1,12))],route:[[0,10],[0,12]]});
  const block=route=>route.abort();await page.route('**/*facility-visibility-worker*',block);
  await open(page,plan);
  await expect(page.locator('.facility-visibility-status')).toContainText('Some estimated views are unavailable');
  await page.getByRole('button',{name:/^6 Handoffs/}).click();
  await expect(page.getByRole('button',{name:'Play rehearsal',exact:true})).toBeDisabled();
  await expect(page.locator('.facility-rehearsal')).toContainText('Estimated visibility unavailable');
  await expect(page.locator('.facility-rehearsal')).not.toContainText('Blind spot');
  await expect(page.locator('.facility-rehearsal').getByRole('button',{name:'Try views again',exact:true})).toBeVisible();
  await page.locator('.facility-stage').screenshot({path:testInfo.outputPath('handoff-unavailable-375.png')});
  await expect(page.getByText('Transitions are unavailable because the estimated views could not be completed.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^5 Coverage/}).click();
  await expect(metrics(page)).toContainText('Coverage is unavailable until estimated camera views recover.');
  await expect(page.getByRole('button',{name:'Download installer sheet',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Zoom in',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.locator('.facility-stage').screenshot({path:testInfo.outputPath('visibility-unavailable-375.png')});
  await page.unroute('**/*facility-visibility-worker*',block);
  await page.getByRole('button',{name:'Try views again',exact:true}).click();
  await expect(metrics(page).getByRole('row',{name:/Yard/})).toContainText('100.0%0.0%');
  const before=await savedPlan(page),download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download installer sheet',exact:true}).click();
  const html=readFileSync(await (await download).path(),'utf8');
  expect(html).toContain('Ground-view method: pinhole-ground-shadows-v1');
  expect(html).toContain('<path class="fan" fill-rule="evenodd"');
  expect(html).not.toContain('Estimated camera views unavailable');
  expect(await savedPlan(page)).toEqual(before);
});

test('pending changed visibility clears old results and preserves draft, discard, save and Undo',async({page},testInfo)=>{
  await page.addInitScript(()=>{
    window.__visibilityDelay=500;
    const NativeWorker=window.Worker;
    window.Worker=function(url,options){
      const worker=new NativeWorker(url,options);
      if(String(url).includes('facility-visibility-worker')) {
        const post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker);let timer;
        worker.postMessage=message=>{timer=setTimeout(()=>post(message),window.__visibilityDelay);};
        worker.terminate=()=>{clearTimeout(timer);terminate();};
      }
      return worker;
    };
    window.Worker.prototype=NativeWorker.prototype;
  });
  const plan=fixture({zones:[zone('yard','Yard',rect(-1,10,1,12))],route:[[0,10],[0,12]]});
  await open(page,plan);await page.getByRole('button',{name:/^5 Coverage/}).click();
  const row=metrics(page).getByRole('row',{name:/Yard/});await expect(row).toContainText('100.0%0.0%');
  await metrics(page).getByRole('button',{name:'Blind spots for Yard',exact:true}).click();
  const before=await savedPlan(page),bearing=page.getByLabel('Direction from north',{exact:true});
  await page.evaluate(()=>{window.__visibilityDelay=1500;});
  await bearing.fill('180');
  await expect(page.locator('.facility-visibility-status')).toContainText('Updating estimated views');
  await expect(row).toHaveCount(0);await expect(page.getByRole('button',{name:'Save camera',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Download installer sheet',exact:true})).toBeDisabled();
  expect(await savedPlan(page)).toEqual(before);
  await page.locator('.facility-stage').screenshot({path:testInfo.outputPath('visibility-updating-1440.png')});
  await page.evaluate(()=>{window.__visibilityDelay=500;});
  await page.getByRole('button',{name:'Discard preview',exact:true}).click();
  await expect(bearing).toHaveValue('0');await expect(row).toContainText('100.0%0.0%');
  await bearing.fill('180');await expect(row).toContainText('0.0%0.0%');
  await page.getByRole('button',{name:'Save camera',exact:true}).click();
  await expect.poll(async()=>(await savedPlan(page)).cameras[0].bearing).toBe(180);
  await page.getByRole('button',{name:'Undo edit',exact:true}).click();
  await expect(row).toContainText('100.0%0.0%');expect(await savedPlan(page)).toEqual(before);
});


async function centreCamera(page) {
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.getByRole('button',{name:'Center camera',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('.maplibregl-ctrl-compass .maplibregl-ctrl-icon')?.style.transform)).toContain('rotateX(0deg)');
  await page.waitForTimeout(700);
  const box=await page.locator('.facility-map').boundingBox();return [box.x+box.width/2,box.y+box.height/2];
}

test('task and Undo changes cancel the old drag before release and a fresh gesture still works',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page,fixture({zones:[zone('yard','Yard',rect(-1,10,1,12))]}));
  await page.getByRole('button',{name:/^4 Cameras/}).click();
  const before=await savedPlan(page);let [x,y]=await centreCamera(page);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+20,{steps:5});
  await expect(page.locator('.facility-drag-hint')).toBeVisible();
  await page.getByRole('combobox',{name:'Measurement units',exact:true}).selectOption('imperial');
  await expect(page.locator('.facility-drag-hint')).toBeVisible();
  await page.getByRole('combobox',{name:'Measurement units',exact:true}).selectOption('metric');
  await expect(page.locator('.facility-drag-hint')).toBeVisible();
  await page.locator('.maplibregl-canvas').focus();
  await page.keyboard.press('7');
  await expect(page.getByRole('heading',{name:'Zones & object rules',exact:true})).toBeVisible();
  await expect(page.locator('.facility-drag-hint')).toHaveCount(0);
  await page.mouse.move(x+90,y+30);await page.mouse.up();
  expect(await savedPlan(page)).toEqual(before);
  await page.keyboard.press('4');
  await expect(page.getByLabel('Camera east',{exact:true})).toHaveValue('0');
  [x,y]=await centreCamera(page);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+20,{steps:5});await page.mouse.up();
  await expect.poll(async()=>Number(await page.getByLabel('Camera east',{exact:true}).inputValue())).toBeGreaterThan(5);
  await page.getByRole('button',{name:'Save camera',exact:true}).click();
  await expect.poll(async()=>(await savedPlan(page)).cameras[0].x).toBeGreaterThan(5);
  [x,y]=await centreCamera(page);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+20,{steps:5});
  await expect(page.locator('.facility-drag-hint')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(()=>savedPlan(page)).toEqual(before);
  await expect(page.locator('.facility-drag-hint')).toHaveCount(0);
  await page.mouse.move(x+90,y+30);await page.mouse.up();
  await expect(page.getByLabel('Camera east',{exact:true})).toHaveValue('0');
  [x,y]=await centreCamera(page);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+20,{steps:5});await page.mouse.up();
  await expect.poll(async()=>Number(await page.getByLabel('Camera east',{exact:true}).inputValue())).toBeGreaterThan(5);
  expect(await savedPlan(page)).toEqual(before);expect(errors).toEqual([]);
});
