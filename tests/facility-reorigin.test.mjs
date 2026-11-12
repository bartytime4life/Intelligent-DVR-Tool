import test from 'node:test';
import assert from 'node:assert/strict';
import {blankFacility,validateFacility,reoriginPlan,toLngLat} from '../src/facility.mjs';

const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const room=(id,footprint)=>({id,name:id,buildingId:'b',level:0,wallHeight:2.8,footprint});
const a=[300,200],b=[312,209],c=[306,217],d=[294,208],m=[306,204.5],n=[300,212.5];
const rotatedPlan=()=>validateFacility({...blankFacility(),name:'Rotated boundary rooms',origin:[-98,38.5],
 buildings:[{id:'b',name:'Workshop',height:6,floors:2,footprint:[a,b,c,d,a]}],rooms:[room('A',[a,m,n,d,a]),room('B',[m,b,c,n,m])]});
const near=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} vs ${expected}`);
// Algebraic reference map, independent of toLngLat/fromLngLat and the candidate.
function affine(point,oldOrigin,newOrigin){
 const rad=Math.PI/180,scale=Math.cos(newOrigin[1]*rad)/Math.cos(oldOrigin[1]*rad);
 return [scale*point[0]+(oldOrigin[0]-newOrigin[0])*111320*Math.cos(newOrigin[1]*rad),point[1]+(oldOrigin[1]-newOrigin[1])*111320];
}

test('a seven-metre origin correction preserves rotated rooms touching exterior walls',()=>{
 const plan=rotatedPlan(),before=structuredClone(plan),origin=[-97.99995,38.50005];
 const moved=validateFacility(reoriginPlan(plan,origin));
 for(const [index,item] of plan.buildings.entries())for(const [i,point] of item.footprint.entries())
  affine(point,plan.origin,origin).forEach((v,j)=>near(moved.buildings[index].footprint[i][j],v));
 const edge=moved.buildings[0].footprint,mid=moved.rooms[0].footprint[1];
 for(let j=0;j<2;j++)near(mid[j],(edge[0][j]+edge[1][j])/2,1e-12);
 assert.deepEqual(plan,before);assert.notEqual(moved.rooms[0].footprint,plan.rooms[0].footprint);
});

test('rotated boundary partitions survive longitude and latitude translations across supported latitudes',()=>{
 let cases=0;
 for(const latitude of [-79,-38.5,0,38.5,79])for(const turn of [0,17,37,90,143])for(const shift of [[.00005,.00005],[-.0001,.0002],[.001,0],[0,-.001]]){
  const angle=turn*Math.PI/180,world=([x,y])=>[500+x*Math.cos(angle)-y*Math.sin(angle),-300+x*Math.sin(angle)+y*Math.cos(angle)];
  const plan=validateFacility({...blankFacility(),origin:[10,latitude],
   buildings:[{id:'b',name:'Boundary building',height:6,floors:2,footprint:rect(0,0,30,20).map(world)}],
   rooms:[room('A',rect(0,0,12,20).map(world)),room('B',rect(12,0,18,20).map(world))]});
  const target=[plan.origin[0]+shift[0],latitude+shift[1]],moved=validateFacility(reoriginPlan(plan,target));
  for(const [i,point] of plan.rooms[0].footprint.entries())affine(point,plan.origin,target).forEach((v,j)=>near(moved.rooms[0].footprint[i][j],v));
  // Identical shared vertices remain identical numbers, without tolerance or snapping.
  assert.deepEqual(moved.rooms[0].footprint[1],moved.rooms[1].footprint[0]);
  assert.deepEqual(moved.rooms[0].footprint[2],moved.rooms[1].footprint[3]);
  cases++;
 }
 assert.equal(cases,100);
});

function completePlan(){
 const source={provider:'OpenStreetMap',id:'way/123',license:'ODbL-1.0',retrieved:'generated fixture',updated:'',heightBasis:'declared',floorsBasis:'declared'};
 const camera={id:'c',name:'Yard camera',x:-3,y:-3,z:4,bearing:30,tilt:45,hfov:90,vfov:60,range:50,enabled:true,pixelsWide:1920,channel:'NVR 1'};
 const zone=(id,footprint,extra={})=>({id,name:id,type:'restricted',footprint,enabled:true,expectedClasses:['person'],dwellSeconds:2,...extra});
 return validateFacility({...blankFacility(),name:'All feature types',
  buildings:[{id:'b',name:'Workshop',height:14,base:2,floors:3,openFloors:[2],part:true,source,footprint:rect(0,0,60,40),holes:[rect(45,25,5,5)]}],
  rooms:[room('A',rect(2,2,10,12)),room('B',rect(12,2,10,12))],
  doorways:[{id:'d',name:'Passage',buildingId:'b',level:0,roomIds:['A','B'],x:12,y:8,width:.9,height:2.1}],
  windows:[{id:'w',name:'Outside window',buildingId:'b',level:0,x:8,y:0,width:1.5,height:1.2,sill:.5}],
  openings:[{id:'o',name:'Opening',buildingId:'b',level:1,footprint:rect(30,20,4,4)}],
  stairs:[{id:'s',name:'Stair',buildingId:'b',fromLevel:1,toLevel:0,x:30,y:8,bearing:0,width:1.2,tread:.28,risers:24,landing:1.2}],
  paths:[{id:'p',name:'Floor path',buildingId:'b',level:0,points:[[25,3],[28,5],[35,7]]}],
  zones:[zone('indoor',rect(35,30,4,4),{buildingId:'b',level:1,imageRegion:{cameraId:'c',rect:[.1,.1,.2,.2],threshold:.5,maxGap:2}}),zone('outdoor',rect(70,10,4,4))],
  labels:[{id:'l',name:'Indoor label',x:20,y:20,z:6,buildingId:'b',level:1},{id:'g',name:'Gate',x:-5,y:-5,z:0}],
  cameras:[camera],route:[[-5,-5],[30,-5],[70,15]]});
}

test('all plan geometry and metadata survive one affine change of grid',()=>{
 const plan=completePlan(),before=structuredClone(plan),target=[-97.9997,38.4997],moved=validateFacility(reoriginPlan(plan,target));
 const point=(actual,original)=>affine(original,plan.origin,target).forEach((v,j)=>near(actual[j],v));
 const ring=(actual,original)=>original.forEach((v,i)=>point(actual[i],v));
 for(const key of ['buildings','rooms','openings','zones'])for(const [i,item] of plan[key].entries()){
  ring(moved[key][i].footprint,item.footprint);
  if(item.holes)item.holes.forEach((hole,j)=>ring(moved[key][i].holes[j],hole));
  const {footprint,holes,...metadata}=item,{footprint:nextFootprint,holes:nextHoles,...nextMetadata}=moved[key][i];
  assert.deepEqual(nextMetadata,metadata);
 }
 for(const key of ['stairs','cameras','labels','doorways','windows'])for(const [i,item] of plan[key].entries()){
  point([moved[key][i].x,moved[key][i].y],[item.x,item.y]);
  const {x,y,width,...metadata}=item,{x:nx,y:ny,width:nextWidth,...nextMetadata}=moved[key][i];
  assert.deepEqual(nextMetadata,metadata);
  // Door is on a north/south wall; window is on an east/west wall.
  if(width!==undefined)near(nextWidth,key==='windows'?width*Math.cos(target[1]*Math.PI/180)/Math.cos(plan.origin[1]*Math.PI/180):width);
 }
 ring(moved.paths[0].points,plan.paths[0].points);ring(moved.route,plan.route);
 const {points,...pathMetadata}=plan.paths[0],{points:nextPoints,...nextPathMetadata}=moved.paths[0];
 assert.deepEqual(nextPathMetadata,pathMetadata);assert.equal(moved.schema,plan.schema);assert.equal(moved.name,plan.name);
 assert.deepEqual(plan,before);
});

test('no-op origins retain every coordinate and declared dimension exactly',()=>{
 for(const plan of [rotatedPlan(),completePlan()])assert.deepEqual(validateFacility(reoriginPlan(plan,[...plan.origin])),plan);
});

test('repeated latitude changes and return trips preserve validated topology and geographic positions',()=>{
 const original=rotatedPlan(),before=structuredClone(original);let current=original;
 for(let i=0;i<80;i++){
  const target=i%2===0?[-97.9995,38.5005]:[-98.0004,38.4996];
  current=validateFacility(reoriginPlan(current,target));
  for(const [j,point] of original.buildings[0].footprint.entries()){
   const expected=affine(point,original.origin,target),actual=current.buildings[0].footprint[j];
   expected.forEach((v,k)=>near(actual[k],v,3e-11));
   toLngLat(point,original.origin).forEach((v,k)=>near(toLngLat(actual,target)[k],v,3e-13));
  }
 }
 const returned=validateFacility(reoriginPlan(current,original.origin));
 original.rooms.forEach((item,i)=>item.footprint.forEach((p,j)=>p.forEach((v,k)=>near(returned.rooms[i].footprint[j][k],v,3e-11))));
 assert.deepEqual(original,before);
});

test('translation-only changes cannot shrink minimum aperture widths through endpoint cancellation',()=>{
 const plan=completePlan();plan.doorways[0].width=.4;plan.windows[0].width=.3;
 validateFacility(plan);
 const moved=validateFacility(reoriginPlan(plan,[-97.9993,38.5]));
 assert.equal(moved.doorways[0].width,.4);assert.equal(moved.windows[0].width,.3);
});

test('invalid and far origins reject without mutating the recoverable plan',()=>{
 const plan=completePlan(),before=structuredClone(plan);
 for(const origin of [null,[],[-98],[-98,38.5,0],[NaN,38.5],[-98,Infinity],['-98',38.5],[181,38.5],[-98,81]])
  assert.throws(()=>reoriginPlan(plan,origin),/valid latitude and longitude/);
 assert.throws(()=>reoriginPlan(plan,[-97.9,38.5]),/outside the 2 km local grid/);
 assert.deepEqual(plan,before);
 validateFacility(reoriginPlan(plan,[-97.99995,38.50005]));
});
