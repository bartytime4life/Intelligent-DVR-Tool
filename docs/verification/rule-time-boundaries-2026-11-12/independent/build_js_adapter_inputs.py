"""Preserve the SAME oracle cases as JSON binary64 numbers for Node transport.

Python's float(Fraction) rounds the rational before JSON serialization. Direct
Number(numerator)/Number(denominator) is unsuitable for subnormal denominators.
Expected counts are copied from frozen event indices, never recalculated here.
"""
from pathlib import Path
from fractions import Fraction
import argparse,json,gzip,hashlib
p=argparse.ArgumentParser();p.add_argument('--inputs',type=Path,default=Path(__file__).with_name('inputs.json.gz'));p.add_argument('--output',type=Path,default=Path(__file__).with_name('js-adapter-inputs.json.gz'));a=p.parse_args()
raw=gzip.decompress(a.inputs.read_bytes())if a.inputs.suffix=='.gz'else a.inputs.read_bytes();frozen=json.loads(raw)
cases=[{'id':c['id'],'domain':c['domain'],'times':[float(Fraction(t))for t in c['times']],'gap':float(Fraction(c['gap'])),'dwell':float(Fraction(c['dwell'])),'matches':c['matches'],'expected_count':len(c['expected_event_indices'])}for c in frozen['cases']]
obj={'schema':'dvr-rule-time-js-adapter-inputs-v1','original_inputs_sha256':hashlib.sha256(raw).hexdigest(),'conversion':'Python correctly rounded float(Fraction); counts copied from frozen exact-rational expected event sample indices. No expected values recomputed.','cases':cases};out=(json.dumps(obj,separators=(',',':'),sort_keys=True)+'\n').encode();a.output.write_bytes(gzip.compress(out,mtime=0));print(hashlib.sha256(out).hexdigest())
