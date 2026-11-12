import { groundRange } from './facility.mjs';
// IEC 62676-4 pixel-density figures used as planning thresholds only; not a compliance or recognition-quality claim.
export const DORI_BANDS = Object.freeze([
  {id:'detect',name:'Detect',ppm:25,color:'#8fb8ff'},{id:'observe',name:'Observe',ppm:62.5,color:'#7ef0d9'},
  {id:'recognize',name:'Recognize',ppm:125,color:'#ffd27a'},{id:'identify',name:'Identify',ppm:250,color:'#ff8f9a'}]);
export const PIXELS_WIDE = Object.freeze({min:320,max:7680});
export const DORI_NOTE = 'Planning estimate — assumes ideal focus and no compression';
// Typical horizontal views of common fixed lenses on 1/2.8-inch sensors; a datasheet value always wins.
export const LENS_PRESETS = Object.freeze([
  {id:'2.8',label:'2.8 mm',hfov:103},{id:'4',label:'4 mm',hfov:84},{id:'6',label:'6 mm',hfov:54},
  {id:'8',label:'8 mm',hfov:41},{id:'12',label:'12 mm',hfov:27}]);
export const lensPreset = hfov => LENS_PRESETS.find(p => p.hfov === hfov) || null;
const tanHalf = hfov => Math.tan(hfov * Math.PI / 360);
export const pixelsWideOK = v => Number.isInteger(v) && v >= PIXELS_WIDE.min && v <= PIXELS_WIDE.max;
const within = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
// Optical drafts obey the same limits as validateFacility. Position is irrelevant
// to scalar density; contours additionally require a valid map pose below.
function optics(c) {
  if (!c || !pixelsWideOK(c.pixelsWide) || !within(c.z,.5,150) || !within(c.tilt,0,89) ||
      !within(c.hfov,5,170) || !within(c.vfov,5,150) || !within(c.range,1,300)) return null;
  const tilt = c.tilt * Math.PI / 180;
  return {focal:c.pixelsWide / (2 * tanHalf(c.hfov)), sin:Math.sin(tilt), cos:Math.cos(tilt)};
}
// Horizontal image pixels per metre parallel to camera-right at positive optical
// axis depth. This parameter is Zc in u = fx*Xc/Zc + cx, not Euclidean slant range.
export function pixelsPerMetre(pixelsWide, hfov, depth) {
  const density = pixelsWideOK(pixelsWide) && within(hfov,5,170) && Number.isFinite(depth) && depth > 0
    ? (pixelsWide / (2 * tanHalf(hfov))) / depth : null;
  return Number.isFinite(density) ? density : null;
}
// Centreline forward-ground intervals only. At ground height, Zc = Y*cos(tilt)
// + z*sin(tilt), so a threshold P holds for Y <= (fx/P-z*sin(tilt))/cos(tilt).
// All supported tilts are below 90 degrees; no vertical/backward division occurs.
export function doriDistances(c) {
  const model = optics(c);
  if (!model) return null;
  const {near, far} = groundRange(c), base = c.z * model.sin;
  return DORI_BANDS.map(band => {
    const depth = model.focal / band.ppm, ground = (depth - base) / model.cos;
    // Contact within arithmetic error is not a positive-length band. Include
    // the conditioning of the depth-to-ground conversion near vertical tilt.
    const epsilon = 16 * Number.EPSILON * Math.max(depth,c.z,near * model.cos) / model.cos;
    let to = Math.max(0, Math.min(ground, far));
    if (Math.abs(ground - far) <= epsilon) to = far;
    if (Math.abs(to - near) <= epsilon) to = near;
    const reached = far - near > epsilon && to - near > epsilon;
    return {...band, depth, ground, from:near, to, reached, limited:reached && ground >= far - epsilon};
  });
}
// Density of a horizontal transverse ground target at nonnegative centreline
// forward distance. This does not assert that the point lies in the image/fan.
export function densityAtGround(c, distance) {
  const model = optics(c);
  return model && Number.isFinite(distance) && distance >= 0
    ? pixelsPerMetre(c.pixelsWide,c.hfov,distance * model.cos + c.z * model.sin) : null;
}

function positiveArea(ring) {
  const [x,y] = ring[0];
  let sum = 0, error = 0, magnitude = 0;
  for (let i=1;i+1<ring.length;i++) {
    const cross = (ring[i][0]-x)*(ring[i+1][1]-y)-(ring[i][1]-y)*(ring[i+1][0]-x), next = sum + cross;
    error += Math.abs(sum) >= Math.abs(cross) ? (sum-next)+cross : (cross-next)+sum;
    sum = next; magnitude += Math.abs(cross);
  }
  return Math.abs(sum + error) > 16 * Number.EPSILON * magnitude;
}

// Exact polygon cross-section within arithmetic tolerance. Half-open crossings
// preserve parity at vertices; positive collinear closed boundaries count, while
// isolated tangencies do not. Union fragments without bridging genuine gaps.
function crossSection(ring, y, sensorHalfWidth, epsilon) {
  const crossings = [], intervals = [];
  const add = (a,b) => {
    const from=Math.max(-sensorHalfWidth,Math.min(a,b)), to=Math.min(sensorHalfWidth,Math.max(a,b));
    if (to-from>epsilon) intervals.push([from,to]);
  };
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [x,py]=ring[j],[nx,qy]=ring[i];
    const p=Math.abs(py-y)<=epsilon?0:py-y,q=Math.abs(qy-y)<=epsilon?0:qy-y;
    if (p===0 && q===0) add(x,nx);
    else if ((p>0)!==(q>0)) crossings.push(x+(nx-x)*(p/(p-q)));
  }
  crossings.sort((a,b)=>a-b);
  for (let i=0;i+1<crossings.length;i+=2) add(crossings[i],crossings[i+1]);
  intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const union=[];
  for (const interval of intervals) {
    const previous=union.at(-1);
    if (previous && interval[0]<=previous[1]+epsilon) previous[1]=Math.max(previous[1],interval[1]);
    else union.push(interval);
  }
  return union;
}

function unionSpans(intervals, epsilon) {
  intervals.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  const result=[];
  for(const interval of intervals) {
    const previous=result.at(-1);
    if(previous && interval[0]<=previous[1]+epsilon) previous[1]=Math.max(previous[1],interval[1]);
    else result.push(interval.slice());
  }
  return result;
}
function subtractSpans(source, holes, epsilon) {
  let result=source;
  for(const [left,right] of holes) result=result.flatMap(([from,to])=>{
    if(right<=from || left>=to) return [[from,to]];
    return [[from,Math.min(to,left)],[Math.max(from,right),to]].filter(([a,b])=>b-a>epsilon);
  });
  return result;
}
function boundarySpans(ring,y,halfWidth,epsilon) {
  const result=[];
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [a,ay]=ring[j],[b,by]=ring[i];
    if(Math.abs(ay-y)<=epsilon && Math.abs(by-y)<=epsilon) {
      const from=Math.max(-halfWidth,Math.min(a,b)),to=Math.min(halfWidth,Math.max(a,b));
      if(to-from>epsilon) result.push([from,to]);
    }
  }
  return result;
}

// Equal transverse-density contours are straight local Y=constant lines. Each
// component retains its holes; regularized polygon boundaries remain visible.
// A single-ring argument is retained for existing pure geometry callers.
export function doriArcs(c, geometry) {
  const bands=doriDistances(c),model=optics(c);
  if(!bands || !within(c.x,-2000,2000) || !within(c.y,-2000,2000) || !within(c.bearing,0,359.99) || c.enabled!==true ||
      !Array.isArray(geometry) || !geometry.length) return [];
  const polygons=typeof geometry[0]?.[0]==='number' ? [[geometry]] : geometry;
  if(!polygons.every(p=>Array.isArray(p) && p.length && p.every(r=>Array.isArray(r) && r.length>=3 &&
      r.every(point=>Array.isArray(point) && point.length===2 && point.every(v=>within(v,-2300,2300)))))) return [];
  const angle=c.bearing*Math.PI/180,sin=Math.sin(angle),cos=Math.cos(angle);
  let scale=Math.max(Math.abs(c.x),Math.abs(c.y),c.z,c.range),minY=Infinity,maxY=-Infinity;
  const local=polygons.map(p=>p.map(r=>r.map(point=>{
    scale=Math.max(scale,Math.abs(point[0]),Math.abs(point[1]));
    const dx=point[0]-c.x,dy=point[1]-c.y,x=dx*cos-dy*sin,y=dx*sin+dy*cos;
    minY=Math.min(minY,y);maxY=Math.max(maxY,y);return [x,y];
  }))).filter(p=>positiveArea(p[0]));
  const world=(x,y)=>[c.x+x*cos+y*sin,c.y-x*sin+y*cos],arcs=[];
  for(const band of bands) {
    const y=band.ground,epsilon=Math.max(8*Number.EPSILON*scale,16*Number.EPSILON*Math.max(band.depth,c.z)/model.cos);
    if(y<minY-epsilon || y>maxY+epsilon) continue;
    const vertical=c.z*model.cos-y*model.sin,limit=band.depth*tanHalf(c.vfov);
    const sensorEpsilon=16*Number.EPSILON*Math.max(c.z,Math.abs(y),band.depth,limit);
    if(Math.abs(vertical)>limit+sensorEpsilon) continue;
    const halfWidth=c.pixelsWide/(2*band.ppm),pieces=[];
    for(const polygon of local) {
      const outer=crossSection(polygon[0],y,halfWidth,epsilon);
      const holes=unionSpans(polygon.slice(1).flatMap(r=>crossSection(r,y,halfWidth,epsilon)),epsilon);
      pieces.push(...subtractSpans(outer,holes,epsilon));
      // Hole edges are part of the closed regularized visible polygon. Restore
      // positive-length boundary spans, clipped to the component's outer ring.
      for(const boundary of polygon.slice(1).flatMap(r=>boundarySpans(r,y,halfWidth,epsilon)))
        for(const interval of outer) {
          const from=Math.max(boundary[0],interval[0]),to=Math.min(boundary[1],interval[1]);
          if(to-from>epsilon) pieces.push([from,to]);
        }
    }
    const intervals=unionSpans(pieces,epsilon);
    if(!intervals.length) continue;
    const longest=intervals.reduce((a,b)=>b[1]-b[0]>a[1]-a[0]?b:a);
    arcs.push({...band,lines:intervals.map(([from,to])=>[world(from,y),world(to,y)]),label:world((longest[0]+longest[1])/2,y)});
  }
  return arcs;
}
