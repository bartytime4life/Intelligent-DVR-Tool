"""Reproduce resizing with generated boxes/JPEGs and the constant-output CPU fixture.

Compare only the tracker against the trusted, immutable merged PR #107 source.
The worker and generated fixture are shared between the two cases. No physical
camera, private recording, model download, installed settings or network opens.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
BASELINE = 'c0aee35c5e634e5bb2949f1002336c2cc3c71078'
sys.path[:0] = [str(ROOT), str(ROOT / 'tests')]


def probe(module):
    import numpy as np
    from edge import tracking
    from test_live_analysis import LiveWorkerTest
    detection = {'label': 'person', 'score': .9, 'box': [.6, .2, .1, .3]}
    tracker = module.Tracker()
    first = tracker.update(0, [detection], 1280, 720)
    second = tracker.update(.1, [detection], 640, 360)
    direct = {'ids': [first, second], 'active': tracker.active()}
    sizes = [(320, 240), (640, 480), (160, 120), (960, 720)]
    fixture = LiveWorkerTest()
    fixture.setUp()
    try:
        model = fixture.root / 'fixture.onnx'
        model_hash = hashlib.sha256(model.read_bytes()).hexdigest()
        frames = [np.full((h, w, 3), 80, dtype=np.uint8) for w, h in sizes]
        with patch.object(tracking, 'Tracker', module.Tracker):
            replies = fixture.run_worker(model, frames)
        native = [{key: reply[key] for key in ('width', 'height', 'detector', 'detections', 'tracks')}
                  for reply in replies[1:]]
        return {'method': module.METHOD, 'direct': direct, 'model_sha256': model_hash,
                'runtime': replies[0]['runtime'], 'native': native}
    finally:
        fixture.tearDown()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New JSON file; never overwritten')
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output must be a new file')
    old = subprocess.run(['git', 'show', f'{BASELINE}:edge/tracking.py'], cwd=ROOT,
                         check=True, capture_output=True).stdout
    from edge import tracking
    with tempfile.TemporaryDirectory(prefix='dvr-resize-baseline-') as directory:
        path = Path(directory) / 'tracking.py'
        path.write_bytes(old)
        spec = importlib.util.spec_from_file_location('dvr_resize_baseline', path)
        baseline = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = baseline
        spec.loader.exec_module(baseline)
        report = {'data_kind': 'synthetic', 'qualification': 'NOT_ESTABLISHED',
                  'baseline_revision': BASELINE, 'baseline_tracker_sha256': hashlib.sha256(old).hexdigest(),
                  'candidate_tracker_sha256': hashlib.sha256((ROOT / 'edge/tracking.py').read_bytes()).hexdigest(),
                  'worker_sha256': hashlib.sha256((ROOT / 'edge/live_worker.py').read_bytes()).hexdigest(),
                  'probe_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'baseline': probe(baseline), 'candidate': probe(tracking)}
    assert report['baseline']['model_sha256'] == report['candidate']['model_sha256']
    with args.output.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
