import { coverageFan } from './facility.mjs';
import * as clipping from './facility-polygon.mjs';
// Compatibility helper for earlier radial-fan callers and generated fixtures.
// Current planning views and metrics consume the accepted visibility snapshot.
export function fanCache() {
  let walls = "", fans = new Map();
  return (obstacles) => {
    const key = JSON.stringify(obstacles);
    if (key !== walls || fans.size > 2000) { walls = key; fans = new Map(); }
    return (c) => {
      const id = [c.x, c.y, c.z, c.bearing, c.tilt, c.hfov, c.vfov, c.range, c.enabled].join(",");
      if (!fans.has(id)) fans.set(id, coverageFan(c, obstacles));
      return fans.get(id);
    };
  };
}
const bounds = ring => [0, 1, 0, 1].map((k, i) => (i < 2 ? Math.min : Math.max)(...ring.map(p => p[k])));
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export function enabledFans(plan, fanOf) {
  return plan.cameras.filter(c=>c.enabled).flatMap(c=>{
    const value=fanOf(c),polygons=Array.isArray(value) ? (hasArea(value) ? [[value]] : []) : value?.estimated ? value.polygons : [];
    return polygons.filter(p=>hasArea(p[0])).map(p=>({id:c.id,polygon:p,ring:p[0],box:bounds(p[0])}));
  });
}

// These caps bound work submitted to the synchronous clipping library, not wall
// time inside a call. The UI runs the calculation in a disposable worker.
export const ZONE_COVERAGE_LIMITS = Object.freeze({operations:3000, inputVertices:2000000, outputVertices:600000, geometryVertices:65536});
export const PLAN_COVERAGE_LIMITS = Object.freeze({operations:12000, inputVertices:4000000, outputVertices:1200000, geometryVertices:65536});
const emptyWork = () => ({operations:0, inputVertices:0, outputVertices:0, peakVertices:0});
function boundedLimits(requested, maximum) {
  return Object.fromEntries(Object.entries(maximum).map(([key, value]) => [key,
    Number.isSafeInteger(requested?.[key]) && requested[key] >= 0 ? Math.min(value, requested[key]) : value]));
}
const budget = limits => ({limits, work:emptyWork(), exhausted:false});
class GeometryLimit extends Error {}
function vertices(multi) {
  if (!Array.isArray(multi)) throw Error('Invalid polygon result.');
  let count = 0;
  for (const polygon of multi) {
    if (!Array.isArray(polygon) || !polygon.length) throw Error('Invalid polygon result.');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4 || !ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
          ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw Error('Invalid polygon result.');
      count += ring.length;
    }
  }
  return count;
}
function geometryOperation(geometry, local, shared) {
  return (method, ...input) => {
    if (shared?.exhausted) throw new GeometryLimit();
    const nonempty = input.filter(g => g.length);
    if (method === 'union' && nonempty.length < 2) return nonempty[0] || [];
    if (method === 'intersection' && nonempty.length !== input.length) return [];
    const inputSize = input.reduce((sum, value) => sum + vertices(value), 0);
    const budgets = shared ? [local, shared] : [local];
    for (const item of budgets) if (inputSize > item.limits.geometryVertices || item.work.operations + 1 > item.limits.operations ||
        item.work.inputVertices + inputSize > item.limits.inputVertices) {
      item.exhausted = true; throw new GeometryLimit();
    }
    for (const item of budgets) {
      item.work.operations++; item.work.inputVertices += inputSize;
      item.work.peakVertices = Math.max(item.work.peakVertices, inputSize);
    }
    const output = geometry[method](...input), outputSize = vertices(output);
    for (const item of budgets) {
      // Output costs are observed after the library returns. A rejected output
      // still consumed work; retain that cost rather than reporting a false cap.
      item.work.outputVertices += outputSize;
      item.work.peakVertices = Math.max(item.work.peakVertices, outputSize);
      if (outputSize > item.limits.geometryVertices || item.work.outputVertices > item.limits.outputVertices) item.exhausted = true;
    }
    if (budgets.some(item => item.exhausted)) throw new GeometryLimit();
    return output;
  };
}
function compensated(values) {
  let sum = 0, correction = 0;
  for (const value of values) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return sum + correction;
}
function ringMeasure(ring) {
  const [x, y] = ring[0], cross = [], magnitudes = [];
  for (let i = 1; i + 1 < ring.length; i++) {
    const a = (ring[i][0] - x) * (ring[i + 1][1] - y), b = (ring[i][1] - y) * (ring[i + 1][0] - x);
    cross.push(a - b); magnitudes.push(Math.abs(a) + Math.abs(b));
  }
  return {area:Math.abs(compensated(cross)) / 2, magnitude:compensated(magnitudes) / 2};
}
function multiMeasure(multi) {
  const polygons = multi.map(p => p.map(ringMeasure));
  return {area:compensated(polygons.map(p => p[0].area - compensated(p.slice(1).map(r => r.area)))),
    magnitude:compensated(polygons.flatMap(p => p.map(r => r.magnitude)))};
}

// Each leaf belongs to one distinct camera. Child camera sets are disjoint, so
// their union intersection adds exactly the points seen by >=2 cameras. A third
// camera never adds a second vote to area already counted by the overlap union.
function thresholdTwo(leaves, operate, from = 0, to = leaves.length) {
  if (to === from) return {union:[], overlap:[]};
  if (to - from === 1) return {union:leaves[from], overlap:[]};
  const middle = (from + to) >>> 1, a = thresholdTwo(leaves, operate, from, middle), b = thresholdTwo(leaves, operate, middle, to);
  return {union:operate('union', a.union, b.union),
    overlap:operate('union', a.overlap, b.overlap, operate('intersection', a.union, b.union))};
}

// Area is integrated over the drawn polygonal fans, not camera pixels or a
// survey. All geometry is copied into a local uniform frame before clipping.
export function zoneCoverage(footprint, fans, {geometry = clipping, limits, sharedBudget} = {}) {
  const local = budget(boundedLimits(limits, ZONE_COVERAGE_LIMITS));
  let cameras = 0;
  try {
    if (sharedBudget?.exhausted) throw new GeometryLimit();
    vertices([[footprint]]);
    const box = bounds(footprint), scale = Math.max(box[2] - box[0], box[3] - box[1]);
    if (!(scale > 0)) throw Error('Empty zone.');
    const origin = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const transform = ring => ring.map(p => [(p[0] - origin[0]) / scale, (p[1] - origin[1]) / scale]);
    const subject = [[transform(footprint)]], measuredSubject = multiMeasure(subject), area = measuredSubject.area;
    if (!(area > 0)) throw Error('Empty zone.');
    const lower = transform([[box[0], box[1]]])[0], upper = transform([[box[2], box[3]]])[0];
    const padding = lower.map((value, axis) => Math.max((upper[axis] - value) * .01,
      32 * Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(upper[axis]))));
    const [left, bottom] = lower.map((value, axis) => value - padding[axis]);
    const [right, top] = upper.map((value, axis) => value + padding[axis]);
    const guard = [[[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]]]];
    const operate = geometryOperation(geometry, local, sharedBudget), byCamera = new Map();
    for (const fan of fans) {
      if (!Array.isArray(fan.ring) || !fan.ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw Error('Invalid fan.');
      if (!hasArea(fan.ring)) continue;
      const polygon=fan.polygon || [fan.ring];
      vertices([polygon]);
      if (!overlaps(bounds(fan.ring), box)) continue;
      if (!byCamera.has(fan.id)) byCamera.set(fan.id, []);
      byCamera.get(fan.id).push([polygon.map(transform)]);
    }
    cameras = byCamera.size;
    const leaves = [];
    for (const fragments of byCamera.values()) {
      // The guard strictly contains the zone. Replacing every fan F by F∩guard
      // therefore preserves all threshold sets within the zone exactly, while
      // removing irrelevant near/far arcs. Its axis-aligned sides also avoid
      // reconstructing rotated subject edges at every leaf. The 1% padding is
      // per axis; the floating-point minimum only keeps the guard strictly out.
      const nearby = fragments.map(fragment => operate('intersection', guard, fragment)).filter(fragment => fragment.length);
      // Union fragments of the same camera before thresholding, so overlapping
      // fragments cannot manufacture two-camera overlap.
      const camera = operate('union', ...nearby);
      if (camera.length) leaves.push(camera);
    }
    const masks = thresholdTwo(leaves, operate);
    // Clip the final masks rather than each leaf. Repeatedly reconstructing the
    // subject boundary and then subtracting it again can create contradictory
    // floating-point intersections on otherwise ordinary rotated boundaries.
    const coveredGeometry = operate('intersection', subject, masks.union);
    const overlapGeometry = operate('intersection', subject, masks.overlap);
    const blind = masks.union.length ? operate('difference', subject, masks.union) : subject;
    const measured = [coveredGeometry, overlapGeometry, blind].map(multiMeasure);
    let [covered, overlap, uncovered] = measured.map(value => value.area);
    // Only absorb floating-point closure error. Inconsistent/nonfinite output
    // is unavailable, never silently turned into complete or empty coverage.
    // Use the magnitudes of the cross-product terms, rather than only the net
    // area: a thin diagonal polygon subtracts large products to get a small area.
    const tolerance = 128 * Number.EPSILON * (area + measuredSubject.magnitude + compensated(measured.map(value => value.magnitude)));
    if (![covered, overlap, uncovered].every(Number.isFinite) || covered < -tolerance || overlap < -tolerance || uncovered < -tolerance ||
        covered > area + tolerance || overlap > covered + tolerance || Math.abs(covered + uncovered - area) > tolerance) throw Error('Inconsistent polygon areas.');
    covered = Math.max(0, Math.min(area, covered)); overlap = Math.max(0, Math.min(covered, overlap)); uncovered = Math.max(0, Math.min(area, uncovered));
    const squareScale = scale * scale;
    return {method:'polygon-area-v1', cameras, estimated:true, area:area * squareScale,
      coveredArea:covered * squareScale, overlapArea:overlap * squareScale, uncoveredArea:uncovered * squareScale,
      coverage:covered / area, overlap:overlap / area,
      blindSpots:blind.map(p => p.map(r => r.map(([x, y]) => [x * scale + origin[0], y * scale + origin[1]]))), work:{...local.work}};
  } catch (error) {
    return {method:'polygon-area-v1', cameras, estimated:false, estimateReason:error instanceof GeometryLimit ? 'geometry-limit' : 'geometry-error',
      area:null, coveredArea:null, overlapArea:null, uncoveredArea:null, coverage:null, overlap:null, blindSpots:null, work:{...local.work}};
  }
}
// Ignore collapsed fans, rather than promoting their zero-area traces to a
// physical footprint. Anchor the area calculation locally to avoid cancellation
// from translating a small fan near the plan's coordinate bounds.
function hasArea(ring) {
  if (ring.length < 3) return false;
  const [x, y] = ring[0];
  let area = 0, correction = 0, magnitude = 0;
  for (let i = 1; i + 1 < ring.length; i++) {
    const cross = (ring[i][0] - x) * (ring[i + 1][1] - y) - (ring[i][1] - y) * (ring[i + 1][0] - x);
    const next = area + cross;
    correction += Math.abs(area) >= Math.abs(cross) ? (area - next) + cross : (cross - next) + area;
    area = next; magnitude += Math.abs(cross);
  }
  return Math.abs(area + correction) > 16 * Number.EPSILON * magnitude;
}

function unionIntervals(intervals, epsilon) {
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const union = [];
  for (const interval of intervals) {
    const previous = union.at(-1);
    if (previous && interval[0] <= previous[1] + epsilon) previous[1] = Math.max(previous[1], interval[1]);
    else union.push([...interval]);
  }
  return union;
}

// Intersect an infinite line with a closed ring, then clip its intervals to the
// route segment. Half-open crossings preserve parity at vertices: repeated
// crossings at a tangent cancel. Collinear edges contribute boundary intervals.
function lineIntervals(ring, a, ux, uy, length, epsilon, strict=false) {
  const projected = ring.map(p => {
    const x = p[0] - a[0], y = p[1] - a[1], side = ux * y - uy * x;
    return [ux * x + uy * y, Math.abs(side) <= epsilon ? 0 : side];
  });
  const crossings = [], intervals = [], boundaries=[];
  const add = (from, to) => {
    const start = Math.max(0, Math.min(from, to)), end = Math.min(length, Math.max(from, to));
    if (end - start > epsilon) intervals.push([start, end]);
  };
  for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
    const [x, y] = projected[j], [nextX, nextY] = projected[i];
    if (y === 0 && nextY === 0) {
      if(strict) boundaries.push([Math.max(0,Math.min(x,nextX)),Math.min(length,Math.max(x,nextX))]);
      else add(x,nextX);
    }
    else if ((y > 0) !== (nextY > 0)) crossings.push(x + (nextX - x) * y / (y - nextY));
  }
  crossings.sort((a, b) => a - b);
  for (let i = 0; i + 1 < crossings.length; i += 2) add(crossings[i], crossings[i + 1]);
  return strict ? subtractIntervals(unionIntervals(intervals,epsilon),unionIntervals(boundaries.filter(([a,b])=>b>a),epsilon),epsilon) : intervals;
}

function subtractIntervals(outer,holes,epsilon) {
  const result=[];
  for(const [start,end] of outer) {
    let at=start;
    for(const [from,to] of holes) {
      if(to<=at || from>=end) continue;
      if(from-at>epsilon) result.push([at,Math.min(from,end)]);
      at=Math.max(at,to);if(at>=end)break;
    }
    if(end-at>epsilon)result.push([at,end]);
  }
  return result;
}

// Exact for the drawn polygonal fans, within floating-point arithmetic tolerance;
// this is still a ground-plane planning estimate, not measured camera visibility.
// Closed positive-area fans include collinear boundary length. Isolated visible
// points have zero measure. Repeated/backtracking route passages count separately.
export function routeCoverage(route, fans) {
  const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  const length = lengths.reduce((sum, value) => sum + value, 0);
  if (route.length < 2 || !(length > 0)) return null;
  const prepared = fans.filter(f => hasArea(f.ring)).map(f => ({ ...f, polygon:f.polygon || [f.ring],box:f.box || bounds(f.ring),
    scale:(f.polygon || [f.ring]).flat().reduce((largest,p)=>Math.max(largest,Math.abs(p[0]),Math.abs(p[1])),0) }));
  const sums = [0, 0, 0], errors = [0, 0, 0];
  let blindRun = 0, longestBlindStretch = 0, segments = 0, intersectionTests = 0;
  const addSum = (index, value) => {
    const corrected = value - errors[index], next = sums[index] + corrected;
    errors[index] = (next - sums[index]) - corrected; sums[index] = next;
  };
  const span = (distance, cameras) => {
    if (!(distance > 0)) return;
    if (cameras) { addSum(0, distance); blindRun = 0; }
    else { addSum(2, distance); blindRun += distance; longestBlindStretch = Math.max(longestBlindStretch, blindRun); }
    if (cameras > 1) addSum(1, distance);
  };
  for (let i = 0; i < lengths.length; i++) {
    const size = lengths[i];
    if (!(size > 0)) continue;
    segments++;
    const a = route[i], b = route[i + 1], ux = (b[0] - a[0]) / size, uy = (b[1] - a[1]) / size;
    const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const scale = Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]), size);
    // Only arithmetic-scale slivers coalesce, never fixed metre-sized gaps.
    // The relative cap keeps even very short nonzero routes measurable.
    let epsilon = Math.min(8 * Number.EPSILON * scale, size * 1e-10);
    const byCamera = new Map();
    for (const fan of prepared) {
      if (!overlaps(box, fan.box)) continue;
      const tolerance = Math.min(8 * Number.EPSILON * Math.max(scale, fan.scale), size * 1e-10);
      epsilon = Math.max(epsilon, tolerance);
      intersectionTests += fan.polygon.reduce((sum,ring)=>sum+ring.length-1,0);
      const outer=unionIntervals(lineIntervals(fan.ring,a,ux,uy,size,tolerance),tolerance);
      const holes=unionIntervals(fan.polygon.slice(1).flatMap(r=>lineIntervals(r,a,ux,uy,size,tolerance,true)),tolerance);
      const intervals=subtractIntervals(outer,holes,tolerance);
      if (intervals.length) {
        if (!byCamera.has(fan.id)) byCamera.set(fan.id, []);
        byCamera.get(fan.id).push(...intervals);
      }
    }
    const events = [];
    // A camera can have several overlapping rings/intervals but only one vote.
    for (const intervals of byCamera.values()) for (const [from, to] of unionIntervals(intervals, epsilon)) {
      events.push([from, 1], [to, -1]);
    }
    events.sort((a, b) => a[0] - b[0]);
    let at = 0, count = 0, event = 0;
    while (event < events.length) {
      const next = events[event][0];
      span(next - at, count);
      do { count += events[event++][1]; } while (event < events.length && events[event][0] - next <= epsilon);
      at = next;
    }
    span(size - at, count);
  }
  const [coveredLength, overlapLength, uncoveredLength] = sums;
  return {method:'arclength-intervals-v1',estimated:true,length,coveredLength,overlapLength,uncoveredLength,longestBlindStretch,
    coverage:Math.max(0, Math.min(1, coveredLength / length)), overlap:Math.max(0, Math.min(1, overlapLength / length)),
    segments, intersectionTests};
}
// Enabled ground zones and the handoff route; indoor zones are listed but never estimated.
export function coverageMetrics(plan, fanOf, {geometry = clipping, zoneLimits, planLimits} = {}) {
  const captured=new Map(plan.cameras.map(c=>[c.id,fanOf(c)]));
  const unavailable=plan.cameras.some(c=>c.enabled && !Array.isArray(captured.get(c.id)) && !captured.get(c.id)?.estimated);
  const fans=enabledFans(plan,c=>captured.get(c.id)),sharedBudget=budget(boundedLimits(planLimits,PLAN_COVERAGE_LIMITS)),cache=new Map();
  const unavailableZone=()=>({method:'polygon-area-v1',estimated:false,estimateReason:'visibility-unavailable',cameras:null,
    area:null,coveredArea:null,overlapArea:null,uncoveredArea:null,coverage:null,overlap:null,blindSpots:null});
  let cacheHits = 0;
  return {cameras:new Set(fans.map(f=>f.id)).size,
    zones:(plan.zones || []).filter(z => z.enabled).map(z => z.buildingId !== undefined ? {id:z.id, name:z.name, type:z.type, estimated:false, estimateReason:'indoor'} :
      (() => {
        if(unavailable) return {id:z.id,name:z.name,type:z.type,...unavailableZone()};
        const key = JSON.stringify(z.footprint);
        let result = cache.get(key);
        if (result) cacheHits++;
        else {
          result = zoneCoverage(z.footprint, fans, {geometry, limits:zoneLimits, sharedBudget});
          if (result.estimated) cache.set(key, result);
        }
        return {id:z.id, name:z.name, type:z.type, ...result};
      })()),
    route:unavailable ? unavailableRoute(plan.route) : routeCoverage(plan.route,fans),work:{...sharedBudget.work},cacheHits};
}
function unavailableRoute(route) {
  const length=route.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-route[i][0],p[1]-route[i][1]),0);
  return length>0 ? {method:'arclength-intervals-v1',estimated:false,estimateReason:'visibility-unavailable',length,
    coveredLength:null,overlapLength:null,uncoveredLength:null,longestBlindStretch:null,coverage:null,overlap:null} : null;
}
