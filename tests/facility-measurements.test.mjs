import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDistance, formatArea, lineMeasurements, polygonMeasurements, measurementLabels, lineRibbonSegments, floorElevation, floorRenderPlan, visibleLabelIndices} from '../src/facility-measurements.mjs';

const box = (x, y, width, height) => [[x,y],[x+width,y],[x+width,y+height],[x,y+height],[x,y]];
test('polygon measurements subtract courtyards and count their boundaries', () => {
  const result = polygonMeasurements(box(0,0,10,20), [box(2,2,3,4)]);
  assert.equal(result.area, 188);
  assert.equal(result.perimeter, 74);
  assert.equal(result.segments.length, 8);
  assert.equal(result.segments[4].ringIndex, 1);
});
test('line lengths use actual segments, including diagonals and open paths', () => {
  const result = lineMeasurements([[0,0],[3,4],[3,4],[9,12]]);
  assert.equal(result.length, 15);
  assert.deepEqual(result.segments.map(s => s.length), [5,10]);
  assert.deepEqual(result.segments[0].point, [1.5,2]);
  assert.deepEqual(lineMeasurements([[NaN,0],[3,4]]), {segments: [],length:0});
});
test('imperial display converts length and area independently', () => {
  assert.equal(formatDistance(.3048, 'imperial'), '1.0 ft');
  assert.equal(formatArea(.3048 ** 2, 'imperial'), '1.0 ft²');
  assert.equal(formatDistance(3), '3.0 m');
  assert.equal(formatArea(9), '9.0 m²');
});
test('labels include selected polygon, courtyards and complete route total', () => {
  const plan = {buildings:[{id:'b1',footprint:box(0,0,10,20), holes:[box(2,2,3,4)]}],rooms:[],route:[[0,0],[3,4],[9,12]]};
  const labels = measurementLabels(plan,'b1');
  assert.match(labels[0].text, /188.0 m².*74.0 m/);
  assert.ok(labels.some(l => l.text === 'Courtyard · 3.0 m'));
  assert.ok(labels.some(l => l.text === 'Route 15.0 m'));
  assert.equal(measurementLabels(plan,'b1',{maxLabels:3}).length,3);
  assert.equal(measurementLabels(plan,'b1',{maxLabels:0}).length,0);
});
test('map label budget holds for maximum route and polygon sizes', () => {
  const footprint = Array.from({length:200},(_,i)=>[20*Math.cos(i*Math.PI/100),20*Math.sin(i*Math.PI/100)]);
  footprint.push(footprint[0]);
  const plan = {buildings:[{id:'b1',footprint}],rooms:[],route:Array.from({length:200},(_,i)=>[i,i%2])};
  assert.equal(measurementLabels(plan,'b1',{maxLabels:10000}).length,64);
  assert.match(measurementLabels(plan,'b1')[0].text,/boundary/);
});
test('floor measurement labels exclude rooms belonging to another building', () => {
  const plan={buildings:[],rooms:[{id:'room',buildingId:'other',level:0,footprint:box(0,0,5,5)}],route:[]};
  assert.equal(measurementLabels(plan,'room',{view:'floors',floorBuildingId:'active',floor:0}).length,0);
});

test('floor-scoped zone measurements are hidden outside their matching floor', () => {
  const plan={buildings:[],rooms:[],zones:[{id:'zone',buildingId:'b1',level:1,footprint:box(0,0,5,5)}],route:[]};
  assert.equal(measurementLabels(plan,'zone',{view:'3d',floorBuildingId:'b1',floor:1}).length,0);
  assert.equal(measurementLabels(plan,'zone',{view:'floors',floorBuildingId:'b1',floor:0}).length,0);
  assert.equal(measurementLabels(plan,'zone',{view:'floors',floorBuildingId:'b1',floor:1}).length,5);
});

test('floor slab area subtracts only openings on the selected level', () => {
  const plan={buildings:[{id:'b',footprint:box(0,0,10,10),holes:[]}],rooms:[],route:[],openings:[
    {id:'o1',buildingId:'b',level:1,footprint:box(2,2,2,2)},
    {id:'o2',buildingId:'b',level:2,footprint:box(5,5,3,3)}]};
  const floor1=measurementLabels(plan,'b',{view:'floors',floorBuildingId:'b',floor:1});
  const floor2=measurementLabels(plan,'b',{view:'floors',floorBuildingId:'b',floor:2});
  assert.match(floor1[0].text,/Floor 2 · 96.0 m²/);
  assert.match(floor2[0].text,/Floor 3 · 91.0 m²/);
  assert.ok(floor1.some(label => label.text === 'Opening · 2.0 m'));
  assert.match(measurementLabels(plan,'b')[0].text,/100.0 m²/);
});
test('stair measurement summary reports footprint size and actual modeled rise', () => {
  const plan={buildings:[{id:'b',footprint:box(-20,-20,40,40),height:9,floors:3}],rooms:[],route:[],stairs:[
    {id:'st',buildingId:'b',fromLevel:0,toLevel:1,x:0,y:0,bearing:90,width:1.2,tread:.3,risers:18,landing:1.2}]};
  const labels=measurementLabels(plan,'st',{view:'floors',floorBuildingId:'b',floor:0});
  assert.equal(labels[0].text,'Stair 7.5 m × 1.2 m · rise 3.0 m');
  assert.equal(measurementLabels(plan,'st',{view:'floors',floorBuildingId:'b',floor:2}).length,0);
});
test('floor paths retain per-segment and total distance only on their own floor', () => {
  const plan={buildings:[],rooms:[],route:[],paths:[{id:'path',name:'Exit route',buildingId:'b',level:1,points:[[0,0],[3,4],[3,9]]}]};
  assert.deepEqual(measurementLabels(plan,'path',{view:'floors',floorBuildingId:'b',floor:1}).map(label=>label.text),['Exit route · 10.0 m','5.0 m','5.0 m']);
  assert.equal(measurementLabels(plan,'path',{view:'floors',floorBuildingId:'b',floor:0}).length,0);
});
test('floor path ribbons stay bounded to segment count and ignore duplicate points', () => {
  const rings=lineRibbonSegments([[0,0],[3,4],[3,4],[3,9]],.2);
  assert.equal(rings.length,2);
  assert.ok(rings.every(ring=>ring.length===5));
  assert.ok(Math.abs(polygonMeasurements(rings[0]).area - 1) < 1e-8);
  assert.deepEqual(lineRibbonSegments([[0,0],[1,1]],Infinity),[]);
});

test('a wholly open floor has no misleading slab area or edge measurements', () => {
  const plan={buildings:[{id:'b',footprint:box(0,0,10,10),openFloors:[1]}],rooms:[],route:[]};
  const labels=measurementLabels(plan,'b',{view:'floors',floorBuildingId:'b',floor:1});
  assert.deepEqual(labels.map(label=>label.text),['Floor 2 · open · no slab']);
  assert.match(measurementLabels(plan,'b',{view:'floors',floorBuildingId:'b',floor:0})[0].text,/100.0 m²/);
});

test('floor display preserves the slab below while the drawing view has one flat coordinate plane', () => {
  const building={base:2,height:14,floors:4,openFloors:[2]};
  assert.deepEqual(floorRenderPlan(building,2,'floors'),{level:2,flattened:false,slabLevels:[1]});
  assert.deepEqual(floorRenderPlan(building,1,'floors',true),{level:1,flattened:true,slabLevels:[1]});
  assert.deepEqual(floorRenderPlan(building,2,'floors',true),{level:2,flattened:true,slabLevels:[]});
  assert.deepEqual(floorRenderPlan(building,1,'3d').slabLevels,[0,1,3]);
  assert.equal(floorElevation(building,1),5);
  assert.equal(floorElevation(building,1,true),0);
  assert.deepEqual(floorRenderPlan(building,1,'2d').slabLevels,[]);
});
test('floor rendering clamps a stale level when a building loses upper floors', () => {
  assert.deepEqual(floorRenderPlan({height:6,floors:2},10,'floors'),{level:1,flattened:false,slabLevels:[0,1]});
  assert.equal(floorRenderPlan({height:6,floors:2},NaN,'floors').level,0);
});

test('small-geometry labels retain selected summary and suppress colliding edges', () => {
  const rect=(left,top,right,bottom)=>({left,top,right,bottom});
  const labels=[
    {priority:3,rect:rect(25,25,65,45)},
    {priority:0,keep:true,rect:rect(10,20,90,60)},
    {priority:1,rect:rect(10,-20,90,0)},
    {priority:4,rect:rect(20,-18,100,2)},
    {priority:3,rect:rect(120,25,160,45)},
  ];
  assert.deepEqual([...visibleLabelIndices(labels)].sort(),[1,2,4]);
  labels[0].rect=rect(25,85,65,105);
  assert.ok(visibleLabelIndices(labels).has(0),'edge reappears after projected zoom separation');
});
test('selected polygon and floor path summaries are marked as required', () => {
  const plan={buildings:[{id:'b',footprint:box(0,0,2,2)}],rooms:[],route:[],paths:[{id:'p',name:'Path',buildingId:'b',level:0,points:[[0,0],[1,1]]}]};
  assert.equal(measurementLabels(plan,'b')[0].primary,true);
  assert.equal(measurementLabels(plan,'p',{view:'floors',floorBuildingId:'b',floor:0})[0].primary,true);
});

test('retained cutouts do not display measurements while their entire floor is open',()=>{
  const plan={buildings:[{id:'b',footprint:box(0,0,10,10),openFloors:[1]}],rooms:[],route:[],openings:[{id:'o',buildingId:'b',level:1,footprint:box(2,2,2,2)}]};
  assert.deepEqual(measurementLabels(plan,'o',{view:'floors',floorBuildingId:'b',floor:1}),[]);
  assert.deepEqual(measurementLabels(plan,'o',{view:'3d'}),[]);
  plan.buildings[0].openFloors=[];
  assert.ok(measurementLabels(plan,'o',{view:'floors',floorBuildingId:'b',floor:1}).length>0);
});
