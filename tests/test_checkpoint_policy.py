"""Checkpoint cadence never changes FULL/WAL, schema or delivery semantics."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

from edge.journal import OutcomeJournal
from edge.scheduler import Sample, Work


@unittest.skipUnless(sys.platform == 'linux', 'Optional journal is Linux-only')
class CheckpointPolicyTest(unittest.TestCase):
    def test_full_sync_schema_and_unread_delivery_survive_checkpoint_policy(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)/'journal'
            with OutcomeJournal(directory) as journal:
                self.assertEqual(journal._db.execute('PRAGMA synchronous').fetchone()[0], 2)
                self.assertEqual(journal._db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
                self.assertEqual(journal._db.execute('PRAGMA wal_autocheckpoint').fetchone()[0], 512)
                journal.reserve([Work(1, Sample('synthetic', 0, 0., b'fixture'), 0.)], 1)
                receipt = journal.finish(1, result={'persisted': True}, error=None, processor=0)
            with sqlite3.connect('file:'+str(directory/'outcomes.sqlite3')+'?mode=ro', uri=True) as legacy:
                self.assertEqual(legacy.execute('PRAGMA user_version').fetchone()[0], 1)
                row = legacy.execute('SELECT id,status,acked,body FROM entries').fetchone()
                self.assertEqual(row[:3], (receipt, 'succeeded', 0))
                self.assertTrue(json.loads(row[3])['result']['persisted'])
            with OutcomeJournal(directory) as journal:
                self.assertEqual(journal.pending()[0]['id'], receipt)
                journal.acknowledge([receipt])
            with OutcomeJournal(directory) as journal:
                self.assertEqual(journal.pending(), [])
                self.assertEqual(journal.prune(), 1)
