"""Generated metadata-only review probes, using each source tree's own evaluator.

No detector, media, camera, network, installed state or private recordings open.
Run once per checkout, then compare matching input hashes. These generated
cases are regression evidence, not held-out camera accuracy qualification.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New JSON file; never overwritten')
    args = parser.parse_args()
    root = args.source_root.resolve()
    if not (root / 'edge/tracking.py').is_file():
        parser.error('Use a source checkout containing edge/tracking.py')
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output must be a new file')
    sys.path[:0] = [str(root), str(root / 'tests')]
    from edge.evaluation import canonical_hash, digest
    from edge.tracking_evaluation import evaluate_tracking
    from tracking_evaluation_fixtures import make_fixture, obj, prediction, scenarios

    cases = {}
    for name, (truth, predictions) in scenarios().items():
        for fps in (5, 2, 1):
            cases[f'{name}-{fps}hz'] = (truth, predictions, fps)

    # Independent boxes prescribe approach/retreat with changing apparent scale.
    # Detection jitter is specified separately and never uses tracker output.
    truth = [[{'track_id': 'A', 'label': 'person',
               'box': [.15 + i * .003, .2, .08 + i * .001, .16 + i * .002]}]
             for i in range(40)]
    predictions = [[prediction(o) for o in frame] for frame in truth]
    for i, frame in enumerate(predictions):
        frame[0]['box'][0] += (-.003, 0, .003)[i % 3]
    for fps in (5, 2, 1):
        cases[f'scale-jitter-{fps}hz'] = (truth, predictions, fps)

    # Two anonymous objects visit the same place more than the two-second track
    # lifetime apart. The new visitor's first hit is intentionally tentative.
    truth = [[obj('A')], [], [obj('B')], [obj('B')]]
    cases['new-visitor-after-expiry'] = (truth, [[prediction(o) for o in f] for f in truth], 2 / 3)
    measurements = ('TP', 'FP', 'FN', 'IDSW', 'IDTP', 'IDFP', 'IDFN', 'MOTA', 'IDF1', 'HOTA', 'DetA', 'AssA')
    results = {}
    implementation = None
    with tempfile.TemporaryDirectory(prefix='dvr-tracking-review-') as directory:
        for name, (truth, predictions, fps) in cases.items():
            folder = Path(directory) / name
            _, trace = make_fixture(folder, copy.deepcopy(truth), copy.deepcopy(predictions), fps=fps, stride=1)
            report = evaluate_tracking(folder / 'manifest.json')
            assert report['data_kind'] == 'synthetic'
            assert report['qualification']['physical_camera_tracking_accuracy'] == 'unqualified'
            assert trace['tracking']['tracker_sha256'] == digest(root / 'edge/tracking.py')
            if implementation is None:
                implementation = report['metric_implementation']
            results[name] = {
                'input_sha256': canonical_hash({'truth': truth, 'predictions': predictions, 'fps': fps}),
                'frames_scored': report['frames_scored'], 'sample_interval_seconds': 1 / fps,
                'source_sha256': trace['source_sha256'], 'trace_sha256': report['clips'][0]['trace_sha256'],
                'manifest_sha256': report['manifest_sha256'], 'tracker': report['clips'][0]['tracker'],
                'metrics': {key: report['aggregate'][key] for key in measurements},
                'untracked_detections': report['untracked_detection_count'],
            }
    result = {
        'data_kind': 'synthetic', 'qualification': 'NOT_ESTABLISHED',
        'source_revision': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, check=True,
                                           capture_output=True, text=True).stdout.strip(),
        'probe_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'metric_implementation': implementation, 'cases': results,
    }
    with args.output.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(f'Evaluated {len(results)} generated cases; physical-camera accuracy remains unqualified.')


if __name__ == '__main__':
    main()
