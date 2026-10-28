"""Check frozen CUDA evidence accounting and publication boundaries, not hardware."""
import json
import math
from pathlib import Path
import re


def check():
    root = Path(__file__).resolve().parent
    data = json.loads((root / 'results.json').read_text())
    bindings = json.loads((root / 'source-bindings.json').read_text())
    def require(condition, message):
        if not condition:
            raise ValueError('CUDA evidence: '+message)

    def proof(value):
        require(value['warmup_runs_excluded'] == 1, 'startup probe count')
        counts = value['node_execution_counts']
        require(set(counts) == {'CUDAExecutionProvider'} and counts['CUDAExecutionProvider'] > 0,
                'startup CUDA-only execution')
        require(bool(re.fullmatch(r'[a-f0-9]{64}', value['profile_sha256'])), 'profile hash')

    require(data['base_commit'] == bindings['base_commit'] and
            bool(re.fullmatch(r'[a-f0-9]{40}', data['base_commit'])), 'source base')
    require(data['backend_default'] == 'opencv-cpu' and data['cuda_optional'] is True
            and data['cpu_graph_and_runtime_fallback'] is False, 'explicit backend defaults')
    require(data['capacity_100_qualified'] is False and data['weights_bundled'] is False
            and data['operating_confidence_changed'] is False and data['recordings_kept_local'] is True,
            'qualification boundaries')
    parity = data['analyzer_parity']
    criteria = parity['criteria']
    require(parity['passed'] is True and parity['frames_compared'] == 100
            and sum(c['frames'] for c in parity['clips']) == 100, 'parity counts')
    require(criteria['minimum_iou'] == .99 and criteria['maximum_score_delta'] == .001
            and criteria['matching_counts_labels'] is True and criteria['events_exactly_equal'] is True,
            'parity criteria')
    require(parity['minimum_matched_iou'] >= criteria['minimum_iou'] and
            parity['maximum_matched_score_delta'] <= criteria['maximum_score_delta'], 'parity tolerance')
    for clip in parity['clips']:
        require(clip['events_identical'] is True, 'event agreement')
        proof(clip['cuda_execution'])
    require(len(data['load_experiments']) == 3, 'three load records')
    for row in data['load_experiments']:
        parts = ('completed', 'replaced', 'expired_pending', 'budget_dropped', 'pending_at_stop')
        require(all(type(row[k]) is int and row[k] >= 0 for k in (*parts, 'offered', 'decoded_frames')),
                'nonnegative integer accounting')
        require(row['offered'] == sum(row[k] for k in parts), 'queue accounting '+row['name'])
        require(row['seconds'] > 0 and math.isclose(row['completed_per_second'],
                row['completed']/row['seconds'], rel_tol=1e-10), 'completion rate')
        require(math.isclose(row['decoded_fps_aggregate'], row['decoded_frames']/row['seconds'],
                            rel_tol=1e-10), 'decode rate')
        require(row['active_peak'] == row['sources_without_errors'] == row['requested']
                and row['worker_exit'] == 0 and not row['source_errors'] and not row['experiment_errors'],
                'experiment completion')
        runtime = row['runtime']
        require(runtime['backend_id'] == 'onnxruntime-cuda' and runtime['fallback'] == 'disabled'
                and runtime['onnxruntime'] == '1.31.1' and runtime['provider_options']['use_tf32'] == 0,
                'measured runtime')
        proof(runtime['startup_execution'])
        if row['mode'] == 'local-replay':
            require(row['requested'] in (50, 100) and row['distinct_recordings_or_publishers'] == 30
                    and row['retained_new_fragment_bytes'] == row['verified_new_fragments'] == 0,
                    'replay scope')
        else:
            require(row['mode'] == 'public-live' and row['requested'] == 30 and row['seconds'] >= 120
                    and row['verified_new_fragments'] == 884, 'live scope')
    for name, passed in (('python_gpu_environment',86), ('python_cpu_only_environment',86), ('frontend',46)):
        require(data['checks'][name] == {'passed':passed, 'skipped':0}, 'test counts')
    require(data['checks']['missing_gpu_runtime'] == {'exit':1, 'receipt_written':False,
            'missing_runtime_diagnostic':True}, 'missing-runtime outcome')
    for entries in ('files', 'private_harnesses', 'test_logs'):
        for entry in bindings[entries]:
            require(bool(re.fullmatch(r'[a-f0-9]{64}', entry['sha256'])), 'binding hash')
    # Frozen source hashes are not required to equal future implementation files.
    # Scan only the numeric exports, so the checker cannot match its own patterns.
    for name in ('results.json', 'source-bindings.json'):
        text = (root/name).read_text()
        require(not re.search(r'/home/|/tmp/|https?://|data:image|rtsp://', text), 'private content '+name)
    require(all(p.suffix in ('.md','.json','.py') or p.name == '__pycache__'
                for p in root.iterdir()), 'unexpected public artifact')
    print('CUDA evidence checks passed: parity, queue accounting, runtime scope and publication bounds.')


if __name__ == '__main__':
    check()
