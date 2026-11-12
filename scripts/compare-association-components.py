"""Compare exact association work on generated matrices, not camera throughput.

No footage, models, cameras, inference, network, or installed-state changes.
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
BASELINE = 'c517b438789efbe81d410f23f2a0a173ed72c86c'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def matrices():
    n = 300
    isolated = np.ones((n, n))
    np.fill_diagonal(isolated, .1)
    clustered = np.ones((n, n))
    rng = np.random.default_rng(34)
    for start in range(0, n, 3):
        clustered[start:start+3, start:start+3] = rng.uniform(0, .7, (3, 3))
    unbalanced = np.ones((n, n))
    for start in range(0, n, 4):
        unbalanced[start:start+3, start] = [.1, .2, .3]
        unbalanced[start+3, start+1:start+4] = [.3, .2, .1]
    return {'no-feasible-edges': np.ones((n, n)), 'isolated-pairs': isolated,
            'three-object-groups': clustered, 'unbalanced-groups': unbalanced,
            'dense-ambiguous': rng.uniform(0, .7, (n, n))}


def measure(module, cost):
    solver = getattr(module, 'assign_gated', module.assign)
    original = module.assign
    calls = []

    def counted(matrix, limit):
        calls.append(int(matrix.size))
        return original(matrix, limit)

    module.assign = counted
    samples = []
    try:
        # Bind the baseline entry point through the instrumented wrapper, too.
        if not hasattr(module, 'assign_gated'):
            solver = counted
        for repeat in range(4):
            calls.clear()
            began = time.perf_counter()
            pairs, free_rows, free_cols = solver(cost, .8)
            elapsed = (time.perf_counter() - began) * 1000
            if repeat:
                samples.append(elapsed)
        return {'matches': len(pairs), 'total_cost': float(sum(cost[r, c] for r, c in pairs)),
                'unmatched_rows': len(free_rows), 'unmatched_cols': len(free_cols),
                'hungarian_calls': len(calls), 'hungarian_matrix_cells': sum(calls),
                'largest_hungarian_matrix_cells': max(calls, default=0),
                'samples_ms': samples, 'median_ms': statistics.median(samples)}
    finally:
        module.assign = original


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Create a new JSON receipt, never overwrite')
    args = parser.parse_args()
    before = subprocess.run(['git', 'show', f'{BASELINE}:edge/tracking.py'], cwd=ROOT,
                            check=True, capture_output=True).stdout
    path = ROOT/'edge/tracking.py'
    with tempfile.TemporaryDirectory(prefix='dvr-association-') as folder:
        baseline = Path(folder)/'tracking.py'
        baseline.write_bytes(before)
        old, new = load(baseline, 'association_baseline'), load(path, 'association_candidate')
        cases = {}
        for name, cost in matrices().items():
            b, c = measure(old, cost), measure(new, cost)
            assert b['matches'] == c['matches']
            assert abs(b['total_cost'] - c['total_cost']) < 1e-8
            cases[name] = {'shape': list(cost.shape), 'feasible_edges': int((cost <= .8).sum()),
                           'baseline': b, 'candidate': c}
        report = {'data_kind': 'synthetic', 'qualification': 'NOT_ESTABLISHED',
                  'scope': 'Exact assignment only; excludes IoU, detection, tracking updates, capture and transfer.',
                  'baseline_revision': BASELINE, 'baseline_sha256': hashlib.sha256(before).hexdigest(),
                  'candidate_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                  'method': new.METHOD, 'python': platform.python_version(), 'numpy': np.__version__,
                  'platform': platform.platform(), 'cases': cases,
                  'limitations': ['Descriptive local timings, not hardware throughput or concurrent-camera qualification.',
                                  'Tied optimal pair choices can differ while cardinality and cost remain optimal.',
                                  'Dense association and all IoU matrices remain quadratic in storage.']}
    encoded = json.dumps(report, indent=2, allow_nan=False) + '\n'
    if args.output:
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(encoded)
    else:
        print(encoded, end='')


if __name__ == '__main__':
    main()
