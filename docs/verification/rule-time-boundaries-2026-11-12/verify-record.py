"""Read-only verification of this unsigned, revision-bound evidence package."""
import argparse
import hashlib
import json
from pathlib import Path


BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]


def verify(entries, root):
    for entry in entries:
        path = (root / entry['path']).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f"Missing or outside package: {entry['path']}")
        raw = path.read_bytes()
        if len(raw) != entry['bytes'] or hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError(f"Evidence drift: {entry['path']}")
    return len(entries)


def read(name):
    return json.loads((BASE / name).read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-current', action='store_true',
                        help='Also require current source/docs and preserved files to match this snapshot')
    args = parser.parse_args()
    counts = {'artifacts': verify(read('artifact-manifest.json')['artifacts'], BASE)}
    if args.check_current:
        for name in ['source-manifest', 'documentation-inventory', 'preservation']:
            counts[name] = verify(read(name + '.json')['files'], ROOT)
    print(json.dumps({'verified': counts, 'unsigned_historical_record': True}, sort_keys=True))


if __name__ == '__main__':
    main()
