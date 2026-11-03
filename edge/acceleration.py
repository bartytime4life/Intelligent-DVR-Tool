"""GPU-first service preference and a shared, non-blocking accelerator lease.

No runtime import, device initialization or inference occurs on import/startup.
"""
import threading

DEFAULT_BACKEND = 'cuda-preferred'


class GpuSlot:
    def __init__(self):
        self.lock = threading.Lock()
        self.owner = None
        self.failed = False

    def acquire(self, owner):
        with self.lock:
            if self.failed: return False, 'GPU_DISABLED_AFTER_FAILURE'
            if self.owner is not None: return False, 'GPU_SLOT_BUSY'
            self.owner = owner
            return True, 'CUDA_PROBE_REQUIRED'

    def release(self, owner):
        with self.lock:
            if self.owner == owner: self.owner = None

    def disable(self):
        with self.lock: self.failed = True
