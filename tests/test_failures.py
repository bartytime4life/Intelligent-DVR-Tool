"""Fixed worker failure codes: written by children, parsed strictly by parents. No devices."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from edge import failures
from edge.failures import ANALYSIS, CAPTURE, FEED, Failure, code_of, exit_cause, read, record
from edge.feed_worker import PinnedRelay, relay_messages, relayed

NATIVE = all(importlib.util.find_spec(x) for x in ('cv2', 'numpy', 'onnx', 'av'))


class FailureFileTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)

    def test_children_write_one_allowlisted_code_and_never_native_text(self):
        for error, allowed, expected in ((Failure('NO_FRAMES', 'No frames in /home/user/clip.mp4'), ANALYSIS, 'NO_FRAMES'),
                                         (MemoryError('allocating 4 GiB'), ANALYSIS, 'MEMORY_LIMIT'),
                                         (ImportError('No module named cv2'), CAPTURE, 'DEPENDENCY_MISSING'),
                                         (Failure('HTTP_STATUS_4XX'), CAPTURE, None),  # Wrong worker allowlist.
                                         (RuntimeError('rtsp://viewer:secret@192.168.1.5/x'), FEED, None)):
            with self.subTest(error=type(error).__name__, expected=expected):
                (self.root / 'failure.json').unlink(missing_ok=True)
                self.assertEqual(record(self.root, error, allowed), expected)
                if expected:
                    self.assertEqual(json.loads((self.root / 'failure.json').read_text()), {'code': expected})
                    self.assertEqual(read(self.root, allowed), expected)
                else:
                    self.assertFalse((self.root / 'failure.json').exists())
                self.assertFalse((self.root / 'failure.tmp').exists())
        cv2_error = type('error', (Exception,), {'__module__': 'cv2'})('Failed to allocate'); cv2_error.code = -4
        self.assertEqual(code_of(cv2_error), 'MEMORY_LIMIT')
        self.assertTrue(set(CAPTURE) | set(FEED) | set(ANALYSIS) >= failures.EXITS)

    def test_parent_parse_is_strict(self):
        for text in ('{"code":"NO_FRAMES","detail":"x"}', '{"code":1}', '[]', '{"code":"NO_FRAMES",', 'x' * 2000,
                     '{"code":"NO_FRAMES","code":"CPU_LIMIT"}', '{"code":"UNLISTED"}'):
            with self.subTest(text=text[:40]):
                (self.root / 'failure.json').write_text(text); self.assertIsNone(read(self.root, ANALYSIS))
        (self.root / 'failure.json').unlink(); self.assertIsNone(read(self.root, ANALYSIS))
        target = self.root / 'elsewhere.json'; target.write_text('{"code":"NO_FRAMES"}')
        with contextlib.suppress(OSError):
            (self.root / 'failure.json').symlink_to(target)
            self.assertIsNone(read(self.root, ANALYSIS))  # Never follows a link.

    def test_signal_and_status_classification(self):
        self.assertEqual([exit_cause(c) for c in (None, 0, 1, 2, 72, 75)], [None] * 6)
        self.assertEqual([exit_cause(c) for c in (-24, -25, -9, -11, -6)],
                         ['CPU_LIMIT', 'FILE_SIZE_LIMIT', 'WORKER_KILLED', 'WORKER_CRASHED', 'WORKER_CRASHED'])

    def test_analysis_worker_records_codes_and_reraises(self):
        from edge import analysis_worker
        (self.root / 'args.json').write_text('[]')
        for error, expected in ((Failure('STRIDE_EXCEEDS_GAP'), 'STRIDE_EXCEEDS_GAP'), (MemoryError(), 'MEMORY_LIMIT'),
                                (RuntimeError('native text'), None)):
            with self.subTest(expected=expected), patch.dict(os.environ), \
                    patch.object(analysis_worker, 'constrain', return_value=None), patch('edge.analyze.main', side_effect=error):
                (self.root / 'failure.json').unlink(missing_ok=True)
                os.environ.pop('DVR_ANALYSIS_PARENT_PIPE', None)
                with self.assertRaises(type(error)): analysis_worker.run(self.root)
                self.assertEqual(read(self.root, ANALYSIS), expected)


@unittest.skipUnless(NATIVE, 'Install the pinned native edge requirements')
class AnalyzerCodeTest(unittest.TestCase):
    def setUp(self):
        from local_analysis_fixture import build
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = build(self.temp.name)

    def analyze(self, video='synthetic.webm', model='fixture.onnx', rules='rules.json'):
        from edge.analyze import main
        args = ['--video', str(self.root / 'recordings' / video), '--model', str(self.root / model),
                '--labels', str(self.root / 'labels.json'), '--rules', str(self.root / rules),
                '--output', str(self.root / 'receipt.json'), '--review-output', str(self.root / 'review.json')]
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            try:
                main(args, local_capture=True)
            except BaseException as error:  # SystemExit keeps the CLI status; the code rides along.
                return type(error), code_of(error)
        return None, None

    def test_cli_refusals_keep_argparse_exit_and_carry_fixed_codes(self):
        self.assertEqual(self.analyze(video='invalid.mp4'), (SystemExit, 'VIDEO_OPEN_FAILED'))
        (self.root / 'gap.json').write_text('[{"name":"all","label":"person","rect":[0,0,1,1],"max_gap":0.2}]')
        self.assertEqual(self.analyze(rules='gap.json'), (SystemExit, 'STRIDE_EXCEEDS_GAP'))
        (self.root / 'broken.onnx').write_bytes(b'not an onnx graph')
        kind, code = self.analyze(model='broken.onnx')
        self.assertEqual(code, 'MODEL_LOAD_FAILED'); self.assertNotEqual(kind, SystemExit)
        self.assertEqual(self.analyze(), (None, None))
        self.assertFalse(any(self.root.glob('failure.*')))

    def test_model_is_hashed_once_and_its_hash_stays_bound_into_the_receipt(self):
        from edge import analyze
        calls = []; original = analyze.digest
        def counted(path): calls.append(Path(path).name); return original(path)
        with patch.object(analyze, 'digest', counted): self.assertEqual(self.analyze(), (None, None))
        self.assertEqual(calls.count('fixture.onnx'), 1)
        receipt = json.loads((self.root / 'receipt.json').read_text())
        expected = json.loads((self.root / 'config.json').read_text())['models'][0]['sha256']
        self.assertEqual(receipt['model_sha256'], expected)
        self.assertEqual(json.loads((self.root / 'review.json').read_text())['trace']['model_sha256'], expected)


class RelayCodeTest(unittest.TestCase):
    def relay(self, data, statuses=None):
        class Writer:
            def sendall(self, data): pass
        relay_messages(io.BytesIO(data), Writer(), statuses.append if statuses is not None else None)

    def test_rtsp_redirects_malformed_replies_and_statuses_have_fixed_codes(self):
        for data, code in ((b'RTSP/1.0 302 Found\r\nLocation: rtsp://169.254.169.254/x\r\n\r\n', 'REDIRECT_REFUSED'),
                           (b'RTSP/1.0 200 OK\r\nLocation: rtsp://8.8.8.8/x\r\n\r\n', 'REDIRECT_REFUSED'),
                           (b'HTTP/1.1 200 OK\r\n\r\n', 'RTSP_RESPONSE_INVALID'),
                           (b'RTSP/1.0 200 OK\r\nContent-Length: 65537\r\n\r\n', 'RTSP_RESPONSE_INVALID'),
                           (b'$\x00\x00\x05test', 'STREAM_INTERRUPTED')):
            with self.subTest(code=code), self.assertRaises(ValueError) as raised: self.relay(data)
            self.assertEqual(raised.exception.failure, code)
        statuses = []; self.relay(b'RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\n\r\nRTSP/1.0 200 OK\r\nCSeq: 2\r\n\r\n', statuses)
        self.assertEqual(statuses, [401, 200])

    def test_relay_cause_refines_decoder_failures_without_endpoint_details(self):
        relay = PinnedRelay.__new__(PinnedRelay)
        for failure, status, expected in ((None, None, 'STREAM_OPEN_FAILED'), ('UPSTREAM_UNREACHABLE', 401, 'UPSTREAM_UNREACHABLE'),
                                          (None, 401, 'RTSP_UNAUTHORIZED'), (None, 403, 'RTSP_UNAUTHORIZED'), (None, 404, 'RTSP_NOT_FOUND'),
                                          (None, 454, 'RTSP_STATUS_4XX'), (None, 503, 'RTSP_STATUS_5XX'), (None, 200, 'STREAM_OPEN_FAILED')):
            relay.failure, relay.status = failure, status
            self.assertEqual(relay.cause('STREAM_OPEN_FAILED'), expected)
        relay.failure, relay.status, relay.close = None, 404, Mock()
        def opening(): raise Failure('STREAM_OPEN_FAILED', 'No stream')
        with self.assertRaises(Failure) as raised: relayed(relay, opening)
        self.assertEqual(raised.exception.failure, 'RTSP_NOT_FOUND'); relay.close.assert_called_once()
        def oversized(): raise Failure('DIMENSIONS_UNSUPPORTED')
        with self.assertRaises(Failure) as raised: relayed(relay, oversized)
        self.assertEqual(raised.exception.failure, 'DIMENSIONS_UNSUPPORTED')  # Not a stream failure.


class PublicCodeTest(unittest.TestCase):
    def test_http_status_class_redirect_encoding_and_content_type(self):
        from edge import public_feed as public
        from test_public_feed import SOURCE, Response
        for status, headers, code in ((302, {'Location': 'http://169.254.169.254/'}, 'REDIRECT_REFUSED'),
                                      (200, {'Location': 'https://other.org/'}, 'REDIRECT_REFUSED'),
                                      (401, {}, 'HTTP_STATUS_4XX'), (404, {}, 'HTTP_STATUS_4XX'), (503, {}, 'HTTP_STATUS_5XX'),
                                      (204, {}, 'HTTP_STATUS_OTHER'), (200, {'Content-Encoding': 'gzip'}, 'HTTP_RESPONSE_INVALID')):
            response = Response(**headers); response.status = status; connection = Mock(); connection.getresponse.return_value = response
            with self.subTest(status=status, headers=list(headers)), self.assertRaises(ValueError) as raised:
                public.open_image(SOURCE, lambda *a, **k: connection)
            self.assertEqual(raised.exception.failure, code)
        for error, code in ((ssl.SSLCertVerificationError('bad certificate'), 'TLS_VERIFY_FAILED'), (ssl.SSLError('handshake'), 'TLS_FAILED'),
                            (socket.gaierror('no name'), 'DNS_FAILED'), (TimeoutError(), 'HTTP_TIMEOUT'),
                            (ConnectionRefusedError(), 'CONNECT_FAILED')):
            connection = Mock(); connection.request.side_effect = error
            with self.subTest(code=code), self.assertRaises(type(error)) as raised: public.open_image(SOURCE, lambda *a, **k: connection)
            self.assertEqual(raised.exception.failure, code)
        with self.assertRaises(ValueError) as raised:
            public.resolve_public(SOURCE['host'], lambda *a: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.1', 443))])
        self.assertEqual(raised.exception.failure, 'ADDRESS_REFUSED')
        if importlib.util.find_spec('cv2'):
            connection = Mock()
            with patch.object(public, 'open_image', return_value=(connection, Response(b'<html>', **{'Content-Type': 'text/html'}))), \
                    self.assertRaises(ValueError) as raised:
                public.capture_public(SOURCE, Path('.'))
            self.assertEqual(raised.exception.failure, 'CONTENT_TYPE_REFUSED')
        for data, code in ((b'<html>', 'IMAGE_INVALID'), (b'\xff\xd8' + b'x' * (public.MAX_IMAGE + 1), 'IMAGE_LIMIT')):
            with self.assertRaises(ValueError) as raised: public.image_bytes(Response(data))
            self.assertEqual(raised.exception.failure, code)
        self.assertTrue(all(code in FEED for code in ('TLS_VERIFY_FAILED', 'HTTP_STATUS_4XX', 'CONTENT_TYPE_REFUSED', 'IMAGE_LIMIT')))


class FeedCauseTest(unittest.TestCase):
    def test_exited_preview_keeps_cause_and_specific_message(self):
        from edge.local_feeds import CAUSES, Feeds
        from test_local_feeds import Process, SOURCE
        now = [100.]
        for written, code, cause in (('{"code":"RTSP_UNAUTHORIZED"}', 1, 'RTSP_UNAUTHORIZED'), ('{"code":"rtsp://x"}', 1, None),
                                     (None, -24, 'CPU_LIMIT')):
            with self.subTest(cause=cause):
                service = Feeds({'dock': SOURCE}, clock=lambda: now[0], process_factory=lambda *a, **k: Process())
                try:
                    state = service.connect({'source': 'dock'}); session = service.sessions[state['id']]
                    if written: (Path(session['directory'].name) / 'failure.json').write_text(written)
                    session['process'].code = code
                    result = service.status(state['id'])
                    self.assertEqual((result['error']['code'], result['cause']), ('CONNECTION_FAILED', cause))
                    self.assertTrue(result['error']['message'].startswith('No usable RTSP stream. '))
                    if cause in CAUSES: self.assertTrue(result['error']['message'].endswith(CAUSES[cause]))
                    self.assertNotIn(SOURCE['password'], json.dumps(result)); self.assertNotIn(SOURCE['host'], json.dumps(result))
                finally:
                    service.close()

    @unittest.skipUnless(os.name == 'posix', 'POSIX permission bits')
    def test_shared_source_list_is_detected(self):
        from edge.local_feeds import shared_config
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'local-feeds.json'; path.write_text('{"sources": []}')
            for mode, shared in ((0o600, False), (0o640, True), (0o604, True), (0o620, False)):
                os.chmod(path, mode); self.assertEqual(shared_config(path), shared)
            self.assertFalse(shared_config(Path(directory) / 'missing.json'))


@unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1' and NATIVE and sys.platform in ('linux', 'win32'),
                     'Requires controlled loopback sockets')
class NativeWorkerCodeTest(unittest.TestCase):
    def worker(self, module, directory, source, *extra, parent):
        # The private stdin pipe stays open: its closure is the worker's parent-lifetime lease.
        child = subprocess.Popen([sys.executable, '-m', module, str(directory), *extra], cwd=Path(__file__).resolve().parents[1],
                                 stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 env={**os.environ, parent: str(os.getpid())})
        try:
            child.stdin.write(json.dumps(source).encode() + b'\n'); child.stdin.flush()
            code = child.wait(timeout=60)
        finally:
            if child.poll() is None: child.kill(); child.wait()
            child.stdin.close()
        return code, read(directory, CAPTURE if module.endswith('segment_worker') else FEED)

    def test_actual_workers_report_rtsp_causes_without_endpoint_details(self):
        from local_feeds_fixture import SyntheticRtsp, sources
        fixture = SyntheticRtsp(); configured = sources(fixture.server_address[1])
        try:
            with socket.socket() as closed:
                closed.bind(('127.0.0.1', 0)); unused = closed.getsockname()[1]
            cases = ((configured['missing'], 'RTSP_NOT_FOUND'), (configured['redirect'], 'REDIRECT_REFUSED'),
                     ({**configured['video'], 'password': 'wrong'}, 'RTSP_UNAUTHORIZED'),
                     ({**configured['video'], 'port': unused}, 'UPSTREAM_UNREACHABLE'))
            for source, expected in cases:
                for module, extra, parent in (('edge.segment_worker', ('5',), 'DVR_SEGMENT_PARENT_PID'),
                                              ('edge.feed_worker', (), 'DVR_FEED_PARENT_PID')):
                    with self.subTest(module=module, expected=expected), tempfile.TemporaryDirectory() as directory:
                        code, cause = self.worker(module, Path(directory), source, *extra, parent=parent)
                        self.assertEqual((code, cause), (1, expected))
                        text = (Path(directory) / 'failure.json').read_text()
                        self.assertNotIn('127.0.0.1', text); self.assertNotIn('fixture-secret', text)
        finally:
            fixture.close()


if __name__ == '__main__': unittest.main()
