"""Validate the latency-boundary addendum without private media or native imports."""
import ast
import hashlib
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def load(name):
    return json.loads((HERE/name).read_text(encoding='utf-8'))


def require(value, message):
    if not value:
        raise AssertionError(message)


def proof(runtime):
    require(runtime['backend_id'] == 'onnxruntime-cuda' and runtime['fallback'] == 'disabled' and
            runtime['precision'] == 'FP32, TF32 disabled' and
            runtime['startup_execution']['node_execution_counts'] == {'CUDAExecutionProvider': 203}, 'CUDA execution proof')


def check():
    data, plan, bindings, env = (load(p) for p in ('results.json', 'plan.json', 'source-bindings.json', 'environment.json'))
    require(data['schema'] == 'intelligent-dvr.durable-return-observation.v1' and
            data['source_commit'] == plan['source_commit'] == bindings['source_commit'] ==
            'c707962acdfa8c73e85d9588526cef3f0f43fd4f', 'Source revision')
    oldroot = HERE.parent / 'controller-cadence-2026-11-18'
    old = json.loads((oldroot/'source-bindings.json').read_text())
    require(bindings['core_sha256'] == plan['core'] == old['core_sha256'] and len(plan['core']) == 5, 'Frozen core')
    for name, h in plan['core'].items():
        require(hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == h, 'Frozen file drift')
    require(bindings['tested_file_sha256'] == old['tested_file_sha256'] and
            bindings['recordings'] == old['recordings'] and bindings['model_sha256'] == old['model_sha256'], 'Same code/model/corpus')
    for name, h in bindings['prior_record_unchanged_sha256'].items():
        require(hashlib.sha256((oldroot/name).read_bytes()).hexdigest() == h, 'Prior receipt rewritten')
    for name, h in bindings['harness_sha256'].items():
        p = HERE/'harness'/name
        require(hashlib.sha256(p.read_bytes()).hexdigest() == h, 'Executed harness binding')
        ast.parse(p.read_text())
    require(all(bindings['harness_sha256'][n] == h for n, h in plan['harness_sha256'].items()) and
            bindings['harness_sha256']['native_factory.py'] == old['harness_sha256']['native_factory.py'], 'Plan/worker clock source')
    require(plan['seconds'] == 120 and plan['post_step_sleep_ms'] == .5 and plan['profile'] is False and
            plan['criteria']['latency_service_level_target'] == 'not specified or qualified', 'Descriptive plan')
    admission = load('cuda-admission.json')
    require(admission['status'] == 'admitted' and admission['model_sha256'] == bindings['model_sha256'] and
            not admission['cpu_fallback_used'] and admission['recording_frames_processed'] == 0, 'Admission scope')
    proof(admission['runtime'])
    require(env['guard']['passed'] and env['guard']['sha256'] == bindings['offline_guard_sha256'] == old['offline_guard_sha256'] and
            {(r['family'], r.get('errno')) for r in env['guard']['checks'] if r['denied']} == {(2, 1), (10, 1)}, 'Offline guard')
    r = data['report']
    require(r['seconds'] == 120 and 120 <= r['controller_elapsed_seconds'] < 121 and
            r['requested_post_step_sleep_ms'] == .5 and r['mode'] == 'none' and
            not r['profiling_enabled'] and r['journal_enabled'], 'Baseline settings')
    require(math.isclose(r['results_per_second'], r['completed']/120, abs_tol=1e-12) and
            r['offered'] == sum(r[k] for k in ('completed', 'drained_after_stop', 'replaced', 'stale', 'budget_dropped', 'failed', 'pending', 'inflight')),
            'Window/drain/loss identity')
    require(r['active_decoders'] == r['cameras'] == 100 and r['physical_recordings'] == 30 and r['workers'] == 4 and
            not r['errors'] and not r['source_errors'] and all(r[k] == 0 for k in ('failed', 'stale', 'budget_dropped', 'inflight')) and
            r['terminal_outcomes_unique_and_ordered'] and r['return_clock_order_valid'], 'Observed replay/clock checks')
    worker = r['worker']
    require(worker['state'] == 'closed' and not worker['child_alive'] and not worker['journal_error'] and
            worker['restarts'] == worker['failed'] == worker['process_failures'] == worker['active'] == 0 and
            worker['completed'] == r['completed']+r['drained_after_stop'], 'Worker cleanup')
    require(len(r['startup_probes']) == 4, 'Four sessions')
    for runtime in r['startup_probes']:
        proof(runtime)
    require(r['sqlite_settings'] == dict(journal_mode='wal', synchronous=2, wal_autocheckpoint=512, user_version=1) and
            r['delivery']['unique_ids'] == r['delivery']['acknowledged'] == worker['completed'] == r['journal']['terminal_rows'] and
            r['journal']['unacknowledged'] == 0 and r['journal']['entries']+r['delivery']['pruned'] == worker['completed'], 'Committed unique delivery/ack')
    require(r['max_combined_rss_bytes'] <= 4*1024**3 and r['min_available_bytes'] >= 2*1024**3, 'Sampled resource guards')
    for values in r['latencies'].values():
        require(values['count'] == r['completed'] and
                all(math.isfinite(values[k]) for k in ('p50_ms', 'p95_ms', 'maximum_ms')) and
                0 <= values['p50_ms'] <= values['p95_ms'] <= values['maximum_ms'], 'Percentile count/order')
    a, b = r['latencies']['worker_end'], r['latencies']['durable_parent_return']
    require(all(b[k] >= a[k] for k in ('p50_ms', 'p95_ms', 'maximum_ms')), 'Paired age distribution order')
    camera = r['camera_coverage']
    require(camera['completed_camera_contexts'] == 100 and 0 < camera['minimum_successes'] <= camera['maximum_successes'] and
            camera['minimum_successes']*100 <= r['completed'] <= camera['maximum_successes']*100 and
            camera['maximum_camera_p95_return_age_ms'] <= b['maximum_ms'], 'Camera-context observation scope')
    require(data['measurement']['consumer_ack_included'] is False and
            data['measurement']['worker_end_boundary'] == 'child processor end' and
            data['measurement']['percentile_method'] == 'nearest rank ceil(q*n)' and
            data['original_cadence_plan_and_decision_unchanged'] and not data['optimization_adopted'] and
            not data['latency_service_level_qualified'] and
            data['preservation'] == dict(core_files_unchanged=5, primary_file_hashes_unchanged=289, media_uploaded=False) and
            all(v == 'unqualified' for v in data['qualification'].values()), 'Interpretation/preservation boundaries')
    require(set(bindings['private_receipt_sha256']) == {'summary', 'trace', 'drained', 'inputs'} and
            bindings['private_artifacts_retained'] and not bindings['public_corpus_complete'], 'Private evidence bindings')
    manifest = load('manifest.json')
    require(set(manifest) == {'results.json', 'plan.json', 'cuda-admission.json', 'environment.json', 'source-bindings.json'} |
            {'harness/'+n for n in bindings['harness_sha256']}, 'Manifest coverage')
    for name, h in manifest.items():
        require(hashlib.sha256((HERE/name).read_bytes()).hexdigest() == h, 'Receipt drift')
    print('Durable-return addendum verified: original receipts unchanged, parent/worker clock scopes, full accounting, committed IDs and bounded observation only.')


if __name__ == '__main__':
    check()
