"""Bounded per-camera sample scheduling. No capture, inference or worker threads."""
from collections import deque
from dataclasses import dataclass
import math
from threading import Lock
import time
from .profiling import profiled, validate_profile

MINIMUM_CAMERA_TARGET = 100


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


@dataclass(frozen=True)
class Sample:
    camera: str
    sequence: int
    captured_at: float
    payload: bytes


@dataclass(frozen=True)
class Work:
    token: int
    sample: Sample
    dispatched_at: float


class CameraScheduler:
    """One pending and one in-flight sample per camera; shared worker/byte limits.

    A replacement keeps the camera's position in the ready queue. Completing a
    busy camera appends its next sample behind cameras already waiting. Callers
    execute Work and return its token; no execution/cancellation occurs here.
    Explicit times must share a nondecreasing monotonic clock. In threaded use,
    omit now so the monotonic clock is read inside the lock, avoiding races.
    """
    def __init__(self, cameras, workers=8, max_sample_bytes=640*640*3,
                 max_buffer_bytes=128*1024**2, max_age_seconds=2, *, profile=None):
        self._profile = validate_profile(profile)
        cameras = tuple(cameras)
        if (not 1 <= len(cameras) <= 10000 or len(set(cameras)) != len(cameras)
                or any(not isinstance(c, str) or not 1 <= len(c.strip()) <= 80 for c in cameras)):
            raise ValueError('Use 1–10,000 unique explicit camera IDs')
        if not integer(workers, 1, 256):
            raise ValueError('workers must be 1–256')
        if (not integer(max_sample_bytes, 1, 32*1024**2)
                or not integer(max_buffer_bytes, max_sample_bytes, 4*1024**3)
                or not finite(max_age_seconds) or not 0 < max_age_seconds <= 3600):
            raise ValueError('Invalid byte or sample-age limits')
        self.workers = workers
        self.max_sample_bytes = max_sample_bytes
        self.max_buffer_bytes = max_buffer_bytes
        self.max_age_seconds = max_age_seconds
        self._lock = Lock()
        self._pending = {}
        self._ready = deque()
        self._busy = set()
        self._inflight = {}
        self._sequence = {c: -1 for c in cameras}
        self._stats = {c: dict(received=0, accepted=0, replaced=0, stale=0,
                               budget_dropped=0, dispatched=0, completed=0, failed=0)
                       for c in cameras}
        self._bytes = self._peak_bytes = self._peak_pending = self._peak_inflight = 0
        self._now = 0
        self._next_token = 0

    def _clock(self, now):
        if now is None:
            now = time.monotonic()
        if not finite(now) or now < self._now:
            raise ValueError('Use a shared, finite, nondecreasing monotonic clock')
        self._now = now
        return now

    @profiled('scheduler.submit')
    def submit(self, sample, now=None):
        with self._lock:
            now = self._clock(now)
            if not isinstance(sample, Sample) or sample.camera not in self._stats:
                raise ValueError('Unknown camera; explicit admission is required')
            if (not integer(sample.sequence, 0, 2**63-1)
                    or sample.sequence <= self._sequence[sample.camera]
                    or not finite(sample.captured_at) or not 0 <= sample.captured_at <= now
                    or not isinstance(sample.payload, bytes)
                    or not 0 < len(sample.payload) <= self.max_sample_bytes):
                raise ValueError('Invalid, out-of-order or oversized sample')
            camera = sample.camera
            stats = self._stats[camera]
            stats['received'] += 1
            self._sequence[camera] = sample.sequence
            if now-sample.captured_at > self.max_age_seconds:
                stats['stale'] += 1
                return 'stale'
            old = self._pending.get(camera)
            delta = len(sample.payload)-(len(old.payload) if old else 0)
            if self._bytes+delta > self.max_buffer_bytes:
                stats['budget_dropped'] += 1
                return 'budget-dropped'
            self._pending[camera] = sample
            self._bytes += delta
            stats['accepted'] += 1
            if old:
                stats['replaced'] += 1
            elif camera not in self._busy:
                self._ready.append(camera)
            self._peak_bytes = max(self._peak_bytes, self._bytes)
            self._peak_pending = max(self._peak_pending, len(self._pending))
            return 'replaced' if old else 'accepted'

    @profiled('scheduler.dispatch')
    def dispatch(self, now=None):
        with self._lock:
            now = self._clock(now)
            result = []
            while self._ready and len(self._inflight) < self.workers:
                camera = self._ready.popleft()
                sample = self._pending.pop(camera)
                if now-sample.captured_at > self.max_age_seconds:
                    self._stats[camera]['stale'] += 1
                    self._bytes -= len(sample.payload)
                    continue
                self._next_token += 1
                work = Work(self._next_token, sample, now)
                self._inflight[work.token] = work
                self._busy.add(camera)
                self._stats[camera]['dispatched'] += 1
                result.append(work)
            self._peak_inflight = max(self._peak_inflight, len(self._inflight))
            return result

    @profiled('scheduler.complete')
    def complete(self, token, now=None, success=True):
        with self._lock:
            self._clock(now)
            if type(token) is not int or token not in self._inflight or type(success) is not bool:
                raise ValueError('Unknown/completed work token or invalid outcome')
            work = self._inflight.pop(token)
            camera = work.sample.camera
            self._busy.remove(camera)
            self._bytes -= len(work.sample.payload)
            self._stats[camera]['completed' if success else 'failed'] += 1
            if camera in self._pending:
                self._ready.append(camera)

    @profiled('scheduler.snapshot')
    def snapshot(self):
        with self._lock:
            return {'admitted_cameras': len(self._stats), 'workers': self.workers,
                    'pending': len(self._pending), 'inflight': len(self._inflight),
                    'buffered_payload_bytes': self._bytes,
                    'peak_buffered_payload_bytes': self._peak_bytes,
                    'peak_pending': self._peak_pending, 'peak_inflight': self._peak_inflight,
                    'max_sample_bytes': self.max_sample_bytes,
                    'max_buffer_bytes': self.max_buffer_bytes,
                    'max_age_seconds': self.max_age_seconds,
                    'per_camera': {c: dict(stats) for c, stats in self._stats.items()}}
