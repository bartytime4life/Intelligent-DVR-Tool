"""Independent generated planar-map checks; Python stdlib and Node only.

Expected points use Fraction arithmetic on known H matrices. Expected distances
use 80-digit Decimal square roots. The candidate is called only for observations;
no solver, normalization, projector or fitting code is copied into the oracle.
"""
import argparse
from decimal import Decimal, localcontext
from fractions import Fraction as F
import hashlib
import itertools
import json
from pathlib import Path
import platform
import random
import subprocess


def determinant(h):
    a,b,c,d,e,f,g,j,k = h
    return a*(e*k-f*j)-b*(d*k-f*g)+c*(d*j-e*g)


def project(h, point):
    u,v = point
    w = h[6]*u+h[7]*v+h[8]
    if not w:
        return None
    return ((h[0]*u+h[1]*v+h[2])/w, (h[3]*u+h[4]*v+h[5])/w)


def decimal_distance(a, b):
    with localcontext() as ctx:
        ctx.prec = 80
        value = sum((x-y)**2 for x,y in zip(a,b))
        return float((Decimal(value.numerator)/Decimal(value.denominator)).sqrt())


def shift(h, east, north):
    return [h[i]+east*h[6+i] for i in range(3)] + [h[3+i]+north*h[6+i] for i in range(3)] + h[6:]


def ref(h, point, role):
    ground = project(h, point)
    assert ground and max(map(abs, ground)) <= 2000
    return {'role':role, 'image':dict(zip(('x','y'),map(float,point))),
            'ground':dict(zip(('x','y'),map(float,ground)))}


def build_cases():
    maps = {
        'affine': [40,3,2,-4,28,-7,0,0,1],
        'perspective': [10,2,3,-3,8,7,F(1,5),-F(1,10),1],
        'zero_h33_reciprocal': [0,0,1,0,1,0,1,0,0],
        'zero_h33_sum_denominator': [1,2,1,2,-1,3,1,1,0],
        'positive_near_zero_h33': [0,0,1,0,1,0,1,0,F(1,10**14)],
        'negative_near_zero_h33': [0,0,1,0,1,0,1,0,-F(1,10**14)],
        'small_nonzero_h33': [0,0,1,0,1,0,1,0,F(1,10**7)],
    }
    square = [(F(1,5),F(1,5)),(F(4,5),F(1,5)),(F(4,5),F(4,5)),(F(1,5),F(4,5))]
    irregular = [(F(1,10),F(3,20)),(F(17,20),F(1,10)),(F(9,10),F(4,5)),
                 (F(3,20),F(9,10)),(F(9,20),F(3,10)),(F(7,10),F(3,5))]
    queries = [(F(3,10),F(3,10)),(F(7,10),F(7,10)),(F(7,20),F(3,5)),
               (F(3,5),F(7,20)),(F(1,2),F(1,2))]
    translations = [(0,0),(1800,-1750),(-1800,1700),(1950,1900),(-1950,-1900)]
    scales = [F(1), F(10**200), F(-10**200), F(1,10**200), -F(1,10**200)]
    fits, direct, unsafe = [], [], []
    rng = random.Random(90271)
    for family, values in maps.items():
        base = list(map(F,values))
        assert determinant(base)
        for tx,ty in translations:
            h = shift(base,F(tx),F(ty))
            expected = [project(h,q) for q in queries]
            denominators = [h[6]*u+h[7]*v+h[8] for u,v in irregular+square]
            assert min(denominators)>0 or max(denominators)<0
            for li,layout in enumerate((square,irregular)):
                if li == 0:
                    permutations = list(itertools.permutations(range(4)))
                else:
                    permutations = []
                    while len(permutations)<8:
                        order = list(range(6)); rng.shuffle(order)
                        if tuple(order) not in permutations: permutations.append(tuple(order))
                for order in permutations:
                    fits.append({'name':f'{family}:offset={tx},{ty}:layout={li}:order={order}',
                        'references':[ref(h,layout[i],'fit') for i in order]+[ref(h,queries[-1],'check')],
                        'queries':[[float(x),float(y)] for x,y in queries],
                        'expected':[[float(x),float(y)] for x,y in expected],
                        'distances':[decimal_distance(expected[0],expected[1]),
                                     decimal_distance(expected[2],expected[3])],
                        'outside':[.01,.5]})
            for si,scale in enumerate(scales):
                for qi,q in enumerate(queries):
                    direct.append({'name':f'{family}:offset={tx},{ty}:scale={si}:query={qi}',
                        'matrix':[float(v*scale) for v in h], 'point':list(map(float,q)),
                        'expected':list(map(float,expected[qi]))})
    crossing = list(map(F,[0,0,1,0,1,0,1,0,-F(1,2)]))
    for order in itertools.permutations(range(4)):
        unsafe.append({'name':f'horizon_crosses_hull:{order}',
            'references':[ref(crossing,square[i],'fit') for i in order]})
    delta = F(1,10**8)
    approaching = [delta*1000,0,0,0,delta*1000,0,1,0,-F(1,5)+delta]
    assert determinant(approaching)
    unsafe.append({'name':'horizon_approaches_hull',
        'references':[ref(approaching,p,'fit') for p in square]})
    points = [(F(1,10),F(1,10)),(F(9,10),F(3,20)),(F(4,5),F(9,10)),
              (F(1,5),F(4,5)),(F(2,5),F(3,10))]
    for offset in (0,1700,-1700):
        singular = list(map(F,[1,0,offset,2,0,offset,0,0,1]))
        assert determinant(singular)==0
        for _ in range(8):
            ordered=points[:];rng.shuffle(ordered)
            unsafe.append({'name':f'collinear_destination:offset={offset}:order={ordered}',
                'references':[ref(singular,p,'fit') for p in ordered]+[ref(singular,(F(1,2),F(1,2)),'check')]})
    for scale in scales:
        direct.append({'name':f'exact_horizon:scale={scale}', 'matrix':[float(v*scale) for v in crossing],
                       'point':[.5,.5], 'expected':None})
    return {'fits':fits,'direct':direct,'unsafe':unsafe}


PROGRAM = r'''import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const m=await import(pathToFileURL(process.argv[1]).href);
const c=JSON.parse(fs.readFileSync(0,'utf8'));
const fits=c.fits.map(x=>{try{const z=m.fitPlanarCalibration(x.references);return {
 accepted:true,points:x.queries.map(p=>m.projectGround(z.matrix,p)),
 distances:[m.calibratedGroundDistance(z,x.queries[0],x.queries[1]),m.calibratedGroundDistance(z,x.queries[2],x.queries[3])],
 outside:m.calibratedGroundDistance(z,x.outside,x.queries[1]),verified:z.verified,
 fit:z.fit,holdout:z.holdout,checkInsideHull:z.checkInsideHull};
}catch(e){return {accepted:false,error:String(e.message)}}});
const direct=c.direct.map(x=>m.projectGround(x.matrix,x.point));
const unsafe=c.unsafe.map(x=>{try{const z=m.fitPlanarCalibration(x.references);return {accepted:true,fit:z.fit,holdout:z.holdout};}
 catch(e){return {accepted:false,error:String(e.message)}}});
console.log(JSON.stringify({fits,direct,unsafe}));'''


def run(module):
    cases=build_cases()
    encoded=json.dumps(cases,separators=(',',':')).encode()
    before=module.read_bytes()
    actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',PROGRAM,str(module)],input=encoded))
    assert module.read_bytes()==before, 'Candidate changed during oracle execution; rerun after freeze.'
    failures=[]
    max_point=max_distance=max_direct=0.
    for case,observed in zip(cases['fits'],actual['fits']):
        errors=[]
        if not observed['accepted']: errors.append(observed['error'])
        else:
            if observed['verified'] is not False or observed['checkInsideHull'] is not True: errors.append('incorrect validation/hull flag')
            if observed['outside'] is not None: errors.append('outside-hull ruler accepted')
            if observed['fit']['max']>1e-7 or observed['holdout']['max']>1e-7: errors.append('residual exceeds fixture tolerance')
            for expected,p in zip(case['expected'],observed['points']):
                if p is None: errors.append('safe query projected to null');continue
                error=max(abs(x-y) for x,y in zip(expected,p));max_point=max(max_point,error)
                if error>1e-7:errors.append(f'point error {error}')
            for expected,d in zip(case['distances'],observed['distances']):
                if d is None:errors.append('safe ruler query refused');continue
                error=abs(expected-d['metres']);max_distance=max(max_distance,error)
                if error>1e-7:errors.append(f'distance error {error}')
        if errors:failures.append({'kind':'safe_fit','name':case['name'],'errors':errors})
    for case,p in zip(cases['direct'],actual['direct']):
        if case['expected'] is None:
            if p is not None:failures.append({'kind':'unsafe_projection','name':case['name'],'actual':p})
        elif p is None:failures.append({'kind':'safe_projection','name':case['name'],'actual':None})
        else:
            error=max(abs(x-y) for x,y in zip(case['expected'],p));max_direct=max(max_direct,error)
            if error>2e-9:failures.append({'kind':'safe_projection','name':case['name'],'error':error})
    for case,result in zip(cases['unsafe'],actual['unsafe']):
        if result['accepted']:failures.append({'kind':'unsafe_fit','name':case['name'],'actual':result})
    return {'schema':'dvr.independent-calibration-oracle.v1','generated_only':True,
        'source_sha256':hashlib.sha256(before).hexdigest(),'input_sha256':hashlib.sha256(encoded).hexdigest(),
        'oracle_script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'runtime':{'python':platform.python_version(),'node':subprocess.check_output(['node','--version'],text=True).strip()},
        'oracle':'Known nonsingular Fraction homographies; 80-digit Decimal Euclidean query distances. No fitted candidate transform supplies expected truth.',
        'fixture_contract':{'seed':90271,'ground_absolute_bound_m':2000,
            'world_offsets_m':[[0,0],[1800,-1750],[-1800,1700],[1950,1900],[-1950,-1900]],
            'fitting_reference_counts':[4,6],'projection_global_scales':['1','1e200','-1e200','1e-200','-1e-200'],
            'fitted_error_tolerance_m':1e-7,'direct_projection_error_tolerance_m':2e-9},
        'cases':{name:len(items) for name,items in cases.items()},
        'failed_cases':len(failures),'failures_by_kind':{k:sum(f['kind']==k for f in failures) for k in sorted({f['kind'] for f in failures})},
        'first_failures':failures[:32],
        'max_absolute_errors_m':{'fitted_point':max_point,'fitted_distance':max_distance,'direct_projection':max_direct},
        'limits':['Exact generated references, not noisy physical calibration or lens/3D geometry.',
                  'Absolute fixture tolerances are comparison criteria, not universal error bounds.',
                  'Positive/negative scales span1e-200..1e200; this does not prove arbitrary underflow/overflow robustness.',
                  'No camera, model, private image, deployment or field accuracy evidence.']}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True,help='New generated JSON result path')
    parser.add_argument('--require-pass',action='store_true',help='Exit nonzero if any generated case fails')
    args=parser.parse_args()
    result=run(args.module.resolve())
    with args.output.open('x',encoding='utf-8') as stream:stream.write(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('first_failures','limits')},indent=2))
    if args.require_pass and result['failed_cases']:
        raise SystemExit(1)
