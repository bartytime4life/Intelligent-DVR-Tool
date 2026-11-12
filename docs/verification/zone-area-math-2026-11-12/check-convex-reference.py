#!/usr/bin/env python3
"""Second mathematical reference: Fraction convex half-plane clipping and
inclusion-exclusion, distinct from the horizontal-arrangement oracle."""
import argparse
from fractions import Fraction as F
import gzip,hashlib,itertools,json
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
sub=lambda a,b:(a[0]-b[0],a[1]-b[1])
def points(raw):
    out=[(F(p[0]),F(p[1]))for p in raw]
    if out[0]==out[-1]:out.pop()
    return out
def area(poly):
    return abs(sum((cross(poly[i],poly[(i+1)%len(poly)])for i in range(len(poly))),F(0)))/2 if len(poly)>=3 else F(0)
def clip(subject,clipper):
    for i,a in enumerate(clipper):
        if not subject:break
        b=clipper[(i+1)%len(clipper)];direction=sub(b,a);out=[]
        for j,start in enumerate(subject):
            end=subject[(j+1)%len(subject)]
            left=cross(direction,sub(start,a));right=cross(direction,sub(end,a))
            if left>=0:out.append(start)
            if (left>=0)!=(right>=0):
                t=left/(left-right)
                out.append((start[0]+t*(end[0]-start[0]),start[1]+t*(end[1]-start[1])))
        subject=[]
        for p in out:
            if not subject or p!=subject[-1]:subject.append(p)
        if len(subject)>1 and subject[0]==subject[-1]:subject.pop()
    return subject
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--require-pass',action='store_true')
    parser.add_argument('--inputs',type=Path);parser.add_argument('--expected',type=Path)
    parser.add_argument('--output',type=Path,default=HERE/'convex-reference-receipt.json');args=parser.parse_args()
    input_path=args.inputs or(HERE/'inputs.json'if(HERE/'inputs.json').exists()else HERE/'inputs.json.gz')
    expected_path=args.expected or(HERE/'baseline-expected.json.gz'if(HERE/'baseline-expected.json.gz').exists()else HERE/'baseline-final-oracle/expected.json')
    read=lambda path:gzip.decompress(path.read_bytes())if path.suffix=='.gz'else path.read_bytes()
    payload=read(input_path);expected_payload=read(expected_path)
    corpus=json.loads(payload);expected=json.loads(expected_payload)
    checked=0;subsets=0;failures=[]
    for case in corpus['cases']:
        if case.get('group')!='rational-rectangles-triangles':continue
        if len({fan['id']for fan in case['fans']})!=len(case['fans']):continue
        zone=points(case['footprint']);fans=[points(fan['ring'])for fan in case['fans']]
        covered=F(0);overlap=F(0)
        for n in range(1,len(fans)+1):
            for subset in itertools.combinations(fans,n):
                body=zone
                for boundary in subset:body=clip(body,boundary)
                measure=area(body);subsets+=1
                covered+=(-1)**(n+1)*measure
                if n>=2:overlap+=(-1)**n*(n-1)*measure
        for key,value in [('area',area(zone)),('coveredArea',covered),('overlapArea',overlap),('uncoveredArea',area(zone)-covered)]:
            want=F(expected[case['id']][key]['fraction'])
            if value!=want:failures.append({'case':case['id'],'field':key,'arrangement':str(want),'convex':str(value)})
        checked+=1
    report={'status':'PASS'if not failures else'FAIL','convex_cases':checked,'exact_subset_intersections':subsets,'scalar_equalities':checked*4,'failures':failures,'input_sha256':hashlib.sha256(payload).hexdigest(),'reference_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'arrangement_expected_sha256':hashlib.sha256(expected_payload).hexdigest(),'strict_exit_enabled':args.require_pass,'proof':'For m distinct camera sets, >=1 indicator has subset coefficient(-1)^(k+1); >=2 indicator has coefficient(-1)^k*(k-1). Convex subset intersections are exact rational half-plane clips.'}
    args.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    if args.require_pass and failures:sys.exit(1)
if __name__=='__main__':main()
