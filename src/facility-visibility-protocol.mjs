export const VISIBILITY_TIMEOUT_MS = 10_000;
export const VISIBILITY_TASK_SCHEMA = 'intelligent-dvr-facility-visibility-task-v1';
export const VISIBILITY_SNAPSHOT_METHOD = 'pinhole-ground-shadows-v1';
// This is a wire-size limit, independent of the worker's observed work counters.
export const VISIBILITY_REPLY_LIMITS = Object.freeze({cameras:500, cameraVertices:65_536, vertices:1_200_000});
const sources = new WeakMap();
const workKeys = ['edges','operations','inputVertices','outputVertices','peakVertices'];
const validWork = work => work && workKeys.every(key => Number.isSafeInteger(work[key]) && work[key] >= 0);
const finitePoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

function ringMeasure(ring) {
  const [x,y] = ring[0];
  let sum=0, correction=0;
  for (let i=1; i+1<ring.length; i++) {
    const term=(ring[i][0]-x)*(ring[i+1][1]-y)-(ring[i+1][0]-x)*(ring[i][1]-y), next=sum+term;
    correction += Math.abs(sum)>=Math.abs(term) ? (sum-next)+term : (term-next)+sum;
    sum=next;
  }
  return (sum+correction)/2;
}

// A bounded structural/geometric wire check. The worker's geometry engine owns
// Boolean topology/conservation; this gate refuses malformed nesting, winding,
// collapsed rings, invalid hole bounds, nonfinite values and oversized replies.
export function validVisibilitySnapshot(snapshot, plan) {
  if (!snapshot || snapshot.method !== VISIBILITY_SNAPSHOT_METHOD || typeof snapshot.estimated !== 'boolean' ||
      !Array.isArray(plan?.cameras) || plan.cameras.length > VISIBILITY_REPLY_LIMITS.cameras ||
      !Array.isArray(snapshot.cameras) || snapshot.cameras.length !== plan.cameras.length || !validWork(snapshot.work) ||
      !Number.isSafeInteger(snapshot.cacheHits) || snapshot.cacheHits < 0 || snapshot.cacheHits > plan.cameras.length) return false;
  let total=0, visits=0;
  const seen=new WeakSet(), checked=new WeakMap(), ids=new Set();
  for (let index=0; index<plan.cameras.length; index++) {
    const source=plan.cameras[index], view=snapshot.cameras[index];
    if (!source || typeof source.id !== 'string' || ids.has(source.id) || !view || view.id !== source.id ||
        view.method !== VISIBILITY_SNAPSHOT_METHOD || typeof view.estimated !== 'boolean' || !validWork(view.work)) return false;
    ids.add(source.id);
    if (!view.estimated) {
      if (!source.enabled || !['geometry-limit','geometry-error'].includes(view.reason) || view.polygons !== null ||
          (view.rangeChordError != null && (!Number.isFinite(view.rangeChordError) || view.rangeChordError < 0))) return false;
      continue;
    }
    if (!Number.isFinite(view.rangeChordError) || view.rangeChordError < 0 || view.rangeChordError > source.range ||
        !Array.isArray(view.polygons) || (!source.enabled && view.polygons.length)) return false;
    const pose=[source.x,source.y,source.range].join(',');
    if (checked.get(view.polygons) === pose) continue;
    let cameraVertices=0;
    const tolerance=64*Number.EPSILON*Math.max(1,Math.abs(source.x),Math.abs(source.y),source.range);
    for (const polygon of view.polygons) {
      if (!Array.isArray(polygon) || !polygon.length) return false;
      let outerBounds, polygonArea=0;
      for (let i=0; i<polygon.length; i++) {
        const ring=polygon[i];
        if (!Array.isArray(ring) || ring.length < 4) return false;
        cameraVertices += ring.length;
        visits += ring.length;
        if (cameraVertices > VISIBILITY_REPLY_LIMITS.cameraVertices || visits > 4_000_000) return false;
        if (!seen.has(ring)) {
          seen.add(ring); total += ring.length;
          if (total > VISIBILITY_REPLY_LIMITS.vertices) return false;
        }
        let loX=Infinity, loY=Infinity, hiX=-Infinity, hiY=-Infinity;
        for (const point of ring) {
          if (!finitePoint(point) || Math.hypot(point[0]-source.x,point[1]-source.y) > source.range+tolerance) return false;
          loX=Math.min(loX,point[0]);loY=Math.min(loY,point[1]);hiX=Math.max(hiX,point[0]);hiY=Math.max(hiY,point[1]);
        }
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return false;
        const area=ringMeasure(ring);
        if (!Number.isFinite(area) || (i ? area >= 0 : area <= 0)) return false;
        if (!i) outerBounds=[loX,loY,hiX,hiY];
        else if (loX < outerBounds[0]-tolerance || loY < outerBounds[1]-tolerance ||
          hiX > outerBounds[2]+tolerance || hiY > outerBounds[3]+tolerance) return false;
        polygonArea+=area;
      }
      if (!(polygonArea > 0)) return false;
    }
    checked.set(view.polygons,pose);
  }
  return snapshot.estimated === snapshot.cameras.every(view => view.estimated);
}

export function acceptVisibilitySnapshot(snapshot, plan, stillCurrent=()=>true) {
  if (!validVisibilitySnapshot(snapshot,plan)) return false;
  const seen=new WeakSet();
  for (const view of snapshot.cameras) {
    if (view.polygons && !seen.has(view.polygons)) {
      seen.add(view.polygons);
      for (const polygon of view.polygons) {
        for (const ring of polygon) {
          if (!seen.has(ring)) { seen.add(ring);for (const point of ring) Object.freeze(point);Object.freeze(ring); }
        }
        Object.freeze(polygon);
      }
      Object.freeze(view.polygons);
    }
    Object.freeze(view.work);Object.freeze(view);
  }
  Object.freeze(snapshot.work);Object.freeze(snapshot.cameras);Object.freeze(snapshot);
  if (!stillCurrent()) return false;
  sources.set(snapshot,plan);
  return true;
}
export const visibilitySnapshotMatches = (snapshot, plan) => !!snapshot && sources.get(snapshot) === plan;
