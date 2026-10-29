"""Finite synthetic disk/IPC experiment; never native camera-capacity evidence.

Reuse a trusted existing interpreter/network guard. No media, model, package,
device, service or production-journal access. Receipts stay in explicit roots.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import statistics
import sys

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT/'scripts/profile-durable.py'


def require(value, message):
    if not value:
        raise ValueError(message)


def write_new(path, value):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--python', type=Path, required=True)
    parser.add_argument('--guard', type=Path, required=True)
    parser.add_argument('--baseline-source', type=Path, required=True)
    parser.add_argument('--baseline-commit', default='50349bc758dedb6363c728e4893bedcedafc3808')
    parser.add_argument('--disk-root', type=Path, required=True)
    parser.add_argument('--ram-root', type=Path, required=True)
    args = parser.parse_args()
    for root in (args.disk_root, args.ram_root):
        root.mkdir(mode=0o700, parents=False, exist_ok=False)
    # Written before any measured stage. Source hashes bind both variants.
    plan = dict(scope='Synthetic storage/IPC only; no native inference or capacity claim',
        baseline_commit=args.baseline_commit,
        candidate_base_commit='29b20d78726b0e811fa97fe62577e92ce6a82fab',
        acceptance=dict(minimum_median_gain=.03, maximum_sampled_wal_bytes=4*1024**2,
                        full_sync=2, mode='wal', balanced_opportunities=True),
        settings=dict(cameras=100, workers=4, seconds=8, offer_hz=20, payload_bytes=388800,
                      ack_seconds=.025, max_payload_bytes=64*1024**2, max_rows=1000),
        harness_sha256=digest(SCRIPT), runner_sha256=digest(Path(__file__)),
        guard_sha256=digest(args.guard),
        baseline_source_sha256={n:digest(args.baseline_source/'edge'/n) for n in
                                ('journal.py','supervision.py','scheduler.py','inference.py')},
        candidate_source_sha256={n:digest(ROOT/'edge'/n) for n in
                                 ('journal.py','supervision.py','scheduler.py','inference.py')},
        order=['A1','B1','B2','A2','D1','R1','R2','D2','control'])
    plan['filesystems'] = {name:subprocess.check_output(['stat','-f','-c','%T',str(path)],
        text=True).strip() for name,path in [('disk',args.disk_root),('ram',args.ram_root)]}
    require(plan['filesystems']['ram'] == 'tmpfs', 'RAM comparison must use tmpfs')
    require(plan['filesystems']['disk'] != 'tmpfs', 'Disk comparison must not use tmpfs')
    write_new(args.disk_root/'plan.json', plan)
    reports = []
    for case in plan['order']:
        baseline = case.startswith('A')
        profiled = case.startswith(('D','R')) or case == 'control'
        root = args.ram_root if case.startswith('R') else args.disk_root
        output = root/(case+'.json')
        command = [str(args.python),'-B',str(args.guard),str(args.python),'-B',str(SCRIPT),
            '--seconds','8','--offer-hz','20','--payload-bytes','388800','--output',str(output)]
        if baseline:
            command += ['--source-root',str(args.baseline_source)]
        if profiled:
            command += ['--profile']
        if case == 'control':
            command += ['--no-journal']
        result = subprocess.run(command, cwd=ROOT, env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},
            capture_output=True, text=True, timeout=50)
        require(result.returncode == 0, case+': '+result.stderr[-1000:])
        report = json.loads(output.read_text())
        total = sum(report[k] for k in ('completed_in_window','failed_in_window','successful_drain',
            'failed_drain','replacements','stale','budget_dropped','pending','inflight'))
        require(total == report['offered'] and report['accounting_balanced'], case+': lost opportunities')
        require(report['inflight'] == 0 and not report['workers']['child_alive'], case+': unclosed work')
        require(report['peak_payload_bytes'] <= 64*1024**2 and report['peak_entries'] <= 1000,
                case+': resource bound exceeded')
        if report['journal']:
            require(report['journal_policy']['synchronous'] == 2 and report['journal_policy']['journal_mode'] == 'wal',
                    case+': durability policy changed')
            terminal = sum(report[k] for k in ('completed_in_window','failed_in_window','successful_drain','failed_drain'))
            require(report['unique_delivery_ids'] == terminal and not report['journal']['unacknowledged'],
                    case+': durable delivery mismatch')
        if profiled:
            require(report['profile']['child_final'].get('1') is True, case+': missing profile tail')
        require(report['source_sha256'] == plan['baseline_source_sha256' if baseline else 'candidate_source_sha256'],
                case+': source drift')
        if root != args.disk_root:
            write_new(args.disk_root/(case+'.json'), report)
        # Detailed records remain local. Aggregate views are reproducible below.
        report['case'] = case
        reports.append(report)
        print(case, report['offered'], report['completed_in_window'], report['replacements'],
              report['pending'], flush=True)
    require(all(r['settings'] == reports[0]['settings'] for r in reports[:4]), 'Unequal A/B settings')
    require(all(r['settings'] == reports[4]['settings'] for r in reports[4:8]), 'Unequal disk/RAM settings')
    baseline = statistics.median([reports[i]['samples_per_second'] for i in (0,3)])
    candidate = statistics.median([reports[i]['samples_per_second'] for i in (1,2)])
    gain = candidate/baseline-1
    accepted = (gain >= .03 and
                max(r['sampled_peak_wal_bytes'] for r in reports if r['journal']) <= 4*1024**2)
    write_new(args.disk_root/'results.json', dict(plan=plan, reports=reports,
        observed_median_gain=gain, candidate_accepted=accepted))
    print('Nine cases: source/settings/resource/delivery and opportunity identities verified.', flush=True)
    require(accepted, 'Candidate did not meet the prewritten median/WAL acceptance gate; retain the baseline')


if __name__ == '__main__':
    main()
