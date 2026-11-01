import test from 'node:test';
import assert from 'node:assert/strict';
import {blankFacility,validateFacility,parseFacility,wallObstacles,seesPoint,copyRoomsToNextLevel,applyBuildingEdit,reoriginPlan} from '../src/facility.mjs';
import {sharedRoomWalls,placeDoorway,doorwayWall,roomWallPieces} from '../src/facility-doorways.mjs';
import {prepareWallEdit,previewWallEdit,applyWallEdit} from '../src/facility-room-walls.mjs';
import {rotateShape} from '../src/facility-shape-edit.mjs';

const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const room=(id,footprint)=>({id,name:id,buildingId:'b',level:0,wallHeight:2.8,footprint});
const building={id:'b',name:'Workshop',height:6,floors:2,footprint:rect(0,0,12,8)};
const first=room('Office',rect(0,0,6,8)),second=room('Store',rect(6,0,6,8));
const plan={...blankFacility(),buildings:[building],rooms:[first,second]};
const wall=sharedRoomWalls(first,second)[0];
const door=placeDoorway(plan,wall,[6,4],{id:'d',name:'Passage',width:.9,height:2.1});
const complete=()=>validateFacility({...plan,doorways:[door]});

test('shared walls combine collinear subdivisions and exclude overlaps, corner touches and other levels',()=>{
  const subdivided={...first,footprint:[[0,0],[6,0],[6,3],[6,8],[0,8],[0,0]]};
  assert.deepEqual(sharedRoomWalls(subdivided,second)[0].points,[[6,0],[6,8]]);
  assert.equal(sharedRoomWalls(first,room('overlap',rect(0,0,6,4))).length,0);
  assert.equal(sharedRoomWalls(first,room('corner',rect(6,8,2,2))).length,0);
  assert.equal(sharedRoomWalls(first,{...second,level:1}).length,0);
  const rad=.37,turn=([x,y])=>[100+x*Math.cos(rad)-y*Math.sin(rad),200+x*Math.sin(rad)+y*Math.cos(rad)];
  const rotated=plan.rooms.map(r=>({...r,footprint:r.footprint.map(turn)}));
  const boundary=sharedRoomWalls(...rotated)[0];
  assert.ok(Math.abs(Math.hypot(boundary.points[1][0]-boundary.points[0][0],boundary.points[1][1]-boundary.points[0][1])-8)<1e-8);
});
test('placement clamps at wall ends, avoids another doorway, and validates before serialization',()=>{
  assert.equal(placeDoorway(plan,wall,[100,-5],door).y,.45);
  assert.equal(placeDoorway(plan,wall,[100,15],door).y,7.55);
  const next=placeDoorway(complete(),wall,[6,4],{...door,id:'d2'});
  assert.ok(Math.abs(next.y-4)>=.9-1e-8);
  const saved=validateFacility({...complete(),doorways:[door,next]});
  assert.deepEqual(parseFacility(JSON.stringify(saved)),saved);
  for(const bad of [{width:20},{height:3},{roomIds:['Office','Office']},{x:5},{roomIds:['Office','missing']}])
    assert.throws(()=>validateFacility({...plan,doorways:[{...door,...bad}]}),/Doorway/i);
  assert.throws(()=>validateFacility({...plan,doorways:[door,{...door,id:'d2'}]}),/overlap/);
  for(const version of ['v1','v2','v3']) assert.throws(()=>validateFacility({...saved,schema:'intelligent-dvr.facility.'+version}),/require facility v4/);
  for(const version of ['v1','v2','v3']) assert.equal(validateFacility({...plan,schema:'intelligent-dvr.facility.'+version}).schema,'intelligent-dvr.facility.v6');
});
test('a doorway opens both room walls below its lintel and cannot cross a floor void',()=>{
  const p=complete(), camera={id:'c',name:'c',x:3,y:4,z:1,bearing:90,tilt:30,hfov:60,vfov:80,range:20,enabled:true};
  assert.equal(seesPoint(camera,[9,4],wallObstacles(plan)),false);
  assert.equal(seesPoint(camera,[9,4],wallObstacles(p)),true);
  assert.equal(seesPoint({...camera,z:5},[9,4],wallObstacles(p)),false);
  assert.equal(seesPoint({...camera,y:2},[9,2],wallObstacles(p)),false);
  const parts=roomWallPieces(first,p.doorways);
  assert.ok(parts.some(part=>part.base===2.1 && part.top===2.8));
  const voidPlan={...p,openings:[{id:'o',name:'Void',buildingId:'b',level:0,footprint:rect(5,3,2,2)}]};
  assert.throws(()=>validateFacility(voidPlan),/floor opening/);
});
test('doors follow shared-wall movement, room splitting, merging and rigid building motion',()=>{
  let p=complete(), edit=prepareWallEdit(p,p.rooms[0],'move',p.rooms[1]),parts=previewWallEdit(edit,'x',8);
  p=validateFacility(applyWallEdit(p,edit,parts));
  assert.ok(Math.abs(p.doorways[0].x-8)<1e-8);assert.equal(p.doorways[0].id,'d');
  edit=prepareWallEdit(p,p.rooms[0],'split');parts=previewWallEdit(edit,'x',4);
  p=validateFacility(applyWallEdit(p,edit,parts,'New office',()=>'new'));
  assert.deepEqual([...p.doorways[0].roomIds].sort(),['Store','new']);
  const turned=validateFacility(applyBuildingEdit(p,rotateShape(p.buildings[0],90)));
  assert.ok(doorwayWall(turned,turned.doorways[0]));
  const shifted=validateFacility(reoriginPlan(p,[p.origin[0]+.00005,p.origin[1]+.00005]));
  assert.ok(doorwayWall(shifted,shifted.doorways[0]));
  edit=prepareWallEdit(p,p.rooms.find(r=>r.id==='new'),'merge',p.rooms[1]);parts=previewWallEdit(edit,'x',0);
  const merged=validateFacility(applyWallEdit(p,edit,parts));
  assert.deepEqual(merged.doorways,[]);
});
test('floor copying duplicates doorways with new IDs and room references',()=>{
  const p=complete(),copy=copyRoomsToNextLevel(p,'b',0);
  assert.equal(copy.doorways.length,2);
  const upper=copy.doorways[1];
  assert.equal(upper.level,1);assert.notEqual(upper.id,door.id);
  assert.ok(upper.roomIds.every(id=>copy.rooms.some(r=>r.id===id && r.level===1)));
  assert.deepEqual(copy.doorways[0],door);validateFacility(copy);
});
