"""Bounded profiling and durable overload/failure regressions. No hardware claims."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from edge.profiling import BoundedProfile, PHASES, WIRE_LIMIT, activate, measure
from edge.scheduler import CameraScheduler, Sample, Work
from edge.journal import OutcomeJournal, JournalError
from edge.supervision import ProcessWorkers
from edge.inference import OnnxRuntimeCuda
from test_backends import FakeOrt, NP
from test_supervision import EchoFactory
from test_journal import GateFactory


def malformed_final_child(connection, factory, count, generation, request_limit, result_limit, profiling):
    from edge.supervision import _send, _read_exact
    import struct
    fd = connection.fileno()
    envelope = dict(v=1, generation=generation)
    _send(fd, dict(envelope, kind='ready', processors=count, metadata=[{}]*count), result_limit)
    size = struct.unpack('!I', _read_exact(fd, 4))[0]
    _read_exact(fd, size)
    _send(fd, dict(envelope, kind='profile', final=True, timings={'unknown': []}), WIRE_LIMIT)
    connection.close()


class ProfileTest(unittest.TestCase):
    def test_fixed_histograms_and_threaded_counts(self):
        profile = BoundedProfile()
        def record(_):
            for n in range(1000):
                profile.record('child.processor', n)
        with ThreadPoolExecutor(4) as executor:
            list(executor.map(record, range(4)))
        snap = profile.snapshot()
        self.assertEqual(snap['child.processor'][:3], [4000, 4*sum(range(1000)), 999])
        self.assertEqual(sum(snap['child.processor'][3]), 4000)
        BoundedProfile.validate(snap)
        snap['child.processor'][3][0] = 99999
        self.assertNotEqual(snap, profile.snapshot())

    def test_unknown_phases_and_malformed_aggregates_reject(self):
        profile = BoundedProfile()
        for phase, ns in (('private-camera', 0), ('parent.step', True), ('parent.step', -1)):
            with self.assertRaises(ValueError):
                profile.record(phase, ns)
        for rows in ([], {'arbitrary': []}, {'parent.step': [True, 1, 1, [0]*48]},
                     {'parent.step': [1, 1, 1, [0]*48]}):
            with self.assertRaises(ValueError):
                BoundedProfile.validate(rows)
        for phase in PHASES:
            profile.record(phase, 123456)
        self.assertLess(len(json.dumps(profile.snapshot()).encode()), WIRE_LIMIT)

    def test_disabled_profile_does_not_read_perf_clock(self):
        with patch('edge.profiling.time.perf_counter_ns', side_effect=AssertionError('Disabled clock')):
            with measure(None, 'parent.step'):
                scheduler = CameraScheduler(['a'], workers=1)
                scheduler.submit(Sample('a', 0, 0., b'x'), now=0.)
                scheduler.complete(scheduler.dispatch(now=0.)[0].token, now=0.)

    def test_fake_cuda_spans_failures_without_retry(self):
        profile, ort = BoundedProfile(), FakeOrt()
        with patch('edge.inference.importlib.import_module', return_value=ort):
            backend = OnnxRuntimeCuda(Path('fixture.onnx'), NP, 1)
        with activate(profile):
            backend.forward('blob')
            ort.fail_run = True
            with self.assertRaises(RuntimeError):
                backend.forward('blob')
        self.assertEqual(profile.snapshot()['native.cuda.run'][0], 2)
        self.assertEqual(ort.runs, 3)
        backend.close()

    def test_overload_preserves_byte_bounds_fairness_and_loss_counts(self):
        scheduler = CameraScheduler(['a','b','c'], workers=1, max_sample_bytes=32,
            max_buffer_bytes=64, max_age_seconds=1, profile=BoundedProfile())
        for camera in ('a','b'):
            self.assertEqual(scheduler.submit(Sample(camera, 0, 0., b'x'*32), now=0.), 'accepted')
        self.assertEqual(scheduler.submit(Sample('c', 0, 0., b'x'*32), now=0.), 'budget-dropped')
        self.assertEqual(scheduler.submit(Sample('a', 1, 0., b'y'*32), now=0.), 'replaced')
        first = scheduler.dispatch(now=0.)[0]
        self.assertEqual((first.sample.camera, first.sample.sequence), ('a', 1))
        scheduler.complete(first.token, now=.1)
        self.assertEqual(scheduler.dispatch(now=2.), [])
        snap = scheduler.snapshot()
        self.assertEqual(snap['buffered_payload_bytes'], 0)
        self.assertEqual(snap['peak_buffered_payload_bytes'], 64)
        self.assertEqual(sum(s['completed']+s['replaced']+s['stale']+s['budget_dropped']
                             for s in snap['per_camera'].values()), 4)


@unittest.skipUnless(sys.platform == 'linux', 'Optional journal/process path requires Linux')
class DurableProfileTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def populate(self, journal, count):
        for token in range(1, count+1):
            journal.reserve([Work(token, Sample('fixture', token, 0., b'private-payload'), 0.)], 1)
            journal.finish(token, result={}, error=None, processor=0)

    def until(self, pool, predicate):
        rows, deadline = [], time.monotonic()+8
        while time.monotonic() < deadline:
            rows.extend(pool.step())
            if predicate(rows):
                return rows
            time.sleep(.001)
        self.fail(str(pool.snapshot()))

    def test_ack_queries_bounded_and_duplicate_ack_survives_reopen(self):
        with OutcomeJournal(self.root/'journal') as journal:
            self.populate(journal, 1000)
            statements = []
            journal._db.set_trace_callback(statements.append)
            journal.acknowledge(list(range(1, 1001)))
            self.assertEqual(sum(s.startswith('SELECT') for s in statements), 4)
            self.assertEqual(sum(s.startswith('UPDATE') for s in statements), 4)
            self.assertEqual(sum(s == 'COMMIT' for s in statements), 1)
            journal._db.set_trace_callback(None)
            journal.acknowledge([1000, 1000, 1])
            self.assertEqual(journal.pending(), [])
        with OutcomeJournal(self.root/'journal') as journal:
            self.assertEqual(journal.prune(), 1000)

    def test_late_invalid_chunk_prevents_any_ack(self):
        with OutcomeJournal(self.root/'journal') as journal:
            self.populate(journal, 300)
            journal.reserve([Work(301, Sample('fixture', 301, 0., b'x'), 0.)], 1)
            for invalid in (301, 9999):
                with self.assertRaises(JournalError):
                    journal.acknowledge(list(range(1, 301))+[invalid])
                self.assertEqual(journal._query('SELECT SUM(acked) FROM entries')[0][0], 0)

    def test_ack_failure_rolls_back_all_chunks_with_profiled_commit(self):
        with OutcomeJournal(self.root/'journal', profile=BoundedProfile()) as journal:
            self.populate(journal, 300)
            with journal._db:
                journal._db.execute("CREATE TRIGGER reject_ack BEFORE UPDATE OF acked ON entries WHEN NEW.id=257 BEGIN SELECT RAISE(ABORT,'fixture'); END")
            with self.assertRaises(JournalError):
                journal.acknowledge(list(range(1,301)))
            self.assertEqual(journal._query('SELECT SUM(acked) FROM entries')[0][0], 0)
            with journal._db:
                journal._db.execute('DROP TRIGGER reject_ack')
            journal.acknowledge(list(range(1,301)))
            self.assertEqual(journal.pending(), [])
            self.assertEqual(journal._db.execute('PRAGMA synchronous').fetchone()[0], 2)
            self.assertEqual(journal._db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
        with OutcomeJournal(self.root/'journal') as journal:
            self.assertEqual(journal.pending(), [])

    def test_full_journal_backpressure_replacement_and_resume(self):
        profile = BoundedProfile()
        with OutcomeJournal(self.root/'journal', max_entries=1, max_result_bytes=512, profile=profile) as journal:
            scheduler = CameraScheduler(['b'], workers=1, profile=profile)
            pool = ProcessWorkers(scheduler, EchoFactory(), journal=journal, max_result_bytes=512, profile=profile)
            try:
                scheduler.submit(Sample('b', 0, time.monotonic(), b'x'))
                first = self.until(pool, lambda r: len(r) == 1)[0]
                for sequence in (1,2):
                    scheduler.submit(Sample('b', sequence, time.monotonic(), b'private-payload'))
                pool.step()
                self.assertTrue(pool.snapshot()['journal_blocked'])
                self.assertEqual(scheduler.snapshot()['per_camera']['b']['replaced'], 1)
                journal.acknowledge([first.journal_id])
                self.assertEqual(journal.prune(), 1)
                second = self.until(pool, lambda r: len(r) == 1)[0]
                self.assertEqual(second.work.sample.sequence, 2)
                self.assertGreater(second.journal_id, first.journal_id)
                pool.close()
                snap = pool.profile_snapshot()
                self.assertTrue(snap['child_final'][1])
                self.assertEqual(snap['children'][1]['child.processor'][0], 2)
                self.assertIn('parent.ipc.write', snap['parent'])
                self.assertNotIn('private-payload', json.dumps(snap))
                self.assertEqual(scheduler.snapshot()['inflight'], 0)
            finally:
                pool.close(timeout=0)
        with OutcomeJournal(self.root/'journal') as journal:
            self.assertEqual([r['sequence'] for r in journal.pending()], [2])

    def test_storage_failure_stops_and_recovers_unconfirmed_rows(self):
        profile = BoundedProfile()
        with OutcomeJournal(self.root/'journal', profile=profile) as journal:
            scheduler = CameraScheduler(['b'], workers=1, profile=profile)
            marker = self.root/'gate'
            pool = ProcessWorkers(scheduler, GateFactory(str(marker)), journal=journal, profile=profile)
            try:
                self.until(pool, lambda _: pool.snapshot()['state'] == 'running')
                scheduler.submit(Sample('b', 0, time.monotonic(), b'x'))
                pool.step()
                journal._db.execute('PRAGMA query_only=ON')
                marker.touch()
                rows = self.until(pool, lambda r: len(r) == 1)
                self.assertEqual(rows[0].error.code, 'journal-error')
                self.assertIsNone(rows[0].journal_id)
                self.assertFalse(pool.snapshot()['child_alive'])
                self.assertEqual(journal.pending(), [])
            finally:
                pool.close(timeout=0)
        with OutcomeJournal(self.root/'journal') as journal:
            self.assertEqual(journal.pending()[0]['error'], 'parent-interrupted')

    def test_worker_exit_restarts_without_retry_and_marks_missing_tail(self):
        profile = BoundedProfile()
        scheduler = CameraScheduler(['a'], workers=1, profile=profile)
        with OutcomeJournal(self.root/'journal', profile=profile) as journal:
            pool = ProcessWorkers(scheduler, EchoFactory('crash-first'), max_restarts=1,
                restart_delay=0, journal=journal, profile=profile)
            try:
                self.until(pool, lambda _: pool.snapshot()['state'] == 'running')
                scheduler.submit(Sample('a', 0, time.monotonic(), b'x'))
                pool.step()
                scheduler.submit(Sample('a', 1, time.monotonic(), b'y'))
                rows = self.until(pool, lambda r: len(r) == 2)
                self.assertIsNotNone(rows[0].error)
                self.assertEqual(rows[1].work.sample.sequence, 1)
                self.assertIsNone(rows[1].error)
                pool.close()
                self.assertFalse(pool.profile_snapshot()['child_final'].get(1, False))
                self.assertTrue(pool.profile_snapshot()['child_final'][2])
                self.assertEqual(len(journal.pending()), 2)
            finally:
                pool.close(timeout=0)

    def test_shutdown_preserves_failure_and_accounts_for_active_work(self):
        profile = BoundedProfile()
        with OutcomeJournal(self.root/'journal', profile=profile) as journal:
            scheduler = CameraScheduler(['a'], workers=1)
            pool = ProcessWorkers(scheduler, EchoFactory('hang-first'), journal=journal, profile=profile)
            try:
                self.until(pool, lambda _: pool.snapshot()['state'] == 'running')
                scheduler.submit(Sample('a', 0, time.monotonic(), b'x'))
                pool.step()
                rows = pool.close(timeout=.01)
                self.assertEqual(rows[0].error.code, 'shutdown-timeout')
                self.assertIsNotNone(rows[0].journal_id)
                self.assertFalse(pool.snapshot()['child_alive'])
                self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'], 0)
            finally:
                pool.close(timeout=0)
        with OutcomeJournal(self.root/'journal') as journal:
            self.assertEqual(journal.pending()[0]['error'], 'shutdown-timeout')

    def test_result_and_profile_byte_limits_remain_independent(self):
        profile = BoundedProfile()
        pool = ProcessWorkers(CameraScheduler(['a'], workers=1), EchoFactory('oversized'),
            max_result_bytes=512, profile=profile)
        try:
            pool.scheduler.submit(Sample('a', 0, time.monotonic(), b'x'))
            rows = self.until(pool, lambda r: len(r) == 1)
            self.assertEqual(rows[0].error.code, 'result-too-large')
        finally:
            pool.close(timeout=0)
        pool = ProcessWorkers(CameraScheduler(['a'], workers=1), EchoFactory(),
            max_result_bytes=4*1024**2, profile=profile)
        try:
            self.until(pool, lambda _: pool.snapshot()['state'] == 'running')
            pool._message(json.dumps(dict(v=1, generation=1, kind='profile', final=False,
                timings={}, padding='x'*WIRE_LIMIT)).encode())
            self.assertEqual(pool.snapshot()['state'], 'failed')
        finally:
            pool.close(timeout=0)

    def test_malformed_final_profile_does_not_double_close(self):
        with patch('edge.supervision._child_main', malformed_final_child):
            pool = ProcessWorkers(CameraScheduler(['a'], workers=1), EchoFactory(), profile=BoundedProfile())
            try:
                self.until(pool, lambda _: pool.snapshot()['state'] == 'running')
                self.assertEqual(pool.close(), ())
                self.assertFalse(pool.snapshot()['child_alive'])
                self.assertTrue(any(e.get('code') == 'protocol-error' for e in pool.snapshot()['events']))
            finally:
                pool.close(timeout=0)
