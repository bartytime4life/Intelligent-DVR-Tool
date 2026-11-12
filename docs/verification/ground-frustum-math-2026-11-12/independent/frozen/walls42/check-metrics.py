#!/usr/bin/env python3
"""Source-bound consumer checks over the unchanged 42 wall fixtures."""
import argparse,hashlib,json,math,shutil,subprocess
from pathlib import Path
from fractions import Fraction as Q
import geometry_oracle as oracle
import fraction_arrangement as arrangement
HERE=Path(__file__).resolve().parent;sha=lambda b:hashlib.sha256(b).hexdigest()
P=argparse.ArgumentParser();P.add_argument('--repo',type=Path,default=Path.cwd());P.add_argument('--source-snapshot',type=Path,required=True);P.add_argument('--out',type=Path,required=True);P.add_argument('--require-pass',action='store_true');a=P.parse_args();o=a.out;o.mkdir(parents=True,exist_ok=False)
raw=(HERE/'inputs.json').read_bytes();inputs=json.loads(raw);frozenRaw=(HERE/'expected.json').read_bytes();frozen=json.loads(frozenRaw);expected=[]
for t,r in zip(inputs['cases'],frozen):
 subject,_,shadows=oracle.prepared(t);low,high=(-1.2,1.2) if t['camera']['range']==1 else (-3,10);lo,hi=Q(low),Q(high)
 vertical=lambda ring:arrangement.horizontal([(y,x) for x,y in ring],Q(0))
 visible=arrangement.intersection(arrangement.difference(vertical(subject),arrangement.union([i for _,ring in shadows for i in vertical(ring)])),[(lo,hi)])
 blind=arrangement.difference([(lo,hi)],visible);covered=sum((b-a for a,b in visible),Q(0));longest=max((b-a for a,b in blind),default=Q(0));zonearea=5.76 if t['camera']['range']==1 else 312
 expected.append(dict(id=t['id'],area=r['visibleArea'],zoneArea=zonearea,coveredLength=float(covered),routeLength=float(hi-lo),longestBlindStretch=float(longest)))
encoded=(json.dumps(expected,sort_keys=True,separators=(',',':'))+'\n').encode();(o/'expected-metrics.json').write_bytes(encoded)
# Expectations are written BEFORE executing any application consumer.
shutil.copytree(a.source_snapshot,o/'snapshot');module='facility-coverage.mjs';(o/'snapshot/src'/module).write_bytes((a.repo/'src'/module).read_bytes())
sources={p.relative_to(o/'snapshot').as_posix():sha(p.read_bytes()) for p in sorted((o/'snapshot').rglob('*')) if p.is_file()}
runner=(HERE/'observe-metrics.mjs').read_bytes();(o/'observe-metrics.mjs').write_bytes(runner);(o/'inputs.json').write_bytes(raw)
r=subprocess.run(['node',str(o/'observe-metrics.mjs'),str(o/'inputs.json')],capture_output=True,text=True)
if r.returncode:raise RuntimeError(r.stderr)
actual=json.loads(r.stdout);(o/'observed.json').write_text(json.dumps(actual,sort_keys=True,separators=(',',':'))+'\n');checks={};fails=[];points=0

def check(group,condition,**detail):
 checks[group]=checks.get(group,0)+1
 if not condition:fails.append(dict(group=group,**detail))
for t,e,f,obs in zip(inputs['cases'],expected,frozen,actual):
 id=t['id'];check('case-binding',id==e['id']==f['id']==obs['id'],id=id)
 for key in ['snapshotBound','otherPlanUnbound','cloneInitiallyUnbound','cloneAccepted','cloneBound']:check('snapshot-binding',obs[key] is True,id=id,field=key)
 check('cache-identical-pose',obs['cacheHits']==1,id=id,actual=obs['cacheHits']);m=obs['metrics'];z=m['zones'][0];route=m['route']
 check('zone-success',z['estimated'] is True,id=id)
 for key,value in [('coveredArea',e['area']),('overlapArea',e['area']),('coverage',e['area']/e['zoneArea']),('overlap',e['area']/e['zoneArea'])]:check('zone-distinct-camera-scalar',abs(z[key]-value)<2e-8,id=id,field=key,actual=z[key],expected=value)
 for key,value in [('coveredLength',e['coveredLength']),('overlapLength',e['coveredLength']),('length',e['routeLength']),('longestBlindStretch',e['longestBlindStretch']),('coverage',e['coveredLength']/e['routeLength']),('overlap',e['coveredLength']/e['routeLength'])]:check('route-hole-component-scalar',abs(route[key]-value)<2e-8,id=id,field=key,actual=route[key],expected=value)
 for p,q in zip(obs['points'],f['points']):
  if q['boundary']:continue
  points+=1;check('snapshot-point-los',p==(['A','B'] if q['visible'] else []),id=id,actual=p,expected=q['visible'])
 unknown=obs['unknown'];check('unavailable-snapshot',unknown['estimated'] is False and unknown['point'] is None and unknown['rehearsal'] is None,id=id)
 uz=unknown['metrics']['zones'][0];ur=unknown['metrics']['route'];check('unavailable-zone',uz['estimated'] is False and all(uz[k] is None for k in ['area','coveredArea','overlapArea','uncoveredArea','coverage','overlap','blindSpots']),id=id)
 check('unavailable-route',ur['estimated'] is False and all(ur[k] is None for k in ['coveredLength','overlapLength','uncoveredLength','longestBlindStretch','coverage','overlap']),id=id)
receipt={'schema':'dvr-frustum-consumer-result-v1','inputsSha256':sha(raw),'frozenExpectedSha256':sha(frozenRaw),'metricsExpectedSha256':sha(encoded),'checkerSha256':sha(Path(__file__).read_bytes()),'runnerSha256':sha(runner),'sourceFiles':sources,'cases':len(actual),'checks':checks,'pointChecks':points,'failures':fails,'failedAssertions':len(fails),'pass':not fails}
(o/'receipt.json').write_text(json.dumps(receipt,sort_keys=True,separators=(',',':'))+'\n');print(json.dumps({k:receipt[k] for k in ['cases','checks','pointChecks','failedAssertions','pass','failures','metricsExpectedSha256','checkerSha256']}));raise SystemExit(1 if a.require_pass and fails else 0)
