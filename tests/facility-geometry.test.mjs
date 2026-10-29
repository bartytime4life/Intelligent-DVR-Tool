import test from 'node:test';
import assert from 'node:assert/strict';
import {blankFacility,validateFacility,parseFacility,buildingArea,buildingFeature,transformBuilding,wallObstacles,seesPoint,toLngLat,SCHEMA} from '../src/facility.mjs';
import {parseOsmBuildings,searchBounds,polygonAreaSelection,parseAreaVertices,osmQuery} from '../src/facility-starter.mjs';
const box=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const origin=[-98,38.5], bounds=searchBounds(origin,0,0,250,250);
const geo=r=>r.map(p=>{const [lon,lat]=toLngLat(p,origin);return {lon,lat};});
const member=(r,role='outer',ref=1)=>({type:'way',ref,role,geometry:geo(r)});
const courtyard={type:'relation',id:100,tags:{type:'multipolygon',building:'yes',height:'12','building:levels':'3'},members:[member(box(-30,-30,60,60)),member(box(-10,-10,20,20),'inner',2)]};
const parse=elements=>parseOsmBuildings({elements},origin,bounds,'2026-10-28T00:00:00Z');
const shell={id:'b',name:'Courtyard',footprint:box(-30,-30,60,60),holes:[box(-10,-10,20,20)],height:12,base:2,floors:3};

test('v2 preserves holes/base/part and upgrades ordinary v1 without allowing a geometry downgrade',()=>{
  const plan={...blankFacility(),buildings:[{...shell,part:true}]};
  assert.deepEqual(parseFacility(JSON.stringify(plan)),plan);
  assert.equal(validateFacility({...blankFacility(),schema:'intelligent-dvr.facility.v1'}).schema,SCHEMA);
  assert.throws(()=>validateFacility({...plan,schema:'intelligent-dvr.facility.v1'}),/require facility v2/);
  assert.equal(buildingArea(shell),3200);
  const feature=buildingFeature(shell,origin,{base:2,top:12});
  assert.equal(feature.geometry.coordinates.length,2);assert.equal(feature.properties.base,2);
});
test('invalid courtyard topology, including enclosing a hole with a room, is rejected atomically',()=>{
  for(const holes of [[box(-30,-10,10,10)],[box(50,50,10,10)],[box(-10,-10,20,20),box(-5,-5,5,5)],[box(-10,-10,20,20),box(0,0,15,15)],null]){
    assert.throws(()=>validateFacility({...blankFacility(),buildings:[{...shell,holes}]}));
  }
  for(const footprint of [box(-15,-15,30,30),box(-5,-5,5,5),box(-20,-5,15,10)]){
    assert.throws(()=>validateFacility({...blankFacility(),buildings:[shell],rooms:[{id:'r',name:'Room',buildingId:'b',level:0,wallHeight:2.8,footprint}]}),/Rooms/);
  }
  for(const base of [-1,12,Infinity,'2'])assert.throws(()=>validateFacility({...blankFacility(),buildings:[{...shell,base}]}));
});
test('courtyard translations/resizes keep all rings aligned and room edits remain validated',()=>{
  const moved=transformBuilding(shell,([x,y])=>[x+100,y+50]);
  assert.deepEqual(moved.holes[0][0],[90,40]);assert.equal(buildingArea(moved),3200);
  const resized=transformBuilding(shell,([x,y])=>[x*2,y]);assert.equal(buildingArea(resized),6400);
  assert.deepEqual(shell.holes[0][0],[-10,-10]);
});
test('coverage uses inner walls and permits rays below raised bases',()=>{
  const camera={id:'c',name:'Camera',x:0,y:0,z:4,bearing:0,tilt:25,hfov:90,vfov:60,range:60,enabled:true};
  const ground={...shell,base:0};
  assert.equal(seesPoint(camera,[0,8],wallObstacles({...blankFacility(),buildings:[ground],rooms:[]})),true);
  assert.equal(seesPoint(camera,[0,20],wallObstacles({...blankFacility(),buildings:[ground],rooms:[]})),false);
  assert.equal(seesPoint(camera,[0,20],wallObstacles({...blankFacility(),buildings:[{...shell,base:5}],rooms:[]})),true);
  const room={id:'r',name:'Raised room',buildingId:'b',level:1,wallHeight:2,footprint:box(-25,-25,8,8)};
  const walls=wallObstacles({...blankFacility(),buildings:[shell],rooms:[room]});assert.equal(walls.at(-1).base,2+10/3);
});
test('complete courtyard relations assemble split inner rings and retain source/export',()=>{
  const inner=box(-10,-10,20,20), r={...courtyard,members:[courtyard.members[0],member(inner.slice(0,3),'inner',2),member([...inner.slice(2)].reverse(),'inner',3)]};
  const result=parse([r]);assert.equal(result.buildings.length,1);assert.equal(result.buildings[0].holes.length,1);
  const plan=validateFacility({...blankFacility(),buildings:result.buildings});assert.equal(plan.buildings[0].source.id,'relation/100');assert.equal(buildingArea(plan.buildings[0]),3200);
  assert.equal(buildingFeature(plan.buildings[0],origin).geometry.coordinates.length,2);
  const incomplete={...r,members:r.members.slice(0,2)};assert.equal(parse([incomplete]).buildings.length,0);
});
test('independent parts preserve raised bases; conflicting envelopes/parts are excluded together',()=>{
  const way=(id,r,tags)=>({type:'way',id,geometry:geo(r),tags});
  const part=way(2,box(-10,-10,20,20),{'building:part':'yes',height:'12',min_height:'4','building:levels':'4','building:min_level':'1'});
  const accepted=parse([part]).buildings[0];assert.equal(accepted.part,true);assert.equal(accepted.base,4);assert.equal(accepted.floors,3);
  const overlap=parse([way(1,box(-30,-30,60,60),{building:'yes'}),part]);
  assert.equal(overlap.buildings.length,0);assert.equal(overlap.reasons['overlapping part or envelope requires decomposition'],2);
  const invalid={...part,tags:{...part.tags,min_height:'12'}};assert.equal(parse([invalid]).buildings.length,0);
});
test('custom AOI filters the enclosing rectangle while retaining whole intersecting shells',()=>{
  const ring=parseAreaVertices('-100,-100\n100,-100\n-100,100'),selection=polygonAreaSelection(origin,ring);
  const way=(id,r)=>({type:'way',id,tags:{building:'yes'},geometry:geo(r)});
  const result=parseOsmBuildings({elements:[way(1,box(60,60,10,10)),way(2,box(-50,-50,10,10)),way(3,box(-10,-10,30,30))]},origin,selection.bounds,undefined,ring);
  assert.deepEqual(result.buildings.map(b=>b.id),['osm-way-2','osm-way-3']);assert.equal(result.buildings[1].crossing,true);
  for(const text of ['0,0\n600,0\n0,600','0,0\n1,0\n0,1','0,0\nfoo,20','0,0\n100,100\n0,100\n100,0'])assert.throws(()=>polygonAreaSelection(origin,parseAreaVertices(text)));
  assert.match(osmQuery(selection.bounds),/building:part/);
});
