"""Opt-in live CUDA adapter. Existing offline qualification backend stays frozen."""
import hashlib
import importlib
from pathlib import Path
import sys
import tempfile

from .inference import ORT_VERSION, create_backend as qualified_backend
from .model_profiles import YOLOX_PROFILE

PREFERENCES = ('opencv-cpu', 'cuda-preferred')
CAPABILITY_CODES = ('RUNTIME_UNAVAILABLE', 'RUNTIME_VERSION', 'PROVIDER_UNAVAILABLE', 'STARTUP_EXECUTION_FAILED')


class CudaUnavailable(ValueError):
    def __init__(self, code):
        super().__init__('Live CUDA runtime is unavailable')
        self.code = code


def candidate(preference, profile, platform=None):
    if preference not in PREFERENCES:
        raise ValueError('Unknown live backend preference')
    if preference == 'opencv-cpu':
        return False, 'CPU_DEFAULT'
    if (platform or sys.platform) not in ('linux', 'win32'):
        return False, 'PLATFORM_UNSUPPORTED'
    if profile != YOLOX_PROFILE:
        return False, 'PROFILE_UNSUPPORTED'
    return True, 'CUDA_PROBE_REQUIRED'


def capability():
    """Package/provider discovery is not hardware proof; only startup inference is."""
    try:
        ort = importlib.import_module('onnxruntime')
        if ort.__version__ != ORT_VERSION:
            return {'available': False, 'code': 'RUNTIME_VERSION'}
        if 'CUDAExecutionProvider' not in ort.get_available_providers():
            return {'available': False, 'code': 'PROVIDER_UNAVAILABLE'}
    except Exception:
        return {'available': False, 'code': 'RUNTIME_UNAVAILABLE'}
    return {'available': True, 'code': 'STARTUP_PROBE_REQUIRED'}


def create_cuda(model, expected_sha256, profile, np, threads):
    if profile != YOLOX_PROFILE:
        raise ValueError('Live CUDA requires the pinned YOLOX-S profile')
    # Read once, verify, then parse a private snapshot. Never re-open the catalog
    # path inside ORT. This also handles non-ASCII Windows catalog paths.
    data = Path(model).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError('The model changed after hash verification')
    from .model_profiles import validate_binding
    import json
    labels = json.loads((Path(__file__).parent / 'labels/coco80.json').read_text())
    validate_binding(profile, expected_sha256, labels)
    probe = capability()
    if not probe['available']:
        raise CudaUnavailable(probe['code'])
    with tempfile.TemporaryDirectory(prefix='dvr-live-model-') as directory:
        snapshot = Path(directory) / 'model.onnx'
        with snapshot.open('xb') as stream:
            stream.write(data)
        backend = qualified_backend('onnxruntime-cuda', snapshot, profile, None, np, threads)
    backend.runtime = {**backend.runtime, 'model_sha256': expected_sha256,
                       'model_loading': 'hash-verified private snapshot'}
    return backend
