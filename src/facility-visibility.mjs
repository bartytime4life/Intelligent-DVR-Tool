import * as clipping from './facility-polygon.mjs';
import {wallObstacles} from './facility.mjs';
import {acceptVisibilitySnapshot} from './facility-visibility-protocol.mjs';

// Ideal, level-ground pinhole geometry. Range is a horizontal ground radius.
// This module is deliberately independent of the map and of live camera I/O.
export const VISIBILITY_METHOD = 'pinhole-ground-shadows-v1';
export const VISIBILITY_LIMITS = Object.freeze({ edges:20000, operations:4096,
  inputVertices:2000000, outputVertices:600000, geometryVertices:65536 });
export const PLAN_VISIBILITY_LIMITS = Object.freeze({edges:2000000,operations:12000,
  inputVertices:4000000,outputVertices:1200000,geometryVertices:65536});
const emptyWork=()=>({edges:0,operations:0,inputVertices:0,outputVertices:0,peakVertices:0});
const boundedLimits=(requested,maximum)=>Object.fromEntries(Object.entries(maximum).map(([k,v])=>[k,
  Number.isSafeInteger(requested?.[k]) && requested[k]>=0 ? Math.min(v,requested[k]) : v]));
const radians = degrees => degrees * Math.PI / 180;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const validCamera = c => c && [c.x,c.y,c.z,c.bearing,c.tilt,c.hfov,c.vfov,c.range].every(Number.isFinite) &&
  typeof c.enabled==='boolean' && c.z > 0 && c.range > 0 && c.tilt >= 0 && c.tilt < 90 && c.hfov > 0 && c.hfov < 180 && c.vfov > 0 && c.vfov < 180;
function frame(c) {
  const b=radians(c.bearing), t=radians(c.tilt);
  return {sb:Math.sin(b), cb:Math.cos(b), st:Math.sin(t), ct:Math.cos(t),
    horizontal:Math.tan(radians(c.hfov/2)), vertical:Math.tan(radians(c.vfov/2))};
}
function localPoint(c, f, p) {
  const dx=p[0]-c.x, dy=p[1]-c.y;
  return [dx*f.cb-dy*f.sb, dx*f.sb+dy*f.cb];
}
function worldPoint(c, f, [x,y]) { return [c.x+x*f.cb+y*f.sb,c.y-x*f.sb+y*f.cb]; }

export function groundImageCoordinates(c, p) {
  if (!validCamera(c) || !finitePoint(p)) return null;
  const f=frame(c), [right,forward]=localPoint(c,f,p), depth=forward*f.ct+c.z*f.st;
  const down=c.z*f.ct-forward*f.st;
  return {right,forward,depth,down, imageX:depth>0 ? right/depth : null,
    imageY:depth>0 ? down/depth : null};
}
export function inGroundFrustum(c, p) {
  const q=groundImageCoordinates(c,p);
  if (!q || !c.enabled || !(q.depth>0) || Math.hypot(q.right,q.forward)>c.range) return false;
  const f=frame(c);
  const horizontal=f.horizontal*q.depth, vertical=f.vertical*q.depth;
  // Inclusive image edges must survive elementary-function rounding, such as
  // Math.tan(pi/4)<1. This is an arithmetic-scale edge convention, not an
  // enlargement for lens/survey uncertainty or a fixed metre-sized margin.
  const within=(value,bound)=>Math.abs(value)<=bound+16*Number.EPSILON*Math.max(Math.abs(value),Math.abs(bound));
  return within(q.right,horizontal) && within(q.down,vertical);
}

// Convex clipping by a*x+b*y+d >= 0, in a camera-local unit-range frame.
// Boundaries are represented by the original planes; coordinates are not snapped.
function clipPlane(ring, [a,b,d]) {
  if (!ring.length) return [];
  const norm=Math.hypot(a,b);
  if (!norm) return d>=0 ? ring : [];
  a/=norm; b/=norm; d/=norm;
  const out=[];
  let previous=ring.at(-1), pv=a*previous[0]+b*previous[1]+d;
  for (const point of ring) {
    const value=a*point[0]+b*point[1]+d;
    if ((value>=0)!==(pv>=0)) {
      const t=pv/(pv-value);
      out.push([previous[0]+t*(point[0]-previous[0]),previous[1]+t*(point[1]-previous[1])]);
    }
    if (value>=0) out.push(point);
    previous=point; pv=value;
  }
  return out.filter((p,i)=>!i || p[0]!==out[i-1][0] || p[1]!==out[i-1][1]);
}
const close = ring => ring.length>=3 ? [...ring,ring[0]] : [];
function signedArea(ring) {
  if (ring.length<3) return 0;
  const [x,y]=ring[0]; let sum=0, correction=0;
  for(let i=1;i+1<ring.length;i++) {
    const value=(ring[i][0]-x)*(ring[i+1][1]-y)-(ring[i][1]-y)*(ring[i+1][0]-x);
    const next=sum+value; correction+=Math.abs(sum)>=Math.abs(value) ? (sum-next)+value : (value-next)+sum; sum=next;
  }
  return (sum+correction)/2;
}
// Only an exact zero is removable. For a floating sum of zero, fall back to
// integer arithmetic on the represented binary64 coordinates; retain any
// genuine positive-width feature, however small, without a snapping tolerance.
const floatBits=new DataView(new ArrayBuffer(8));
function dyadic(value) {
  floatBits.setFloat64(0,value);
  const bits=floatBits.getBigUint64(0),exponent=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);
  return {m:(bits>>63n ? -1n : 1n)*(exponent ? (1n<<52n)+fraction : fraction),e:exponent ? exponent-1075 : -1074};
}
function exactZeroArea(ring) {
  if(signedArea(ring)!==0) return false;
  const parts=ring.map(p=>p.map(dyadic)),exponents=parts.flat().filter(x=>x.m!==0n).map(x=>x.e);
  const minimum=exponents.length ? Math.min(...exponents) : 0;
  const integers=parts.map(p=>p.map(x=>x.m===0n ? 0n : x.m<<BigInt(x.e-minimum)));
  let sum=0n;
  for(let i=1;i<integers.length;i++)sum+=integers[i-1][0]*integers[i][1]-integers[i-1][1]*integers[i][0];
  return sum===0n;
}
function cleanRing(ring) {
  const points=ring.filter((p,i)=>!i || p[0]!==ring[i-1][0] || p[1]!==ring[i-1][1]);
  if(points.length>1 && points[0][0]===points.at(-1)[0] && points[0][1]===points.at(-1)[1])points.pop();
  if(points.length<3) return null;
  const closed=[...points,points[0]];
  return exactZeroArea(closed) ? null : closed;
}
function openFrustum(c,f,segments,clip=clipPlane) {
  let ring=Array.from({length:segments},(_,i)=>{const a=2*Math.PI*i/segments;return [Math.cos(a),Math.sin(a)];});
  const h=c.z/c.range, H=f.horizontal, V=f.vertical;
  const planes=[[0,f.ct,h*f.st],[-1,H*f.ct,H*h*f.st],[1,H*f.ct,H*h*f.st],
    [0,f.st+V*f.ct,V*h*f.st-h*f.ct],[0,V*f.ct-f.st,V*h*f.st+h*f.ct]];
  for(const plane of planes) ring=clip(ring,plane);
  return ring;
}
function segmentDistance(a,b) {
  const e=subtract(b,a), squared=e[0]*e[0]+e[1]*e[1];
  const t=squared ? Math.max(0,Math.min(1,-(a[0]*e[0]+a[1]*e[1])/squared)) : 0;
  return Math.hypot(a[0]+t*e[0],a[1]+t*e[1]);
}
function wallShadow(c,a,b,base,top,clip=clipPlane) {
  if (base>=c.z || top<=base) return null;
  let determinant=cross(a,b);
  if (!determinant) return null; // A radial face has no positive-area shadow.
  if (determinant<0) { [a,b]=[b,a]; determinant=-determinant; }
  const e=subtract(b,a), lower=c.z/(c.z-base);
  // On the guard |x|,|y|<=1.01, the wall-line scale cannot exceed
  // 1.01*(|edge.x|+|edge.y|)/cross(a,b). A farther edge is outside
  // the guard, including when the physical shadow extends to infinity.
  const guardMaximum=1.01*(Math.abs(e[0])+Math.abs(e[1]))/determinant;
  if(lower>guardMaximum) return [];
  const upper=Math.min(top<c.z ? c.z/(c.z-top) : Infinity,guardMaximum+1);
  let ring=[a.map(x=>x*lower),b.map(x=>x*lower),b.map(x=>x*upper),a.map(x=>x*upper)];
  for(const plane of [[1,0,1.01],[-1,0,1.01],[0,1,1.01],[0,-1,1.01]]) ring=clip(ring,plane);
  return ring;
}
class GeometryLimit extends Error {}
function countVertices(multi) {
  if(!Array.isArray(multi)) throw Error('Invalid polygon output.');
  let total=0;
  for(const polygon of multi) {
    if(!Array.isArray(polygon) || !polygon.length) throw Error('Invalid polygon output.');
    for(const ring of polygon) {
      if(!Array.isArray(ring) || ring.length<4 || !ring.every(finitePoint) ||
          ring[0][0]!==ring.at(-1)[0] || ring[0][1]!==ring.at(-1)[1]) throw Error('Invalid polygon output.');
      total+=ring.length;
    }
  }
  return total;
}

// Full MultiPolygon output is necessary: low/raised walls can leave visible
// ground beyond their shadow, and several shadows can disconnect the footprint.
export function groundVisibility(c, obstacles=[], {segments=256,limits,geometry=clipping,mountClearance=.5,sharedBudget}={}) {
  const work=emptyWork();
  const unavailable=reason=>({method:VISIBILITY_METHOD,estimated:false,reason,polygons:null,work});
  try {
    if(!validCamera(c) || !Array.isArray(obstacles) || !Number.isInteger(segments) || segments<16 || segments>2048 ||
        !Number.isFinite(mountClearance) || mountClearance<0) throw Error('Invalid visibility input.');
    const cap=boundedLimits(limits,VISIBILITY_LIMITS), budgets=[{limits:cap,work},...(sharedBudget ? [sharedBudget] : [])];
    const chargeInput=size=>{
      for(const item of budgets) if(item.work.operations+1>item.limits.operations || size>item.limits.geometryVertices ||
          item.work.inputVertices+size>item.limits.inputVertices) { item.exhausted=true;throw new GeometryLimit(); }
      for(const item of budgets) { item.work.operations++;item.work.inputVertices+=size;item.work.peakVertices=Math.max(item.work.peakVertices,size); }
    };
    const chargeOutput=size=>{
      for(const item of budgets) {
        item.work.outputVertices+=size;item.work.peakVertices=Math.max(item.work.peakVertices,size);
        if(size>item.limits.geometryVertices || item.work.outputVertices>item.limits.outputVertices) item.exhausted=true;
      }
      if(budgets.some(item=>item.exhausted)) throw new GeometryLimit();
    };
    const clip=(ring,plane)=>{
      if(!ring.length) return [];
      chargeInput(ring.length);
      const out=clipPlane(ring,plane);chargeOutput(out.length);return out;
    };
    const f=frame(c), circleError=c.range*(1-Math.cos(Math.PI/segments));
    if(!c.enabled) return {method:VISIBILITY_METHOD,estimated:true,polygons:[],rangeChordError:circleError,work};
    if(sharedBudget?.exhausted) throw new GeometryLimit();
    const subject=openFrustum(c,f,segments,clip);
    if(subject.length<3 || exactZeroArea(close(subject))) return {method:VISIBILITY_METHOD,estimated:true,polygons:[],rangeChordError:circleError,work};
    const operate=(method,...input)=>{
      const nonempty=input.filter(x=>x.length);
      if(method==='union' && nonempty.length<2) return nonempty[0] || [];
      const size=input.reduce((sum,m)=>sum+countVertices(m),0);
      chargeInput(size);
      const out=geometry[method](...input), output=countVertices(out);
      chargeOutput(output);
      return out;
    };
    const shadows=[];
    for(const wall of obstacles) {
      if(!wall || !Array.isArray(wall.polygon) || wall.polygon.length<2 || !wall.polygon.every(finitePoint) ||
          ![wall.base,wall.top].every(Number.isFinite) || wall.base<0 || wall.top<wall.base) throw Error('Invalid wall input.');
      for(let i=1;i<wall.polygon.length;i++) {
        for(const item of budgets) if(item.work.edges+1>item.limits.edges) { item.exhausted=true;throw new GeometryLimit(); }
        for(const item of budgets) item.work.edges++;
        if(wall.base>=c.z || wall.top<=wall.base) continue;
        const worldA=localPoint(c,f,wall.polygon[i-1]), worldB=localPoint(c,f,wall.polygon[i]);
        const distance=segmentDistance(worldA,worldB);
        // Preserve the existing explicit facade-mount clearance policy.
        if(distance<=mountClearance || distance>c.range) continue;
        const a=worldA.map(x=>x/c.range), b=worldB.map(x=>x/c.range);
        // Build the mask in a strict containing square, not on the final
        // frustum/circle boundary. Reconstructing those identical curved edges
        // in each shadow can create inconsistent floating intersections.
        // F \ union(S) = F \ union(S intersect guard), since F is inside guard.
        const shadow=wallShadow(c,a,b,wall.base,wall.top,clip);
        if(!shadow) continue;
        if(shadow.length>=3 && !exactZeroArea(close(shadow))) shadows.push([[close(shadow)]]);
      }
    }
    function union(from,to) {
      if(from===to) return [];
      if(to-from===1) return shadows[from];
      const mid=(from+to)>>>1; return operate('union',union(from,mid),union(mid,to));
    }
    const mask=union(0,shadows.length), polygons=mask.length ? operate('difference',[[close(subject)]],mask) : [[close(subject)]];
    countVertices(polygons);
    const positiveArea=polygons.reduce((sum,p)=>sum+Math.abs(signedArea(p[0]))-p.slice(1).reduce((n,r)=>n+Math.abs(signedArea(r)),0),0);
    const subjectArea=Math.abs(signedArea(subject));
    const terms=polygons.flatMap(p=>p.flatMap(r=>r.slice(1).map((q,i)=>Math.abs(cross(r[i],q)))));
    const tolerance=128*Number.EPSILON*(subjectArea+terms.reduce((sum,n)=>sum+n,0));
    if(!Number.isFinite(positiveArea) || positiveArea < -tolerance || positiveArea>subjectArea+tolerance) throw Error('Inconsistent visible area.');
    if(polygons.some(p=>p.some(r=>r.some(q=>Math.hypot(q[0],q[1])>1+tolerance)))) throw Error('Visibility outside range.');
    const world=polygons.flatMap(p=>{
      const rings=p.map(r=>cleanRing(r.map(q=>worldPoint(c,f,q.map(x=>x*c.range)))));
      return rings[0] ? [[rings[0],...rings.slice(1).filter(Boolean)]] : [];
    });
    countVertices(world);
    return {method:VISIBILITY_METHOD,estimated:true,polygons:world,
      rangeChordError:circleError,work};
  } catch(error) { return unavailable(error instanceof GeometryLimit ? 'geometry-limit' : 'geometry-error'); }
}

export function planVisibility(plan,{limits,planLimits,segments=256,geometry=clipping,obstacles=wallObstacles(plan)}={}) {
  const sharedBudget={limits:boundedLimits(planLimits,PLAN_VISIBILITY_LIMITS),work:emptyWork(),exhausted:false};
  const cache=new Map(); let cacheHits=0;
  if(!Array.isArray(obstacles)) throw Error('Visibility requires the current plan wall snapshot.');
  const cameras=plan.cameras.map(c=>{
    const key=JSON.stringify([c.x,c.y,c.z,c.bearing,c.tilt,c.hfov,c.vfov,c.range,c.enabled]);
    let result=cache.get(key);
    if(result) cacheHits++;
    else {
      result=groundVisibility(c,obstacles,{limits,sharedBudget,segments,geometry});
      if(result.estimated) cache.set(key,result);
    }
    return {id:c.id,...result};
  });
  const snapshot={method:VISIBILITY_METHOD,cameras,estimated:cameras.every(c=>c.estimated),work:{...sharedBudget.work},cacheHits};
  // Pure exports receive the same structural/provenance gate as transported
  // worker replies. Structured cloning requires acceptance again in the UI.
  if(!acceptVisibilitySnapshot(snapshot,plan)) throw Error('Visibility output could not be validated.');
  return snapshot;
}

const preparedSnapshots=new WeakMap();
function prepareRing(ring) {
  let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity,scale=1,padX=0,padY=0;
  let immutable=Object.isFrozen(ring);
  for(const point of ring) {
    const [x,y]=point;
    loX=Math.min(loX,x);loY=Math.min(loY,y);hiX=Math.max(hiX,x);hiY=Math.max(hiY,y);
    scale=Math.max(scale,Math.abs(x),Math.abs(y));immutable=immutable && Object.isFrozen(point);
  }
  const edges=[];
  for(let i=1;i<ring.length;i++) {
    const [ax,ay]=ring[i-1],[bx,by]=ring[i],dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy);
    if(!length)continue; // A redundant vertex is not a boundary everywhere.
    // Cross and dot products have units of length squared. Multiplying the
    // spatial roundoff tolerance by edge length keeps short edges from growing
    // a false visibility halo. The broad phase conservatively encloses that
    // boundary test without changing original geometry or deleting tiny rings.
    const marginX=Math.abs(dx/length)+Math.abs(dy/length),marginY=marginX;
    padX=Math.max(padX,marginX);padY=Math.max(padY,marginY);
    edges.push({ax,ay,bx,by,dx,dy,squared:dx*dx+dy*dy,length,marginX,marginY,
      loX:Math.min(ax,bx),loY:Math.min(ay,by),hiX:Math.max(ax,bx),hiY:Math.max(ay,by),
      scale:Math.max(1,Math.abs(ax),Math.abs(ay),Math.abs(bx),Math.abs(by))});
  }
  // These bins index original edge extents; they never quantize coordinates.
  // Fall back to a scan when long edges would multiply index storage by >4.
  const count=Math.min(32,Math.ceil(Math.sqrt(edges.length))),height=hiY-loY;
  let bins=null;
  if(count>1 && height>0) {
    let entries=0;
    const spans=edges.map(edge=>{
      const from=Math.max(0,Math.min(count-1,Math.floor((edge.loY-loY)/height*count)));
      const to=Math.max(0,Math.min(count-1,Math.floor((edge.hiY-loY)/height*count)));
      entries+=to-from+1;return [from,to];
    });
    if(entries<=4*edges.length) {
      bins=Array.from({length:count},()=>[]);
      for(let i=0;i<spans.length;i++)for(let bin=spans[i][0];bin<=spans[i][1];bin++)bins[bin].push(i);
    }
  }
  return {edges,loX,loY,hiX,hiY,scale,padX,padY,height,bins,marks:bins ? new Uint32Array(edges.length) : null,stamp:0,immutable};
}
function prepareSnapshot(snapshot) {
  const cached=preparedSnapshots.get(snapshot);
  if(cached) return cached;
  const groups=[],entries=[],byGeometry=new Map();
  let immutable=Object.isFrozen(snapshot) && Object.isFrozen(snapshot.cameras);
  for(const camera of snapshot.cameras) {
    immutable=immutable && Object.isFrozen(camera);
    if(!camera.estimated)continue;
    let group=byGeometry.get(camera.polygons);
    if(group===undefined) {
      group=groups.length;byGeometry.set(camera.polygons,group);
      immutable=immutable && Object.isFrozen(camera.polygons);
      groups.push(camera.polygons.map(polygon=>{
        immutable=immutable && Object.isFrozen(polygon);
        return polygon.map(ring=>{const prepared=prepareRing(ring);immutable=immutable && prepared.immutable;return prepared;});
      }));
    }
    entries.push({id:camera.id,group});
  }
  const prepared={groups,entries};
  // Accepted worker/pure snapshots are deeply frozen. Mutable generated callers
  // get a fresh preparation, so changing their input cannot reuse stale edges.
  if(immutable)preparedSnapshots.set(snapshot,prepared);
  return prepared;
}
function inPreparedRing(p,ring) {
  const [x,y]=p,pointScale=Math.max(1,Math.abs(x),Math.abs(y)),tolerance=16*Number.EPSILON*Math.max(pointScale,ring.scale);
  const paddingX=2*tolerance*ring.padX,paddingY=2*tolerance*ring.padY;
  if(x<ring.loX-paddingX || x>ring.hiX+paddingX || y<ring.loY-paddingY || y>ring.hiY+paddingY)return false;
  let inside=false;
  const visit=index=>{
    const edge=ring.edges[index],qx=x-edge.ax,qy=y-edge.ay,edgeTolerance=16*Number.EPSILON*Math.max(pointScale,edge.scale);
    const px=2*edgeTolerance*edge.marginX,py=2*edgeTolerance*edge.marginY;
    if(x>=edge.loX-px && x<=edge.hiX+px && y>=edge.loY-py && y<=edge.hiY+py &&
      Math.abs(edge.dx*qy-edge.dy*qx)<=edgeTolerance*edge.length &&
      qx*edge.dx+qy*edge.dy>=-edgeTolerance*edge.length &&
      qx*edge.dx+qy*edge.dy<=edge.squared+edgeTolerance*edge.length)return true;
    if((edge.ay>y)!==(edge.by>y) && x<edge.dx*(y-edge.ay)/edge.dy+edge.ax)inside=!inside;
    return false;
  };
  if(ring.bins) {
    const count=ring.bins.length;
    const first=Math.max(0,Math.min(count-1,Math.floor((y-paddingY-ring.loY)/ring.height*count)));
    const last=Math.max(0,Math.min(count-1,Math.floor((y+paddingY-ring.loY)/ring.height*count)));
    ring.stamp=(ring.stamp+1)>>>0;
    if(!ring.stamp){ring.marks.fill(0);ring.stamp=1;}
    for(let bin=first;bin<=last;bin++)for(const index of ring.bins[bin]) {
      if(ring.marks[index]===ring.stamp)continue;
      ring.marks[index]=ring.stamp;if(visit(index))return 'boundary';
    }
  } else for(let index=0;index<ring.edges.length;index++)if(visit(index))return 'boundary';
  return inside;
}
function visiblePrepared(prepared,point) {
  const seen=prepared.groups.map(polygons=>polygons.some(polygon=>
    inPreparedRing(point,polygon[0]) && !polygon.slice(1).some(hole=>inPreparedRing(point,hole)===true)));
  const ids=[];
  // Grouping geometry must not reorder nonadjacent cameras sharing that shape.
  for(const entry of prepared.entries)if(seen[entry.group])ids.push(entry.id);
  return ids;
}
export function visibleAtPoint(snapshot,point) {
  if(!snapshot?.estimated || !finitePoint(point)) return null;
  return visiblePrepared(prepareSnapshot(snapshot),point);
}
export function rehearseVisibility(plan,snapshot,samples) {
  if(!snapshot?.estimated) return null;
  if(plan.route.length<2) return [];
  const lengths=plan.route.slice(1).map((p,i)=>Math.hypot(p[0]-plan.route[i][0],p[1]-plan.route[i][1]));
  const length=lengths.reduce((sum,n)=>sum+n,0),count=Number.isInteger(samples)&&samples>1 ? samples : Math.max(2,Math.min(601,Math.ceil(length)+1));
  const prepared=prepareSnapshot(snapshot);
  return Array.from({length:count},(_,i)=>{
    let left=i/(count-1)*length,point=plan.route[0];
    for(let j=0;j<lengths.length;j++) {
      if(left<=lengths[j] || j===lengths.length-1) {
        const fraction=lengths[j] ? left/lengths[j] : 0;
        point=plan.route[j].map((x,k)=>x+fraction*(plan.route[j+1][k]-x));break;
      }
      left-=lengths[j];
    }
    return {seconds:i/(count-1)*length/1.4,point,cameras:visiblePrepared(prepared,point)};
  });
}

// Independent of the tessellated circle: exact pinhole inequalities and a
// segment/vertical-height test for each modeled opaque wall face.
export function visibleGroundPoint(c,p,obstacles=[],{mountClearance=.5}={}) {
  if(!inGroundFrustum(c,p)) return false;
  const ray=[p[0]-c.x,p[1]-c.y], squared=ray[0]*ray[0]+ray[1]*ray[1];
  if(!squared) return true; // A downward vertical ray meets no non-mount vertical face.
  for(const wall of obstacles) for(let i=1;i<wall.polygon.length;i++) {
    const a=[wall.polygon[i-1][0]-c.x,wall.polygon[i-1][1]-c.y], b=[wall.polygon[i][0]-c.x,wall.polygon[i][1]-c.y];
    if(segmentDistance(a,b)<=mountClearance || wall.base>=c.z || wall.top<=wall.base) continue;
    const edge=subtract(b,a), den=cross(ray,edge);
    if(den) {
      const t=cross(a,edge)/den, u=cross(a,ray)/den, height=c.z*(1-t);
      if(t>0 && t<=1 && u>=0 && u<=1 && height>=wall.base && height<=wall.top) return false;
    } else if(cross(a,ray)===0) {
      const values=[a,b].map(q=>(q[0]*ray[0]+q[1]*ray[1])/squared);
      const low=Math.max(0,Math.min(...values),1-wall.top/c.z), high=Math.min(1,Math.max(...values),1-wall.base/c.z);
      if(high>0 && high>=low) return false;
    }
  }
  return true;
}
