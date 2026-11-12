#!/usr/bin/env python3
"""Exact independent Fraction arrangement oracle; generated polygons only.

All vertex and pairwise edge-intersection ordinates divide the plane into slabs.
Within a slab every crossing order is fixed. Each horizontal interval endpoint is
an affine function of y, so interval lengths are affine and midpoint integration
is EXACT. Fractions interpret each source IEEE-754 coordinate as an exact binary
rational. No polygon-clipping code or candidate geometry helper is imported.
"""
import argparse
from collections import Counter,defaultdict
from fractions import Fraction as F
import hashlib
import gzip
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys

HERE=Path(__file__).resolve().parent
if hasattr(sys,'set_int_max_str_digits'):sys.set_int_max_str_digits(0)
KEYS=('area','coveredArea','overlapArea','uncoveredArea','coverage','overlap')
SOURCES=('facility-coverage.mjs','facility.mjs','facility-stairs.mjs','facility-doorways.mjs','facility-windows.mjs','facility-zones.mjs')
sha=lambda data:hashlib.sha256(data).hexdigest()
encode=lambda value:(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()

def ring(raw):return [(F(p[0]),F(p[1])) for p in raw]
def edges(points):return list(zip(points,points[1:]+points[:1]))
def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def sub(a,b):return a[0]-b[0],a[1]-b[1]
def ring_area(points):
    return abs(sum((cross(a,b) for a,b in edges(points)),F(0)))/2

def union(intervals):
    result=[]
    for a,b in sorted(intervals):
        if b<=a:continue
        if result and a<=result[-1][1]:result[-1]=(result[-1][0],max(b,result[-1][1]))
        else:result.append((a,b))
    return result

def difference(left,right):
    answer=[]
    for a,b in left:
        at=a
        for c,d in right:
            if d<=at:continue
            if c>=b:break
            if c>at:answer.append((at,min(c,b)))
            at=max(at,d)
            if at>=b:break
        if at<b:answer.append((at,b))
    return answer

def intersection(left,right):
    answer=[];i=j=0
    while i<len(left) and j<len(right):
        a,b=left[i];c,d=right[j]
        if max(a,c)<min(b,d):answer.append((max(a,c),min(b,d)))
        if b<d:i+=1
        else:j+=1
    return answer

def horizontal(points,y):
    crossings=[]
    for a,b in edges(points):
        if (a[1]>y)!=(b[1]>y):crossings.append(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]))
    crossings.sort()
    if len(crossings)%2:raise ValueError('Odd crossings in oracle ring')
    return union(list(zip(crossings[::2],crossings[1::2])))

def polygon_intervals(polygons,y):
    result=[]
    for polygon in polygons:
        if not polygon:continue
        body=horizontal(polygon[0],y)
        holes=union([item for hole in polygon[1:] for item in horizontal(hole,y)])
        result.extend(difference(body,holes))
    return union(result)

def arrangement(zone,fans,extra=()):
    # Geometry comparison covers the entire returned geometry's extent as well
    # as the zone, so a misplaced output part outside the zone is also measured.
    extent=zone+[point for points in extra for point in points]
    ys={p[1] for p in extent};low,high=min(ys),max(ys)
    xmin,xmax=min(p[0] for p in extent),max(p[0] for p in extent)
    active=[]
    for points in [zone]+[points for _,points in fans]+list(extra):
        ys.update(p[1] for p in points if low<p[1]<high)
        for a,b in edges(points):
            x0,x1=sorted((a[0],b[0]));y0,y1=sorted((a[1],b[1]))
            if y0==y1 or y1<=low or y0>=high or x1<xmin or x0>xmax:continue
            active.append((a,b,x0,x1,y0,y1))
    pairs=0
    for i,(a,b,x0,x1,y0,y1) in enumerate(active):
        ab=sub(b,a)
        for c,d,u0,u1,v0,v1 in active[i+1:]:
            if x1<u0 or u1<x0 or y1<v0 or v1<y0:continue
            pairs+=1
            cd=sub(d,c);den=cross(ab,cd)
            if not den:continue
            q=sub(c,a);t=cross(q,cd)/den;s=cross(q,ab)/den
            if 0<t<1 and 0<s<1:
                y=a[1]+t*ab[1]
                if low<y<high:ys.add(y)
    return sorted(ys),len(active),pairs

def sections(zone,fans,y):
    zone_i=horizontal(zone,y)
    cameras=defaultdict(list)
    for identity,points in fans:cameras[identity].extend(horizontal(points,y))
    events=[]
    for a,b in zone_i:events.extend([(a,'__zone__',1),(b,'__zone__',-1)])
    for identity,intervals in cameras.items():
        for a,b in union(intervals):events.extend([(a,identity,1),(b,identity,-1)])
    events.sort()
    counts=Counter();at=None;covered=[];overlapped=[];uncovered=[]
    for x,identity,delta in events:
        if at is not None and x>at and counts['__zone__']:
            n=sum(value>0 for key,value in counts.items() if key!='__zone__')
            (covered if n else uncovered).append((at,x))
            if n>1:overlapped.append((at,x))
        counts[identity]+=delta;at=x
    return union(zone_i),union(covered),union(overlapped),union(uncovered)

length=lambda intervals:sum((b-a for a,b in intervals),F(0))

def exact_stats(case,returned=None):
    zone=ring(case['footprint']);fans=[(str(f['id']),ring(f['ring'])) for f in case['fans']]
    output=[[[ (F(p[0]),F(p[1])) for p in points] for points in polygon] for polygon in returned] if returned is not None else None
    critical,count,pairs=arrangement(zone,fans,[points for polygon in output for points in polygon] if output else ())
    totals=[F(0)]*4;xor_area=F(0);witnesses=0
    for bottom,top in zip(critical,critical[1:]):
        middle=(bottom+top)/2
        found=sections(zone,fans,middle)
        for i,intervals in enumerate(found):totals[i]+=length(intervals)*(top-bottom)
        if output is not None:
            actual=polygon_intervals(output,middle);wanted=found[3]
            xor_area+=(length(difference(actual,wanted))+length(difference(wanted,actual)))*(top-bottom)
            witnesses+=len(actual)+len(wanted)
    area,covered,overlap,uncovered=totals
    assert area==ring_area(zone)
    assert covered+uncovered==area and 0<=overlap<=covered<=area
    result=dict(zip(KEYS,totals+[covered/area,overlap/area]))
    return result,{'slabs':len(critical)-1,'relevant_edges':count,'edge_pair_checks':pairs,'xorArea':xor_area,'interval_witnesses':witnesses}

def valid_multipolygon(value):
    return isinstance(value,list) and all(isinstance(poly,list) and len(poly)>0 and all(isinstance(points,list) and len(points)>=4 and all(isinstance(p,list) and len(p)==2 and all(isinstance(n,(int,float)) and not isinstance(n,bool) and math.isfinite(n) for n in p) for p in points) for points in poly) for poly in value)

def contains(points,p):
    return any(a<p[0]<b for a,b in horizontal(points,p[1]))

def on_boundary(points,p):
    return any(cross(sub(p,a),sub(b,a))==0 and min(a[0],b[0])<=p[0]<=max(a[0],b[0]) and min(a[1],b[1])<=p[1]<=max(a[1],b[1]) for a,b in edges(points))

def snapshot(module,destination,repo):
    source=destination/'src';source.mkdir(parents=True,exist_ok=True)
    manifest={}
    for name in SOURCES:
        path=module if name=='facility-coverage.mjs' else module.parent/name
        data=path.read_bytes();target=source/name
        if target.exists() and target.read_bytes()!=data:raise RuntimeError('Snapshot already bound differently')
        target.write_bytes(data);manifest[name]=sha(data)
    # Copy ONLY the already-installed public clipping package and its two pinned
    # runtime dependencies, never private runtime/model directories.
    dependencies={}
    for package in ('polygon-clipping','splaytree','robust-predicates'):
        installed=repo/'node_modules'/package
        if not installed.exists():continue
        target=destination/'node_modules'/package
        shutil.copytree(installed,target,dirs_exist_ok=True)
        for path in sorted(target.rglob('*')):
            if path.is_file():dependencies[str(path.relative_to(destination))]=sha(path.read_bytes())
    return source/'facility-coverage.mjs',manifest,dependencies

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--module',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--repo',type=Path,default=Path.cwd(),help='Repository root containing the already-installed public dependencies; defaults to current directory.')
    parser.add_argument('--inputs',type=Path,help='Frozen JSON or .json.gz; defaults to adjacent inputs.json, then inputs.json.gz.')
    parser.add_argument('--require-pass',action='store_true',help='Exit 1 on ANY failed assertion; enabled for baseline before candidate execution.')
    args=parser.parse_args();destination=args.output.resolve();destination.mkdir(parents=True,exist_ok=True)
    input_path=args.inputs.resolve() if args.inputs else HERE/'inputs.json'
    if not args.inputs and not input_path.exists():input_path=HERE/'inputs.json.gz'
    stored_input=input_path.read_bytes();compressed=input_path.suffix=='.gz'
    payload=gzip.decompress(stored_input) if compressed else stored_input;corpus=json.loads(payload)
    module,sources,dependencies=snapshot(args.module.resolve(),destination,args.repo.resolve())
    (destination/'inputs.snapshot.json').write_bytes(payload)
    process=subprocess.run(['node',str(HERE/'runner.mjs'),str(module),str(destination/'inputs.snapshot.json'),str(destination/'observations.json')],capture_output=True,text=True)
    if process.returncode:raise RuntimeError(process.stderr)
    actual={row['id']:row for row in json.loads((destination/'observations.json').read_text())['observations']}
    failures=[];classes=Counter();assertions=0;expected={};geometry_cases=0;max_errors=Counter();total_slabs=0;point_checks=0
    def check(ok,case,field,want,got,category):
        nonlocal assertions
        assertions+=1
        if not ok:
            classes[category]+=1;failures.append({'case':case,'field':field,'expected':want,'actual':got,'class':category})
    for case in corpus['cases']:
        name=case['id'];target,stats=exact_stats(case);total_slabs+=stats['slabs']
        expected[name]={key:{'fraction':str(value),'float':float(value)} for key,value in target.items()}
        expected[name]['arrangement']={key:value for key,value in stats.items() if key!='xorArea'}
        if 'analytic' in case:
            for key,want in case['analytic'].items():
                assert abs(float(target[key])-want)<=max(1e-10,abs(want)*1e-11),(name,key,'analytic sanity',float(target[key]),want)
        row=actual.get(name,{})
        check('result'in row,name,'result','result object',row.get('error'),'execution')
        if 'result'not in row:continue
        result=row['result'];tolerance=max(5e-10,float(target['area'])*5e-12)
        check(row.get('inputUnchanged') is True,name,'inputUnchanged',True,row.get('inputUnchanged'),'mutation')
        check(result.get('method')=='polygon-area-v1',name,'method','polygon-area-v1',result.get('method'),'metadata')
        check(result.get('estimated') is True,name,'estimated',True,result.get('estimated'),'metadata')
        for key in KEYS:
            got=result.get(key,'<missing>');numeric=isinstance(got,(int,float)) and not isinstance(got,bool) and math.isfinite(got)
            allowed=5e-11 if key in ('coverage','overlap') else tolerance
            error=abs(F(got)-target[key]) if numeric else None
            if error is not None:max_errors[key]=max(max_errors[key],float(error))
            check(numeric and float(error)<=allowed,name,key,float(target[key]),got,'arithmetic' if numeric else 'missing-numeric')
        for variant in row.get('resolutionVariants',[]):
            for key in KEYS:
                value=variant['result'].get(key,'<missing>');base=result.get(key,'<missing>')
                check(value==base,name,'resolution-'+str(variant['maxCells'])+'-'+key,base,value,'resolution-invariance')
        raw=result.get('blindSpots');proper=valid_multipolygon(raw)
        check(proper,name,'blindSpots-contract','MultiPolygon',('null'if raw is None else 'legacy-or-invalid-shape'),'geometry-contract')
        if proper:
            output=[ [ring(points) for points in polygon] for polygon in raw]
            output_area=sum((ring_area(poly[0])-sum((ring_area(hole) for hole in poly[1:]),F(0)) for poly in output),F(0))
            error=abs(output_area-target['uncoveredArea'])
            max_errors['blindSpotsArea']=max(max_errors['blindSpotsArea'],float(error))
            check(float(error)<=tolerance,name,'blindSpots-area',float(target['uncoveredArea']),float(output_area),'geometry-area')
            # Every smaller case gets a second independent arrangement including
            # the returned edges, proving its geometric symmetric-difference
            # area rather than relying only on total area or sampled points.
            if sum(len(f['ring']) for f in case['fans'])<=2500:
                _,comparison=exact_stats(case,raw);geometry_cases+=1
                max_errors['blindSpotsXorArea']=max(max_errors['blindSpotsXorArea'],float(comparison['xorArea']))
                check(float(comparison['xorArea'])<=tolerance,name,'blindSpots-xor-area',0,float(comparison['xorArea']),'geometry-xor')
            topology=case.get('topology',{})
            holes=sum(len(poly)-1 for poly in raw)
            if 'minimumHoles'in topology:check(holes>=topology['minimumHoles'],name,'holes',topology['minimumHoles'],holes,'geometry-topology')
            if 'minimumParts'in topology:check(len(raw)>=topology['minimumParts'],name,'parts',topology['minimumParts'],len(raw),'geometry-topology')
            zone=ring(case['footprint']);source_fans=[ring(f['ring']) for f in case['fans']]
            output_rings=[points for polygon in output for points in polygon]
            xmin,xmax=min(p[0]for p in zone),max(p[0]for p in zone)
            ymin,ymax=min(p[1]for p in zone),max(p[1]for p in zone)
            for i in range(7):
                for j in range(7):
                    p=(xmin+(xmax-xmin)*F(100*i+37,700),ymin+(ymax-ymin)*F(100*j+37,700))
                    if any(on_boundary(points,p)for points in [zone]+source_fans+output_rings):continue
                    wanted=contains(zone,p)and not any(contains(points,p)for points in source_fans)
                    observed=any(contains(polygon[0],p)and not any(contains(hole,p)for hole in polygon[1:])for polygon in output)
                    point_checks+=1
                    check(wanted==observed,name,'blindSpots-point-'+str(i)+'-'+str(j),wanted,observed,'geometry-membership')
    (destination/'expected.json').write_bytes(encode(expected))
    receipt={'status':'PASS'if not failures else'FAIL','cases':len(corpus['cases']),'assertions':assertions,'failure_count':len(failures),'failure_classes':dict(classes),'failures':failures,'input_sha256':sha(payload),'input_storage_sha256':sha(stored_input),'input_encoding':'gzip'if compressed else'json','oracle_sha256':sha(Path(__file__).read_bytes()),'runner_sha256':sha((HERE/'runner.mjs').read_bytes()),'source_hashes':sources,'dependency_hashes':dependencies,'observations_sha256':sha((destination/'observations.json').read_bytes()),'expected_sha256':sha((destination/'expected.json').read_bytes()),'strict_exit_enabled':args.require_pass,'exact_arrangement_slabs':total_slabs,'exact_geometry_xor_cases':geometry_cases,'independent_point_checks':point_checks,'max_absolute_errors':dict(max_errors),'proof':'Complete vertex/edge-intersection y arrangement; within each open slab endpoint order is fixed and interval lengths are affine, so rational midpoint integration is exact. Camera IDs are unioned before multiplicity is counted.','limitations':['Exact rational interpretation of represented source vertices; production clipping uses floating arithmetic and near-coordinate snapping.','Topology XOR is checked on every case with at most2500inputfanvertices; the500-camera case instead gets exact scalar area plus complete returned-polygon area and independent point membership.','Finite generated corpus establishes planning-geometry software behavior, not calibrated camera visibility or field accuracy.']}
    (destination/'receipt.json').write_bytes(encode(receipt))
    print(json.dumps({key:receipt[key]for key in ['status','cases','assertions','failure_count','failure_classes','input_sha256','oracle_sha256','exact_arrangement_slabs','exact_geometry_xor_cases','max_absolute_errors']},indent=2))
    if args.require_pass and failures:sys.exit(1)

if __name__=='__main__':main()
