"""Same-origin owner setup and camera-independent integration checks."""
import http.client
import importlib.util
import sys
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from edge.backup_library import BackupLibrary
from edge.dvr_setup import CameraSetup, pick_folder, LibraryError
from edge.local_feeds import Feeds, load_sources
from edge.local_service import Jobs, LocalServer, load_catalog
from local_analysis_fixture import build


@unittest.skipUnless(all(importlib.util.find_spec(m) for m in ('cv2','numpy','onnx','av')), 'Native generated-video dependencies required')
class SetupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = build(Path(self.temp.name))
        self.config = self.root / 'feeds.json'
        self.config.write_text('{"sources": []}')
        self.spawns = []
        def spawn(*args, **kwargs): self.spawns.append(args); raise RuntimeError('Unexpected camera activation')
        self.feeds = Feeds({}, process_factory=spawn)
        self.setup = CameraSetup(self.feeds, self.config)
        self.jobs = Jobs(self.root / 'recordings', load_catalog(self.root / 'config.json'))
        self.library = BackupLibrary(self.jobs, self.root / 'settings', supervise=False)
        self.server = LocalServer(0, self.jobs, self.root, self.feeds, library=self.library, camera_setup=self.setup,
                                  recorder_path=self.root / 'guided-recorder.json')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.camera = dict(name='Driveway', host='192.168.1.10', port=554, path='/channel/1', username='viewer', password='private pass')
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(5)
        if self.server.recorder: self.server.recorder.close()
        self.library.close(); self.jobs.close(); self.feeds.close(); self.temp.cleanup()
    def request(self, path, body=None, *, token=True, origin=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        headers = {}
        if token: headers['X-DVR-Token'] = self.jobs.token
        if origin: headers['Origin'] = origin
        if body is not None: headers['Content-Type'] = 'application/json'
        connection.request('GET' if body is None else 'POST', path, body=None if body is None else json.dumps(body), headers=headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_camera_setup_saves_privately_without_activation_or_credential_response(self):
        code, body = self.request('/api/setup/cameras', self.camera)
        self.assertEqual(code, 201, body)
        self.assertEqual(body['created']['name'], 'Driveway')
        self.assertNotIn('private pass', json.dumps(body))
        self.assertNotIn('username', json.dumps(body))
        sources = load_sources(self.config)
        self.assertEqual(next(iter(sources.values()))['password'], 'private pass')
        self.assertEqual(len(self.feeds.sources), 1)
        self.assertEqual(self.spawns, [])
        if os.name == 'posix': self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)
        code, body = self.request('/api/setup/cameras')
        self.assertEqual(code, 200)
        self.assertEqual(body['sources'][0]['name'], 'Driveway')

    def test_setup_and_backup_require_token_and_exact_origin(self):
        for path, data in (('/api/setup/cameras', self.camera), ('/api/library/start', {'analyze': False, 'model': '', 'rules': ''})):
            self.assertEqual(self.request(path, data, token=False)[0], 403)
            self.assertEqual(self.request(path, data, origin='https://other.invalid')[0], 403)
        self.assertEqual(self.request('/api/library/status', token=False)[0], 403)
        self.assertIsNone(self.request('/api/library/status')[1]['disk_free_bytes'])
        self.assertEqual(load_sources(self.config), {})

    def test_public_addresses_and_url_paths_rejected_without_config_changes(self):
        before = self.config.read_bytes()
        for camera in ({**self.camera, 'host': '8.8.8.8'}, {**self.camera, 'host': '127.0.0.1'},
                       {**self.camera, 'path': 'rtsp://192.168.1.10/channel'}, {**self.camera, 'port': True}):
            self.assertEqual(self.request('/api/setup/cameras', camera)[0], 400)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.spawns, [])

    @unittest.skipUnless(sys.platform in ('linux','win32'), 'Existing LAN recorder supports Linux/Windows')
    def test_saved_camera_can_prepare_stopped_recorder_without_json_editing(self):
        _, saved = self.request('/api/setup/cameras', self.camera)
        code, body = self.request('/api/setup/recorder', {'source': saved['created']['id']})
        self.assertEqual(code, 200, body)
        self.assertFalse(body['active'])
        self.assertEqual(body['state'], 'stopped')
        self.assertEqual(self.spawns, [])
        code, status = self.request('/api/recorder/status')
        self.assertEqual(code, 200, status)
        self.assertFalse(status['active'])

    def test_mac_recorder_setup_refuses_before_writing_a_configuration(self):
        _, saved = self.request('/api/setup/cameras', self.camera)
        with patch('edge.local_service.sys.platform', 'darwin'):
            code, body = self.request('/api/setup/recorder', {'source': saved['created']['id']})
        self.assertEqual(code, 409, body)
        self.assertEqual(body['error']['code'], 'RECORDER_PLATFORM')
        self.assertFalse((self.root / 'guided-recorder.json').exists())
        self.assertIsNone(self.server.recorder)

    def test_library_routes_configure_and_start_backup_without_camera_activation(self):
        source = self.root / 'oem'; source.mkdir()
        settings = dict(source_folder=str(source), backup_folder=str(self.root / 'backup'),
                        max_storage_gib=100, reserve_gib=2, settle_seconds=60, recursive=True)
        code, status = self.request('/api/library/configure', settings)
        self.assertEqual(code, 200, status)
        self.assertFalse(status['active'])
        code, status = self.request('/api/library/start', {'analyze': False, 'model': '', 'rules': ''})
        self.assertEqual(code, 202, status)
        self.assertTrue(status['active'])
        self.assertEqual(self.spawns, [])
        code, status = self.request('/api/library/stop', {})
        self.assertEqual(code, 200)
        self.assertFalse(status['active'])

    def test_folder_picker_failure_has_plain_text_fallback(self):
        with patch('edge.dvr_setup.subprocess.run', side_effect=OSError):
            with self.assertRaisesRegex(LibraryError, 'Paste the folder path'):
                pick_folder()

    def test_production_entrypoint_wires_library_and_camera_setup_without_start(self):
        from edge.local_service import main
        from unittest.mock import MagicMock
        with patch('edge.local_service.LocalServer') as create:
            server = MagicMock()
            server.origin = 'http://127.0.0.1:4201'
            server.recorder = None
            create.return_value.__enter__.return_value = server
            main(['--recordings', str(self.root / 'recordings'), '--config', str(self.root / 'config.json'),
                  '--feeds-config', str(self.config), '--camera-setup-config', str(self.config), '--port', '4201'])
            args = create.call_args.args
            self.assertIsInstance(args[6], BackupLibrary)
            self.assertIsInstance(args[7], CameraSetup)
            self.assertEqual(args[8], self.root / 'guided-recorder.json')
            self.assertFalse(args[6].active)
            self.assertTrue(args[6].finished)


if __name__ == '__main__': unittest.main()
