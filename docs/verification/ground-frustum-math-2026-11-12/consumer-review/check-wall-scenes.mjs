import fs from 'node:fs';
import * as robust from 'polyclip-ts';
import BigNumber from 'bignumber.js';
import {validVisibilitySnapshot,visibilitySnapshotMatches} from '../../../../src/facility-visibility-protocol.mjs';
import {sha as hash,readRepo,frozen,sourceCapture,engine,finish} from './replay-support.mjs';
const inputBytes=frozen('wall-scenes.json.gz','128b21e094b8447cb26af51780e035103217fcb3c6e887a644d4eed926e3fdbb'),cases=JSON.parse(inputBytes);
const files=['src/facility-visibility.mjs','src/facility-polygon.mjs','src/facility-visibility-protocol.mjs','src/facility.mjs','src/facility-coverage.mjs','node_modules/polyclip-ts/dist/esm/index.js','node_modules/bignumber.js/bignumber.mjs','node_modules/splaytree-ts/dist/esm/index.js'];
const capture=sourceCapture(files),evaluated=await engine(),m=evaluated.module;
const sources=capture.hashes;
function ringContains(p,r) {let q=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])q=!q;}return q;}
const contains=(multi,p)=>multi.some(poly=>ringContains(p,poly[0])&&!poly.slice(1).some(r=>ringContains(p,r)));
const ringArea=r=>Math.abs(r.slice(1).reduce((s,p,i)=>s+(r[i][0]-r[0][0])*(p[1]-r[0][1])-(p[0]-r[0][0])*(r[i][1]-r[0][1]),0))/2;
const area=multi=>multi.reduce((s,p)=>s+ringArea(p[0])-p.slice(1).reduce((q,r)=>q+ringArea(r),0),0);
// World-vector pinhole projection, independent of production clipping planes.
function expected(c,p,walls) {
 const b=c.bearing*Math.PI/180,t=c.tilt*Math.PI/180,d=[p[0]-c.x,p[1]-c.y,-c.z];
 const dot=v=>v.reduce((s,x,i)=>s+x*d[i],0);
 const depth=dot([Math.sin(b)*Math.cos(t),Math.cos(b)*Math.cos(t),-Math.sin(t)]);
 const right=dot([Math.cos(b),-Math.sin(b),0]);
 const down=dot([-Math.sin(b)*Math.sin(t),-Math.cos(b)*Math.sin(t),-Math.cos(t)]);
 if(!c.enabled || depth<=0 || Math.hypot(d[0],d[1])>c.range || Math.abs(right/depth)>Math.tan(c.hfov*Math.PI/360) || Math.abs(down/depth)>Math.tan(c.vfov*Math.PI/360))return false;
 // Frozen corpus walls are axis-aligned rectangles. Intersect their constant-x
 // or constant-y face planes rather than production cross-product intersections.
 for(const w of walls)for(let i=1;i<w.polygon.length;i++) {
  const a=w.polygon[i-1],b=w.polygon[i],axis=a[0]===b[0]?0:1,other=1-axis;
  if(a[axis]!==b[axis])throw Error('Unexpected non-axis wall corpus');
  const nearest=[0,1].map(k=>k===axis?a[k]:Math.min(Math.max([c.x,c.y][k],Math.min(a[k],b[k])),Math.max(a[k],b[k])));
  if(Math.hypot(nearest[0]-c.x,nearest[1]-c.y)<=.5 || w.base>=c.z || w.top<=w.base)continue;
  if(d[axis]===0)continue;
  const along=(a[axis]-[c.x,c.y][axis])/d[axis],coordinate=[c.x,c.y][other]+along*d[other],height=c.z*(1-along);
  if(along>0 && along<=1 && coordinate>=Math.min(a[other],b[other]) && coordinate<=Math.max(a[other],b[other]) && height>=w.base && height<=w.top)return false;
 }
 return true;
}
const failure=[],oldConfig=BigNumber.config(),results=[];let assertions=0,pointChecks=0,maxAreaDelta=0,maxArea=0,vertices=0;
const start=performance.now();
try {
 for(let i=0;i<cases.length;i++) {
  const {c:raw,walls,points}=cases[i],c={...raw,id:'C1'},plan={cameras:[c],buildings:[],rooms:[],route:[]};BigNumber.config({DECIMAL_PLACES:80,ROUNDING_MODE:BigNumber.ROUND_HALF_UP});
  const snapshot=m.planVisibility(plan,{geometry:robust,obstacles:walls}),q=snapshot.cameras[0];
  assertions++;if(!validVisibilitySnapshot(snapshot,plan)||!visibilitySnapshotMatches(snapshot,plan))failure.push({i,kind:'strict-wire-or-source-binding'});
  assertions++;if(!q.estimated){failure.push({i,kind:'unavailable80',q});continue;}
  const open=m.groundVisibility(c,[],{geometry:robust}),actualArea=area(q.polygons),openArea=area(open.polygons);
  assertions++;if(!Number.isFinite(actualArea)||actualArea<0||actualArea>openArea+1e-8)failure.push({i,kind:'area-bound',actualArea,openArea});
  maxArea=Math.max(maxArea,actualArea);
  for(const poly of q.polygons)for(const ring of poly)for(const p of ring){vertices++;assertions++;if(!p.every(Number.isFinite)||Math.hypot(p[0]-c.x,p[1]-c.y)>c.range+1e-9)failure.push({i,kind:'vertex',p});}
  for(const p of points) {
   const r=Math.hypot(p[0]-c.x,p[1]-c.y);if(r>c.range*Math.cos(Math.PI/256))continue;
   assertions++;pointChecks++;const want=expected(c,p,walls),got=contains(q.polygons,p);
   assertions++;const query=m.visibleAtPoint(snapshot,p).includes('C1');if(query!==got)failure.push({i,kind:'prepared-query',p,want:got,got:query});
   if(got!==want)failure.push({i,kind:'membership',p,want,got});
  }
  BigNumber.config({DECIMAL_PLACES:120});const snapshot120=m.planVisibility(plan,{geometry:robust,obstacles:walls}),q120=snapshot120.cameras[0];assertions++;
  if(!q120.estimated){failure.push({i,kind:'unavailable120',q120});continue;}
  const delta=Math.abs(actualArea-area(q120.polygons));maxAreaDelta=Math.max(maxAreaDelta,delta);
  if(delta>1e-8)failure.push({i,kind:'precision-area',delta});
  results.push({i,visibleArea:actualArea,unoccludedArea:openArea,areaDelta80vs120:delta,polygons:q.polygons.length,holes:q.polygons.reduce((s,p)=>s+p.length-1,0)});
 }
} finally {BigNumber.config(oldConfig);evaluated.cleanup();}
const receipt={inputSha256:hash(inputBytes),candidateSha256:evaluated.digest,baseline:evaluated.baseline,scriptSha256:hash(fs.readFileSync(new URL(import.meta.url))),
 dependencies:{polyclip:'0.16.8',bigNumber:'9.3.1',polyclipSha256:hash(readRepo('node_modules/polyclip-ts/dist/esm/index.js'))},
 cases:cases.length,assertions,pointChecks,vertices,maxAreaDelta80vs120:maxAreaDelta,maxVisibleArea:maxArea,elapsedMs:performance.now()-start,failures:failure,
 sources,sourceUnchanged:capture.unchanged(),
 configRestored:BigNumber.config().DECIMAL_PLACES===oldConfig.DECIMAL_PLACES,
 limits:'Finite ideal geometry samples; 80/120 precision agreement and area bounds do not prove exact topology or universal error bounds. Membership excludes only circle chord band. No inference or physical qualification.',results};
finish(receipt,evaluated.baseline?'dvr-frustum-baseline-replay.json':'dvr-frustum-wall-replay.json');
