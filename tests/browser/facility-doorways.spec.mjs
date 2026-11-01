import {test,expect} from '@playwright/test';
import {blankFacility} from '../../src/facility.mjs';
import {savedPlan} from './facility-test-helpers.mjs';
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const plan={...blankFacility(),buildings:[{id:'b',name:'Workshop',height:6,floors:2,footprint:rect(0,0,12,8)}],
rooms:[{id:'r1',name:'Office',buildingId:'b',level:0,wallHeight:2.8,footprint:rect(0,0,6,8)},{id:'r2',name:'Store',buildingId:'b',level:0,wallHeight:2.8,footprint:rect(6,0,6,8)}]};
const button=(root,name)=>root.getByRole('button',{name,exact:true});
async function open(page,seed=plan,graphics=true) {
  await page.addInitScript(p=>{if(!localStorage.getItem('dvr.facilities.v1'))localStorage.setItem('dvr.facility.v1',JSON.stringify(p));},seed);
  await page.goto('/#facility');await page.getByLabel('Jump to facility task').selectOption('2');
  if(graphics)await expect(button(page,'Place doorway')).toBeEnabled();
  else await expect(button(page,'Place doorway')).toBeDisabled();
}
async function drag(page,dx,dy,cancel=false) {
  const handle=button(page,'Drag doorway along wall'),box=await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:5});
  if(cancel)await page.keyboard.press('Escape');
  await page.mouse.up();
}
test('click a shared map wall, drag the doorway, save, reload and undo without changing room outlines',async({page},info)=>{
  await open(page);const before=await savedPlan(page);
  await button(page,'Office').click();
  await page.getByRole('checkbox',{name:'Dimensions',exact:true}).uncheck();
  await button(page,'Place doorway').click();
  // The building centroid is the middle of the shared wall; its unselected label
  // is centered on that point in the rendered map.
  const label=page.locator('.facility-map-label').filter({hasText:/^Workshop$/});
  await expect(label).toBeVisible();
  await expect(page.getByText('Click a highlighted shared wall.',{exact:true})).toBeVisible();
  // Wait for the map's short zoom transition to settle.
  await expect(async()=>{
    const first=await label.boundingBox();
    await page.waitForTimeout(100);
    const second=await label.boundingBox();
    expect(Math.abs(first.x-second.x)+Math.abs(first.y-second.y)).toBeLessThan(.2);
  }).toPass();
  const box=await label.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await expect(button(page,'Drag doorway along wall')).toBeVisible();
  const offset=page.getByLabel('Distance along wall',{exact:true}), initial=+await offset.inputValue();
  expect(initial).toBeCloseTo(4,0);expect(await savedPlan(page)).toEqual(before);
  await drag(page,0,-45);
  await expect(async()=>expect(+await offset.inputValue()).toBeGreaterThan(initial+.4)).toPass();
  const moved=+await offset.inputValue();await drag(page,0,30,true);
  await expect(offset).toHaveValue(String(moved));
  await page.getByLabel('Doorway width',{exact:true}).fill('1.2');
  await button(page,'Save doorway').click();const saved=await savedPlan(page);
  expect(saved.doorways).toHaveLength(1);expect(saved.doorways[0].width).toBe(1.2);
  expect(saved.rooms).toEqual(before.rooms);
  await page.screenshot({path:info.outputPath('doorway.png')});
  await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
  await button(page,'Redo edit').click();expect(await savedPlan(page)).toEqual(saved);
  await page.reload();await page.getByLabel('Jump to facility task').selectOption('2');
  await button(page,'Doorway Office ↔ Store').click();
  await expect(page.getByLabel('Doorway width',{exact:true})).toHaveValue('1.2');
  expect(await savedPlan(page)).toEqual(saved);
});

test('numeric fallback, feet and floor copying preserve door records and reject narrowing away the opening',async({page})=>{
  await open(page);
  await page.getByText('Place by room pair',{exact:true}).click();await button(page,'Place on this wall').click();
  await page.getByLabel('Measurement units',{exact:true}).selectOption('imperial');
  await page.getByLabel('Doorway width',{exact:true}).fill('3');
  await page.getByLabel('Distance along wall',{exact:true}).fill('12');
  await button(page,'Save doorway').click();const before=await savedPlan(page);
  expect(before.doorways[0].width).toBe(.9144);
  await button(page,'Copy rooms upstairs').click();const copied=await savedPlan(page);
  expect(copied.doorways).toHaveLength(2);expect(copied.doorways[1].level).toBe(1);
  await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
  await page.getByLabel('Active floor').selectOption('0');
  await button(page,'Doorway Office ↔ Store').click();
  await page.getByLabel('Doorway width',{exact:true}).fill('100');
  await expect(button(page,'Save doorway')).toBeDisabled();
  await expect(button(page,'Drag doorway along wall')).toHaveCount(0);
  expect(await savedPlan(page)).toEqual(before);
  await button(page,'Discard doorway changes').click();
  await expect(button(page,'Drag doorway along wall')).toBeVisible();
  await page.getByRole('button',{name:/^Remove doorway/}).click();
  expect((await savedPlan(page)).doorways).toEqual([]);
  await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
});

test('touch dragging and keyboard nudges move only the preview until Save',async({browser})=>{
  const context=await browser.newContext({hasTouch:true,viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  try {
    await open(page);const before=await savedPlan(page);
    await page.getByText('Place by room pair',{exact:true}).click();await button(page,'Place on this wall').click();
    const handle=button(page,'Drag doorway along wall'),offset=page.getByLabel('Distance along wall',{exact:true});
    await expect(handle).toBeVisible();
    await handle.press('ArrowUp');await expect(offset).toHaveValue('4.1');
    // Send real touch input through Chromium, which emits the pointer events
    // used by phones/tablets instead of calling the drag callback directly.
    const client=await context.newCDPSession(page);
    const box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=5;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*6}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(async()=>expect(+await offset.inputValue()).toBeGreaterThan(4.2)).toPass({timeout:3000});
    expect(await savedPlan(page)).toEqual(before);
    await button(page,'Save doorway').click();
    const saved=await savedPlan(page);expect(saved.doorways[0].y).toBeGreaterThan(4.2);
  } finally {await context.close();}
});

test('numeric doorway placement works without WebGL, and converting its room removes the doorway atomically',async({page})=>{
  await page.addInitScript(()=>{
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:getContext.call(this,type,...args);};
  });
  await open(page,{...plan,buildings:[{...plan.buildings[0],footprint:rect(-1,-1,14,10)}]},false);
  await page.getByText('Place by room pair',{exact:true}).click();await button(page,'Place on this wall').click();
  await page.getByLabel('Distance along wall',{exact:true}).fill('2');
  await button(page,'Save doorway').click();const before=await savedPlan(page);
  expect(before.doorways[0].y).toBe(2);
  await button(page,'Office').click();await button(page,'Convert selected room to opening').click();
  const changed=await savedPlan(page);
  expect(changed.doorways).toEqual([]);expect(changed.rooms).toHaveLength(1);expect(changed.openings).toHaveLength(1);
  await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
});
