import {test,expect} from '@playwright/test';
import {blankFacility,polygonArea,ringsInteriorOverlap} from '../../src/facility.mjs';
import {savedPlan} from './facility-test-helpers.mjs';

const button=(root,name)=>root.getByRole('button',{name,exact:true});
async function openBlank(page) {
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/#facility');
  await button(page,'Add first building').click();
  await button(page,'Add rectangle').click();
  await button(page,'Sketch rooms inside').click();
  return page.getByRole('dialog',{name:'Room sketch'});
}
async function planPoint(canvas,x,y) {
  return canvas.evaluate((el,[x,y])=>{
    const p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};
  },[x,y]);
}

test('one click starts a preview; hall, units and names update the same undoable layout',async({page},info)=>{
  const sketch=await openBlank(page), before=await savedPlan(page);
  await expect(button(sketch,'Add 3 rooms')).toBeEnabled();
  await button(sketch,'Center hall').click();
  await expect(button(sketch,'Add 6 rooms')).toBeEnabled();
  await sketch.getByText('Dimensions & names').click();
  await sketch.getByLabel('Sketch units').selectOption('imperial');
  await sketch.getByLabel('Hall width').fill('8');
  await sketch.getByLabel('Room name prefix').fill('Office');
  await expect(sketch.getByText('Office 6',{exact:true})).toBeVisible();
  await sketch.getByText('Dimensions & names').click();
  await page.screenshot({path:info.outputPath('room-sketch.png')});
  expect(await savedPlan(page)).toEqual(before);
  await button(sketch,'Add 6 rooms').click();
  await expect(sketch).toHaveCount(0);
  const saved=await savedPlan(page);
  expect(saved.rooms.map(r=>r.name)).toEqual([1,2,3,4,5,6].map(n=>'Office '+n));
  expect(saved.rooms.reduce((n,r)=>n+polygonArea(r.footprint),0)).toBeCloseTo(40*(20-8*.3048),6);
  await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
  await button(page,'Redo edit').click();expect(await savedPlan(page)).toEqual(saved);
});

test('tap corners, drag a second group, protect pending work and undo both groups together',async({page})=>{
  const sketch=await openBlank(page), before=await savedPlan(page), canvas=sketch.getByLabel('Room sketch canvas');
  await button(sketch,'One room').click();
  const a=await planPoint(canvas,2,2),b=await planPoint(canvas,11,10);
  await page.mouse.click(a.x,a.y);
  await expect(button(sketch,'Add rooms')).toBeDisabled();
  await page.mouse.click(b.x,b.y);
  await button(sketch,'Keep & draw more').click();
  await expect(sketch.getByText('1 room kept')).toBeVisible();
  await button(sketch,'Room row').click();
  await button(sketch,'Fewer rooms').click();
  const c=await planPoint(canvas,11.1,2.1),d=await planPoint(canvas,28,12);
  await page.mouse.move(c.x,c.y);await page.mouse.down();await page.mouse.move(d.x,d.y,{steps:5});
  await expect(canvas.locator('.room-proposed')).toHaveCount(2);
  await page.mouse.up();
  await button(sketch,'Close room sketch').click();
  await expect(sketch.getByText('Discard this room sketch?')).toBeVisible();
  expect(await savedPlan(page)).toEqual(before);
  await button(sketch,'Keep editing').click();
  await button(sketch,'Add 3 rooms').click();
  await expect(sketch).toHaveCount(0);
  const saved=await savedPlan(page);
  expect(saved.rooms.map(r=>r.name)).toEqual(['Room 1','Room 2','Room 3']);
  expect(saved.rooms.map(r=>polygonArea(r.footprint))).toEqual([72,85,85]);
  expect(ringsInteriorOverlap(saved.rooms[0].footprint,saved.rooms[1].footprint)).toBe(false);
  await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
});

test('mobile-size sketch accepts keyboard and exact dimensions without WebGL; discard leaves the floor untouched',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:original.call(this,type,...args);};
  });
  const sketch=await openBlank(page), before=await savedPlan(page), canvas=sketch.getByLabel('Room sketch canvas');
  await button(sketch,'One room').click();
  await canvas.focus();await page.keyboard.press('Enter');await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
  await expect(button(sketch,'Add 1 room')).toBeEnabled();
  await expect(sketch.getByText('10.0 m × 1.0 m',{exact:true})).toBeVisible();
  await sketch.getByText('Dimensions & names').click();await sketch.getByLabel('Area depth').fill('4');
  await sketch.getByLabel('Area width').fill('');
  await expect(button(sketch,'Add rooms')).toBeDisabled();
  await sketch.getByLabel('Area width').fill('6');
  await expect(sketch.getByText('1 room proposed · 24.0 m²')).toBeVisible();
  expect(await sketch.evaluate(el=>el.scrollWidth<=el.clientWidth+1 && el.getBoundingClientRect().right<=innerWidth)).toBe(true);
  await page.keyboard.press('Escape');await button(sketch,'Discard sketch').click();
  expect(await savedPlan(page)).toEqual(before);
  await button(page,'Sketch rooms').click();
  await expect(button(sketch,'Add 3 rooms')).toBeEnabled();
});

test('sketching upstairs preserves the occupied floor, existing openings, and other rooms',async({page})=>{
  const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
  const plan={...blankFacility(),buildings:[{id:'b',name:'Studio',height:12,floors:3,openFloors:[2],footprint:rect(0,0,36,18)}],
    rooms:[{id:'r',name:'Room 1',buildingId:'b',level:1,footprint:rect(0,0,8,4),wallHeight:2.8},
      {id:'down',name:'Downstairs',buildingId:'b',level:0,footprint:rect(0,0,36,18),wallHeight:2.8}],
    openings:[{id:'o',name:'Atrium',buildingId:'b',level:1,footprint:rect(10,6,4,4)}]};
  await page.addInitScript(p=>localStorage.setItem('dvr.facility.v1',JSON.stringify(p)),plan);
  await page.goto('/#facility');await page.getByLabel('Jump to facility task').selectOption('2');
  const floor=page.locator('.facility-floor-picker select').nth(1);
  await floor.selectOption('2');await expect(button(page,'Sketch rooms')).toBeDisabled();
  await floor.selectOption('1');await button(page,'Sketch rooms').click();
  const sketch=page.getByRole('dialog',{name:'Room sketch'});await button(sketch,'Add 3 rooms').click();
  const saved=await savedPlan(page);expect(saved.rooms.slice(0,2)).toEqual(plan.rooms);
  for(const r of saved.rooms.slice(2)){expect(r.level).toBe(1);expect(ringsInteriorOverlap(r.footprint,plan.openings[0].footprint)).toBe(false);}
  expect(saved.rooms.slice(2).map(r=>r.name)).toEqual(['Room 2','Room 3','Room 4']);
  expect(saved.rooms.slice(2).reduce((n,r)=>n+polygonArea(r.footprint),0)).toBe(600);
});

test.describe('tracing with a touch screen',()=>{
  test.use({hasTouch:true});
  test('match a private floor image to two landmarks, trace a room and save only the geometry',async({page})=>{
    const sketch=await openBlank(page), canvas=sketch.getByLabel('Room sketch canvas'), file=sketch.getByLabel('Local floor plan image');
    const png=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=200;c.height=100;
      const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,200,100);g.strokeRect(10,10,150,65);
      return c.toDataURL('image/png').split(',')[1];
    });
    const before=await savedPlan(page);
    await file.setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('<svg></svg>')});
    await expect(sketch.getByRole('alert')).toHaveText(/PNG or JPEG/);
    await file.setInputFiles({name:'Private drawing.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await expect(sketch.locator('image')).toHaveCount(1);
    await button(sketch,'Match two landmarks').click();await expect(button(sketch,'Add 3 rooms')).toBeDisabled();
    async function tap(x,y){const p=await planPoint(canvas,x,y);await page.touchscreen.tap(p.x,p.y);}
    await tap(4,4);await tap(4,4);await expect(sketch.getByRole('alert')).toHaveText(/farther/);
    await tap(24,4);await expect(sketch.locator('image')).toHaveCount(0);
    await tap(8,8);await tap(28,8);
    await expect(sketch.getByText(/Manually aligned/)).toBeVisible();
    await expect(sketch.locator('image')).toHaveAttribute('transform',/^matrix\(/);
    expect(await savedPlan(page)).toEqual(before);
    await button(sketch,'One room').click();await tap(8,8);await tap(28,14);
    await button(sketch,'Add 1 room').click();
    const saved=await savedPlan(page);
    expect(saved.rooms).toHaveLength(1);expect(polygonArea(saved.rooms[0].footprint)).toBe(120);
    expect(JSON.stringify(saved)).not.toMatch(/Private drawing|blob:|base64/);
    await button(page,'Sketch rooms').click();await expect(sketch.locator('image')).toHaveCount(0);
  });
});
