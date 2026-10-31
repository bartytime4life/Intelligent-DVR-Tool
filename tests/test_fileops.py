"""Simulated Windows sharing violations; no real reader or antivirus is involved."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from edge import fileops
from edge.segment_worker import atomic_json


class ReplaceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.source, self.target = self.root / 'frame.tmp', self.root / 'frame.jpg'
        self.source.write_bytes(b'new'); self.target.write_bytes(b'old')
    def tearDown(self):
        self.temp.cleanup()
    def flaky(self, failures):
        calls, original = [], os.replace
        def replace(source, target):
            calls.append(source)
            if len(calls) <= failures:
                raise PermissionError(13, 'The process cannot access the file because it is being used by another process')
            return original(source, target)
        return calls, replace

    def test_transient_sharing_violation_is_retried_with_bounded_backoff(self):
        calls, replace = self.flaky(3); pauses = []
        with patch('edge.fileops.os.replace', replace), patch('edge.fileops.time.sleep', pauses.append):
            self.assertTrue(fileops.replace(self.source, self.target))
        self.assertEqual(len(calls), 4); self.assertEqual(self.target.read_bytes(), b'new')
        self.assertEqual(len(pauses), 3)

    def test_persistent_violation_reraises_or_skips_one_best_effort_update(self):
        for best_effort in (False, True):
            calls, replace = self.flaky(100); pauses = []
            with self.subTest(best_effort=best_effort), patch('edge.fileops.os.replace', replace), \
                    patch('edge.fileops.time.sleep', pauses.append):
                if best_effort:
                    self.assertFalse(fileops.replace(self.source, self.target, best_effort=True))
                else:
                    with self.assertRaises(PermissionError): fileops.replace(self.source, self.target)
                self.assertEqual(len(calls), fileops.ATTEMPTS)
                self.assertLessEqual(sum(pauses), .5)
                self.assertEqual(self.target.read_bytes(), b'old')  # Readers keep the last complete file.

    def test_other_errors_are_not_retried(self):
        with patch('edge.fileops.os.replace', side_effect=FileNotFoundError) as replace, \
                patch('edge.fileops.time.sleep') as sleep, self.assertRaises(FileNotFoundError):
            fileops.replace(self.source, self.target, best_effort=True)
        self.assertEqual(replace.call_count, 1); sleep.assert_not_called()

    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'POSIX FIFOs')
    def test_open_regular_refuses_fifos_without_blocking_and_reads_files_blocking(self):
        fifo = self.root / 'swapped'; os.mkfifo(fifo)
        with self.assertRaises(ValueError): fileops.open_regular(fifo)  # Returns at once; no writer exists.
        with fileops.open_regular(self.target) as stream:
            self.assertTrue(os.get_blocking(stream.fileno())); self.assertEqual(stream.read(), b'old')
        (self.root / 'link').symlink_to(self.target)
        with self.assertRaises(OSError): fileops.open_regular(self.root / 'link')

    def test_worker_progress_and_completion_writers_survive_a_held_reader(self):
        progress = self.root / 'progress.json'
        calls, replace = self.flaky(2)
        with patch('edge.fileops.os.replace', replace), patch('edge.fileops.time.sleep'):
            self.assertTrue(atomic_json(progress, {'frames': 2}, best_effort=True))
        self.assertEqual(json.loads(progress.read_text()), {'frames': 2})
        calls, replace = self.flaky(100)
        with patch('edge.fileops.os.replace', replace), patch('edge.fileops.time.sleep'):
            self.assertFalse(atomic_json(progress, {'frames': 3}, best_effort=True))  # Skipped, worker continues.
            with self.assertRaises(PermissionError): atomic_json(self.root / 'complete.json', {'frames': 3})
        self.assertEqual(json.loads(progress.read_text()), {'frames': 2})
        self.assertFalse((self.root / 'complete.json').exists())


if __name__ == '__main__': unittest.main()
