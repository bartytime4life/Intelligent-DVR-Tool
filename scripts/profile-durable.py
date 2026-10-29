"""Bounded synthetic storage/IPC probe; never camera or native inference capacity.

Use this identical harness with --source-root for PR #20 and candidate. Compare
profiling-OFF runs, then collect separate --profile attribution. No media/network.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import sys
import tempfile
import time


class SyntheticFactory:
    def __call__(self, slot, generation):
        return SyntheticProcessor()


class SyntheticProcessor:
    def __call__(self, sample):
        return {'sha256': hashlib.sha256(sample.payload).hexdigest(), 'synthetic': True}


def run(args):
    sys.path.insert(0, str(args.source_root.resolve()))
    from edge.scheduler import CameraScheduler, Sample
    from edge.supervision import ProcessWorkers
    from edge.journal import OutcomeJournal
    profile = None
    if args.profile:
        from edge.profiling import BoundedProfile
        profile = BoundedProfile()
    options = {'profile': profile} if profile is not None else {}
    cameras = [f'virtual-{i}' for i in range(100)]
    scheduler = CameraScheduler(cameras, workers=4, max_sample_bytes=2*1024**2,
        max_buffer_bytes=64*1024**2, max_age_seconds=2, **options)
    payload = b's'*args.payload_bytes
    seen, delivered = set(), set()
    counts = dict(completed_in_window=0, failed_in_window=0, successful_drain=0, failed_drain=0)
    offered = peak_entries = peak_wal_bytes = 0
    with tempfile.TemporaryDirectory(dir=args.output.parent, prefix='durable-probe-') as directory:
        journal = None if args.no_journal else OutcomeJournal(Path(directory)/'journal',
            max_entries=1000, max_bytes=64*1024**2, **options)
        policy = None if journal is None else {name:journal._db.execute('PRAGMA '+name).fetchone()[0]
            for name in ('journal_mode','synchronous','wal_autocheckpoint','page_size')}
        pool = None
        try:
            pool = ProcessWorkers(scheduler, SyntheticFactory(), journal=journal,
                task_timeout=2, **options)
            deadline = time.monotonic()+30
            while pool.snapshot()['state'] == 'starting' and time.monotonic() < deadline:
                pool.step()
                time.sleep(.001)
            if pool.snapshot()['state'] != 'running':
                raise RuntimeError('Synthetic worker did not start')

            def collect(rows, drain=False):
                for row in rows:
                    if row.work.token in seen:
                        raise RuntimeError('Duplicate terminal token')
                    seen.add(row.work.token)
                    key = ('successful_drain' if row.error is None else 'failed_drain') if drain else (
                        'completed_in_window' if row.error is None else 'failed_in_window')
                    counts[key] += 1

            def consume():
                nonlocal peak_entries, peak_wal_bytes
                if journal is None:
                    return
                ids = [row['id'] for row in journal.pending(1000)]
                if set(ids) & delivered:
                    raise RuntimeError('Acknowledged outcome redelivered')
                delivered.update(ids)
                if ids:
                    journal.acknowledge(ids)
                count = journal.snapshot()['entries']
                peak_entries = max(peak_entries, count)
                wal = Path(directory)/'journal/outcomes.sqlite3-wal'
                peak_wal_bytes = max(peak_wal_bytes, wal.stat().st_size if wal.exists() else 0)
                if count >= 500:
                    journal.prune()

            started = time.monotonic()
            end = started+args.seconds
            next_offer = next_ack = started
            sequence = 0
            while time.monotonic() < end:
                if time.monotonic() >= next_offer:
                    for camera in cameras:
                        scheduler.submit(Sample(camera, sequence, time.monotonic(), payload))
                        offered += 1
                    sequence += 1
                    next_offer = started+sequence/args.offer_hz
                rows = pool.step()
                collect(rows, drain=time.monotonic() >= end)
                if time.monotonic() >= next_ack:
                    consume()
                    next_ack = time.monotonic()+args.ack_seconds
                if pool.snapshot()['state'] == 'failed':
                    raise RuntimeError('Synthetic worker failed')
                time.sleep(.0005)
            collect(pool.close(timeout=2), drain=True)
            consume()
            snap = scheduler.snapshot()
            totals = {key: sum(s[key] for s in snap['per_camera'].values())
                      for key in ('received','completed','failed','replaced','stale','budget_dropped')}
            accounted = sum(totals[k] for k in ('completed','failed','replaced','stale','budget_dropped'))+snap['pending']+snap['inflight']
            if (offered != totals['received'] or offered != accounted or
                    totals['completed'] != counts['completed_in_window']+counts['successful_drain'] or
                    totals['failed'] != counts['failed_in_window']+counts['failed_drain']):
                raise RuntimeError('Opportunity accounting mismatch')
            if journal is not None and (len(delivered) != len(seen) or journal.snapshot()['unacknowledged']):
                raise RuntimeError('Durable delivery accounting mismatch')
            return dict(schema='intelligent-dvr.synthetic-durable-profile.v1',
                scope='Synthetic storage/IPC only; no media, inference or capacity claim',
                python=platform.python_version(), sqlite=sqlite3.sqlite_version,
                source_sha256={n: hashlib.sha256((args.source_root/'edge'/n).read_bytes()).hexdigest()
                    for n in ('journal.py','supervision.py','scheduler.py','inference.py')},
                settings=dict(cameras=100, workers=4, seconds=args.seconds,
                    payload_bytes=args.payload_bytes, offer_hz=args.offer_hz, journal=journal is not None,
                    ack_seconds=args.ack_seconds, profiling=args.profile),
                offered=offered, **counts, window_seconds=args.seconds,
                samples_per_second=counts['completed_in_window']/args.seconds,
                replacements=totals['replaced'], stale=totals['stale'], budget_dropped=totals['budget_dropped'],
                pending=snap['pending'], inflight=snap['inflight'],
                peak_payload_bytes=snap['peak_buffered_payload_bytes'], peak_entries=peak_entries,
                journal_policy=policy, sampled_peak_wal_bytes=peak_wal_bytes,
                unique_delivery_ids=len(delivered), accounting_balanced=True,
                workers=pool.snapshot(), journal=journal.snapshot() if journal is not None else None,
                profile=pool.profile_snapshot() if profile is not None else None)
        finally:
            if pool is not None:
                pool.close(timeout=0)
            if journal is not None:
                journal.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--payload-bytes', type=int, default=4096)
    parser.add_argument('--offer-hz', type=float, default=2,
        help='Synthetic offers per virtual source per second, 0.5–20; not a production camera setting')
    parser.add_argument('--ack-seconds', type=float, default=.025)
    parser.add_argument('--profile', action='store_true')
    parser.add_argument('--no-journal', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if (not 1 <= args.seconds <= 120 or not 1 <= args.payload_bytes <= 2*1024**2 or
            not 0 <= args.ack_seconds <= 1 or not .5 <= args.offer_hz <= 20):
        parser.error('Use 1–120 seconds, 1–2097152 payload bytes, 0–1 acknowledgment seconds and --offer-hz 0.5–20')
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(run(args), stream, indent=2)
        stream.write('\n')


if __name__ == '__main__':
    main()
