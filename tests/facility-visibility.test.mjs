import test from 'node:test';
import assert from 'node:assert/strict';
import {groundImageCoordinates,inGroundFrustum,groundVisibility,visibleGroundPoint} from '../src/facility-visibility.mjs';
import {pointInPolygon} from '../src/facility.mjs';

const camera={x:0,y:0,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:50,enabled:true};
const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const contains=(multi,p)=>multi.some(poly=>pointInPolygon(p,poly[0]) && !poly.slice(1).some(r=>pointInPolygon(p,r)));
const area=multi=>multi.reduce((sum,poly)=>sum+poly.reduce((value,ring,i)=>{
  const cross=ring.slice(1).reduce((n,p,j)=>n+ring[j][0]*p[1]-p[0]*ring[j][1],0);
  return value+(i ? -1 : 1)*Math.abs(cross)/2;
},0),0);
const near=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);

// Construct a world-ground point by tracing an image ray, independently of
// the production world-to-camera inequality and convex clipping functions.
function imageRay(c,u,v) {
  const b=c.bearing*Math.PI/180,t=c.tilt*Math.PI/180;
  const axis=[Math.sin(b)*Math.cos(t),Math.cos(b)*Math.cos(t),-Math.sin(t)];
  const right=[Math.cos(b),-Math.sin(b),0];
  const down=[-Math.sin(b)*Math.sin(t),-Math.cos(b)*Math.sin(t),-Math.cos(t)];
  const ray=axis.map((a,i)=>a+u*right[i]+v*down[i]), k=-c.z/ray[2];
  return k>0 ? [c.x+k*ray[0],c.y+k*ray[1]] : null;
}

test('inverse image rays round-trip through all permitted view extremes',()=>{
  for(const tilt of [0,1,30,60,89]) for(const hfov of [5,90,170]) for(const vfov of [5,60,150]) {
    const c={...camera,tilt,hfov,vfov,range:300,bearing:137,x:1750,y:-1700};
    const H=Math.tan(hfov*Math.PI/360), V=Math.tan(vfov*Math.PI/360);
    for(const u of [-.9*H,0,.9*H]) for(const v of [-.9*V,0,.9*V]) {
      const p=imageRay(c,u,v);if(!p || Math.hypot(p[0]-c.x,p[1]-c.y)>c.range)continue;
      const q=groundImageCoordinates(c,p);near(q.imageX,u,2e-11);near(q.imageY,v,2e-11);
      assert.equal(inGroundFrustum(c,p),true);
    }
  }
});

test('an oblique image edge uses camera-axis depth instead of a fixed ground azimuth',()=>{
  const c={...camera,tilt:60,hfov:90,vfov:60};
  assert.equal(inGroundFrustum(c,[3,1]),true);
  assert.equal(inGroundFrustum(c,[8,7]),false);
  const result=groundVisibility(c);assert.equal(result.estimated,true);
  assert.equal(contains(result.polygons,[3,1]),true);assert.equal(contains(result.polygons,[8,7]),false);
});

test('a view crossing nadir includes ground below and behind the mount',()=>{
  const c={...camera,tilt:89,hfov:90,vfov:60};
  for(const p of [[0,0],[.5,0],[0,-1]]) {
    assert.equal(inGroundFrustum(c,p),true);assert.equal(contains(groundVisibility(c).polygons,p),true);
  }
  assert.equal(inGroundFrustum(c,[0,-4]),false);
});

test('closed ideal image edges survive tan45 rounding without a fixed spatial buffer',()=>{
  const c={...camera,tilt:0};
  assert.equal(inGroundFrustum(c,[10,10]),true);
  assert.equal(inGroundFrustum(c,[10+1e-8,10]),false);
  assert.equal(inGroundFrustum(c,[0,4*Math.sqrt(3)]),true);
  assert.equal(inGroundFrustum(c,[0,4*Math.sqrt(3)-1e-8]),false);
  assert.equal(inGroundFrustum(c,[30,40]),true);
  assert.equal(inGroundFrustum(c,[30+1e-6,40]),false);
});

test('bounded frustum corners and their trapezoid area agree with image rays',()=>{
  const c={...camera,tilt:45,hfov:60,vfov:30};
  const H=Math.tan(Math.PI/6), V=Math.tan(Math.PI/12);
  const corners=[[-H,-V],[H,-V],[H,V],[-H,V]].map(([u,v])=>imageRay(c,u,v));
  const expected=area([[ [...corners,corners[0]] ]]);
  const actual=groundVisibility(c);assert.equal(actual.estimated,true);near(area(actual.polygons),expected);
  assert.equal(actual.polygons.length,1);assert.equal(actual.polygons[0][0].length,5);
});

test('horizontal range is an inscribed circle with an explicit radial chord bound',()=>{
  const c={...camera,tilt:89,hfov:170,vfov:150,z:100,range:1};
  for(const segments of [16,64,256]) {
    const q=groundVisibility(c,[],{segments});assert.equal(q.estimated,true);
    near(area(q.polygons),segments*Math.sin(2*Math.PI/segments)/2);
    near(q.rangeChordError,1-Math.cos(Math.PI/segments));
    for(const ring of q.polygons.flat())for(const p of ring)near(Math.hypot(...p),1,1e-12);
  }
});

test('a low wall casts a finite hole and distant ground becomes visible again',()=>{
  const walls=[{polygon:rect(-2,5,2,6),base:0,top:2}],q=groundVisibility(camera,walls);
  assert.equal(q.estimated,true);assert.ok(q.polygons.some(p=>p.length>1));
  for(const [y,expected] of [[4,true],[7,false],[9,false],[13,true],[30,true]]) {
    assert.equal(visibleGroundPoint(camera,[0,y],walls),expected);
    assert.equal(contains(q.polygons,[0,y]),expected);
  }
});

test('a raised wall leaves ground before its projected base visible',()=>{
  const walls=[{polygon:rect(-2,5,2,6),base:2,top:6}],q=groundVisibility(camera,walls);
  for(const [y,expected] of [[7,true],[9,true],[13,false],[30,false]]) {
    assert.equal(visibleGroundPoint(camera,[0,y],walls),expected);
    assert.equal(contains(q.polygons,[0,y]),expected);
  }
});

test('walls entirely above mount height cast no downward ground shadow',()=>{
  const walls=[{polygon:rect(-20,5,20,6),base:4,top:20}];
  assert.deepEqual(groundVisibility(camera,walls).polygons,groundVisibility(camera).polygons);
});

test('multiple low walls retain separate islands and camera rotation/translation preserves area',()=>{
  const walls=[{polygon:rect(-20,5,20,6),base:0,top:2},{polygon:rect(-20,15,20,16),base:0,top:2}];
  const q=groundVisibility(camera,walls);assert.equal(q.estimated,true);assert.ok(q.polygons.length>=2);
  const angle=73*Math.PI/180, transform=p=>[100+p[0]*Math.cos(angle)+p[1]*Math.sin(angle),-300-p[0]*Math.sin(angle)+p[1]*Math.cos(angle)];
  const rotated=groundVisibility({...camera,x:100,y:-300,bearing:73},walls.map(w=>({...w,polygon:w.polygon.map(transform)})));
  assert.equal(rotated.estimated,true);near(area(rotated.polygons),area(q.polygons),2e-8);
});

test('mount clearance remains an explicit policy and can be disabled for geometry checks',()=>{
  const walls=[{polygon:[[-5,.1],[5,.1]],base:0,top:6}];
  assert.equal(visibleGroundPoint(camera,[0,10],walls),true);
  assert.equal(visibleGroundPoint(camera,[0,10],walls,{mountClearance:0}),false);
  assert.equal(contains(groundVisibility(camera,walls,{mountClearance:0}).polygons,[0,10]),false);
});

test('resource limits and clipping failures remain unavailable rather than successful empty output',()=>{
  const walls=[{polygon:rect(-5,5,5,6),base:0,top:2}];
  for(const limits of [{edges:0},{operations:0},{inputVertices:0},{outputVertices:0},{geometryVertices:0}]) {
    const q=groundVisibility(camera,walls,{limits});assert.equal(q.estimated,false);assert.equal(q.reason,'geometry-limit');assert.equal(q.polygons,null);
  }
  const broken=groundVisibility(camera,walls,{geometry:{union(){throw Error('fail');},difference(){throw Error('fail');}}});
  assert.equal(broken.estimated,false);assert.equal(broken.reason,'geometry-error');assert.equal(broken.polygons,null);
  assert.equal(groundVisibility({...camera,range:NaN}).estimated,false);
  assert.deepEqual(groundVisibility({...camera,enabled:false}).polygons,[]);
});
