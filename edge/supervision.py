"""Optional Linux process supervision for bounded, side-effect-free local processors.

Only trusted application factories are pickled by multiprocessing's spawn path.
Samples/results use bounded bytes/JSON over an anonymous local pipe, never pickle.
No capture, network service, model selection or CPU fallback is provided here.
"""
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import copy
import json
import multiprocessing as mp
from multiprocessing.reduction import ForkingPickler
import os
import select
import struct
import sys
import time

from .scheduler import CameraScheduler, Sample, finite, integer
from .workers import Outcome
from .journal import OutcomeJournal, JournalError
from .profiling import (BoundedProfile, WIRE_LIMIT, activate, measure, profiled,
                        validate_profile)

PROTOCOL = 1
META_LIMIT = 2048


class ProcessFailure(RuntimeError):
    def __init__(self, code, generation, message=''):
        self.code, self.generation = code, generation
        super().__init__(f'{code} (generation {generation})'+(': '+message if message else ''))


@dataclass(frozen=True)
class ProcessOutcome(Outcome):
    generation: int
    processor: int | None
    journal_id: int | None = None


def _json(value):
    return json.dumps(value, separators=(',', ':'), allow_nan=False).encode()


def _frame(body):
    return struct.pack('!I', len(body))+body


def _read_exact(fd, count):
    data = bytearray()
    while len(data) < count:
        part = os.read(fd, count-len(data))
        if not part:
            raise EOFError('Local processor pipe closed')
        data.extend(part)
    return bytes(data)


def _send(fd, value, limit, profile=None):
    if profile is None:
        body = _json(value)
    else:
        with measure(profile, 'child.serialize'):
            body = _json(value)
    if len(body) > limit:
        raise ValueError('result-too-large')
    view = memoryview(_frame(body))
    while view:
        if profile is None:
            count = os.write(fd, view)
        else:
            with measure(profile, 'child.ipc.write'):
                count = os.write(fd, view)
        if not count:
            raise EOFError('Local processor pipe closed')
        view = view[count:]


def _run_processor(processor, sample, profile, queued_ns):
    profile.record('child.queue', time.perf_counter_ns()-queued_ns)
    with activate(profile), measure(profile, 'child.processor'):
        return processor(sample)


def _child_main(connection, factory, count, generation, request_limit, result_limit, profiling=False):
    """One owned process, independent processors, at most one call per slot."""
    fd = connection.fileno()
    processors, active, executor = [], {}, None
    envelope = {'v': PROTOCOL, 'generation': generation}
    profile = BoundedProfile() if profiling else None
    responses = 0

    def report(final=False):
        if profile is not None:
            _send(fd, {**envelope, 'kind': 'profile', 'timings': profile.snapshot(), 'final': final}, WIRE_LIMIT)

    try:
        for slot in range(count):
            processor = factory(slot, generation)
            if not callable(processor):
                raise ValueError('Factory must return a callable processor')
            processors.append(processor)
        executor = ThreadPoolExecutor(max_workers=count, thread_name_prefix='dvr-isolated')
        _send(fd, {**envelope, 'kind': 'ready', 'processors': count,
                   'metadata': [getattr(p, 'runtime', {}) for p in processors]}, result_limit)
        last_token = 0
        while True:
            for slot, (token, future) in list(active.items()):
                if not future.done():
                    continue
                del active[slot]
                try:
                    result = future.result()
                    _send(fd, {**envelope, 'kind': 'result', 'token': token, 'processor': slot,
                               'ok': True, 'value': result}, result_limit, profile)
                except Exception as exc:
                    code = 'result-too-large' if str(exc) == 'result-too-large' else 'processor-error'
                    _send(fd, {**envelope, 'kind': 'result', 'token': token, 'processor': slot,
                               'ok': False, 'code': code, 'message': str(exc)[:200]}, result_limit, profile)
                responses += 1
                if responses % 64 == 0:
                    report()
            with measure(profile, 'child.wait'):
                readable = select.select([fd], [], [], .001)[0]
            if not readable:
                continue
            with measure(profile, 'child.ipc.read'):
                size = struct.unpack('!I', _read_exact(fd, 4))[0]
            if not 4 <= size <= request_limit:
                raise ValueError('Invalid request size')
            with measure(profile, 'child.ipc.read'):
                body = _read_exact(fd, size)
            meta_size = struct.unpack('!I', body[:4])[0]
            if not 1 <= meta_size <= META_LIMIT or meta_size > len(body)-4:
                raise ValueError('Invalid request metadata')
            with measure(profile, 'child.deserialize'):
                meta = json.loads(body[4:4+meta_size])
            if (type(meta.get('generation')) is not int or meta['generation'] != generation
                    or type(meta.get('v')) is not int or meta['v'] != PROTOCOL):
                raise ValueError('Invalid request generation')
            if meta.get('kind') == 'stop':
                if active:
                    raise ValueError('Stop request while processors are busy')
                report(final=True)
                break
            token = meta.get('token')
            if (meta.get('kind') != 'work' or type(token) is not int or token <= last_token
                    or len(active) >= count):
                raise ValueError('Invalid or unbounded request admission')
            payload = body[4+meta_size:]
            if not payload:
                raise ValueError('Empty request payload')
            last_token = token
            slot = next(i for i in range(count) if i not in active)
            sample = Sample(meta['camera'], meta['sequence'], meta['captured_at'], payload)
            if profile is None:
                active[slot] = token, executor.submit(processors[slot], sample)
            else:
                active[slot] = token, executor.submit(_run_processor, processors[slot], sample,
                                                      profile, time.perf_counter_ns())
    except (EOFError, BrokenPipeError):
        pass
    except Exception as exc:
        try:
            _send(fd, {**envelope, 'kind': 'fatal', 'code': 'worker-error',
                       'message': str(exc)[:200]}, result_limit)
        except Exception:
            pass
    finally:
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)
        if all(f.done() for _, f in active.values()):
            for processor in processors:
                try:
                    close = getattr(processor, 'close', None)
                    if callable(close):
                        close()
                except Exception:
                    pass
        connection.close()


def _owned_child(parent_pid, target, *args):
    """Arm Linux parent-death SIGKILL before constructing trusted native state.

    prctl applies to this process's actual parent. Recheck after arming to cover
    parent death during spawn/bootstrap; a changed parent must never run work.
    """
    import ctypes
    import signal
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    prctl.restype = ctypes.c_int
    if prctl(1, signal.SIGKILL, 0, 0, 0) != 0:  # PR_SET_PDEATHSIG from linux/prctl.h
        raise OSError(ctypes.get_errno(), 'Cannot arm owned-worker parent-death cleanup')
    if os.getppid() != parent_pid:
        os._exit(72)
    target(*args)


class ProcessWorkers:
    """Linux-only opt-in process boundary, polled by one controlling thread.

    factory(slot, generation) constructs each independent processor in a spawned
    child. Factories are trusted, importable, small application objects; never
    accept one from a receipt/browser. Processor results must be finite JSON.
    Processors must have no external side effects: a computed but unreceived
    result is an explicit failure if its process dies. Failed samples are never
    retried. Pending newest samples retain scheduler age/byte/order semantics.

    step() owns dispatch/completion and returns all received/failed Outcomes.
    Deadlines include IPC and collection, and are enforced when step() is polled.
    A failed generation is reaped before an explicitly budgeted restart. close()
    stops dispatch/restarts, drains up to its timeout, then terminates owned work.
    OS termination/reaping has a bounded wait; an unreaped child disables restart
    and remains visible. This is not a host memory quota or an OS-level watchdog.
    """
    def __init__(self, scheduler, factory, *, startup_timeout=30., task_timeout=5.,
                 max_restarts=0, restart_delay=.25, max_result_bytes=1024**2, journal=None,
                 profile=None):
        self._profile = validate_profile(profile)
        self._child_profiles = {}
        self._profile_final = {}
        if sys.platform != 'linux':
            raise ValueError('ProcessWorkers is currently qualified and enabled only on Linux')
        if (not isinstance(scheduler, CameraScheduler) or not 1 <= scheduler.workers <= 4
                or scheduler.snapshot()['inflight'] or not callable(factory)):
            raise ValueError('Use a fresh scheduler with 1–4 slots and an explicit trusted factory')
        if (not finite(startup_timeout) or not .1 <= startup_timeout <= 120
                or not finite(task_timeout) or not .05 <= task_timeout <= 120
                or not finite(restart_delay) or not 0 <= restart_delay <= 10
                or not integer(max_restarts, 0, 3)
                or not integer(max_result_bytes, 512, 4*1024**2)):
            raise ValueError('Invalid deadline, restart or result-byte bounds')
        try:
            if len(ForkingPickler.dumps(factory)) > 65536:
                raise ValueError('Factory configuration exceeds 64 KiB')
        except Exception as exc:
            raise ValueError('Factory must be a small spawn-serializable trusted application object') from exc
        if journal is not None:
            if not isinstance(journal, OutcomeJournal):
                raise ValueError('Use an explicit owner-local OutcomeJournal')
            journal.attach(scheduler.workers, max_result_bytes)
        self.journal, self._journal_error, self._journal_blocked = journal, None, False
        self.scheduler, self.factory = scheduler, factory
        self.startup_timeout, self.task_timeout = startup_timeout, task_timeout
        self.max_restarts, self.restart_delay = max_restarts, restart_delay
        self.max_result_bytes = max_result_bytes
        self._context = mp.get_context('spawn')
        self._state, self._generation, self._restarts = 'starting', 0, 0
        self._process = self._connection = None
        self._incoming, self._outgoing, self._outcomes = bytearray(), deque(), deque()
        self._inflight, self._events, self._metadata = {}, [], []
        self._staged = {}  # At most one validated result per in-flight worker slot.
        self._completed = self._failed = self._process_failures = 0
        self._closing = False
        self._spawn()

    def _event(self, kind, **details):
        self._events.append({'kind': kind, 'generation': self._generation,
                             'at': time.monotonic(), **details})

    @profiled('parent.serialize')
    def _request(self, meta, payload=b''):
        data = _json({'v': PROTOCOL, 'generation': self._generation, **meta})
        if len(data) > META_LIMIT:
            raise ValueError('Request metadata exceeds bound')
        return _frame(struct.pack('!I', len(data))+data+payload)

    def _spawn(self):
        self._generation += 1
        self._started = time.monotonic()
        self._state = 'starting'
        parent, child = self._context.Pipe(duplex=True)
        self._connection = parent
        os.set_blocking(parent.fileno(), False)
        args = (os.getpid(), _child_main, child, self.factory, self.scheduler.workers, self._generation,
                self.scheduler.max_sample_bytes+META_LIMIT+4, self.max_result_bytes)
        if self._profile is not None:
            args += (True,)
        self._process = self._context.Process(target=_owned_child, args=args, daemon=True)
        try:
            self._process.start()
            self._event('spawn', pid=self._process.pid)
        except Exception as exc:
            self._fault('spawn-error', str(exc)[:200])
        finally:
            child.close()

    def _retire(self, graceful=False):
        process = self._process
        if process is not None and process.pid is not None:
            if graceful and self._connection is not None:
                try:
                    os.write(self._connection.fileno(), self._request({'kind': 'stop'}))
                except OSError:
                    pass
                process.join(.1)
                if self._profile is not None:
                    self._read(eof_ok=True)
                    if self._process is not process:
                        # A malformed final message may have retired this handle.
                        return self._process is None
            if process.is_alive():
                process.terminate()
                process.join(.3)
            if process.is_alive():
                process.kill()
                process.join(.5)
            reaped = not process.is_alive()
        else:
            reaped = True
        if self._connection is not None:
            self._connection.close()
            self._connection = None
        self._incoming.clear()
        self._outgoing.clear()
        if reaped and process is not None:
            if process.pid is not None:
                self._event('reaped', pid=process.pid, exit=process.exitcode)
                process.close()
            self._process = None
        return reaped

    def _terminal(self, work, result, error, processor, receipt_id=None):
        self.scheduler.complete(work.token, success=error is None)
        if error is None:
            self._completed += 1
        else:
            self._failed += 1
        self._outcomes.append(ProcessOutcome(work, result, error, self._generation, processor, receipt_id))

    def _flush_staged(self):
        if not self._staged:
            return
        items = tuple(self._staged.items())
        ids = self.journal.finish_many([dict(token=token, result=result, error=None, processor=slot)
                                       for token, (result, slot) in items])
        # Only committed rows release scheduler slots or become returned outcomes.
        for (token, (result, slot)), receipt_id in zip(items, ids):
            self._terminal(self._inflight.pop(token), result, None, slot, receipt_id)
        self._staged.clear()

    def _fault(self, code, message=''):
        self._process_failures += 1
        self._event('failure', code=code)
        # Preserve already validated responses before failing the rest, matching
        # the nonbatched path. A storage failure instead leaves them unresolved.
        if self._journal_error is None:
            try:
                self._flush_staged()
            except JournalError as exc:
                self._journal_error = str(exc)
        works = tuple(self._inflight.values())
        ids = [None]*len(works)
        if self.journal is not None and self._journal_error is None and works:
            try:
                ids = self.journal.finish_many([dict(token=w.token, result=None, error=code, processor=None) for w in works])
            except JournalError as exc:
                self._journal_error = str(exc)
        failure_code = 'journal-error' if self._journal_error is not None else code
        for work, receipt_id in zip(works, ids):
            self._terminal(work, None, ProcessFailure(failure_code, self._generation, message), None, receipt_id)
        self._inflight.clear()
        self._staged.clear()
        reaped = self._retire()
        if not self._closing and self._journal_error is None and reaped and self._restarts < self.max_restarts:
            self._restarts += 1
            self._restart_at = time.monotonic()+self.restart_delay
            self._state = 'backoff'
        else:
            self._state = 'failed'
        if not reaped:
            self._event('unreaped')

    @profiled('parent.deserialize')
    def _message(self, body):
        try:
            def invalid_constant(value):
                raise ValueError('Non-finite result')
            value = json.loads(body, parse_constant=invalid_constant)
            if (not isinstance(value, dict) or type(value.get('v')) is not int
                    or value['v'] != PROTOCOL or type(value.get('generation')) is not int
                    or value['generation'] != self._generation):
                raise ValueError('Invalid protocol generation')
            kind = value.get('kind')
            if kind == 'profile' and self._profile is not None:
                if len(body) > WIRE_LIMIT or type(value.get('final')) is not bool:
                    raise ValueError('Invalid final profile flag or size')
                self._child_profiles[self._generation] = copy.deepcopy(
                    BoundedProfile.validate(value.get('timings')))
                self._profile_final[self._generation] = value['final']
            elif len(body) > self.max_result_bytes:
                raise ValueError('Result exceeds its independent byte bound')
            elif kind == 'fatal':
                self._fault('worker-error', str(value.get('message', ''))[:200])
            elif kind == 'ready' and self._state == 'starting':
                if time.monotonic()-self._started > self.startup_timeout:
                    self._fault('startup-timeout')
                    return
                if (type(value.get('processors')) is not int or value['processors'] != self.scheduler.workers
                        or not isinstance(value.get('metadata'), list)
                        or len(value['metadata']) != self.scheduler.workers):
                    raise ValueError('Late or invalid startup proof')
                self._state = 'running'
                self._metadata.append({'generation': self._generation, 'processors': value['metadata']})
                self._event('ready')
            elif kind == 'result' and self._state == 'running':
                token = value.get('token')
                processor = value.get('processor')
                if (type(token) is not int or token not in self._inflight or token in self._staged or type(value.get('ok')) is not bool
                        or not integer(processor, 0, self.scheduler.workers-1)):
                    raise ValueError('Duplicate or unknown result token')
                work = self._inflight[token]
                if time.monotonic()-work.dispatched_at > self.task_timeout:
                    self._fault('task-timeout')
                elif not value['ok']:
                    self._fault(str(value.get('code', 'processor-error'))[:80], str(value.get('message', ''))[:200])
                else:
                    if self.journal is None:
                        self._terminal(work, value.get('value'), None, processor)
                        self._inflight.pop(token)
                    else:
                        self._staged[token] = value.get('value'), processor
            else:
                raise ValueError('Unexpected result state')
        except (ValueError, TypeError, KeyError, RecursionError, UnicodeError) as exc:
            self._fault('protocol-error', str(exc)[:200])

    def _read(self, eof_ok=False):
        budget = 2*1024**2
        while self._connection is not None and budget > 0:
            if len(self._incoming) < 4:
                needed = 4-len(self._incoming)
            else:
                length = struct.unpack('!I', self._incoming[:4])[0]
                limit = max(WIRE_LIMIT, self.max_result_bytes) if self._profile is not None else self.max_result_bytes
                if not 1 <= length <= limit:
                    self._fault('result-size-limit')
                    return
                needed = 4+length-len(self._incoming)
                if not needed:
                    body = bytes(self._incoming[4:])
                    self._incoming.clear()
                    self._message(body)
                    continue
            try:
                if self._profile is None:
                    data = os.read(self._connection.fileno(), min(65536, needed, budget))
                else:
                    with measure(self._profile, 'parent.ipc.read'):
                        data = os.read(self._connection.fileno(), min(65536, needed, budget))
            except BlockingIOError:
                return
            except OSError as exc:
                self._fault('pipe-error', str(exc)[:200])
                return
            if not data:
                if eof_ok:
                    return
                self._fault('worker-exit')
                return
            self._incoming.extend(data)
            budget -= len(data)

    def _io(self):
        self._read()
        budget = 2*1024**2
        while self._connection is not None and self._outgoing and budget > 0:
            view = self._outgoing[0]
            try:
                if self._profile is None:
                    count = os.write(self._connection.fileno(), view[:budget])
                else:
                    with measure(self._profile, 'parent.ipc.write'):
                        count = os.write(self._connection.fileno(), view[:budget])
            except BlockingIOError:
                break
            except OSError as exc:
                self._fault('pipe-error', str(exc)[:200])
                break
            if not count:
                self._fault('pipe-error')
                break
            budget -= count
            if count == len(view):
                self._outgoing.popleft()
            else:
                self._outgoing[0] = view[count:]
        self._read()
        self._flush_staged()

    @profiled('parent.delivery')
    def _take_outcomes(self):
        outcomes = tuple(self._outcomes)
        self._outcomes.clear()
        return outcomes

    @profiled('parent.step')
    def step(self):
        try:
            return self._step()
        except JournalError as exc:
            # Never continue executing after a failed/uncertain durable commit.
            # Existing rows remain available for restart recovery/inspection.
            self._journal_error = str(exc)
            self._fault('journal-error')
            return self._take_outcomes()

    def _step(self):
        if self._state == 'closed':
            raise ValueError('Process workers are closed')
        if self._state == 'backoff' and not self._closing and time.monotonic() >= self._restart_at:
            self._spawn()
        if self._state in ('starting', 'running'):
            self._io()
        now = time.monotonic()
        if self._state == 'starting' and now-self._started > self.startup_timeout:
            self._fault('startup-timeout')
        elif self._state == 'running' and any(now-w.dispatched_at > self.task_timeout for w in self._inflight.values()):
            self._fault('task-timeout')
        if self._state == 'running' and not self._closing:
            free = self.scheduler.workers-len(self._inflight)
            self._journal_blocked = self.journal is not None and not self.journal.can_reserve(free)
            works = () if self._journal_blocked else self.scheduler.dispatch()
            self._inflight.update((w.token, w) for w in works)
            if self.journal is not None:
                self.journal.reserve(works, self._generation)
            for work in works:
                request = self._request({'kind': 'work', 'token': work.token,
                    'camera': work.sample.camera, 'sequence': work.sample.sequence,
                    'captured_at': work.sample.captured_at}, work.sample.payload)
                self._outgoing.append(memoryview(request))
            self._io()
        return self._take_outcomes()

    def profile_snapshot(self):
        """Inclusive aggregates; child counters are cumulative per generation.
        
        A missing child_final marker means an unreported forced-exit tail, not
        zero cost. Final=True proves receipt of the graceful summary only.
        """
        return {'enabled': self._profile is not None,
                'parent': self._profile.snapshot() if self._profile is not None else {},
                'children': copy.deepcopy(self._child_profiles),
                'child_final': dict(self._profile_final)}

    def snapshot(self):
        return {'state': self._state, 'generation': self._generation, 'restarts': self._restarts,
                'active': len(self._inflight), 'completed': self._completed, 'failed': self._failed,
                'process_failures': self._process_failures,
                'journal_run_id': self.journal.run_id if self.journal is not None else None,
                'journal_blocked': self._journal_blocked, 'journal_error': self._journal_error,
                'received_uncommitted': len(self._staged),
                'pid': self._process.pid if self._process is not None else None,
                'child_alive': self._process.is_alive() if self._process is not None and self._process.pid else False,
                'unsent_bytes': sum(len(view) for view in self._outgoing),
                'received_buffer_bytes': len(self._incoming),
                'events': copy.deepcopy(self._events), 'metadata': copy.deepcopy(self._metadata)}

    def close(self, timeout=1.):
        if not finite(timeout) or not 0 <= timeout <= 30:
            raise ValueError('Close timeout must be 0–30 seconds')
        if self._state == 'closed':
            return ()
        self._closing = True
        outcomes = []
        end = time.monotonic()+timeout
        while self._inflight and time.monotonic() < end:
            outcomes.extend(self.step())
            time.sleep(.001)
        if self._inflight:
            self._fault('shutdown-timeout')
        else:
            self._retire(graceful=True)
        outcomes.extend(self._outcomes)
        self._outcomes.clear()
        self._state = 'closed'
        return tuple(outcomes)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
