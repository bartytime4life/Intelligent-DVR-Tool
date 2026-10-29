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
import unittest
from unittest.mock import patch

from edge.local_service import Jobs, JobError, LocalServer, load_catalog, video_header, VIDEO_BYTES
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
    def test_deadline_kills_hung_process(self):
        process = FakeProcess()
        service = self.service(wall_seconds=.1, process_factory=lambda *a, **k: process)
        self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'TIME_LIMIT')
        self.assertTrue(process.killed)
    def test_unpinned_changed_model_is_not_executed(self):
        service = self.service(process_factory=lambda *a, **k: self.fail('must not start'))
        (self.root / 'model.onnx').write_bytes(b'changed')
        self.start(service)
        self.assertEqual(self.finish(service)['error']['code'], 'MODEL_CHANGED')
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
        job = service.start({'recording':recording,'model':'synthetic','rules':'presence'})
        final = self.finish(service)
        self.assertEqual(final['state'], 'completed', final)
        self.assertEqual(final['frames_analyzed'], 6)
        result, _ = service.artifact(job['id'], 'result')
        source, _ = service.artifact(job['id'], 'source')
        bundle = json.loads(result.read_text())
        self.assertEqual(bundle['receipt']['source_sha256'], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(bundle['receipt']['runtime']['backend_id'], 'opencv-cpu')
        self.assertEqual(bundle['receipt']['frames_analyzed'], 6)
        self.assertEqual(len(bundle['receipt']['events']), 1)
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
