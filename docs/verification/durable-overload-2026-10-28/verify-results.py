"""Validate local source bindings, policies, receipts and all opportunity counts."""
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from edge.profiling import BoundedProfile


def require(value, message):
    if not value:
        raise ValueError(message)


def accounting(report):
    total = sum(report[k] for k in ('completed_in_window','failed_in_window',
        'successful_drain','failed_drain','replacements','stale','budget_dropped','pending','inflight'))
    require(total == report['offered'] and report['accounting_balanced'], 'Opportunity accounting')
    require(report['inflight'] == 0 and report['failed_in_window'] == report['failed_drain'] == 0,
            'Unresolved/failed synthetic work')
    require(report['peak_payload_bytes'] <= 64*1024**2 and report['peak_entries'] <= 1000, 'Resource bounds')


def check():
    data = json.loads((HERE/'results.json').read_text())
    for path, expected in data['source_sha256'].items():
        require(hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == expected, 'Source drift: '+path)
    for kind, filename in [('cpu_environment','cpu-tests.log'),('gpu_package_environment','gpu-package-tests.log')]:
        require(data['tests'][kind] == dict(discovered=142,passed=142,failed=0,skipped=0), 'Test counts')
        log = (HERE/filename).read_text()
        require('Ran 142 tests' in log and '\nOK\n' in log and 'FAILED' not in log, 'Test log disagreement')
    require(all(v is False for v in data['boundaries'].values()), 'Operational boundary changed')
    require(all(v == 'unqualified' for v in data['qualification'].values()), 'Capacity overclaim')
    require(data['legacy_roundtrip']['passed'] and data['legacy_roundtrip']['unique_ids'] == 3 and
            data['legacy_roundtrip']['explicitly_pruned'] == 3 and
            data['legacy_roundtrip']['explicit_acks_survived_reopen'], 'Legacy compatibility')
    require(data['network_guard']['passed'] and
            {r['family'] for r in data['network_guard']['checks'] if r['denied'] and r['errno']==1} == {2,10},
            'Network guard evidence')
    cuda = data['native_cuda']
    require(cuda['status'] == 'blocked' and cuda['cuda_failure_code'] == 100 and
            cuda['recording_frames_processed'] == 0 and cuda['cpu_fallback_used'] is False, 'CUDA gate')
    confirmation = data['confirmation']
    plan, reports = confirmation['plan'], confirmation['reports']
    require([r['case'] for r in reports] == plan['order'] == ['A1','B1','B2','A2','D1','R1','R2','D2','control'], 'Run order')
    require(plan['filesystems']['ram'] == 'tmpfs' and plan['filesystems']['disk'] != 'tmpfs', 'Filesystem comparison')
    require(plan['harness_sha256'] == data['source_sha256']['scripts/profile-durable.py'] and
            plan['runner_sha256'] == data['source_sha256']['docs/verification/durable-overload-2026-10-28/run-experiment.py'],
            'Harness binding')
    require(all(r['settings'] == reports[0]['settings'] for r in reports[:4]), 'Unequal A/B settings')
    require(all(r['settings'] == reports[4]['settings'] for r in reports[4:8]), 'Unequal disk/RAM settings')
    for report in reports:
        accounting(report)
        require(not report['workers']['child_alive'], 'Unreaped child')
        baseline = report['case'].startswith('A')
        require(report['source_sha256'] == plan['baseline_source_sha256' if baseline else 'candidate_source_sha256'],
                'Variant binding')
        if report['journal']:
            policy = report['journal_policy']
            require(policy['synchronous'] == 2 and policy['journal_mode'] == 'wal' and
                    policy['wal_autocheckpoint'] == (64 if baseline else 512), 'Journal policy')
            require(report['sampled_peak_wal_bytes'] <= plan['acceptance']['maximum_sampled_wal_bytes'], 'Sampled WAL gate')
            terminal = sum(report[k] for k in ('completed_in_window','failed_in_window','successful_drain','failed_drain'))
            require(report['unique_delivery_ids'] == terminal and report['journal']['unacknowledged'] == 0, 'Durable delivery')
        if report['profile']:
            BoundedProfile.validate(report['profile']['parent'])
            for generation, rows in report['profile']['children'].items():
                BoundedProfile.validate(rows)
                require(report['profile']['child_final'][generation], 'Missing profile tail')
    for name, expected in plan['candidate_source_sha256'].items():
        require(data['source_sha256']['edge/'+name] == expected and cuda['source_sha256'][name] == expected,
                'Candidate/CUDA source binding')
    gain = statistics.median([reports[i]['samples_per_second'] for i in (1,2)])/statistics.median(
        [reports[i]['samples_per_second'] for i in (0,3)])-1
    require(math.isclose(gain, confirmation['observed_median_gain'], abs_tol=1e-12) and
            gain >= plan['acceptance']['minimum_median_gain'] == .03 and confirmation['candidate_accepted'], 'Acceptance gate')
    for report in data['initial_diagnostic']['reports']+data['exploratory_checkpoint_trial']:
        accounting(report)
    print('Owner synthetic record: source/policy bindings, 142 tests per environment, legacy recovery, CUDA block and all loss identities verified.')


if __name__ == '__main__':
    check()
