import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {blankFacility} from '../../src/facility.mjs';
import {savedPlan} from './facility-test-helpers.mjs';
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const fixture={...blankFacility(),name:'Workshop',buildings:[{id:'b',name:'Studio',height:6,floors:2,footprint:rect(0,0,12,8)}],
  rooms:[{id:'r',name:'Office',buildingId:'b',level:0,wallHeight:2.8,footprint:rect(0,0,6,8)}],
  labels:[{id:'fixture-pin',name:'South facade',buildingId:'b',level:0,x:6,y:0,z:0}]};
const btn=(page,name)=>page.getByRole('button',{name,exact:true});
const value=async(page,name)=>+await page.getByLabel(name,{exact:true}).inputValue();
async function open(page,seed=fixture){
  await page.addInitScript(p=>{if(!localStorage.getItem('dvr.facilities.v1'))localStorage.setItem('dvr.facility.v1',JSON.stringify(p));},seed);
  await page.goto('/#facility');await page.getByLabel('Jump to facility task').selectOption('2');
}
async function drag(page,locator,dx,dy,cancel=false){
  await locator.scrollIntoViewIfNeeded();const r=await locator.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:5});
  if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
}
async function fallback(page){await page.getByText('Choose a wall by name',{exact:true}).click();await btn(page,'Place on selected wall').click();}
async function metrics(page){await page.getByText('Window measurements & name',{exact:true}).click();}

test('click an exterior wall, move and resize both ends, set elevation, save, export and undo',async({page},info)=>{
  test.setTimeout(55000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page);const before=await savedPlan(page);
  await btn(page,'Office').click();await page.getByRole('checkbox',{name:'Dimensions',exact:true}).uncheck();
  await btn(page,'Place window').click();
  const reference=page.locator('.facility-map-label').filter({hasText:/^South facade$/});
  await expect(reference).toBeVisible();await expect(async()=>{const a=await reference.boundingBox();await page.waitForTimeout(150);const b=await reference.boundingBox();expect(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)).toBeLessThan(.2);}).toPass({timeout:4000});
  const r=await reference.boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
  const move=btn(page,'Move window along wall'),end=btn(page,'Resize window end'),start=btn(page,'Resize window start');
  await expect(move).toBeVisible();await metrics(page);
  const x0=await value(page,'Window center along wall');expect(x0).toBeCloseTo(6,0);
  await drag(page,move,36,12);const x1=await value(page,'Window center along wall');expect(x1).toBeGreaterThan(x0+.5);
  await drag(page,end,40,9);const w1=await value(page,'Window width'),x2=await value(page,'Window center along wall');
  expect(w1).toBeGreaterThan(2);expect(x2-w1/2).toBeCloseTo(x1-.75,2);
  await drag(page,start,-24,0);const w2=await value(page,'Window width'),x3=await value(page,'Window center along wall');
  expect(w2).toBeGreaterThan(w1+.2);expect(x3+w2/2).toBeCloseTo(x2+w1/2,2);
  await drag(page,end,-25,0,true);expect(await value(page,'Window width')).toBe(w2);
  await drag(page,btn(page,'Resize window height'),0,-9);expect(await value(page,'Window height')).toBeGreaterThan(1.35);
  expect(await savedPlan(page)).toEqual(before);
  await metrics(page);await btn(page,'Save window').click();const saved=await savedPlan(page);
  expect(saved.windows).toHaveLength(1);expect(saved.windows[0].y).toBeCloseTo(0,4);expect(saved.windows[0].width).toBeCloseTo(w2,3);expect(saved.rooms).toEqual(before.rooms);
  await page.screenshot({path:info.outputPath('window-editor.png')});
  await btn(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
  await btn(page,'Redo edit').click();expect(await savedPlan(page)).toEqual(saved);
  await btn(page,'3D').click();await expect(btn(page,'3D')).toHaveAttribute('aria-pressed','true');
  await expect(btn(page,'Move window along wall')).toHaveCount(0);
  // Record the finished facade after the floor-to-3D camera transition.
  await page.waitForTimeout(450);await page.screenshot({path:info.outputPath('window-3d.png')});
  const download=page.waitForEvent('download');await btn(page,'Export plan').click();
  expect(JSON.parse(await readFile(await (await download).path(),'utf8'))).toEqual(saved);
  await page.reload();await page.getByLabel('Jump to facility task').selectOption('2');
  const savedRow=page.getByRole('region',{name:'Windows',exact:true}).getByRole('button',{name:/^Window .*wide$/});await savedRow.click();await expect(move).toBeVisible();
  expect(await savedPlan(page)).toEqual(saved);expect(errors).toEqual([]);
});

test('without graphics, place on an empty upper floor and edit width and sill in feet',async({page})=>{
  await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:get.call(this,type,...args);};});
  await open(page,{...fixture,schema:'intelligent-dvr.facility.v4',rooms:[],windows:undefined});
  await page.getByLabel('Active floor').selectOption('1');await expect(btn(page,'Place window')).toBeDisabled();
  await fallback(page);await metrics(page);await page.getByLabel('Measurement units',{exact:true}).selectOption('imperial');
  await page.getByLabel('Window width',{exact:true}).fill('4');await page.getByLabel('Sill above floor',{exact:true}).fill('3');
  await page.getByLabel('Window height',{exact:true}).fill('99');await expect(btn(page,'Save window')).toBeDisabled();
  await page.getByLabel('Window height',{exact:true}).fill('4');await btn(page,'Save window').click();
  const saved=await savedPlan(page);expect(saved.windows[0]).toMatchObject({level:1,width:1.2192,height:1.2192,sill:.9144});
  await page.getByLabel('Active floor').selectOption('0');await expect(page.getByRole('button',{name:/^Remove window/})).toHaveCount(0);
  await page.getByLabel('Active floor').selectOption('1');await page.getByRole('region',{name:'Windows',exact:true}).getByRole('button',{name:/^Window .*wide$/}).click();
  await page.getByRole('button',{name:/^Remove window/}).click();expect((await savedPlan(page)).windows).toEqual([]);
  await btn(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(saved);
});

test.describe('touch window editing',()=>{
  test.use({hasTouch:true,viewport:{width:390,height:844}});
  test('touch-resize a window, nudge its center, then place a second one',async({page,context})=>{
    await open(page);await expect(btn(page,'Place window')).toBeEnabled();await fallback(page);await metrics(page);
    const end=btn(page,'Resize window end'),move=btn(page,'Move window along wall');
    await end.scrollIntoViewIfNeeded();await expect(async()=>{const a=await end.boundingBox();await page.waitForTimeout(150);const b=await end.boundingBox();expect(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)).toBeLessThan(.2);}).toPass({timeout:4000});
    const r=await end.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2,client=await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=5;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+6*i,y}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    expect(await value(page,'Window width')).toBeGreaterThan(1.8);
    const initial=await value(page,'Window center along wall');await move.press('ArrowRight');expect(await value(page,'Window center along wall')).toBeCloseTo(initial+.1,2);
    await btn(page,'Save window on map').click();await btn(page,'Place another window on map').click();
    await expect(page.getByText('Click a highlighted outside wall.',{exact:true})).toBeVisible();
    await fallback(page);await btn(page,'Save window').click();expect((await savedPlan(page)).windows.length).toBe(2);
  });
});
