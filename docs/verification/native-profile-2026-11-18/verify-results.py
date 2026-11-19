"""Validate the sanitized native record; never opens private media or a device."""
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from edge.profiling import BoundedProfile


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def load(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))


def proof(runtime):
    require(runtime['backend_id'] == 'onnxruntime-cuda' and
            runtime['fallback'] == 'disabled' and
            runtime['precision'] == 'FP32, TF32 disabled', 'Backend/fallback/precision')
    require(runtime['startup_execution']['node_execution_counts'] ==
            {'CUDAExecutionProvider': 203}, 'CUDA startup execution proof')
    require(bool(re.fullmatch(r'[0-9a-f]{64}',
            runtime['startup_execution']['profile_sha256'])), 'Startup profile hash')


def check():
    data, bindings, env = load('results.json'), load('source-bindings.json'), load('environment.json')
    require(data['schema'] == 'intelligent-dvr.native-profile-qualification.v1' and
            data['source_commit'] == bindings['source_commit'] ==
            'd9fa29ebebe102d43202a38c1d67347f1f62b85c', 'Tested revision')
    core = load('core-source.json')
    require(core == bindings['core_source_sha256'], 'Core source binding')
    old = json.loads((HERE.parent / 'durable-overload-2026-10-28/results.json').read_text())
    require(len(core) == 5, 'Five frozen core files')
    for name, expected in core.items():
        require(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected ==
                old['source_sha256'][name], 'Frozen core drift: ' + name)
    for name, expected in bindings['harness_sha256'].items():
        require(hashlib.sha256((HERE / 'harness' / name).read_bytes()).hexdigest() == expected,
                'Harness drift: ' + name)
    require(len(bindings['recordings']) == 30 and
            len({r['sha256'] for r in bindings['recordings']}) == 30 and
            all(0 < r['bytes'] <= 16*1024**2 for r in bindings['recordings']), 'Frozen corpus')
    require(bindings['parity_inputs'] == env['parity_inputs'] and
            {r['kind']: len(r['frame_indices']) for r in bindings['parity_inputs']} ==
            {'person': 60, 'vehicle': 40} and
            all(len(r['frame_indices']) == len(set(r['frame_indices']))
                and all(type(i) is int and 0 <= i < r['frames'] for i in r['frame_indices'])
                for r in bindings['parity_inputs']), 'Parity frame selection')
    require(bindings['media_redistributed'] is False and
            bindings['standalone_public_reproduction'] is False and
            bindings['private_artifacts_retained'] is True, 'Private input boundaries')
    require(env['guard']['passed'] and
            {(r['family'], r.get('errno')) for r in env['guard']['checks'] if r['denied']} ==
            {(2, 1), (10, 1)}, 'Offline guard evidence')
    require(env['guard']['sha256'] == bindings['harness_sha256']['offline_guard.py'], 'Guard binding')
    admission = load('cuda-admission.json')
    require(admission['status'] == 'admitted' and admission['recording_frames_processed'] == 0 and
            admission['cpu_fallback_used'] is False and
            admission['model_sha256'] == bindings['model_sha256'] ==
            'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063', 'Admission/model')
    proof(admission['runtime'])
    parity = data['parity']
    require(parity['passed'] and parity['frames'] == 100 and
            parity['minimum_iou'] >= parity['criteria']['minimum_iou'] == .99 and
            parity['maximum_score_delta'] <= parity['criteria']['maximum_score_delta'] == .001 and
            parity['criteria']['matching_counts_and_labels'], 'CPU/GPU agreement')
    require(parity['worker']['completed'] == parity['journal']['unacknowledged'] == 100 and
            not parity['worker']['child_alive'] and not parity['worker']['failed'] and
            not parity['worker']['journal_error'], 'Parity durable outcomes/cleanup')
    reports = data['cases']
    order = ['journal-1', 'control-1', 'control-2', 'journal-2',
             'profile-journal', 'profile-control', 'journal-120']
    require([r['case'] for r in reports] == data['run_order'] == order, 'Run order')
    for i, r in enumerate(reports):
        require(r['offered'] == sum(r[k] for k in ('completed', 'drained_after_stop',
                'replaced', 'stale', 'budget_dropped', 'failed', 'pending', 'inflight')), 'Loss accounting')
        require(r['seconds'] == (120 if i == 6 else 30) and
                r['seconds'] <= r['controller_elapsed_seconds'] < r['seconds']+1 and
                math.isclose(r['results_per_second'], r['completed']/r['seconds'], abs_tol=1e-12),
                'Window/drain throughput')
        require(r['active_decoders'] == r['cameras'] == 100 and r['workers'] == 4 and
                r['physical_recordings'] == 30 and r['mode'] == 'none', 'Replay scope')
        require(not r['errors'] and not r['source_errors'] and
                all(r[k] == 0 for k in ('stale', 'budget_dropped', 'failed', 'inflight')) and
                r['terminal_outcomes_unique_and_ordered'], 'Replay errors')
        w = r['worker']
        require(w['state'] == 'closed' and not w['child_alive'] and not w['journal_error'] and
                w['restarts'] == w['process_failures'] == w['failed'] == w['active'] == 0 and
                w['completed'] == r['completed']+r['drained_after_stop'], 'Worker cleanup/accounting')
        require(r['max_combined_rss_bytes'] <= 4*1024**3 and
                r['min_available_bytes'] >= 2*1024**3, 'Sampled memory bounds')
        require(len(r['startup_probes']) == 4, 'Four admitted CUDA sessions')
        for runtime in r['startup_probes']:
            proof(runtime)
        require(r['journal_enabled'] == (i in (0, 3, 4, 6)) and
                r['profiling_enabled'] == r['profile']['enabled'] == (i in (4, 5)), 'Case settings')
        if r['journal_enabled']:
            require(r['sqlite_settings'] == dict(journal_mode='wal', synchronous=2,
                    wal_autocheckpoint=512, user_version=1), 'Durability policy')
            require(r['delivery']['unique_ids'] == r['delivery']['acknowledged'] ==
                    r['completed']+r['drained_after_stop'] == r['journal']['terminal_rows'] and
                    r['journal']['unacknowledged'] == 0 and
                    r['journal']['entries']+r['delivery']['pruned'] == r['delivery']['acknowledged'],
                    'Unique durable delivery/pruning')
        profile = r['profile']
        BoundedProfile.validate(profile['parent'])
        for generation, phases in profile['children'].items():
            BoundedProfile.validate(phases)
            require(profile['child_final'][generation] and 'native.cpu.run' not in phases and
                    phases['native.cuda.run'][0] == phases['child.processor'][0] == w['completed'],
                    'Complete CUDA timing tail')
        require(bool(profile['children']) == r['profiling_enabled'], 'Profile presence')
    journal = statistics.median(reports[i]['results_per_second'] for i in (0, 3))
    control = statistics.median(reports[i]['results_per_second'] for i in (1, 2))
    c = data['comparison']
    require(c['unprofiled_journal_median_per_second'] == journal and
            c['unprofiled_control_median_per_second'] == control and
            math.isclose(c['journal_relative_throughput_cost'], 1-journal/control, abs_tol=1e-12),
            'Observed comparison')
    tests = data['local_tests']
    require(tests['discovered'] == tests['passed'] == sum(tests['suites'].values()) == 47 and
            tests['failed'] == tests['skipped'] == 0, 'Targeted test counts')
    for name, count in tests['suites'].items():
        log = (HERE / (name+'.log')).read_text()
        require(f'Ran {count} tests' in log and '\nOK\n' in log and
                'FAILED' not in log and 'skipped=' not in log, 'Test log binding')
    require(all(v is False for v in data['boundaries'].values()) and
            all(v == 'unqualified' for v in data['qualification'].values()), 'Operational/qualification boundary')
    manifest = load('manifest.json')
    expected = {'results.json', 'source-bindings.json', 'environment.json', 'cuda-admission.json',
                'core-source.json', 'core-tests.log', 'process-tests.log', 'profiler-tests.log'} | {
                'harness/'+name for name in bindings['harness_sha256']}
    require(set(manifest) == expected, 'Receipt manifest coverage')
    for name, h in manifest.items():
        require(hashlib.sha256((HERE/name).read_bytes()).hexdigest() == h, 'Receipt drift: '+name)
    print('Native owner record: frozen core, CUDA proof, 100-frame agreement, seven replay loss identities, durable delivery and profile tails verified.')


if __name__ == '__main__':
    check()
