#!/usr/bin/env python3
"""Independent, stdlib-only polygon oracle for synthetic route coverage.

Unlike the implementation's projected crossing/event sweep, this oracle splits
each route segment at exact Fraction line/edge intersections and classifies an
exact midpoint in every resulting open interval. Boundary travel counts for
positive-area closed rings; isolated contacts and fully collapsed rings do not.
Generated weakly simple pinches and actual coverageFan occlusion pinches are
included. Nominal wall-boundary probes retain strict-rational discrepancies as
diagnostics, while offsets beyond the implementation's arithmetic tolerance
must agree. Arbitrary crossed rings with cancelling signed area are outside the
production fan contract and are deliberately not used as camera footprints.
No cameras, models, network services or private runtime data are used.
"""

import argparse
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SEED = 6419
FIELDS = ("length", "coveredLength", "overlapLength", "uncoveredLength", "longestBlindStretch")


def point(p):
    return tuple(Fraction(v) for v in p)


def subtract(a, b):
    return (a[0] - b[0], a[1] - b[1])


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def edges(ring):
    return zip(ring, ring[1:] + ring[:1])


def nonzero_area(ring):
    return sum(cross(a, b) for a, b in edges(ring)) != 0


def contains(p, ring):
    """Exact even/odd containment, with closed boundary checked first."""
    inside = False
    for a, b in edges(ring):
        if cross(subtract(p, a), subtract(b, a)) == 0 and all(
            min(a[k], b[k]) <= p[k] <= max(a[k], b[k]) for k in (0, 1)
        ):
            return True
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if p[0] < x:
                inside = not inside
    return inside


def edge_cuts(a, d, q, r):
    e, offset = subtract(r, q), subtract(q, a)
    denominator = cross(d, e)
    if denominator:
        t, u = cross(offset, e) / denominator, cross(offset, d) / denominator
        return [t] if 0 <= t <= 1 and 0 <= u <= 1 else []
    if cross(offset, d):
        return []
    axis = 0 if d[0] else 1
    return [t for t in ((q[axis] - a[axis]) / d[axis], (r[axis] - a[axis]) / d[axis]) if 0 <= t <= 1]


def reference(case):
    fans = [(fan["id"], list(map(point, fan["ring"]))) for fan in case["fans"]]
    fans = [(identifier, ring) for identifier, ring in fans if nonzero_area(ring)]
    route = list(map(point, case["route"]))
    total, covered, overlap, uncovered = [], [], [], []
    blind_run = longest = 0.0
    for a, b in zip(route, route[1:]):
        d = subtract(b, a)
        if d == (0, 0):
            continue
        length = math.hypot(float(d[0]), float(d[1]))
        total.append(length)
        cuts = {Fraction(0), Fraction(1)}
        for _, ring in fans:
            for q, r in edges(ring):
                cuts.update(edge_cuts(a, d, q, r))
        ordered = sorted(cuts)
        for lo, hi in zip(ordered, ordered[1:]):
            t = (lo + hi) / 2
            midpoint = (a[0] + t * d[0], a[1] + t * d[1])
            cameras = {identifier for identifier, ring in fans if contains(midpoint, ring)}
            distance = float(hi - lo) * length
            if cameras:
                covered.append(distance)
                blind_run = 0.0
            else:
                uncovered.append(distance)
                blind_run += distance
                longest = max(longest, blind_run)
            if len(cameras) > 1:
                overlap.append(distance)
    if not total:
        return None
    return dict(zip(FIELDS, (math.fsum(total), math.fsum(covered), math.fsum(overlap), math.fsum(uncovered), longest)))


def rectangle(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]


def generic_cases():
    rng = random.Random(SEED)
    u_ring = [[-8, -8], [8, -8], [8, 8], [3, 8], [3, -2], [-3, -2], [-3, 8], [-8, 8], [-8, -8]]
    # Two same-winding lobes touch at one vertex. Neither is a crossed bow-tie.
    touch = [[0, 0], [0, 6], [-6, 6], [-6, 0], [0, 0], [0, -6], [6, -6], [6, 0], [0, 0]]
    rays = [[-4, 4], [-3, 5], [-2, 6], [-1, 7], [0, 8], [1, 7], [2, 6], [3, 5], [4, 4]]
    result = []
    for n in range(300):
        fans = []
        for j in range(rng.randrange(1, 5)):
            if j % 3 == 0:
                ring = u_ring
            elif j % 3 == 1:
                ring = touch
            else:
                outer = [[x * (s := rng.randrange(1, 5)), y * s] for x, y in rays]
                ring = outer + rays[::-1] + [outer[0]]
            dx, dy = rng.randrange(-10, 11), rng.randrange(-10, 11)
            fans.append({"id": f"camera-{j % 2}", "ring": [[x + dx, y + dy] for x, y in ring]})
        route = [[rng.randrange(-35, 36), rng.randrange(-35, 36)] for _ in range(rng.randrange(2, 7))]
        if n % 3 == 0:
            ring = fans[-1]["ring"]
            k = rng.randrange(len(ring) - 1)
            route = [ring[k], ring[k + 1], route[0]]
        if n % 7 == 0:
            route.insert(1, route[0])
        if n % 11 == 0:
            route += route[-2::-1]
        # An integer similarity gives slanted boundaries without losing exact inputs.
        ax, ay = rng.choice([(1, 0), (2, 1), (-1, 2), (1, -3)])
        tx, ty = rng.choice([(0, 0), (1900, -1850)])
        def transform(p):
            x, y = p
            return [ax * x - ay * y + tx, ay * x + ax * y + ty]
        for fan in fans:
            fan["ring"] = list(map(transform, fan["ring"]))
        result.append({"name": f"generated-{n}", "kind": "generic-weakly-simple", "route": list(map(transform, route)), "fans": fans})
    for gap in (1e-6, 1e-8, 1e-10):
        result.append({"name": f"translated-gap-{gap}", "kind": "small-gap", "route": [[1990, -1980], [1991, -1980]],
                       "fans": [{"id": "one", "ring": rectangle(1989, -1981, 1990.5, -1979)},
                                {"id": "two", "ring": rectangle(1990.5 + gap, -1981, 1992, -1979)}]})
    result.append({"name": "tiny-route", "kind": "small-gap", "route": [[0, 0], [1e-12, 0]],
                   "fans": [{"id": "one", "ring": rectangle(2e-13, -1e-12, 8e-13, 1e-12)}]})
    return result


NODE = r"""
import fs from 'node:fs';
import {routeCoverage} from './src/facility-coverage.mjs';
import {coverageFan, blankFacility, validateFacility} from './src/facility.mjs';
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
let partialPinchedFans = 0, fullyCollapsedFans = 0;
for (const [angle, origin] of [[0,[0,0]], [37,[1900,-1850]], [123,[-1800,1900]]]) {
  const r=angle*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
  const world=([x,y])=>[origin[0]+c*x+s*y,origin[1]-s*x+c*y];
  const rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(world);
  const camera={id:'actual-fan',name:'Generated camera',x:origin[0],y:origin[1],z:4,bearing:angle,tilt:30,hfov:100,vfov:35,range:30,enabled:true};
  validateFacility({...blankFacility(),cameras:[camera]});
  for(const [name,obstacles] of [
    ['clear',[]],
    ['central-pinch',[{polygon:rect(-.7,1,.7,1.2),base:0,top:8}]],
    ['side-pinch',[{polygon:rect(0,1,3,1.2),base:0,top:8}]],
    ['collapsed',[{polygon:rect(-40,1,40,1.2),base:0,top:8}]]
  ]) {
    const ring=coverageFan(camera,obstacles), matching=ring.slice(0,49).filter((p,i)=>p[0]===ring[97-i][0]&&p[1]===ring[97-i][1]).length;
    if(matching===49) fullyCollapsedFans++; else if(matching) partialPinchedFans++;
    const routes=[... [.5,1,1.2,2,3,4,8,15,20].map(y=>[[-25,y],[25,y]].map(world)),
      [world([0,0]),world([0,25]),world([0,0])],
      [ring[20],ring[21],ring[22]], [ring[0],ring[48],ring[0]]];
    for(const [i,route] of routes.entries()) cases.push({name:`coverageFan-${angle}-${name}-${i}`,kind:'production-coverageFan',
      nominal_boundary_probe:i===1&&(name==='central-pinch'||name==='side-pinch'),route,fans:[{id:camera.id,ring}]});
    if(name==='central-pinch'||name==='side-pinch') for(const offset of [-1e-7,1e-7]) {
      cases.push({name:`coverageFan-${angle}-${name}-offset-${offset}`,kind:'production-boundary-offset',
        boundary_case:`coverageFan-${angle}-${name}-1`,normal_offset_metres:offset,
        route:[[-25,1+offset],[25,1+offset]].map(world),fans:[{id:camera.id,ring}]});
    }
  }
}
console.log(JSON.stringify({cases,results:cases.map(c=>routeCoverage(c.route,c.fans)),geometry:{partialPinchedFans,fullyCollapsedFans}}));
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write a new JSON receipt, refusing to replace an existing file.")
    args = parser.parse_args()
    source = ROOT / "src/facility-coverage.mjs"
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    execution = subprocess.run(["node", "--input-type=module", "-e", NODE], cwd=ROOT, input=json.dumps(generic_cases()),
                               text=True, capture_output=True, check=True)
    data = json.loads(execution.stdout)
    maximum = dict.fromkeys(FIELDS, 0.0)
    counts = {}
    diagnostics = []
    offset_results = []
    for case, actual in zip(data["cases"], data["results"], strict=True):
        expected = reference(case)
        counts[case["kind"]] = counts.get(case["kind"], 0) + 1
        if expected is None:
            if actual is not None:
                raise AssertionError(f"{case['name']}: expected zero-length route to return null")
            continue
        if case.get("nominal_boundary_probe"):
            if not all(math.isfinite(actual[field]) for field in FIELDS):
                raise AssertionError(f"{case['name']}: nonfinite boundary result")
            a, b = map(point, case["route"])
            d = subtract(b, a)
            scale = max(abs(v) for p in case["route"] for v in p)
            fan_scale = max(abs(v) for fan in case["fans"] for p in fan["ring"] for v in p)
            epsilon = min(8 * math.ulp(1.0) * max(scale, fan_scale, expected["length"]), expected["length"] * 1e-10)
            distances = [abs(float(cross(d, subtract(point(p), a)))) / expected["length"]
                         for fan in case["fans"] for p in fan["ring"]]
            near = [distance for distance in distances if distance <= epsilon]
            diagnostics.append({"case": case["name"], "comparison": "boundary-sensitive; strict raw-IEEE equality is not asserted",
                                "candidate": {field: actual[field] for field in FIELDS}, "strict_fraction_reference": expected,
                                "arithmetic_tolerance_metres": epsilon, "near_line_vertices": len(near),
                                "max_exact_vertex_distance_within_tolerance_metres": max(near, default=0)})
            continue
        for field in FIELDS:
            error = abs(actual[field] - expected[field])
            maximum[field] = max(maximum[field], error)
            tolerance = 1e-10 * max(expected["length"], 1e-12)
            if not math.isfinite(actual[field]) or error > tolerance:
                raise AssertionError(f"{case['name']} {field}: {actual[field]} != {expected[field]} (tolerance {tolerance})")
        if case["kind"] == "small-gap":
            # The general comparison tolerance must not hide disappearance of
            # these intentionally tiny positive blind intervals.
            gap = expected["uncoveredLength"]
            if not gap > 0 or abs(actual["uncoveredLength"] - gap) > max(gap * 1e-4, 1e-26):
                raise AssertionError(f"{case['name']}: positive small gap was not preserved: {actual['uncoveredLength']} != {gap}")
        if case.get("boundary_case"):
            offset_results.append({"case": case["name"], "boundary_case": case["boundary_case"],
                                   "normal_offset_metres": case["normal_offset_metres"],
                                   "candidate_covered_length": actual["coveredLength"],
                                   "strict_fraction_covered_length": expected["coveredLength"]})
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise AssertionError("Candidate source changed during the comparison; rerun against a frozen source.")
    receipt = {"data_kind": "synthetic", "qualification": "NOT_ESTABLISHED", "result": "PASS",
               "candidate_sha256": source_hash,
               "checker_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "oracle": {"method": "Exact Fraction line/edge cuts and independent closed-boundary midpoint classification; distinct camera IDs; arclength traversal.",
                          "seed": SEED, "cases": len(data["cases"]), "strict_comparison_cases": len(data["cases"]) - len(diagnostics),
                          "case_kinds": counts, "production_geometry": data["geometry"],
                          "acceptance_tolerance": "1e-10 * max(route length, 1e-12) metres for each scalar; small positive gaps additionally within 1e-4 relative error (absolute floor 1e-26 m).",
                          "max_absolute_error_metres": maximum,
                          "input_sha256": hashlib.sha256(json.dumps(data["cases"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()},
               "nominal_boundary_diagnostics": diagnostics, "boundary_offsets_beyond_tolerance": offset_results,
               "limits": ["Finite generated cases establish agreement, not a formal proof or physical-camera qualification.",
                          "Positive-area closed polygon boundaries count; isolated tangent contacts and fully collapsed fans have zero visible arclength.",
                          "Generic weakly simple pinches and production coverageFan occlusion outputs are checked; arbitrary self-crossed/cancelling-area rings are outside the camera fan contract.",
                          "Tiny gaps are above arithmetic noise; floating-point distinctions below that scale are not claimed.",
                          "Almost-collinear rounded edges are snapped to the closed route boundary; arclength can differ materially from strict raw-IEEE containment at this discontinuity. No universal small arclength error bound is claimed."]}
    output = json.dumps(receipt, indent=2) + "\n"
    if args.output:
        with args.output.open("x", encoding="utf-8") as handle:
            handle.write(output)
    print(output, end="")


if __name__ == "__main__":
    main()
