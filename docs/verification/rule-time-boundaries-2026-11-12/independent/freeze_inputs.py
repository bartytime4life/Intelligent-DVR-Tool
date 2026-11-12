from fractions import Fraction as F
from pathlib import Path
import json, math, gzip, hashlib
out=Path(__file__).resolve().parent
cases=[]
def add(name,times,gap,dwell,matches=None,domain='rational-cadence',tags=()):
    times=list(map(F,times));gap=F(gap);dwell=F(dwell)
    assert gap>0 and gap<=60 and 0<=dwell<=3600
    assert all(t>=0 for t in times) and all(a<b for a,b in zip(times,times[1:]))
    floats=list(map(float,times));assert all(a<b for a,b in zip(floats,floats[1:]))
    if matches is None:matches=[True]*len(times)
    start=last=None;emitted=False;expected=[]
    for i,(t,match) in enumerate(zip(times,matches)):
        if not match:continue
        if start is None or t-last>gap:start=t;emitted=False
        last=t
        if not emitted and t-start>=dwell:expected.append(i);emitted=True
    cases.append(dict(id=name,domain=domain,times=[str(t) for t in times],gap=str(gap),dwell=str(dwell),matches=matches,expected_event_indices=expected,tags=list(tags)))
# Every cadence here has a terminating decimal step; intended JSON rule seconds
# and integer-index/FPS time therefore have an unambiguous exact rational oracle.
settings=[(10,1),(25,5),(25,1),(50,1),(100,1),(20,1),(40,1),(80,1),(125,1),(200,1),(250,1),(1000,1),(24,6),(30,3),(60,3),(120,3),(5,1),(2,1),(1,1)]
offsets=[F(0),F(2,5),F(16,5),F(900),F(10000)]
for fps,stride in settings:
    step=F(stride,fps)
    for offset in offsets:
        label=f'fps{fps}-stride{stride}-offset{offset}'
        for dwell in [step,2*step,5*step,10*step]:
            add(f'{label}-continuous-dwell{dwell}',[offset+i*step for i in range(51)],step,dwell,tags=['integer-fps','gap-equality','dwell-equality'])
            add(f'{label}-empty-prefix-dwell{dwell}',[offset+i*step for i in range(55)],step,dwell,[False]*3+[True]*52,tags=['empty-detection-prefix','gap-equality','dwell-equality'])
        add(f'{label}-brief-miss',[offset+i*step for i in range(61)],2*step,5*step,[i%5!=2 for i in range(61)],tags=['empty-detections','gap-equality','brief-miss'])
        add(f'{label}-true-miss',[offset+i*step for i in range(61)],2*step,5*step,[i%11 not in (2,3,4) for i in range(61)],tags=['empty-detections','true-gap','true-reset'])
        # Deliberate distance from boundary >10000 endpoint ULPs at these offsets.
        delta=F(1,1000000)
        for sign,name in [(-1,'under'),(0,'equal'),(1,'over')]:
            gap=2*step
            add(f'{label}-gap-{name}',[offset,offset+gap+sign*delta],gap,0,tags=['near-boundary',f'gap-{name}'])
            dwell=5*step
            add(f'{label}-dwell-{name}',[offset,offset+dwell+sign*delta,offset+dwell+step],10*step,dwell,tags=['near-boundary',f'dwell-{name}'])
# Long but evaluator-admissible pure frame indices: at most 100000 source frames,
# positive supported FPS, and stride/FPS <= max_gap.
for fps,stride,offset_index in [(F(1,10),1,99000),(F(1,60),1,99000),(F(25),5,99000),(F(10),1,99000)]:
    step=F(stride)/fps;offset=F(offset_index)/fps
    add(f'late-valid-frame-index-fps{fps}-stride{stride}',[offset+i*step for i in range(21)],step,2*step,tags=['late-frame-index','gap-equality','dwell-equality'])
# Decimal timestamp producers need not be an integer FPS source.
for step in [F('0.03'),F('0.07'),F('0.13'),F('0.17'),F('0.29'),F('0.333'),F('1.01')]:
    for offset in [F('0.41'),F('73.21'),F('899.7'),F('1000000')]:
        add(f'decimal-step{step}-offset{offset}',[offset+i*step for i in range(41)],step,5*step,tags=['decimal-clock','gap-equality','dwell-equality'])
# Truly large FLOAT timestamps: there is no declared hidden exact physical clock.
# The expected contract is the supplied finite Numbers themselves, as rationals.
# In particular an unconditional ulp(time)-sized forgiveness must not make a
# many-second or 10^292-second gap appear <= 0.2 seconds.
for exponent in [40,48,50,52,54,100,500,1000]:
    a=float(2**exponent);b=math.nextafter(a,math.inf);c=math.nextafter(b,math.inf)
    for gap in [F('0.2'),F(2),F(60)]:
        add(f'exact-float-nextafter-2^{exponent}-gap{gap}',[F(a),F(b),F(c)],gap,0,domain='exact-float',tags=['coarse-clock','no-gross-gap-forgiveness'])
# Subnormal and smallest-normal exact dyadic schedules retain meaningful ordering.
for step in [F(float.fromhex('0x0.0000000000001p-1022')),F(float.fromhex('0x1p-1022')),F(1,2**40)]:
    add(f'exact-dyadic-step{step}',[i*step for i in range(5)],step,2*step,domain='exact-float',tags=['exact-dyadic','tiny-positive-boundary'])
invalid=[dict(id=f'invalid-time-{token}',first='1',invalid=token,recovery='2') for token in ['same','decreasing','negative','nan','infinity','negative-infinity','bool','string','none']]
# Two different physical realities produce identical rounded timestamps; no
# comparator can recover these hidden truths from its float-only API.
a=F(2**54)
ambiguous=[dict(id='same-binary64-endpoints-different-real-gaps',gap='1/5',pairs=[[str(a+F(19,10)),str(a+F(21,10))],[str(a),str(a+4)]],same_float_endpoints=True)]
for case in ambiguous:
    pairs=case['pairs'];assert [float(F(t)) for t in pairs[0]]==[float(F(t)) for t in pairs[1]]
    case['real_gaps']=[str(F(p[1])-F(p[0])) for p in pairs]
obj=dict(schema='dvr-rule-time-rational-oracle-v1',baseline_head='9e88a57b377ca53a991519cae9bdbbcf25cb7924',cases=cases,invalid_cases=invalid,ambiguity_diagnostics=ambiguous,limits=['Generated timestamps and a constant normalized person detection; no media or inference.','Rational-cadence expectations use exact arithmetic before binary64 conversion.','Exact-float stress cases use exact binary64 endpoint values, not invented physical timing.','Ambiguity diagnostics are not pass/fail physical-clock claims.'])
raw=(json.dumps(obj,separators=(',',':'),sort_keys=True)+'\n').encode();(out/'inputs.json.gz').write_bytes(gzip.compress(raw,mtime=0))
print(json.dumps(dict(cases=len(cases),invalid_cases=len(invalid),samples=sum(len(c['times'])for c in cases),input_sha256=hashlib.sha256(raw).hexdigest(),gzip_sha256=hashlib.sha256((out/'inputs.json.gz').read_bytes()).hexdigest()),indent=2))
