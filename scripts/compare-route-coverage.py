"""Generated route geometry versus an independent rational rectangle oracle.

Uses Python's standard library and Node. No maps, cameras, models or private data.
The candidate clips arbitrary polygons; the oracle clips only axis-aligned
rectangles with rational slab inequalities, independently of polygon crossings.
"""
import argparse
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASELINE = 'c517b438789efbe81d410f23f2a0a173ed72c86c'
INTEGRATED_BASE = 'cd6d15666beb55a9641068398d82a3d02eaa7769'


def rectangle_interval(a, b, bounds):
    lo, hi = Fraction(0), Fraction(1)
    for axis in (0, 1):
        start, direction = Fraction(a[axis]), Fraction(b[axis] - a[axis])
        if not direction:
            if not bounds[axis] <= start <= bounds[axis + 2]:
                return None
        else:
            p, q = sorted(((Fraction(bounds[axis]) - start) / direction,
                           (Fraction(bounds[axis + 2]) - start) / direction))
            lo, hi = max(lo, p), min(hi, q)
    return (lo, hi) if lo < hi else None


def reference(case):
    total = covered = overlap = longest = blind_run = 0.
    for a, b in zip(case['route'], case['route'][1:]):
        length = math.dist(a, b)
        if not length:
            continue
        total += length
        intervals = [(f['id'], rectangle_interval(a, b, f['box'])) for f in case['fans']]
        intervals = [(name, span) for name, span in intervals if span is not None]
        cuts = sorted({Fraction(0), Fraction(1), *(x for _, span in intervals for x in span)})
        for lo, hi in zip(cuts, cuts[1:]):
            midpoint = (lo + hi) / 2
            cameras = {name for name, (p, q) in intervals if p < midpoint < q}
            part = float(hi - lo) * length
            if cameras:
                covered += part
                if len(cameras) >= 2:
                    overlap += part
                blind_run = 0.
            else:
                blind_run += part
                longest = max(longest, blind_run)
    return {'length': total, 'coveredLength': covered, 'overlapLength': overlap,
            'uncoveredLength': total - covered, 'longestBlindStretch': longest}


def cases():
    rng = random.Random(147)
    output = []
    for index in range(500):
        fans = []
        for n in range(rng.randint(0, 8)):
            x, y = rng.randint(-40, 30), rng.randint(-40, 30)
            right, top = x + rng.randint(1, 30), y + rng.randint(1, 30)
            fans.append({'id': f'camera-{n % 4}', 'box': [x, y, right, top],
                         'ring': [[x, y], [right, y], [right, top], [x, top], [x, y]]})
        route = [[rng.randint(-50, 50), rng.randint(-50, 50)] for _ in range(rng.randint(2, 8))]
        if index % 7 == 0:
            route.insert(1, route[0][:])
        if index % 11 == 0:
            route += route[-2::-1]
        output.append({'route': route, 'fans': fans})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='New receipt path, never overwritten')
    args = parser.parse_args()
    baseline = subprocess.check_output(['git', 'show', f'{BASELINE}:src/facility-coverage.mjs'], cwd=ROOT)
    assert baseline == subprocess.check_output(['git', 'show', f'{INTEGRATED_BASE}:src/facility-coverage.mjs'], cwd=ROOT)
    facility = ROOT/'src/facility.mjs'
    # Baseline geometry helpers are byte-identical; redirect only the temporary
    # module's relative import so it resolves outside the checkout.
    assert facility.read_bytes() == subprocess.check_output(['git', 'show', f'{BASELINE}:src/facility.mjs'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='dvr-route-math-') as directory:
        old = Path(directory)/'coverage.mjs'
        old.write_text(baseline.decode().replace("from './facility.mjs'", f'from {json.dumps(facility.as_uri())}'))
        program = '''import fs from 'node:fs';
import * as old from OLD;
import {routeCoverage,enabledFans,fanCache} from CURRENT;
import {blankFacility,validateFacility} from FACILITY;
const generated=JSON.parse(fs.readFileSync(0,'utf8'));
const matrices=generated.map(c=>routeCoverage(c.route,c.fans));
const cameras=Array.from({length:11},(_,i)=>({id:`c${i}`,name:`C${i}`,x:i*.5,y:-1,z:.5,bearing:0,tilt:45,hfov:5,vfov:60,range:5,enabled:true}));
const plan=validateFacility({...blankFacility(),cameras,route:[[0,0],[5,0]]});
const fans=enabledFans(plan,fanCache()([]));
const one={...cameras[0],x:.25,hfov:25};
const short=validateFacility({...blankFacility(),cameras:[one],route:[[0,0],[.5,0]]});
const tip=validateFacility({...blankFacility(),cameras:[{...one,x:0,y:0,z:4,tilt:30,hfov:90,range:50}],route:[[0,50],[0,50.25]]});
const compare=p=>{const f=enabledFans(p,fanCache()([]));return {baseline:old.routeCoverage(p.route,f),candidate:routeCoverage(p.route,f)};};
console.log(JSON.stringify({matrices,actual_fans:compare(plan),between_samples:compare(short),endpoint_touch:compare(tip)}));'''
        for key, value in [('OLD', old.as_uri()), ('CURRENT', (ROOT/'src/facility-coverage.mjs').as_uri()), ('FACILITY', facility.as_uri())]:
            program = program.replace(key, json.dumps(value))
        generated = cases()
        result = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program],
                                                   input=json.dumps(generated).encode(), cwd=ROOT))
    max_error = {key: 0. for key in reference(generated[0])}
    for case, actual in zip(generated, result['matrices']):
        for key, expected in reference(case).items():
            error = abs(expected - actual[key])
            max_error[key] = max(max_error[key], error)
            assert error <= 1e-9 * max(1., expected), (key, expected, actual, case)
    analytic_length = 20 * math.tan(math.radians(2.5))
    actual = result['actual_fans']['candidate']
    assert abs(actual['coveredLength'] - analytic_length) < 1e-10
    assert abs(actual['coverage'] - analytic_length / 5) < 1e-10
    assert result['between_samples']['baseline']['coverage'] == 0
    assert abs(result['between_samples']['candidate']['coverage'] - 4 * math.tan(math.radians(12.5))) < 1e-10
    assert result['endpoint_touch']['baseline']['coverage'] == .5
    assert result['endpoint_touch']['candidate']['coveredLength'] == 0
    report = {'data_kind': 'synthetic', 'qualification': 'NOT_ESTABLISHED',
              'baseline_revision': BASELINE, 'integrated_base_revision': INTEGRATED_BASE,
              'baseline_sha256': hashlib.sha256(baseline).hexdigest(),
              'candidate_sha256': hashlib.sha256((ROOT/'src/facility-coverage.mjs').read_bytes()).hexdigest(),
              'oracle': {'method': 'Rational slab clipping for rectangles; distinct-camera interval counts weighted by segment length.',
                         'seed': 147, 'cases': len(generated), 'max_absolute_error_metres': max_error,
                         'input_sha256': hashlib.sha256(json.dumps(generated, sort_keys=True).encode()).hexdigest()},
              'valid_narrow_camera_plan': {**result['actual_fans'], 'analytic_covered_length': analytic_length,
                                           'analytic_coverage': analytic_length / 5},
              'valid_short_route_plan': result['between_samples'],
              'valid_endpoint_touch_plan': result['endpoint_touch'],
              'limits': ['Planar drawn geometry only; no physical-camera visibility, tracking, calibration or capacity qualification.',
                         'Oracle rectangles exercise interval arithmetic, distinct IDs, zero-length vertices and repeated traversal; they are not camera footage.']}
    encoded = json.dumps(report, indent=2, allow_nan=False) + '\n'
    if args.output:
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(encoded)
    else:
        print(encoded, end='')


if __name__ == '__main__':
    main()
