"""Real bounded execution/failure tests; no GPU or camera access."""
from threading import Event
import time
import unittest
from unittest.mock import patch

from edge.scheduler import CameraScheduler, Sample
from edge.workers import LocalWorkers


class WorkersTest(unittest.TestCase):
    def scheduler(self, count=2):
        return CameraScheduler(['a','b','c','d'],workers=count,max_sample_bytes=10,
                               max_buffer_bytes=40,max_age_seconds=10)

    def until(self, action, predicate):
        end=time.monotonic()+2
        values=[]
        while time.monotonic()<end:
            values.extend(action())
            if predicate(values):return values
            time.sleep(.001)
        self.fail('Bounded worker test timed out')

    def test_execution_is_bounded_and_payloads_remain_accounted(self):
        scheduler=self.scheduler();gate=Event();began=[Event(),Event()]
        def processor(slot):
            def run(sample):
                began[slot].set()
                if not gate.wait(2):raise TimeoutError('Test gate')
                return sample.camera
            return run
        workers=LocalWorkers(scheduler,[processor(0),processor(1)])
        try:
            for camera in ('a','b','c','d'):
                scheduler.submit(Sample(camera,0,time.monotonic(),b'1234567890'))
            workers.step()
            self.assertTrue(all(e.wait(1) for e in began))
            for _ in range(5):self.assertEqual(workers.step(),())
            self.assertEqual(workers.snapshot()['active'],2)
            snap=scheduler.snapshot()
            self.assertEqual((snap['inflight'],snap['pending'],snap['buffered_payload_bytes']),(2,2,40))
            gate.set()
            outcomes=self.until(workers.step,lambda rows:len(rows)==4)
            self.assertEqual({o.result for o in outcomes},{'a','b','c','d'})
            self.assertTrue(all(o.error is None for o in outcomes))
            self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'],0)
        finally:gate.set();workers.close()

    def test_busy_camera_keeps_order_and_newest_pending_only(self):
        scheduler=self.scheduler(1);gate=Event();started=Event();seen=[]
        def process(sample):
            seen.append((sample.camera,sample.sequence));started.set()
            if not gate.wait(2):raise TimeoutError('Test gate')
        workers=LocalWorkers(scheduler,[process])
        try:
            scheduler.submit(Sample('a',0,time.monotonic(),b'x'));workers.step();self.assertTrue(started.wait(1))
            scheduler.submit(Sample('a',1,time.monotonic(),b'y'))
            scheduler.submit(Sample('a',2,time.monotonic(),b'z'))
            scheduler.submit(Sample('b',0,time.monotonic(),b'x'))
            gate.set();self.until(workers.step,lambda rows:len(rows)==3)
            self.assertEqual(seen,[('a',0),('b',0),('a',2)])
            self.assertEqual(scheduler.snapshot()['per_camera']['a']['replaced'],1)
        finally:gate.set();workers.close()

    def test_failure_stops_new_dispatch_and_drains_existing_calls(self):
        scheduler=self.scheduler();gate=Event();started=Event()
        def fail(sample):raise RuntimeError('Native failure')
        def slow(sample):started.set();gate.wait(2);return 'finished'
        workers=LocalWorkers(scheduler,[fail,slow])
        try:
            for camera in ('a','b','c'):scheduler.submit(Sample(camera,0,time.monotonic(),b'x'))
            workers.step();self.assertTrue(started.wait(1))
            outcomes=self.until(workers.step,lambda rows:any(o.error for o in rows))
            self.assertTrue(workers.failed)
            self.assertEqual(scheduler.snapshot()['pending'],1)
            gate.set();outcomes+=list(workers.close())
            self.assertEqual({o.work.sample.camera for o in outcomes},{'a','b'})
            self.assertEqual(scheduler.snapshot()['inflight'],0)
            self.assertEqual(scheduler.snapshot()['per_camera']['a']['failed'],1)
            self.assertEqual(scheduler.snapshot()['per_camera']['c']['dispatched'],0)
            self.assertEqual(workers.close(),())
            with self.assertRaises(ValueError):workers.step()
        finally:gate.set();workers.close()

    def test_executor_admission_failure_accounts_all_dispatched_tokens(self):
        for failure_at in (1,2):
            with self.subTest(failure_at=failure_at):
                scheduler=self.scheduler();workers=LocalWorkers(scheduler,[lambda s:None]*2)
                original=workers._executor.submit;calls=0
                def submit(*args):
                    nonlocal calls
                    calls+=1
                    if calls==failure_at:raise RuntimeError('Admission failed')
                    return original(*args)
                try:
                    for camera in ('a','b'):scheduler.submit(Sample(camera,0,time.monotonic(),b'x'))
                    with patch.object(workers._executor,'submit',side_effect=submit):
                        outcomes=workers.step()
                    self.assertEqual(sum(o.error is not None for o in outcomes),3-failure_at)
                    workers.close();snap=scheduler.snapshot()
                    self.assertTrue(workers.failed)
                    self.assertEqual((snap['inflight'],snap['buffered_payload_bytes']),(0,0))
                    self.assertEqual(sum(c['failed'] for c in snap['per_camera'].values()),3-failure_at)
                    self.assertEqual(sum(c['completed'] for c in snap['per_camera'].values()),failure_at-1)
                finally:workers.close()

    def test_admission_error_does_not_hide_previously_completed_result(self):
        scheduler=self.scheduler(1);workers=LocalWorkers(scheduler,[lambda sample:sample.camera])
        try:
            for camera in ('a','b'):scheduler.submit(Sample(camera,0,time.monotonic(),b'x'))
            workers.step()
            with patch.object(workers._executor,'submit',side_effect=RuntimeError('Admission failed')):
                outcomes=self.until(workers.step,lambda rows:len(rows)==2)
            self.assertEqual(outcomes[0].result,'a')
            self.assertIsNone(outcomes[0].error)
            self.assertEqual(outcomes[1].work.sample.camera,'b')
            self.assertIsInstance(outcomes[1].error,RuntimeError)
            self.assertEqual(scheduler.snapshot()['inflight'],0)
        finally:workers.close()

    def test_rejects_mismatched_or_preused_scheduler(self):
        scheduler=self.scheduler()
        for processors in ([],[lambda s:None],[None,None],[lambda s:None]*5):
            with self.assertRaises(ValueError):LocalWorkers(scheduler,processors)
        scheduler.submit(Sample('a',0,time.monotonic(),b'x'));scheduler.dispatch()
        with self.assertRaisesRegex(ValueError,'in-flight'):LocalWorkers(scheduler,[lambda s:None]*2)
