const SCHEMA = "intelligent-dvr.facility.v1";
const LIMITS = { buildings: 100, cameras: 500, rooms: 500, labels: 1e3, route: 200, bytes: 2e6 };
const STEPS = [
  ["Locate site", "Set the site and map origin"],
  ["Buildings", "Draw footprints and set heights"],
  ["Floors & labels", "Name the spaces that matter"],
  ["Cameras", "Place and aim each camera"],
  ["Coverage", "Inspect visibility and blind spots"],
  ["Handoffs", "Rehearse a route between cameras"]
];
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
function exampleFacility() {
  return {
    schema: SCHEMA,
    name: "North yard \xB7 sample facility",
    origin: [-98, 38.5],
    buildings: [
      { id: "b1", name: "Warehouse", footprint: box(-58, 10, 112, 66), height: 11, floors: 1 },
      { id: "b2", name: "Office", footprint: box(-85, -74, 48, 36), height: 9.6, floors: 3 },
      { id: "b3", name: "Workshop", footprint: box(62, -55, 36, 31), height: 6, floors: 1 }
    ],
    cameras: [
      { id: "C-07", name: "Dock entrance", x: 4, y: 8, z: 4.2, bearing: 158, tilt: 22, hfov: 86, vfov: 52, range: 55, enabled: true },
      { id: "C-02", name: "Office entrance", x: -61, y: -76, z: 3, bearing: 65, tilt: 20, hfov: 90, vfov: 55, range: 45,
      enabled: true },
      { id: "C-11", name: "Yard approach", x: 90, y: -22, z: 4.5, bearing: 315, tilt: 20, hfov: 80, vfov: 50, range: 60,
      enabled: true },
      { id: "C-04", name: "North perimeter", x: -60, y: 65, z: 5, bearing: 270, tilt: 25, hfov: 82, vfov: 50, range: 50,
      enabled: true },
      { id: "C-05", name: "Warehouse east", x: 56, y: 45, z: 4, bearing: 90, tilt: 22, hfov: 86, vfov: 52, range: 45, enabled: true }
    ],
    rooms: [
      { id: "r1", name: "Reception", buildingId: "b2", level: 0, footprint: box(-83, -72, 20, 16), wallHeight: 2.8 },
      { id: "r2", name: "Hall A", buildingId: "b2", level: 0, footprint: box(-61, -72, 22, 8), wallHeight: 2.8 }
    ],
    labels: [{ id: "l1", name: "Loading yard", x: 22, y: -25, z: 0 }, { id: "l2", name: "Main gate", x: -20, y: -92, z: 0 }],
    route: [[-90, -88], [-55, -88], [-12, -55], [25, -30], [57, -15], [107, -14]]
  };
}
function blankFacility() {
  return { schema: SCHEMA, name: "My facility", origin: [-98, 38.5], buildings: [], cameras: [], rooms: [], labels: [], route: [] };
}
function uid(prefix) {
  return prefix + "-" + crypto.randomUUID().slice(0, 8);
}
const finite = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const nameOK = (s) => typeof s === "string" && s.trim().length > 0 && s.length <= 100;
const idOK = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s);
const pointOK = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => finite(v, -2e3, 2e3));
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
function polygonArea(p) {
  return Math.abs(p.slice(0, -1).reduce((a, q, i) => a + q[0] * p[i + 1][1] - p[i + 1][0] * q[1], 0)) / 2;
}
function segmentIntersection(a, b, c, d) {
  const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - c[0], d[1] - c[1]], den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-9) return null;
  const q = [c[0] - a[0], c[1] - a[1]], t = (q[0] * v[1] - q[1] * v[0]) / den, s = (q[0] * u[1] - q[1] * u[0]) / den;
  return t >= 0 && t <= 1 && s >= 0 && s <= 1 ? t : null;
}
function validPolygon(p) {
  if (!Array.isArray(p) || p.length < 4 || p.length > 201 || !p.every(pointOK) || !eq(p[0], p.at(-1)) || polygonArea(p) <
  1) return false;
  for (let i = 0; i < p.length - 1; i++) {
    if (eq(p[i], p[i + 1])) return false;
    for (let j = i + 2; j < p.length - 1; j++) {
      if (i === 0 && j === p.length - 2) continue;
      if (segmentIntersection(p[i], p[i + 1], p[j], p[j + 1]) !== null) return false;
    }
  }
  return true;
}
function validateFacility(d) {
  if (!d || d.schema !== SCHEMA || !nameOK(d.name) || !Array.isArray(d.origin) || d.origin.length !== 2 || !finite(d.origin[0],
  -180, 180) || !finite(d.origin[1], -80, 80)) throw Error("Use a facility v1 file with a valid name and map origin (lat\
itude \u221280 to 80).");
  for (const k of ["buildings", "cameras", "rooms", "labels", "route"]) if (!Array.isArray(d[k]) || d[k].length > LIMITS[k])
   throw Error("Too many or invalid " + k + ".");
  const ids = /* @__PURE__ */ new Set();
  for (const o of [...d.buildings, ...d.cameras, ...d.rooms, ...d.labels]) {
    if (!idOK(o.id) || ids.has(o.id) || !nameOK(o.name)) throw Error("Every item needs a unique ID and a name of 1\u2013100 c\
haracters.");
    ids.add(o.id);
  }
  for (const b of d.buildings) if (!validPolygon(b.footprint) || !finite(b.height, 1, 150) || !Number.isInteger(b.floors) ||
  !finite(b.floors, 1, 40)) throw Error("Buildings need a simple closed footprint, height 1\u2013150 m, and 1\u201340 floors.");
  for (const b of d.buildings) if (b.source !== undefined && (!b.source || b.source.provider !== 'OpenStreetMap' ||
    !/^way\/[1-9]\d{0,15}$/.test(b.source.id) || b.source.license !== 'ODbL-1.0' ||
    !['retrieved','updated','heightBasis','floorsBasis'].every(k => typeof b.source[k] === 'string' && b.source[k].length <= 80)))
      throw Error('Invalid building source record.');
  for (const c of d.cameras) if (!pointOK([c.x, c.y]) || !finite(c.z, 0.5, 150) || !finite(c.bearing, 0, 359.99) || !finite(
  c.tilt, 0, 89) || !finite(c.hfov, 5, 170) || !finite(c.vfov, 5, 150) || !finite(c.range, 1, 300) || typeof c.enabled !==
  "boolean") throw Error("Camera position, height, viewing angles or range are outside the allowed limits.");
  for (const r of d.rooms) {
    const b = d.buildings.find((b2) => b2.id === r.buildingId);
    if (!b || !validPolygon(r.footprint) || !Number.isInteger(r.level) || r.level < 0 || r.level >= b.floors || !finite(
    r.wallHeight, 0.2, 10) || !polygonContains(b.footprint, r.footprint)) throw Error("Rooms must fit inside their build\
ing and reference an existing floor.");
  }
  for (const l of d.labels) if (!pointOK([l.x, l.y]) || !finite(l.z, 0, 150)) throw Error("Labels need valid positions.");
  if (!d.route.every(pointOK)) throw Error("Route points must be within 2 km of the origin.");
  return {
    schema: SCHEMA,
    name: d.name,
    origin: [...d.origin],
    buildings: d.buildings.map((b) => ({ id: b.id, name: b.name, footprint: b.footprint.map((p) => [...p]), height: b.height,
    floors: b.floors, ...(b.source ? { source: Object.fromEntries(['provider','id','license','retrieved','updated','heightBasis','floorsBasis'].map(k=>[k,b.source[k]])) } : {}) })),
    cameras: d.cameras.map((c) => Object.fromEntries(["id", "name", "x", "y", "z", "bearing", "tilt", "hfov", "vfov", "r\
ange", "enabled"].map((k) => [k, c[k]]))),
    rooms: d.rooms.map((r) => ({ id: r.id, name: r.name, buildingId: r.buildingId, level: r.level, footprint: r.footprint.
    map((p) => [...p]), wallHeight: r.wallHeight })),
    labels: d.labels.map((l) => ({ id: l.id, name: l.name, x: l.x, y: l.y, z: l.z })),
    route: d.route.map((p) => [...p])
  };
}
function parseFacility(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > LIMITS.bytes) throw Error("Facility files must\
 be smaller than 2 MB.");
  return validateFacility(JSON.parse(text));
}
function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) < 1e-7 && p[0] >= Math.min(a[0], b[0]) - 1e-7 && p[0] <= Math.max(a[0], b[0]) + 1e-7 && p[1] >= Math.
    min(a[1], b[1]) - 1e-7 && p[1] <= Math.max(a[1], b[1]) + 1e-7) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function polygonContains(outer, inner) {
  if (!inner.every((p) => pointInPolygon(p, outer))) return false;
  for (let i = 0; i < inner.length - 1; i++) {
    const a = inner[i], b = inner[i + 1], cuts = [0, 1];
    for (let j = 0; j < outer.length - 1; j++) {
      const t = segmentIntersection(a, b, outer[j], outer[j + 1]);
      if (t !== null) cuts.push(t);
    }
    cuts.sort((a2, b2) => a2 - b2);
    for (let j = 1; j < cuts.length; j++) {
      if (cuts[j] - cuts[j - 1] < 1e-8) continue;
      const t = (cuts[j] + cuts[j - 1]) / 2;
      if (!pointInPolygon([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], outer)) return false;
    }
  }
  return true;
}
function toLngLat([x, y], origin) {
  return [origin[0] + x / (111320 * Math.cos(origin[1] * Math.PI / 180)), origin[1] + y / 111320];
}
function fromLngLat([lng, lat], origin) {
  return [(lng - origin[0]) * 111320 * Math.cos(origin[1] * Math.PI / 180), (lat - origin[1]) * 111320];
}
function centroid(p) {
  const a = p.slice(0, -1);
  return [a.reduce((s, p2) => s + p2[0], 0) / a.length, a.reduce((s, p2) => s + p2[1], 0) / a.length];
}
const rad = (a) => a * Math.PI / 180;
function wallObstacles(plan) {
  return [...plan.buildings.map((b) => ({ polygon: b.footprint, base: 0, top: b.height })), ...plan.rooms.map((r) => {
    const b = plan.buildings.find((b2) => b2.id === r.buildingId);
    const base = r.level * b.height / b.floors;
    return { polygon: r.footprint, base, top: base + r.wallHeight };
  })];
}
function groundRange(c) {
  const near = c.z / Math.tan(rad(Math.min(89.9, c.tilt + c.vfov / 2)));
  const far = c.tilt - c.vfov / 2 <= 0 ? c.range : Math.min(c.range, c.z / Math.tan(rad(c.tilt - c.vfov / 2)));
  return { near: Math.max(0, near), far };
}
function clippedRay(c, angle, distance, obstacles) {
  const a = [c.x, c.y], b = [c.x + Math.sin(rad(angle)) * distance, c.y + Math.cos(rad(angle)) * distance];
  let limit = distance;
  for (const wall of obstacles) for (let i = 0; i < wall.polygon.length - 1; i++) {
    const t = segmentIntersection(a, b, wall.polygon[i], wall.polygon[i + 1]);
    if (t !== null && t > 1e-5) {
      const h = c.z * (1 - t);
      if (h >= wall.base - 1e-4 && h <= wall.top + 1e-4) limit = Math.min(limit, distance * t);
    }
  }
  return limit;
}
function coverageFan(c, obstacles, segments = 48) {
  const { near, far } = groundRange(c);
  if (!c.enabled || near >= far) return [];
  const outer = [], inner = [];
  for (let i = 0; i <= segments; i++) {
    const a = c.bearing - c.hfov / 2 + c.hfov * i / segments;
    const d = clippedRay(c, a, far, obstacles);
    const n = Math.min(near, d);
    outer.push([c.x + Math.sin(rad(a)) * d, c.y + Math.cos(rad(a)) * d]);
    inner.push([c.x + Math.sin(rad(a)) * n, c.y + Math.cos(rad(a)) * n]);
  }
  return [...outer, ...inner.reverse(), outer[0]];
}
function seesPoint(c, p, obstacles) {
  if (!c.enabled) return false;
  const dx = p[0] - c.x, dy = p[1] - c.y, d = Math.hypot(dx, dy), { near, far } = groundRange(c);
  if (d < near || d > far) return false;
  const bearing = Math.atan2(dx, dy) * 180 / Math.PI, delta = (bearing - c.bearing + 540) % 360 - 180;
  return Math.abs(delta) <= c.hfov / 2 && clippedRay(c, bearing, d, obstacles) >= d - 0.02;
}
function routePoint(route, t) {
  if (route.length < 2) return route[0] || [0, 0];
  const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  let remaining = Math.max(0, Math.min(1, t)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? remaining / lengths[i] : 0;
      return [route[i][0] + (route[i + 1][0] - route[i][0]) * f, route[i][1] + (route[i + 1][1] - route[i][1]) * f];
    }
    remaining -= lengths[i];
  }
}
function rehearse(plan, samples = 61) {
  const obstacles = wallObstacles(plan);
  return Array.from({ length: samples }, (_, i) => {
    const t = i / (samples - 1), point = routePoint(plan.route, t);
    return { seconds: t * 30, point, cameras: plan.cameras.filter((c) => seesPoint(c, point, obstacles)).map((c) => c.id) };
  });
}
export {
  LIMITS,
  SCHEMA,
  STEPS,
  blankFacility,
  centroid,
  clippedRay,
  coverageFan,
  exampleFacility,
  fromLngLat,
  groundRange,
  parseFacility,
  pointInPolygon,
  polygonArea,
  polygonContains,
  rehearse,
  routePoint,
  seesPoint,
  segmentIntersection,
  toLngLat,
  uid,
  validPolygon,
  validateFacility,
  wallObstacles
};
