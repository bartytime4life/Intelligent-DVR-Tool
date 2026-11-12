#!/usr/bin/env python3
"""Reproduce generated camera-depth counterexamples; no cameras or inference.

Run from the repository root. The old source is captured from an immutable Git
commit and imported beside the current, unchanged facility geometry helpers.
Temporary public-source modules are removed even if an assertion fails.
"""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

ROOT = Path.cwd()
BASE = '63b06ba2aab3adcffc38f52310b55969fb538afe'
CAMERAS = [
    dict(id='C1', name='Generated camera', x=0, y=0, z=4, bearing=0,
         tilt=60, hfov=90, vfov=60, range=50, enabled=True, pixelsWide=1920),
    dict(id='C1', name='Generated camera', x=0, y=0, z=4, bearing=0,
         tilt=89, hfov=90, vfov=60, range=50, enabled=True, pixelsWide=2000),
]
TARGETS = [dict(forward=.5, width=.2), dict(forward=.02, width=.01)]
NODE = r"""
import {pathToFileURL} from 'node:url';
import {blankFacility, validateFacility, coverageFan, groundRange, pointInPolygon} from './src/facility.mjs';
const {doriDistances,densityAtGround,doriArcs}=await import(pathToFileURL(process.argv[1]).href);
const fixtures=JSON.parse(process.argv[2]);
console.log(JSON.stringify(fixtures.map(({camera:c,target})=>{
  validateFacility({...blankFacility(),cameras:[c]});
  const fan=coverageFan(c,[]);
  return {camera:c,target,ground_view:groundRange(c),density:densityAtGround(c,target.forward),
    identify:doriDistances(c).find(b=>b.id==='identify'),
    identify_contours:doriArcs(c,fan).filter(b=>b.id==='identify'),
    target_inside_drawn_fan:[-1,1].map(sign=>pointInPolygon([sign*target.width/2,target.forward],fan))};
})));
"""


def run_module(path):
    fixtures = [dict(camera=c, target=t) for c, t in zip(CAMERAS, TARGETS)]
    result = subprocess.run(
        ['node', '--input-type=module', '-e', NODE, str(path), json.dumps(fixtures)],
        cwd=ROOT, check=True, text=True, capture_output=True)
    return json.loads(result.stdout)


def project(camera, target):
    # Explicit camera rotation at bearing zero: right, image-down, optical-forward.
    theta = math.radians(camera['tilt'])
    rotation = [[1, 0, 0], [0, -math.sin(theta), -math.cos(theta)],
                [0, math.cos(theta), -math.sin(theta)]]
    focal = camera['pixelsWide'] / (2 * math.tan(math.radians(camera['hfov']) / 2))
    points = []
    for side in [-1, 1]:
        world = [side * target['width'] / 2, target['forward'], -camera['z']]
        view = [sum(a*b for a, b in zip(row, world)) for row in rotation]
        assert view[2] > 0
        normalized = [view[0] / view[2], view[1] / view[2]]
        assert abs(normalized[0]) <= math.tan(math.radians(camera['hfov']) / 2)
        assert abs(normalized[1]) <= math.tan(math.radians(camera['vfov']) / 2)
        points.append([focal * v for v in normalized])
    return dict(projected_offsets=points, both_endpoints_inside_sensor=True,
                horizontal_pixels_per_metre=(points[1][0]-points[0][0])/target['width'])


baseline_bytes = subprocess.check_output(['git', 'show', f'{BASE}:src/facility-dori.mjs'], cwd=ROOT)
temporary = None
try:
    with tempfile.NamedTemporaryFile(dir=ROOT/'src', prefix='.dori-baseline-', suffix='.mjs', delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(baseline_bytes)
    before = run_module(temporary)
finally:
    if temporary is not None:
        temporary.unlink()
after = run_module(ROOT/'src/facility-dori.mjs')
references = [project(c, t) for c, t in zip(CAMERAS, TARGETS)]
for old, new, reference in zip(before, after, references):
    assert all(old['target_inside_drawn_fan']) and all(new['target_inside_drawn_fan'])
    assert old['density'] < 250 < reference['horizontal_pixels_per_metre']
    assert not old['identify']['reached'] and new['identify']['reached']
    assert new['identify']['to'] > new['identify']['from'] > 0
    assert new['identify_contours'] and not old['identify_contours']
    assert abs(new['density'] - reference['horizontal_pixels_per_metre']) < 1e-9

sources = ['src/facility-dori.mjs', 'src/facility.mjs', 'src/facility-coverage.mjs',
           'src/FacilityBuilder.jsx', 'src/facility-map.mjs', 'src/facility-installer.mjs',
           'src/facility-measurements.mjs']
print(json.dumps(dict(
    data_kind='generated', result='PASS', baseline_commit=BASE,
    camera_or_detector_started=False, physical_qualification='NOT_ESTABLISHED',
    baseline_dori_sha256=hashlib.sha256(baseline_bytes).hexdigest(),
    source_sha256={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sources},
    input_sha256=hashlib.sha256(json.dumps([CAMERAS, TARGETS],sort_keys=True,separators=(',',':')).encode()).hexdigest(),
    before=before, after=after, independent_projection=references,
    limits=['Ideal pinhole, roll-free camera and horizontal transverse ground targets.',
            'Drawn fans remain a radial-sector approximation; no field, optical, recognition or compliance qualification.']),
    indent=2, sort_keys=True))
