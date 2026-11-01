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

test('validation rejects malformed dimensions and identical or nonexistent levels without arbitrary metadata',()=>{
  const s=defaultStair(building);
  for(const delta of [{risers:1},{risers:101},{risers:2.5},{width:Infinity},{width:true},{tread:''},{landing:-1},{bearing:360},{x:2001},{fromLevel:2,toLevel:3},{fromLevel:1,toLevel:1},{buildingId:'other'}])assert.throws(()=>validateStair({...s,...delta},building));
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

import {anchorStair,stairAnchors,turnStair,stairDestination,stairAtStart,suggestedStair,stairPlacementIssue,destinationLevels,travelBearing} from '../src/facility-stair-placement.mjs';
import {stairOnLevel,stairLandingRings} from '../src/facility-stairs.mjs';
const plan={...blankFacility(),buildings:[building]};
test('turning and changing direction or destination keep the clicked landing fixed',()=>{
  const origin=[10,6],s=stairAtStart(plan,building,1,origin);
  assert.equal(s.toLevel,2);
  const up=turnStair(s,building,89.5),down=stairDestination(up,building,0);
  assert.deepEqual(stairAnchors(down,building)[0],origin);
  assert.deepEqual(stairAnchors(up,building),stairAnchors(down,building));
  assert.equal(travelBearing(down),89.5);assert.equal(down.bearing,269.5);
  const moved=anchorStair(down,building,[8,4]);assert.deepEqual(stairAnchors(moved,building)[0],[8,4]);
  assert.deepEqual(stairLandingRings(down,building)[0],stairTreadPolygons(down,building).at(-1).footprint);
  assert.equal(stairPlacementIssue(plan,building,moved),'');
});
test('a descending two-level reservation uses the full modeled rise and survives export without an implicit opening',()=>{
  const s=stairDestination(stairAtStart(plan,building,2,[8,4]),building,0),d=stairDimensions(s,building);
  assert.deepEqual([s.fromLevel,s.toLevel,s.risers],[2,0,36]);assert.ok(Math.abs(d.rise-6.4)<1e-8);assert.equal(d.base,1);
  assert.ok(d.warnings.some(w=>w.includes('intermediate landing')));assert.deepEqual([0,1,2,3].map(l=>stairOnLevel(s,l)),[true,true,true,false]);
  const next=validateFacility({...plan,stairs:[s]});assert.deepEqual(validateFacility(JSON.parse(JSON.stringify(next))),next);assert.deepEqual(next.openings,[]);
  for(const v of [3,4,5])assert.throws(()=>validateFacility({...next,schema:'intelligent-dvr.facility.v'+v}),/require facility v6/);
  assert.equal(validateFacility({...plan,schema:'intelligent-dvr.facility.v5',stairs:[defaultStair(building)]}).schema,next.schema);
});
test('placement excludes voids at either landing but permits an independently cut run and recovery from a bad position',()=>{
  const s=stairAtStart(plan,building,0,[12,6]),[start,arrival]=stairLandingRings(s,building);
  const opening=(level,footprint)=>({id:'cut',name:'Cut',buildingId:'b',level,footprint});
  for(const [level,footprint,word] of [[0,start,'Start'],[1,arrival,'Arrival']]){
    const p={...plan,openings:[opening(level,footprint)]};assert.match(stairPlacementIssue(p,building,s),new RegExp(word));
    if(!level)assert.throws(()=>stairAtStart(p,building,0,[12,6]),/solid floor/);
  }
  assert.equal(stairPlacementIssue({...plan,openings:[opening(1,stairRunFootprint(s,building))]},building,s),'');
  const unfitted=anchorStair(s,building,[.01,.01]);assert.match(stairPlacementIssue(plan,building,unfitted),/fit inside/);
  assert.equal(stairPlacementIssue(plan,building,anchorStair(unfitted,building,[4,4])),'');
  assert.deepEqual(destinationLevels({...building,openFloors:[1]},0),[2]);
  assert.throws(()=>stairAtStart(plan,{...building,openFloors:[1]},1,[12,6]),/solid floor/);
});


test('suggesting a position searches beyond a cutout under the default landing',()=>{
  const center=defaultStair(building,1),cut={id:'cut',name:'Void',buildingId:'b',level:1,footprint:stairLandingRings(center,building)[0]};
  const p={...plan,openings:[cut]};
  assert.match(stairPlacementIssue(p,building,center),/Start landing/);
  const suggestion=suggestedStair(p,building,1);
  assert.equal(stairPlacementIssue(p,building,suggestion),'');assert.equal(suggestion.fromLevel,1);
});
