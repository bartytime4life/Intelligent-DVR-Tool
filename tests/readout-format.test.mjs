import test from 'node:test';
import assert from 'node:assert/strict';
import {formatReadoutNumber,formatCoveragePercent} from '../src/readout-format.mjs';
import {formatDistance,formatArea,formatDistanceRange,measurementLabels} from '../src/facility-measurements.mjs';
import {blankFacility,validateFacility} from '../src/facility.mjs';
import {planVisibility} from '../src/facility-visibility.mjs';
import {coverageMetrics} from '../src/facility-coverage.mjs';
import {installerRows} from '../src/facility-installer.mjs';
import {DEFAULT_SETUP,calculateSetup,validateSetup} from '../src/resources.mjs';

const n=(value,options={})=>formatReadoutNumber(value,{locale:'en-US',...options});
const camera={id:'c',name:'Boundary camera',x:0,y:0,z:4,bearing:45,tilt:0,hfov:90,vfov:60,range:300,enabled:true};
const fixture=()=>validateFacility({...blankFacility(),cameras:[camera],route:[[-.04,20],[120,20]],
 zones:[{id:'z',name:'Boundary zone',type:'restricted',enabled:true,expectedClasses:['person'],dwellSeconds:2,
  footprint:[[10,-.0001],[20,-.0001],[20,.9999],[10,.9999],[10,-.0001]]}]});
const near=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} vs ${expected}`);

test('ordinary System and facility precision remains unchanged; exact signed zero is zero',()=>{
 assert.equal(n(1234.56),'1,234.6');assert.equal(n(1),'1');assert.equal(n(1,{digits:0}),'1');
 assert.equal(formatDistance(3),'3.0 m');assert.equal(formatArea(9),'9.0 m²');
 assert.equal(n(-0),'0');assert.equal(formatDistance(-0),'0.0 m');assert.equal(formatArea(-0),'0.0 m²');
 assert.equal(formatDistanceRange(-0,0),'0.0 m–0.0 m');
});

test('small positive and negative quantities retain their sign in metric, imperial and system readouts',()=>{
 assert.equal(n(.4,{digits:0}),'0.4');assert.equal(n(.01,{digits:0}),'0.01');
 assert.equal(n(.00125),'0.001');assert.equal(n(.000108),'0.0001');
 assert.equal(formatDistance(.04),'0.04 m');assert.equal(formatDistance(-.01),'-0.01 m');
 assert.equal(formatDistance(-.01,'imperial'),'-0.03 ft');assert.equal(formatDistance(.001,'imperial'),'0.003 ft');
 assert.equal(formatArea(.001),'0.001 m²');assert.equal(formatArea(.001,'imperial'),'0.01 ft²');
 assert.equal(n(.000025,{digits:3}),'0.00003');
});

test('extreme finite inputs use bounded scientific labels instead of rounded zero',()=>{
 for(const value of [Number.MIN_VALUE,1e-300,1e-50,-Number.MIN_VALUE,-1e-300,-1e-50]){
  const shown=n(value);assert.ok(shown.length<30);assert.notEqual(Number(shown),0);
  assert.equal(Math.sign(Number(shown)),Math.sign(value));
 }
 assert.equal(n(Number.MIN_VALUE),'4.94e-324');
});

test('invalid numbers and percentages are withheld rather than rendered as zero',()=>{
 for(const value of [NaN,Infinity,-Infinity,null,undefined,'0',{},[]]){
  assert.equal(n(value),'—');assert.equal(formatCoveragePercent(value),'—');
  assert.equal(formatDistance(value),'— m');assert.equal(formatArea(value),'— m²');
 }
 assert.equal(formatDistance(NaN),'— m');assert.equal(formatArea(Infinity),'— m²');
 for(const value of [-.01,1.01])assert.equal(formatCoveragePercent(value),'—');
});

test('only exact percentage endpoints display zero or complete coverage',()=>{
 assert.equal(formatCoveragePercent(0),'0.0%');assert.equal(formatCoveragePercent(-0),'0.0%');
 assert.equal(formatCoveragePercent(1),'100.0%');assert.equal(formatCoveragePercent(.9),'90.0%');
 assert.equal(formatCoveragePercent(.1),'10.0%');assert.equal(formatCoveragePercent(.0001),'<0.1%');
 assert.equal(formatCoveragePercent(.9999),'>99.9%');
 for(const fraction of [Number.MIN_VALUE,1e-300,1e-20,1-Number.EPSILON/2,...Array.from({length:2001},(_,i)=>(i+1)/2002)]){
  const shown=formatCoveragePercent(fraction);
  assert.notEqual(shown,'0.0%');assert.notEqual(shown,'100.0%');
  if(shown==='<0.1%')assert.ok(fraction*100<.1);
  if(shown==='>99.9%')assert.ok(fraction*100>99.9);
 }
});

test('actual pinhole planning retains the independent 40mm route gap and positive blind zone',()=>{
 const plan=fixture(),before=structuredClone(plan),snapshot=planVisibility(plan);
 const cameras=new Map(snapshot.cameras.map(c=>[c.id,c])),metrics=coverageMetrics(plan,c=>cameras.get(c.id));
 // At bearing45°, tilt0°, HFOV90° the side planes are x=0 and y=0.
 // Vertical/range limits do not bind: the route has .04m outside x=0;
 // the10m² zone has a10m×.0001m strip below y=0.
 near(metrics.route.length,120.04);near(metrics.route.uncoveredLength,.04);near(metrics.route.coverage,3000/3001);
 near(metrics.zones[0].uncoveredArea,.001);near(metrics.zones[0].coverage,9999/10000);
 assert.equal(formatCoveragePercent(metrics.route.coverage),'>99.9%');
 assert.equal(formatCoveragePercent(metrics.zones[0].coverage),'>99.9%');
 assert.equal(formatDistance(metrics.route.uncoveredLength),'0.04 m');
 assert.equal(formatDistance(metrics.route.longestBlindStretch),'0.04 m');
 assert.ok(metrics.zones[0].blindSpots.length>0);
 const short={...plan,route:[[0,0],[.04,0]]};
 assert.ok(measurementLabels(short,null).some(label=>label.text==='Route 0.04 m'));
 assert.deepEqual(plan,before);assert.deepEqual(validateFacility(JSON.parse(JSON.stringify(plan))),before);
});

test('the printable installer keeps signed coordinates and distinct steep-camera ground ranges',()=>{
 const plan=validateFacility({...blankFacility(),cameras:[{...camera,x:-.01,y:.01,z:.5,tilt:89,vfov:5,range:1,pixelsWide:1920}]});
 const before=structuredClone(plan),metric=installerRows(plan)[0],imperial=installerRows(plan,'imperial')[0];
 assert.equal(metric.east,'-0.01 m');assert.equal(metric.north,'0.01 m');
 assert.equal(metric.range,'1.0 m · ground 0.000 m–0.031 m');
 assert.equal(imperial.range,'3.3 ft · ground 0.0 ft–0.1 ft');
 assert.match(metric.dori[0],/^0.000 m–0.031 m/);assert.deepEqual(plan,before);
});

test('low-bitrate and small memory plans retain exact model/export values after formatting',()=>{
 const plan=structuredClone(DEFAULT_SETUP);plan.workload={cameras:1,mbps:.01,days:1,overhead:0};
 plan.compute={...plan.compute,ramGiB:2,reserveGiB:1.999,workerMiB:16,workerSlots:1,bufferMiB:2};
 plan.gpu={...plan.gpu,vramGiB:1,reserveGiB:.999,sessions:1,batch:1,modelMiB:1,workspaceMiB:0};
 const before=structuredClone(plan),result=calculateSetup(plan);
 for(const key of ['neededTB','ingressMbps','writeMBps','perDriveTBYear','workingGiB','availableGiB','gpuEstimatedGiB','gpuAvailableGiB']){
  assert.ok(result[key]>0);assert.notEqual(n(result[key],{digits:key==='ingressMbps'?0:1}),'0');
 }
 assert.equal(result.ingressMbps,.01);assert.equal(result.writeMBps,.00125);assert.equal(result.neededTB,.000108);
 assert.deepEqual(validateSetup(JSON.parse(JSON.stringify(plan))),before);assert.deepEqual(plan,before);
});
