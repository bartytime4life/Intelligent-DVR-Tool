#!/usr/bin/env python3
import json,hashlib,sys,math
from pathlib import Path
from fractions import Fraction as Q
import geometry_oracle as oracle
import fraction_arrangement as arrangement
if hasattr(sys,'set_int_max_str_digits'):sys.set_int_max_str_digits(0)
p=Path(__file__).resolve().parent;raw=(p/'inputs.json').read_bytes();inputs=json.loads(raw);results=[];cache={};checks=0;failures=[];excluded=0
for case in inputs['cases']:
 c=case['camera'];key=json.dumps({'camera':{k:c[k] for k in ['z','tilt','hfov','vfov','range','enabled']},'walls':case['localWalls']},sort_keys=True)
 if key not in cache:cache[key]=oracle.scalar_expectation(case)
 s=cache[key];points=[]
 for pnt in case['localPoints']:
  visible,boundary=oracle.ray_visibility(case,pnt,s['faces']);q=tuple(map(Q,pnt));points.append({'visible':visible,'boundary':boundary})
  chord=c['range']*(1-math.cos(math.pi/case['rangeSegments']));radius=math.hypot(*pnt)
  onPolygonBoundary=any(arrangement.on_boundary(ring,q) for ring in [s['subject']]+[r for _,r in s['shadows']]) if s['subject'] else False
  if boundary or onPolygonBoundary or c['range']-chord-1e-8<radius<c['range']+1e-8:excluded+=1;continue
  maskVisible=arrangement.contains(s['subject'],q) and not any(arrangement.contains(r,q) for _,r in s['shadows']) if s['subject'] else False
  checks+=1
  if maskVisible!=visible:failures.append({'id':case['id'],'point':pnt,'ray':visible,'projectedMask':maskVisible})
 results.append(dict(id=case['id'],visibleArea=float(s['area']),visibleAreaFraction=str(s['area']),slabs=s['slabs'],points=points))
 print(case['id'],float(s['area']),s['slabs'],flush=True)
encoded=(json.dumps(results,sort_keys=True,separators=(',',':'))+'\n').encode();(p/'expected.json').write_bytes(encoded)
receipt={'schema':'dvr-frustum-wall-expected-v1','inputsSha256':hashlib.sha256(raw).hexdigest(),'expectedSha256':hashlib.sha256(encoded).hexdigest(),'geometryOracleSha256':hashlib.sha256((p/'geometry_oracle.py').read_bytes()).hexdigest(),'arrangementSha256':hashlib.sha256((p/'fraction_arrangement.py').read_bytes()).hexdigest(),'cases':len(results),'queries':sum(len(r['points']) for r in results),'independentRayVsProjectedMaskChecks':checks,'excludedBoundaryOrChordBand':excluded,'failures':failures,'pass':not failures}
(p/'expected-receipt.json').write_text(json.dumps(receipt,indent=2,sort_keys=True)+'\n');print(json.dumps(receipt));raise SystemExit(1 if failures else 0)
