import test from 'node:test';
import assert from 'node:assert/strict';
import {blankFacility,validateFacility,parseFacility,copyRoomsToNextLevel,applyBuildingEdit,reoriginPlan,wallObstacles} from '../src/facility.mjs';
import {rotateShape} from '../src/facility-shape-edit.mjs';
import {exteriorWindowWalls,windowWall,windowSegment,placeWindow,moveWindow,resizeWindow,cutWallPieces} from '../src/facility-windows.mjs';
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const building={id:'b',name:'Studio',height:7,base:1,floors:2,footprint:rect(0,0,12,8)};
const plan={...blankFacility(),buildings:[building],rooms:[{id:'r',name:'Office',buildingId:'b',level:0,wallHeight:2.8,footprint:rect(0,0,6,8)}]};
const wall=exteriorWindowWalls(building,0)[0];
const w=placeWindow(plan,wall,[4,-1],{id:'w',name:'South window',width:2,height:1.2,sill:.9});
const complete=()=>validateFacility({...plan,windows:[w]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} expected ${b}`);

test('outside wall spans fold collinear vertices across the ring seam; courtyards, rotated walls and empty interiors work',()=>{
  const b={...building,footprint:[[5,0],[12,0],[12,8],[0,8],[0,0],[5,0]],holes:[rect(3,3,3,3)]};
  const walls=exteriorWindowWalls(b,0);assert.equal(walls.length,8);
  assert.ok(walls.some(v=>JSON.stringify(v.points)===JSON.stringify([[0,0],[12,0]])));
  assert.ok(walls.some(w=>w.name.startsWith('Courtyard 1')));
  assert.equal(windowWall(plan,{...w,x:6,y:4}),null);
  validateFacility({...plan,rooms:[],buildings:[b],windows:[w]});
  const turned=validateFacility(applyBuildingEdit(complete(),rotateShape(building,37)));
  assert.ok(windowWall(turned,turned.windows[0]));
});
test('placement finds a free span; moving and resizing stop at neighbors and corners, keeping the opposite end fixed',()=>{
  const other={...w,id:'other',x:8},p={...plan,windows:[other,w]};
  near(placeWindow(p,wall,[100,-9],{...w,id:'third'}).x,11);
  near(moveWindow(p,wall,w,[100,0]).x,6);
  const bigger=resizeWindow(p,wall,w,'end',[100,-5]);near(bigger.x,5);near(bigger.width,4);
  assert.deepEqual(windowSegment(bigger,wall),[[3,0],[7,0]]);
  const small=resizeWindow(p,wall,w,'start',[12,0]);near(small.width,.3);near(windowSegment(small,wall)[1][0],5);
  const left=resizeWindow(p,wall,w,'start',[-50,0]);near(windowSegment(left,wall)[0][0],0);
  assert.throws(()=>validateFacility({...p,windows:[w,{...other,x:5}]}),/overlaps/);
});
test('window geometry respects sill, head and pane direction; glazing does not enlarge camera estimates',()=>{
  const cut={...w,segment:windowSegment(w,wall)},pieces=cutWallPieces(building.footprint,3,[cut]);
  const across=pieces.filter(p=>p.points[0][0]===3 && p.points[1][0]===5);
  assert.deepEqual(across.map(p=>[p.base,p.top]),[[0,.9],[2.1,3]]);
  assert.deepEqual(cutWallPieces([[4,0],[4,5]],3,[cut]),[{points:[[4,0],[4,5]],base:0,top:3}]);
  assert.deepEqual(wallObstacles(complete()),wallObstacles(plan));
  for(const invalid of [{sill:-.1},{sill:2,height:1.4},{height:0},{x:1,y:1},{level:2},{width:10,x:1}])
    assert.throws(()=>validateFacility({...plan,windows:[{...w,...invalid}]}),/Window/);
});
test('v5 round trips windows, imports older formats, rejects downgrades, and carries floor/origin edits',()=>{
  const p=complete();assert.deepEqual(parseFacility(JSON.stringify(p)),p);
  for(const v of [1,2,3,4])assert.throws(()=>validateFacility({...p,schema:'intelligent-dvr.facility.v'+v}),/Windows require facility v5/);
  for(const v of [1,2,3,4])assert.equal(validateFacility({...blankFacility(),schema:'intelligent-dvr.facility.v'+v}).schema,p.schema);
  const moved=validateFacility(reoriginPlan(p,[p.origin[0]+.0001,p.origin[1]-.0001]));assert.ok(windowWall(moved,moved.windows[0]));
  const copy=copyRoomsToNextLevel(p,'b',0);assert.equal(copy.windows.length,2);assert.notEqual(copy.windows[0].id,copy.windows[1].id);assert.equal(copy.windows[1].level,1);
  assert.throws(()=>applyBuildingEdit(copy,{...building,floors:1}),/window/);
  assert.throws(()=>validateFacility({...p,buildings:[{...building,footprint:rect(0,-1,12,9)}]}),/outside wall/);
});
