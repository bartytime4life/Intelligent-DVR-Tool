"""Actual spawned-process fault tests; no GPU, camera or network access."""
from dataclasses import dataclass
import hashlib
import json
import os
import signal
import struct
import sys
import time
import unittest
from unittest.mock import patch

from edge.scheduler import CameraScheduler, Sample
from edge.supervision import ProcessWorkers, ProcessFailure


@dataclass
class EchoProcessor:
    mode: str
    slot: int
    generation: int

    @property
    def runtime(self):
        return {'slot': self.slot, 'generation': self.generation}

    def __call__(self, sample):
        if sample.camera == 'a':
            if self.mode in ('hang-first','ignore-term') and self.generation == 1:
                time.sleep(60)
            if self.mode == 'crash-first' and self.generation == 1:
                os._exit(71)
            if self.mode == 'oversized':
                return {'oversized': 'x'*8192}
        return {'camera': sample.camera, 'sequence': sample.sequence,
                'sha256': hashlib.sha256(sample.payload).hexdigest(),
                'generation': self.generation, 'pid': os.getpid()}


@dataclass
class EchoFactory:
    mode: str = 'echo'

    def __call__(self, slot, generation):
        if self.mode == 'ignore-term':
            signal.signal(signal.SIGTERM,signal.SIG_IGN)
        if self.mode == 'startup-fail':
            raise RuntimeError('Controlled initialization failure')
        if self.mode == 'startup-hang' and generation == 1:
            time.sleep(60)
        return EchoProcessor(self.mode, slot, generation)


def oversized_protocol_child(connection, factory, count, generation, request_limit, result_limit):
    os.write(connection.fileno(), struct.pack('!I', result_limit+1))
    time.sleep(60)


def wrong_generation_child(connection, factory, count, generation, request_limit, result_limit):
    body=json.dumps({'v':1,'generation':generation+1,'kind':'ready',
                     'processors':count,'metadata':[{}]*count}).encode()
    os.write(connection.fileno(),struct.pack('!I',len(body))+body)
    time.sleep(60)


@unittest.skipUnless(sys.platform == 'linux', 'Optional process supervision is Linux-only')
class SupervisionTest(unittest.TestCase):
    def scheduler(self, workers=2, large=False):
        return CameraScheduler(['a','b','c'],workers=workers,max_sample_bytes=2*1024**2 if large else 100,
                               max_buffer_bytes=4*1024**2 if large else 1000,max_age_seconds=10)

    def until(self, pool, predicate, timeout=8):
        end=time.monotonic()+timeout;outcomes=[]
        while time.monotonic()<end:
            outcomes.extend(pool.step())
            if predicate(outcomes):return outcomes
            time.sleep(.001)
        self.fail('Process qualification timed out: '+str(pool.snapshot()))

    def ready(self, pool):
        self.until(pool,lambda _:pool.snapshot()['state']=='running')

    def assert_reaped(self, pool):
        pool.close(timeout=.05)
        snap=pool.snapshot()
        self.assertFalse(snap['child_alive'])
        spawned={e['pid'] for e in snap['events'] if e['kind']=='spawn'}
        reaped={e['pid'] for e in snap['events'] if e['kind']=='reaped'}
        self.assertEqual(spawned,reaped)
        for pid in spawned:
            with self.assertRaises(ProcessLookupError):os.kill(pid,0)

    def test_large_payload_round_trip_is_bounded_and_associated(self):
        scheduler=self.scheduler(2,large=True)
        pool=ProcessWorkers(scheduler,EchoFactory(),task_timeout=3)
        try:
            self.ready(pool);payload=b'frame-bytes'*90000
            for camera in ('a','b','c'):
                scheduler.submit(Sample(camera,0,time.monotonic(),payload))
            outcomes=self.until(pool,lambda rows:len(rows)==3)
            self.assertEqual({o.result['camera'] for o in outcomes},{'a','b','c'})
            self.assertTrue(all(o.result['sha256']==hashlib.sha256(payload).hexdigest() for o in outcomes))
            self.assertTrue(all(o.error is None for o in outcomes))
            self.assertTrue(all(o.generation==1 and o.processor in (0,1) for o in outcomes))
            self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'],0)
            self.assertLessEqual(scheduler.snapshot()['peak_inflight'],2)
        finally:self.assert_reaped(pool)

    def test_stalled_process_is_reaped_then_newest_sample_recovers(self):
        scheduler=self.scheduler();pool=ProcessWorkers(scheduler,EchoFactory('hang-first'),
            task_timeout=.2,max_restarts=1,restart_delay=0)
        try:
            self.ready(pool);original=pool.snapshot()['pid']
            for camera in ('a','b','c'):scheduler.submit(Sample(camera,0,time.monotonic(),b'x'))
            pool.step()
            for sequence in (1,2):scheduler.submit(Sample('a',sequence,time.monotonic(),b'y'))
            rows=self.until(pool,lambda outcomes:len(outcomes)==4)
            by_key={(o.work.sample.camera,o.work.sample.sequence):o for o in rows}
            self.assertIsInstance(by_key['a',0].error,ProcessFailure)
            self.assertEqual(by_key['a',0].error.code,'task-timeout')
            self.assertEqual(by_key['a',2].result['generation'],2)
            self.assertTrue(all(by_key[c,0].error is None for c in ('b','c')))
            self.assertEqual(pool.snapshot()['restarts'],1)
            self.assertNotEqual(pool.snapshot()['pid'],original)
            self.assertEqual(scheduler.snapshot()['per_camera']['a']['replaced'],1)
            self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'],0)
        finally:self.assert_reaped(pool)

    def test_abrupt_exit_is_explicit_and_does_not_retry_failed_sample(self):
        scheduler=self.scheduler(1);pool=ProcessWorkers(scheduler,EchoFactory('crash-first'),
            max_restarts=1,restart_delay=0)
        try:
            self.ready(pool);scheduler.submit(Sample('a',0,time.monotonic(),b'x'));pool.step()
            scheduler.submit(Sample('a',1,time.monotonic(),b'y'))
            rows=self.until(pool,lambda outcomes:len(outcomes)==2)
            self.assertIsNotNone(rows[0].error)
            self.assertEqual(rows[1].result['sequence'],1)
            self.assertEqual(rows[1].result['generation'],2)
            self.assertEqual(scheduler.snapshot()['per_camera']['a']['failed'],1)
            self.assertEqual(scheduler.snapshot()['per_camera']['a']['dispatched'],2)
        finally:self.assert_reaped(pool)

    def test_startup_failures_exhaust_budget_without_dispatch(self):
        scheduler=self.scheduler(1);scheduler.submit(Sample('a',0,time.monotonic(),b'x'))
        pool=ProcessWorkers(scheduler,EchoFactory('startup-fail'),max_restarts=1,restart_delay=0)
        try:
            rows=self.until(pool,lambda _:pool.snapshot()['state']=='failed')
            self.assertEqual(rows,[])
            self.assertEqual(pool.snapshot()['generation'],2)
            self.assertEqual(pool.snapshot()['restarts'],1)
            self.assertEqual(scheduler.snapshot()['pending'],1)
            self.assertEqual(scheduler.snapshot()['inflight'],0)
        finally:self.assert_reaped(pool)

    def test_startup_deadline_can_recover_without_losing_pending_sample(self):
        scheduler=self.scheduler(1);scheduler.submit(Sample('a',0,time.monotonic(),b'x'))
        pool=ProcessWorkers(scheduler,EchoFactory('startup-hang'),startup_timeout=.2,
            max_restarts=1,restart_delay=0)
        try:
            rows=self.until(pool,lambda outcomes:len(outcomes)==1)
            self.assertIsNone(rows[0].error)
            self.assertEqual(rows[0].result['generation'],2)
            self.assertTrue(any(e.get('code')=='startup-timeout' for e in pool.snapshot()['events']))
        finally:self.assert_reaped(pool)

    def test_late_collected_result_is_not_accepted(self):
        scheduler=self.scheduler(1);pool=ProcessWorkers(scheduler,EchoFactory(),task_timeout=.08)
        try:
            self.ready(pool);scheduler.submit(Sample('a',0,time.monotonic(),b'x'));pool.step()
            time.sleep(.15)
            rows=self.until(pool,lambda outcomes:len(outcomes)==1)
            self.assertIsNone(rows[0].result)
            self.assertEqual(rows[0].error.code,'task-timeout')
            self.assertEqual(scheduler.snapshot()['per_camera']['a']['completed'],0)
        finally:self.assert_reaped(pool)

    def test_oversized_result_fails_explicitly(self):
        scheduler=self.scheduler(1);pool=ProcessWorkers(scheduler,EchoFactory('oversized'),max_result_bytes=1024)
        try:
            self.ready(pool);scheduler.submit(Sample('a',0,time.monotonic(),b'x'))
            rows=self.until(pool,lambda outcomes:len(outcomes)==1)
            self.assertEqual(rows[0].error.code,'result-too-large')
            self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'],0)
        finally:self.assert_reaped(pool)

    def test_invalid_protocol_size_and_generation_abort_owned_child(self):
        for target,code in ((oversized_protocol_child,'result-size-limit'),(wrong_generation_child,'protocol-error')):
            with self.subTest(code=code),patch('edge.supervision._child_main',target):
                scheduler=self.scheduler(1);pool=ProcessWorkers(scheduler,EchoFactory(),max_result_bytes=1024)
                try:
                    self.until(pool,lambda _:pool.snapshot()['state']=='failed')
                    self.assertTrue(any(e.get('code')==code for e in pool.snapshot()['events']))
                    self.assertEqual(scheduler.snapshot()['inflight'],0)
                finally:self.assert_reaped(pool)

    def test_close_deadline_accounts_for_active_work_and_never_restarts(self):
        scheduler=self.scheduler(1);pool=ProcessWorkers(scheduler,EchoFactory('hang-first'),max_restarts=3)
        try:
            self.ready(pool);scheduler.submit(Sample('a',0,time.monotonic(),b'x'));pool.step()
            began=time.monotonic();rows=pool.close(timeout=.05)
            self.assertLess(time.monotonic()-began,3)
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0].error.code,'shutdown-timeout')
            self.assertEqual(pool.snapshot()['restarts'],0)
            self.assertEqual(pool.snapshot()['state'],'closed')
            self.assertEqual(pool.close(),())
            self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'],0)
        finally:self.assert_reaped(pool)

    def test_owned_child_ignoring_terminate_is_killed_and_reaped(self):
        scheduler=self.scheduler(1);pool=ProcessWorkers(scheduler,EchoFactory('ignore-term'))
        try:
            self.ready(pool);scheduler.submit(Sample('a',0,time.monotonic(),b'x'));pool.step()
            rows=pool.close(timeout=.05)
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0].error.code,'shutdown-timeout')
            self.assertTrue(any(e['kind']=='reaped' and e['exit']==-signal.SIGKILL for e in pool.snapshot()['events']))
        finally:self.assert_reaped(pool)

    def test_invalid_bounds_and_nonserializable_factories_are_rejected(self):
        scheduler=self.scheduler(1)
        for kwargs in ({'task_timeout':0},{'startup_timeout':float('nan')},{'max_restarts':4},
                       {'max_restarts':True},{'max_result_bytes':10}):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):ProcessWorkers(scheduler,EchoFactory(),**kwargs)
        with self.assertRaises(ValueError):ProcessWorkers(scheduler,lambda slot,generation:None)
        scheduler.submit(Sample('a',0,time.monotonic(),b'x'));scheduler.dispatch()
        with self.assertRaises(ValueError):ProcessWorkers(scheduler,EchoFactory())


class SupervisionPlatformTest(unittest.TestCase):
    def test_non_linux_is_explicitly_unsupported(self):
        with patch('edge.supervision.sys.platform','win32'),self.assertRaisesRegex(ValueError,'Linux'):
            ProcessWorkers(CameraScheduler(['a'],workers=1),EchoFactory())
