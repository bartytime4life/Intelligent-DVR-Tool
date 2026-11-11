"""Compare deterministic, generated tracker inputs with an immutable Git baseline.

No recordings, cameras, models, inference, network, or installed-state changes.
Timing is a local descriptive sample, never camera throughput or qualification.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import tempfile
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '914f0649b671e31879e5870808959a393dd004db'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def detection(i=0, classes=1):
    return {'label': f'class-{i % classes}', 'score': .9,
            'box': [(i % 30) * .03, (i // 30) * .05, .02, .04]}


def association(module, classes):
    measurements, last_cells = [], None
    boxes = [detection(i, classes) for i in range(300)]
    original = module.assign
    cells = []
    def counted(cost, limit):
        cells.append(int(cost.size))
        return original(cost, limit)
    module.assign = counted
    try:
        for repeat in range(8):
            tracker = module.Tracker()
            tracker.update(0, boxes, 1280, 720)
            cells.clear()
            started = time.perf_counter()
            ids = tracker.update(.1, boxes[::-1], 1280, 720)
            elapsed = (time.perf_counter() - started) * 1000
            assert ids == list(range(300, 0, -1))
            if repeat:  # One warm-up, seven descriptive samples.
                measurements.append(elapsed)
            last_cells = list(cells)
    finally:
        module.assign = original
    return {'objects': 300, 'classes': classes, 'matrix_cells': sum(last_cells),
            'largest_matrix_cells': max(last_cells), 'samples': len(measurements),
            'median_update_ms': statistics.median(measurements)}


def check(module):
    tracker = module.Tracker(module.TrackerConfig(max_lost_seconds=1))
    tracker.update(0, [detection()], 1280, 720)
    expired_id = tracker.update(3, [detection()], 1280, 720)
    tracker = module.Tracker()
    for k in range(2101):
        tracker.update(k / 10, [detection()], 1280, 720)
    summary = tracker.finish()['tracks'][0]
    kalman = module.Kalman()
    mean, cov = kalman.initiate(kalman.measure([100, 100, 80, 200]))
    _, whole = kalman.predict(mean, cov, 10)
    mean, cov = kalman.predict(mean, cov, 4)
    _, split = kalman.predict(mean, cov, 6)
    return {'method': module.METHOD, 'expired_gap_returned_ids': expired_id,
            'path_end_seconds': summary['path'][-1][0], 'last_observation_seconds': summary['last_seconds'],
            'median_of_1_and_9_seconds': module.class_summary([
                {'label': 'person', 'duration_seconds': d} for d in (1, 9)])['person']['median_duration_seconds'],
            'max_abs_covariance_partition_error': float(np.max(np.abs(whole - split))),
            'association': {str(c): association(module, c) for c in (1, 10)}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Create a new JSON receipt (never overwrite)')
    args = parser.parse_args()
    baseline = subprocess.run(['git', 'show', f'{BASELINE}:edge/tracking.py'], cwd=ROOT,
                              check=True, capture_output=True).stdout
    candidate = ROOT / 'edge/tracking.py'
    with tempfile.TemporaryDirectory(prefix='dvr-tracker-comparison-') as directory:
        old_path = Path(directory) / 'tracking.py'
        old_path.write_bytes(baseline)
        report = {'data_kind': 'synthetic', 'qualification': 'NOT_ESTABLISHED',
                  'baseline_revision': BASELINE, 'python': platform.python_version(),
                  'numpy': np.__version__, 'platform': platform.platform(),
                  'baseline_sha256': hashlib.sha256(baseline).hexdigest(),
                  'candidate_sha256': hashlib.sha256(candidate.read_bytes()).hexdigest(),
                  'baseline': check(load(old_path, 'dvr_tracking_baseline')),
                  'candidate': check(load(candidate, 'dvr_tracking_candidate'))}
    encoded = json.dumps(report, indent=2, allow_nan=False) + '\n'
    if args.output:
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(encoded)
    else:
        print(encoded, end='')


if __name__ == '__main__':
    main()
