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
  assert.equal(samples.length, 31);
  assert.ok(Math.abs(samples.at(-1).seconds - 30 / 1.4) < 1e-9);
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
import { polygonArea, snapToBuilding, solidSpaceProblem, createFloorOpening, applyBuildingEdit, reoriginPlan, fittingRectangle,
ringsInteriorOverlap, polygonContains } from "../src/facility.mjs";
import { moveShape, rotateShape, resizeShape } from "../src/facility-shape-edit.mjs";
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
test("a facade camera a few centimetres inside its building sees out like one just outside; other walls still occlude", () => {
  const hall = { id: "h", name: "Hall", footprint: box(-50, 0, 100, 50), height: 8, floors: 1 };
  const walls = wallObstacles({ ...blankFacility(), buildings: [hall] }), at = (y) => ({ ...camera, y, bearing: 180 });
  const outside = polygonArea(coverageFan(at(-0.01), walls)), inside = polygonArea(coverageFan(at(0.01), walls));
  assert.ok(outside > 1000);
  assert.ok(Math.abs(inside - outside) / outside < 0.01, `${inside} vs ${outside}`);
  assert.equal(seesPoint(at(0.01), [0, -10], walls), true);
  assert.equal(seesPoint(at(1), [0, -10], walls), false);
  const shed = wallObstacles({ ...blankFacility(), buildings: [hall, { id: "s", name: "Shed", footprint: box(-20, -21, 40, 1), height: 6, floors: 1 }] });
  assert.equal(seesPoint(at(0.01), [0, -15], shed), true);
  assert.equal(seesPoint(at(0.01), [0, -30], shed), false);
});
test("drawn vertices up to 30 cm outside solid floor snap to the wall; larger misses name the vertex or edge", () => {
  const b = { id: "b", name: "Hall", footprint: box(0, 0, 20, 10), holes: [box(8, 4, 4, 2)], height: 8, floors: 2 };
  const fit = snapToBuilding([[1, 1], [5, 1], [5, 10.2], [1, 10.25], [1, 1]], b);
  assert.equal(fit.snapped, 2);
  assert.deepEqual(fit.points.slice(2, 4), [[5, 10], [1, 10]]);
  assert.deepEqual(fit.points.at(-1), fit.points[0]);
  assert.equal(solidSpaceProblem(fit.points, b), null);
  const room = { id: "r", name: "Room", buildingId: "b", level: 0, wallHeight: 2.8, footprint: fit.points };
  assert.doesNotThrow(() => validateFacility({ ...blankFacility(), buildings: [b], rooms: [room] }));
  const far = snapToBuilding([[1, 1], [5, 1], [5, 11], [1, 11], [1, 1]], b);
  assert.equal(far.snapped, 0);
  const problem = solidSpaceProblem(far.points, b);
  assert.equal(problem.vertex, 3);
  assert.equal(problem.where, "outside");
  assert.ok(Math.abs(problem.distance - 1) < 1e-9);
  const courtyard = snapToBuilding([[6, 1], [8.1, 1], [8.1, 5], [6, 5], [6, 1]], b);
  assert.deepEqual(courtyard.points[2], [8, 5]);
  assert.deepEqual(solidSpaceProblem(courtyard.points, b), { edge: [2, 3] });
  assert.equal(solidSpaceProblem([[6, 1], [8.5, 1], [8.5, 5], [6, 5], [6, 1]], b).where, "courtyard");
  const opening = snapToBuilding([[2, 2], [4, 2], [4, 10.1], [2, 10.1], [2, 2]], b, { clearance: 0.05 });
  assert.ok(opening.points.every((p) => p[1] <= 9.95 + 1e-9));
  assert.doesNotThrow(() => createFloorOpening({ ...blankFacility(), buildings: [b] }, "b", 1, opening.points));
  const corner = snapToBuilding([[-0.1, -0.1], [3, 0.5], [3, 3], [0.5, 3], [-0.1, -0.1]], b, { clearance: 0.05 });
  assert.deepEqual(corner.points[0].map((v) => +v.toFixed(9)), [0.05, 0.05]);
  assert.doesNotThrow(() => createFloorOpening({ ...blankFacility(), buildings: [b] }, "b", 0, corner.points));
  assert.equal(snapToBuilding([[6, 1], [8.1, 5]], b, { holes: false }).snapped, 0);
});
function hallPlan() {
  const hall = { id: "h", name: "Hall", footprint: box(0, 0, 20, 10), height: 9, floors: 3 };
  return validateFacility({ ...blankFacility(), buildings: [hall, { id: "o", name: "Other", footprint: box(40, 0, 10, 10), height: 5, floors: 1 }],
    rooms: [{ id: "r", name: "Office", buildingId: "h", level: 0, wallHeight: 2.8, footprint: box(1, 1, 5, 4) },
      { id: "u", name: "Upper", buildingId: "h", level: 2, wallHeight: 2.8, footprint: box(1, 1, 5, 4) }],
    cameras: [{ ...camera, id: "wall", x: 10, y: -0.2, bearing: 180 }, { ...camera, id: "yard", x: 10, y: -20 }],
    labels: [{ id: "l", name: "Desk", x: 3, y: 3, z: 0 }],
    openings: [{ id: "op", name: "Atrium", buildingId: "h", level: 1, footprint: box(12, 2, 3, 3) }],
    paths: [{ id: "p", name: "Walk", buildingId: "h", level: 0, points: [[8, 2], [8, 8]] }],
    zones: [{ id: "z", name: "Store", type: "restricted", footprint: box(16, 6, 2, 2), enabled: true, expectedClasses: ["person"], dwellSeconds: 2, buildingId: "h", level: 0 }],
    stairs: [{ id: "s", name: "Stair", buildingId: "h", fromLevel: 0, toLevel: 1, x: 18.5, y: 5, bearing: 0, width: 1, tread: 0.28, risers: 18, landing: 1 }] });
}
test("moving or rotating a building carries its rooms, floor items, indoor zones, labels and wall cameras", () => {
  const plan = hallPlan(), hall = plan.buildings[0];
  const moved = validateFacility(applyBuildingEdit(plan, moveShape(hall, "x", 110)));
  assert.deepEqual(moved.rooms[0].footprint[0], [101, 1]);
  assert.deepEqual(moved.openings[0].footprint[0], [112, 2]);
  assert.deepEqual(moved.paths[0].points[0], [108, 2]);
  assert.deepEqual(moved.zones[0].footprint[0], [116, 6]);
  assert.equal(moved.stairs[0].x, 118.5);
  assert.deepEqual([moved.cameras[0].x, moved.cameras[1].x, moved.labels[0].x], [110, 10, 103]);
  assert.deepEqual(moved.buildings[1], plan.buildings[1]);
  const turned = validateFacility(applyBuildingEdit(plan, rotateShape(hall, 90)));
  const close = (p, q) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9, `${p} vs ${q}`);
  close(turned.rooms[0].footprint[0], [14, -4]);
  close([turned.cameras[0].x, turned.cameras[0].y], [15.2, 5]);
  assert.equal(turned.cameras[0].bearing, 90);
  assert.equal(turned.stairs[0].bearing, 270);
  assert.deepEqual(turned.cameras[1], plan.cameras[1]);
});
test("resizes keep contents in place with a named error, and level cuts list what still uses them", () => {
  const plan = hallPlan(), hall = plan.buildings[0];
  assert.throws(() => validateFacility(applyBuildingEdit(plan, resizeShape(hall, "width", 4))), /Check room “Office” in Hall/);
  assert.throws(() => applyBuildingEdit(plan, { ...hall, floors: 2 }), /room “Upper” \(Level 3\)/);
  assert.throws(() => applyBuildingEdit(plan, { ...hall, floors: 1 }), /stair “Stair” \(Levels 1–2\).*Move or remove them first/);
  const noUpper = { ...plan, rooms: plan.rooms.filter((r) => r.id !== "u") };
  assert.equal(validateFacility(applyBuildingEdit(noUpper, { ...hall, floors: 2 })).buildings[0].floors, 2);
});
test("re-centring the site origin can keep every item at its map position and dimensions", () => {
  const plan = hallPlan(), origin = [plan.origin[0] + 0.001, plan.origin[1] + 0.0005], next = reoriginPlan(plan, origin);
  const ground = (p, o) => fromLngLat(toLngLat(p, o), plan.origin);
  for (const [a, b] of [[plan.buildings[0].footprint[2], next.buildings[0].footprint[2]], [[plan.cameras[0].x, plan.cameras[0].y], [next.cameras[0].x, next.cameras[0].y]]]) {
    const q = ground(b, next.origin);
    assert.ok(Math.hypot(q[0] - a[0], q[1] - a[1]) < 1e-4);
  }
  // Local eastings rescale with the origin latitude (parts per million here), so widths stay within 1 mm.
  assert.ok(Math.abs(next.rooms[0].footprint[2][0] - next.rooms[0].footprint[0][0] - 5) < 1e-3);
  // Far from the equator a uniform shift would move a camera 1,900 m east by about 1.9 m.
  const polar = {...plan, origin:[0, 79.98], cameras:[{...plan.cameras[0], x:1900, y:0}]}, moved = reoriginPlan(polar, [0, 79.99]);
  const q = fromLngLat(toLngLat([moved.cameras[0].x, moved.cameras[0].y], moved.origin), polar.origin);
  assert.ok(Math.hypot(q[0] - 1900, q[1]) < 1e-4);
  assert.equal(validateFacility(next).origin[0], origin[0]);
  assert.throws(() => reoriginPlan(plan, [plan.origin[0] + 0.05, plan.origin[1]]), /2 km/);
});
test("a rectangular room is placed inside solid floor, even in concave buildings, avoiding existing rooms", () => {
  const l = { id: "l", name: "L", footprint: [[0, 0], [30, 0], [30, 6], [6, 6], [6, 30], [0, 30], [0, 0]], height: 6, floors: 1 };
  const ring = fittingRectangle(l);
  assert.ok(polygonContains(l.footprint, ring) && polygonArea(ring) === 16);
  const second = fittingRectangle(l, 4, [ring]);
  assert.ok(polygonContains(l.footprint, second) && !ringsInteriorOverlap(ring, second));
  assert.throws(() => fittingRectangle({ ...l, footprint: box(0, 0, 0.5, 30) }), /No space/);
});
import { levelDependents, rehearsalSeconds } from "../src/facility.mjs";
test("indoor labels keep a building level, ground labels stay valid, and level cuts name them", () => {
  const plan = hallPlan(), label = { id: "l2", name: "Door 2B", x: 4, y: 4, z: 0, buildingId: "h", level: 2 };
  const clean = validateFacility({ ...plan, labels: [...plan.labels, label] });
  assert.deepEqual(clean.labels.at(-1), label);
  assert.equal(clean.labels[0].level, undefined);
  for (const bad of [{ level: 3 }, { buildingId: "missing" }, { level: 1.5 }, { buildingId: undefined }]) assert.throws(() => validateFacility({ ...plan, labels: [{ ...label, ...bad }] }), /Indoor labels/);
  assert.ok(levelDependents(clean, "h", 2).includes("label “Door 2B” (Level 3)"));
  const moved = validateFacility(applyBuildingEdit(clean, moveShape(clean.buildings[0], "x", 30)));
  assert.equal(moved.labels.at(-1).x, 24);
});
test("rehearsal time follows route distance at walking pace and samples at most every metre", () => {
  const p = { ...blankFacility(), cameras: [camera], route: [[0, 0], [0, 30], [40, 30]] };
  assert.ok(Math.abs(rehearsalSeconds(p.route) - 50) < 1e-9);
  const samples = rehearse(p);
  assert.equal(samples.length, 71);
  assert.ok(Math.abs(samples.at(-1).seconds - 50) < 1e-9 && Math.abs(samples[1].seconds - 1 / 1.4) < 1e-9);
  assert.equal(rehearse({ ...p, route: [[0, 0], [1900, 0], [1900, 1900], [0, 1900]] }).length, 601);
  assert.equal(rehearsalSeconds([[1, 1]]), 0);
});
