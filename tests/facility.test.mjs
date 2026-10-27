import test from "node:test";
import assert from "node:assert/strict";
import { exampleFacility, blankFacility, validateFacility, parseFacility, toLngLat, fromLngLat, coverageFan, seesPoint, wallObstacles,
rehearse, routePoint, validPolygon, groundRange, LIMITS } from "../src/facility.mjs";
const camera = { id: "C-test", name: "Test camera", x: 0, y: 0, z: 4, bearing: 0, tilt: 30, hfov: 90, vfov: 60, range: 50,
enabled: true };
test("sample and empty facility round trip through the bounded public contract", () => {
  for (const f of [exampleFacility(), blankFacility()]) assert.deepEqual(parseFacility(JSON.stringify(f)), f);
});
test("coordinate projection preserves local-meter geometry at Kansas latitude", () => {
  const o = [-98, 38.5], p = [130.5, -75.2], q = fromLngLat(toLngLat(p, o), o);
  assert.ok(Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6);
});
test("polygons reject self crossings, degenerate areas and unclosed rings", () => {
  assert.equal(validPolygon([[0, 0], [20, 20], [0, 20], [20, 0], [0, 0]]), false);
  assert.equal(validPolygon([[0, 0], [1, 0], [0, 1], [0, 0]]), false);
  assert.equal(validPolygon([[0, 0], [20, 0], [20, 20], [0, 20]]), false);
});
test("ground plane coverage respects direction, near limit, far limit and enabled state", () => {
  assert.equal(seesPoint(camera, [0, 10], []), true);
  assert.equal(seesPoint(camera, [0, -10], []), false);
  assert.equal(seesPoint(camera, [0, 1], []), false);
  assert.equal(seesPoint(camera, [0, 51], []), false);
  assert.equal(seesPoint({ ...camera, enabled: false }, [0, 10], []), false);
  assert.equal(coverageFan({ ...camera, enabled: false }, []).length, 0);
});
test("opaque walls block lines of sight while a low obstacle can be seen over", () => {
  const wall = { polygon: [[-5, 5], [5, 5], [5, 6], [-5, 6], [-5, 5]], base: 0, top: 6 };
  assert.equal(seesPoint(camera, [0, 20], [wall]), false);
  assert.equal(seesPoint(camera, [0, 20], [{ ...wall, top: 0.5 }]), true);
  const fan = coverageFan(camera, [wall]);
  assert.ok(fan.length > 3);
  assert.ok(fan.every((p) => p.every(Number.isFinite)));
});
test("narrow downward views cannot claim ground coverage before their near distance", () => {
  const c = { ...camera, tilt: 70, vfov: 10 };
  const { near, far } = groundRange(c);
  assert.ok(far < 3 && near > 0);
  assert.equal(seesPoint(c, [0, 5], []), false);
});
test("route interpolation follows distance, including repeated points", () => {
  assert.deepEqual(routePoint([[0, 0], [0, 0], [0, 10], [10, 10]], 0.75), [5, 10]);
  assert.deepEqual(routePoint([[0, 0], [0, 10]], 1), [0, 10]);
});
test("rehearsal returns explicit gaps instead of inferred observations", () => {
  const p = { ...blankFacility(), cameras: [camera], route: [[0, -10], [0, 20]] };
  const samples = rehearse(p);
  assert.equal(samples.length, 61);
  assert.deepEqual(samples[0].cameras, []);
  assert.deepEqual(samples.at(-1).cameras, ["C-test"]);
});
test("bad imports reject non-finite values, duplicates, invalid room floor and oversize JSON", () => {
  for (const mutate of [(p) => p.cameras[0].z = NaN, (p) => p.cameras[1].id = p.cameras[0].id, (p) => p.rooms[0].level =
  99, (p) => p.origin[1] = 90, (p) => p.cameras[0].range = 301]) {
    const p = exampleFacility();
    mutate(p);
    assert.throws(() => validateFacility(p));
  }
  assert.throws(() => parseFacility(" ".repeat(LIMITS.bytes + 1)));
});
test("import only retains declared geometry and text fields, never media URLs or HTML properties", () => {
  const p = exampleFacility();
  p.cameras[0].streamUrl = "https://untrusted.invalid";
  p.cameras[0].html = "<img onerror=alert(1)>";
  const clean = validateFacility(p);
  assert.equal(clean.cameras[0].streamUrl, void 0);
  assert.equal(clean.cameras[0].html, void 0);
});
test("100-camera metadata inventory remains valid without making a video throughput claim", () => {
  const p = blankFacility();
  p.cameras = Array.from({ length: 100 }, (_, i) => ({ ...camera, id: "C-" + i, name: "Camera " + i, x: i % 10 * 10, y: Math.
  floor(i / 10) * 10 }));
  assert.equal(validateFacility(p).cameras.length, 100);
  assert.equal(rehearse({ ...p, route: [[0, 0], [80, 80]] }, 11).length, 11);
});
test("room must stay within its building footprint and building deletion cannot leave orphan rooms", () => {
  const p = exampleFacility();
  p.rooms[0].footprint[0][0] = 1e3;
  assert.throws(() => validateFacility(p));
  const q = exampleFacility();
  q.buildings = q.buildings.filter((b) => b.id !== "b2");
  assert.throws(() => validateFacility(q));
});
test("rooms cannot bridge outside a concave building even when every vertex is inside", () => {
  const p = blankFacility();
  p.buildings = [{ id: "b", name: "L-shaped building", footprint: [[0, 0], [10, 0], [10, 3], [3, 3], [3, 10], [0, 10], [
  0, 0]], height: 8, floors: 2 }];
  p.rooms = [{ id: "r", name: "Invalid room", buildingId: "b", level: 0, wallHeight: 2.8, footprint: [[1, 1], [9, 1], [1,
  9], [1, 1]] }];
  assert.throws(() => validateFacility(p));
});
