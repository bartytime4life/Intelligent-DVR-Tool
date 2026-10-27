import { fromLngLat, toLngLat, validPolygon, polygonArea } from "./facility.mjs";
const SHAPES = ["Rectangle", "L wing", "T wing", "U wing", "Cross", "Octagon", "Round"];
const OSM_ENDPOINT = "https://overpass.private.coffee/api/interpreter";
const OSM_SERVERS = [OSM_ENDPOINT];
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
function osmQuery(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) throw Error("Invalid area.");
  const box = bounds.join(",");
  return `[out:json][timeout:20][maxsize:16777216];
way["building"]["building"!="no"](${box})->.footprints;
(.footprints;relation["building"]["building"!="no"](${box});
relation(bw.footprints)["type"="multipolygon"];);
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
function parseOsmBuildings(data, origin, bounds, now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!data || !Array.isArray(data.elements) || data.elements.length > 300 || data.remark) throw Error("Incomplete or ov\
ersized response. Reduce the area and try again.");
  const buildings = [], seen = /* @__PURE__ */ new Set(), blocked = /* @__PURE__ */ new Set();
  let skipped = 0;
  for (const e of data.elements) if (e.type === "relation") {
    for (const m of e.members || []) if (m.type === "way") blocked.add(m.ref);
  }
  for (const e of data.elements) {
    if (e.type !== "way" || blocked.has(e.id)) {
      skipped++;
      continue;
    }
    if (!Number.isSafeInteger(e.id) || e.id <= 0 || seen.has(e.id) || !e.tags?.building || e.tags.building === "no") continue;
    seen.add(e.id);
    const raisedBase = e.tags.min_height !== undefined && osmHeight(e.tags.min_height, 0) !== 0;
    const raisedLevel = e.tags['building:min_level'] !== undefined && e.tags['building:min_level'] !== '0';
    if (e.tags["building:part"] || raisedBase || raisedLevel || !Array.isArray(e.geometry) || e.geometry.length >
    201) {
      skipped++;
      continue;
    }
    const geo = e.geometry.map((p) => [p?.lon, p?.lat]);
    if (geo.some((p) => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 80)) {
      skipped++;
      continue;
    }
    if (Math.max(...geo.map((p) => p[0])) < bounds[1] || Math.min(...geo.map((p) => p[0])) > bounds[3] || Math.max(...geo.
    map((p) => p[1])) < bounds[0] || Math.min(...geo.map((p) => p[1])) > bounds[2]) {
      skipped++;
      continue;
    }
    const ring = geo.map((p) => fromLngLat(p, origin).map((v) => +v.toFixed(3)));
    if (!validPolygon(ring)) {
      skipped++;
      continue;
    }
    const taggedFloors = /^[1-9]\d*$/.test(e.tags["building:levels"] || "") ? +e.tags["building:levels"] : null;
    const floors = taggedFloors && taggedFloors <= 40 ? taggedFloors : 1;
    const h = osmHeight(e.tags.height), height = h ?? (taggedFloors && taggedFloors <= 40 ? floors * 3 : 6);
    const crossing = geo.some(([lon, lat]) => lat < bounds[0] || lon < bounds[1] || lat > bounds[2] || lon > bounds[3]);
    buildings.push({
      id: `osm-way-${e.id}`,
      name: String(e.tags.name || `Mapped building ${e.id}`).slice(0, 100),
      footprint: ring,
      height,
      floors,
      source: { provider: "OpenStreetMap", id: `way/${e.id}`, license: "ODbL-1.0", retrieved: now, updated: typeof e.timestamp ===
      "string" ? e.timestamp.slice(0, 40) : "unknown", heightBasis: h ? "tagged" : taggedFloors && taggedFloors <= 40 ? "\
levels \xD7 3 m estimate" : "6 m placeholder", floorsBasis: taggedFloors && taggedFloors <= 40 ? "tagged" : "1 floor pla\
ceholder" },
      crossing
    });
  }
  return { buildings, skipped };
}
async function fetchOsmBuildings(bounds, signal, fetcher = fetch, endpoint = OSM_ENDPOINT) {
  if (!OSM_SERVERS.includes(endpoint)) throw Error("Unsupported map server.");
  const response = await fetcher(endpoint, { method: "POST", body: new URLSearchParams({ data: osmQuery(bounds) }), signal,
  credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) throw Error(response.status === 429 ? "Map server is busy. Wait before retrying." : `Map service una\
vailable (${response.status}). Try later or import an extract.`);
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2e6) throw Error("Map response exceeds 2 MB. Reduce the area.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
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
