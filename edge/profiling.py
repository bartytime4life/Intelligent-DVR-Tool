"""Opt-in bounded timing aggregates; never samples, IDs, paths or results.

Inclusive wall-clock spans can overlap. Native forward includes runtime/copy
costs, not just device kernels. Fixed power-of-two nanosecond histograms.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from threading import Lock
import time

PHASES = frozenset('''journal.reserve journal.finish journal.pending journal.ack
journal.prune journal.snapshot journal.serialize journal.hash journal.sqlite.query
journal.sqlite.execute journal.sqlite.commit scheduler.submit scheduler.dispatch
scheduler.complete scheduler.snapshot parent.step parent.serialize parent.deserialize
parent.ipc.read parent.ipc.write parent.delivery child.processor child.queue
child.serialize child.deserialize child.ipc.read child.ipc.write child.wait
native.cpu.run native.cuda.run'''.split())
BUCKETS = 48
LIMIT = 2**63-1
WIRE_LIMIT = 64*1024
_ACTIVE = ContextVar('dvr_profile', default=None)


class BoundedProfile:
    """Fixed phase set, 48 buckets/phase, saturated counters; thread safe."""
    def __init__(self):
        self._lock = Lock()
        self._rows = {}

    def record(self, phase, ns):
        if phase not in PHASES or type(ns) is not int or not 0 <= ns <= LIMIT:
            raise ValueError('Invalid bounded timing')
        with self._lock:
            row = self._rows.setdefault(phase, [0, 0, 0, [0]*BUCKETS])
            row[0] = min(LIMIT, row[0]+1)
            row[1] = min(LIMIT, row[1]+ns)
            row[2] = max(row[2], ns)
            bucket = min(BUCKETS-1, ns.bit_length())
            row[3][bucket] = min(LIMIT, row[3][bucket]+1)

    def snapshot(self):
        with self._lock:
            return {name: [r[0], r[1], r[2], list(r[3])] for name, r in self._rows.items()}

    @staticmethod
    def validate(rows):
        if not isinstance(rows, dict) or not set(rows) <= PHASES:
            raise ValueError('Invalid timing phases')
        for row in rows.values():
            if (not isinstance(row, list) or len(row) != 4 or
                    not isinstance(row[3], list) or len(row[3]) != BUCKETS or
                    any(type(n) is not int or not 0 <= n <= LIMIT for n in row[:3]+row[3]) or
                    min(LIMIT, sum(row[3])) != row[0] or row[2] > row[1]):
                raise ValueError('Invalid timing aggregate')
        return rows


def validate_profile(profile):
    if profile is not None and not isinstance(profile, BoundedProfile):
        raise ValueError('Use an explicit BoundedProfile or None')
    return profile


@contextmanager
def activate(profile):
    token = _ACTIVE.set(profile)
    try:
        yield
    finally:
        _ACTIVE.reset(token)


@contextmanager
def measure(profile, phase):
    if profile is None:
        yield
        return
    began = time.perf_counter_ns()
    try:
        yield
    finally:
        profile.record(phase, min(LIMIT, time.perf_counter_ns()-began))


def profiled(phase):
    def decorate(method):
        @wraps(method)
        def call(self, *args, **kwargs):
            profile = getattr(self, '_profile', None) or _ACTIVE.get()
            if profile is None:
                return method(self, *args, **kwargs)
            with measure(profile, phase):
                return method(self, *args, **kwargs)
        return call
    return decorate
