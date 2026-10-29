import test from 'node:test';
import assert from 'node:assert/strict';
import {STAIR_REFERENCE, defaultStair, validateStair, stairDimensions, stairFootprint, stairRunFootprint, stairTreadPolygons} from '../src/facility-stairs.mjs';
import {polygonContains, ringsOverlap, validateFacility, blankFacility} from '../src/facility.mjs';
const building={id:'b',name:'Office',footprint:[[0,0],[30,0],[30,20],[0,20],[0,0]],base:1,height:10.6,floors:3};
const area=ring=>Math.abs(ring.slice(1).reduce((total,p,i)=>total+ring[i][0]*p[1]-p[0]*ring[i][1],0))/2;

test('default stair uses actual adjacent level rise and exact inch-to-metre reference values',()=>{
  const stair=defaultStair(building,0),d=stairDimensions(stair,building);
  assert.equal(stair.risers,18);assert.equal(stair.fromLevel,0);assert.equal(stair.toLevel,1);
  assert.ok(Math.abs(d.rise-3.2)<1e-10);assert.ok(Math.abs(d.riser-3.2/18)<1e-10);
  assert.equal(stair.width,44*.0254);assert.equal(stair.tread,11*.0254);
  assert.ok(d.riser<=STAIR_REFERENCE.maxRiser);assert.deepEqual(d.warnings,[]);
  assert.equal(d.base,1);assert.ok(Math.abs(d.top-4.2)<1e-10);
});

test('stair reservation includes both landings and rotates around its center without changing area',()=>{
  const s=defaultStair(building),d=stairDimensions(s,building);
  assert.ok(Math.abs(d.length-((s.risers-1)*s.tread+2*s.landing))<1e-10);
  for(const bearing of [0,45,90,215,359.99]) {
    const ring=stairFootprint({...s,bearing},building);
    assert.deepEqual(ring[0],ring.at(-1));assert.equal(ring.length,5);
    assert.ok(Math.abs(area(ring)-d.length*d.width)<1e-6);
    assert.ok(Math.abs(ring.slice(0,4).reduce((v,p)=>v+p[0],0)/4-s.x)<1e-8);
    assert.ok(Math.abs(ring.slice(0,4).reduce((v,p)=>v+p[1],0)/4-s.y)<1e-8);
  }
});

test('solid tread geometry rises monotonically and arrives exactly at the next floor',()=>{
  const stair=defaultStair(building,1),d=stairDimensions(stair,building),treads=stairTreadPolygons(stair,building);
  assert.equal(treads.length,stair.risers+1);
  assert.ok(Math.abs(treads.at(-1).top-d.top)<1e-10);
  assert.ok(treads.every((t,i)=>t.base===d.base && (!i || t.top>treads[i-1].top)));
  assert.ok(Math.abs(treads.reduce((total,t)=>total+area(t.footprint),0)-area(stairFootprint(stair,building)))<1e-6);
  assert.ok(Math.abs(area(stairRunFootprint(stair,building))-d.width*d.run)<1e-6);
  assert.ok(area(stairRunFootprint(stair,building))<area(stairFootprint(stair,building)));
});

test('dimension edits can represent existing stairs while visibly identifying reference departures',()=>{
  const s={...defaultStair(building),width:.8,tread:.2,landing:.5,risers:10};
  assert.doesNotThrow(()=>validateStair(s,building));
  const warnings=stairDimensions(s,building).warnings.join(' ');
  for(const term of ['7 in','11 in','44 in','Landing'])assert.ok(warnings.includes(term));
  assert.ok(stairDimensions({...s,risers:50},building).warnings.some(w=>w.includes('4 in')));
  const high={...building,height:16,floors:2};
  assert.ok(stairDimensions(defaultStair(high),high).warnings.some(w=>w.includes('12 ft')));
});

test('validation rejects malformed dimensions and non-adjacent or nonexistent levels without arbitrary metadata',()=>{
  const s=defaultStair(building);
  for(const delta of [{risers:1},{risers:101},{risers:2.5},{width:Infinity},{width:true},{tread:''},{landing:-1},{bearing:360},{x:2001},{fromLevel:2,toLevel:3},{fromLevel:0,toLevel:2},{buildingId:'other'}])assert.throws(()=>validateStair({...s,...delta},building));
  assert.deepEqual(validateStair({...s,url:'https://bad.invalid',html:'<script>'},building),s);
  assert.equal(stairTreadPolygons({...s,risers:1e9},building).length,0);
});

test('single-level buildings cannot create an impossible upward stair and top-floor defaults use the floor below',()=>{
  assert.throws(()=>defaultStair({...building,floors:1}),/upper level/);
  const s=defaultStair(building,2);assert.equal(s.fromLevel,1);assert.equal(s.toLevel,2);
  assert.equal(defaultStair(building,-3).fromLevel,0);
});

test('short-rise existing layouts still produce increasing solid geometry',()=>{
  const b={...building,base:0,height:1,floors:40},s=defaultStair(b),steps=stairTreadPolygons(s,b);
  assert.ok(steps.every((step,i)=>step.top>step.base && (!i || step.top>steps[i-1].top)));
});

test('default placement finds solid space in courtyard and concave U-shaped buildings',()=>{
  const cases=[
    {...building,holes:[[[8,5],[22,5],[22,15],[8,15],[8,5]]]},
    {...building,footprint:[[0,0],[20,0],[20,20],[16,20],[16,4],[4,4],[4,20],[0,20],[0,0]]},
  ];
  for(const b of cases) {
    const fits=footprint=>polygonContains(b.footprint,footprint) && !(b.holes || []).some(hole=>ringsOverlap(hole,footprint));
    assert.equal(fits(stairFootprint(defaultStair(b),b)),false,'centroid is not usable');
    const stair=defaultStair(b,0,fits);
    assert.ok(fits(stairFootprint(stair,b)));
    assert.doesNotThrow(()=>validateFacility({...blankFacility(),buildings:[b],stairs:[stair]}));
  }
});

test('default placement reports a bounded-search failure when the reservation cannot fit',()=>{
  const b={...building,footprint:[[0,0],[2,0],[2,2],[0,2],[0,0]]};
  let attempts=0;
  assert.throws(()=>defaultStair(b,0,footprint=>{attempts++;return polygonContains(b.footprint,footprint);}),/No fitting location/);
  assert.ok(attempts<300);
});
