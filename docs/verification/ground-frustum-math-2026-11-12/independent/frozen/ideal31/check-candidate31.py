#!/usr/bin/env python3
"""Strict frozen 31 ideal-case comparison. No point is filtered or rewritten.
Raw ideal boundary differences are retained, with independent diagnostic tags.
"""
import argparse,hashlib,json,math,shutil,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
P=argparse.ArgumentParser();P.add_argument('--repo',type=Path,default=Path.cwd());P.add_argument('--out',type=Path,required=True);P.add_argument('--require-pass',action='store_true');a=P.parse_args();o=a.out;o.mkdir(parents=True,exist_ok=False);snap=o/'snapshot';(snap/'src').mkdir(parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest();raw=(HERE/'inputs.json').read_bytes();expectedRaw=(HERE/'baseline-authoritative/expected.json').read_bytes();inputs=json.loads(raw);expected=json.loads(expectedRaw)
assert sha(raw)=='b90b54b25d18a14b9400445f101c755a3f2bc7b501d15489e284a54fb764bce3';assert sha(expectedRaw)==json.loads((HERE/'baseline-authoritative/receipt.json').read_text())['expectedSha256']
(o/'inputs.json').write_bytes(raw);(o/'expected.json').write_bytes(expectedRaw);sources={}
for n in ['facility.mjs','facility-stairs.mjs','facility-doorways.mjs','facility-windows.mjs','facility-zones.mjs','facility-visibility.mjs','facility-visibility-protocol.mjs','facility-polygon.mjs','facility-coverage.mjs']:
 b=(a.repo/'src'/n).read_bytes();(snap/'src'/n).write_bytes(b);sources['src/'+n]=sha(b)
for pkg in ['polyclip-ts','bignumber.js','splaytree-ts']:
 dst=snap/'node_modules'/pkg;shutil.copytree(a.repo/'node_modules'/pkg,dst)
 for p in sorted(dst.rglob('*')):
  if p.is_file():sources['node_modules/'+p.relative_to(snap/'node_modules').as_posix()]=sha(p.read_bytes())
runner=(HERE/'observe-candidate31.mjs').read_bytes();(o/'observe-candidate31.mjs').write_bytes(runner)
r=subprocess.run(['node',str(o/'observe-candidate31.mjs'),str(o/'inputs.json')],capture_output=True,text=True)
if r.returncode:raise RuntimeError(r.stderr)
actual=json.loads(r.stdout);(o/'observed.json').write_text(json.dumps(actual,sort_keys=True,separators=(',',':'))+'\n');failures=[];counts={}
def check(g,ok,**detail):
 counts[g]=counts.get(g,0)+1
 if not ok:failures.append(dict(group=g,**detail))
def area(multi):
 def ring(r):
  if not r:return 0.
  x,y=r[0];return abs(math.fsum((p[0]-x)*(q[1]-y)-(p[1]-y)*(q[0]-x) for p,q in zip(r,r[1:])))/2
 return math.fsum(ring(p[0])-math.fsum(ring(h) for h in p[1:]) for p in multi)
for test,wanted,seen in zip(inputs['cases'],expected,actual):
 id=test['id'];c=test['camera'];R=c['range'];result=seen['result'];check('case-binding',id==wanted['id']==seen['id'],id=id)
 for k in ['validated','snapshotAccepted','snapshotEstimated','snapshotPolygonsEqual']:check(k,seen[k] is True,id=id)
 check('visibility-contract',result['estimated'] and result['method']=='pinhole-ground-shadows-v1',id=id)
 observedArea=area(result['polygons']);idealArea=wanted['idealFootprintArea'];maxLost=math.pi*R*R-128*R*R*math.sin(math.pi/128)
 check('area-declared-circle-approximation',idealArea-maxLost-1e-8<=observedArea<=idealArea+1e-8,id=id,actual=observedArea,ideal=idealArea,maximumCircleAreaLoss=maxLost)
 for p,q in zip(wanted['points'],seen['points']):
  boundary=abs(abs(p['normalizedX'])-p['horizontalLimit'])<1e-12 or abs(abs(p['normalizedY'])-p['verticalLimit'])<1e-12
  circle=abs(p['range']-R)<1e-12
  for field in ['exactPoint','snapshotPoint']:check('ideal-'+field,q[field]==p['visible'],id=id,local=p['local'],actual=q[field],ideal=p['visible'],sensorBoundary=boundary,circleBoundary=circle)
 if test['localZone']:
  z=seen['metrics']['zones'][0];check('zone-coverage',z['estimated'] and abs(z['coverage']-wanted['idealZoneCoverage'])<1e-9,id=id,actual=z['coverage'],ideal=wanted['idealZoneCoverage'])
  check('route-coverage',abs(seen['metrics']['route']['coverage']-wanted['idealRouteCoverage'])<1e-9,id=id,actual=seen['metrics']['route']['coverage'],ideal=wanted['idealRouteCoverage'])
  check('rehearsal-midpoint',bool(seen['rehearsal'][1]['cameras'])==wanted['points'][0]['visible'] if id.startswith('nadir-crossing-backward-zone') else bool(seen['rehearsal'][1]['cameras'])==(wanted['idealRouteCoverage']>0),id=id,actual=seen['rehearsal'][1]['cameras'])
receipt={'schema':'dvr-pinhole-31-candidate-v1','sourceRevision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=a.repo,text=True).strip(),'sourceFiles':sources,'inputsSha256':sha(raw),'expectedSha256':sha(expectedRaw),'checkerSha256':sha(Path(__file__).read_bytes()),'runnerSha256':sha(runner),'observedSha256':sha((o/'observed.json').read_bytes()),'cases':len(actual),'checks':counts,'failures':failures,'failedAssertions':len(failures),'pass':not failures,'note':'All frozen ideal point expectations are retained without filtering. A difference tagged sensorBoundary/circleBoundary is a raw ideal boundary observation, separate from interior and stated circle-approximation contract.'}
(o/'receipt.json').write_text(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n');print(json.dumps({k:receipt[k] for k in ['cases','checks','failedAssertions','pass','failures','checkerSha256']}));raise SystemExit(1 if a.require_pass and failures else 0)
