"""Atomic terminal groups, bounded supervisor staging and real SQLite exit windows."""
import json
import multiprocessing as mp
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest

from edge.journal import OutcomeJournal, JournalError
from edge.scheduler import CameraScheduler, Sample
from edge.supervision import ProcessWorkers
from test_journal import GateFactory


def batch(scheduler, sequence=0):
    for i in range(4):
        scheduler.submit(Sample(f'c{i}',sequence,time.monotonic(),b'synthetic-payload'))
    return scheduler.dispatch()


def completions(works):
    return [dict(token=w.token,result={'camera':w.sample.camera},error=None,processor=i) for i,w in enumerate(works)]


def transaction_owner(directory, marker, phase):
    journal=OutcomeJournal(directory);scheduler=CameraScheduler([f'c{i}' for i in range(4)],workers=4)
    works=batch(scheduler);journal.reserve(works,1)
    if phase=='during':
        original=journal._write
        def pause(sql,rows):
            rows=tuple(rows)
            if sql.startswith('UPDATE entries SET status='):
                with journal._db:
                    for row in rows[:2]:journal._db.execute(sql,row)
                    Path(marker).write_text('two uncommitted updates')
                    time.sleep(60)
            else:original(sql,rows)
        journal._write=pause
    journal.finish_many(completions(works))
    Path(marker).write_text('four committed updates, not delivered')
    time.sleep(60)


@unittest.skipUnless(sys.platform=='linux','Optional journal batching is Linux-only')
class JournalBatchTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)

    def tearDown(self):self.temp.cleanup()

    def scheduler(self):return CameraScheduler([f'c{i}' for i in range(4)],workers=4,max_age_seconds=10)

    def staged_pool(self,journal):
        scheduler=self.scheduler();pool=ProcessWorkers(scheduler,GateFactory(str(self.root/'unreleased')),journal=journal)
        deadline=time.monotonic()+8
        while pool.snapshot()['state']!='running' and time.monotonic()<deadline:
            pool.step();time.sleep(.001)
        self.assertEqual(pool.snapshot()['state'],'running')
        for i in range(4):scheduler.submit(Sample(f'c{i}',0,time.monotonic(),b'protocol-fixture'))
        pool.step()
        works=tuple(pool._inflight.values());self.assertEqual(len(works),4)
        return scheduler,pool,works

    def response(self,pool,work,slot):
        pool._message(json.dumps(dict(v=1,generation=1,kind='result',token=work.token,
            processor=slot,ok=True,value={'camera':work.sample.camera})).encode())

    def test_terminal_group_is_one_commit_with_ordered_ids_and_exact_charges(self):
        with OutcomeJournal(self.root/'journal') as journal:
            works=batch(self.scheduler());journal.reserve(works,1)
            items=list(reversed(completions(works)));items[0].update(error='controlled-failure',result=None,processor=None)
            statements=[];journal._db.set_trace_callback(statements.append)
            ids=journal.finish_many(items)
            self.assertEqual(sum(s=='COMMIT' for s in statements),1)
            self.assertEqual(sum(s.startswith('BEGIN') for s in statements),1)
            by_token={r['token']:r for r in journal.pending()}
            self.assertEqual(ids,tuple(by_token[item['token']]['id'] for item in items))
            snap=journal.snapshot()
            self.assertEqual(snap['states'],{'failed':1,'succeeded':3})
            self.assertEqual(snap['terminal_commits'],1)
            self.assertEqual(snap['terminal_rows'],4)
            self.assertEqual(snap['largest_terminal_batch'],4)
            charge=sum(len(json.dumps(item['result'],ensure_ascii=True,separators=(',',':')).encode())+2048 for item in items)
            self.assertEqual(snap['reserved_bytes'],charge)

    def test_invalid_member_rejects_entire_group_before_any_update(self):
        with OutcomeJournal(self.root/'journal',max_result_bytes=512) as journal:
            works=batch(self.scheduler());journal.reserve(works,1);before=journal.snapshot()['reserved_bytes']
            changes=({'token':999},{'token':works[0].token},{'result':float('nan')},{'result':'x'*1024},{'token':True})
            for change in changes:
                items=completions(works);items[-1].update(change)
                with self.subTest(change=change),self.assertRaises(JournalError):journal.finish_many(items)
                self.assertEqual(journal.snapshot()['states'],{'dispatched':4})
                self.assertEqual(journal.snapshot()['reserved_bytes'],before)
                self.assertEqual(journal.snapshot()['terminal_commits'],0)
            for items in ([],completions(works)+completions(works)[:1],[{'token':1}]):
                with self.assertRaises(ValueError):journal.finish_many(items)

    def test_sqlite_rejection_rolls_back_earlier_group_members(self):
        with OutcomeJournal(self.root/'journal') as journal:
            works=batch(self.scheduler());journal.reserve(works,1)
            with journal._db:
                journal._db.execute("CREATE TRIGGER reject_member BEFORE UPDATE ON entries WHEN NEW.token=3 BEGIN SELECT RAISE(ABORT,'controlled rejection'); END")
            before=journal.snapshot()['reserved_bytes']
            with self.assertRaises(JournalError):journal.finish_many(completions(works))
            self.assertEqual(journal.snapshot()['states'],{'dispatched':4})
            self.assertEqual(journal.snapshot()['reserved_bytes'],before)
            self.assertEqual(journal.pending(),[])
            self.assertEqual(journal.snapshot()['terminal_commits'],0)
            with journal._db:journal._db.execute('DROP TRIGGER reject_member')
            self.assertEqual(len(journal.finish_many(completions(works))),4)

    def test_unread_query_uses_partial_index_without_returning_acknowledged_history(self):
        with OutcomeJournal(self.root/'journal') as journal:
            scheduler=self.scheduler();ids=[]
            for sequence in range(25):
                works=batch(scheduler,sequence);journal.reserve(works,1)
                ids.extend(journal.finish_many(completions(works)))
                for work in works:scheduler.complete(work.token)
            journal.acknowledge(ids[:-2])
            self.assertEqual([r['id'] for r in journal.pending()],ids[-2:])
            plan=journal._db.execute("EXPLAIN QUERY PLAN SELECT id,body FROM entries WHERE status!='dispatched' AND acked=0 ORDER BY id LIMIT 100").fetchall()
            self.assertTrue(any('unread_delivery' in str(row) for row in plan))
            self.assertEqual(journal._db.execute('PRAGMA user_version').fetchone()[0],1)
        with OutcomeJournal(self.root/'journal') as journal:
            self.assertEqual([r['id'] for r in journal.pending()],ids[-2:])

    def test_staged_responses_commit_together_before_releasing_slots(self):
        with OutcomeJournal(self.root/'journal') as journal:
            scheduler,pool,works=self.staged_pool(journal)
            try:
                for slot,work in enumerate(works):self.response(pool,work,slot)
                self.assertEqual(pool.snapshot()['received_uncommitted'],4)
                self.assertEqual(scheduler.snapshot()['inflight'],4)
                self.assertEqual(pool.snapshot()['completed'],0)
                self.assertEqual(journal.pending(),[])
                rows=pool.step()
                self.assertEqual(len(rows),4)
                self.assertTrue(all(row.error is None and row.journal_id for row in rows))
                self.assertEqual(journal.snapshot()['terminal_commits'],1)
                self.assertEqual(journal.snapshot()['largest_terminal_batch'],4)
                self.assertEqual(scheduler.snapshot()['inflight'],0)
                self.assertEqual(pool.snapshot()['received_uncommitted'],0)
            finally:pool.close(timeout=0)

    def test_group_commit_failure_stops_all_slots_without_false_durable_delivery(self):
        with OutcomeJournal(self.root/'journal') as journal:
            scheduler,pool,works=self.staged_pool(journal)
            try:
                for slot,work in enumerate(works):self.response(pool,work,slot)
                journal._db.execute('PRAGMA query_only=ON')
                rows=pool.step()
                self.assertEqual(len(rows),4)
                self.assertTrue(all(row.error.code=='journal-error' and row.journal_id is None for row in rows))
                self.assertEqual(scheduler.snapshot()['inflight'],0)
                self.assertEqual(pool.snapshot()['received_uncommitted'],0)
                self.assertEqual(pool.snapshot()['state'],'failed')
                self.assertFalse(pool.snapshot()['child_alive'])
                self.assertEqual(journal.snapshot()['states'],{'dispatched':4})
                self.assertEqual(journal.pending(),[])
            finally:pool.close(timeout=0)
        with OutcomeJournal(self.root/'journal') as journal:
            self.assertEqual(journal.snapshot()['recovered_interrupted'],4)
            self.assertTrue(all(r['error']=='parent-interrupted' for r in journal.pending()))

    def test_protocol_fault_keeps_valid_received_row_and_fails_only_remainder(self):
        with OutcomeJournal(self.root/'journal') as journal:
            scheduler,pool,works=self.staged_pool(journal)
            try:
                self.response(pool,works[0],0)
                self.response(pool,works[0],0)  # A duplicate within the uncommitted batch is a fault.
                rows=pool.step()
                self.assertEqual(len(rows),4)
                self.assertEqual(sum(row.error is None for row in rows),1)
                self.assertTrue(all(row.journal_id for row in rows))
                self.assertEqual(journal.snapshot()['states'],{'failed':3,'succeeded':1})
                self.assertEqual(journal.snapshot()['terminal_commits'],2)
                self.assertEqual(journal.snapshot()['largest_terminal_batch'],3)
                self.assertEqual(scheduler.snapshot()['inflight'],0)
            finally:pool.close(timeout=0)

    def test_real_owner_exit_during_and_after_atomic_terminal_commit(self):
        context=mp.get_context('spawn')
        for phase in ('during','after'):
            with self.subTest(phase=phase):
                directory=self.root/phase;marker=self.root/(phase+'.ready')
                owner=context.Process(target=transaction_owner,args=(str(directory),str(marker),phase));owner.start()
                try:
                    deadline=time.monotonic()+8
                    while not marker.exists() and owner.is_alive() and time.monotonic()<deadline:time.sleep(.002)
                    self.assertTrue(marker.exists(),'Owner did not reach transaction boundary')
                    os.kill(owner.pid,signal.SIGKILL);owner.join(5)
                    self.assertEqual(owner.exitcode,-signal.SIGKILL)
                    with OutcomeJournal(directory) as journal:
                        rows=journal.pending();self.assertEqual(len(rows),4)
                        self.assertEqual(len({r['id'] for r in rows}),4)
                        if phase=='during':
                            self.assertEqual(journal.snapshot()['recovered_interrupted'],4)
                            self.assertTrue(all(r['error']=='parent-interrupted' and r['result'] is None for r in rows))
                        else:
                            self.assertEqual(journal.snapshot()['recovered_interrupted'],0)
                            self.assertTrue(all(r['status']=='succeeded' for r in rows))
                finally:
                    if owner.is_alive():owner.kill();owner.join(5)
