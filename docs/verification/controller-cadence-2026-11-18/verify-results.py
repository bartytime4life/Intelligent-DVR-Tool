"""Check the rejected cadence record; no native runtime or private media access."""
import ast
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


def load(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))


def require(value, message):
    if not value:
        raise AssertionError(message)


def proof(runtime):
    require(runtime['backend_id'] == 'onnxruntime-cuda' and
            runtime['fallback'] == 'disabled' and runtime['precision'] == 'FP32, TF32 disabled' and
            runtime['startup_execution']['node_execution_counts'] == {'CUDAExecutionProvider': 203},
            'Explicit CUDA execution/precision/fallback')


def check():
    data, plan, bindings, decision = (load(p) for p in
            ('results.json', 'plan.json', 'source-bindings.json', 'decision.json'))
    require(data['schema'] == 'intelligent-dvr.controller-cadence-qualification.v1' and
            data['source_commit'] == plan['source_commit'] == bindings['source_commit'] ==
            '80825904df5c2989aa546178c59c9d20b49f3977', 'Source revision')
    old = json.loads((HERE.parent / 'native-profile-2026-11-18/source-bindings.json').read_text())
    require(plan['core'] == bindings['core_sha256'] == old['core_source_sha256'] and
            len(plan['core']) == 5, 'Frozen core binding')
    for name, digest in plan['core'].items():
        require(hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == digest, 'Frozen file drift: '+name)
    for name, digest in bindings['tested_file_sha256'].items():
        require(old['tested_file_sha256'][name] == digest, 'Prior native proof source binding')
    for name, digest in bindings['harness_sha256'].items():
        p = HERE / 'harness' / name
        require(hashlib.sha256(p.read_bytes()).hexdigest() == digest, 'Harness drift')
        ast.parse(p.read_text())
    require(all(bindings['harness_sha256'][n] == h for n, h in plan['harness_sha256'].items()), 'Predeclared harness binding')
    require(bindings['recordings'] == old['recordings'] and len(bindings['recordings']) == 30 and
            bindings['model_sha256'] == old['model_sha256'] and bindings['media_uploaded'] is False and
            bindings['private_artifacts_retained'] and not bindings['public_corpus_complete'], 'Corpus/privacy scope')
    env, admission = load('environment.json'), load('cuda-admission.json')
    require(env['guard']['passed'] and env['guard']['sha256'] == bindings['offline_guard_sha256'] ==
            old['harness_sha256']['offline_guard.py'] and
            {(r['family'], r.get('errno')) for r in env['guard']['checks'] if r['denied']} == {(2, 1), (10, 1)}, 'Guard evidence')
    require(admission['status'] == 'admitted' and admission['recording_frames_processed'] == 0 and
            admission['cpu_fallback_used'] is False and admission['model_sha256'] == bindings['model_sha256'], 'Admission scope')
    proof(admission['runtime'])
    reports = data['cases']
    require([r['case'] for r in reports] == plan['order'] == ['A1', 'B1', 'B2', 'A2', 'profile-A', 'profile-B'], 'Run order')
    require(set(bindings['private_trace_sha256']) == set(plan['order']) and
            all(set(rows) == {'trace', 'drained', 'inputs'} and
                all(len(h) == 64 and set(h) <= set('0123456789abcdef') for h in rows.values())
                for rows in bindings['private_trace_sha256'].values()), 'Private trace bindings')
    for i, r in enumerate(reports):
        require(r['requested_post_step_sleep_ms'] == (.5 if i in (0, 3, 4) else 2.) and
                r['controller_step_starts_in_window'] > 0 and r['seconds'] == 30 and
                30 <= r['controller_elapsed_seconds'] < 31 and r['mode'] == 'none', 'Caller/window settings')
        require(math.isclose(r['results_per_second'], r['completed']/30, abs_tol=1e-12) and
                r['offered'] == sum(r[k] for k in ('completed', 'drained_after_stop', 'replaced',
                    'stale', 'budget_dropped', 'failed', 'pending', 'inflight')), 'Opportunity accounting')
        require(r['active_decoders'] == r['cameras'] == 100 and r['workers'] == 4 and
                r['physical_recordings'] == 30 and not r['errors'] and not r['source_errors'] and
                all(r[k] == 0 for k in ('failed', 'stale', 'budget_dropped', 'inflight')) and
                r['terminal_outcomes_unique_and_ordered'], 'Replay scope/errors')
        w = r['worker']
        require(w['state'] == 'closed' and not w['child_alive'] and not w['journal_error'] and
                w['failed'] == w['process_failures'] == w['restarts'] == w['active'] == 0 and
                w['completed'] == r['completed']+r['drained_after_stop'], 'Worker cleanup')
        require(len(r['startup_probes']) == 4, 'Four native sessions')
        for runtime in r['startup_probes']:
            proof(runtime)
        require(r['journal_enabled'] and r['sqlite_settings'] == dict(journal_mode='wal', synchronous=2,
                wal_autocheckpoint=512, user_version=1), 'Durability policy')
        require(r['delivery']['unique_ids'] == r['delivery']['acknowledged'] == w['completed'] ==
                r['journal']['terminal_rows'] and r['journal']['unacknowledged'] == 0 and
                r['journal']['entries']+r['delivery']['pruned'] == w['completed'], 'Durable IDs/ack/prune')
        require(r['max_combined_rss_bytes'] <= 4*1024**3 and r['min_available_bytes'] >= 2*1024**3, 'Sampled resource bounds')
        profile = r['profile']
        require(profile['enabled'] == r['profiling_enabled'] == (i >= 4), 'Separate profile setting')
        BoundedProfile.validate(profile['parent'])
        for generation, phases in profile['children'].items():
            BoundedProfile.validate(phases)
            require(profile['child_final'][generation] and 'native.cpu.run' not in phases and
                    phases['native.cuda.run'][0] == phases['child.processor'][0] == w['completed'], 'Profile execution/tail')
        require(bool(profile['children']) == (i >= 4), 'Profile presence')
    limits = plan['acceptance']
    require(limits == dict(minimum_unprofiled_median_gain=.03, maximum_candidate_p95_age_increase_ms=25,
            maximum_candidate_p95_age_ms=1000, require_lower_median_replacements=True, require_equal_offers=True,
            minimum_common_completed_samples=2500, minimum_box_iou=.99, maximum_score_delta=.001), 'Predeclared criteria')
    a = statistics.median(reports[i]['results_per_second'] for i in (0, 3))
    b = statistics.median(reports[i]['results_per_second'] for i in (1, 2))
    age = statistics.median(reports[i]['completion_age_p95_ms'] for i in (0, 3))
    candidate_age = max(reports[i]['completion_age_p95_ms'] for i in (1, 2))
    common = decision['common_samples']
    gates = dict(gain=b/a-1 >= .03, latency=candidate_age <= age+25 and candidate_age <= 1000,
            replacements=statistics.median(reports[i]['replaced'] for i in (1, 2)) < statistics.median(reports[i]['replaced'] for i in (0, 3)),
            equal_offers=len({r['offered'] for r in reports[:4]}) == 1,
            common_sample_agreement=common['compared'] >= 2500 and common['minimum_iou'] >= .99 and common['maximum_score_delta'] <= .001)
    require(decision == data['decision'] and decision['gates'] == gates and
            decision['baseline_median_per_second'] == a and decision['candidate_median_per_second'] == b and
            decision['baseline_median_p95_age_ms'] == age and decision['candidate_maximum_p95_age_ms'] == candidate_age and
            math.isclose(decision['observed_median_gain'], b/a-1, abs_tol=1e-12), 'Decision recomputation')
    require(not all(gates.values()) and not decision['accepted_for_longer_confirmation'] and
            not decision['default_adopted'] and not data['longer_confirmation_run'] and
            not data['application_defaults_changed'], 'Rejected candidate boundary')
    require(data['validation']['native_replay_cases'] == 6 and not data['validation']['new_unit_test_run'] and
            data['preservation'] == dict(core_files_unchanged=5, primary_file_hashes_unchanged=289,
                private_inputs_redistributed=False) and all(v == 'unqualified' for v in data['qualification'].values()), 'Evidence limits')
    ci = load('base-ci.json')
    require(len(ci) == 4 and all(r['head_sha'] == data['source_commit'] and r['status'] == 'completed'
            and r['conclusion'] == 'success' for r in ci), 'Separate baseline CI')
    manifest = load('manifest.json')
    require(set(manifest) == {'plan.json', 'decision.json', 'cuda-admission.json', 'environment.json',
            'results.json', 'source-bindings.json', 'base-ci.json'} | {'harness/'+n for n in bindings['harness_sha256']}, 'Manifest coverage')
    for name, digest in manifest.items():
        require(hashlib.sha256((HERE/name).read_bytes()).hexdigest() == digest, 'Receipt drift')
    print('Controller-pause record verified: six guarded native cases, frozen source, complete accounting, common predictions and rejected candidate.')


if __name__ == '__main__':
    check()
