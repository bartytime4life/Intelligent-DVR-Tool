"""Analyzer backend selection that loads the CPU model from hash-verified bytes.

edge/inference.py stays byte-identical to the revision recorded by the durable
overload evidence; this module only changes how the CPU path reads the model.
"""
import hashlib
from pathlib import Path

from . import inference
from .inference import OpenCVCpu


class VerifiedOpenCVCpu(OpenCVCpu):
    # Parse verified bytes, not a path: OpenCV's narrow-path reader misreads
    # non-ASCII Windows profile/%TEMP% paths, and one read binds hash to graph.
    def __init__(self, model, cv2, np, threads, model_sha256=None):
        data = Path(model).read_bytes()
        if model_sha256 is not None and hashlib.sha256(data).hexdigest() != model_sha256:
            raise ValueError('The model changed after hash verification')
        self.net = cv2.dnn.readNetFromONNX(np.frombuffer(data, dtype=np.uint8))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.runtime = {'backend': 'OpenCV CPU', 'backend_id': 'opencv-cpu',
                        'threads': threads, 'fallback': 'none'}


def create_backend(name, model, profile, cv2, np, threads, model_sha256=None):
    if name == 'opencv-cpu':
        return VerifiedOpenCVCpu(model, cv2, np, threads, model_sha256)
    return inference.create_backend(name, model, profile, cv2, np, threads)
