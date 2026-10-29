"""Offline acknowledgment microbenchmark; not inference/camera capacity.

Run the same harness against PR #20 and candidate source roots in A/B/B/A order.
Private temporary synthetic journals use the output parent. No media or network.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import statistics
import sys
import tempfile
import time


def run(root, repeats=11):
    from edge.journal import OutcomeJournal
    from edge.scheduler import Sample, Work
    results = []
    for size in (1, 4, 64, 1000):
        with tempfile.TemporaryDirectory(dir=root, prefix='ack-probe-') as directory:
            with OutcomeJournal(Path(directory)/'journal', max_result_bytes=512) as journal:
                for token in range(1, 1001):
                    journal.reserve([Work(token, Sample('synthetic', token, 0., b'fixture'), 0.)], 1)
                    journal.finish(token, result={'fixture': True}, error=None, processor=0)
                ids, samples = list(range(1, size+1)), []
                for _ in range(repeats):
                    # Fixture reset is excluded from timing.
                    with journal._db:
                        journal._db.execute('UPDATE entries SET acked=0')
                    began = time.perf_counter_ns()
                    journal.acknowledge(ids)
                    samples.append(time.perf_counter_ns()-began)
                    if journal.snapshot()['unacknowledged'] != 1000-size:
                        raise RuntimeError('Acknowledgment accounting mismatch')
                statements = []
                journal._db.set_trace_callback(statements.append)
                journal.acknowledge(ids)
                journal._db.set_trace_callback(None)
                results.append(dict(batch=size, samples_ns=samples,
                    median_ns=statistics.median(samples),
                    validation_selects=sum(s.startswith('SELECT') for s in statements),
                    update_statements=sum(s.startswith('UPDATE') for s in statements)))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--label', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.source_root.resolve()))
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        report = dict(schema='intelligent-dvr.ack-cost.v1', label=args.label,
            python=platform.python_version(), sqlite=sqlite3.sqlite_version,
            workload='1000 retained synthetic rows; 11 ack trials/batch; WAL/FULL',
            journal_sha256=hashlib.sha256((args.source_root/'edge/journal.py').read_bytes()).hexdigest(),
            results=run(args.output.parent))
        json.dump(report, stream, indent=2)
        stream.write('\n')


if __name__ == '__main__':
    main()
