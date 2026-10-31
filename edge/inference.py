"""Explicit local execution backends; importing this module loads no GPU runtime."""
from collections import Counter
from contextlib import ExitStack
import hashlib
import importlib
import json
from pathlib import Path
import tempfile

from .model_profiles import YOLOX_PROFILE
from .profiling import profiled

BACKENDS = ('opencv-cpu', 'onnxruntime-cuda')
ORT_VERSION = '1.31.1'
CUDA_OPTIONS = {'device_id': 0, 'use_tf32': 0, 'gpu_mem_limit': 1024**3,
                'arena_extend_strategy': 'kSameAsRequested',
                'cudnn_conv_algo_search': 'HEURISTIC',
                'cudnn_conv_use_max_workspace': '0'}


class OpenCVCpu:
    def __init__(self, model, cv2, np, threads, model_sha256=None):
        # Parse verified bytes, not a path: OpenCV's narrow-path reader misreads
        # non-ASCII Windows profile/%TEMP% paths, and one read binds hash to graph.
        data = Path(model).read_bytes()
        if model_sha256 is not None and hashlib.sha256(data).hexdigest() != model_sha256:
            raise ValueError('The model changed after hash verification')
        self.net = cv2.dnn.readNetFromONNX(np.frombuffer(data, dtype=np.uint8))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.runtime = {'backend': 'OpenCV CPU', 'backend_id': 'opencv-cpu',
                        'threads': threads, 'fallback': 'none'}

    @profiled('native.cpu.run')
    def forward(self, blob):
        self.net.setInput(blob)
        return self.net.forward()

    def close(self):
        self.net = None


class OnnxRuntimeCuda:
    def __init__(self, model, np, threads):
        try:
            ort = importlib.import_module('onnxruntime')
        except ImportError as exc:
            raise ValueError('CUDA backend requires the separate edge/requirements-gpu-qualification.txt environment') from exc
        if ort.__version__ != ORT_VERSION:
            raise ValueError(f'CUDA backend requires onnxruntime-gpu {ORT_VERSION}; use the qualified environment')
        if 'CUDAExecutionProvider' not in ort.get_available_providers():
            raise ValueError('CUDA execution provider unavailable; CPU fallback is disabled')
        ort.preload_dlls(directory='')
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.add_session_config_entry('session.disable_cpu_ep_fallback', '1')
        # Profile one fixed synthetic startup probe, then remove the private
        # temporary file. Recording frames are never sent to this profile.
        self.session = None
        with ExitStack() as cleanup, tempfile.TemporaryDirectory(prefix='intelligent-dvr-cuda-') as directory:
            cleanup.callback(self.close)
            options.enable_profiling = True
            options.profile_file_prefix = str(Path(directory) / 'startup')
            self.session = ort.InferenceSession(str(model), sess_options=options,
                providers=[('CUDAExecutionProvider', dict(CUDA_OPTIONS))],
                enable_fallback=False)
            self.session.disable_fallback()
            if 'CUDAExecutionProvider' not in self.session.get_providers():
                raise ValueError('CUDA provider was not activated; CPU fallback is disabled')
            if self.session.get_session_options().get_session_config_entry('session.disable_cpu_ep_fallback') != '1':
                raise ValueError('CUDA session did not disable CPU graph fallback')
            inputs, outputs = self.session.get_inputs(), self.session.get_outputs()
            if (len(inputs) != 1 or inputs[0].shape != [1, 3, 640, 640]
                    or inputs[0].type != 'tensor(float)' or len(outputs) != 1
                    or outputs[0].shape != [1, 8400, 85] or outputs[0].type != 'tensor(float)'):
                raise ValueError('CUDA backend requires the pinned YOLOX-S FP32 tensor contract')
            self.input_name, self.output_name = inputs[0].name, outputs[0].name
            actual = self.session.get_provider_options().get('CUDAExecutionProvider', {})
            for key, value in CUDA_OPTIONS.items():
                if str(actual.get(key)) != str(value):
                    raise ValueError('CUDA runtime did not retain a required provider setting: '+key)
            self.session.run([self.output_name],
                             {self.input_name: np.zeros((1, 3, 640, 640), dtype=np.float32)})
            profile = Path(self.session.end_profiling())
            if profile.parent.resolve() != Path(directory).resolve() or profile.stat().st_size > 4*1024**2:
                raise ValueError('Invalid or oversized CUDA startup profile')
            raw = profile.read_bytes()
            events = json.loads(raw)
            if not isinstance(events, list):
                raise ValueError('Invalid CUDA startup profile events')
            counts = Counter(e.get('args', {}).get('provider') for e in events
                if isinstance(e, dict) and e.get('cat') == 'Node' and e.get('args', {}).get('provider'))
            if not counts.get('CUDAExecutionProvider') or set(counts) != {'CUDAExecutionProvider'}:
                raise ValueError('CUDA-only node execution was not established; no receipt written')
            self.runtime = {'backend': 'ONNX Runtime CUDA', 'backend_id': 'onnxruntime-cuda',
                'onnxruntime': ort.__version__, 'threads': threads, 'fallback': 'disabled',
                'precision': 'FP32, TF32 disabled', 'provider_options': dict(CUDA_OPTIONS),
                'startup_execution': {'scope': 'One synthetic zero-input startup probe, not per-frame profiling or capacity qualification.',
                    'warmup_runs_excluded': 1, 'node_execution_counts': dict(counts),
                    'profile_sha256': hashlib.sha256(raw).hexdigest()}}
            cleanup.pop_all()

    @profiled('native.cuda.run')
    def forward(self, blob):
        return self.session.run([self.output_name], {self.input_name: blob})[0]

    def close(self):
        self.session = None


def create_backend(name, model, profile, cv2, np, threads, model_sha256=None):
    if name == 'opencv-cpu':
        return OpenCVCpu(model, cv2, np, threads, model_sha256)
    if name == 'onnxruntime-cuda':
        if profile != YOLOX_PROFILE:
            raise ValueError('CUDA backend supports only the hash-bound '+YOLOX_PROFILE+' profile')
        return OnnxRuntimeCuda(model, np, threads)
    raise ValueError('Unknown inference backend')
