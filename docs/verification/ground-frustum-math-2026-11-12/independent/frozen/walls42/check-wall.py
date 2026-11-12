#!/usr/bin/env python3
"""Strict source-bound ground visibility comparison. Only writes --out.
The baseline adapter calls actual git-frozen coverageFan/seesPoint. Candidate
adapter calls groundVisibility/visibleGroundPoint without replacing its engine.
"""
import argparse,hashlib,json,math,re,shutil,subprocess,sys
from pathlib import Path
from fractions import Fraction as Q
import geometry_oracle as oracle
import fraction_arrangement as arrangement
if hasattr(sys,'set_int_max_str_digits'):sys.set_int_max_str_digits(0)
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
P=argparse.ArgumentParser();P.add_argument('--repo',type=Path,default=Path.cwd());P.add_argument('--mode',choices=['baseline','candidate'],required=True);P.add_argument('--baseline-revision',default='96b37413abcf2ebe7692f4fa6bdb6338bf2fb70a');P.add_argument('--inputs',type=Path,default=HERE/'inputs.json');P.add_argument('--out',type=Path,required=True);P.add_argument('--require-pass',action='store_true');args=P.parse_args()
out=args.out;out.mkdir(parents=True,exist_ok=False);snapshot=out/'snapshot';(snapshot/'src').mkdir(parents=True)
raw=args.inputs.read_bytes();inputs=json.loads(raw);expectedRaw=(HERE/'expected.json').read_bytes();expected=json.loads(expectedRaw);binding=json.loads((HERE/'expected-receipt.json').read_text())
assert binding['pass'] and binding['inputsSha256']==sha(raw) and binding['expectedSha256']==sha(expectedRaw)
assert binding['geometryOracleSha256']==sha((HERE/'geometry_oracle.py').read_bytes()) and binding['arrangementSha256']==sha((HERE/'fraction_arrangement.py').read_bytes())
(out/'inputs.json').write_bytes(raw);(out/'expected.json').write_bytes(expectedRaw)
sources={}
files=['facility.mjs','facility-stairs.mjs','facility-doorways.mjs','facility-windows.mjs','facility-zones.mjs']
if args.mode=='candidate':files+=['facility-visibility.mjs','facility-polygon.mjs','facility-visibility-protocol.mjs']
for name in files:
 data=subprocess.check_output(['git','show',args.baseline_revision+':src/'+name],cwd=args.repo) if args.mode=='baseline' else (args.repo/'src'/name).read_bytes()
 (snapshot/'src'/name).write_bytes(data);sources['src/'+name]=sha(data)
if args.mode=='candidate':
 for package in ['polyclip-ts','bignumber.js','splaytree-ts']:
  dst=snapshot/'node_modules'/package;shutil.copytree(args.repo/'node_modules'/package,dst)
  for p in sorted(dst.rglob('*')):
   if p.is_file():sources['node_modules/'+p.relative_to(snapshot/'node_modules').as_posix()]=sha(p.read_bytes())
runner=(HERE/'observe-wall.mjs').read_bytes();(out/'observe-wall.mjs').write_bytes(runner)
run=subprocess.run(['node',str(out/'observe-wall.mjs'),str(out/'inputs.json'),args.mode],capture_output=True,text=True)
if run.returncode:raise RuntimeError(run.stderr)
obs=json.loads(run.stdout);(out/'observed.json').write_text(json.dumps(obs,sort_keys=True,separators=(',',':'))+'\n')
checks={};failed=[];counts={'queries':0,'boundaryExcluded':0,'chordBandExcluded':0};errors={'area':0.,'xorArea':0.};cache={}
def check(group,ok,**detail):
 checks[group]=checks.get(group,0)+1
 if not ok:failed.append(dict(group=group,**detail))
def local(c,p):
 b=math.radians(c['bearing']);dx=p[0]-c['x'];dy=p[1]-c['y'];return [dx*math.cos(b)-dy*math.sin(b),dx*math.sin(b)+dy*math.cos(b)]
for case,wanted,actual in zip(inputs['cases'],expected,obs):
 id=case['id'];c=case['camera'];R=c['range'];error=R*(1-math.cos(math.pi/case['rangeSegments']));check('case-binding',id==wanted['id']==actual['id'],id=id)
 if case['validatePlan']:check('source-valid-plan',actual['planValidated'] is True,id=id,error=actual['planError'])
 result=actual['result'];check('success-contract',result.get('estimated') is True,id=id,reason=result.get('reason'))
 check('method-contract',result.get('method')=='pinhole-ground-shadows-v1',id=id,method=result.get('method'))
 if args.mode=='candidate':check('chord-contract',isinstance(result.get('rangeChordError'),(int,float)) and abs(result['rangeChordError']-error)<1e-12,id=id,actual=result.get('rangeChordError'),expected=error)
 if not result.get('estimated'):continue
 polygons=result.get('polygons');valid=arrangement.valid_multipolygon(polygons);check('multipolygon-contract',valid,id=id)
 if not valid:continue
 polys=[[[local(c,p) for p in ring] for ring in polygon] for polygon in polygons]
 area=float(oracle.multipolygon_area(polys));delta=abs(area-wanted['visibleArea']);errors['area']=max(errors['area'],delta);check('exact-area',delta<=2e-8,id=id,actual=area,expected=wanted['visibleArea'],error=delta)
 key=json.dumps({'camera':{k:c[k] for k in ['z','tilt','hfov','vfov','range','enabled']},'walls':case['localWalls']},sort_keys=True)
 if key not in cache:cache[key]=oracle.prepared(case)
 subject,fs,shadows=cache[key]
 if subject:
  _,stats=arrangement.exact_stats({'footprint':subject,'fans':[{'id':i,'ring':r} for i,r in shadows]},polys)
  xor=float(stats['xorArea']);errors['xorArea']=max(errors['xorArea'],xor);check('exact-geometry-xor',xor<=2e-8,id=id,area=xor)
 else:check('empty-geometry',not polys,id=id)
 if case['topology']:
  topology={'components':len(polys),'holes':sum(len(poly)-1 for poly in polys)};check('topology',topology==case['topology'],id=id,actual=topology,expected=case['topology'])
 qPolys=[[[tuple(map(Q,p)) for p in r] for r in poly] for poly in polys]
 for i,(point,truth,observedPoint) in enumerate(zip(case['localPoints'],wanted['points'],actual['points'])):
  counts['queries']+=1
  if truth['boundary']:counts['boundaryExcluded']+=1;continue
  check('exact-point-los',observedPoint['visible']==truth['visible'],id=id,point=point,actual=observedPoint['visible'],expected=truth['visible'])
  radius=math.hypot(*point)
  if R-error-1e-8<radius<R+1e-8:counts['chordBandExcluded']+=1;continue
  q=tuple(map(Q,point));visible=any(arrangement.contains(poly[0],q) and not any(arrangement.contains(hole,q) for hole in poly[1:]) for poly in qPolys)
  check('polygon-point-los',visible==truth['visible'],id=id,point=point,actual=visible,expected=truth['visible'])
receipt={'schema':'dvr-frustum-wall-result-v1','mode':args.mode,'sourceRevision':args.baseline_revision if args.mode=='baseline' else subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.repo,text=True).strip(),'sourceFiles':sources,'inputsSha256':sha(raw),'expectedSha256':sha(expectedRaw),'checkerSha256':sha(Path(__file__).read_bytes()),'geometryOracleSha256':binding['geometryOracleSha256'],'arrangementSha256':binding['arrangementSha256'],'runnerSha256':sha(runner),'observedSha256':sha((out/'observed.json').read_bytes()),'cases':len(obs),'checks':checks,'counts':counts,'maximumErrors':errors,'failures':failed,'failedAssertions':len(failed),'pass':not failed,'areaTolerance':2e-8,'pointBoundaryExclusion':'independent oracle marks face/height/frustum boundaries; polygons additionally exclude declared circle chord band. No candidate boundary is used to hide a mismatch.'}
(out/'receipt.json').write_text(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n');print(json.dumps({k:receipt[k] for k in ['mode','cases','checks','counts','maximumErrors','failedAssertions','pass','inputsSha256','expectedSha256','checkerSha256']}));raise SystemExit(1 if args.require_pass and failed else 0)
