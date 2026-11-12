"""Independent rational 3-D face LOS and projected-boundary area oracle.
No application or third-party geometry code is imported.
"""
from fractions import Fraction as Q
import math
import fraction_arrangement as arrangement

def dot(a,b):return sum((x*y for x,y in zip(a,b)),Q(0))
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def cross3(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def plane_coefficients(camera):
 theta=math.radians(camera['tilt']);s,k=map(Q,[math.sin(theta),math.cos(theta)]);a=Q(math.tan(math.radians(camera['hfov']/2)));v=Q(math.tan(math.radians(camera['vfov']/2)));z=Q(camera['z'])
 return [(0,k,z*s),(1,a*k,a*z*s),(-1,a*k,a*z*s),(0,v*k-s,z*(v*s+k)),(0,v*k+s,z*(v*s-k))]
def clip(poly,plane):
 if not poly:return []
 A,B,C=plane;f=lambda p:A*p[0]+B*p[1]+C;out=[]
 for a,b in zip(poly,poly[1:]+poly[:1]):
  fa,fb=f(a),f(b)
  if fa>=0:out.append(a)
  if (fa>=0)!=(fb>=0):
   t=fa/(fa-fb);out.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
 return out

def distance_squared_to_face(a,b):
 d=sub(b,a);den=dot(d,d);t=max(Q(0),min(Q(1),-dot(a,d)/den)) if den else Q(0)
 closest=tuple(a[i]+t*d[i] for i in range(2));return dot(closest,closest)
def faces(test):
 z=Q(test['camera']['z']);clearance=Q(1,2);result=[]
 for w,wall in enumerate(test['localWalls']):
  base,top=Q(wall['base']),Q(wall['top'])
  if base>=z or top<=base:continue
  points=[tuple(map(Q,p)) for p in wall['polygon']]
  for i,(a,b) in enumerate(zip(points,points[1:])):
   d2=distance_squared_to_face(a,b)
   if d2<=clearance**2 or a==b:continue
   result.append(dict(id=f'{w}-{i}',a=a,b=b,base=base,top=top,distanceSquared=d2))
 return result

def prepared(test):
 c=test['camera'];subject=[tuple(map(Q,p)) for p in test['localRangeRing']] if c['enabled'] else []
 for plane in plane_coefficients(c):subject=clip(subject,plane)
 fs=faces(test);shadows=[];z,R=Q(c['z']),Q(c['range'])
 if subject:
  xmin,xmax=min(p[0] for p in subject),max(p[0] for p in subject);ymin,ymax=min(p[1] for p in subject),max(p[1] for p in subject)
  for face in fs:
   a,b,base,top=[face[k] for k in ['a','b','base','top']]
   # Projection of a 3-D wall corner from the mount through the ground plane.
   def ground(vertex,height):
    t=z/(z-height);return tuple(t*x for x in vertex)
   if a[0]*b[1]-a[1]*b[0]==0:continue
   low=[ground(a,base),ground(b,base)]
   if top<z:high=[ground(a,top),ground(b,top)]
   else:
    # Extend an unbounded projected face beyond the WHOLE containing box,
    # independently of the candidate's edge/guard formula. Power-of-two scale
    # suffices because every scaled face point is then outside its diagonal.
    factor=max(Q(1),2*z/(z-base))
    while factor*factor*face['distanceSquared']<=2*R*R:factor*=2
    high=[tuple(factor*x for x in a),tuple(factor*x for x in b)]
   polygon=[low[0],low[1],high[1],high[0]]
   for plane in [(1,0,-xmin),(-1,0,xmax),(0,1,-ymin),(0,-1,ymax)]:polygon=clip(polygon,plane)
   if len(polygon)>=3 and arrangement.ring_area(polygon):shadows.append((face['id'],polygon))
 return subject,fs,shadows

def ray_visibility(test,p,fs=None):
 c=test['camera'];x,y=map(Q,p);z,R=Q(c['z']),Q(c['range']);q=(x,y,-z);origin=(Q(0),Q(0),z);ambiguous=False
 if not c['enabled']:return False,False
 epsilon=1e-9
 planes=plane_coefficients(c)
 values=[A*x+B*y+C for A,B,C in planes]
 for (A,B,C),value in zip(planes,values):
  norm=math.hypot(float(A),float(B));ambiguous|=norm>0 and abs(float(value))/norm<epsilon
 radius=math.hypot(float(x),float(y));ambiguous|=abs(radius-float(R))<epsilon
 if any(v<0 for v in values) or x*x+y*y>R*R:return False,ambiguous
 for face in fs if fs is not None else faces(test):
  a,b,base,top=[face[k] for k in ['a','b','base','top']]
  A=(a[0],a[1],base);E=(b[0]-a[0],b[1]-a[1],Q(0));V=(Q(0),Q(0),top-base)
  normal=cross3(E,V);den=dot(normal,q);num=dot(normal,sub(A,origin))
  if not den:
   if not num:ambiguous=True # coplanar face/ray has measure zero in ground area
   continue
  t=num/den
  if t<=0 or t>1:continue
  hit=tuple(origin[k]+t*q[k] for k in range(3));delta=sub(hit,A)
  u=dot(delta,E)/dot(E,E);v=dot(delta,V)/dot(V,V)
  if -Q(1,10**10)<=u<=1+Q(1,10**10) and -Q(1,10**10)<=v<=1+Q(1,10**10):
   ambiguous|=min(abs(float(u)),abs(float(u-1)),abs(float(v)),abs(float(v-1)))<1e-9
  if 0<=u<=1 and 0<=v<=1:return False,ambiguous
 return True,ambiguous

def scalar_expectation(test):
 subject,fs,shadows=prepared(test)
 if len(subject)<3 or not arrangement.ring_area(subject):return dict(area=Q(0),subject=subject,faces=fs,shadows=shadows,slabs=0)
 result,stats=arrangement.exact_stats({'footprint':subject,'fans':[{'id':id,'ring':ring} for id,ring in shadows]})
 return dict(area=result['uncoveredArea'],subject=subject,faces=fs,shadows=shadows,slabs=stats['slabs'])
def multipolygon_area(multi):
 return sum((arrangement.ring_area([tuple(map(Q,p)) for p in polygon[0]])-sum((arrangement.ring_area([tuple(map(Q,p)) for p in hole]) for hole in polygon[1:]),Q(0)) for polygon in multi),Q(0))
