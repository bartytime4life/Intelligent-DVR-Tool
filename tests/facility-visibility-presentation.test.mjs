import test from 'node:test';
import assert from 'node:assert/strict';
import {visibilityCollection,visibilityMesh} from '../src/facility-visibility-presentation.mjs';
import {doriArcs} from '../src/facility-dori.mjs';
import {installerPlanSVG,installerSheetHTML} from '../src/facility-installer.mjs';
import {acceptVisibilitySnapshot} from '../src/facility-visibility-protocol.mjs';
import {blankFacility,validateFacility} from '../src/facility.mjs';

const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const camera={id:'C1',name:'Planned view',x:0,y:0,z:4,bearing:0,tilt:45,hfov:90,vfov:100,range:40,enabled:true,pixelsWide:1920};
const polygons=[[rect(0,0,10,10),rect(3,3,7,7).reverse()],[rect(20,0,22,2)]];
const work=()=>({edges:0,operations:0,inputVertices:0,outputVertices:0,peakVertices:0});
const snapshot={method:'pinhole-ground-shadows-v1',estimated:true,work:work(),cacheHits:0,cameras:[{id:'C1',method:'pinhole-ground-shadows-v1',estimated:true,polygons,rangeChordError:0,work:work()}]};

test('map visibility retains every component and hole and withholds unavailable or dragged cameras',()=>{
  const before=structuredClone(polygons),result=visibilityCollection([camera],()=>snapshot.cameras[0],[-98,38],'C1');
  assert.equal(result.features.length,1);assert.equal(result.features[0].geometry.type,'MultiPolygon');
  assert.deepEqual(result.features[0].geometry.coordinates.map(p=>p.length),[2,1]);
  assert.equal(result.features[0].properties.selected,true);
  for(const geometryOf of [()=>null,()=>({estimated:false,polygons:null}),()=>({estimated:true,polygons:[]})])
    assert.deepEqual(visibilityCollection([camera],geometryOf,[-98,38],'C1').features,[]);
  assert.equal(visibilityCollection([{...camera,enabled:false}],()=>snapshot.cameras[0],[-98,38],'C1').features.length,0);
  assert.equal(visibilityCollection([camera],()=>snapshot.cameras[0],[-98,38],'C1','C1').features.length,0);
  assert.deepEqual(polygons,before);
});

test('3D ground caps triangulate separate components without covering a hole or bridging a gap',()=>{
  const before=structuredClone(polygons),mesh=visibilityMesh(camera,polygons);
  let area=0;
  for(let i=0;i<mesh.caps.length;i+=9){
    const [ax,ay,,bx,by,,cx,cy]=mesh.caps.slice(i,i+9),x=(ax+bx+cx)/3,y=(ay+by+cy)/3;
    area+=Math.abs((bx-ax)*(cy-ay)-(by-ay)*(cx-ax))/2;
    assert.ok(!(x>3 && x<7 && y>3 && y<7),'triangle centroid must not fill the hole');
    assert.ok(x<=10 || x>=20,'triangle must not bridge disconnected areas');
  }
  assert.equal(area,88);assert.equal(mesh.outlines.length,3);
  assert.equal(mesh.sides.length,12*9);assert.deepEqual(polygons,before);
  assert.deepEqual(visibilityMesh(camera,null),{caps:[],sides:[],outlines:[]});
});

test('density contours subtract hole interiors and retain disconnected components and closed hole edges',()=>{
  // fx=960; the Identify threshold depth is 3.84 m at tilt 45 degrees.
  const y=(3.84-4*Math.SQRT1_2)/Math.SQRT1_2;
  const geometry=[[rect(-3,y-1,3,y+1),rect(-1,y-.5,1,y+.5)]];
  const before=structuredClone(geometry),identify=doriArcs(camera,geometry).find(b=>b.id==='identify');
  assert.equal(identify.lines.length,2);
  assert.ok(Math.abs(identify.lines[0][0][0]+3)<1e-12);assert.ok(Math.abs(identify.lines[0][1][0]+1)<1e-12);
  assert.ok(Math.abs(identify.lines[1][0][0]-1)<1e-12);assert.ok(Math.abs(identify.lines[1][1][0]-3)<1e-12);
  assert.deepEqual(geometry,before);
  const separate=doriArcs(camera,[[rect(-3,y-1,-2,y+1)],[rect(2,y-1,3,y+1)]]).find(b=>b.id==='identify');
  assert.equal(separate.lines.length,2);assert.equal(separate.lines[0][1][0],-2);assert.equal(separate.lines[1][0][0],2);
  const edge=doriArcs(camera,[[rect(-3,y-1,3,y+1),rect(-1,y,1,y+.5)]]).find(b=>b.id==='identify');
  assert.equal(edge.lines.length,1,'closed hole boundary remains visible');
  assert.ok(Math.abs(edge.lines[0][0][0]+3)<1e-12);assert.ok(Math.abs(edge.lines[0][1][0]-3)<1e-12);
  assert.deepEqual(doriArcs(camera,null),[]);
});

test('rearward density contours are independent of forward-only centreline table reach',()=>{
  const y=-.006,tilt=60*Math.PI/180,depth=4*Math.sin(tilt)+y*Math.cos(tilt);
  const c={...camera,tilt:60,vfov:80,hfov:2*Math.atan(1920/(2*250*depth))*180/Math.PI};
  const band=doriArcs(c,[[rect(-.01,-.01,.01,-.001)]]).find(b=>b.id==='identify');
  assert.ok(band);assert.equal(band.reached,false);assert.ok(band.lines[0].every(p=>p[1]<0));
});

test('installer uses supplied full visibility only and explicitly withholds missing or partial geometry',()=>{
  const plan=validateFacility({...blankFacility(),cameras:[camera]});
  assert.equal(acceptVisibilitySnapshot(snapshot,plan),true);
  const svg=installerPlanSVG(plan,'metric',snapshot);
  const fans=[...svg.matchAll(/<path class="fan"[^>]+>/g)].map(m=>m[0]);
  assert.equal(fans.length,2);assert.ok(fans.every(p=>p.includes('fill-rule="evenodd"')));
  assert.equal((fans[0].match(/M/g)||[]).length,2,'outer ring and hole share one evenodd path');
  assert.match(installerSheetHTML(structuredClone(plan),{snapshot}),/Estimated camera views unavailable/,'even an equal-looking unbound plan cannot borrow a snapshot');
  const ready=installerSheetHTML(plan,{snapshot,generatedAt:'generated fixture'});
  assert.match(ready,/pinhole-ground-shadows-v1/);assert.doesNotMatch(ready,/camera views unavailable/);
  for(const value of [undefined,{...snapshot,estimated:false},{...snapshot,cameras:[]}]){
    const html=installerSheetHTML(plan,{snapshot:value});
    assert.match(html,/Estimated camera views unavailable/);assert.doesNotMatch(html,/<path class="fan"/);
    assert.match(html,/forward centreline/);assert.match(html,/default-src 'none'/);
  }
});

// Within protocol budgets, a saved plan can exceed JavaScript's argument-count
// limit. Export bounds must iterate rather than spread all vertices into min/max.
test('installer handles an accepted aggregate above 150,000 vertices without argument overflow',()=>{
  const ring=Array.from({length:60000},(_,i)=>[10*Math.cos(i*2*Math.PI/60000),10*Math.sin(i*2*Math.PI/60000)]);ring.push(ring[0]);
  const plan=validateFacility({...blankFacility(),cameras:[camera,{...camera,id:'C2'},{...camera,id:'C3'}]});
  const value={method:'pinhole-ground-shadows-v1',estimated:true,work:work(),cacheHits:0,cameras:plan.cameras.map(c=>({id:c.id,method:'pinhole-ground-shadows-v1',estimated:true,polygons:[[ring]],rangeChordError:0,work:work()}))};
  assert.equal(acceptVisibilitySnapshot(value,plan),true);
  const svg=installerPlanSVG(plan,'metric',value);
  assert.equal((svg.match(/<path class="fan"/g)||[]).length,3);
  assert.doesNotMatch(svg,/NaN|Infinity/);
});
