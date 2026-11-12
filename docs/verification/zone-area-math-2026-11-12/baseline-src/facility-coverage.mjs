import { coverageFan, pointInPolygon } from './facility.mjs';
// Fans are cached per camera geometry and reset whenever the wall set changes; the map and metrics share one cache.
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
// Ground-plane zones retain their bounded grid; route metrics integrate arclength.
export const MAX_COVERAGE_CELLS = 20000, MIN_CELL = .25;
const bounds = ring => [0, 1, 0, 1].map((k, i) => (i < 2 ? Math.min : Math.max)(...ring.map(p => p[k])));
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export function enabledFans(plan, fanOf) {
  return plan.cameras.filter(c => c.enabled).map(c => ({id:c.id, ring:fanOf(c)})).filter(f => f.ring.length > 3).map(f => ({...f, box:bounds(f.ring)}));
}
// Counts cameras seeing p, stopping at two (overlap needs no more).
function seenBy(p, fans) {
  let n = 0;
  for (const f of fans) if (p[0] >= f.box[0] && p[0] <= f.box[2] && p[1] >= f.box[1] && p[1] <= f.box[3] && pointInPolygon(p, f.ring) && ++n > 1) break;
  return n;
}
export function zoneCoverage(footprint, fans, {maxCells = MAX_COVERAGE_CELLS, blindSpots = false} = {}) {
  const box = bounds(footprint), w = box[2] - box[0], h = box[3] - box[1];
  let cell = Math.max(MIN_CELL, Math.sqrt(w * h / maxCells));
  while (Math.ceil(w / cell) * Math.ceil(h / cell) > maxCells) cell *= 1.01;
  const nx = Math.ceil(w / cell), ny = Math.ceil(h / cell), near = fans.filter(f => overlaps(f.box, box)), gaps = [];
  // Fit the grid to the bounds. A zone narrower than the target spacing still
  // needs an interior column, and edge cells must not extend past its bounds.
  const cellWidth = w / nx, cellHeight = h / ny;
  let cells = 0, covered = 0, overlap = 0;
  for (let j = 0; j < ny; j++) {
    const bottom = box[1] + j * cellHeight, top = j === ny - 1 ? box[3] : box[1] + (j + 1) * cellHeight;
    const y = (bottom + top) / 2;
    let run = null;
    const close = () => { if (run) gaps.push([[run[0], bottom], [run[1], bottom], [run[1], top], [run[0], top], [run[0], bottom]]); run = null; };
    for (let i = 0; i < nx; i++) {
      const left = box[0] + i * cellWidth, right = i === nx - 1 ? box[2] : box[0] + (i + 1) * cellWidth;
      const x = (left + right) / 2, inside = pointInPolygon([x, y], footprint), n = inside ? seenBy([x, y], near) : 0;
      if (inside) { cells++; if (n) covered++; if (n > 1) overlap++; }
      // Uncovered cells merge into row runs so the overlay stays a few rectangles, not thousands.
      if (blindSpots) { if (inside && !n) run = run ? [run[0], right] : [left, right]; else close(); }
    }
    if (blindSpots) close();
  }
  return {cells, cell, cellWidth, cellHeight, cameras:near.length, estimated:cells > 0,
    ...(cells ? {} : {estimateReason:'no-interior-samples'}),
    coverage:cells ? covered / cells : null, overlap:cells ? overlap / cells : null, ...(blindSpots ? {blindSpots:gaps} : {})};
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
function lineIntervals(ring, a, ux, uy, length, epsilon) {
  const projected = ring.map(p => {
    const x = p[0] - a[0], y = p[1] - a[1], side = ux * y - uy * x;
    return [ux * x + uy * y, Math.abs(side) <= epsilon ? 0 : side];
  });
  const crossings = [], intervals = [];
  const add = (from, to) => {
    const start = Math.max(0, Math.min(from, to)), end = Math.min(length, Math.max(from, to));
    if (end - start > epsilon) intervals.push([start, end]);
  };
  for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
    const [x, y] = projected[j], [nextX, nextY] = projected[i];
    if (y === 0 && nextY === 0) add(x, nextX);
    else if ((y > 0) !== (nextY > 0)) crossings.push(x + (nextX - x) * y / (y - nextY));
  }
  crossings.sort((a, b) => a - b);
  for (let i = 0; i + 1 < crossings.length; i += 2) add(crossings[i], crossings[i + 1]);
  return intervals;
}

// Exact for the drawn polygonal fans, within floating-point arithmetic tolerance;
// this is still a ground-plane planning estimate, not measured camera visibility.
// Closed positive-area fans include collinear boundary length. Isolated visible
// points have zero measure. Repeated/backtracking route passages count separately.
export function routeCoverage(route, fans) {
  const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  const length = lengths.reduce((sum, value) => sum + value, 0);
  if (route.length < 2 || !(length > 0)) return null;
  const prepared = fans.filter(f => hasArea(f.ring)).map(f => ({ ...f, box: f.box || bounds(f.ring),
    scale: f.ring.reduce((largest, p) => Math.max(largest, Math.abs(p[0]), Math.abs(p[1])), 0) }));
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
      intersectionTests += fan.ring.length - (fan.ring[0][0] === fan.ring.at(-1)[0] && fan.ring[0][1] === fan.ring.at(-1)[1] ? 1 : 0);
      const intervals = lineIntervals(fan.ring, a, ux, uy, size, tolerance);
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
  return {method:'arclength-intervals-v1', length, coveredLength, overlapLength, uncoveredLength, longestBlindStretch,
    coverage:Math.max(0, Math.min(1, coveredLength / length)), overlap:Math.max(0, Math.min(1, overlapLength / length)),
    segments, intersectionTests};
}
// Enabled ground zones and the handoff route; indoor zones are listed but never estimated.
export function coverageMetrics(plan, fanOf) {
  const fans = enabledFans(plan, fanOf);
  return {cameras:fans.length,
    zones:(plan.zones || []).filter(z => z.enabled).map(z => z.buildingId !== undefined ? {id:z.id, name:z.name, type:z.type, estimated:false, estimateReason:'indoor'} :
      {id:z.id, name:z.name, type:z.type, ...zoneCoverage(z.footprint, fans)}),
    route:routeCoverage(plan.route, fans)};
}
