
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
