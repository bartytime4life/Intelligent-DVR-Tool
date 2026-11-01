import {test,expect} from '@playwright/test';
import {blankFacility,polygonArea} from '../../src/facility.mjs';
import {savedPlan} from './facility-test-helpers.mjs';

const button=(root,name)=>root.getByRole('button',{name,exact:true});
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const building={id:'shop',name:'Workshop',height:8,floors:2,footprint:rect(0,0,24,12)};
const room=(id,name,footprint,level=0)=>({id,name,buildingId:'shop',level,wallHeight:2.6,footprint});
const plan={...blankFacility(),buildings:[building],rooms:[room('a','Assembly',rect(0,0,12,12)),room('b','Packing',rect(12,0,12,12)),room('c','Upstairs',rect(0,0,24,12),1)]};

async function openFloor(page) {
  await page.addInitScript(facility=>localStorage.setItem('dvr.facility.v1',JSON.stringify(facility)),plan);
  await page.goto('/#facility');
  await page.getByLabel('Jump to facility task').selectOption('2');
}
const wallDialog=page=>page.getByRole('dialog',{name:'Edit room walls'});

test('a room split preserves named previews across tools, accepts exact feet and saves as one undoable edit',async({page})=>{
  await openFloor(page);
  const before=await savedPlan(page);
  await button(page,'Packing').click();
  await button(page,'Edit room walls').click();
  const editor=wallDialog(page);
  await expect(editor.getByRole('combobox',{name:'Room',exact:true})).toHaveValue('b');
  await editor.getByRole('combobox',{name:'Units',exact:true}).selectOption('imperial');
  await button(editor,'Turn 90°').click();
  await editor.getByLabel('Distance from top').fill('8');
  await editor.getByLabel('New room name').fill('Dispatch');
  await button(editor,'Move shared wall').click();
  await button(editor,'Split room').click();
  await expect(editor.getByLabel('New room name')).toHaveValue('Dispatch');
  await page.keyboard.press('Escape');await button(editor,'Keep editing').click();
  await expect(editor.getByLabel('Distance from top')).toHaveValue('8');
  expect(await savedPlan(page)).toEqual(before);
  await button(editor,'Save split').click();await expect(editor).toHaveCount(0);
  const saved=await savedPlan(page);
  expect(saved.rooms).toHaveLength(4);
  expect(polygonArea(saved.rooms[1].footprint)).toBeCloseTo(12*8*.3048,6);
  expect(saved.rooms[1].id).toBe('b');expect(saved.rooms.at(-1).name).toBe('Dispatch');
  expect(saved.rooms.at(-1).wallHeight).toBe(2.6);expect(saved.rooms[2]).toEqual(before.rooms[2]);
  await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
  await button(page,'Redo edit').click();expect(await savedPlan(page)).toEqual(saved);
});

test.describe('touch wall editing',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true});
  test('move the shared divider on the plan, merge, and restore each operation independently',async({page})=>{
    await openFloor(page);const before=await savedPlan(page);
    await button(page,'Edit room walls').click();const editor=wallDialog(page);
    await button(editor,'Move shared wall').click();await expect(button(editor,'Save wall position')).toBeDisabled();
    const slider=editor.getByRole('slider',{name:'Wall position on the plan'});await slider.scrollIntoViewIfNeeded();
    const point=await slider.evaluate(svg=>{const p=new DOMPoint(15,6).matrixTransform(svg.getScreenCTM());return {x:p.x,y:p.y};});
    await page.touchscreen.tap(point.x,point.y);
    await expect(editor.getByLabel('Distance from left')).toHaveValue('15');
    await slider.focus();await page.keyboard.press('Shift+ArrowRight');
    await expect(editor.getByLabel('Distance from left')).toHaveValue('16');
    expect(await savedPlan(page)).toEqual(before);
    await button(editor,'Save wall position').click();
    const moved=await savedPlan(page);
    expect(moved.rooms.map(r=>polygonArea(r.footprint))).toEqual([192,96,288]);
    expect(moved.rooms.map(r=>r.id)).toEqual(['a','b','c']);
    await button(page,'Edit room walls').click();await button(editor,'Merge rooms').click();
    await expect(editor.getByText('The combined room keeps the name Assembly.')).toBeVisible();
    await button(editor,'Save merged room').click();await expect(editor).toHaveCount(0);
    const merged=await savedPlan(page);expect(merged.rooms.map(r=>r.id)).toEqual(['a','c']);
    expect(polygonArea(merged.rooms[0].footprint)).toBe(288);
    await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(moved);
    await button(page,'Undo edit').click();expect(await savedPlan(page)).toEqual(before);
  });
});
