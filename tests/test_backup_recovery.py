"""Generated backup bytes and corrupt receipts; no media/device access required."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

from edge.backup_library import BackupLibrary, GIB


class BackupRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'generated-source'
        self.source.mkdir()
        self.settings = dict(source_folder=str(self.source), backup_folder=str(self.root / 'backup'),
                             max_storage_gib=100, reserve_gib=2, settle_seconds=30, recursive=True)
        self.library = self.make()
        self.library.configure(self.settings)
        self.store = self.library.store

    def make(self):
        return BackupLibrary(SimpleNamespace(), self.root / 'settings', supervise=False,
                             disk_usage=lambda path: SimpleNamespace(free=100 * GIB))

    def tearDown(self):
        self.library.close()
        self.temp.cleanup()

    def receipt(self, identifier, **changes):
        data = b'generated local backup integrity fixture'
        return {**dict(id=identifier, name='generated.webm', extension='.webm', bytes=len(data),
                       sha256=hashlib.sha256(data).hexdigest(), copied_at=1000, state='queued'), **changes}

    def entry(self, identifier, receipt):
        directory = self.store / identifier
        directory.mkdir(mode=0o700)
        (directory / 'source.webm').write_bytes(b'generated local backup integrity fixture')
        (directory / 'receipt.json').write_text(json.dumps(receipt), encoding='utf-8')
        return directory

    def reopen(self):
        self.library.close()
        self.library = self.make()

    def assert_saved_copy_available(self, identifier):
        self.assertIsNotNone(self.library.db)
        self.assertFalse(self.library.status()['active'])
        with self.library.open_artifact(identifier, 'source')[0] as stream:
            self.assertEqual(stream.read(), b'generated local backup integrity fixture')

    def test_nonobject_receipts_are_isolated_without_losing_a_later_valid_copy(self):
        self.library.close()
        invalid = self.entry('1' * 32, ['damaged receipt'])
        before = {path.name: path.read_bytes() for path in invalid.iterdir()}
        self.entry('2' * 32, self.receipt('2' * 32))
        self.reopen()
        self.assert_saved_copy_available('2' * 32)
        self.assertEqual([row['id'] for row in self.library.status()['items']], ['2' * 32])
        self.assertIn('unverified backup', self.library.status()['error'])
        self.assertEqual({path.name: path.read_bytes() for path in invalid.iterdir()}, before)

    def test_invalid_receipt_fields_never_enter_the_index(self):
        cases = [dict(copied_at=None), dict(copied_at=True), dict(copied_at='yesterday'),
                 dict(copied_at=-1), dict(copied_at=10**100), dict(copied_at=[]),
                 dict(bytes=0), dict(bytes=True), dict(bytes=64 * GIB + 1),
                 dict(name=''), dict(name='../other.webm'), dict(name='bad\0name'), dict(name='x' * 201),
                 dict(sha256=[]), dict(sha256='bad'), dict(sha256='0' * 64),
                 dict(extension=[]), dict(extension='.exe'), dict(id='mismatched-id')]
        self.library.close()
        for number, changes in enumerate(cases, 1):
            identifier = f'{number:032x}'
            self.entry(identifier, self.receipt(identifier, **changes))
        missing = self.receipt('f' * 32)
        missing.pop('copied_at')
        self.entry('f' * 32, missing)
        self.entry('e' * 32, self.receipt('e' * 32))
        self.reopen()
        self.assert_saved_copy_available('e' * 32)
        self.assertEqual([row['id'] for row in self.library.status()['items']], ['e' * 32])
        self.assertIn('unverified backup', self.library.status()['error'])
        self.assertEqual(len(list(self.store.glob('*/receipt.json'))), len(cases) + 2)

    def test_uuid_named_regular_file_does_not_abort_receipt_recovery(self):
        self.library.close()
        unexpected = self.store / ('1' * 32)
        unexpected.write_bytes(b'preserve this unexpected entry')
        self.entry('2' * 32, self.receipt('2' * 32))
        self.reopen()
        self.assert_saved_copy_available('2' * 32)
        self.assertIn('unverified backup', self.library.status()['error'])
        self.assertEqual(unexpected.read_bytes(), b'preserve this unexpected entry')

    def test_uuid_named_link_never_recovers_outside_bytes(self):
        self.library.close()
        outside = self.root / 'outside'
        outside.mkdir()
        try:
            (self.store / ('1' * 32)).symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest('Symbolic links unavailable on this host')
        self.entry('2' * 32, self.receipt('2' * 32))
        self.reopen()
        self.assert_saved_copy_available('2' * 32)
        self.assertEqual(self.library.db.execute('SELECT COUNT(*) FROM items').fetchone()[0], 1)
        self.assertTrue((self.store / ('1' * 32)).is_symlink())
        self.assertEqual(list(outside.iterdir()), [])

    def test_recovery_warning_survives_start_scan_and_saving_the_same_settings(self):
        self.library.close()
        self.entry('1' * 32, None)
        self.entry('2' * 32, self.receipt('2' * 32))
        self.reopen()
        self.library.configure(self.settings)
        self.library.start({'analyze': False, 'model': '', 'rules': ''})
        self.library.scan()
        self.assertIn('no saved files were deleted', self.library.status()['error'])
        self.library.stop()
        self.assert_saved_copy_available('2' * 32)
        configured = self.library.configure({**self.settings, 'backup_folder': str(self.root / 'new-backup')})
        self.assertIsNone(configured['error'])


if __name__ == '__main__':
    unittest.main()
