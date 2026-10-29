import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from edge import pc_setup as pc

SPEC = importlib.util.spec_from_file_location('pc_builder', Path(__file__).resolve().parents[1] / 'scripts/build-pc-kit.py')
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class PcSetupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def write(self, name, data=b'test'):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return p
    def kit(self):
        for name in ('edge/pc_setup.py', pc.REQUIREMENTS, 'dist/client/index.html', 'dist/client/assets/app.js'):
            self.write(name)
        entries = {p.relative_to(self.root).as_posix(): pc.digest(p) for p in self.root.rglob('*') if p.is_file()}
        self.write('pc-kit.json', json.dumps({'schema': 'intelligent-dvr.pc-kit.v1',
                    'source_commit': 'a' * 40, 'files': entries}).encode())
    def test_integrity_and_missing_manifest_fail_closed(self):
        self.kit()
        self.assertEqual(pc.verify_kit(self.root), 'a' * 40)
        self.write('dist/client/assets/app.js', b'changed')
        with self.assertRaises(pc.SetupError): pc.verify_kit(self.root)
        (self.root / 'pc-kit.json').unlink()
        with self.assertRaises(pc.SetupError): pc.verify_kit(self.root)
    def test_manifest_path_escape_and_invalid_structure_refused(self):
        self.kit()
        path = self.root / 'pc-kit.json'
        original = json.loads(path.read_text())
        for name in ('../outside', '/absolute', 'C:/private', r'..\private'):
            data = json.loads(json.dumps(original))
            data['files'][name] = 'a' * 64
            path.write_text(json.dumps(data))
            with self.subTest(name=name), self.assertRaises(pc.SetupError): pc.verify_kit(self.root)
        path.write_text('[]')
        with self.assertRaises(pc.SetupError): pc.verify_kit(self.root)
    def test_source_checkout_identification_and_build_presence(self):
        self.write('package-lock.json')
        self.write('src/main.jsx')
        self.assertEqual(pc.verify_kit(self.root), 'source checkout')
        with self.assertRaises(pc.SetupError): pc.built_interface(self.root)
        self.write('dist/client/index.html')
        self.write('dist/client/assets/app.js')
        self.assertEqual(pc.built_interface(self.root), 'present')
    def test_settings_are_empty_private_and_never_overwritten(self):
        pc.create_settings(self.root)
        path = self.root / 'local-feeds.json'
        self.assertEqual(json.loads(path.read_text()), {'sources': []})
        if os.name != 'nt': self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        path.write_text('owner credentials')
        pc.create_settings(self.root)
        self.assertEqual(path.read_text(), 'owner credentials')
    def test_existing_environment_wrong_python_is_preserved(self):
        python = self.write('.venv/Scripts/python.exe' if sys.platform == 'win32' else '.venv/bin/python')
        with patch.object(pc, 'command', return_value=json.dumps([[3,11],2**63-1,str(self.root/'.venv')])):
            with self.assertRaises(pc.SetupError): pc.validate_environment(self.root)
        self.assertTrue(python.exists())
    def test_readiness_does_not_contact_configured_devices_and_redacts_config(self):
        self.kit()
        path = self.write('local-feeds.json', json.dumps({'sources':[{
            'id':'dock','name':'Private dock','host':'192.168.1.20','path':'/private-channel',
            'username':'viewer','password':'fixture-secret'}]}).encode())
        with patch.object(pc, 'host_check'), patch.object(pc, 'validate_environment', return_value=sys.executable), \
                patch.object(pc, 'command', return_value='{"synthetic_codec":"passed"}'), \
                patch('socket.socket', side_effect=AssertionError('No device network allowed')):
            result = pc.check(root=self.root, bind=False)
        self.assertTrue(result['ready'])
        report = json.dumps(result)
        for secret in ('fixture-secret', '192.168.1.20', 'private-channel', str(path), 'Private dock'):
            self.assertNotIn(secret, report)
        self.assertEqual(result['physical_devices'], 'not_tested')
    def test_bad_config_missing_runtime_and_recovery(self):
        self.kit()
        self.write('local-feeds.json', b'{"sources":[{"password":"secret"}]}')
        with patch.object(pc, 'host_check'):
            failed = pc.check(root=self.root, bind=False)
        self.assertFalse(failed['ready'])
        self.assertNotIn('secret', json.dumps(failed))
        self.write('local-feeds.json', b'{"sources":[]}')
        with patch.object(pc, 'host_check'), patch.object(pc, 'validate_environment', return_value=sys.executable), \
                patch.object(pc, 'command', return_value='{}'):
            recovered = pc.check(root=self.root, bind=False)
        self.assertTrue(recovered['ready'])
    def test_analysis_requires_both_inputs_and_correct_model_hash(self):
        self.kit()
        pc.create_settings(self.root)
        with patch.object(pc, 'host_check'), patch.object(pc, 'validate_environment', return_value=sys.executable), \
                patch.object(pc, 'command', return_value='{}'):
            result = pc.check(recordings=self.root, root=self.root, bind=False)
            self.assertFalse(result['ready'])
            model = self.write('model.onnx')
            with patch('edge.local_service.load_catalog', return_value={'models':{'model':{'path':model,'sha256':'0'*64}},'rules':{}}):
                result = pc.check(recordings=self.root, config=self.root/'catalog.json', root=self.root, bind=False)
                self.assertFalse(result['ready'])
    def test_failed_install_retains_settings_for_retry(self):
        self.kit()
        self.write('.venv/marker')
        self.write('local-feeds.json', b'owner settings')
        with patch.object(pc, 'host_check'), patch.object(pc, 'validate_environment', return_value=Path('python')), \
                patch.object(pc, 'command', side_effect=pc.SetupError('Retry installation')):
            with self.assertRaises(pc.SetupError): pc.install(self.root)
        self.assertEqual((self.root/'local-feeds.json').read_bytes(), b'owner settings')

    def test_subprocess_failure_and_timeout_are_actionable(self):
        for failure in (OSError('private path'), subprocess.TimeoutExpired('private command', 1)):
            with patch('subprocess.run', side_effect=failure), self.assertRaisesRegex(pc.SetupError, '^Retry setup$'):
                pc.command(['ignored'], 'Retry setup')
    def test_kit_install_uses_pins_and_preserves_settings_without_node(self):
        self.kit()
        self.write('.venv/marker')
        self.write('local-feeds.json', b'owner settings')
        calls = []
        with patch.object(pc, 'host_check'), patch.object(pc, 'validate_environment', return_value=Path('python')), \
                patch.object(pc, 'command', side_effect=lambda args,*a,**k: calls.append(args)), \
                patch('shutil.which', side_effect=AssertionError('Kit must not need Node')):
            pc.install(self.root)
        self.assertIn(pc.REQUIREMENTS, calls[0])
        self.assertIn('--only-binary=:all:', calls[0])
        self.assertEqual((self.root/'local-feeds.json').read_bytes(), b'owner settings')
        self.assertFalse(any('local_service' in str(c) for c in calls))
    def test_package_allowlist_excludes_private_data_and_is_reproducible(self):
        for name in builder.FIXED:
            self.write(name)
        for name in ('edge/pc_setup.py', 'edge/labels/coco80.json', 'dist/client/index.html',
                     'dist/client/assets/app.js', 'docs/pc-testing.md'):
            self.write(name)
        for name in ('local-feeds.json', '.env', 'edge/models/private.onnx', 'recordings/private.mp4', 'edge/private.json'):
            self.write(name, b'private')
        first = builder.build(self.root/'first.zip', 'b'*40, self.root)
        second = builder.build(self.root/'second.zip', 'b'*40, self.root)
        self.assertEqual(first['sha256'], second['sha256'])
        with zipfile.ZipFile(self.root/'first.zip') as archive:
            names = archive.namelist()
            self.assertIn('Intelligent-DVR-PC/START-HERE.md', names)
            self.assertFalse(any('private' in name or name.endswith('/local-feeds.json') for name in names))
        with self.assertRaises(FileExistsError): builder.build(self.root/'first.zip', 'b'*40, self.root)

    @unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1', 'Requires local socket permission')
    def test_occupied_port_fails_then_recovers(self):
        self.kit()
        pc.create_settings(self.root)
        with patch.object(pc, 'host_check'), patch.object(pc, 'validate_environment', return_value=sys.executable), \
                patch.object(pc, 'command', return_value='{}'):
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); sock.listen()
                port = sock.getsockname()[1]
                self.assertFalse(pc.check(port, root=self.root)['ready'])
            self.assertTrue(pc.check(port, root=self.root)['ready'])


if __name__ == '__main__':
    unittest.main()
