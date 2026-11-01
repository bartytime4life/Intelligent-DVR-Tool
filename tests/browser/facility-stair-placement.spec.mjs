import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {blankFacility} from '../../src/facility.mjs';
import {stairAnchors} from '../../src/facility-stair-placement.mjs';
import {savedPlan} from './facility-test-helpers.mjs';
const building={id:'b',name:'Workshop',floors:3,height:9,footprint:[[0,0],[30,0],[30,22],[0,22],[0,0]]};
const makePlan=(floor=0,b=building)=>({...blankFacility(),name:'Stair workshop',buildings:[b],labels:[{id:'pin',name:'West entry',buildingId:'b',x:9,y:7,z:0,level:floor}]});
const btn=(p,name)=>p.getByRole('button',{name,exact:true});
async function open(p,floor=0,b=building){
  await p.addInitScript(plan=>{if(!localStorage.getItem('dvr.facilities.v1'))localStorage.setItem('dvr.facility.v1',JSON.stringify(plan));},makePlan(floor,b));
  await p.goto('/#facility');await p.getByLabel('Jump to facility task').selectOption('2');
  if(floor)await p.getByLabel('Active floor',{exact:true}).selectOption(String(floor));
}
const center=async locator=>{const r=await locator.boundingBox();return [r.x+r.width/2,r.y+r.height/2];};
async function place(p,touch=false) {
  await p.getByRole('checkbox',{name:'Dimensions',exact:true}).uncheck();
  await btn(p,'Place stairs').click();
  const pin=p.locator('.facility-map-label').filter({hasText:/^West entry$/});
  await expect(pin).toBeVisible();await expect(async()=>{const a=await center(pin);await p.waitForTimeout(160);const b=await center(pin);expect(Math.hypot(a[0]-b[0],a[1]-b[1])).toBeLessThan(.2);}).toPass({timeout:5000});
  const [x,y]=await center(pin);
  if(touch)await p.touchscreen.tap(x,y);else await p.mouse.click(x,y);
  await expect(btn(p,'Move stair start')).toBeVisible();
}
async function drag(p,el,dx,dy,cancel=false) {
  const [x,y]=await center(el);await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y+dy,{steps:8});
  if(cancel)await p.keyboard.press('Escape');await p.mouse.up();
}
const near=(actual,expected,tolerance)=>expect(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])).toBeLessThan(tolerance);

test('click the start, choose a floor, drag and rotate around the landing, save one edit and reopen it',async({page},info)=>{
  test.setTimeout(55000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
  const before=await savedPlan(page);await place(page);
  const move=btn(page,'Move stair start'),turn=btn(page,'Rotate stairs around start'),start=await center(move);
  await page.getByLabel('Stair destination on map',{exact:true}).selectOption('2');
  near(await center(move),start,1);await expect(page.locator('.facility-stair-summary')).toContainText('6 m up');
  await drag(page,move,28,-6);const moved=await center(move);near(moved,[start[0]+28,start[1]-6],2);
  const end=await center(turn),dx=end[0]-moved[0],dy=end[1]-moved[1];
  await drag(page,turn,-dy-dx,dx-dy);near(await center(move),moved,1);
  const afterTurn=await center(turn);expect(Math.hypot(afterTurn[0]-end[0],afterTurn[1]-end[1])).toBeGreaterThan(35);
  await drag(page,move,-30,10,true);near(await center(move),moved,1);expect(await savedPlan(page)).toEqual(before);
  await expect(page.getByText('Save or discard your preview before selecting another item.',{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('stair-placement.png')});
  await btn(page,'Save stair on map').click();const saved=await savedPlan(page);expect(saved.stairs).toHaveLength(1);
  const stair=saved.stairs[0];expect(stair).toMatchObject({fromLevel:0,toLevel:2,risers:34});expect(stair.bearing).toBeCloseTo(90,0);
  expect(saved.openings).toEqual([]);expect(saved.labels).toEqual(before.labels);
  await btn(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);await btn(page,'Redo edit').click();expect(await savedPlan(page)).toEqual(saved);
  const download=page.waitForEvent('download');await btn(page,'Export plan').click();expect(JSON.parse(await readFile(await (await download).path(),'utf8'))).toEqual(saved);
  await page.reload();await page.getByLabel('Jump to facility task').selectOption('2');
  await page.getByRole('region',{name:'Stair planning'}).getByRole('button',{name:/Straight stair/}).click();
  await expect(move).toBeVisible();await turn.press('ArrowLeft');await btn(page,'Save stair on map').click();
  const edited=(await savedPlan(page)).stairs[0];near(stairAnchors(edited,building)[0],stairAnchors(stair,building)[0],1e-6);
  expect(edited.bearing).toBeCloseTo(stair.bearing-5,2);await btn(page,'3D').click();await expect(move).toHaveCount(0);expect(errors).toEqual([]);
});

test('a one-floor plan can add a destination and position stairs without graphics; invalid fit blocks save',async({page})=>{
  await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...args){return /webgl/i.test(t)?null:get.call(this,t,...args);};});
  await open(page,0,{...building,height:3,floors:1});
  await btn(page,'Add destination level').click();expect((await savedPlan(page)).buildings[0].floors).toBe(2);
  await btn(page,'Suggest a position').click();await page.getByText('Stair dimensions & position',{exact:true}).click();
  const east=page.getByLabel('Stair east (m)',{exact:true}),original=await east.inputValue();await east.fill('-10');
  await expect(btn(page,'Save stair')).toBeDisabled();expect((await savedPlan(page)).stairs).toHaveLength(0);
  await east.fill(original);await btn(page,'Turn 90°').click();await btn(page,'Save stair').click();
  expect((await savedPlan(page)).stairs[0]).toMatchObject({fromLevel:0,toLevel:1,bearing:90});
});

test.describe('touch stairs',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test('tap on the top floor, choose downstairs, rotate by touch and save on the map',async({page,context})=>{
    test.setTimeout(50000);await open(page,2);await place(page,true);await page.getByLabel('Stair destination on map').selectOption('0');
    const turn=btn(page,'Rotate stairs around start'),[x,y]=await center(turn),[sx,sy]=await center(btn(page,'Move stair start'));
    const dx=x-sx,dy=y-sy,client=await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=6;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(-dx-dy)*i/6,y:y+(dx-dy)*i/6}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await btn(page,'Save stair on map').tap();
    const saved=await savedPlan(page),stair=saved.stairs[0];expect(stair).toMatchObject({fromLevel:2,toLevel:0});expect(stair.bearing).toBeCloseTo(270,-1);
    near(stairAnchors(stair,building)[0],[9,7],.4);expect(saved.openings).toEqual([]);
  });
});
