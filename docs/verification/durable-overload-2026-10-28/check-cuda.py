"""Synthetic-only CUDA admission; never reads recordings or changes the host.

Run with the existing pinned environment and process-local offline guard.
Exit 2 means blocked admission, not successful CPU fallback or capacity proof.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from edge.evaluation import local_file
from edge.inference import create_backend
from edge.model_profiles import YOLOX_PROFILE, validate_binding


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    local_file(args.model)
    digest = hashlib.sha256(args.model.read_bytes()).hexdigest()
    labels = json.loads((ROOT/'edge/labels/coco80.json').read_text())
    validate_binding(YOLOX_PROFILE, digest, labels)
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        import numpy as np
        import onnxruntime as ort
        result = dict(scope='Synthetic startup admission only; not recording or capacity evidence',
            model_sha256=digest, onnxruntime=ort.__version__, requested_backend='onnxruntime-cuda',
            available_providers=ort.get_available_providers(), fallback_policy_requested='disabled',
            cpu_fallback_used=False, recording_frames_processed=0,
            visible_gpu_device_nodes=len(list(Path('/dev').glob('nvidia[0-9]*'))),
            source_sha256={n:hashlib.sha256((ROOT/'edge'/n).read_bytes()).hexdigest() for n in
                           ('journal.py','supervision.py','scheduler.py','inference.py')})
        backend = None
        try:
            backend = create_backend('onnxruntime-cuda', args.model, YOLOX_PROFILE, None, np, 4)
            result.update(status='admitted', runtime=backend.runtime)
        except Exception as exc:
            import re
            code = re.search(r'CUDA failure (\d+)', str(exc))
            result.update(status='blocked', error_type=type(exc).__name__,
                cuda_failure_code=int(code[1]) if code else None,
                reason='No CUDA-capable device detected' if code and code[1]=='100' else 'Runtime admission failed')
        finally:
            if backend is not None:
                backend.close()
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(result['status'], result.get('reason', 'Synthetic proof only'))
    return 0 if result['status'] == 'admitted' else 2


if __name__ == '__main__':
    raise SystemExit(main())
