"""Bounded local execution adapter; capture, models and process isolation are caller-owned."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from .scheduler import CameraScheduler, Work


@dataclass(frozen=True)
class Outcome:
    work: Work
    result: object
    error: Exception | None


class LocalWorkers:
    """Execute scheduler work on 1–4 explicit independent processors.

    Producers submit to CameraScheduler. One controlling thread calls step()
    and close(); neither may run concurrently. Each processor is called with
    one Sample and has at most one active call. The scheduler retains byte,
    age, fairness and per-camera ordering limits. No executor backlog is added.
    This adapter exclusively owns scheduler dispatch/completion after creation.

    A processor exception stops new dispatch, drains other active calls and is
    returned as an Outcome. There is no retry or fallback. close() waits for
    native calls and returns remaining outcomes; it cannot cancel a stuck GPU.
    Use a separately supervised process when a hard deadline is required.
    Processor/model construction and cleanup remain the caller's responsibility.
    """
    def __init__(self, scheduler, processors):
        processors = tuple(processors)
        if (not isinstance(scheduler, CameraScheduler) or not 1 <= len(processors) <= 4
                or scheduler.workers != len(processors) or any(not callable(p) for p in processors)):
            raise ValueError('Use a scheduler and 1–4 explicit processors with matching worker counts')
        if scheduler.snapshot()['inflight']:
            raise ValueError('Scheduler already has in-flight work')
        self.scheduler = scheduler
        self.processors = processors
        self._executor = ThreadPoolExecutor(max_workers=len(processors), thread_name_prefix='dvr-local')
        self._active = {}
        self.failed = False
        self.closed = False

    def _collect(self):
        outcomes = []
        for slot, (work, future) in list(self._active.items()):
            if not future.done():
                continue
            del self._active[slot]
            try:
                result, error = future.result(), None
            except Exception as exc:
                result, error = None, exc
                self.failed = True
            self.scheduler.complete(work.token, success=error is None)
            outcomes.append(Outcome(work, result, error))
        return outcomes

    def step(self):
        if self.closed:
            raise ValueError('Workers are closed')
        outcomes = self._collect()
        if not self.failed:
            free = [slot for slot in range(len(self.processors)) if slot not in self._active]
            work = self.scheduler.dispatch()
            if len(work) > len(free):
                raise RuntimeError('Scheduler work was dispatched outside its execution adapter')
            for index, (slot, item) in enumerate(zip(free, work)):
                try:
                    future = self._executor.submit(self.processors[slot], item.sample)
                except Exception as exc:
                    self.failed = True
                    # Preserve already collected outcomes and explicitly report
                    # every dispatched item that could not enter the executor.
                    for remaining in work[index:]:
                        self.scheduler.complete(remaining.token, success=False)
                        outcomes.append(Outcome(remaining, None, exc))
                    break
                self._active[slot] = item, future
        return tuple(outcomes)

    def snapshot(self):
        return {'workers': len(self.processors), 'active': len(self._active),
                'failed': self.failed, 'closed': self.closed}

    def close(self):
        if self.closed:
            return ()
        self.closed = True
        self._executor.shutdown(wait=True)
        return tuple(self._collect())

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
