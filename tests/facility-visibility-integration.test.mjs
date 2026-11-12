import test from 'node:test';
import assert from 'node:assert/strict';
import BigNumber from 'bignumber.js';
import {blankFacility,validateFacility} from '../src/facility.mjs';
import {coverageMetrics,enabledFans,routeCoverage} from '../src/facility-coverage.mjs';
import {groundVisibility,planVisibility,visibleAtPoint,rehearseVisibility} from '../src/facility-visibility.mjs';
import * as polygon from '../src/facility-polygon.mjs';

const rect=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d],[a,b]];
const camera={id:'c',name:'Camera',x:0,y:0,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:50,enabled:true};
const makePlan=(base,top)=>validateFacility({...blankFacility(),cameras:[camera],
  buildings:[{id:'wall',name:'Modeled wall',footprint:rect(-2,5,2,6),base,height:top,floors:1}],
  zones:[{id:'z',name:'Probe',type:'restricted',footprint:rect(-.5,7,.5,9),enabled:true,expectedClasses:[],dwellSeconds:0}],route:[[0,7],[0,9]]});
const metric=(plan,snapshot)=>coverageMetrics(plan,c=>snapshot.cameras.find(v=>v.id===c.id));

test('low-wall hole and raised-wall recovery agree across area, route and rehearsal',()=>{
  for(const [base,top,expected] of [[0,2,0],[2,6,1]]) {
    const plan=makePlan(base,top),snapshot=planVisibility(plan),metrics=metric(plan,snapshot);
    assert.equal(snapshot.estimated,true);assert.equal(metrics.zones[0].estimated,true);
    assert.equal(metrics.zones[0].coverage,expected);assert.equal(metrics.route.coverage,expected);
    for(const row of rehearseVisibility(plan,snapshot))assert.deepEqual(row.cameras,expected ? ['c'] : []);
    assert.deepEqual(visibleAtPoint(snapshot,[0,8]),expected ? ['c'] : []);
  }
});

test('hole interiors are excluded from route length while their closed boundaries remain visible',()=>{
  const c={...camera,id:'a'},plan={...blankFacility(),cameras:[c]};
  const view={method:'pinhole-ground-shadows-v1',estimated:true,polygons:[[rect(0,0,10,10),rect(3,3,7,7)]]};
  const fans=enabledFans(plan,()=>view);
  assert.equal(routeCoverage([[0,5],[10,5]],fans).coveredLength,6);
  assert.equal(routeCoverage([[0,3],[10,3]],fans).coveredLength,10);
  assert.equal(routeCoverage([[3,3],[7,7]],fans).coveredLength,0);
  const s={estimated:true,cameras:[{id:'a',...view}]};
  assert.deepEqual(visibleAtPoint(s,[5,5]),[]);assert.deepEqual(visibleAtPoint(s,[5,3]),['a']);
});

test('disconnected pieces retain one distinct-camera overlap vote and preserve holes by area',()=>{
  const plan={...blankFacility(),cameras:[camera,{...camera,id:'second'}],route:[[0,5],[10,5]],
    zones:[{id:'z',enabled:true,footprint:rect(0,0,10,10)}]};
  const first={estimated:true,polygons:[[rect(0,0,10,10),rect(3,3,7,7)]]};
  const second={estimated:true,polygons:[[rect(0,0,2,10)],[rect(8,0,10,10)]]};
  const result=coverageMetrics(plan,c=>c.id==='second' ? second : first);
  assert.equal(result.cameras,2);assert.equal(result.zones[0].coveredArea,84);assert.equal(result.zones[0].overlapArea,40);
  assert.equal(result.route.coveredLength,6);assert.equal(result.route.overlapLength,4);
});

test('any unknown enabled camera withholds coverage and handoff conclusions',()=>{
  const plan=makePlan(0,2),snapshot=planVisibility(plan,{planLimits:{operations:0}});
  assert.equal(snapshot.estimated,false);assert.equal(snapshot.cameras[0].polygons,null);
  const measured=metric(plan,snapshot);
  assert.equal(measured.zones[0].estimateReason,'visibility-unavailable');assert.equal(measured.zones[0].coverage,null);
  assert.equal(measured.route.estimated,false);assert.equal(measured.route.coverage,null);assert.equal(measured.route.length,2);
  assert.equal(visibleAtPoint(snapshot,[0,8]),null);assert.equal(rehearseVisibility(plan,snapshot),null);
});

test('disabled views remain successful empty after shared exhaustion and cached poses reuse geometry',()=>{
  const plan={...blankFacility(),cameras:[camera,{...camera,id:'off',enabled:false}]};
  const exhausted=planVisibility(plan,{planLimits:{operations:0}});
  assert.equal(exhausted.cameras[0].estimated,false);assert.equal(exhausted.cameras[1].estimated,true);
  assert.deepEqual(exhausted.cameras[1].polygons,[]);
  const a=planVisibility({...plan,cameras:[camera]}),b=planVisibility({...plan,cameras:[camera,{...camera,id:'same'}]});
  assert.deepEqual(a.work,b.work);assert.equal(b.cacheHits,1);assert.equal(b.cameras[0].polygons,b.cameras[1].polygons);
});

test('Boolean wrapper restores caller precision on both success and failure',()=>{
  const previous=BigNumber.config();
  try {
    BigNumber.config({DECIMAL_PLACES:7,ROUNDING_MODE:BigNumber.ROUND_DOWN});
    polygon.union([[rect(0,0,2,2)]],[[rect(1,1,3,3)]]);
    assert.equal(BigNumber.config().DECIMAL_PLACES,7);assert.equal(BigNumber.config().ROUNDING_MODE,BigNumber.ROUND_DOWN);
    assert.throws(()=>polygon.union([[['invalid']]]));assert.equal(BigNumber.config().DECIMAL_PLACES,7);
  } finally {BigNumber.config(previous);}
});

test('nonfinite or out-of-range Boolean output is rejected as unavailable',()=>{
  const walls=[{polygon:rect(-2,5,2,6),base:0,top:2}];
  const bad={...polygon,difference:()=>[[rect(1000,1000,1001,1001)]]};
  assert.equal(groundVisibility(camera,walls,{geometry:bad}).estimated,false);
  assert.equal(groundVisibility(camera,walls,{geometry:{...polygon,difference:()=>[[[[NaN,0],[0,1],[1,1],[NaN,0]]]]}}).estimated,false);
});

test('direct visibility refuses a Boolean result inside the axis box but outside the horizontal range disk',()=>{
  const walls=[{polygon:rect(-2,5,2,6),base:0,top:2}];
  const result=groundVisibility(camera,walls,{geometry:{...polygon,
    difference:()=>[[[[.9,.9],[.91,.9],[.9,.91],[.9,.9]]]]}});
  assert.equal(result.estimated,false);assert.equal(result.reason,'geometry-error');assert.equal(result.polygons,null);
});

test('prepared point queries preserve camera order, holes and disconnected tiny gaps',()=>{
  const shared=[[rect(1980,0,1981,10)],[rect(1981+1e-8,0,1982,10)]];
  const withHole=[[rect(1979,-1,1983,11),rect(1980.5,2,1981.5,8)]];
  const snapshot={estimated:true,cameras:[{id:'first',estimated:true,polygons:shared},
    {id:'middle',estimated:true,polygons:withHole},{id:'last',estimated:true,polygons:shared}]};
  assert.deepEqual(visibleAtPoint(snapshot,[1980.25,5]),['first','middle','last']);
  assert.deepEqual(visibleAtPoint(snapshot,[1981+5e-9,5]),[]);
  assert.deepEqual(visibleAtPoint(snapshot,[1980.5,5]),['first','middle','last']);
  assert.deepEqual(visibleAtPoint(snapshot,[1981,5]),['first','last']);
  assert.deepEqual(visibleAtPoint(snapshot,[1979,-1]),['middle']);
});

test('mutable generated geometry cannot reuse stale prepared bounds across point or rehearsal calls',()=>{
  const shape=rect(0,0,10,10),snapshot={estimated:true,cameras:[{id:'c',estimated:true,polygons:[[shape]]}]};
  const plan={route:[[0,5],[10,5]]};
  assert.deepEqual(visibleAtPoint(snapshot,[5,5]),['c']);
  assert.ok(rehearseVisibility(plan,snapshot,11).every(row=>row.cameras.length===1));
  for(const point of shape)point[0]+=20;
  assert.deepEqual(visibleAtPoint(snapshot,[5,5]),[]);
  assert.ok(rehearseVisibility(plan,snapshot,11).every(row=>row.cameras.length===0));
});

test('a tiny positive triangle keeps its boundary without a distant visibility halo',()=>{
  const a=[33.57868694146581,-8.374030086999282],b=[27.11610030718098,-6.762356140079362],c=[33.57868694146581,-8.374030086999284];
  const triangle=[a,b,c,a],snapshot={estimated:true,cameras:[{id:'tiny',estimated:true,polygons:[[triangle]]}]};
  assert.deepEqual(visibleAtPoint(snapshot,[-22.29235308551553,32.73310422998539]),[]);
  assert.deepEqual(visibleAtPoint(snapshot,[30,-30]),[]);
  for(const point of [a,b,c,[(a[0]+b[0])/2,(a[1]+b[1])/2]])assert.deepEqual(visibleAtPoint(snapshot,point),['tiny']);
  assert.equal(triangle.length,4);assert.equal(triangle[2],c);
});

test('a redundant zero-length edge cannot label arbitrary ground as visible',()=>{
  const shape=[[0,0],[10,0],[10,10],[10,10],[0,10],[0,0]];
  const snapshot={estimated:true,cameras:[{id:'c',estimated:true,polygons:[[shape]]}]};
  assert.deepEqual(visibleAtPoint(snapshot,[1000,1000]),[]);
  assert.deepEqual(visibleAtPoint(snapshot,[10,10]),['c']);assert.deepEqual(visibleAtPoint(snapshot,[5,5]),['c']);
});

test('rehearsal prepares shared and distinct camera shapes once without reducing50500camera observations',()=>{
  for(const shared of [true,false]) {
    let reads=0;
    const observed=()=>rect(0,0,10,10).map(([x,y])=>{
      const point=[];
      Object.defineProperties(point,{0:{get(){reads++;return x;}},1:{get(){reads++;return y;}}});
      return point;
    });
    const common=[[observed()]],cameras=Array.from({length:500},(_,i)=>({id:'c'+i,estimated:true,polygons:shared ? common : [[observed()]]}));
    const snapshot={estimated:true,cameras},rows=rehearseVisibility({route:[[0,5],[10,5]]},snapshot,101);
    assert.equal(rows.length,101);
    for(const row of rows)assert.deepEqual(row.cameras,cameras.map(c=>c.id));
    // Count accesses to the original geometry, not elapsed time: scanning every
    // ring anew at every sample would exceed this by orders of magnitude.
    assert.ok(reads <= (shared ? 200 : 100_000),`${shared ? 'shared' : 'distinct'} geometry was revisited ${reads} times`);
  }
});
