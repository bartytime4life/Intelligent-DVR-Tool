import test from 'node:test';
import assert from 'node:assert/strict';
import { blankFacility, coverageFan, validateFacility } from '../src/facility.mjs';
import { enabledFans, routeCoverage } from '../src/facility-coverage.mjs';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected}`);
const camera = (id, x, hfov = 5) => ({ id, name: id, x, y: -1, z: .5,
  bearing: 0, tilt: 45, hfov, vfov: 60, range: 5, enabled: true });
const fans = plan => enabledFans(plan, c => coverageFan(c, []));
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const fan = (id, ring) => ({ id, ring,
  box: [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])),
    Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))] });

test('arclength coverage does not mistake regularly spaced narrow views for a fully visible route', () => {
  const plan = validateFacility({ ...blankFacility(),
    cameras: Array.from({ length: 11 }, (_, i) => camera(`c${i}`, i * .5)), route: [[0, 0], [5, 0]] });
  const result = routeCoverage(plan.route, fans(plan));
  const covered = 20 * Math.tan(2.5 * Math.PI / 180);
  near(result.coverage, covered / 5);
  near(result.overlap, 0);
});

test('short route views between sample positions retain their positive length', () => {
  const plan = validateFacility({ ...blankFacility(), cameras: [camera('one', .25, 25)], route: [[0, 0], [.5, 0]] });
  const result = routeCoverage(plan.route, fans(plan));
  near(result.coverage, 4 * Math.tan(12.5 * Math.PI / 180));
});

test('a single visible endpoint has zero visible arclength', () => {
  const c = { ...camera('one', 0), y: 0, z: 4, tilt: 30, hfov: 90, range: 50 };
  const plan = validateFacility({ ...blankFacility(), cameras: [c], route: [[0, 50], [0, 50.25]] });
  const result = routeCoverage(plan.route, fans(plan));
  near(result.coverage, 0);
});

test('distinct camera IDs get one overlap vote after unioning all of their intervals', () => {
  const result = routeCoverage([[0, 0], [10, 0]], [
    fan('one', rect(2, -1, 6, 1)), fan('one', rect(4, -1, 8, 1)),
    fan('one', rect(2, -1, 6, 1)), fan('two', rect(5, -1, 9, 1)),
  ]);
  assert.equal(result.method, 'arclength-intervals-v1');
  near(result.length, 10); near(result.coveredLength, 7); near(result.overlapLength, 3);
  near(result.uncoveredLength, 3); near(result.longestBlindStretch, 2);
  near(result.coverage, .7); near(result.overlap, .3);
});

test('concave boundaries give separate interior intervals and closed collinear lengths', () => {
  const ring = [[1, -1], [5, -1], [5, 1], [4, 1], [4, 0], [2, 0], [2, 1], [1, 1], [1, -1]];
  near(routeCoverage([[0, .5], [6, .5]], [fan('one', ring)]).coveredLength, 2);
  near(routeCoverage([[0, 0], [6, 0]], [fan('one', ring)]).coveredLength, 4);
  near(routeCoverage([[0, 1], [6, 1]], [fan('one', ring)]).coveredLength, 2);
});

test('vertex tangencies have zero measure and shared crossing vertices keep parity', () => {
  const diamond = fan('one', [[2, 0], [3, 1], [4, 0], [3, -1], [2, 0]]);
  const tangent = routeCoverage([[0, 1], [6, 1]], [diamond]);
  near(tangent.coveredLength, 0); near(tangent.longestBlindStretch, 6);
  near(routeCoverage([[0, 0], [6, 0]], [diamond]).coveredLength, 2);
  near(routeCoverage([[2, 0], [4, 0]], [diamond]).coverage, 1);
});

test('fully collapsed rings do not turn zero-area traces into coverage', () => {
  const empty = fan('line', [[1, 0], [4, 0], [1, 0]]);
  near(routeCoverage([[0, 0], [5, 0]], [empty]).coverage, 0);
  const c = { ...camera('blocked', 0), y: 0, z: 4, tilt: 30, hfov: 90, range: 50 };
  const ring = coverageFan(c, [{ polygon: rect(-20, 1, 20, 1.2), base: 0, top: 6 }]);
  assert.ok(ring.length > 3);
  near(routeCoverage([[-.5, 1], [.5, 1]], [fan(c.id, ring)]).coverage, 0);
});

test('blind stretches continue across route vertices and zero-length segments', () => {
  const result = routeCoverage([[0, 0], [0, 0], [5, 0], [5, 0], [5, 5]], [
    fan('start', rect(-1, -1, 2, 1)), fan('finish', rect(4, 3, 6, 6)),
  ]);
  near(result.length, 10); near(result.coveredLength, 4); near(result.uncoveredLength, 6);
  near(result.longestBlindStretch, 6); assert.equal(result.segments, 2);
});

test('backtracking counts each passage and preserves the blind stretch around a turn', () => {
  const result = routeCoverage([[0, 0], [10, 0], [0, 0]], [fan('one', rect(2, -1, 8, 1))]);
  near(result.length, 20); near(result.coveredLength, 12); near(result.uncoveredLength, 8);
  near(result.longestBlindStretch, 4);
});

test('rotation, translation, route subdivision and ring winding preserve arclength', () => {
  const ring = [[1, -1], [5, -1], [5, 1], [4, 1], [4, 0], [2, 0], [2, 1], [1, 1], [1, -1]];
  const angle = 31 * Math.PI / 180;
  const transform = ([x, y]) => [1990 + x * Math.cos(angle) - y * Math.sin(angle), -1980 + x * Math.sin(angle) + y * Math.cos(angle)];
  const baseline = routeCoverage([[0, .5], [6, .5]], [fan('one', ring)]);
  const transformed = routeCoverage([[0, .5], [1, .5], [3, .5], [3, .5], [6, .5]].map(transform),
    [fan('one', [...ring].reverse().map(transform))]);
  for (const key of ['length', 'coveredLength', 'overlapLength', 'uncoveredLength', 'longestBlindStretch', 'coverage'])
    near(transformed[key], baseline[key], 2e-11);
});

test('tiny nonzero routes and translated positive gaps above floating noise are retained', () => {
  const tiny = routeCoverage([[0, 0], [1e-12, 0]], [fan('one', rect(.25e-12, -1e-12, .75e-12, 1e-12))]);
  near(tiny.length, 1e-12, 1e-26); near(tiny.coveredLength, .5e-12, 1e-26);
  near(tiny.longestBlindStretch, .25e-12, 1e-26); near(tiny.coverage, .5);
  const edge = -1985, right = edge + 1e-8, actualGap = right - edge;
  const shifted = routeCoverage([[-1990, 1990], [-1980, 1990]], [
    fan('one', rect(-1991, 1989, edge, 1991)), fan('two', rect(right, 1989, -1979, 1991)),
  ]);
  assert.ok(shifted.uncoveredLength > 0);
  near(shifted.uncoveredLength, actualGap, 2e-12); near(shifted.longestBlindStretch, actualGap, 2e-12);
  near(shifted.overlapLength, 0);
});

test('zero-length routes remain absent and an empty scene is wholly blind', () => {
  for (const route of [[], [[1, 1]], [[1, 1], [1, 1]]]) assert.equal(routeCoverage(route, []), null);
  const empty = routeCoverage([[0, 0], [3, 4], [3, 4], [6, 4]], []);
  near(empty.length, 8); near(empty.uncoveredLength, 8); near(empty.longestBlindStretch, 8);
  near(empty.coverage, 0); near(empty.overlap, 0);
});

test('all 199 route segments and 500 camera IDs are processed without mutating a maximum-size plan', () => {
  const c = { ...camera('base', 0), y: 0, hfov: 90, tilt: 30, range: 10 };
  const plan = validateFacility({ ...blankFacility(),
    cameras: Array.from({ length: 500 }, (_, i) => ({ ...c, id: `c${i}`, name: `Camera ${i}`, x: i * 1e-8 })),
    route: Array.from({ length: 200 }, (_, i) => [i % 2 ? 1 : -1, 2]),
  });
  const footprint = fans(plan), original = JSON.stringify({ plan, footprint });
  const result = routeCoverage(plan.route, footprint);
  assert.equal(JSON.stringify({ plan, footprint }), original);
  assert.equal(result.segments, 199);
  assert.equal(result.intersectionTests, 199 * 500 * 98);
  near(result.length, 398); near(result.coveredLength, 398); near(result.overlapLength, 398);
  near(result.uncoveredLength, 0); near(result.longestBlindStretch, 0);
});
