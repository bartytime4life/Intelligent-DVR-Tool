"""Private synthetic PR20 -> candidate -> PR20 schema/delivery check."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from edge.journal import OutcomeJournal
from edge.scheduler import Sample, Work


def require(value, message):
    if not value:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-source', type=Path, required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = args.baseline_source/'edge/journal.py'
    require(hashlib.sha256(source.read_bytes()).hexdigest() ==
            'b20ad60e4bfc80e62f9912cdba7ad0a8279e2b887ce5341ceb5084e40c3ed6aa',
            'Require the pinned merged PR20 journal')
    spec = importlib.util.spec_from_file_location('edge.legacy_journal', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as output:
        args.directory.mkdir(mode=0o700, parents=False, exist_ok=False)
        def work(token):
            return Work(token, Sample('synthetic', token, 0., b'fixture'), 0.)
        with module.OutcomeJournal(args.directory) as legacy:
            legacy.reserve([work(1), work(2)], 1)
            first = legacy.finish(1, result={'source':'legacy'}, error=None, processor=0)
            require(legacy._db.execute('PRAGMA wal_autocheckpoint').fetchone()[0] == 64, 'Legacy cadence')
        with OutcomeJournal(args.directory) as current:
            rows = current.pending()
            require(len(rows) == 2 and current.recovered == 1, 'Recovery lost a reservation')
            require(rows[0]['id'] == first and rows[0]['result'] == {'source':'legacy'}, 'Legacy success changed')
            require(rows[1]['error'] == 'parent-interrupted', 'Missing interruption')
            require(current._db.execute('PRAGMA synchronous').fetchone()[0] == 2, 'FULL changed')
            require(current._db.execute('PRAGMA wal_autocheckpoint').fetchone()[0] == 512, 'Candidate cadence')
            current.reserve([work(1)], 2)
            third = current.finish(1, result={'source':'candidate'}, error=None, processor=0)
            require(len({r['id'] for r in current.pending()}) == 3, 'Identity reused')
            current.acknowledge([first])
        with module.OutcomeJournal(args.directory) as legacy:
            rows = legacy.pending()
            require(len(rows) == 2 and rows[-1]['id'] == third, 'Legacy reread failed')
            require(rows == legacy.pending(), 'Delivery identity changed')
            require(rows[-1]['result'] == {'source':'candidate'}, 'Candidate result unreadable')
            legacy.acknowledge([r['id'] for r in rows])
        with module.OutcomeJournal(args.directory) as legacy:
            require(legacy.pending() == [], 'Acknowledgment did not persist')
            require(legacy.prune() == 3, 'Explicit prune lost count')
            require(legacy._db.execute('PRAGMA user_version').fetchone()[0] == 1, 'Schema changed')
        json.dump(dict(passed=True, schema_version=1, unique_ids=3, interrupted=1,
            legacy_wal_pages=64, candidate_wal_pages=512, read_repeat_stable=True,
            explicit_acks_survived_reopen=True, explicitly_pruned=3), output, indent=2)
        output.write('\n')
    print('Pinned PR20 -> candidate -> PR20 recovery/identity/acknowledgment round trip passed.')


if __name__ == '__main__':
    main()
