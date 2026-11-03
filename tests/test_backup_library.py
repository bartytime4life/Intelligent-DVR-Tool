"""Generated local footage and injected faults; no OEM/device acceptance claims."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from edge.backup_library import BackupLibrary, LibraryError, validate_config, GIB
from edge.local_service import Jobs, load_catalog
from local_analysis_fixture import build


@unittest.skipUnless(all(importlib.util.find_spec(m) for m in ('cv2','numpy','onnx','av')), 'Native generated-video dependencies required')
class LibraryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = build(Path(self.temp.name) / 'fixture')
        self.source = Path(self.temp.name) / 'oem'
        self.source.mkdir()
        self.backup = Path(self.temp.name) / 'backup'
        self.jobs = Jobs(self.root / 'recordings', load_catalog(self.root / 'config.json'))
        self.now = 1000.0
        self.free = 1000 * GIB
        self.library = self.make()
        self.settings = dict(source_folder=str(self.source), backup_folder=str(self.backup), max_storage_gib=100,
                             reserve_gib=2, settle_seconds=30, recursive=True)
        self.library.configure(self.settings)
    def make(self):
        return BackupLibrary(self.jobs, self.root / 'settings', supervise=False, clock=lambda: self.now,
                             wall=lambda: self.now, disk_usage=lambda p: SimpleNamespace(free=self.free))
    def tearDown(self):
        self.library.close()
        self.jobs.close()
        self.temp.cleanup()
    def start(self, analyze=False):
        return self.library.start({'analyze': analyze, 'model': 'synthetic', 'rules': 'presence'})
    def recording(self, name='camera.webm'):
        target = self.source / name
        target.parent.mkdir(exist_ok=True, parents=True)
        shutil.copyfile(self.root / 'recordings/synthetic.webm', target)
        os.utime(target, (900, 900))
        return target
    def settle(self):
        self.library.scan()
        self.now += 31
        self.library.scan()
    def first(self):
        return self.library.status()['items'][0]
    def finish(self):
        self.library._analysis_tick()
        self.assertIsNotNone(self.library.analysis)
        self.jobs.thread.join(20)
        self.assertFalse(self.jobs.thread.is_alive())
        self.library._analysis_tick()

    def test_two_observations_required_and_source_remains_byte_identical(self):
        original = self.recording()
        before = original.read_bytes()
        self.start()
        self.library.scan()
        self.assertEqual(self.library.status()['items'], [])
        self.assertEqual(self.library.status()['waiting'], 1)
        self.now += 31
        self.library.scan()
        row = self.first()
        self.assertEqual(row['sha256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(row['state'], 'saved')
        self.assertEqual(original.read_bytes(), before)
        with self.library.open_artifact(row['id'], 'source')[0] as saved:
            self.assertEqual(saved.read(), before)

    def test_copy_survives_oem_deletion_and_service_restart(self):
        original = self.recording()
        self.start()
        self.settle()
        row = self.first()
        shutil.rmtree(self.source)
        self.library.stop()
        self.library.close()
        self.library = self.make()
        self.assertFalse(self.library.status()['active'])
        with self.library.open_artifact(row['id'], 'source')[0] as saved:
            self.assertTrue(saved.read())

    def test_changed_file_waits_again_and_versions_do_not_overwrite(self):
        target = self.recording()
        self.start()
        self.library.scan()
        self.now += 31
        target.write_bytes(target.read_bytes() + b'new OEM bytes')
        os.utime(target, (900, 900))
        self.library.scan()
        self.assertEqual(self.library.status()['items'], [])
        self.now += 31
        self.library.scan()
        old_id = self.first()['id']
        target.write_bytes(target.read_bytes() + b'new version')
        os.utime(target, (900, 900))
        self.settle()
        self.assertEqual(len(self.library.status()['items']), 2)
        self.assertTrue((self.library.store / old_id).is_dir())

    def test_duplicates_reuse_a_verified_copy_and_do_not_accumulate(self):
        self.recording('a.webm'); self.recording('sub/b.webm')
        self.start(); self.settle()
        self.assertEqual(len(self.library.status()['items']), 1)
        self.assertEqual(self.library.status()['counters']['duplicates'], 1)
        self.library.scan()
        self.assertEqual(self.library.status()['counters']['duplicates'], 1)

    def test_disk_pressure_preserves_original_and_existing_copies(self):
        self.recording()
        self.start(); self.settle()
        first = self.first()
        self.recording('next.webm').write_bytes(b'other video bytes')
        os.utime(self.source / 'next.webm', (900, 900))
        self.free = GIB
        self.settle()
        self.assertIn('storage', self.library.status()['error'].lower())
        self.assertEqual(self.first()['id'], first['id'])
        self.assertTrue((self.source / 'next.webm').exists())

    def test_proprietary_files_are_backed_up_without_decode_or_analysis(self):
        path = self.source / 'camera.bvr'
        path.write_bytes(b'OEM proprietary recording bytes')
        os.utime(path, (900, 900))
        self.start(analyze=True); self.settle()
        self.library._analysis_tick()
        self.assertEqual(self.first()['state'], 'saved')
        self.assertFalse(self.first()['analysis_eligible'])
        self.assertIsNone(self.library.analysis)
        self.assertEqual(self.library.status()['unsupported'], [{'extension': '.bvr', 'count': 1}])

    def test_local_analysis_persists_source_matched_review(self):
        self.recording()
        self.start(analyze=True); self.settle(); self.finish()
        row = self.first()
        self.assertEqual(row['state'], 'completed', row)
        self.assertEqual(row['coverage'], 'completed')
        self.assertGreater(row['observations'], 0)
        with self.library.open_artifact(row['id'], 'result')[0] as stream:
            self.assertEqual(json.load(stream)['receipt']['source_sha256'], row['sha256'])
        self.library.stop(); self.library.close(); self.library = self.make()
        self.assertEqual(self.first()['state'], 'completed')

    def test_tampered_saved_bytes_cannot_be_opened_or_analyzed(self):
        self.recording()
        self.start(); self.settle(); row = self.first()
        path = self.library.store / row['id'] / 'source.webm'
        path.write_bytes(b'tampered file')
        with self.assertRaisesRegex(LibraryError, 'fingerprint'):
            self.library.open_artifact(row['id'], 'source')
        self.library.stop(); self.start(analyze=True)
        self.library._analysis_tick()
        self.assertEqual(self.first()['state'], 'failed')
        self.assertIsNone(self.jobs.owner)

    def test_links_are_skipped_and_overlapping_folders_refused(self):
        for target in (self.source, self.source / 'nested'):
            with self.assertRaises(LibraryError):
                validate_config({**self.settings, 'backup_folder': str(target)})
        outside = self.recording('outside.webm')
        try:
            (self.source / 'link.webm').symlink_to(outside)
            (self.source / 'linked-folder').symlink_to(self.root / 'recordings', target_is_directory=True)
        except OSError:
            self.skipTest('This host does not permit symbolic-link test fixtures')
        self.start(); self.settle()
        self.assertEqual(len(self.library.status()['items']), 1)

    def test_manual_job_has_priority_and_backup_only_does_not_claim_analyzer(self):
        self.recording()
        self.start(); self.settle()
        self.assertIsNone(self.jobs.owner)
        other = object(); self.jobs.claim(other)
        self.library.stop(); self.start(analyze=True); self.library._analysis_tick()
        self.assertIsNone(self.library.analysis)
        self.assertIs(self.jobs.owner, other)
        self.jobs.release(other)
        self.finish()
        self.assertEqual(self.first()['state'], 'completed')

    def test_recover_verified_copy_after_manifest_commit_gap(self):
        self.recording()
        self.start(); self.settle(); row = self.first()
        self.library.db.execute('DELETE FROM items'); self.library.db.commit()
        self.library.stop(); self.library.close(); self.library = self.make()
        self.assertEqual(self.first()['id'], row['id'])
        self.assertFalse(self.library.active)

    def test_second_service_cannot_own_same_settings_or_backup(self):
        with self.assertRaises(ValueError):
            self.make()
        with self.assertRaises(ValueError):
            other = BackupLibrary(self.jobs, self.root / 'other-settings', supervise=False)
            try: other.configure(self.settings)
            finally: other.close()

    def test_scan_reports_bound_instead_of_unbounded_recursive_walk(self):
        for i in range(4): (self.source / f'{i}.txt').touch()
        self.start()
        with patch('edge.backup_library.MAX_SCAN', 2): self.library.scan()
        self.assertTrue(self.library.status()['scan_limited'])

    def test_storage_failure_mid_copy_never_publishes_or_removes_original(self):
        source = self.recording()
        before = source.read_bytes()
        self.start()
        self.library.scan(); self.now += 31
        calls = [1000 * GIB, GIB]
        def disk(path): return SimpleNamespace(free=calls.pop(0) if calls else GIB)
        with patch.object(self.library, 'disk_usage', disk): self.library.scan()
        self.assertEqual(self.library.status()['items'], [])
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(list(self.library.store.glob('*/copy.part')), [])

    def test_a_recording_changing_during_copy_is_discarded_and_source_preserved(self):
        from edge.backup_library import open_regular as real_open
        source = self.recording()
        self.start(); self.library.scan(); self.now += 31
        class Growing:
            def __init__(self, stream): self.stream, self.grown = stream, False
            def __enter__(self): return self
            def __exit__(self, *args): self.stream.close()
            def fileno(self): return self.stream.fileno()
            def read(self, size):
                block = self.stream.read(size)
                if not self.grown:
                    self.grown = True
                    with source.open('ab') as changing: changing.write(b'OEM resumed recording')
                return block
        def opening(path):
            stream = real_open(path)
            return Growing(stream) if path == source else stream
        with patch('edge.backup_library.open_regular', opening): self.library.scan()
        self.assertEqual(self.library.status()['items'], [])
        self.assertTrue(source.read_bytes().endswith(b'OEM resumed recording'))
        self.assertIsNone(self.library.status()['copying'])

    def test_large_supported_file_is_copied_without_claiming_analysis(self):
        self.recording()
        self.start(analyze=True)
        with patch('edge.backup_library.VIDEO_BYTES', 16):
            self.settle(); self.library._analysis_tick()
            self.assertFalse(self.first()['analysis_eligible'])
            self.assertEqual(self.first()['state'], 'saved')
        self.assertIsNone(self.library.analysis)

    def test_stop_and_configure_are_serialized_while_copying(self):
        self.start()
        self.library.scanning = True
        self.library.stop()
        with self.assertRaisesRegex(LibraryError, 'wait'):
            self.library.configure(self.settings)
        self.assertEqual(self.library.status()['state'], 'stopping')
        self.library.scanning = False
        self.assertEqual(self.library.configure(self.settings)['state'], 'paused')


if __name__ == '__main__': unittest.main()
