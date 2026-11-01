import { fromLngLat, toLngLat, validPolygon, polygonArea, validateFacility, pointInPolygon, segmentIntersection, validHoles, ringsOverlap, ringsIntersect } from "./facility.mjs";

export function draftFacility(plan, buildings, replace = false) {
  const base = replace ? {...plan,buildings:[],cameras:[],rooms:[],doorways:[],windows:[],labels:[],route:[],zones:[],openings:[],stairs:[],paths:[]} : plan;
  return validateFacility({...base,buildings:[...base.buildings,...buildings]});
}
const SHAPES = ["Rectangle", "L wing", "T wing", "U wing", "Cross", "Octagon", "Round"];
import { FOOTPRINT_SERVICES, boundedJson } from "./facility-services.mjs";
const OSM_ENDPOINT = FOOTPRINT_SERVICES[0].url;
const OSM_SERVERS = FOOTPRINT_SERVICES.map(s => s.url);
function shapeFootprint(kind, width, depth, wing, angle = 0, x = 0, y = 0) {
  if (!SHAPES.includes(kind) || ![width, depth, wing, angle, x, y].every(Number.isFinite) || width < 2 || depth < 2 || width >
  1e3 || depth > 1e3 || ["L wing", "T wing", "U wing", "Cross"].includes(kind) && (wing < 1 || wing >= Math.min(width, depth) /
  2))
    throw Error("Use dimensions 2\u20131,000 m and a wing narrower than half the smaller side.");
  const w = width, d = depth, t = wing;
  let p;
  if (kind === "Rectangle") p = [[0, 0], [w, 0], [w, d], [0, d]];
  if (kind === "L wing") p = [[0, 0], [w, 0], [w, t], [t, t], [t, d], [0, d]];
  if (kind === "T wing") p = [[0, d - t], [(w - t) / 2, d - t], [(w - t) / 2, 0], [(w + t) / 2, 0], [(w + t) / 2, d - t],
  [w, d - t], [w, d], [0, d]];
  if (kind === "U wing") p = [[0, 0], [w, 0], [w, d], [w - t, d], [w - t, t], [t, t], [t, d], [0, d]];
  if (kind === "Cross") p = [[(w - t) / 2, 0], [(w + t) / 2, 0], [(w + t) / 2, (d - t) / 2], [w, (d - t) / 2], [w, (d + t) /
  2], [(w + t) / 2, (d + t) / 2], [(w + t) / 2, d], [(w - t) / 2, d], [(w - t) / 2, (d + t) / 2], [0, (d + t) / 2], [0, (d -
  t) / 2], [(w - t) / 2, (d - t) / 2]];
  if (kind === "Octagon") {
    const a = Math.min(w, d) * 0.25;
    p = [[a, 0], [w - a, 0], [w, a], [w, d - a], [w - a, d], [a, d], [0, d - a], [0, a]];
  }
  if (kind === "Round") p = Array.from({ length: 32 }, (_, i) => [w / 2 + w / 2 * Math.cos(i * Math.PI / 16), d / 2 + d /
  2 * Math.sin(i * Math.PI / 16)]);
  const r = angle * Math.PI / 180;
  p = p.map(([a, b]) => [+(x + (a - w / 2) * Math.cos(r) - (b - d / 2) * Math.sin(r)).toFixed(3), +(y + (a - w / 2) * Math.
  sin(r) + (b - d / 2) * Math.cos(r)).toFixed(3)]);
  p.push([...p[0]]);
  if (!validPolygon(p)) throw Error("Shape exceeds the local map bounds or is too small.");
  return p;
}
function dimensions(ring) {
  let best = { length: 0, width: 0, area: Infinity };
  const points = ring.slice(0, -1);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const q = points.map(([x, y]) => [x * Math.cos(angle) + y * Math.sin(angle), -x * Math.sin(angle) + y * Math.cos(angle)]);
    const w = Math.max(...q.map((p) => p[0])) - Math.min(...q.map((p) => p[0]));
    const d = Math.max(...q.map((p) => p[1])) - Math.min(...q.map((p) => p[1]));
    if (w * d < best.area) best = { length: Math.max(w, d), width: Math.min(w, d), area: w * d };
  }
  return { length: best.length, width: best.width, area: polygonArea(ring), perimeter: ring.slice(1).reduce((s, p, i) => s +
  Math.hypot(p[0] - ring[i][0], p[1] - ring[i][1]), 0) };
}
function searchBounds(origin, east, north, width, depth) {
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite) || Math.abs(origin[0]) > 180 || Math.
  abs(origin[1]) > 80 || ![east, north, width, depth].every(Number.isFinite) || width < 20 || depth < 20 || width > 500 ||
  depth > 500 || Math.abs(east) + width / 2 > 1800 || Math.abs(north) + depth / 2 > 1800)
    throw Error("Choose a 20\u2013500 m wide/deep area within 1,800 m of the saved site origin.");
  const sw = toLngLat([east - width / 2, north - depth / 2], origin), ne = toLngLat([east + width / 2, north + depth / 2],
  origin);
  if (sw[0] < -180 || ne[0] > 180) throw Error("Areas crossing the date line are not supported.");
  return [sw[1], sw[0], ne[1], ne[0]];
}
export function polygonAreaSelection(origin, ring) {
  if (!validPolygon(ring) || ring.length > 51) throw Error('Use a simple closed area with 3–50 corners and at least 1 m².');
  const xs=ring.map(p=>p[0]), ys=ring.map(p=>p[1]);
  const west=Math.min(...xs),east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys);
  if (east-west<20 || north-south<20) throw Error('Area bounds must be at least 20 m per side.');
  return {ring:ring.map(p=>[...p]),bounds:searchBounds(origin,(west+east)/2,(south+north)/2,east-west,north-south)};
}
export function parseAreaVertices(text) {
  if (typeof text !== 'string' || text.length > 5000) throw Error('Area vertex text is too large.');
  const points=text.trim().split(/\n/).map(line=>line.trim().split(/[,\s]+/).map(v=>v===''?NaN:Number(v)));
  if(points.some(p=>p.length!==2 || !p.every(Number.isFinite))) throw Error('Enter one east,north pair in meters per line.');
  if(points.length && (points[0][0]!==points.at(-1)[0] || points[0][1]!==points.at(-1)[1])) points.push([...points[0]]);
  return points;
}
function osmQuery(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3] || Math.abs(bounds[0])>80 || Math.abs(bounds[2])>80 || Math.abs(bounds[1])>180 || Math.abs(bounds[3])>180 || (bounds[2]-bounds[0])*111320 > 501 || (bounds[3]-bounds[1])*111320*Math.cos((bounds[0]+bounds[2])/2*Math.PI/180)>502) throw Error("Invalid or oversized area.");
  const box = bounds.join(",");
  return `[out:json][timeout:20][maxsize:16777216];
way["building"]["building"!="no"](${box})->.footprints;
(way["building:part"]["building:part"!="no"](${box});.footprints;relation["building"]["building"!="no"](${box});
relation["building:part"]["building:part"!="no"](${box});relation(bw.footprints)["type"="multipolygon"];);
out meta geom 301;`;
}
function osmHeight(raw, minimum = 1) {
  if (typeof raw !== "string") return null;
  let m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(m|ft)?$/);
  let n = m ? +m[1] * (m[2] === "ft" ? 0.3048 : 1) : NaN;
  const f = raw.match(/^(\d+)'(?:(\d+(?:\.\d+)?)")?$/);
  if (f) n = +f[1] * 0.3048 + +(f[2] || 0) * 0.0254;
  return Number.isFinite(n) && n >= minimum && n <= 150 ? n : null;
}
// Assemble fully known rings of one role; never bridge a missing segment.
function relationRings(e, role) {
  if (e.tags?.type !== 'multipolygon' || !Array.isArray(e.members) || !e.members.length || e.members.length > 200 ||
      e.members.some(m => m.type !== 'way' || !['outer','inner'].includes(m.role) || !Array.isArray(m.geometry) || m.geometry.length < 2 || m.geometry.length > 201)) return null;
  const chains = e.members.filter(m=>m.role===role).map(m => m.geometry.map(p => [p?.lon, p?.lat]));
  if (chains.flat().some(p => !p.every(Number.isFinite))) return null;
  const eq = (a,b) => a[0] === b[0] && a[1] === b[1];
  const rings = [];
  while (chains.length) {
    let ring = chains.shift();
    while (!eq(ring[0],ring.at(-1))) {
      const matches = chains.map((c,i) => ({c,i})).filter(({c}) => eq(c[0],ring.at(-1)) || eq(c.at(-1),ring.at(-1)));
      if (matches.length !== 1) return null; // Missing or branching topology is not guessed.
      const {c,i} = matches[0]; chains.splice(i,1);
      ring = ring.concat((eq(c[0],ring.at(-1)) ? c : [...c].reverse()).slice(1));
      if (ring.length > 201) return null;
    }
    rings.push(ring);
  }
  return rings;
}
function parseOsmBuildings(data, origin, bounds, now = new Date().toISOString(), areaRing = null) {
  // Validate area/origin before any projection or expensive geometry work.
  searchBounds(origin,0,0,20,20);
  if (!Array.isArray(bounds) || bounds.length!==4 || !bounds.every(Number.isFinite)) throw Error('Invalid area.');
  osmQuery(bounds);
  if (areaRing) polygonAreaSelection(origin,areaRing);
  if (!data || !Array.isArray(data.elements) || data.elements.length > 300 || data.remark) throw Error('Incomplete or oversized response. Reduce the area and try again.');
  const buildings = [], seen = new Set(), blocked = new Set(), reasons = {};
  const skip = reason => { reasons[reason] = (reasons[reason] || 0) + 1; };
  for (const e of data.elements) if (e?.type === 'relation') for (const m of e.members || []) if (m.type === 'way') blocked.add(m.ref);
  for (const e of data.elements) {
    if (!e || !['way','relation'].includes(e.type)) { skip('unsupported element'); continue; }
    if (e.type === 'way' && blocked.has(e.id)) { skip('relation member (handled with parent)'); continue; }
    if (!Number.isSafeInteger(e.id) || e.id <= 0 || seen.has(e.type+'/'+e.id)) continue;
    seen.add(e.type+'/'+e.id);
    if ((!e.tags?.building || e.tags.building === 'no') && (!e.tags?.['building:part'] || e.tags['building:part'] === 'no')) { if(e.type==='relation')skip('unlabelled relation; members excluded'); continue; }
    const part=!!e.tags['building:part'] && e.tags['building:part']!=='no';
    const explicitBase=e.tags.min_height !== undefined ? osmHeight(e.tags.min_height,0) : null;
    const minLevel=e.tags['building:min_level'];
    if ((e.tags.min_height !== undefined && explicitBase === null) ||
        (minLevel !== undefined && !/^(0|[1-9]\d*)$/.test(minLevel))) {skip('uncertain raised base');continue;}
    const base=explicitBase ?? (minLevel !== undefined ? +minLevel*3 : 0);
    const rings = e.type === 'relation' ? relationRings(e,'outer') : Array.isArray(e.geometry) ? [e.geometry.map(p=>[p?.lon,p?.lat])] : null;
    const inners = e.type === 'relation' ? relationRings(e,'inner') : [];
    if (!rings?.length || !inners) { skip('incomplete or unsupported relation'); continue; }
    const all=[...rings,...inners];
    if(all.some(geo=>geo.length>201 || geo.some(p=>!p.every(Number.isFinite) || Math.abs(p[0])>180 || Math.abs(p[1])>80))) {skip('invalid coordinates');continue;}
    const project=geo=>geo.map(p=>fromLngLat(p,origin).map(v=>+v.toFixed(3)));
    const local=rings.map(project), holes=inners.map(project), assigned=local.map(()=>[]);
    let valid=local.every(validPolygon) && !local.some((r,i)=>local.slice(i+1).some(other=>ringsOverlap(r,other)));
    for(const h of holes) {
      const owners=local.map((r,i)=>({r,i})).filter(({r})=>pointInPolygon(h[0],r));
      if(owners.length!==1) {valid=false;break;}
      assigned[owners[0].i].push(h);
    }
    if(!valid || local.some((r,i)=>!validHoles(r,assigned[i]))) {skip('invalid, touching, overlapping or nested rings');continue;}
    const taggedFloors = /^[1-9]\d*$/.test(e.tags['building:levels'] || '') ? +e.tags['building:levels'] : null;
    const floorsKnown = taggedFloors && taggedFloors <= 40;
    if(floorsKnown && minLevel !== undefined && +minLevel>=taggedFloors) {skip('minimum level is at or above floor count');continue;}
    const floors = floorsKnown ? taggedFloors-(minLevel ? +minLevel : 0) : 1, h = osmHeight(e.tags.height), height = h ?? (base + (floorsKnown ? floors*3 : 6));
    if(base<0 || base>=height-0.1 || height>150) {skip('base is at or above roof');continue;}
    rings.forEach((geo,i) => {
      if (Math.max(...geo.map(p=>p[0]))<bounds[1] || Math.min(...geo.map(p=>p[0]))>bounds[3] || Math.max(...geo.map(p=>p[1]))<bounds[0] || Math.min(...geo.map(p=>p[1]))>bounds[2]) { skip('outside selected area'); return; }
      if(areaRing && !ringsOverlap(local[i],areaRing)) {skip('outside selected polygon');return;}
      if(areaRing && assigned[i].some(h=>!ringsIntersect(h,areaRing) && areaRing.every(p=>pointInPolygon(p,h)))) {skip('selected area is inside courtyard');return;}
      buildings.push({holes:assigned[i],base,part,id: `osm-${e.type}-${e.id}${rings.length>1 ? '-'+(i+1) : ''}`, name: String(e.tags.name || `Mapped building ${e.id}`).slice(0,90)+(rings.length>1 ? ` (${i+1})` : ''), footprint:local[i], height, floors,
        source:{provider:'OpenStreetMap',id:`${e.type}/${e.id}`,license:'ODbL-1.0',retrieved:now,updated:typeof e.timestamp==='string'?e.timestamp.slice(0,40):'unknown',heightBasis:(h?'tagged':floorsKnown?'levels × 3 m estimate':'6 m above base placeholder')+(explicitBase===null && minLevel && +minLevel ? '; base min_level × 3 m estimate' : ''),floorsBasis:floorsKnown?(minLevel && +minLevel ? 'tagged levels minus min_level' : 'tagged'):'1 floor placeholder'},
        crossing:areaRing ? local[i].some(p=>!pointInPolygon(p,areaRing)) : geo.some(([lon,lat])=>lat<bounds[0] || lon<bounds[1] || lat>bounds[2] || lon>bounds[3])});
    });
  }
  // An overlapping envelope/part is not a qualified decomposition. Exclude both,
  // rather than render the envelope as a solid block or silently invent a union.
  const conflicts=new Set();
  for(let i=0;i<buildings.length;i++) for(let j=i+1;j<buildings.length;j++) {
    const a=buildings[i],b=buildings[j];
    if((a.part || b.part) && Math.max(a.base,b.base)<Math.min(a.height,b.height) && ringsOverlap(a.footprint,b.footprint)) {conflicts.add(a.id);conflicts.add(b.id);}
  }
  const supported=buildings.filter(b=>{if(conflicts.has(b.id)){skip('overlapping part or envelope requires decomposition');return false;}return true;});
  return {buildings:supported,skipped:Object.values(reasons).reduce((a,b)=>a+b,0),reasons};
}
const footprintCache = new Map();
export function clearFootprintCache() { footprintCache.clear(); }
async function fetchOsmBuildings(bounds, signal, fetcher = fetch, endpoint = OSM_ENDPOINT) {
  if (!OSM_SERVERS.includes(endpoint)) throw Error('Unsupported map server.');
  const query = osmQuery(bounds), key = endpoint+query;
  signal?.throwIfAborted();
  if (fetcher === fetch && footprintCache.has(key)) return structuredClone(footprintCache.get(key));
  const timed = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
  const response = await fetcher(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:timed,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'});
  const data = await boundedJson(response);
  timed.throwIfAborted();
  if (data.remark || !Array.isArray(data.elements) || data.elements.length > 300) throw Error('Incomplete or oversized map response. Use a smaller area or an offline extract.');
  if (fetcher === fetch) { if (footprintCache.size>=4) footprintCache.delete(footprintCache.keys().next().value); footprintCache.set(key,data); }
  return structuredClone(data);
}
export {
  OSM_ENDPOINT,
  OSM_SERVERS,
  SHAPES,
  dimensions,
  fetchOsmBuildings,
  osmHeight,
  osmQuery,
  parseOsmBuildings,
  searchBounds,
  shapeFootprint
};
