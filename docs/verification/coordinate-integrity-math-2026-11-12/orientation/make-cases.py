import argparse,json,random,struct,hashlib
from fractions import Fraction
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path,required=True);args=parser.parse_args();out=args.output_dir;out.mkdir(parents=True,exist_ok=True)
sub=float.fromhex('0x0.0000000000001p-1022'); huge=float.fromhex('0x1.fffffffffffffp+1023')
cases=[[[0.,0.],[-0.,0.],[0.,-0.]],[[0.,0.],[sub,0.],[0.,sub]],[[-huge,-huge],[huge,-huge],[-huge,huge]],[[0.,0.],[1.,1.],[float.fromhex('0x1.fffffffffffffp-1'),1.]],[[1.,1.],[1.,1.],[1.,2.]],[[0.,0.],[sub,sub],[sub*2,sub*2]],[[sub,huge],[-sub,huge],[0.,-huge]]]
rng=random.Random(0x3ca11b)
def number():
 sign=rng.getrandbits(1); exp=rng.randrange(2047); fraction=rng.getrandbits(52)
 return struct.unpack('>d',struct.pack('>Q',(sign<<63)|(exp<<52)|fraction))[0]
for i in range(2000):cases.append([[number(),number()]for _ in range(3)])
for exponent in [-1074,-1000,-500,-1,0,500,900]:
 unit=2.**exponent
 for i in range(100):
  o=[rng.randrange(-100,100)*unit,rng.randrange(-100,100)*unit]
  a=[rng.randrange(-100,100)*unit,rng.randrange(-100,100)*unit]
  b=a[:] if i%2 else o[:]
  cases.append([o,a,b])
expected=[]
for o,a,b in cases:
 ox,oy,ax,ay,bx,by=map(Fraction.from_float,[*o,*a,*b]); value=(ax-ox)*(by-oy)-(ay-oy)*(bx-ox)
 expected.append((value>0)-(value<0))
raw=json.dumps(cases,separators=(',',':'),allow_nan=False).encode(); (out/'inputs.json').write_bytes(raw)
(out/'expected.json').write_text(json.dumps(expected,separators=(',',':'))+'\n')
print(json.dumps({'cases':len(cases),'inputSha256':hashlib.sha256(raw).hexdigest(),'expectedSha256':hashlib.sha256((out/'expected.json').read_bytes()).hexdigest()}))
