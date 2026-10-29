"""Durable ordering, acknowledgment, backpressure and actual parent-death tests."""
from dataclasses import dataclass
import json
import multiprocessing as mp
import os
from pathlib import Path
import signal
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from edge.journal import OutcomeJournal, JournalError
from edge.scheduler import CameraScheduler, Sample
from edge.supervision import ProcessWorkers
from test_supervision import EchoFactory


def dispatched(camera='a', sequence=0):
    scheduler = CameraScheduler([camera], workers=1)
    scheduler.submit(Sample(camera, sequence, time.monotonic(), b'private-frame-content'))
    return scheduler.dispatch()[0]


@dataclass
class WitnessFactory:
    database: str

    def __call__(self, slot, generation):
        return WitnessProcessor(self.database)


@dataclass
class WitnessProcessor:
    database: str

    def __call__(self, sample):
        connection = sqlite3.connect('file:'+self.database+'?mode=ro', uri=True)
        try:
            row = connection.execute('SELECT status FROM entries WHERE body LIKE ?',
                ('%"camera":"'+sample.camera+'"%',)).fetchone()
            if row != ('dispatched',):
                raise RuntimeError('Work executed before durable reservation')
            return {'observed_reserved': True}
        finally:
            connection.close()


@dataclass
class GateFactory:
    marker: str

    def __call__(self, slot, generation):
        return GateProcessor(self.marker)


@dataclass
class GateProcessor:
    marker: str

    def __call__(self, sample):
        deadline = time.monotonic()+5
        while not Path(self.marker).exists():
            if time.monotonic() >= deadline:
                raise TimeoutError('Test gate was not released')
            time.sleep(.001)
        return {'released': True}


def crash_owner(directory, connection):
    journal = OutcomeJournal(directory)
    scheduler = CameraScheduler(['a', 'b'], workers=1)
    pool = ProcessWorkers(scheduler, EchoFactory('hang-first'), journal=journal)
    end = time.monotonic()+8
    while pool.snapshot()['state'] != 'running' and time.monotonic() < end:
        pool.step(); time.sleep(.001)
    scheduler.submit(Sample('b', 0, time.monotonic(), b'success-frame'))
    while not journal.pending() and time.monotonic() < end:
        pool.step(); time.sleep(.001)
    scheduler.submit(Sample('a', 0, time.monotonic(), b'unfinished-frame'))
    pool.step()
    connection.send(dict(child=pool.snapshot()['pid'], journal=journal.snapshot()))
    time.sleep(60)


def parent_death_guardian(directory, connection):
    # Reap our own orphaned grandchild without relying on the host's PID 1.
    import ctypes
    libc = ctypes.CDLL(None)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER, process-local
        raise RuntimeError('Cannot qualify orphan reaping')
    context = mp.get_context('spawn')
    read, write = context.Pipe(False)
    owner = context.Process(target=crash_owner, args=(directory, write))
    child = None
    try:
        owner.start(); write.close()
        if not read.poll(10):
            raise RuntimeError('Owner did not reach committed/active boundary')
        ready = read.recv(); child = ready['child']
        os.kill(owner.pid, signal.SIGKILL); owner.join(5)
        deadline = time.monotonic()+5; status = None
        while time.monotonic() < deadline:
            pid, value = os.waitpid(child, os.WNOHANG)
            if pid:
                status = value; break
            time.sleep(.005)
        if status is None:
            raise RuntimeError('Owned child survived parent death')
        with OutcomeJournal(directory) as recovered:
            rows = recovered.pending()
            connection.send(dict(owner_exit=owner.exitcode, child_exit=os.waitstatus_to_exitcode(status),
                                 recovered=recovered.snapshot(), rows=rows))
    finally:
        if owner.is_alive():
            owner.kill(); owner.join(5)
        if child:
            try:
                os.kill(child, signal.SIGKILL); os.waitpid(child, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        read.close(); connection.close()


@unittest.skipUnless(sys.platform == 'linux', 'Optional local journal is Linux-only')
class JournalTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)/'journal'

    def tearDown(self):
        self.temp.cleanup()

    def until(self, pool, predicate, timeout=8):
        rows = []; end = time.monotonic()+timeout
        while time.monotonic() < end:
            rows.extend(pool.step())
            if predicate(rows):
                return rows
            time.sleep(.001)
        self.fail('Journal integration timed out: '+str(pool.snapshot()))

    def test_terminal_commit_precedes_return_and_payload_is_absent(self):
        with OutcomeJournal(self.directory) as journal:
            scheduler = CameraScheduler(['a'], workers=1)
            pool = ProcessWorkers(scheduler, WitnessFactory(str(self.directory/'outcomes.sqlite3')), journal=journal)
            try:
                scheduler.submit(Sample('a', 0, time.monotonic(), b'private-frame-content'))
                rows = self.until(pool, lambda rows: len(rows) == 1)
                self.assertIsNone(rows[0].error)
                self.assertTrue(rows[0].result['observed_reserved'])
                record = journal.pending()[0]
                self.assertEqual(record['id'], rows[0].journal_id)
                self.assertEqual(record['run_id'], journal.run_id)
                self.assertEqual(record['status'], 'succeeded')
                self.assertEqual(record['result'], rows[0].result)
                self.assertNotIn('private-frame-content', json.dumps(record))
                self.assertEqual(len(record['payload_sha256']), 64)
            finally:
                pool.close()
        for file in self.directory.iterdir():
            self.assertEqual(file.stat().st_mode & 0o077, 0)
            self.assertNotIn(b'private-frame-content', file.read_bytes())

    def test_reopen_preserves_unacknowledged_and_ack_survives_next_open(self):
        with OutcomeJournal(self.directory) as journal:
            run = journal.run_id; work = dispatched()
            journal.reserve([work], 1)
            receipt = journal.finish(work.token, result={'person': 1}, error=None, processor=0)
            self.assertEqual(journal.pending(), journal.pending())
        with OutcomeJournal(self.directory) as journal:
            self.assertNotEqual(journal.run_id, run)
            self.assertEqual(journal.pending()[0]['id'], receipt)
            journal.acknowledge([receipt]); journal.acknowledge([receipt])
            self.assertEqual(journal.pending(), [])
        with OutcomeJournal(self.directory) as journal:
            self.assertEqual(journal.pending(), [])
            self.assertEqual(journal.snapshot()['entries'], 1)
            self.assertEqual(journal.prune(), 1)
            self.assertEqual(journal.snapshot()['reserved_bytes'], 0)

    def test_unfinished_reservations_become_interruptions_and_tokens_are_run_scoped(self):
        with OutcomeJournal(self.directory) as journal:
            old = journal.run_id; journal.reserve([dispatched()], 2)
        with OutcomeJournal(self.directory) as journal:
            first = journal.pending()[0]
            self.assertEqual(first['error'], 'parent-interrupted')
            self.assertEqual(first['run_id'], old)
            self.assertEqual(first['generation'], 2)
            self.assertIsNone(first['result'])
            journal.reserve([dispatched()], 1)
            journal.finish(1, result={}, error=None, processor=0)
            self.assertEqual(len(journal.pending()), 2)
            self.assertEqual(len({r['run_id'] for r in journal.pending()}), 2)
            self.assertEqual(journal.snapshot()['recovered_interrupted'], 1)

    def test_batch_reservation_rolls_back_on_duplicate(self):
        with OutcomeJournal(self.directory) as journal:
            work = dispatched()
            with self.assertRaises(JournalError):
                journal.reserve([work, work], 1)
            self.assertEqual(journal.snapshot()['entries'], 0)
            self.assertEqual(journal._db.execute('SELECT COUNT(*) FROM entries').fetchone()[0], 0)

    def test_full_journal_pauses_dispatch_until_explicit_ack_and_prune(self):
        with OutcomeJournal(self.directory, max_entries=1) as journal:
            scheduler = CameraScheduler(['b'], workers=1, max_age_seconds=10)
            pool = ProcessWorkers(scheduler, EchoFactory(), journal=journal)
            try:
                scheduler.submit(Sample('b', 0, time.monotonic(), b'x'))
                rows = self.until(pool, lambda rows: len(rows) == 1)
                scheduler.submit(Sample('b', 1, time.monotonic(), b'y'))
                for _ in range(10): pool.step()
                self.assertTrue(pool.snapshot()['journal_blocked'])
                self.assertEqual(scheduler.snapshot()['per_camera']['b']['dispatched'], 1)
                self.assertEqual(journal.prune(), 0)
                journal.acknowledge([rows[0].journal_id])
                pool.step(); self.assertTrue(pool.snapshot()['journal_blocked'])
                self.assertEqual(journal.prune(), 1)
                more = self.until(pool, lambda rows: len(rows) == 1)
                self.assertEqual(more[0].work.sample.sequence, 1)
            finally: pool.close()

    def test_logical_reservations_prevent_over_admission(self):
        with OutcomeJournal(self.directory, max_bytes=2560, max_result_bytes=512) as journal:
            self.assertTrue(journal.can_reserve(1))
            journal.reserve([dispatched()], 1)
            self.assertFalse(journal.can_reserve(1))
            self.assertEqual(journal.snapshot()['reserved_bytes'], 2560)
            with self.assertRaises(JournalError): journal.reserve([dispatched('b')], 1)
            journal.finish(1, result={}, error='controlled-failure', processor=None)
            self.assertEqual(journal.pending()[0]['error'], 'controlled-failure')

    def test_commit_failure_stops_execution_and_restart_without_inventing_durability(self):
        with OutcomeJournal(self.directory) as journal:
            scheduler = CameraScheduler(['b'], workers=1)
            marker = Path(self.temp.name)/'release'
            pool = ProcessWorkers(scheduler, GateFactory(str(marker)), max_restarts=3, journal=journal)
            try:
                self.until(pool, lambda _: pool.snapshot()['state'] == 'running')
                scheduler.submit(Sample('b', 0, time.monotonic(), b'x')); pool.step()
                journal._db.execute('PRAGMA query_only=ON')
                marker.touch()
                rows = self.until(pool, lambda rows: len(rows) == 1)
                self.assertEqual(rows[0].error.code, 'journal-error')
                self.assertIsNone(rows[0].journal_id)
                self.assertEqual(pool.snapshot()['state'], 'failed')
                self.assertEqual(pool.snapshot()['restarts'], 0)
                self.assertFalse(pool.snapshot()['child_alive'])
                self.assertEqual(journal.pending(), [])
                self.assertEqual(scheduler.snapshot()['inflight'], 0)
            finally: pool.close()
        with OutcomeJournal(self.directory) as journal:
            self.assertEqual(journal.pending()[0]['error'], 'parent-interrupted')

    def test_reservation_failure_prevents_ipc_and_fails_all_dispatched_slots(self):
        with OutcomeJournal(self.directory) as journal:
            scheduler = CameraScheduler(['a','b'], workers=2)
            pool = ProcessWorkers(scheduler, EchoFactory(), journal=journal)
            try:
                self.until(pool, lambda _: pool.snapshot()['state'] == 'running')
                for camera in ('a','b'): scheduler.submit(Sample(camera, 0, time.monotonic(), b'x'))
                with patch.object(journal, 'reserve', side_effect=JournalError('Controlled write failure')):
                    rows = pool.step()
                self.assertEqual(len(rows), 2)
                self.assertTrue(all(o.error.code == 'journal-error' and o.journal_id is None for o in rows))
                self.assertEqual(pool.snapshot()['completed'], 0)
                self.assertEqual(scheduler.snapshot()['inflight'], 0)
                self.assertEqual(journal.snapshot()['entries'], 0)
            finally: pool.close()

    def test_single_owner_and_private_path_admission(self):
        with OutcomeJournal(self.directory):
            with self.assertRaisesRegex(JournalError, 'live owner'): OutcomeJournal(self.directory)
        self.directory.chmod(0o755)
        with self.assertRaises(JournalError): OutcomeJournal(self.directory)
        self.directory.chmod(0o700)
        link = Path(self.temp.name)/'link'; link.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(JournalError): OutcomeJournal(link)

    def test_unknown_schema_is_preserved(self):
        self.directory.mkdir(mode=0o700)
        database = self.directory/'outcomes.sqlite3'
        connection = sqlite3.connect(database)
        connection.execute('CREATE TABLE unrelated (value TEXT)'); connection.commit(); connection.close()
        database.chmod(0o600)
        with self.assertRaisesRegex(JournalError, 'schema'): OutcomeJournal(self.directory)
        connection = sqlite3.connect(database)
        self.assertEqual(connection.execute('SELECT COUNT(*) FROM unrelated').fetchone()[0], 0)
        connection.close()

    def test_invalid_result_ack_bounds_and_reused_adapter_are_rejected(self):
        with OutcomeJournal(self.directory, max_result_bytes=512) as journal:
            journal.reserve([dispatched()], 1)
            for result in (float('nan'), 'x'*1024):
                with self.assertRaises(JournalError): journal.finish(1, result=result, error=None, processor=0)
            with self.assertRaises(JournalError): journal.acknowledge([1])
            with self.assertRaises(JournalError): journal.acknowledge([999])
            with self.assertRaises(ValueError): journal.pending(0)
            with self.assertRaises(ValueError): journal.attach(1, 1024)
            journal.attach(1, 512)
            with self.assertRaises(JournalError): journal.attach(1, 512)
        for kwargs in ({'max_entries':0}, {'max_bytes':512}, {'max_result_bytes':True}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError): OutcomeJournal(self.directory, **kwargs)

    def test_forced_parent_death_kills_child_and_recovers_only_unfinished_work(self):
        context = mp.get_context('spawn'); read, write = context.Pipe(False)
        guardian = context.Process(target=parent_death_guardian, args=(str(self.directory), write))
        guardian.start(); write.close()
        try:
            self.assertTrue(read.poll(20), 'Parent-death qualification did not return')
            result = read.recv(); guardian.join(5)
            self.assertEqual(guardian.exitcode, 0)
            self.assertEqual(result['owner_exit'], -signal.SIGKILL)
            self.assertEqual(result['child_exit'], -signal.SIGKILL)
            self.assertEqual(result['recovered']['recovered_interrupted'], 1)
            by_camera = {r['camera']:r for r in result['rows']}
            self.assertEqual(by_camera['b']['status'], 'succeeded')
            self.assertEqual(by_camera['a']['error'], 'parent-interrupted')
            self.assertEqual(len(result['rows']), 2)
        finally:
            if guardian.is_alive(): guardian.kill(); guardian.join(5)
            read.close()


class JournalPlatformTest(unittest.TestCase):
    def test_non_linux_admission_is_explicit(self):
        with patch('edge.journal.sys.platform', 'win32'), self.assertRaisesRegex(ValueError, 'Linux'):
            OutcomeJournal('unused-path')
