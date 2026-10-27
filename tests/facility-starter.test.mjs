import test from "node:test";
import assert from "node:assert/strict";
import { SHAPES, shapeFootprint, dimensions, searchBounds, osmHeight, osmQuery, parseOsmBuildings, fetchOsmBuildings } from "../src/facility-starter.mjs";
import { validPolygon, blankFacility, validateFacility, toLngLat } from "../src/facility.mjs";
const origin = [-98, 38.5], bounds = searchBounds(origin, 0, 0, 250, 250);
const way = (id = 1, tags = { building: "yes" }, ring = shapeFootprint("Rectangle", 32, 40, 8)) => ({ type: "way", id, tags,
geometry: ring.map((p) => {
  const [lon, lat] = toLngLat(p, origin);
  return { lon, lat };
}) });
test("all common footprints remain simple and dimensioned after rotation", () => {
  for (const s of SHAPES) for (const a of [0, 37, 90]) assert.ok(validPolygon(shapeFootprint(s, 32, 40, 8, a, 100, -200)),
  s);
  const m = dimensions(shapeFootprint("Rectangle", 32, 40, 8, 37));
  assert.ok(Math.abs(m.length - 40) < 0.01);
  assert.ok(Math.abs(m.width - 32) < 0.01);
  assert.ok(Math.abs(m.area - 1280) < 0.1);
  assert.ok(Math.abs(m.perimeter - 144) < 0.1);
  assert.ok(dimensions(shapeFootprint("U wing", 32, 40, 8)).area < 1280);
  assert.throws(() => shapeFootprint("L wing", 20, 20, 12));
  assert.ok(validPolygon(shapeFootprint("Rectangle", 2, 2, 8)));
  assert.throws(() => shapeFootprint("Rectangle", 40, 20, 4, 0, 1999, 0));
});
test("bounded search does not accept blank, oversized or invalid coordinates", () => {
  for (const p of [[origin, 0, 0, 501, 50], [origin, 0, 0, "", 50], [[0, 90], 0, 0, 50, 50], [origin, 1800, 0, 250, 250]])
   assert.throws(() => searchBounds(...p));
  assert.match(osmQuery(bounds), /out meta geom 301/);
  assert.match(osmQuery(bounds), /relation/);
});
test("height tags honor meter and foot units without guessing unparseable heights", () => {
  assert.equal(osmHeight("12 m"), 12);
  assert.equal(osmHeight("40 ft"), 12.192);
  assert.equal(osmHeight(`7'6"`), 2.286);
  for (const v of ["12;15", "20 floors", "999", "-2", null]) assert.equal(osmHeight(v), null);
});
test("OSM shells preserve provenance and distinguish tags from placeholder dimensions", () => {
  const result = parseOsmBuildings({ elements: [way(1, { building: "yes", height: "12", name: "<b>Warehouse</b>", "build\
ing:levels": "2" }), way(2, { building: "yes", "building:levels": "3" }), way(3)] }, origin, bounds, "2026-10-27T00:00:0\
0Z");
  assert.equal(result.buildings[0].height, 12);
  assert.equal(result.buildings[0].name, "<b>Warehouse</b>");
  assert.equal(result.buildings[1].height, 9);
  assert.match(result.buildings[1].source.heightBasis, /estimate/);
  assert.equal(result.buildings[2].height, 6);
  assert.match(result.buildings[2].source.floorsBasis, /placeholder/);
  const clean = validateFacility({ ...blankFacility(), buildings: result.buildings });
  assert.equal(clean.buildings[0].source.license, "ODbL-1.0");
  assert.equal(clean.buildings[0].source.id, "way/1");
  clean.buildings[0].source.url = "https://invalid.example";
  assert.equal(validateFacility(clean).buildings[0].source.url, void 0);
});
test("relations never become solid courtyards, and invalid/duplicate/outside features are bounded", () => {
  const relation = { type: "relation", id: 10, members: [{ type: "way", ref: 1, role: "outer" }, { type: "way", ref: 2, role: "\
inner" }] };
  const r = parseOsmBuildings({ elements: [way(1), way(2), relation, way(3), way(3), way(4, { building: "yes" }, shapeFootprint(
  "Rectangle", 20, 20, 2, 0, 500, 500))] }, origin, bounds);
  assert.deepEqual(r.buildings.map((b) => b.id), ["osm-way-3"]);
  assert.equal(r.skipped, 4);
  assert.throws(() => parseOsmBuildings({ elements: [], remark: "runtime error" }, origin, bounds));
  assert.throws(() => parseOsmBuildings({ elements: Array(301).fill(way()) }, origin, bounds));
  const r2 = parseOsmBuildings({ elements: [way(8, { building: "yes" }, shapeFootprint("Rectangle", 100, 50, 5, 0, 110, 0))] },
  origin, bounds);
  assert.equal(r2.buildings[0].crossing, true);
  assert.equal(r2.buildings[0].footprint.length, 5);
});
test('raised and uncertain bases are not flattened into ground-level shells', () => {
  const result = parseOsmBuildings({elements:[
    way(11,{building:'yes',min_height:'0.5'}),
    way(12,{building:'yes',min_height:'unknown'}),
    way(13,{building:'yes','building:min_level':'1'}),
    way(14,{building:'yes',min_height:'0 m'}),
  ]},origin,bounds);
  assert.deepEqual(result.buildings.map(b=>b.id),['osm-way-14']);
  assert.equal(result.skipped,3);
});
test("network adapter caps response bytes and reports service failure", async () => {
  let request;
  const result = await fetchOsmBuildings(bounds, void 0, async (url, options) => {
    request = options;
    return new Response(JSON.stringify({ elements: [] }));
  });
  assert.deepEqual(result, { elements: [] });
  assert.equal(request.credentials, "omit");
  assert.match(request.body.get("data"), /maxsize/);
  await assert.rejects(() => fetchOsmBuildings(bounds, void 0, async () => new Response("", { status: 429 })), /busy/);
  await assert.rejects(() => fetchOsmBuildings(bounds, void 0, async () => new Response(" ".repeat(2000001))), /2 MB/);
});
