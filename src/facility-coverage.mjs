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
// Ground-plane grid sampling: no polygon union, at most MAX_COVERAGE_CELLS samples per zone or route.
export const MAX_COVERAGE_CELLS = 20000, MIN_CELL = .25, ROUTE_STEP = .5;
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
  let cells = 0, covered = 0, overlap = 0;
  for (let j = 0; j < ny; j++) {
    const y = box[1] + (j + .5) * cell;
    let run = null;
    const close = () => { if (run) gaps.push([[run[0], y - cell / 2], [run[1], y - cell / 2], [run[1], y + cell / 2], [run[0], y + cell / 2], [run[0], y - cell / 2]]); run = null; };
    for (let i = 0; i < nx; i++) {
      const x = box[0] + (i + .5) * cell, inside = pointInPolygon([x, y], footprint), n = inside ? seenBy([x, y], near) : 0;
      if (inside) { cells++; if (n) covered++; if (n > 1) overlap++; }
      // Uncovered cells merge into row runs so the overlay stays a few rectangles, not thousands.
      if (blindSpots) { if (inside && !n) run = run ? [run[0], x + cell / 2] : [x - cell / 2, x + cell / 2]; else close(); }
    }
    if (blindSpots) close();
  }
  return {cells, cell, cameras:near.length, coverage:cells ? covered / cells : 0, overlap:cells ? overlap / cells : 0, ...(blindSpots ? {blindSpots:gaps} : {})};
}
export function routeCoverage(route, fans, {maxSamples = MAX_COVERAGE_CELLS} = {}) {
  const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1])), length = lengths.reduce((a, b) => a + b, 0);
  if (route.length < 2 || !(length > 0)) return null;
  const samples = Math.min(maxSamples, Math.max(2, Math.ceil(length / ROUTE_STEP) + 1));
  let covered = 0, overlap = 0, segment = 0, start = 0;
  for (let k = 0; k < samples; k++) {
    const at = length * k / (samples - 1);
    while (segment < lengths.length - 1 && at > start + lengths[segment]) start += lengths[segment++];
    const f = lengths[segment] ? Math.min(1, (at - start) / lengths[segment]) : 0, a = route[segment], b = route[segment + 1];
    const n = seenBy([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], fans);
    if (n) covered++; if (n > 1) overlap++;
  }
  return {samples, length, coverage:covered / samples, overlap:overlap / samples};
}
// Enabled ground zones and the handoff route; indoor zones are listed but never estimated.
export function coverageMetrics(plan, fanOf) {
  const fans = enabledFans(plan, fanOf);
  return {cameras:fans.length,
    zones:(plan.zones || []).filter(z => z.enabled).map(z => z.buildingId !== undefined ? {id:z.id, name:z.name, type:z.type, estimated:false} :
      {id:z.id, name:z.name, type:z.type, estimated:true, ...zoneCoverage(z.footprint, fans)}),
    route:routeCoverage(plan.route, fans)};
}
