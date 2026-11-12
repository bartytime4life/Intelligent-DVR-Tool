#!/usr/bin/env python3
"""Independent ideal-camera footprint study; writes only the selected output directory.

Actual baseline is executed from immutable public source snapshots. The oracle
uses 3-D basis dot products for points and planar half-plane/circle integration
for area, rather than copying the application's radial fan or ray loops.
--require-pass is strict: any retained source/oracle mismatch exits 1.
"""
import argparse, hashlib, json, math, re, shutil, subprocess
from pathlib import Path
P=argparse.ArgumentParser();P.add_argument('--repo',type=Path,default=Path.cwd());P.add_argument('--inputs',type=Path,default=Path(__file__).with_name('inputs.json'));P.add_argument('--out',type=Path,required=True);P.add_argument('--require-pass',action='store_true');args=P.parse_args()
out=args.out;out.mkdir(parents=True,exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
inputs_bytes=args.inputs.read_bytes();inputs=json.loads(inputs_bytes);(out/'inputs.json').write_bytes(inputs_bytes)
source={};snap=out/'snapshot';(snap/'src').mkdir(parents=True)
for name in ['facility.mjs','facility-stairs.mjs','facility-doorways.mjs','facility-windows.mjs','facility-zones.mjs','facility-coverage.mjs']:
 data=(args.repo/'src'/name).read_bytes();(snap/'src'/name).write_bytes(data);source['src/'+name]=sha(data)
for package in ['polygon-clipping','splaytree','robust-predicates']:
 origin=args.repo/'node_modules'/package;destination=snap/'node_modules'/package
 shutil.copytree(origin,destination)
 for path in sorted(destination.rglob('*')):
  if path.is_file():source['node_modules/'+path.relative_to(snap/'node_modules').as_posix()]=sha(path.read_bytes())
runner=Path(__file__).with_name('observe.mjs').read_bytes();(out/'observe.mjs').write_bytes(runner)
completed=subprocess.run(['node',str(out/'observe.mjs'),str(out/'inputs.json')],capture_output=True,text=True)
if completed.returncode:raise RuntimeError(completed.stderr)
observed=json.loads(completed.stdout);(out/'observed.json').write_text(json.dumps(observed,indent=2,sort_keys=True)+'\n')
counts={};failures=[];assertions=0

def check(group,condition,detail):
 global assertions
 assertions+=1;counts[group]=counts.get(group,0)+1
 if not condition:failures.append({'group':group,**detail})

def dot(a,b):return math.fsum(x*y for x,y in zip(a,b))
def basis(c):
 b,t=map(math.radians,[c['bearing'],c['tilt']]);sb,cb,st,ct=math.sin(b),math.cos(b),math.sin(t),math.cos(t)
 return (cb,-sb,0),(-st*sb,-st*cb,-ct),(ct*sb,ct*cb,-st)
def project(c,world):
 right,down,axis=basis(c);q=(world[0]-c['x'],world[1]-c['y'],-c['z']);X,V,D=[dot(q,k) for k in [right,down,axis]]
 a,v=map(lambda d:math.tan(math.radians(d/2)),[c['hfov'],c['vfov']]);radius=math.hypot(q[0],q[1]);visible=c['enabled'] and D>0 and abs(X)<=a*D+1e-12 and abs(V)<=v*D+1e-12 and radius<=c['range']+1e-12
 return dict(X=X,V=V,depth=D,normalizedX=X/D if D else None,normalizedY=V/D if D else None,horizontalLimit=a,verticalLimit=v,range=radius,visible=visible)
def constraints(c):
 t=math.radians(c['tilt']);s,k=math.sin(t),math.cos(t);a=math.tan(math.radians(c['hfov']/2));v=math.tan(math.radians(c['vfov']/2));z=c['z']
 # >=0 halfplanes: optical depth, left, right, top and bottom sensor edges.
 return [(0,k,z*s),(1,a*k,a*z*s),(-1,a*k,a*z*s),(0,v*k-s,z*(v*s+k)),(0,v*k+s,z*(v*s-k))]
def clip(poly,plane):
 if not poly:return []
 A,B,C=plane;f=lambda p:A*p[0]+B*p[1]+C;result=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  fa,fb=f(a),f(b);insideA,insideB=fa>=0,fb>=0
  if insideA:result.append(a)
  if insideA!=insideB:
   t=fa/(fa-fb);result.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
 return result

def disk_polygon_area(poly,R):
 # Green's theorem. An inside subedge contributes its triangle, an outside
 # subedge contributes a signed circular sector. Split only at exact quadratic
 # circle crossings; there is no spatial sampling and no polygonized disk.
 total=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  d=(b[0]-a[0],b[1]-a[1]);A=dot(d,d);B=2*dot(a,d);C=dot(a,a)-R*R;cuts=[0.,1.];disc=B*B-4*A*C
  if A and disc>=0:
   root=math.sqrt(disc)
   cuts+= [r for r in [(-B-root)/(2*A),(-B+root)/(2*A)] if 0<r<1]
  cuts=sorted(set(cuts))
  for l,r in zip(cuts,cuts[1:]):
   p=(a[0]+l*d[0],a[1]+l*d[1]);q=(a[0]+r*d[0],a[1]+r*d[1]);m=(a[0]+(l+r)/2*d[0],a[1]+(l+r)/2*d[1]);cross=p[0]*q[1]-p[1]*q[0]
   total.append(cross/2 if dot(m,m)<R*R else R*R*math.atan2(cross,dot(p,q))/2)
 return abs(math.fsum(total))
def footprint_area(c,zone=None):
 R=c['range'];poly=[(-R,-R),(R,-R),(R,R),(-R,R)] if zone is None else list(map(tuple,zone[:-1]))
 for plane in constraints(c):poly=clip(poly,plane)
 return disk_polygon_area(poly,R) if poly else 0.
def strip_integral_area(c):
 # Independent second analytic algorithm: integrate horizontal cross-sections
 # min(linear sensor halfwidth, disk halfwidth), split at their quadratic roots.
 t=math.radians(c['tilt']);s,k=math.sin(t),math.cos(t);z,R=c['z'],c['range'];a=math.tan(math.radians(c['hfov']/2));v=math.tan(math.radians(c['vfov']/2))
 lo=max(-R,z*(k-v*s)/(s+v*k));den=s-v*k;hi=min(R,z*(k+v*s)/den) if den>0 else R
 if lo>=hi:return 0.
 A=1+(a*k)**2;B=2*a*a*k*z*s;C=(a*z*s)**2-R*R;disc=B*B-4*A*C;cuts=[lo,hi]
 if disc>=0:
  root=math.sqrt(disc);cuts.extend(r for r in [(-B-root)/(2*A),(-B+root)/(2*A)] if lo<r<hi)
 cuts=sorted(set(cuts));result=[]
 def circular(Y):return .5*(Y*math.sqrt(max(0,R*R-Y*Y))+R*R*math.asin(max(-1,min(1,Y/R))))
 for l,h in zip(cuts,cuts[1:]):
  y=(l+h)/2;w=a*(k*y+z*s)
  result.append(a*k*(h*h-l*l)+2*a*z*s*(h-l) if w<=math.sqrt(max(0,R*R-y*y)) else 2*(circular(h)-circular(l)))
 return math.fsum(result)
def route_fraction(c,route):
 a,b=route;dx,dy=b[0]-a[0],b[1]-a[1];lo,hi=0.,1.
 for A,B,C in constraints(c):
  f=A*a[0]+B*a[1]+C;d=A*dx+B*dy
  if d>0:lo=max(lo,-f/d)
  elif d<0:hi=min(hi,-f/d)
  elif f<0:return 0.
 A=dx*dx+dy*dy;B=2*(a[0]*dx+a[1]*dy);C=a[0]*a[0]+a[1]*a[1]-c['range']**2
 disc=B*B-4*A*C
 if disc<0:return 0.
 if A:
  root=math.sqrt(disc);lo=max(lo,(-B-root)/(2*A));hi=min(hi,(-B+root)/(2*A))
 return max(0.,hi-lo)
def polygon_area(poly):return abs(math.fsum(p[0]*q[1]-p[1]*q[0] for p,q in zip(poly,poly[1:]+poly[:1])))/2
# Closed-form disk/tangent checks prevent treating a single tangent midpoint as
# a whole inside chord. Kept independently of every application observation.
check('analytic-disk-consistency',abs(disk_polygon_area([(-1,-1),(1,-1),(1,1),(-1,1)],1)-math.pi)<1e-13,{'fixture':'unit disk in tangent square'})
check('analytic-disk-consistency',abs(disk_polygon_area([(0,0),(1,0),(1,1),(0,1)],1)-math.pi/4)<1e-13,{'fixture':'quarter disk'})
check('analytic-disk-consistency',abs(disk_polygon_area([(-50,50),(0,0),(50,50)],50)-math.pi*2500/4)<1e-9,{'fixture':'90 degree disk sector with tangent closing edge'})
expected=[]
for test,obs in zip(inputs['cases'],observed):
 c=test['camera'];id=test['id'];item={'id':id,'points':[],'idealFootprintArea':footprint_area(c)}
 check('validated-plan',obs['validated'],{'id':id})
 item['independentStripIntegralArea']=strip_integral_area(c)
 check('strip-area-consistency',abs(item['independentStripIntegralArea']-item['idealFootprintArea'])<1e-8,{'id':id,'edgeIntegral':item['idealFootprintArea'],'stripIntegral':item['independentStripIntegralArea']})
 for point in obs['points']:
  p=project(c,point['world']);item['points'].append({'local':point['local'],**p})
  for field in ['seesPoint','inDrawnFan']:check('point-'+field,point[field]==p['visible'],{'id':id,'local':point['local'],'actual':point[field],'ideal':p['visible'],'projection':p})
 if test['localZone']:
  area=polygon_area(test['localZone'][:-1]);covered=footprint_area(c,test['localZone']);fraction=covered/area
  item.update(zoneArea=area,idealCoveredArea=covered,idealZoneCoverage=fraction,idealRouteCoverage=route_fraction(c,test['localRoute']))
  actual=obs['metrics']['zones'][0]
  check('zone-coverage',actual['estimated'] and abs(actual['coverage']-fraction)<1e-9,{'id':id,'actual':actual.get('coverage'),'ideal':fraction,'area':area})
  check('route-coverage',abs(obs['metrics']['route']['coverage']-item['idealRouteCoverage'])<1e-9,{'id':id,'actual':obs['metrics']['route']['coverage'],'ideal':item['idealRouteCoverage']})
  localMid=[(test['localRoute'][0][k]+test['localRoute'][1][k])/2 for k in range(2)]
  b=math.radians(c['bearing']);world=[c['x']+localMid[0]*math.cos(b)+localMid[1]*math.sin(b),c['y']-localMid[0]*math.sin(b)+localMid[1]*math.cos(b)]
  check('rehearsal-midpoint',bool(obs['rehearsal'][1]['cameras'])==project(c,world)['visible'],{'id':id,'actual':obs['rehearsal'][1]['cameras'],'ideal':project(c,world)['visible']})
 # Independent inverse-projection crosscheck over sensor coordinates, including
 # upward/horizon rays and rays landing behind the mount's horizontal heading.
 right,down,axis=basis(c);a=math.tan(math.radians(c['hfov']/2));v=math.tan(math.radians(c['vfov']/2))
 for u0 in [-.9,-.5,0,.5,.9]:
  for v0 in [-.9,-.5,0,.5,.9]:
   u,w=u0*a,v0*v;ray=tuple(axis[k]+u*right[k]+w*down[k] for k in range(3))
   if ray[2]>=-1e-14:continue
   t=-c['z']/ray[2];world=[c['x']+t*ray[0],c['y']+t*ray[1]];p=project(c,world)
   check('inverse-projection-consistency',p['depth']>0 and abs(p['normalizedX']-u)<1e-10 and abs(p['normalizedY']-w)<1e-10,{'id':id,'u':u,'v':w,'projection':p})
 # A finite vertical strip not clipped by range admits a separately integrated
 # trapezoid closed form; use it as a second area calculation when applicable.
 theta,beta=map(math.radians,[c['tilt'],c['vfov']/2]);s,k=math.sin(theta),math.cos(theta)
 if theta>beta:
  near=c['z']/math.tan(theta+beta);far=c['z']/math.tan(theta-beta)
  corners=[(a*(Y*k+c['z']*s)*sgn,Y) for Y in [near,far] for sgn in [-1,1]]
  if max(math.hypot(*p) for p in corners)<c['range']:
   closed=a*k*(far*far-near*near)+2*a*c['z']*s*(far-near)
   item.update(idealForwardBounds=[near,far],idealUnrangedCorners=corners,trapezoidClosedFormArea=closed)
   check('analytic-area-consistency',abs(closed-item['idealFootprintArea'])<1e-8,{'id':id,'integral':item['idealFootprintArea'],'closedForm':closed})
 expected.append(item)
(out/'expected.json').write_text(json.dumps(expected,indent=2,sort_keys=True)+'\n')
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.repo,text=True).strip()
receipt={'schema':'dvr-frustum-study-receipt-v1','sourceRevision':head,'sourceFiles':source,'inputsSha256':sha(inputs_bytes),'checkerSha256':sha(Path(__file__).read_bytes()),'runnerSha256':sha(runner),'observedSha256':sha((out/'observed.json').read_bytes()),'expectedSha256':sha((out/'expected.json').read_bytes()),'cases':len(expected),'assertions':assertions,'counts':counts,'failures':failures,'failedAssertions':len(failures),'pass':not failures,'arithmetic':'Python binary64 trig and analytic half-plane/circle integration; point oracle independently uses orthonormal 3-D basis dot products. No sampling and no external geometry libraries in oracle.','limitations':['Ideal centred rectilinear pinhole, flat ground z=0, no distortion or optical/field qualification.','No wall fixtures in this study; existing approximate opaque-wall behavior remains separate.','Area is analytic in the binary64 trigonometric coefficients, not an exact real-number proof.','Current fan uses polygonized circular boundaries; strict source comparison retains that difference instead of hiding it.']}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2,sort_keys=True)+'\n')
print(json.dumps({k:receipt[k] for k in ['cases','assertions','counts','failedAssertions','pass','inputsSha256','checkerSha256']}))
raise SystemExit(1 if args.require_pass and failures else 0)
