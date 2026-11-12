import test from 'node:test';
import assert from 'node:assert/strict';
import clipping from 'polygon-clipping';
import {blankFacility, validateFacility, coverageFan, wallObstacles, pointInPolygon} from '../src/facility.mjs';
import {zoneCoverage, coverageMetrics, enabledFans, ZONE_COVERAGE_LIMITS, PLAN_COVERAGE_LIMITS} from '../src/facility-coverage.mjs';

const rect = (a,b,c,d) => [[a,b],[c,b],[c,d],[a,d],[a,b]];
const fan = (id,ring) => ({id,ring});
const zone = (id,footprint) => ({id,name:id,footprint,type:'restricted',dwellSeconds:0,expectedClasses:['person'],enabled:true});
const camera = (id,extra={}) => ({id,name:id,x:0,y:0,z:4,bearing:45,tilt:30,hfov:90,vfov:60,range:50,enabled:true,...extra});
const close = (actual,expected,tolerance=1e-10) => assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const measured = (footprint,fans,options) => {const result=zoneCoverage(footprint,fans,options);assert.equal(result.estimated,true,JSON.stringify(result));return result;};
const nullFields = result => {for(const key of ['area','coveredArea','overlapArea','uncoveredArea','coverage','overlap','blindSpots'])assert.equal(result[key],null,key);};
const realFans = plan => enabledFans(plan,c=>coverageFan(c,wallObstacles(plan)));
const ringArea = ring => Math.abs(ring.slice(1).reduce((sum,p,i)=>sum+ring[i][0]*p[1]-p[0]*ring[i][1],0))/2;
const multiArea = multi => multi.reduce((sum,p)=>sum+ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0),0);
function freeze(value) {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('ordinary validated camera plans retain a ten-centimetre blind strip and a second-camera overlap strip',()=>{
  const make=(cameras,footprint)=>validateFacility({...blankFacility(),cameras,zones:[zone('z',footprint)]});
  const gap=make([camera('C1')],rect(10,-.1,20,.9)),result=measured(gap.zones[0].footprint,realFans(gap));
  assert.equal(result.method,'polygon-area-v1');close(result.area,10);close(result.coveredArea,9);close(result.uncoveredArea,1);close(result.coverage,.9);
  assert.ok(result.blindSpots.length);close(multiArea(result.blindSpots),1);
  const second=make([camera('C1',{y:-1}),camera('C2',{y:.9})],rect(10,0,20,1)),overlap=measured(second.zones[0].footprint,realFans(second));
  close(overlap.coverage,1);close(overlap.overlapArea,1);close(overlap.overlap,.1);
  const parallel=make([camera('C1'),camera('C2',{y:.8})],rect(10,-.1,20,.9)),parallelResult=measured(parallel.zones[0].footprint,realFans(parallel));
  close(parallelResult.coverage,.9);close(parallelResult.overlap,.1);
  const sliver=make([camera('C1',{y:.9})],rect(10,0,20,1)),visible=measured(sliver.zones[0].footprint,realFans(sliver));
  close(visible.coverage,.1);close(visible.coveredArea,1);
});

test('forty ordinary narrow cameras do not alias into a fully covered valid one-square-metre zone',()=>{
  const plan=validateFacility({...blankFacility(),cameras:Array.from({length:40},(_,i)=>camera('C'+i,{x:.125+i*.25,y:-1,z:.5,bearing:0,tilt:45,hfov:5,vfov:60,range:5})),zones:[zone('z',rect(0,0,10,.1))]});
  const result=measured(plan.zones[0].footprint,realFans(plan)),expected=8.4*Math.tan(2.5*Math.PI/180);
  close(result.area,1);close(result.coverage,expected);close(result.overlap,0);close(result.uncoveredArea,1-expected);
  close(multiArea(result.blindSpots),1-expected);
});

test('500 narrow camera footprints retain the small positive coverage of a valid one-square-metre zone',()=>{
  const plan=validateFacility({...blankFacility(),cameras:Array.from({length:500},(_,i)=>camera('C'+i,{x:.125+i*.25,y:-.001,z:.5,bearing:0,tilt:89,hfov:5,vfov:150,range:5})),zones:[zone('z',rect(0,0,125,.008))]});
  const result=measured(plan.zones[0].footprint,realFans(plan));
  const expected=500*Math.tan(2.5*Math.PI/180)*(.008*.008+2*.001*.008);
  close(result.area,1);close(result.coveredArea,expected);close(result.coverage,expected);close(result.overlap,0);
  close(result.uncoveredArea,1-expected);assert.equal(result.blindSpots.length,501);
  for(const key of ['operations','inputVertices','outputVertices'])assert.ok(result.work[key]<=ZONE_COVERAGE_LIMITS[key]);
});

test('camera fragments union before voting and triple overlaps contribute area only once',()=>{
  const subject=rect(0,0,10,10),one=[fan('A',rect(0,0,6,10)),fan('A',rect(4,0,8,10)),fan('A',rect(0,0,6,10))];
  const single=measured(subject,one);close(single.coverage,.8);close(single.overlap,0);assert.equal(single.cameras,1);
  const two=measured(subject,[...one,fan('B',rect(5,0,9,10))]);close(two.coveredArea,90);close(two.overlapArea,30);assert.equal(two.cameras,2);
  const triple=measured(subject,[fan('A',rect(0,0,7,10)),fan('B',rect(3,0,10,10)),fan('C',rect(4,0,6,10))]);
  close(triple.coverage,1);close(triple.overlapArea,40);close(triple.overlap,.4);
});

test('blind geometry preserves a covered island as a hole and separated gaps as distinct polygons',()=>{
  const subject=rect(0,0,10,10),island=measured(subject,[fan('one',rect(3,3,7,7))]);
  assert.equal(island.blindSpots.length,1);assert.equal(island.blindSpots[0].length,2);
  close(island.coveredArea,16);close(multiArea(island.blindSpots),84);
  const split=measured(subject,[fan('one',rect(4,-1,6,11))]);
  assert.equal(split.blindSpots.length,2);assert.ok(split.blindSpots.every(p=>p.length===1));close(multiArea(split.blindSpots),80);
});

test('concave and diagonal zone boundaries clip blind polygons to the actual zone',()=>{
  const triangle=[[0,0],[10,0],[2,10],[0,0]],blind=measured(triangle,[]);
  close(blind.area,50);close(multiArea(blind.blindSpots),50);
  assert.ok(blind.blindSpots.flat(2).every(p=>pointInPolygon(p,triangle)));
  const concave=[[0,0],[10,0],[10,4],[4,4],[4,10],[0,10],[0,0]],cut=measured(concave,[fan('one',rect(2,2,8,8))]);
  close(cut.area,64);close(cut.coveredArea,20);close(cut.uncoveredArea,44);close(multiArea(cut.blindSpots),44);
});

test('touching, collinear and wall-collapsed fans have zero area and do not invent coverage',()=>{
  const subject=rect(0,0,1,1),result=measured(subject,[fan('empty',[]),fan('line',[[0,.5],[1,.5],[0,.5]]),fan('touch',rect(1,0,2,1))]);
  close(result.coverage,0);close(result.overlap,0);close(result.uncoveredArea,1);
  const plan=validateFacility({...blankFacility(),cameras:[camera('C1',{bearing:0})],buildings:[{id:'wall',name:'Wall',footprint:rect(-20,1,20,1.2),height:6,floors:1}],zones:[zone('z',rect(-5,.875,5,1.875))]});
  assert.ok(coverageFan(plan.cameras[0],wallObstacles(plan)).length>3);
  assert.equal(realFans(plan).length,0);
  const wall=measured(plan.zones[0].footprint,realFans(plan));close(wall.coverage,0);close(wall.uncoveredArea,10);
});

test('rotation, reversed winding and translations near facility limits preserve all measured areas',()=>{
  const subject=rect(0,0,10,10),fans=[fan('A',rect(-1,1,7,8)),fan('B',rect(3,4,11,9))],baseline=measured(subject,fans);
  const angle=23*Math.PI/180;
  for(const [x,y]of [[0,0],[1750,-1750],[-1750,1750]]){
    const transform=([a,b])=>[x+a*Math.cos(angle)-b*Math.sin(angle),y+a*Math.sin(angle)+b*Math.cos(angle)];
    const result=measured([...subject].reverse().map(transform),fans.map(f=>fan(f.id,[...f.ring].reverse().map(transform))));
    for(const key of ['area','coveredArea','overlapArea','uncoveredArea','coverage','overlap'])close(result[key],baseline[key],2e-10);
  }
});

test('very thin diagonal zones retain supported positive area without requiring a grid centre',()=>{
  const angle=23*Math.PI/180,transform=([x,y])=>[1990+x*Math.cos(angle)-y*Math.sin(angle),-1990+x*Math.sin(angle)+y*Math.cos(angle)];
  const subject=rect(0,0,5,.2).map(transform),whole=rect(-1,-1,6,1).map(transform);
  const plan=validateFacility({...blankFacility(),zones:[zone('z',subject)]});
  const result=measured(plan.zones[0].footprint,[fan('one',whole)]);close(result.area,1,2e-11);close(result.coverage,1);assert.deepEqual(result.blindSpots,[]);
});

test('an independent axis-aligned arrangement oracle agrees across deterministic fragmented multi-camera scenes',()=>{
  let state=0x615ac1;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(let sample=0;sample<32;sample++){
    const boxes=Array.from({length:6},(_,i)=>{const x=random()%8,y=random()%8;return{id:'C'+(i%4),x,y,right:x+1+random()%4,top:y+1+random()%4};});
    let covered=0,overlap=0;
    // Integer rectangle edges partition this 10x10 zone into unit squares.
    // Camera-ID sets at square centres give exact square areas, independent of clipping.
    for(let x=0;x<10;x++)for(let y=0;y<10;y++){
      const ids=new Set(boxes.filter(b=>x+.5>b.x&&x+.5<b.right&&y+.5>b.y&&y+.5<b.top).map(b=>b.id));
      if(ids.size)covered++;if(ids.size>1)overlap++;
    }
    const result=measured(rect(0,0,10,10),boxes.map(b=>fan(b.id,rect(b.x,b.y,b.right,b.top))));
    close(result.coveredArea,covered);close(result.overlapArea,overlap);close(result.uncoveredArea,100-covered);
  }
});

test('no cameras is a successful measured zero; invalid or failed geometry is unavailable with null fields',()=>{
  const zero=measured(rect(0,0,1,1),[]);assert.equal(zero.coverage,0);assert.equal(zero.work.operations,0);assert.deepEqual(zero.blindSpots,[[rect(0,0,1,1)]]);
  for(const [footprint,fans,geometry]of [
    [[],[],clipping],
    [rect(0,0,1,1),[fan('bad',[[0,0],[NaN,0],[1,1],[0,0]])],clipping],
    [rect(0,0,1,1),[fan('one',rect(0,0,1,1))],{...clipping,intersection(){throw Error('injected clipping failure');}}],
    [rect(0,0,1,1),[fan('one',rect(0,0,1,1))],{...clipping,intersection(){return[[rect(-1,-1,1,1)]];}}],
    [rect(0,0,1,1),[fan('one',rect(0,0,1,1))],{...clipping,intersection(){return[[[[0,0],[Infinity,0],[1,1],[0,0]]]];}}],
  ]){
    const result=zoneCoverage(footprint,fans,{geometry});assert.equal(result.estimated,false);assert.equal(result.estimateReason,'geometry-error');nullFields(result);
  }
});

test('a failure after a successful partial clip discards the entire result',()=>{
  let calls=0;const geometry={...clipping,intersection(...args){if(++calls===2)throw Error('second clip failed');return clipping.intersection(...args);}};
  const result=zoneCoverage(rect(0,0,10,10),[fan('A',rect(0,0,5,10)),fan('B',rect(5,0,10,10))],{geometry});
  assert.equal(calls,2);assert.ok(result.work.operations>=calls);assert.equal(result.estimateReason,'geometry-error');nullFields(result);
});

test('per-zone operation, input and post-call output limits fail closed and account for observed work',()=>{
  const subject=rect(0,0,10,10),fans=[fan('A',rect(0,0,6,10)),fan('B',rect(4,0,10,10))];
  for(const limits of [{operations:1},{inputVertices:9},{geometryVertices:9},{outputVertices:0}]){
    const result=zoneCoverage(subject,fans,{limits});assert.equal(result.estimated,false);assert.equal(result.estimateReason,'geometry-limit');nullFields(result);
  }
  const output=zoneCoverage(subject,fans,{limits:{outputVertices:0}});assert.equal(output.work.operations,1);assert.equal(output.work.outputVertices,5);
  const ring=Array.from({length:32},(_,i)=>[.1*Math.cos(i*Math.PI/16),.1*Math.sin(i*Math.PI/16)]);ring.push(ring[0]);
  const tooLarge=zoneCoverage(subject,fans,{limits:{geometryVertices:20},geometry:{...clipping,intersection(){return[[ring]];}}});
  assert.equal(tooLarge.estimateReason,'geometry-limit');assert.equal(tooLarge.work.peakVertices,33);nullFields(tooLarge);
});

test('a shared plan budget prevents later zones from submitting work; exact footprint reuse preserves successful geometry',()=>{
  const plan=validateFacility({...blankFacility(),cameras:[camera('one')],zones:[zone('first',rect(10,0,20,1)),zone('same',rect(10,0,20,1)),zone('second',rect(11,0,21,1)),zone('third',rect(12,0,22,1)),zone('last',rect(13,0,23,1))]});
  const operations=2*measured(plan.zones[0].footprint,realFans(plan)).work.operations;
  const result=coverageMetrics(plan,c=>coverageFan(c,[]),{planLimits:{operations}});
  assert.equal(result.cacheHits,1);assert.equal(result.work.operations,operations);
  assert.equal(result.zones[0].estimated,true);assert.equal(result.zones[1].estimated,true);assert.equal(result.zones[2].estimated,true);
  assert.strictEqual(result.zones[0].blindSpots,result.zones[1].blindSpots);
  for(const z of result.zones.slice(3)){assert.equal(z.estimateReason,'geometry-limit');assert.equal(z.work.operations,0);nullFields(z);}
});

test('500 spatially separated cameras and 500 zones complete within shared work caps without mutating inputs',()=>{
  const cameras=Array.from({length:500},(_,i)=>camera('C'+i,{x:(i%25)*100-1200,y:Math.floor(i/25)*100-950,bearing:0,range:30}));
  const zones=cameras.map((c,i)=>zone('Z'+i,rect(c.x-5,c.y+10,c.x+5,c.y+20)));
  const plan=freeze(validateFacility({...blankFacility(),cameras,zones})),before=JSON.stringify(plan);
  const result=coverageMetrics(plan,c=>coverageFan(c,[]));
  assert.equal(result.zones.length,500);assert.ok(result.zones.every(z=>z.estimated&&z.coverage===1&&z.overlap===0));
  for(const key of ['operations','inputVertices','outputVertices'])assert.ok(result.work[key]<=PLAN_COVERAGE_LIMITS[key]);
  assert.equal(JSON.stringify(plan),before);
});

test('500 coincident cameras and 500 identical zones calculate geometry once with distinct-camera overlap',()=>{
  const plan=validateFacility({...blankFacility(),cameras:Array.from({length:500},(_,i)=>camera('C'+i)),zones:Array.from({length:500},(_,i)=>zone('Z'+i,rect(10,1,20,2)))});
  const result=coverageMetrics(plan,c=>coverageFan(c,[]));assert.equal(result.cacheHits,499);
  assert.ok(result.zones.every(z=>z.estimated&&z.coverage===1&&z.overlap===1));
  assert.deepEqual(result.work,result.zones[0].work);
  for(const key of ['operations','inputVertices','outputVertices'])assert.ok(result.work[key]<=ZONE_COVERAGE_LIMITS[key]);
});
