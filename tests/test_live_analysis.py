"""Live AI session contracts. Fake workers and a constant ONNX fixture: never accuracy."""
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import queue
import struct
import sys
import tempfile
import threading
import time
import unittest

from edge.live_analysis import Live, LiveError, LIMITS
from edge.live_worker import HEADER
from edge.local_service import Jobs, LocalServer, load_catalog

JPEG = b'\xff\xd8' + b'0' * 64 + b'\xff\xd9'
NATIVE = all(importlib.util.find_spec(m) for m in ('cv2', 'numpy', 'onnx'))


class FakeWorker:
    """Speaks the worker protocol from a script of replies; records what it was sent."""
    def __init__(self, replies, ready=True, exit_after=None):
        self.replies, self.returncode, self.exit_after = list(replies), None, exit_after
        self.sent, self.config = [], None
        self.out = queue.Queue()
        self.stdin = self
        self.stdout = self
        self.buffer = b''
        if ready:
            self.out.put(json.dumps({'type': 'ready', 'load_ms': 5, 'runtime': {'backend_id': 'opencv-cpu'}}).encode() + b'\n')

    # stdin
    def write(self, data):
        if self.returncode is not None:
            raise BrokenPipeError()
        self.buffer += data
        if self.config is None and b'\n' in self.buffer:
            line, self.buffer = self.buffer.split(b'\n', 1)
            self.config = json.loads(line)
        while self.config is not None and len(self.buffer) >= HEADER.size:
            seconds, length = HEADER.unpack(self.buffer[:HEADER.size])
            if length == 0:
                self.buffer = b''; self.returncode = 0; self.out.put(b''); return
            if len(self.buffer) < HEADER.size + length:
                return
            self.sent.append((seconds, self.buffer[HEADER.size:HEADER.size + length]))
            self.buffer = self.buffer[HEADER.size + length:]
            if self.exit_after is not None and len(self.sent) >= self.exit_after:
                self.returncode = 1; self.out.put(b''); return
            reply = self.replies.pop(0) if self.replies else None
            if reply is not None:
                self.out.put(json.dumps(reply).encode() + b'\n')

    def flush(self): pass
    def close(self): pass

    # stdout
    def readline(self, limit=-1):
        return self.out.get()

    def poll(self): return self.returncode
    def kill(self): self.returncode = -9; self.out.put(b'')
    def wait(self, timeout=None): return self.returncode


class StalledWorker(FakeWorker):
    """Announces readiness, then stops reading: a frame write blocks until the process is killed."""
    def __init__(self):
        super().__init__([]); self.killed = threading.Event()

    def write(self, data):
        if self.config is None:
            return super().write(data)
        self.killed.wait()
        raise BrokenPipeError()

    def kill(self):
        super().kill(); self.killed.set()


def result(**extra):
    return {'type': 'result', 'seconds': 1, 'width': 640, 'height': 360, 'motion': .1, 'detector': 'ran',
            'detections': [{'label': 'person', 'score': .9, 'box': [.1, .1, .2, .5], 'track': 1}],
            'detections_total': 1, 'tracks': [{'id': 1, 'label': 'person', 'state': 'tracked'}],
            'observations': [], 'timing': {'total_ms': 5}, **extra}


class LiveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root / 'recordings').mkdir()
        (self.root / 'model.onnx').write_bytes(b'fake')
        (self.root / 'labels.json').write_text('["person"]')
        (self.root / 'rules.json').write_text('[{"name":"all","label":"person","rect":[0,0,1,1]}]')
        (self.root / 'config.json').write_text(json.dumps({'models': [{'id': 'model', 'name': 'Test model', 'path': 'model.onnx',
            'labels': 'labels.json', 'profile': 'yolov8-raw-640', 'sha256': hashlib.sha256(b'fake').hexdigest()}],
            'rules': [{'id': 'rules', 'name': 'Presence', 'path': 'rules.json'}]}))
        self.catalog = load_catalog(self.root / 'config.json')
        self.lives = []

    def tearDown(self):
        for live in self.lives: live.close()
        self.temp.cleanup()

    def live(self, workers, **kwargs):
        made = iter(workers)
        live = Live(self.catalog, process_factory=lambda *a, **k: next(made), **kwargs)
        self.lives.append(live)
        return live

    def start(self, live, camera='Front door'):
        return live.start({'model': 'model', 'rules': 'rules', 'camera': camera})

    def test_start_sends_the_reviewed_catalog_and_frames_return_results(self):
        observation = {'id': 'a' * 32, 'camera': 'Front door', 'label': 'person', 'score': .9, 'seconds': 1,
                       'started_seconds': 1, 'rule': 'person present in all for 0s', 'review_required': True}
        worker = FakeWorker([result(observations=[observation]), result(detector='skipped-still', detections=[], tracks=[])])
        live = self.live([worker])
        session = self.start(live)
        self.assertEqual(session['state'], 'live')
        self.assertEqual(worker.config['labels'], ['person'])
        self.assertEqual(worker.config['rules'], [{'name': 'all', 'label': 'person', 'rect': [0, 0, 1, 1]}])
        self.assertEqual(worker.config['model_sha256'], hashlib.sha256(b'fake').hexdigest())
        self.assertTrue(worker.config['motion_gate'])
        first = live.frame(session['id'], JPEG)
        self.assertEqual(first['detections'][0]['track'], 1)
        second = live.frame(session['id'], JPEG + b'1')
        self.assertEqual(second['session']['analyzed'], 1)
        self.assertEqual(second['session']['skipped_still'], 1)
        self.assertEqual(second['session']['observations_total'], 1)
        self.assertEqual(second['session']['tracks_by_label'], {'person': 1})
        self.assertLess(worker.sent[0][0], worker.sent[1][0])  # Strictly increasing session time.
        stopped = live.stop(session['id'])
        self.assertEqual(stopped['state'], 'stopped')
        self.assertEqual(worker.returncode, -9)  # Stopped without writing to a possibly full pipe.
        with self.assertRaises(LiveError) as caught:
            live.frame(session['id'], JPEG)
        self.assertEqual(caught.exception.code, 'NOT_LIVE')

    def test_selection_camera_and_frame_bodies_are_validated(self):
        live = self.live([FakeWorker([result()])])
        for body in ({}, {'model': 'model', 'rules': 'rules'}, {'model': 'x', 'rules': 'rules', 'camera': 'A'},
                     {'model': 'model', 'rules': 'rules', 'camera': ''}, {'model': 'model', 'rules': 'rules', 'camera': 'a\nb'},
                     {'model': 'model', 'rules': 'rules', 'camera': 'A', 'extra': 1}):
            with self.assertRaises(LiveError):
                live.start(body)
        session = self.start(live)
        for data in (b'', b'GIF89a', b'\xff\xd8' + b'0' * (LIMITS['frame_bytes'])):
            with self.assertRaises(LiveError) as caught:
                live.frame(session['id'], data)
            self.assertEqual(caught.exception.code, 'FRAME')
        with self.assertRaises(LiveError) as caught:
            live.frame('0' * 32, JPEG)
        self.assertEqual(caught.exception.code, 'LIVE_GONE')

    def test_changed_rules_after_service_start_are_refused(self):
        live = self.live([])
        (self.root / 'rules.json').write_text('[{"name":"other","label":"person","rect":[0,0,1,1]}]')
        with self.assertRaises(LiveError) as caught:
            self.start(live)
        self.assertEqual(caught.exception.code, 'CONFIG_CHANGED')

    def test_capacity_is_two_sessions_and_a_stopped_slot_is_reusable(self):
        live = self.live([FakeWorker([]), FakeWorker([]), FakeWorker([])])
        a, b = self.start(live, 'A'), self.start(live, 'B')
        with self.assertRaises(LiveError) as caught:
            self.start(live, 'C')
        self.assertEqual(caught.exception.code, 'CAPACITY')
        live.stop(a['id'])
        self.assertEqual(self.start(live, 'C')['state'], 'live')
        self.assertEqual(live.available()['active'], 2)
        live.stop(b['id'])

    def test_one_frame_in_flight_refuses_the_next_without_queueing(self):
        gate = threading.Event()
        class Slow(FakeWorker):
            def readline(inner, limit=-1):
                line = inner.out.get()
                if line and b'"result"' in line:
                    gate.wait(3)
                return line
        live = self.live([Slow([result()])])
        session = self.start(live)
        replies = []
        thread = threading.Thread(target=lambda: replies.append(live.frame(session['id'], JPEG))); thread.start()
        deadline = time.monotonic() + 3
        while not live.sessions[session['id']]['busy'] and time.monotonic() < deadline:
            time.sleep(.01)
        with self.assertRaises(LiveError) as caught:
            live.frame(session['id'], JPEG)
        self.assertEqual((caught.exception.code, caught.exception.status), ('BUSY', 429))
        gate.set(); thread.join(3)
        self.assertEqual(len(replies), 1)
        self.assertEqual(live.status(session['id'])['refused_busy'], 1)

    def test_skippable_frame_errors_continue_and_fatal_errors_stop(self):
        worker = FakeWorker([{'type': 'error', 'code': 'FRAME_INVALID'}, result(), {'type': 'error', 'code': 'WORKER_FAILED', 'fatal': True}])
        live = self.live([worker])
        session = self.start(live)
        with self.assertRaises(LiveError) as caught:
            live.frame(session['id'], JPEG)
        self.assertEqual(caught.exception.code, 'FRAME_INVALID')
        self.assertEqual(live.frame(session['id'], JPEG)['session']['frame_errors'], 1)
        with self.assertRaises(LiveError) as caught:
            live.frame(session['id'], JPEG)
        self.assertEqual(caught.exception.code, 'WORKER_FAILED')
        self.assertEqual(live.status(session['id'])['state'], 'failed')

    def test_silent_worker_times_out_and_exited_worker_is_reported(self):
        live = self.live([FakeWorker([None]), FakeWorker([], exit_after=1)], frame_seconds=.2)
        a = self.start(live, 'A')
        with self.assertRaises(LiveError) as caught:
            live.frame(a['id'], JPEG)
        self.assertEqual(caught.exception.code, 'WORKER_TIMEOUT')
        b = self.start(live, 'B')
        with self.assertRaises(LiveError) as caught:
            live.frame(b['id'], JPEG)
        self.assertEqual(caught.exception.code, 'WORKER_EXITED')

    def test_a_worker_that_stops_reading_cannot_block_frames_or_stop(self):
        worker = StalledWorker()
        live = self.live([worker, StalledWorker()], frame_seconds=.3)
        session = self.start(live)
        began = time.monotonic()
        with self.assertRaises(LiveError) as caught:
            live.frame(session['id'], JPEG + b'0' * 200_000)
        self.assertEqual(caught.exception.code, 'WORKER_TIMEOUT')
        self.assertLess(time.monotonic() - began, 2)
        self.assertTrue(worker.killed.is_set())
        other = self.start(live, 'Other')
        codes = []
        def blocked():
            try:
                live.frame(other['id'], JPEG)
            except LiveError as error:
                codes.append(error.code)
        thread = threading.Thread(target=blocked, daemon=True)
        thread.start(); time.sleep(.1)
        began = time.monotonic()
        self.assertEqual(live.stop(other['id'])['state'], 'stopped')  # Stop does not wait on the blocked write.
        self.assertLess(time.monotonic() - began, 1)
        thread.join(2); self.assertFalse(thread.is_alive())
        self.assertEqual(codes, ['NOT_LIVE'])

    def test_start_failures_and_load_timeouts_are_actionable(self):
        def broken(*a, **k): raise OSError('sensitive /path')
        live = Live(self.catalog, process_factory=broken); self.lives.append(live)
        failed = self.start(live)
        self.assertEqual(failed['error']['code'], 'START_FAILED')
        self.assertNotIn('/path', json.dumps(failed))
        live = self.live([FakeWorker([], ready=False)], start_seconds=.2)
        self.assertEqual(self.start(live)['error']['code'], 'START_TIMEOUT')
        loading = FakeWorker([], ready=False); loading.out.put(b'{"type":"error","code":"MODEL_LOAD_FAILED","fatal":true}\n')
        live = self.live([loading])
        self.assertEqual(self.start(live)['error']['code'], 'MODEL_LOAD_FAILED')

    def test_lease_expires_when_the_page_stops_sending_frames(self):
        live = self.live([FakeWorker([])], lease_seconds=.3)
        session = self.start(live)
        deadline = time.monotonic() + 5
        while live.sessions[session['id']]['state'] == 'live' and time.monotonic() < deadline:
            time.sleep(.05)
        self.assertEqual(live.sessions[session['id']]['error']['code'], 'LEASE_EXPIRED')


@unittest.skipUnless(NATIVE, 'Native edge test requirements needed')
class LiveWorkerTest(unittest.TestCase):
    """Runs the actual worker with constant-output ONNX fixtures over its private pipe."""
    def setUp(self):
        from tests.local_analysis_fixture import build
        self.temp = tempfile.TemporaryDirectory()
        self.root = build(Path(self.temp.name) / 'fixture')

    def tearDown(self):
        self.temp.cleanup()

    def model(self, score):
        import numpy as np
        import onnx
        from onnx import numpy_helper
        model = onnx.load(str(self.root / 'fixture.onnx'))
        for i, tensor in enumerate(model.graph.initializer):
            if tensor.name == 'bias':
                model.graph.initializer[i].CopyFrom(numpy_helper.from_array(np.array([320, 320, 160, 160, score], dtype=np.float32), 'bias'))
        path = self.root / f'score-{score}.onnx'
        onnx.save(model, str(path))
        return path

    def run_worker(self, model, frames, rules=None):
        import cv2
        import numpy as np
        from edge import live_worker
        config = {'model': str(model), 'model_sha256': hashlib.sha256(model.read_bytes()).hexdigest(),
                  'profile': 'yolov8-raw-640', 'labels': ['person'],
                  'rules': rules or [{'name': 'all', 'label': 'person', 'rect': [0, 0, 1, 1]}],
                  'camera': 'Fixture camera', 'run_id': 'f' * 32, 'motion_gate': True}
        stream = io.BytesIO()
        stream.write(json.dumps(config).encode() + b'\n')
        for i, frame in enumerate(frames):
            data = frame if isinstance(frame, bytes) else cv2.imencode('.jpg', frame)[1].tobytes()
            stream.write(HEADER.pack(.5 * (i + 1), len(data)) + data)
        stream.write(HEADER.pack(0, 0)); stream.seek(0)
        out = io.BytesIO()
        live_worker.run(stream, out)
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_worker_detects_tracks_and_observes_with_the_fixture_model(self):
        import numpy as np
        frames = [np.full((240, 320, 3), 60 + 40 * (i % 2), dtype=np.uint8) for i in range(4)]
        lines = self.run_worker(self.root / 'fixture.onnx', frames + [b'\xff\xd8not-a-jpeg\xff\xd9'])
        self.assertEqual(lines[0]['type'], 'ready')
        results = lines[1:5]
        self.assertTrue(all(r['type'] == 'result' and r['detector'] == 'ran' for r in results))
        self.assertEqual([r['detections'][0].get('track') for r in results], [1, 1, 1, 1])
        self.assertEqual(results[0]['detections'][0]['label'], 'person')
        self.assertAlmostEqual(results[0]['detections'][0]['box'][0], .375, places=3)
        self.assertEqual(len(results[0]['observations']), 1)  # Presence starts once; brief gaps do not repeat it.
        self.assertEqual(sum(len(r['observations']) for r in results), 1)
        self.assertEqual(results[0]['tracks'][0]['id'], 1)
        self.assertIn('inference_ms', results[0]['timing'])
        self.assertEqual(lines[5], {'type': 'error', 'code': 'FRAME_INVALID'})

    def test_motion_gate_rests_the_detector_on_a_still_empty_scene(self):
        import numpy as np
        still = np.full((240, 320, 3), 80, dtype=np.uint8)
        moved = still.copy(); moved[60:180, 80:240] = 220
        lines = self.run_worker(self.model(.05), [still, still, still, moved, moved])
        self.assertEqual([r['detector'] for r in lines[1:]], ['ran', 'skipped-still', 'skipped-still', 'ran', 'skipped-still'])
        self.assertTrue(all(r['detections'] == [] for r in lines[1:]))

    def test_changed_model_bytes_are_refused_before_any_frame(self):
        from edge import live_worker
        model = self.root / 'fixture.onnx'
        config = {'model': str(model), 'model_sha256': '0' * 64, 'profile': 'yolov8-raw-640', 'labels': ['person'],
                  'rules': [{'name': 'all', 'label': 'person', 'rect': [0, 0, 1, 1]}], 'camera': 'C', 'run_id': 'f' * 32,
                  'motion_gate': True}
        with self.assertRaises(live_worker.LoadFailed):
            live_worker.run(io.BytesIO(json.dumps(config).encode() + b'\n'), io.BytesIO())


@unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1', 'Set DVR_TEST_SOCKETS=1 on a host allowing loopback')
class LiveHttpTest(unittest.TestCase):
    def test_live_routes_require_the_session_token_and_a_bounded_jpeg(self):
        temp = tempfile.TemporaryDirectory(); root = Path(temp.name)
        (root / 'recordings').mkdir(); (root / 'model.onnx').write_bytes(b'fake')
        (root / 'labels.json').write_text('["person"]')
        (root / 'rules.json').write_text('[{"name":"all","label":"person","rect":[0,0,1,1]}]')
        (root / 'config.json').write_text(json.dumps({'models': [{'id': 'model', 'name': 'Test model', 'path': 'model.onnx',
            'labels': 'labels.json', 'profile': 'yolov8-raw-640', 'sha256': hashlib.sha256(b'fake').hexdigest()}],
            'rules': [{'id': 'rules', 'name': 'Presence', 'path': 'rules.json'}]}))
        jobs = Jobs(root / 'recordings', load_catalog(root / 'config.json'))
        worker = FakeWorker([result()])
        live = Live(jobs.catalog, process_factory=lambda *a, **k: worker)
        server = LocalServer(0, jobs, root, live=live)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(path, method='GET', body=None, **headers):
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse(); status, data = response.status, response.read(); conn.close()
            return status, json.loads(data or b'null')
        try:
            status, session = request('/api/analysis/session')
            self.assertEqual(status, 200)
            self.assertTrue(session['live']['enabled'])
            self.assertEqual(session['live']['rules'][0]['models'], ['model'])
            token = session['token']
            self.assertEqual(request('/api/live/start', 'POST', '{}', **{'Content-Type': 'application/json'})[0], 403)
            json_headers = {'X-DVR-Token': token, 'Content-Type': 'application/json'}
            status, started = request('/api/live/start', 'POST', json.dumps({'model': 'model', 'rules': 'rules', 'camera': 'Desk'}), **json_headers)
            self.assertEqual((status, started['state']), (201, 'live'))
            frame = f'/api/live/{started["id"]}/frame'
            self.assertEqual(request(frame, 'POST', JPEG, **{'X-DVR-Token': token, 'Content-Type': 'image/png'})[0], 400)
            self.assertEqual(request(frame, 'POST', JPEG, **{'Content-Type': 'image/jpeg'})[0], 403)
            status, reply = request(frame, 'POST', JPEG, **{'X-DVR-Token': token, 'Content-Type': 'image/jpeg'})
            self.assertEqual((status, reply['detections'][0]['track']), (200, 1))
            self.assertEqual(request(f'/api/live/{started["id"]}', **{'X-DVR-Token': token})[1]['frames'], 1)
            self.assertEqual(request(f'/api/live/{started["id"]}/stop', 'POST', '{}', **json_headers)[1]['state'], 'stopped')
        finally:
            server.shutdown(); server.server_close(); thread.join(); live.close(); jobs.close(); temp.cleanup()


if __name__ == '__main__':
    unittest.main()
