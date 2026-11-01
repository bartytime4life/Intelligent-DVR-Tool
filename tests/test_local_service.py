import contextlib
from email.message import Message
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from edge.local_service import Handler, Jobs, JobError, LocalServer, content_type, load_catalog, video_header, VIDEO_BYTES
from local_analysis_fixture import build

AVAILABLE = all(importlib.util.find_spec(x) for x in ('cv2', 'numpy', 'onnx'))


class FakeProcess:
    def __init__(self, code=None): self.returncode = code; self.killed = False
    def poll(self): return self.returncode
    def kill(self): self.killed = True; self.returncode = -9
    def wait(self): return self.returncode


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.recordings = self.root / 'recordings'; self.recordings.mkdir()
        (self.recordings / 'video.avi').write_bytes(b'RIFF\0\0\0\0AVI ' + b'fixture')
        (self.root / 'model.onnx').write_bytes(b'fake')
        (self.root / 'labels.json').write_text('["person"]')
        (self.root / 'rules.json').write_text('[{"name":"all","label":"person","rect":[0,0,1,1]}]')
        self.config = self.root / 'config.json'
        self.config.write_text(json.dumps({'models': [{'id':'model','name':'Test model','path':'model.onnx',
            'labels':'labels.json','profile':'yolov8-raw-640', 'sha256':hashlib.sha256(b'fake').hexdigest()}],
            'rules':[{'id':'rules','name':'Presence','path':'rules.json'}]}))
        self.services = []
    def tearDown(self):
        for service in self.services: service.close()
        self.temp.cleanup()
    def service(self, **kwargs):
        service = Jobs(self.recordings, load_catalog(self.config), **kwargs)
        self.services.append(service)
        service.available()
        return service
    def start(self, service):
        return service.start({'recording':next(iter(service.choices)), 'model':next(iter(service.catalog['models'])), 'rules':next(iter(service.catalog['rules']))})
    def finish(self, service):
        service.thread.join(timeout=20)
        self.assertFalse(service.thread.is_alive())
        return service.snapshot()
    def test_paths_and_config_ids_cannot_escape(self):
        value = json.loads(self.config.read_text()); value['models'][0]['path'] = '../outside.onnx'
        self.config.write_text(json.dumps(value))
        with self.assertRaises(ValueError): load_catalog(self.config)
        self.assertFalse(video_header(b'#EXTM3U\nhttp://x'))
    def test_scan_is_shallow_and_excludes_oversized_empty_and_links(self):
        (self.recordings / 'empty.mp4').touch()
        (self.recordings / 'nested').mkdir()
        (self.recordings / 'nested' / 'hidden.avi').write_bytes(b'video')
        with (self.recordings / 'large.mp4').open('wb') as stream: stream.truncate(VIDEO_BYTES + 1)
        try: (self.recordings / 'link.avi').symlink_to(self.recordings / 'video.avi')
        except OSError: pass
        service = self.service()
        self.assertEqual([v['name'] for v in service.available()['recordings']], ['video.avi'])
    def test_unknown_ids_and_client_paths_are_rejected(self):
        service = self.service()
        for request in ({'recording':'../../secret','model':'model','rules':'rules'}, {'video':'/tmp/a'}):
            with self.assertRaises(JobError): service.start(request)
        self.assertIsNone(service.job)
    def test_changed_recording_is_rejected_and_can_recover(self):
        service = self.service(process_factory=lambda *a, **k: FakeProcess(1))
        (self.recordings / 'video.avi').write_bytes(b'changed')
        self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'SOURCE_CHANGED')
        service.available(); self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'INVALID_VIDEO')
    def test_process_failure_keeps_no_artifacts_and_retry_works(self):
        service = self.service(process_factory=lambda *a, **k: FakeProcess(7))
        first = self.start(service); state = self.finish(service)
        self.assertEqual(state['error']['code'], 'PROCESS_FAILED')
        with self.assertRaises(JobError): service.artifact(first['id'], 'result')
        self.assertEqual(list(Path(service.directory.name).iterdir()), [])
        self.assertNotEqual(self.start(service)['id'], first['id']); self.finish(service)
    def test_cancellation_stops_worker_and_refuses_concurrent_start(self):
        process = FakeProcess()
        service = self.service(process_factory=lambda *a, **k: process)
        first = self.start(service)
        deadline = time.monotonic() + 3
        while service.process is None and time.monotonic() < deadline: time.sleep(.01)
        with self.assertRaises(JobError) as raised: self.start(service)
        self.assertEqual(raised.exception.status, 409)
        service.cancel(first['id'])
        self.assertEqual(self.finish(service)['state'], 'cancelled')
        self.assertTrue(process.killed)
        self.assertEqual(list(Path(service.directory.name).iterdir()), [])
        self.assertEqual(service.cancel(first['id'])['state'], 'cancelled')
    def test_cancellation_reaps_an_actual_child_process(self):
        children = []
        def spawn(*args, **kwargs):
            child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            children.append(child)
            return child
        service = self.service(process_factory=spawn)
        job = self.start(service)
        deadline = time.monotonic() + 3
        while not children and time.monotonic() < deadline: time.sleep(.01)
        self.assertTrue(children)
        service.cancel(job['id'])
        self.assertEqual(self.finish(service)['state'], 'cancelled')
        self.assertIsNotNone(children[0].poll())
    def test_deadline_kills_hung_process(self):
        process = FakeProcess()
        spawned = threading.Event()

        def spawn(*args, **kwargs):
            # Exercise a timeout while a worker exists, not while a loaded
            # Windows CI machine is still copying the test model to disk.
            # Simulate the already-expired deadline immediately after spawn.
            service.wall_seconds = 0
            spawned.set()
            return process

        service = self.service(wall_seconds=300, process_factory=spawn)
        self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'TIME_LIMIT')
        self.assertTrue(spawned.is_set(), 'Timeout must reach a launched process')
        self.assertTrue(process.killed)
    def test_unpinned_changed_model_is_not_executed(self):
        service = self.service(process_factory=lambda *a, **k: self.fail('must not start'))
        (self.root / 'model.onnx').write_bytes(b'changed')
        self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'MODEL_CHANGED')
    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'POSIX FIFOs')
    def test_input_swapped_for_a_fifo_after_its_check_fails_without_blocking(self):
        from edge import local_service
        service = self.service(process_factory=lambda *a, **k: self.fail('must not start'))
        model, original = self.root / 'model.onnx', local_service.regular
        def swap(path, limit):
            checked = original(path, limit)
            if Path(path).name == 'model.onnx': model.unlink(); os.mkfifo(model)
            return checked
        try:
            with patch('edge.local_service.regular', swap):
                self.start(service); service.thread.join(timeout=5)
            self.assertFalse(service.thread.is_alive(), 'Opening the FIFO blocked the job')
            self.assertEqual(service.snapshot()['error']['code'], 'INPUT_CHANGED')
        finally:
            # Release a reader stuck in open() if the non-blocking guard regresses.
            with contextlib.suppress(OSError): os.close(os.open(model, os.O_WRONLY | os.O_NONBLOCK))
    def test_changed_rules_cannot_run_with_stale_displayed_choices(self):
        service = self.service(process_factory=lambda *a, **k: self.fail('must not start'))
        (self.root / 'rules.json').write_text('[{"name":"changed","label":"person","rect":[0,0,1,1]}]')
        self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'CONFIG_CHANGED')
    def test_wrong_source_result_is_rejected(self):
        def process(command, **kwargs):
            directory = Path(command[-1]); h = '0' * 64
            r = {key:h for key in ('source_sha256','model_sha256','labels_sha256','rules_file_sha256')}
            r['state'] = 'completed'
            (directory/'review.json').write_text(json.dumps({'schema':'intelligent-dvr.recognition-review.v1','receipt':r,'trace':r}))
            return FakeProcess(0)
        service = self.service(process_factory=process); self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'RESULT_MISMATCH')
    def test_worker_failure_codes_are_parsed_strictly_and_signal_deaths_classified(self):
        from edge.failures import ANALYSIS
        cases = [('{"code":"NO_FRAMES"}', 1, 'NO_FRAMES'), ('{"code":"STRIDE_EXCEEDS_GAP"}', 1, 'STRIDE_EXCEEDS_GAP'),
                 ('{"code":"MEDIA_CORRUPT"}', 1, 'MEDIA_CORRUPT'),
                 ('{"code":"NO_FRAMES","path":"/home/user/private.mp4"}', 1, 'PROCESS_FAILED'),
                 ('{"code":"/home/user/private.mp4"}', 1, 'PROCESS_FAILED'), ('{"code":["NO_FRAMES"]}', 1, 'PROCESS_FAILED'),
                 ('{"code":"NO_FRAMES","code":"CPU_LIMIT"}', 1, 'PROCESS_FAILED'), ('{"code":"' + 'A' * 2000 + '"}', 1, 'PROCESS_FAILED'),
                 (None, -24, 'CPU_LIMIT'), (None, -25, 'FILE_SIZE_LIMIT'), (None, -9, 'WORKER_KILLED'),
                 (None, -11, 'WORKER_CRASHED'), (None, 1, 'PROCESS_FAILED')]
        for written, code, expected in cases:
            with self.subTest(written=written and written[:60], code=code):
                def process(command, **kwargs):
                    if written: (Path(command[-1]) / 'failure.json').write_text(written)
                    return FakeProcess(code)
                service = self.service(process_factory=process); self.start(service); state = self.finish(service)
                self.assertEqual(state['error']['code'], expected)
                if expected != 'PROCESS_FAILED': self.assertEqual(state['error']['message'], ANALYSIS[expected])
                self.assertNotIn('/home/user', json.dumps(state))
                self.assertEqual(list(Path(service.directory.name).iterdir()), [])
        from edge.failures import exit_cause
        with patch('edge.failures.sys.platform', 'win32'):
            self.assertEqual([exit_cause(c) for c in (0xC0000017, 0xC000012D, 0xC0000005, 1)],
                             ['MEMORY_LIMIT', 'MEMORY_LIMIT', 'WORKER_CRASHED', None])
    @unittest.skipUnless(sys.platform == 'linux', 'Opt-in --state-dir (and its diagnostic log) is Linux-only')
    def test_diagnostic_log_is_opt_in_private_codes_only_and_survives_store_inspection(self):
        from edge.result_store import ResultStore
        service = self.service(process_factory=lambda *a, **k: FakeProcess(1))
        self.assertIsNone(service.diagnostics.directory)  # Off without a state directory.
        self.start(service); self.finish(service)
        self.assertFalse(any(p.name.startswith('service.log') for p in self.root.rglob('*')))
        state = self.root / 'state'
        def failing(command, **kwargs):
            (Path(command[-1]) / 'failure.json').write_text('{"code":"VIDEO_OPEN_FAILED"}'); return FakeProcess(1)
        service = self.service(process_factory=failing, state_dir=state); self.start(service); self.finish(service)
        service.diagnostics.event('PROBE', path=str(self.root / 'video.avi'), url='rtsp://viewer:secret@192.168.1.5/x',
                                  user='alice', name='video.avi', count=3, ratio=.25, job='a' * 32)
        log = state / 'diagnostics' / 'service.log'; text = log.read_text()
        self.assertIn('JOB_FINISHED job=', text); self.assertIn('code=VIDEO_OPEN_FAILED', text)
        self.assertIn('count=3 ratio=0.25 job=' + 'a' * 32, text)
        for leaked in (str(self.root), 'video.avi', 'secret', '192.168', 'alice', 'Test model', 'Presence'):
            self.assertNotIn(leaked, text)
        self.assertEqual(text.count('REDACTED'), 4)
        self.assertEqual((state / 'diagnostics').stat().st_mode & 0o777, 0o700)
        self.assertEqual(log.stat().st_mode & 0o777, 0o600)
        service.close(); self.services.remove(service)
        reopened = ResultStore(state); reopened.close()  # The log folder is an expected store entry.
        ResultStore(state, inspect_only=True).close()
        (state / 'diagnostics' / 'notes.txt').write_text('x'); os.chmod(state / 'diagnostics' / 'notes.txt', 0o600)
        with self.assertRaises(ValueError): ResultStore(state)
    def test_diagnostic_log_rotates_at_one_mebibyte_across_three_files(self):
        from edge.diagnostics import Diagnostics, LIMIT, NAMES
        directory = self.root / 'diagnostics'; log = Diagnostics(directory)
        for i in range(3 * LIMIT // 60 + 2000):
            log.event('SEGMENT_REMOVED', segment=format(i, '032x'), reason='EXPIRED_AGE')
        files = sorted(p.name for p in directory.iterdir())
        self.assertEqual(files, sorted(NAMES))
        self.assertTrue(all((directory / name).stat().st_size <= LIMIT for name in files))
        newest = (directory / NAMES[0]).read_text().splitlines()[-1]
        self.assertTrue(newest.endswith('segment=' + format(i, '032x') + ' reason=EXPIRED_AGE'))
        Diagnostics(None).event('ANY', value='/no/log')  # Disabled logging is a no-op.
    def test_disk_or_process_spawn_failure_is_actionable_and_recoverable(self):
        def broken(*args, **kwargs): raise OSError('sensitive /host/path')
        service = self.service(process_factory=broken); self.start(service)
        state = self.finish(service)
        self.assertEqual(state['state'], 'failed')
        self.assertNotIn('/host/path', json.dumps(state))
        self.assertIn('disk space', state['error']['message'])
    def test_shutdown_cancels_and_removes_retained_inputs(self):
        service = self.service(process_factory=lambda *a, **k: FakeProcess())
        self.start(service); directory = service.directory.name
        service.close()
        self.assertEqual(service.snapshot()['state'], 'cancelled')
        self.assertFalse(Path(directory).exists())
        with self.assertRaises(JobError): self.start(service)
    def test_unknown_job_and_restart_do_not_replay(self):
        first = self.service(); self.assertIsNone(first.available()['job'])
        with self.assertRaises(JobError): first.snapshot('0' * 32)
        second = self.service()
        self.assertNotEqual(first.token, second.token)
        self.assertIsNone(second.snapshot())
    @unittest.skipUnless(AVAILABLE, 'Native synthetic inference dependencies required')
    def test_real_analyzer_success_progress_and_source_binding(self):
        build(self.root / 'native')
        service = Jobs(self.root/'native/recordings', load_catalog(self.root/'native/config.json'))
        self.services.append(service)
        choices = service.available()['recordings']
        recording = next(v['id'] for v in choices if v['name'] == 'synthetic.webm')
        # A configured camera ID may begin with '-'; it must stay a value, not an option.
        job = service.start({'recording':recording,'model':'synthetic','rules':'presence'}, camera='-dash-camera')
        final = self.finish(service)
        self.assertEqual(final['state'], 'completed', final)
        self.assertEqual(final['frames_analyzed'], 6)
        result, _ = service.artifact(job['id'], 'result')
        source, mime = service.artifact(job['id'], 'source')
        bundle = json.loads(result.read_text())
        self.assertEqual(bundle['receipt']['camera'], '-dash-camera')
        self.assertEqual(mime, 'video/webm')
        stream, _ = service.open_artifact(job['id'], 'source')
        with stream: self.assertEqual(stream.read(), source.read_bytes())
        self.assertEqual(bundle['receipt']['source_sha256'], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(bundle['receipt']['runtime']['backend_id'], 'opencv-cpu')
        self.assertEqual(bundle['receipt']['frames_analyzed'], 6)
        self.assertEqual(len(bundle['receipt']['events']), 1)
    def handler(self, path, **headers):
        # The production handler and guards with in-memory transport.
        h = Handler.__new__(Handler)
        h.server = SimpleNamespace(origin='http://127.0.0.1:4183', token='secret', jobs=None, feeds=None,
                                   static_root=self.root.resolve(), server_port=4183)
        # The client socket belongs to this account unless a test says otherwise.
        self.enterContext(patch('edge.local_service.peer_uid', return_value=getattr(os, 'getuid', lambda: None)()))
        h.client_address = ('127.0.0.1', 1); h.command = 'GET'; h.path = path
        h.headers = Message(); h.headers['Host'] = '127.0.0.1:4183'
        for key, value in headers.items(): h.headers[key] = value
        h.responses = []; h._json = lambda value, status=200: h.responses.append((status, value['error']['code']))
        h._file = lambda stream, mime: (stream.close(), h.responses.append((200, mime)))
        return h
    def test_static_and_media_types_ignore_platform_registry_overrides(self):
        expected = {'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8',
                    'worker.mjs': 'text/javascript; charset=utf-8', 'site.css': 'text/css; charset=utf-8',
                    'data.json': 'application/json', 'icon.svg': 'image/svg+xml', 'model.wasm': 'application/wasm',
                    'a.png': 'image/png', 'a.jpg': 'image/jpeg', 'a.webp': 'image/webp', 'font.woff2': 'font/woff2',
                    'favicon.ico': 'image/x-icon', 'NOTICE.txt': 'text/plain; charset=utf-8', 'blob.bin': 'application/octet-stream',
                    'clip.webm': 'video/webm', 'CLIP.MP4': 'video/mp4'}
        for name in expected: (self.root / name).write_bytes(b'x')
        # e.g. a Windows registry mapping .js to text/plain, which nosniff turns into a blank UI.
        with patch('mimetypes.guess_type', return_value=('text/plain', None)):
            for name, mime in expected.items():
                with self.subTest(name=name):
                    h = self.handler('/' + name); h.do_GET(); self.assertEqual(h.responses, [(200, mime)])
        self.assertEqual(content_type(Path('x.AVI')), 'video/x-msvideo')
    @unittest.skipUnless(sys.platform in ('linux', 'darwin'), 'RLIMIT_CPU is the Linux/macOS backstop')
    def test_worker_cpu_backstop_covers_every_thread_for_the_whole_wall_deadline(self):
        from edge.local_service import LIMITS
        script = ('import resource, sys; from edge import analysis_worker as a; a.constrain(*map(int, sys.argv[1:])); '
                  'print(*resource.getrlimit(resource.RLIMIT_CPU))')
        def limit(*args):
            return subprocess.run([sys.executable, '-c', script, *map(str, args)], capture_output=True, check=True, timeout=20).stdout.split()
        soft, hard = map(int, limit())
        # Two inference plus two decoder threads may each run for all 300 wall seconds.
        self.assertGreaterEqual(soft, 2 * LIMITS['threads'] * LIMITS['wall_seconds']); self.assertEqual(hard, soft + 1)
        self.assertEqual(limit(2 * 1024**3, 300), [b'300', b'301'])  # Explicit callers keep their own bound.
    def test_localhost_page_loads_redirect_to_exact_origin_and_api_stays_refused(self):
        h = self.handler('/?x'); del h.headers['Host']; h.headers['Host'] = 'localhost:4183'
        h.send_response = h.responses.append; h.end_headers = lambda: None
        h.send_header = lambda key, value: h.responses.append((key, value))
        h.do_GET()
        self.assertEqual(h.responses, [307, ('Location', 'http://127.0.0.1:4183/'), ('Content-Length', '0'), ('Cache-Control', 'no-store')])
        for path, command, host in (('/api/analysis/session', 'GET', 'localhost:4183'), ('/', 'POST', 'localhost:4183'),
                                    ('/', 'GET', 'localhost:9999'), ('/', 'GET', 'example.test:4183')):
            with self.subTest(path=path, command=command, host=host):
                h = self.handler(path); del h.headers['Host']; h.headers['Host'] = host; h.command = command
                h.do_GET(); self.assertEqual(h.responses, [(403, 'HOST')])
    def test_non_ascii_token_is_refused_not_a_server_error(self):
        for token in ('tokén', 'wrong', ''):
            with self.subTest(token=token):
                h = self.handler('/api/analysis/jobs/' + '0' * 32, **{'X-DVR-Token': token}); h.do_GET()
                self.assertEqual(h.responses, [(403, 'SESSION')])
    @unittest.skipUnless(sys.platform == 'linux', 'Same-account peer check uses Linux socket tables')
    def test_api_and_token_session_refuse_another_accounts_socket(self):
        (self.root / 'index.html').write_text('app')
        service = self.service()
        for path in ('/api/analysis/session', '/api/feeds/session', '/api/analysis/jobs/' + '0' * 32):
            for owner in (os.getuid() + 1, None):  # Another account, or no visible socket: fail closed.
                with self.subTest(path=path, owner=owner):
                    h = self.handler(path, **{'X-DVR-Token': 'secret'}); h.server.jobs = service
                    with patch('edge.local_service.peer_uid', return_value=owner) as lookup:
                        h.do_GET()
                    self.assertEqual(h.responses, [(403, 'ACCOUNT')]); lookup.assert_called_once_with(('127.0.0.1', 1), 4183)
        h = self.handler('/api/analysis/session'); h.server.jobs = service; h._json = lambda value, status=200: h.responses.append((status, 'token' in value))
        h.do_GET(); self.assertEqual(h.responses, [(200, True)])  # Same account: the frontend flow is unchanged.
        h = self.handler('/index.html')
        with patch('edge.local_service.peer_uid', side_effect=AssertionError('static files need no lookup')): h.do_GET()
        self.assertEqual(h.responses, [(200, 'text/html; charset=utf-8')])
    def test_socket_table_lookup_handles_byte_order_ipv4_mapped_and_missing_tables(self):
        from edge.local_service import peer_uid
        def word(octets): return '%08X' % int.from_bytes(bytes(octets), sys.byteorder)
        loop, any4 = word([127, 0, 0, 1]), word([0, 0, 0, 0])
        mapped = word([0, 0, 0, 0]) * 2 + word([0, 0, 255, 255]) + loop
        header = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n'
        row = lambda n, local, remote, uid: f'   {n}: {local} {remote} 01 00000000:00000000 00:00000000 00000000 {uid:5d}        0 1 1\n'
        tcp, tcp6 = self.root / 'tcp', self.root / 'tcp6'
        tcp.write_text(header + row(0, f'{loop}:0FA3', f'{any4}:0000', 0) + row(1, f'{loop}:0FA3', f'{loop}:C350', 1000) +
                       row(2, f'{loop}:C350', f'{loop}:0FA3', 4242))
        tcp6.write_text(header + row(0, f'{mapped}:C351', f'{mapped}:0FA3', 5151))
        tables = (str(tcp), str(tcp6))
        self.assertEqual(peer_uid(('127.0.0.1', 0xC350), 0xFA3, tables), 4242)  # The client's end, not the server's.
        self.assertEqual(peer_uid(('127.0.0.1', 0xC351), 0xFA3, tables), 5151)  # Dual-stack client socket.
        self.assertIsNone(peer_uid(('127.0.0.1', 0xC352), 0xFA3, tables))
        self.assertIsNone(peer_uid(('127.0.0.1', 0xC350), 0xFA3, (str(self.root / 'missing'),)))
    @unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1' and sys.platform == 'linux', 'Real Linux loopback sockets')
    def test_real_loopback_peer_owner_including_a_dual_stack_client(self):
        import socket
        from edge.local_service import peer_uid
        with socket.create_server(('127.0.0.1', 0)) as listener:
            port = listener.getsockname()[1]
            for family, address in ((socket.AF_INET, ('127.0.0.1', port)), (socket.AF_INET6, ('::ffff:127.0.0.1', port))):
                with self.subTest(family=family), socket.socket(family, socket.SOCK_STREAM) as client:
                    client.connect(address); accepted, peer = listener.accept()
                    with accepted: self.assertEqual(peer_uid(peer, port), os.getuid())
    @unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1', 'Set DVR_TEST_SOCKETS=1 on a host allowing loopback')
    def test_idle_connections_do_not_stall_api_calls_and_handlers_are_bounded(self):
        import socket
        service = self.service(process_factory=lambda *a, **k: FakeProcess(1))
        server = LocalServer(0, service, self.root)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        address, idle = ('127.0.0.1', server.server_port), []
        def request(path):
            conn = http.client.HTTPConnection(*address, timeout=3)
            try: conn.request('GET', path); return conn.getresponse().status
            finally: conn.close()
        try:
            # Speculative browser connections that never send a request line.
            idle += [socket.create_connection(address, timeout=3) for _ in range(server.HANDLERS - 1)]
            began = time.monotonic(); self.assertEqual(request('/api/analysis/session'), 200)
            self.assertLess(time.monotonic() - began, 2)  # Sequential serving waited 5 s per idle socket.
            idle.append(socket.create_connection(address, timeout=3)); time.sleep(.3)
            with socket.create_connection(address, timeout=3) as extra:
                try: data = extra.recv(1)
                except ConnectionResetError: data = b''
            self.assertEqual(data, b'')  # Over the bound: closed unanswered, no thread started.
            for connection in idle: connection.close()
            idle.clear(); time.sleep(.3)
            self.assertEqual(request('/api/analysis/session'), 200)
        finally:
            for connection in idle: connection.close()
            server.shutdown(); server.server_close(); thread.join()
    @unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1', 'Set DVR_TEST_SOCKETS=1 on a host allowing loopback')
    def test_http_host_origin_token_body_and_source_controls(self):
        service = self.service(process_factory=lambda *a, **k: FakeProcess(1))
        (self.root/'index.html').write_text('local app')
        server = LocalServer(0, service, self.root)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(path, method='GET', body=None, **headers):
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse(); status, data = response.status, response.read(); conn.close()
            return status, data
        try:
            self.assertEqual(request('/')[0], 200)
            self.assertEqual(request('/', Host='evil.test')[0], 403)
            self.assertEqual(request('/api/analysis/session', Origin='https://evil.test')[0], 403)
            self.assertEqual(request('/api/analysis/session', **{'Sec-Fetch-Site':'cross-site'})[0], 403)
            status, raw = request('/api/analysis/session'); self.assertEqual(status, 200)
            token = json.loads(raw)['token']; headers = {'X-DVR-Token':token, 'Content-Type':'application/json'}
            self.assertEqual(request('/api/analysis/jobs', 'POST', '{}')[0], 403)
            self.assertEqual(request('/api/analysis/jobs', 'POST', 'x'*2049, **headers)[0], 400)
            self.assertEqual(request('/api/analysis/jobs/'+'0'*32+'/source', **headers)[0], 404)
            self.assertEqual(request('/%2e%2e/config.json')[0], 404)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
