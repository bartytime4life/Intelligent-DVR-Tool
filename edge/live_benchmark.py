"""Reproducible live CPU/CUDA smoke measurement on generated pixels, never cameras.

Requires an existing pinned YOLOX-S model. Uses the production Live supervisor,
worker isolation, limits and fallback. A CPU fallback is never timed as a GPU.
Writes metadata, timings and detection agreement only; no images or local paths.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import statistics
import sys
import tempfile
import time

from .live_analysis import Live, LiveError
from .model_profiles import YOLOX_PROFILE, validate_binding

ROOT = Path(__file__).resolve().parents[1]


def agreement(left, right, tolerance=1e-4):
    """Decoded boxes/scores/class parity only, not identity or detector accuracy."""
    if len(left) != len(right):
        return False
    for a, b in zip(left, right):
        ad, bd = a['detections'], b['detections']
        if len(ad) != len(bd) or a['detector'] != b['detector']:
            return False
        for x, y in zip(ad, bd):
            if (x['label'] != y['label'] or not all(math.isfinite(v) for v in (x['score'], y['score']))
                    or abs(x['score'] - y['score']) > tolerance):
                return False
            if (len(x['box']) != 4 or len(y['box']) != 4 or
                    any(not math.isfinite(i) or not math.isfinite(j) or abs(i - j) > tolerance
                        for i, j in zip(x['box'], y['box']))):
                return False
    return True


def summary(values):
    values = sorted(values)
    return {'samples': len(values), 'median_ms': round(statistics.median(values), 3),
            'p95_ms': round(values[max(0, math.ceil(len(values) * .95) - 1)], 3),
            'min_ms': round(values[0], 3), 'max_ms': round(values[-1], 3)}


def measure(model, count=12):
    if not 3 <= count <= 30:
        raise ValueError('Use 3–30 generated frames')
    import cv2
    import numpy as np
    candidate = json.loads((ROOT / 'edge/candidates' / (YOLOX_PROFILE + '.json')).read_text())
    # Reject before any native parsing or child start; the worker verifies again.
    digest = hashlib.sha256(Path(model).read_bytes()).hexdigest()
    labels_file = ROOT / 'edge/labels/coco80.json'
    labels_data = labels_file.read_bytes()
    labels = json.loads(labels_data)
    validate_binding(YOLOX_PROFILE, digest, labels)
    if digest != candidate['model_sha256']:
        raise ValueError('Use the pinned YOLOX-S model')
    rng = np.random.default_rng(20261102)
    frames = []
    for index in range(count):
        # Large brightness changes keep the motion gate open for every frame.
        frame = rng.integers(0, 50, (240, 320, 3), dtype=np.uint8) + (30 if index % 2 == 0 else 170)
        frames.append(cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes())
    report = {'schema': 'intelligent-dvr.live-backend-smoke.v1', 'captured_at': datetime.now(timezone.utc).isoformat(),
              'platform': sys.platform, 'machine': platform.machine(), 'python': platform.python_version(),
              'cpu_logical': os.cpu_count(), 'opencv': cv2.__version__, 'numpy': np.__version__,
              'model_sha256': digest, 'labels_sha256': hashlib.sha256(labels_data).hexdigest(),
              'input': {'kind': 'generated pixels, no cameras', 'seed': 20261102, 'width': 320, 'height': 240,
                        'frame_sha256': [hashlib.sha256(f).hexdigest() for f in frames]},
              'scope': 'One bounded worker at a time on generated JPEGs. Inference includes forward and detection decode/NMS. No physical-camera, tracking-quality, sustained-load or capacity qualification.',
              'source_sha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in
                  ('edge/live_analysis.py', 'edge/live_worker.py', 'edge/live_backend.py', 'edge/live_resources.py',
                   'edge/live_benchmark.py', 'edge/cpu_backend.py', 'edge/inference.py', 'edge/model_profiles.py', 'edge/tracking.py')}}
    replies = {}
    with tempfile.TemporaryDirectory(prefix='dvr-live-benchmark-') as directory:
        rules_file = Path(directory) / 'rules.json'
        rules_data = b'[{"name":"presence","label":"person","rect":[0,0,1,1]}]'
        rules_file.write_bytes(rules_data)
        catalog = {'models': {'model': {'id': 'model', 'name': 'Pinned YOLOX-S', 'path': Path(model),
                    'sha256': digest, 'profile': YOLOX_PROFILE, 'labels': labels_file,
                    'labels_sha256': hashlib.sha256(labels_data).hexdigest(), 'classes': labels}},
                   'rules': {'rules': {'id': 'rules', 'name': 'Presence', 'path': rules_file,
                    'sha256': hashlib.sha256(rules_data).hexdigest(), 'summary': 'Generated-pixel smoke', 'classes': ['person']}}}
        for key, preference in (('cpu', 'opencv-cpu'), ('cuda', 'cuda-preferred')):
            live = Live(catalog, backend=preference)
            try:
                session = live.start({'model': 'model', 'rules': 'rules', 'camera': 'Generated-pixel probe'})
                runtime = session.get('runtime') or {}
                record = {'status': 'measured' if session['state'] == 'live' else 'failed',
                          'runtime': runtime, 'acceleration': session['acceleration'],
                          'load_ms': session['load_ms'], 'error': session['error']}
                report[key] = record
                if session['state'] != 'live':
                    continue
                if key == 'cuda' and runtime.get('backend_id') != 'onnxruntime-cuda':
                    record['status'] = 'unavailable'
                    reply = live.frame(session['id'], frames[0])
                    record['cpu_fallback_frame'] = {'state': reply['type'], 'runtime': reply['session']['runtime'],
                                                    'inference_ms': reply['timing']['inference_ms']}
                    continue
                rows, round_trips = [], []
                for frame in frames:
                    began = time.perf_counter()
                    rows.append(live.frame(session['id'], frame))
                    round_trips.append((time.perf_counter() - began) * 1000)
                if any(r['detector'] != 'ran' for r in rows):
                    raise ValueError('Smoke input unexpectedly skipped inference')
                record.update(inference=summary([r['timing']['inference_ms'] for r in rows]),
                              worker_total=summary([r['timing']['total_ms'] for r in rows]),
                              parent_round_trip=summary(round_trips),
                              detections_per_frame=[r['detections_total'] for r in rows])
                replies[key] = rows
            except LiveError as error:
                record.update(status='failed', error={'code': error.code})
            finally:
                live.close()
    if 'cpu' in replies and 'cuda' in replies:
        report['decoded_agreement'] = {'passed': agreement(replies['cpu'], replies['cuda']), 'absolute_tolerance': 1e-4,
            'scope': 'Generated-pixel decoded detections only; raw tensors, representative object/track accuracy and identity are not qualified.'}
        report['median_inference_speed_ratio_cpu_over_cuda'] = round(
            report['cpu']['inference']['median_ms'] / report['cuda']['inference']['median_ms'], 3)
    else:
        report['decoded_agreement'] = {'status': 'not_measured', 'reason': 'Both actual backends must run; fallback is not GPU evidence.'}
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True, type=Path, help='Existing pinned YOLOX-S; never downloaded')
    parser.add_argument('--frames', type=int, default=12)
    parser.add_argument('--output', required=True, type=Path, help='New JSON receipt, never overwritten')
    args = parser.parse_args(argv)
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output already exists')
    try:
        report = measure(args.model, args.frames)
        with args.output.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, indent=2, allow_nan=False)
            stream.write('\n')
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print('CPU:', report['cpu']['status'], '| CUDA:', report['cuda']['status'], '| See the saved receipt and its scope.')
    return 0 if report['cpu']['status'] == 'measured' else 1


if __name__ == '__main__':
    sys.exit(main())
