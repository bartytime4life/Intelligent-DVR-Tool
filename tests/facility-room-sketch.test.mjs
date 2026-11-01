import test from 'node:test';
import assert from 'node:assert/strict';
import {blankFacility,validateFacility,ringsInteriorOverlap} from '../src/facility.mjs';
import {sketchFloor,sketchRooms,roomAdditions,freeAfterDrafts,snapSketchPoint} from '../src/facility-room-sketch.mjs';
import {stairFootprint} from '../src/facility-stairs.mjs';

const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const b={id:'b',name:'Workshop',height:9,floors:3,footprint:rect(0,0,36,18)};
const plan={...blankFacility(),buildings:[b]};
const draw=(f,opts={})=>sketchRooms({floor:f,free:f.free,box:f.frame.box,mode:'row',count:3,across:false,hall:2,prefix:'Lab',usedNames:[],capacity:500,...opts});
function nonoverlap(rooms,obstacles=[]){
  rooms.forEach((room,i)=>[...obstacles,...rooms.slice(0,i).map(r=>r.footprint)].forEach(o=>assert.equal(ringsInteriorOverlap(o,room.footprint),false)));
}
const area=rooms=>rooms.reduce((sum,r)=>sum+r.area,0);
test('both hallway orientations leave the exact strip clear and save valid rooms on a rotated floor',()=>{
  const rad=.39,rotate=([x,y])=>[820+x*Math.cos(rad)-y*Math.sin(rad),-135+y*Math.cos(rad)+x*Math.sin(rad)];
  const building={...b,footprint:b.footprint.map(rotate)}, current={...plan,buildings:[building]}, f=sketchFloor(current,building,1);
  for (const across of [true,false]){
    const {rooms}=draw(f,{mode:'hall',across,usedNames:['Lab 1','Lab 4']});
    assert.equal(rooms.length,6);
    assert.equal(rooms[0].name,'Lab 2');assert.equal(rooms[2].name,'Lab 5');
    assert.ok(Math.abs(area(rooms)-(36*18-2*(across?18:36)))<1e-6);
    nonoverlap(rooms);
    let id=0;const additions=roomAdditions(current,building,1,rooms,()=>String(++id));
    const saved=validateFacility({...current,rooms:additions});assert.deepEqual(saved.rooms,additions);
  }
});
test('concave shells trim and separate disconnected parts rather than bridge the gap',()=>{
  const building={...b,footprint:[[0,0],[30,0],[30,20],[20,20],[20,8],[10,8],[10,20],[0,20],[0,0]]};
  const f=sketchFloor(plan,building,0);
  const {rooms}=draw(f,{mode:'single',box:{x:0,y:0,w:30,h:10}});
  assert.equal(rooms.length,2);assert.equal(area(rooms),200);nonoverlap(rooms);
});
test('courtyards, floor-specific reservations and both stair landings stay clear',()=>{
  const building={...b,holes:[rect(10,3,3,2)]}, openings=[{id:'o',name:'Void',buildingId:'b',level:1,footprint:rect(23,5,4,4)}];
  const room={id:'r',name:'Office',buildingId:'b',level:1,footprint:rect(0,0,4,3),wallHeight:2.8};
  const stair={id:'s',name:'Stair',buildingId:'b',fromLevel:0,toLevel:1,x:12,y:13,width:1,tread:.3,risers:12,bearing:90,landing:1};
  const p=validateFacility({...plan,buildings:[building],rooms:[room],openings,stairs:[stair]});
  const f=sketchFloor(p,building,1), draft=draw(f);
  assert.equal(draft.enclosed,0);assert.equal(draft.rooms.length,3);
  nonoverlap(draft.rooms,[...building.holes,room.footprint,openings[0].footprint,stairFootprint(stair,building)]);
  assert.ok(Math.abs(area(draft.rooms)-(648-6-12-16-5.3))<1e-7);
  assert.equal(draw(sketchFloor(p,building,2)).rooms.reduce((a,r)=>a+r.area,0),642);
  assert.ok(Math.abs(area(draw(sketchFloor(p,building,0)).rooms)-(642-5.3))<1e-7);
  assert.deepEqual(p.rooms,[room]);
});
test('a room cannot silently enclose an opening; a kept group also reserves its space',()=>{
  const building={...b,holes:[rect(5,5,3,3)]}, f=sketchFloor(plan,building,0);
  const single=draw(f,{mode:'single'});assert.equal(single.enclosed,1);assert.equal(single.rooms.length,0);
  const partial=draw(f,{mode:'single',box:{x:18,y:2,w:8,h:6}}).rooms;
  const repeat=draw(f,{mode:'single',free:freeAfterDrafts(f,partial),box:{x:18,y:0,w:8,h:6}});
  assert.equal(area(repeat.rooms),16);nonoverlap(repeat.rooms,partial.map(r=>r.footprint));
});
test('empty/fully open floors, small fragments, hall width and facility capacity are explicit',()=>{
  const f=sketchFloor(plan,b,0);
  assert.throws(()=>draw(sketchFloor(plan,{...b,openFloors:[0]},0)),/solid floor/);
  assert.equal(draw(f,{free:[]}).rooms.length,0);
  assert.equal(draw(f,{box:null}).rooms.length,0);
  assert.ok(draw(f,{box:{x:1,y:1,w:.5,h:.5}}).skipped>0);
  assert.throws(()=>draw(f,{mode:'hall',hall:18}),/narrower/);
  assert.throws(()=>draw(f,{capacity:2}),/500-room/);
  assert.throws(()=>draw(f,{count:19}),/1 to 12/);
});
test('magnet aligns to existing coordinates independently and grid can be disabled',()=>{
  assert.deepEqual(snapSketchPoint([3.1,7.24],[[3,1],[9,7.25]],{w:12,h:10},.2,1),{point:[3,7.25],guides:[true,true]});
  assert.deepEqual(snapSketchPoint([1.8,14],[],{w:12,h:10},.3,1).point,[2,10]);
  assert.deepEqual(snapSketchPoint([1.8,2.25],[],{w:12,h:10},0,0).point,[1.8,2.25]);
});

import {fitReference,matchReference,rasterHeader} from '../src/room-sketch-reference.mjs';
test('two landmarks scale and rotate a tracing reference without distorting it',()=>{
  assert.deepEqual(fitReference({width:100,height:100},{w:40,h:20}),{x:10,y:0,w:20,h:20});
  const matrix=matchReference([[10,2],[18,2],[4,7],[4,19]],1,1);
  const [a,b,c,d,e,f]=matrix, transform=([x,y])=>[a*x+c*y+e,b*x+d*y+f];
  assert.deepEqual(transform([10,2]),[4,7]);assert.deepEqual(transform([18,2]),[4,19]);
  assert.deepEqual(transform([10,10]),[-8,7]);
  assert.throws(()=>matchReference([[1,1],[1,1],[4,7],[4,19]],1,1),/farther/);
});
test('image headers are inspected before a reference goes to the browser decoder',()=>{
  const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(png);png.writeUInt32BE(120,16);png.writeUInt32BE(80,20);
  assert.deepEqual(rasterHeader(png),{type:'image/png',width:120,height:80});
  assert.deepEqual(rasterHeader(Buffer.from('ffd8ffe000040000ffc2000b080030006001011100','hex')),{type:'image/jpeg',height:48,width:96});
  assert.throws(()=>rasterHeader(Buffer.from('<svg></svg>')),/PNG or JPEG/);
  assert.throws(()=>rasterHeader(Buffer.from('ffd8ffe0ffff0000000000','hex')),/PNG or JPEG/);
});

import {wallNeighbors,prepareWallEdit,previewWallEdit,applyWallEdit} from '../src/facility-room-walls.mjs';
const savedRoom = (id,footprint,extra={}) => ({id,name:id,buildingId:b.id,level:0,wallHeight:2.6,footprint,...extra});
test('split and slide on a rotated floor preserve both footprints together, wall heights, IDs and unaffected rooms',()=>{
  const rotate=([x,y])=>[3+x*Math.cos(.71)-y*Math.sin(.71),14+x*Math.sin(.71)+y*Math.cos(.71)];
  const building={...b,footprint:b.footprint.map(rotate)}, lounge=savedRoom('Lounge',rect(0,0,18,12).map(rotate));
  const separate=savedRoom('Store',rect(24,0,12,12).map(rotate)), upstairs={...lounge,id:'Upstairs',level:1};
  const current={...plan,buildings:[building],rooms:[lounge,separate,upstairs]};
  const split=prepareWallEdit(current,lounge,'split');
  const parts=previewWallEdit(split,'x',6), next=applyWallEdit(current,split,parts,'Office',()=>'new');
  validateFacility(next);
  assert.deepEqual(next.rooms.map(r=>r.id),['Lounge','Store','Upstairs','new']);
  assert.equal(next.rooms[1],separate);assert.equal(next.rooms[2],upstairs);
  const left=next.rooms[0],right=next.rooms.at(-1);
  assert.deepEqual(wallNeighbors(next.rooms,left),[right]);
  right.wallHeight=2.4;
  const slide=prepareWallEdit(next,left,'move',right);
  assert.ok(Math.abs(slide.originalPosition-6)<1e-7);
  const shifted=previewWallEdit(slide,'x',8.5);nonoverlap(shifted);
  assert.ok(Math.abs(shifted[0].area-102)<1e-7);
  assert.ok(Math.abs(area(shifted)-216)<1e-7);
  const moved=applyWallEdit(next,slide,shifted);
  validateFacility(moved);
  assert.equal(moved.rooms[0].wallHeight,2.6);assert.equal(moved.rooms.at(-1).wallHeight,2.4);
  assert.equal(moved.rooms.at(-1).id,'new');assert.equal(moved.rooms.at(-1).name,'Office');
});
test('only adjoining outlines can merge; concave unions keep their shape, blocked floors and enclosed voids fail visibly',()=>{
  const left=savedRoom('L',[[0,0],[12,0],[12,4],[4,4],[4,12],[0,12],[0,0]]);
  const right=savedRoom('B',rect(4,4,6,5)), corner=savedRoom('C',rect(12,4,4,3));
  const p={...plan,rooms:[left,right,corner]};
  assert.deepEqual(wallNeighbors(p.rooms,left),[right]);
  assert.throws(()=>prepareWallEdit(p,left,'move',right),/wrap/);
  const merge=prepareWallEdit(p,left,'merge',right),result=previewWallEdit(merge,'x',0);
  assert.equal(result[0].area,110);
  const joined=applyWallEdit(p,merge,result);validateFacility(joined);
  assert.deepEqual(joined.rooms.map(r=>r.id),['L','C']);assert.equal(joined.rooms[0].wallHeight,2.6);
  assert.throws(()=>prepareWallEdit(p,left,'merge',corner),/share a wall/);
  assert.throws(()=>prepareWallEdit(p,left,'merge',{...right,wallHeight:2}),/same wall height/);
  const u=savedRoom('U',[[0,0],[12,0],[12,10],[9,10],[9,3],[3,3],[3,10],[0,10],[0,0]]);
  const cap=savedRoom('Cap',rect(0,10,12,2)), around={...plan,rooms:[u,cap]};
  assert.throws(()=>prepareWallEdit(around,u,'merge',cap),/enclosed opening/);
  assert.throws(()=>previewWallEdit(prepareWallEdit(around,u,'split'),'y',4),/connected room/);
  const conflict={...p,openings:[{buildingId:b.id,level:0,name:'Vent',footprint:rect(1,2,1,1)}]};
  assert.throws(()=>prepareWallEdit(conflict,left,'split'),/Vent/);
  assert.throws(()=>prepareWallEdit({...p,buildings:[{...b,openFloors:[0]}]},left,'split'),/solid floor/);
});
