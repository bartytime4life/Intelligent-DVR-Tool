#!/usr/bin/env python3
"""Independent generated pinhole oracle. Writes only new artifacts outside repo.

Expected image coordinates use a world-to-camera orthonormal rotation followed
by the pinhole intrinsic matrix. Density comes from two separately projected
transverse ground endpoints. Threshold locations are found by bisection; fan
cross-sections use generic polygon winding/intersection, then sensor masking.
No candidate projection, density, root or clipping helper supplies expectations.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

BANDS = [('detect', 25), ('observe', 62.5), ('recognize', 125), ('identify', 250)]
BASE = '63b06ba2aab3adcffc38f52310b55969fb538afe'
REFERENCE = 'https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html'
GEOM_TOL = 2e-6


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False)+'\n').encode()


def fingerprint(raw):
    return hashlib.sha256(raw).hexdigest()


def input_bytes(path):
    raw = path.read_bytes()
    return gzip.decompress(raw) if path.suffix == '.gz' else raw


def basis(c):
    b, t = math.radians(c['bearing']), math.radians(c['tilt'])
    right = (math.cos(b), -math.sin(b), 0.)
    heading = (math.sin(b), math.cos(b), 0.)
    down = (-math.sin(t)*heading[0], -math.sin(t)*heading[1], -math.cos(t))
    forward = (math.cos(t)*heading[0], math.cos(t)*heading[1], -math.sin(t))
    return right, heading, down, forward


def world(c, x, y):
    right, heading, _, _ = basis(c)
    return [c['x']+right[0]*x+heading[0]*y,
            c['y']+right[1]*x+heading[1]*y]


def local(c, p):
    right, heading, _, _ = basis(c)
    delta = [p[0]-c['x'], p[1]-c['y']]
    return [sum(delta[i]*right[i] for i in range(2)),
            sum(delta[i]*heading[i] for i in range(2))]


def project(c, p):
    right, _, down, forward = basis(c)
    delta = (p[0]-c['x'], p[1]-c['y'], -c['z'])
    X, Y, Z = [sum(a*b for a, b in zip(row, delta)) for row in (right, down, forward)]
    if Z <= 0:
        return None
    W, H = c['pixelsWide'], 1080.
    fx = W/(2*math.tan(math.radians(c['hfov'])/2))
    fy = H/(2*math.tan(math.radians(c['vfov'])/2))
    return [fx*X/Z+W/2, fy*Y/Z+H/2, Z]


def density(c, y, x=0.):
    # One metre parallel to camera-right. Both ends have the same camera Z.
    a, b = project(c, world(c, x-.5, y)), project(c, world(c, x+.5, y))
    return abs(b[0]-a[0]) if a is not None and b is not None else None


def root(c, ppm):
    initial = density(c, 0.)
    if initial is not None and initial < ppm:
        return None
    lo, hi = 0., 1.
    while density(c, hi) > ppm:
        hi *= 2
        if hi > 1e12:
            raise AssertionError('Generated threshold root exceeded bound')
    for _ in range(90):
        mid = (lo+hi)/2
        if density(c, mid) > ppm:
            lo = mid
        else:
            hi = mid
    return (lo+hi)/2


def view(c):
    # Fixture construction preserves the existing *radial approximation*
    # convention, including its 89.9-degree near cap. This is not an oracle
    # for groundRange or a claim that this fan equals the sensor frustum.
    near = max(0., c['z']/math.tan(math.radians(min(89.9, c['tilt']+c['vfov']/2))))
    angle = c['tilt']-c['vfov']/2
    far = c['range'] if angle <= 0 else min(c['range'], c['z']/math.tan(math.radians(angle)))
    return [near, far]


def fan(c, steps=48, wall=False):
    near, far = view(c)
    if near >= far or not c['enabled']:
        return []
    outer, inner = [], []
    for i in range(steps+1):
        a = math.radians(-c['hfov']/2+c['hfov']*i/steps)
        radius = far
        if wall and abs(10*math.tan(a)) <= 2:
            radius = min(radius, 10/math.cos(a))
        outer.append(world(c, radius*math.sin(a), radius*math.cos(a)))
        inner.append(world(c, min(near, radius)*math.sin(a), min(near, radius)*math.cos(a)))
    return outer+list(reversed(inner))+[outer[0]]


def make_inputs():
    default = dict(id='generated', name='Generated pinhole', x=0., y=0., z=4., bearing=0.,
                   tilt=30., hfov=90., vfov=60., range=50., enabled=True, pixelsWide=1920)
    cases = []
    index = 0
    def add(name, c, ring=None, **notes):
        near, far = view(c) if c is not None and valid(c) else (None, None)
        distances = [0., .02, .5, 2., 10., 100.]
        if near is not None:
            distances += [near, far, (near+far)/2]
        cases.append(dict(id=name, camera=c, fan=fan(c) if ring is None and valid(c) else ring or [],
                          view=[near, far], distances=distances, notes=notes))
    for tilt in [0., 15., 35., 60., 80., 89.]:
        for hfov in [30., 90., 150.]:
            for vfov in [20., 60.]:
                for width in [640, 2000]:
                    for x, y, bearing in [(0., 0., 0.), (123.25, -97.5, 37.), (-1500., 1200., 289.)]:
                        c = dict(default, tilt=tilt, hfov=hfov, vfov=vfov, pixelsWide=width,
                                 z=[.5, 4., 20.][index % 3], range=[10., 50., 300.][(index//3) % 3],
                                 x=x, y=y, bearing=bearing)
                        add(f'grid-{index:03}', c, fan(c, steps=16), generated_radial_segments=16)
                        index += 1
    for tilt, width in [(60., 1920), (89., 2000)]:
        add(f'steep-{tilt:g}', dict(default, tilt=tilt, pixelsWide=width))
    for bearing in [0., 90., 237.]:
        c = dict(default, bearing=bearing, x=500., y=-750.)
        add(f'concave-wall-{bearing:g}', c, fan(c, wall=True), expects_split='observe')
    hfov = math.degrees(2*math.atan(1920/(2*250*(4*math.sin(math.pi/3)+.006*math.cos(math.pi/3)))))
    for bearing in [0., 123.]:
        c = dict(default, tilt=60., hfov=hfov, bearing=bearing, x=-200., y=400.)
        add(f'off-axis-only-{bearing:g}', c, expects_off_axis_only='identify')
    add('empty-ground-interval', dict(default, tilt=0., vfov=5., range=1.))
    add('disabled', dict(default, enabled=False))
    c = dict(default)
    add('empty-fan', c, [])
    add('collapsed-fan', c, [world(c, x, 5.) for x in [-2., 0., 2., -2.]])
    for field, value in [('z', 0.), ('z', 151.), ('tilt', 90.), ('hfov', 0.),
                         ('vfov', 151.), ('range', 0.), ('pixelsWide', 319), ('pixelsWide', 1920.5)]:
        add(f'invalid-{field}-{value}', dict(default, **{field:value}), [])
    add('invalid-null-camera', None, [])
    return {'schema':'intelligent-dvr.independent-dori-oracle-inputs.v1',
            'generated_only':True, 'camera_cases':cases,
            'radial_fan_policy':'Independent generated radial polygon fixtures retain the existing declared groundRange near/far convention, including 89.9-degree near clamp; the oracle checks clipping within those supplied polygons, not coverageFan or physical visibility.'}


def valid(c):
    if not isinstance(c, dict): return False
    bounds = {'z':(.5,150), 'tilt':(0,89), 'hfov':(5,170), 'vfov':(5,150), 'range':(1,300)}
    return (all(type(c.get(k)) in (int, float) and math.isfinite(c[k]) and low <= c[k] <= high
                for k,(low,high) in bounds.items()) and type(c.get('pixelsWide')) is int and 320 <= c['pixelsWide'] <= 7680)


def contains(point, ring):
    winding = 0
    x,y = point
    for a,b in zip(ring, ring[1:]+ring[:1]):
        cross = (b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])
        if abs(cross) <= 1e-9 and min(a[0],b[0])-1e-9 <= x <= max(a[0],b[0])+1e-9 and min(a[1],b[1])-1e-9 <= y <= max(a[1],b[1])+1e-9:
            return True
        if a[1] <= y < b[1] and cross > 0: winding += 1
        elif b[1] <= y < a[1] and cross < 0: winding -= 1
    return winding != 0


def expected_fragments(c, ring, ppm):
    y = root(c, ppm)
    if y is None or len(ring) < 4 or not c['enabled']:
        return []
    local_ring = [local(c,p) for p in ring]
    # Area rejects collapsed rings without treating boundary membership as area.
    area2 = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(local_ring,local_ring[1:]+local_ring[:1]))
    if abs(area2) < 1e-9:
        return []
    middle = project(c, world(c,0.,y))
    if middle is None or not -1e-7 <= middle[1] <= 1080+1e-7:
        return []
    cuts = []
    for a,b in zip(local_ring, local_ring[1:]+local_ring[:1]):
        if abs(a[1]-y) < 1e-10: cuts.append(a[0])
        if min(a[1],b[1]) <= y <= max(a[1],b[1]) and abs(b[1]-a[1]) > 1e-12:
            cuts.append(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]))
    cuts.sort()
    unique = []
    for x in cuts:
        if not unique or x-unique[-1] > 1e-8: unique.append(x)
    result=[]
    for lo,hi in zip(unique,unique[1:]):
        if hi-lo < 1e-8 or not contains([(lo+hi)/2,y],local_ring): continue
        ulo, uhi = project(c,world(c,lo,y))[0],project(c,world(c,hi,y))[0]
        if uhi <= 0 or ulo >= c['pixelsWide']: continue
        # u is affine along this transverse line because camera depth is fixed.
        left = lo+(hi-lo)*max(0.,-ulo)/(uhi-ulo) if ulo < 0 else lo
        right = hi-(hi-lo)*max(0.,uhi-c['pixelsWide'])/(uhi-ulo) if uhi > c['pixelsWide'] else hi
        if right-left > 1e-7:
            if result and abs(left-result[-1][1]) < 1e-8: result[-1][1]=right
            else: result.append([left,right,y])
    return result


HARNESS = r"""
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const [input,modulePath] = process.argv.slice(2);
const data=JSON.parse(fs.readFileSync(input,'utf8'));
const module=await import(pathToFileURL(modulePath));
const before=JSON.stringify(data);
const safe=callback=>{try{return callback();}catch(error){return {error:error.message};}};
const output=data.camera_cases.map(row=>({id:row.id,
 density:row.distances.map(distance=>safe(()=>module.densityAtGround(row.camera,distance))),
 bands:safe(()=>module.doriDistances(row.camera)),
 arcs:safe(()=>module.doriArcs(row.camera,row.fan))}));
if(before!==JSON.stringify(data))throw new Error('Evaluator mutated generated inputs');
console.log(JSON.stringify(output));
"""


def snapshot(repo, directory, revision):
    modules={}
    def capture(name):
        if name in modules: return
        raw = (subprocess.check_output(['git','show',f'{revision}:{name}'],cwd=repo)
               if revision else (repo/name).read_bytes())
        modules[name]=fingerprint(raw)
        target=directory/name
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(raw)
        for dependency in re.findall(r"from\s+['\"]([^'\"]+)['\"]",raw.decode()):
            assert dependency.startswith('.'), f'Unexpected external dependency {dependency}'
            capture(str((Path(name).parent/dependency).as_posix()).replace('/./','/'))
    capture('src/facility-dori.mjs')
    return modules


def check(inputs, observed):
    failures=[]
    counts={'density_queries':0,'table_bands':0,'contour_cases':0,'contour_fragments':0,'contour_points':0,'invalid_cases':0}
    maxima={'density_absolute_error':0.,'table_endpoint_metres_error':0.,'contour_geometry_metres_error':0.,'contour_density_error':0.}
    def fail(case,check,detail):
        failures.append({'case':case,'check':check,'detail':detail})
    assert len(inputs['camera_cases'])==len(observed)
    for row,out in zip(inputs['camera_cases'],observed):
        name,c,ring=row['id'],row['camera'],row['fan']
        assert name==out['id']
        if not valid(c):
            counts['invalid_cases']+=1
            if out['bands'] is not None or out['arcs'] != [] or any(v is not None for v in out['density']):
                fail(name,'invalid-refusal',out)
            continue
        for d,actual in zip(row['distances'],out['density']):
            counts['density_queries']+=1
            expected=density(c,d)
            if expected is None:
                if actual is not None: fail(name,'nonpositive-depth',{'distance':d,'actual':actual})
            elif not isinstance(actual,(int,float)) or abs(actual-expected)>max(1e-7,expected*2e-10):
                fail(name,'density',{'distance':d,'actual':actual,'expected':expected})
            else: maxima['density_absolute_error']=max(maxima['density_absolute_error'],abs(actual-expected))
        if not isinstance(out['bands'],list) or len(out['bands'])!=4:
            fail(name,'table-shape',out['bands']);continue
        near,far=row['view']
        expected_arcs={}
        for band,(band_id,ppm) in zip(out['bands'],BANDS):
            counts['table_bands']+=1
            crossing=root(c,ppm)
            reached=far>near and crossing is not None and crossing>near
            if band['id']!=band_id or band['reached']!=reached:
                fail(name,'table-reached',{'band':band_id,'actual':band,'expected_reached':reached})
            if abs(band['from']-near)>1e-8: fail(name,'table-from',band)
            if reached:
                to=min(crossing,far)
                error=abs(band['to']-to)
                maxima['table_endpoint_metres_error']=max(maxima['table_endpoint_metres_error'],error)
                if error>GEOM_TOL: fail(name,'table-to',{'band':band_id,'actual':band['to'],'expected':to})
                if abs(crossing-far)>1e-6 and band['limited']!=(crossing>=far):
                    fail(name,'table-far-clip',band)
            fragments=expected_fragments(c,ring,ppm)
            if fragments: expected_arcs[band_id]=fragments
        counts['contour_cases']+=1
        arcs=out['arcs']
        if not isinstance(arcs,list): fail(name,'contour-shape',arcs);continue
        actual_arcs={a['id']:a for a in arcs}
        if set(actual_arcs)!=set(expected_arcs):
            fail(name,'contour-band-set',{'actual':sorted(actual_arcs),'expected':sorted(expected_arcs)})
        for band_id,expected in expected_arcs.items():
            if band_id not in actual_arcs: continue
            arc=actual_arcs[band_id]
            lines=arc['lines']
            counts['contour_fragments']+=len(lines)
            ppm=dict(BANDS)[band_id]
            actual=[]
            for line in lines:
                if len(line)<2: fail(name,'collapsed-fragment',line);continue
                endpoints=sorted([local(c,line[0]),local(c,line[-1])])
                actual.append([endpoints[0][0],endpoints[1][0],(endpoints[0][1]+endpoints[1][1])/2])
                for a,b in zip(line,line[1:]):
                    for f in [0.,.25,.5,.75,1.]:
                        p=[a[i]+f*(b[i]-a[i]) for i in range(2)]
                        x,y=local(c,p); image=project(c,p)
                        counts['contour_points']+=1
                        value=density(c,y,x)
                        error=abs(value-ppm) if value is not None else math.inf
                        maxima['contour_density_error']=max(maxima['contour_density_error'],error)
                        if error>1e-5: fail(name,'contour-projected-density',{'band':band_id,'actual':value,'expected':ppm});break
                        if not contains([x,y],[local(c,q) for q in ring]):
                            fail(name,'contour-outside-fan',{'band':band_id,'point':p});break
                        if image is None or not -GEOM_TOL<=image[0]<=c['pixelsWide']+GEOM_TOL or not -GEOM_TOL<=image[1]<=1080+GEOM_TOL:
                            fail(name,'contour-outside-sensor',{'band':band_id,'point':p,'pixel':image});break
            actual.sort();expected.sort()
            if len(actual)!=len(expected): fail(name,'contour-fragment-count',{'band':band_id,'actual':actual,'expected':expected})
            else:
                error=max(abs(a-b) for line,truth in zip(actual,expected) for a,b in zip(line,truth))
                maxima['contour_geometry_metres_error']=max(maxima['contour_geometry_metres_error'],error)
                if error>GEOM_TOL: fail(name,'contour-endpoints',{'band':band_id,'actual':actual,'expected':expected})
            label=arc.get('label')
            if label is None: fail(name,'contour-label',None)
            else:
                x,y=local(c,label)
                if not any(lo-GEOM_TOL<=x<=hi+GEOM_TOL and abs(y-depth)<GEOM_TOL for lo,hi,depth in expected):
                    fail(name,'label-outside-retained-fragments',{'band':band_id,'label':label})
        if row['notes'].get('expects_off_axis_only'):
            band_id=row['notes']['expects_off_axis_only']
            assert not next(b for b in out['bands'] if b['id']==band_id)['reached'] or failures
            assert len(expected_arcs.get(band_id,[]))==2, 'Oracle off-axis fixture must exercise two retained fragments'
        if row['notes'].get('expects_split'):
            assert len(expected_arcs.get(row['notes']['expects_split'],[]))==2, 'Oracle wall fixture must split'
    return {'counts':counts,'maxima':maxima,'failure_count':len(failures),
            'failure_samples':failures[:40], 'result':'PASS' if not failures else 'FAIL'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--inputs',type=Path,required=True)
    parser.add_argument('--make-inputs',action='store_true')
    parser.add_argument('--revision')
    parser.add_argument('--output',type=Path)
    parser.add_argument('--require-pass',action='store_true',help='Write diagnostics, then exit 1 if any check failed')
    args=parser.parse_args()
    if args.make_inputs:
        raw=encoded(make_inputs())
        with args.inputs.open('xb') as f:
            f.write(gzip.compress(raw,mtime=0) if args.inputs.suffix=='.gz' else raw)
        print(f'Frozen input corpus: {fingerprint(input_bytes(args.inputs))}')
        return
    assert args.output is not None and not args.output.exists()
    raw=input_bytes(args.inputs);inputs=json.loads(raw)
    snapshots=args.output.parent/(args.output.stem+'-modules')
    snapshots.mkdir()
    modules=snapshot(args.repo,snapshots,args.revision)
    harness=snapshots/'harness.mjs';harness.write_text(HARNESS)
    captured_inputs=snapshots/'inputs.json';captured_inputs.write_bytes(raw)
    execution=subprocess.run(['node',str(harness),str(captured_inputs.resolve()),str((snapshots/'src/facility-dori.mjs').resolve())],
                             capture_output=True,check=True,cwd=args.repo)
    observed=json.loads(execution.stdout)
    results_path=args.output.with_name(args.output.stem+'-observations.json')
    with results_path.open('xb') as f:f.write(execution.stdout)
    result=check(inputs,observed)
    assert input_bytes(args.inputs)==raw,'Immutable input corpus changed'
    receipt={'schema':'intelligent-dvr.independent-dori-projection-proof.v1',
             'generated_only':True,'reference':REFERENCE,
             'source_revision':args.revision or subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.repo,text=True).strip(),
             'source_mode':'git-object-snapshot' if args.revision else 'captured-working-tree-module-snapshot',
             'source_sha256':modules,'inputs_sha256':fingerprint(raw),'observations_sha256':fingerprint(execution.stdout),
             'oracle_sha256':fingerprint(Path(__file__).read_bytes()),'harness_sha256':fingerprint(HARNESS.encode()),
             'camera_cases':len(inputs['camera_cases']),**result,
             'fixture_tolerances':{'geometry_metres':GEOM_TOL,'density_px_per_metre':1e-5},
             'limits':['Generated double-precision pinhole projection, not measured optics, physical visibility, recognition quality, IEC compliance or capacity.',
                       inputs['radial_fan_policy'],
                       'Reported fixture tolerances and observed maxima are not universal numerical error bounds.',
                       'Copied module snapshots bind exactly the bytes executed; no private footage, camera, inference, network or package installation is used.']}
    with args.output.open('xb') as f:f.write(encoded(receipt))
    print(json.dumps({'result':result['result'],'failures':result['failure_count'],'cases':len(inputs['camera_cases']),
                      'inputs_sha256':receipt['inputs_sha256'],'source_sha256':modules['src/facility-dori.mjs']}))
    if args.require_pass and result['failure_count']:
        raise SystemExit(1)


if __name__=='__main__':main()
