"""Verify public artifacts; optionally bind the currently checked-out app bytes."""
from pathlib import Path
import argparse,gzip,hashlib,json
p=argparse.ArgumentParser();p.add_argument('--check-current-source',action='store_true');p.add_argument('--root',type=Path,default=Path('.'));a=p.parse_args()
here=Path(__file__).resolve().parent;m=json.loads((here/'manifest.json').read_bytes())
for name,item in m['artifacts'].items():
    raw=(here/name).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise SystemExit(f'Artifact changed: {name}')
    if 'uncompressed_sha256' in item and hashlib.sha256(gzip.decompress(raw)).hexdigest()!=item['uncompressed_sha256']:raise SystemExit(f'Uncompressed artifact changed: {name}')
if a.check_current_source:
    for name,expected in m['candidate_source_sha256'].items():
        if hashlib.sha256((a.root/name).read_bytes()).hexdigest()!=expected:raise SystemExit(f'Current source differs from captured candidate: {name}')
print(f"Verified {len(m['artifacts'])} artifacts"+(' and current source'if a.check_current_source else''))
