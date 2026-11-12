import fs from 'node:fs';
import {coverageMetrics} from '../../../../src/facility-coverage.mjs';
import {sha,readRepo,frozen,sourceCapture,finish} from './replay-support.mjs';
const capture=sourceCapture(['src/facility-coverage.mjs','src/facility-polygon.mjs','src/facility.mjs','node_modules/polyclip-ts/dist/esm/index.js','node_modules/bignumber.js/bignumber.mjs','node_modules/splaytree-ts/dist/esm/index.js']);
const source=readRepo('src/facility-coverage.mjs');
const rect=([a,b,c,d])=>[[a,b],[c,b],[c,d],[a,d],[a,b]];
const inRect=(p,r,strict=false)=>strict ? p[0]>r[0]&&p[0]<r[2]&&p[1]>r[1]&&p[1]<r[3] : p[0]>=r[0]&&p[0]<=r[2]&&p[1]>=r[1]&&p[1]<=r[3];
const sees=(parts,p)=>parts.some(part=>inRect(p,part.outer)&&!(part.hole&&inRect(p,part.hole,true)));
const membership=(views,p)=>views.filter(parts=>sees(parts,p)).length;
function expectedArea(views) {
 const bounds=views.flatMap(parts=>parts.flatMap(p=>[p.outer,...(p.hole?[p.hole]:[])]));
 const xs=[...new Set([0,20,...bounds.flatMap(r=>[r[0],r[2]])].filter(x=>x>=0&&x<=20))].sort((a,b)=>a-b);
 const ys=[...new Set([0,20,...bounds.flatMap(r=>[r[1],r[3]])].filter(y=>y>=0&&y<=20))].sort((a,b)=>a-b);
 let covered=0,overlap=0;
 for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++) {
  const n=membership(views,[(xs[i-1]+xs[i])/2,(ys[j-1]+ys[j])/2]),area=(xs[i]-xs[i-1])*(ys[j]-ys[j-1]);
  if(n)covered+=area;if(n>=2)overlap+=area;
 }
 return {coveredArea:covered,overlapArea:overlap,uncoveredArea:400-covered,coverage:covered/400,overlap:overlap/400};
}
function expectedRoute(views,route) {
 const bounds=views.flatMap(parts=>parts.flatMap(p=>[p.outer,...(p.hole?[p.hole]:[])]));
 let coveredLength=0,overlapLength=0,uncoveredLength=0,longestBlindStretch=0,run=0,length=0;
 for(let i=1;i<route.length;i++) {
  const a=route[i-1],b=route[i],d=[b[0]-a[0],b[1]-a[1]],size=Math.hypot(...d);length+=size;if(!size)continue;
  const splits=[0,1];for(const r of bounds)for(let k=0;k<2;k++)if(d[k])for(const edge of [r[k],r[k+2]]){const t=(edge-a[k])/d[k];if(t>0&&t<1)splits.push(t);}
  const sorted=[...new Set(splits)].sort((x,y)=>x-y);
  for(let j=1;j<sorted.length;j++) {
   const t=(sorted[j]+sorted[j-1])/2,p=a.map((x,k)=>x+t*d[k]),count=membership(views,p),span=(sorted[j]-sorted[j-1])*size;
   if(count){coveredLength+=span;run=0;}else{uncoveredLength+=span;run+=span;longestBlindStretch=Math.max(run,longestBlindStretch);}if(count>1)overlapLength+=span;
  }
 }
 return {length,coveredLength,overlapLength,uncoveredLength,longestBlindStretch,coverage:coveredLength/length,overlap:overlapLength/length};
}
const inputBytes=frozen('adapter-inputs.json.gz','1fe9c7a10c2cb1fc23d699b19c6ab221bc506d287c52055bbdb095e37d1801b5'),inputs=JSON.parse(inputBytes);
const failures=[];let assertions=0;const start=performance.now();
for(let i=0;i<inputs.length;i++)for(const bearing of [0,73,137]) {
 const {views,route}=inputs[i],angle=bearing*Math.PI/180;
 const transform=([x,y])=>[1750+x*Math.cos(angle)+y*Math.sin(angle),-1700-x*Math.sin(angle)+y*Math.cos(angle)];
 const cameras=views.map((_,j)=>({id:'C'+j,x:1750,y:-1700,z:4,bearing,tilt:30,hfov:90,vfov:60,range:100,enabled:true}));
 const polygonViews=views.map(parts=>({estimated:true,polygons:parts.map(part=>[rect(part.outer).map(transform),...(part.hole?[rect(part.hole).reverse().map(transform)]:[])])}));
 const plan={cameras,zones:[{id:'z',enabled:true,footprint:rect([0,0,20,20]).map(transform)}],route:route.map(transform)};
 const metric=coverageMetrics(plan,c=>polygonViews[+c.id.slice(1)]),area=expectedArea(views),r=expectedRoute(views,route);
 assertions++;if(!metric.zones[0].estimated){failures.push({i,bearing,kind:'unavailable',metric});continue;}
 for(const [field,want]of Object.entries(area)){assertions++;if(Math.abs(metric.zones[0][field]-want)>1e-7)failures.push({i,bearing,field,actual:metric.zones[0][field],want});}
 for(const [field,want]of Object.entries(r)){assertions++;if(Math.abs(metric.route[field]-want)>1e-7)failures.push({i,bearing,field,actual:metric.route[field],want});}
}
const receipt={cases:inputs.length,poses:3,assertions,failures,inputSha256:sha(inputBytes),coverageSha256:sha(source),scriptSha256:sha(fs.readFileSync(new URL(import.meta.url))),sources:capture.hashes,sourceUnchanged:capture.unchanged(),elapsedMs:performance.now()-start,
 limits:'Independent axis-rectangle cell-area and boundary-split arclength oracle. Generated MultiPolygon adapter contracts, including overlaps/fragments/holes; not camera optical or real-world calibration proof.'};
finish(receipt,'dvr-frustum-adapter-replay.json');
