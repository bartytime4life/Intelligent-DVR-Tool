import {validateStair, stairFootprint} from './facility-stairs.mjs';
import {FACILITY_CLASSES, ZONE_TYPES, validateImageRegion} from './facility-zones.mjs';
const SCHEMA = "intelligent-dvr.facility.v3";
const PREVIOUS_SCHEMA = "intelligent-dvr.facility.v2";
const LEGACY_SCHEMA = "intelligent-dvr.facility.v1";
const LIMITS = { buildings: 100, cameras: 500, rooms: 500, zones: 500, openings: 500, stairs: 100, paths: 100, labels: 1e3, route: 200, bytes: 2e6 };
const STEPS = [
  ["Locate site", "Set the site and map origin"],
  ["Buildings", "Draw footprints and set heights"],
  ["Floors & labels", "Name the spaces that matter"],
  ["Cameras", "Place and aim each camera"],
  ["Coverage", "Inspect visibility and blind spots"],
  ["Handoffs", "Rehearse a route between cameras"],
  ["Zones & objects", "Define restricted areas and object rules"]
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
    zones: [],
    openings: [],
    stairs: [],
    paths: [],
    route: [[-90, -88], [-55, -88], [-12, -55], [25, -30], [57, -15], [107, -14]]
  };
}
function blankFacility() {
  return { schema: SCHEMA, name: "My facility", origin: [-98, 38.5], buildings: [], cameras: [], rooms: [], labels: [], zones: [], openings: [], stairs: [], paths: [], route: [] };
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
  const vertices=p.slice(0,-1);
  if(new Set(vertices.map(q=>q.join(','))).size!==vertices.length)return false;
  const onSegment=(q,a,b)=>Math.abs((q[0]-a[0])*(b[1]-a[1])-(q[1]-a[1])*(b[0]-a[0]))<1e-9 && q[0]>=Math.min(a[0],b[0]) && q[0]<=Math.max(a[0],b[0]) && q[1]>=Math.min(a[1],b[1]) && q[1]<=Math.max(a[1],b[1]);
  for (let i = 0; i < p.length - 1; i++) {
    if (eq(p[i], p[i + 1])) return false;
    const a=p[i],b=p[i+1],c=vertices[(i+2)%vertices.length];
    if(Math.abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))<1e-9 && (b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1])<0)return false;
    for (let j = i + 2; j < p.length - 1; j++) {
      if (i === 0 && j === p.length - 2) continue;
      if (segmentIntersection(p[i], p[i + 1], p[j], p[j + 1]) !== null || onSegment(p[i],p[j],p[j+1]) || onSegment(p[i+1],p[j],p[j+1]) || onSegment(p[j],p[i],p[i+1]) || onSegment(p[j+1],p[i],p[i+1])) return false;
    }
  }
  return true;
}
// Boundary-inclusive intersection: touching courtyard walls is invalid topology.
function ringsIntersect(a, b) {
  return a.slice(1).some((p,i) => b.slice(1).some((q,j) => {
    if (segmentIntersection(a[i],p,b[j],q) !== null) return true;
    const on = (v,x,y) => Math.abs((v[0]-x[0])*(y[1]-x[1])-(v[1]-x[1])*(y[0]-x[0])) < 1e-7 &&
      v[0]>=Math.min(x[0],y[0])-1e-7 && v[0]<=Math.max(x[0],y[0])+1e-7 && v[1]>=Math.min(x[1],y[1])-1e-7 && v[1]<=Math.max(x[1],y[1])+1e-7;
    return on(a[i],b[j],q) || on(p,b[j],q) || on(b[j],a[i],p) || on(q,a[i],p);
  }));
}
function ringsOverlap(a,b) {
  return ringsIntersect(a,b) || pointInPolygon(a[0],b) || pointInPolygon(b[0],a);
}
function validHoles(outer, holes = []) {
  return Array.isArray(holes) && holes.length <= 20 && holes.reduce((n,h)=>n+(Array.isArray(h)?h.length:10000),outer.length)<=1000 && holes.every((h,i) => validPolygon(h) &&
    polygonContains(outer,h) && !ringsIntersect(outer,h) && !holes.slice(0,i).some(other => ringsOverlap(h,other))) &&
    polygonArea(outer)-holes.reduce((sum,h)=>sum+polygonArea(h),0) >= 1;
}
function buildingArea(b) { return polygonArea(b.footprint)-(b.holes || []).reduce((sum,h)=>sum+polygonArea(h),0); }
function buildingRings(b) { return [b.footprint, ...(b.holes || [])]; }
function buildingFeature(b, origin, properties = {}) {
  return {type:'Feature',geometry:{type:'Polygon',coordinates:buildingRings(b).map(r=>r.map(p=>toLngLat(p,origin)))},properties};
}
function transformBuilding(b, transform) {
  return {...b,footprint:b.footprint.map(transform),...(b.holes ? {holes:b.holes.map(h=>h.map(transform))} : {})};
}
function validateFacility(d) {
  if (!d || ![SCHEMA, PREVIOUS_SCHEMA, LEGACY_SCHEMA].includes(d.schema) || !nameOK(d.name) || !Array.isArray(d.origin) || d.origin.length !== 2 || !finite(d.origin[0],
  -180, 180) || !finite(d.origin[1], -80, 80)) throw Error("Use a facility v1, v2 or v3 file with a valid name and map origin (lat\
itude \u221280 to 80).");
  for (const k of ["buildings", "cameras", "rooms", "labels", "route"]) if (!Array.isArray(d[k]) || d[k].length > LIMITS[k])
   throw Error("Too many or invalid " + k + ".");
  const zones = d.zones === undefined ? [] : d.zones;
  if (!Array.isArray(zones) || zones.length > LIMITS.zones) throw Error('Use up to 500 valid zones.');
  if (d.schema === LEGACY_SCHEMA && zones.length) throw Error('Zones require facility v2 or newer.');
  const openings = d.openings === undefined ? [] : d.openings;
  const stairs = d.stairs === undefined ? [] : d.stairs;
  if (!Array.isArray(openings) || openings.length > LIMITS.openings) throw Error('Use up to 500 valid floor openings.');
  if (!Array.isArray(stairs) || stairs.length > LIMITS.stairs) throw Error('Use up to 100 valid stairs.');
  const paths = d.paths === undefined ? [] : d.paths;
  if (!Array.isArray(paths) || paths.length > LIMITS.paths) throw Error('Use up to 100 valid floor paths.');
  if (d.schema !== SCHEMA && (openings.length || stairs.length || paths.length)) throw Error('Floor openings, stairs and paths require facility v3; older formats cannot preserve them.');
  const ids = /* @__PURE__ */ new Set();
  for (const o of [...d.buildings, ...d.cameras, ...d.rooms, ...d.labels, ...zones, ...openings, ...stairs, ...paths]) {
    if (!o || !idOK(o.id) || ids.has(o.id) || !nameOK(o.name)) throw Error("Every item needs a unique ID and a name of 1\u2013100 c\
haracters.");
    ids.add(o.id);
  }
  for (const b of d.buildings) if (!validPolygon(b.footprint) || !finite(b.height, 1, 150) || !Number.isInteger(b.floors) ||
  !finite(b.floors, 1, 40)) throw Error("Buildings need a simple closed footprint, height 1\u2013150 m, and 1\u201340 floors.");
  for (const b of d.buildings) {
    if (b.openFloors !== undefined) {
      if (d.schema !== SCHEMA) throw Error('Open floors require facility v3; older formats cannot preserve them.');
      if (!Array.isArray(b.openFloors) || b.openFloors.length > b.floors ||
          b.openFloors.some(level=>!Number.isInteger(level) || level < 0 || level >= b.floors) ||
          new Set(b.openFloors).size !== b.openFloors.length)
        throw Error('Open floors must list unique existing level numbers.');
    }
    if (!validHoles(b.footprint,b.holes) || (b.base !== undefined && !finite(b.base,0,b.height-0.1)) ||
        (b.part !== undefined && typeof b.part !== 'boolean')) throw Error('Invalid courtyard, building base or part geometry.');
    if (d.schema === LEGACY_SCHEMA && (b.holes !== undefined || b.base !== undefined || b.part !== undefined))
      throw Error('Courtyards, bases and parts require facility v2 or newer; do not label advanced geometry as v1.');
  }
  for(let i=0;i<d.buildings.length;i++) for(let j=i+1;j<d.buildings.length;j++) {
    const a=d.buildings[i],b=d.buildings[j];
    if((a.part || b.part) && Math.max(a.base || 0,b.base || 0)<Math.min(a.height,b.height) && ringsOverlap(a.footprint,b.footprint))
      throw Error('Overlapping part/envelope volumes require a reviewed decomposition.');
  }
  for (const b of d.buildings) if (b.source !== undefined && (!b.source || b.source.provider !== 'OpenStreetMap' ||
    !/^(way|relation)\/[1-9]\d{0,15}$/.test(b.source.id) || b.source.license !== 'ODbL-1.0' ||
    !['retrieved','updated','heightBasis','floorsBasis'].every(k => typeof b.source[k] === 'string' && b.source[k].length <= 80)))
      throw Error('Invalid building source record.');
  for (const c of d.cameras) if (!pointOK([c.x, c.y]) || !finite(c.z, 0.5, 150) || !finite(c.bearing, 0, 359.99) || !finite(
  c.tilt, 0, 89) || !finite(c.hfov, 5, 170) || !finite(c.vfov, 5, 150) || !finite(c.range, 1, 300) || typeof c.enabled !==
  "boolean") throw Error("Camera position, height, viewing angles or range are outside the allowed limits.");
  for (const r of d.rooms) {
    const b = d.buildings.find((b2) => b2.id === r.buildingId);
    if (!b || !validPolygon(r.footprint) || !Number.isInteger(r.level) || r.level < 0 || r.level >= b.floors || !finite(
    r.wallHeight, 0.2, 10) || !polygonContains(b.footprint, r.footprint) || (b.holes || []).some(h=>ringsOverlap(h,r.footprint))) throw Error("Rooms must fit inside their build\
ing and reference an existing floor.");
  }
  const openingGroups = new Map();
  for (const opening of openings) {
    const b = d.buildings.find(b => b.id === opening.buildingId);
    if (!b || !Number.isInteger(opening.level) || opening.level < 0 || opening.level >= b.floors || !validPolygon(opening.footprint))
      throw Error('Floor openings need a valid building, floor and simple closed footprint.');
    const key = `${b.id}:${opening.level}`;
    const group = openingGroups.get(key) || {building:b,holes:[...(b.holes || [])]};
    group.holes.push(opening.footprint); openingGroups.set(key,group);
  }
  for (const {building,holes} of openingGroups.values()) if (!validHoles(building.footprint,holes))
    throw Error('Floor openings must be strictly inside solid building space, without touching other openings, courtyards or outer walls. Use at most 20 combined holes per floor.');
  const cleanStairs = stairs.map(stair => {
    const b = d.buildings.find(b => b.id === stair.buildingId), clean = validateStair(stair,b);
    const footprint = stairFootprint(clean,b);
    if (!footprint.every(pointOK) || !polygonContains(b.footprint,footprint) || (b.holes || []).some(h=>ringsOverlap(h,footprint)))
      throw Error('Stair flights and landings must fit inside solid building space, outside courtyards.');
    return clean;
  });
  for (const path of paths) {
    const b = d.buildings.find(b => b.id === path.buildingId);
    if (!b || !Number.isInteger(path.level) || path.level < 0 || path.level >= b.floors ||
        !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 200 || !path.points.every(pointOK) ||
        path.points.slice(1).some((p,i)=>eq(p,path.points[i])) || !polygonContains(b.footprint,path.points))
      throw Error('Floor paths need an existing level and 2–200 distinct consecutive points inside the building.');
    if ((b.openFloors || []).includes(path.level)) throw Error('Floor paths need a solid floor; this entire level is open.');
    const holes = [...(b.holes || []),...openings.filter(o=>o.buildingId===b.id && o.level===path.level).map(o=>o.footprint)];
    if (holes.some(hole=>ringsIntersect(path.points,hole) || path.points.some(p=>pointInPolygon(p,hole))))
      throw Error('Floor paths cannot cross or touch a courtyard or floor opening on that level.');
  }
  for (const z of zones) {
    if (!ZONE_TYPES.includes(z.type) || !validPolygon(z.footprint) || typeof z.enabled !== 'boolean' ||
        !finite(z.dwellSeconds, 0, 3600) || !Array.isArray(z.expectedClasses) || z.expectedClasses.length > FACILITY_CLASSES.length ||
        z.expectedClasses.some(c => !FACILITY_CLASSES.includes(c)) || new Set(z.expectedClasses).size !== z.expectedClasses.length)
      throw Error('Zones need a simple footprint, a supported type, expected model classes and dwell 0–3600 seconds.');
    if (z.buildingId !== undefined || z.level !== undefined) {
      const b = d.buildings.find(b => b.id === z.buildingId);
      if (!b || !Number.isInteger(z.level) || z.level < 0 || z.level >= b.floors ||
          !polygonContains(b.footprint, z.footprint) || (b.holes || []).some(h => ringsOverlap(h,z.footprint)))
        throw Error('Indoor zones must fit inside their building and reference an existing floor.');
    }
    if (z.imageRegion !== undefined) validateImageRegion(z.imageRegion,d.cameras);
  }
  for (const l of d.labels) if (!pointOK([l.x, l.y]) || !finite(l.z, 0, 150)) throw Error("Labels need valid positions.");
  if (!d.route.every(pointOK)) throw Error("Route points must be within 2 km of the origin.");
  return {
    schema: SCHEMA,
    name: d.name,
    origin: [...d.origin],
    buildings: d.buildings.map((b) => ({ id: b.id, name: b.name, footprint: b.footprint.map((p) => [...p]), height: b.height,
    floors: b.floors, ...(b.openFloors !== undefined ? {openFloors:[...b.openFloors].sort((a,b)=>a-b)} : {}), ...(b.holes ? {holes:b.holes.map(h=>h.map(p=>[...p]))} : {}),
    ...(b.base !== undefined ? {base:b.base} : {}), ...(b.part !== undefined ? {part:b.part} : {}), ...(b.source ? { source: Object.fromEntries(['provider','id','license','retrieved','updated','heightBasis','floorsBasis'].map(k=>[k,b.source[k]])) } : {}) })),
    cameras: d.cameras.map((c) => Object.fromEntries(["id", "name", "x", "y", "z", "bearing", "tilt", "hfov", "vfov", "r\
ange", "enabled"].map((k) => [k, c[k]]))),
    rooms: d.rooms.map((r) => ({ id: r.id, name: r.name, buildingId: r.buildingId, level: r.level, footprint: r.footprint.
    map((p) => [...p]), wallHeight: r.wallHeight })),
    labels: d.labels.map((l) => ({ id: l.id, name: l.name, x: l.x, y: l.y, z: l.z })),
    openings: openings.map(o => ({id:o.id,name:o.name,buildingId:o.buildingId,level:o.level,footprint:o.footprint.map(p=>[...p])})),
    stairs: cleanStairs,
    paths: paths.map(p=>({id:p.id,name:p.name,buildingId:p.buildingId,level:p.level,points:p.points.map(q=>[...q])})),
    zones: zones.map(z => ({id:z.id,name:z.name,type:z.type,footprint:z.footprint.map(p=>[...p]),
      enabled:z.enabled,expectedClasses:[...z.expectedClasses],dwellSeconds:z.dwellSeconds,
      ...(z.buildingId !== undefined ? {buildingId:z.buildingId,level:z.level} : {}),
      ...(z.imageRegion !== undefined ? {imageRegion:validateImageRegion(z.imageRegion,d.cameras)} : {})})),
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
  return [...plan.buildings.flatMap((b) => buildingRings(b).map(polygon=>({polygon, base: b.base || 0, top: b.height}))), ...plan.rooms.map((r) => {
    const b = plan.buildings.find((b2) => b2.id === r.buildingId);
    const base = (b.base || 0) + r.level * (b.height - (b.base || 0)) / b.floors;
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
  buildingArea,
  buildingRings,
  buildingFeature,
  transformBuilding,
  validHoles,
  ringsIntersect,
  ringsOverlap,
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

// Add one top level without moving the existing equal-height floor elevations.
export function addBuildingLevel(plan, buildingId) {
  const clean = validateFacility(plan), building = clean.buildings.find(b => b.id === buildingId);
  if (!building) throw Error('Choose a building first.');
  if (building.floors >= 40) throw Error('A building can have at most 40 levels.');
  const base = building.base || 0, levelHeight = (building.height - base) / building.floors;
  const height = base + levelHeight * (building.floors + 1);
  if (height > 150) throw Error('Adding a level would exceed the 150 m height limit.');
  return validateFacility({...clean,buildings:clean.buildings.map(b => b.id === buildingId ? {...b,floors:b.floors+1,height} : b)});
}

export function copyRoomsToNextLevel(plan, buildingId, level) {
  let next = validateFacility(plan);
  const building = next.buildings.find(b => b.id === buildingId);
  if (!building || !Number.isInteger(level) || level < 0 || level >= building.floors) throw Error('Choose an existing floor to copy.');
  const rooms = next.rooms.filter(r => r.buildingId === buildingId && r.level === level);
  if (!rooms.length) throw Error('Draw at least one room on this floor before copying.');
  if (next.rooms.length + rooms.length > LIMITS.rooms) throw Error('Copying would exceed the 500-room limit.');
  if (next.rooms.some(r => r.buildingId === buildingId && r.level === level+1)) throw Error('The next level already has rooms. Choose an empty level to avoid overlapping layouts.');
  if (level + 1 === building.floors) next = addBuildingLevel(next, buildingId);
  return validateFacility({...next, rooms:[...next.rooms,...rooms.map(r => ({...r,id:uid('r'),level:level+1,footprint:r.footprint.map(p=>[...p])}))]});
}

// Floor n is the ceiling above floor n−1. Courtyards cut every slab; openings cut one slab only.
export function floorSlabRings(plan, buildingId, level) {
  const b = plan.buildings.find(b => b.id === buildingId);
  if (!b || !Number.isInteger(level) || level < 0 || level >= b.floors) throw Error('Choose an existing building floor.');
  if ((b.openFloors || []).includes(level)) return [];
  return [b.footprint,...(b.holes || []),...(plan.openings || []).filter(o=>o.buildingId===buildingId && o.level===level).map(o=>o.footprint)].map(ring=>ring.map(p=>[...p]));
}

export function ceilingOpenings(plan, buildingId, level) {
  const b = plan.buildings.find(b => b.id === buildingId);
  if (!b || !Number.isInteger(level) || level < 0 || level >= b.floors) throw Error('Choose an existing building floor.');
  if ((b.openFloors || []).includes(level+1)) return [{id:`entire-floor-${buildingId}-${level+1}`,name:'Entire ceiling open',buildingId,level:level+1,footprint:b.footprint.map(p=>[...p]),entireFloor:true}];
  return (plan.openings || []).filter(o=>o.buildingId===buildingId && o.level===level+1).map(o=>({...o,footprint:o.footprint.map(p=>[...p])}));
}

export function createFloorOpening(plan, buildingId, level, footprint, name='Floor opening') {
  const base=validateFacility(plan);
  if (!Array.isArray(footprint) || !footprint.every(pointOK)) throw Error('Use valid local-meter opening vertices.');
  const opening={id:uid('opening'),name,buildingId,level,footprint:footprint.map(p=>[...p])};
  const next=validateFacility({...base,openings:[...base.openings,opening]});
  return next.openings.find(o=>o.id===opening.id);
}

export function createFloorPath(plan, buildingId, level, points, name='Floor pathway') {
  const base=validateFacility(plan);
  if (!Array.isArray(points) || !points.every(pointOK)) throw Error('Use valid local-meter pathway points.');
  const path={id:uid('path'),name,buildingId,level,points:points.map(p=>[...p])};
  const next=validateFacility({...base,paths:[...base.paths,path]});
  return next.paths.find(p=>p.id===path.id);
}
