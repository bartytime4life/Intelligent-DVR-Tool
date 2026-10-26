"""Bounded offline ONNX contract smoke test. Uses synthetic pixels, never cameras.

This is compatibility evidence only, not recognition, licensing approval or a
deployment benchmark. Linux process limits are not a security sandbox.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

from .analyze import decode, digest
from .model_profiles import PROFILES, DEFAULT_PROFILE, YOLOX_PROFILE, validate_binding, prepare


def inspect_graph(path, profile, labels):
    import onnx
    from onnx import TensorProto
    model = onnx.load(str(path), load_external_data=False)
    if any(t.data_location == TensorProto.EXTERNAL for t in model.graph.initializer):
        raise ValueError('External-data models are unsupported')
    if any(n.domain not in ('', 'ai.onnx') for n in model.graph.node):
        raise ValueError('Custom operator domains are unsupported')
    if any(n.op_type == 'NonMaxSuppression' for n in model.graph.node):
        raise ValueError('Embedded NMS is unsupported')
    initializers = {t.name for t in model.graph.initializer}
    inputs = [v for v in model.graph.input if v.name not in initializers]
    outputs = list(model.graph.output)
    def shape(value):
        return [d.dim_value if d.HasField('dim_value') else None
                for d in value.type.tensor_type.shape.dim]
    if (len(inputs) != 1 or len(outputs) != 1
            or inputs[0].type.tensor_type.elem_type != TensorProto.FLOAT
            or outputs[0].type.tensor_type.elem_type != TensorProto.FLOAT
            or shape(inputs[0]) != [1, 3, 640, 640]):
        raise ValueError('Require one static float32 input [1,3,640,640] and one float32 output')
    actual = shape(outputs[0])
    if profile == YOLOX_PROFILE:
        if actual != [1, 8400, 85]:
            raise ValueError('Pinned YOLOX output must be [1,8400,85]')
    elif (len(actual) != 3 or actual[:2] != [1, 4 + len(labels)]
          or actual[2] is None or not 1 <= actual[2] <= 100000):
        raise ValueError('Require static YOLOv8 raw output [1,4+C,N], 1 <= N <= 100000')
    onnx.checker.check_model(model)
    return {'input': {'name': inputs[0].name, 'shape': shape(inputs[0])},
            'output': {'name': outputs[0].name, 'shape': actual},
            'opsets': [{'domain': o.domain, 'version': o.version} for o in model.opset_import],
            'nodes': len(model.graph.node)}


def worker(args):
    # Apply limits before native runtimes load or the ONNX parser sees a file.
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (args.memory_mib * 1024**2,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (args.timeout_seconds, args.timeout_seconds + 1))
    import cv2
    import numpy as np
    import onnx
    labels = json.loads(args.labels.read_text())
    model_hash = digest(args.model)
    validate_binding(args.profile, model_hash, labels)
    graph = inspect_graph(args.model, args.profile, labels)
    cv2.setNumThreads(args.threads)
    net = cv2.dnn.readNetFromONNX(str(args.model))
    net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
    rng = np.random.default_rng(20261026)
    probes = [('black', np.zeros((240, 320, 3), dtype=np.uint8)),
              ('gray', np.full((240, 320, 3), 127, dtype=np.uint8)),
              ('seeded-noise', rng.integers(0, 256, (239, 317, 3), dtype=np.uint8))]
    results = []
    for name, frame in probes:
        blob, scale, padding = prepare(frame, args.profile, cv2, np)
        start = time.perf_counter()
        net.setInput(blob)
        raw = net.forward()
        observations = decode(raw, labels, frame.shape, scale, padding, cv2, np, args.profile)
        elapsed = (time.perf_counter() - start) * 1000
        results.append({'probe': name, 'output_shape': list(raw.shape),
                        'output_dtype': str(raw.dtype), 'finite': bool(np.isfinite(raw).all()),
                        'decoded_observations': len(observations), 'inference_decode_ms': elapsed})
    return {'graph': graph, 'probes': results, 'model_sha256': model_hash,
            'labels_sha256': digest(args.labels),
            'runtime': {'python': platform.python_version(), 'opencv': cv2.__version__,
                        'numpy': np.__version__, 'onnx': onnx.__version__,
                        'backend': 'OpenCV CPU', 'threads': args.threads,
                        'machine': platform.machine(),
                        'peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}}


def run_bounded(args):
    command = [sys.executable, '-m', 'edge.qualify', '--_worker',
               '--model', str(args.model), '--labels', str(args.labels),
               '--profile', args.profile, '--memory-mib', str(args.memory_mib),
               '--timeout-seconds', str(args.timeout_seconds), '--threads', str(args.threads)]
    env = dict(os.environ)
    for key in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS'):
        env[key] = str(args.threads)
    report = {'schema': 'intelligent-dvr.model-compatibility.v1',
              'state': 'failed', 'profile': args.profile,
              'model_sha256': digest(args.model), 'labels_sha256': digest(args.labels),
              'scope': 'synthetic-input contract smoke test only',
              'recognition_accuracy': 'unmeasured', 'operational_use': 'not_qualified',
              'limits': {'wall_seconds': args.timeout_seconds, 'address_space_mib': args.memory_mib},
              'limitations': ['No representative footage, labels, precision/recall or camera test.',
                              'Process limits are not filesystem/network isolation or a security sandbox.',
                              'Local CPU probe timings are not real-time or five-camera performance.']}
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        try:
            process = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                     env=env, timeout=args.timeout_seconds, check=False)
            out.seek(0)
            result = out.read(1024 * 1024 + 1)
            if process.returncode != 0:
                report['error'] = f'Worker failed (exit {process.returncode}); no compatibility pass'
            elif len(result) > 1024 * 1024:
                report['error'] = 'Worker output exceeded bound'
            else:
                report.update(json.loads(result))
                report['state'] = 'contract-smoke-passed'
        except subprocess.TimeoutExpired:
            report['state'] = 'timeout'
            report['error'] = 'Worker killed at wall-time bound'
        except (ValueError, UnicodeError):
            report['error'] = 'Worker did not return valid bounded JSON'
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--labels', type=Path, required=True)
    parser.add_argument('--profile', choices=PROFILES, default=DEFAULT_PROFILE)
    parser.add_argument('--output', type=Path, help='New report path; never overwritten')
    parser.add_argument('--timeout-seconds', type=int, default=45)
    parser.add_argument('--memory-mib', type=int, default=2048)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--_worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if sys.platform != 'linux':
        parser.error('This bounded qualification runner requires Linux process limits')
    if not 1 <= args.timeout_seconds <= 120 or not 512 <= args.memory_mib <= 8192 or not 1 <= args.threads <= 8:
        parser.error('Bounds: timeout 1–120 seconds, memory 512–8192 MiB, threads 1–8')
    for path, limit in [(args.model, 128 * 1024**2), (args.labels, 64 * 1024)]:
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
            parser.error('Require bounded local regular model/labels files; no symlinks or streams')
    try:
        validate_binding(args.profile, digest(args.model), json.loads(args.labels.read_text()))
    except (ValueError, UnicodeError) as error:
        parser.error(str(error))
    if args._worker:
        print(json.dumps(worker(args), allow_nan=False))
        return 0
    if args.output is None or args.output.exists() or args.output.is_symlink():
        parser.error('Require --output with a new report path')
    with args.output.open('x', encoding='utf-8') as stream:
        report = run_bounded(args)
        json.dump(report, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print(f'{report["state"]}; compatibility only; recognition accuracy unmeasured.')
    return 0 if report['state'] == 'contract-smoke-passed' else 1


if __name__ == '__main__':
    sys.exit(main())
