
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPlanarCalibration,projectGround,insideReferenceHull,calibratedGroundDistance} from '../src/facility-calibration.mjs';
const truth=[10,2,3,-3,8,7,.2,-.1,1];
const fit=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]].map(([x,y])=>{
  const [e,n]=projectGround(truth,[x,y]);
  return {image:{x,y},ground:{x:e,y:n},role:'fit'};
});
const holdout=([x,y])=>{const [e,n]=projectGround(truth,[x,y]);return {image:{x,y},ground:{x:e,y:n},role:'check'};};
test('calibration: exact perspective and independent holdout solve to near-zero residual',()=>{
 const result=fitPlanarCalibration([...fit,holdout([.45,.55])]);
 assert.equal(result.fittingCount,4); assert.equal(result.checkCount,1); assert.equal(result.verified,false);
 assert.ok(result.fit.rmse<1e-8);assert.ok(result.holdout.rmse<1e-8);
 const predicted=projectGround(result.matrix,[.2,.6]), actual=projectGround(truth,[.2,.6]);
 assert.ok(Math.hypot(predicted[0]-actual[0],predicted[1]-actual[1])<1e-7);
});
test('calibration: additional fit points and noisy holdout errors stay visible instead of being treated as accuracy',()=>{
 const extras=[[.5,.1],[.4,.7]].map(([x,y])=>{
  const [e,n]=projectGround(truth,[x,y]);return {image:{x,y},ground:{x:e,y:n},role:'fit'};
 });
 const bad=holdout([.5,.5]);bad.ground.x+=.3;
 const result=fitPlanarCalibration([...fit,...extras,bad]);
 assert.ok(result.fit.rmse<1e-8);assert.ok(result.holdout.rmse>.25);assert.equal(result.verified,false);
});
test('calibration: degenerate or coincident references are refused',()=>{
 assert.throws(()=>fitPlanarCalibration(fit.slice(0,3)),/(4 to 24|four fitting)/);
 assert.throws(()=>fitPlanarCalibration([...fit.slice(0,3),fit[0]]),/coincide/);
 const straight=[[.1,.1],[.3,.3],[.5,.5],[.7,.7]].map(([x,y])=>({role:'fit',image:{x,y},ground:{x:x*10,y:y*10}}));
 assert.throws(()=>fitPlanarCalibration(straight),/(non-collinear|degenerate|ill-conditioned)/);
 assert.throws(()=>fitPlanarCalibration(fit.map((p,i)=>({...p,ground:{x:10+i,y:20+i}}))),/(non-collinear|degenerate|ill-conditioned)/);
});
test('calibration: no extrapolation outside the reference hull or invalid projection',()=>{
 const c=fitPlanarCalibration([...fit,holdout([.5,.5])]);
 assert.equal(insideReferenceHull([.5,.5],c.fittingHull),true);
 assert.equal(insideReferenceHull([1,.5],c.fittingHull),false);
 assert.equal(calibratedGroundDistance(c,[.1,.1],[1,.5]),null);
 const d=calibratedGroundDistance(c,[.25,.25],[.75,.75]);
 assert.ok(d.metres>0);
 assert.equal(projectGround([1,0,0,0,1,0,0,0,0],[.2,.2]),null);
});
test('calibration: reference bounds and holdouts are validated',()=>{
 assert.throws(()=>fitPlanarCalibration([...fit,{role:'check',image:{x:2,y:0},ground:{x:0,y:0}}]),/out of bounds/);
 assert.throws(()=>fitPlanarCalibration([...fit,{role:'check',image:{x:.5,y:.5},ground:{x:Infinity,y:0}}]),/out of bounds/);
});

test('calibration: holdout outside fitting hull is flagged, never automatically accepted',()=>{
  const outside=holdout([.99,.99]);
  const result=fitPlanarCalibration([...fit,outside]);
  assert.equal(result.checkInsideHull,false);
  assert.ok(result.holdout.rmse<1e-8);
});

test('calibration: projective horizon inside fitting hull is rejected even when corner residuals fit',()=>{
 const horizon=[1,0,0,0,1,0,1,0,-.4];
 const markers=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]].map(([x,y])=>{
   const [east,north]=projectGround(horizon,[x,y]);
   return {role:'fit',image:{x,y},ground:{x:east,y:north}};
 });
 const [east,north]=projectGround(horizon,[.3,.3]);
 assert.throws(()=>fitPlanarCalibration([...markers,
   {role:'check',image:{x:.3,y:.3},ground:{x:east,y:north}}]),
   /projective horizon|ill-conditioned|singular/i);
});
test('calibration: a copied fitted point cannot masquerade as an independent check',()=>{
 const check={...fit[0],role:'check'};
 assert.throws(()=>fitPlanarCalibration([...fit,check]),/Independent check markers/);
 const check1=holdout([.5,.5]);
 assert.throws(()=>fitPlanarCalibration([...fit,check1,{...check1}]),/Independent check markers/);
});

const square=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]];
const reference=(mapping,[x,y],role='fit')=>{
 const [east,north]=mapping(x,y);
 return {role,image:{x,y},ground:{x:east,y:north}};
};
const nearPoint=(actual,expected,tolerance=1e-10)=>{
 assert.ok(actual,'A finite projection is required.');
 assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<tolerance,
   `${actual} must match ${expected}`);
};

test('calibration: safe zero and near-zero h33 do not require a finite image origin',()=>{
 for(const offset of [0,-1e-12,1e-12,1e-9]){
  // Independent analytic truth: its horizon x=-offset is outside this hull.
  const mapping=(x,y)=>[1/(x+offset),y/(x+offset)];
  const refs=[...square.map(p=>reference(mapping,p)),reference(mapping,[.5,.5],'check')];
  const c=fitPlanarCalibration(refs);
  assert.equal(c.method,'normalized-householder-dlt-v3');
  assert.equal(c.verified,false);assert.equal(c.checkInsideHull,true);
  assert.ok(c.fit.max<1e-10);assert.ok(c.holdout.max<1e-10);
  assert.ok(Math.abs(Math.hypot(...c.matrix)-1)<1e-14);
  assert.ok(c.matrix.every(value=>Math.abs(value)<=1));
  for(const [x,y] of [[.25,.5],[.5,.5],[.7,.6]])
   nearPoint(projectGround(c.matrix,[x,y]),mapping(x,y));
  const a=mapping(.25,.5),b=mapping(.5,.5);
  assert.ok(Math.abs(calibratedGroundDistance(c,[.25,.5],[.5,.5]).metres-
    Math.hypot(a[0]-b[0],a[1]-b[1]))<1e-10);
  assert.equal(calibratedGroundDistance(c,[.1,.5],[.5,.5]),null);
 }
});

test('calibration: projection is invariant under finite global matrix scale and sign',()=>{
 const h=[0,0,1,0,1,0,1,0,0];
 for(const scale of [-1e250,-1,-1e-250,1e-250,1,1e250]){
  for(const [x,y] of [[.2,.2],[.5,.5],[.8,.8]])
   nearPoint(projectGround(h.map(value=>value*scale),[x,y]),[1/x,y/x]);
 }
 assert.equal(projectGround(new Array(9).fill(0),[.5,.5]),null);
});

test('calibration: horizon cancellation refusal is relative to matrix scale',()=>{
 const h=[0,0,1,0,1,0,1,0,-.4];
 for(const scale of [-1e200,-1e-200,1e-200,1e200]){
  const matrix=h.map(value=>value*scale);
  assert.equal(projectGround(matrix,[.4,.5]),null);
  assert.equal(projectGround(matrix,[.4+1e-12,.5]),null);
  nearPoint(projectGround(matrix,[.2,.3]),[-5,-1.5]);
 }
});

test('calibration: normalized rank checks preserve translated planes and reference permutations',()=>{
 for(const [east,north] of [[0,0],[1900,-1900],[-1900,1900]]){
  const mapping=(x,y)=>[east+1/x,north+y/x];
  const markers=square.map(p=>reference(mapping,p));
  for(const indices of [[0,1,2,3],[3,2,1,0],[2,0,3,1]]){
   const c=fitPlanarCalibration([...indices.map(i=>markers[i]),reference(mapping,[.5,.5],'check')]);
   assert.ok(c.fit.max<1e-9);assert.ok(c.holdout.max<1e-9);
   assert.equal(c.checkInsideHull,true);
   nearPoint(projectGround(c.matrix,[.3,.6]),mapping(.3,.6),1e-9);
  }
 }
});

test('calibration: five collinear ground fits cannot enable a collapsed plane with a distinct check',()=>{
 const image=[[.1,.1],[.9,.15],[.8,.9],[.2,.8],[.4,.3]];
 for(const [east,north] of [[0,0],[1500,-1500],[-1500,1500]]){
  const mapping=x=>[east+x,north+2*x];
  const markers=image.map(p=>reference(mapping,p));
  const check=reference(mapping,[.5,.5],'check');
  assert.ok(markers.every(p=>Math.hypot(p.ground.x-check.ground.x,p.ground.y-check.ground.y)>.01));
  assert.throws(()=>fitPlanarCalibration([...markers,check]),/non-collinear|rank deficient|singular/);
 }
});

test('calibration: non-collinear noisy observations still require a nonsingular fitted plane',()=>{
 // This alternating offset is orthogonal to the linear image-y direction.
 // The least-squares fit can collapse to a line despite a 2D destination hull
 // and residuals below the default UI tolerance; residuals cannot replace rank.
 const refs=[];
 for(const x of [.2,.4,.6,.8])for(const y of [.2,.4,.6,.8]){
  const t=(y-.5)*10;
  refs.push(reference((u)=>[u,2*u+.001*t*(t*t-8.2)],[x,y]));
 }
 refs.push(reference(x=>[x,2*x],[.5,.5],'check'));
 assert.throws(()=>fitPlanarCalibration(refs),/singular|rank deficient/);
});

test('calibration: a short reference edge cannot authorize an outside ruler or holdout',()=>{
 const mapping=(x,y)=>[.01*x/(2-x-y),.01*y/(2-x-y)];
 const points=[[0,0],[1,0],[1,.9999],[.9999,1],[0,1]];
 const refs=points.map(p=>reference(mapping,p));
 const outside=[.999954,.999954];
 const c=fitPlanarCalibration([...refs,reference(mapping,[.9,.9],'check')]);
 assert.ok(c.fit.max<1e-6);assert.ok(c.holdout.max<1e-6);
 assert.equal(c.checkInsideHull,true);
 assert.equal(insideReferenceHull(outside,c.fittingHull),false);
 assert.equal(calibratedGroundDistance(c,[.9,.9],outside),null);
 assert.ok(calibratedGroundDistance(c,[.9,.9],[.99,.99]).metres>0);
 const unchecked=fitPlanarCalibration([...refs,reference(mapping,outside,'check')]);
 assert.ok(unchecked.holdout.max<1e-6);
 assert.equal(unchecked.checkInsideHull,false);
});

test('calibration: every represented positive hull turn survives while true collinearity does not',()=>{
 const mapping=(x,y)=>[100*x,100*y];
 for(const extraY of [.9,.9+1e-12,.9-1e-12]){
  const refs=[[.1,.1],[.9,.1],[.9,.9],[.1,.9],[.5,extraY]].map(p=>reference(mapping,p));
  const c=fitPlanarCalibration([...refs,reference(mapping,[.5,.5],'check')]);
  assert.equal(c.fittingHull.length,extraY>.9?5:4);
  assert.equal(insideReferenceHull([.5,extraY],c.fittingHull),true);
 }
});

test('calibration: closed hull boundaries refuse next-representable outside points without an epsilon halo',()=>{
 const bits=new DataView(new ArrayBuffer(8));
 bits.setFloat64(0,.9);bits.setBigUint64(0,bits.getBigUint64(0)+1n);
 const outside=bits.getFloat64(0), vertices=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]];
 for(const hull of [vertices,vertices.slice().reverse(),[...vertices,vertices[0],vertices[2]]]){
  assert.equal(insideReferenceHull([.9,.5],hull),true);
  assert.equal(insideReferenceHull([outside,.5],hull),false);
 }
 for(const bad of [Array(3),[[0,0],[1,0],Array(2)],[[0,0],[1,0],[2,0]]])
  assert.equal(insideReferenceHull([.5,0],bad),false);
 assert.equal(insideReferenceHull(Array(2),vertices),false);
});
