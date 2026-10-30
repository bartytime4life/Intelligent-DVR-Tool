import hashlib
import http.client
import io
import json
import os
from email.message import Message
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from edge.recording_import import import_recording, ImportError, MAX_IMPORT_BYTES, MAX_INBOX_BYTES
from edge.local_service import Jobs, Handler, JobError, LocalServer, load_catalog
from local_analysis_fixture import build

VIDEO = b'RIFF\0\0\0\0AVI ' + b'synthetic-container'
SHA = hashlib.sha256(VIDEO).hexdigest()


class RecordingImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def receive(self, content=VIDEO, **kwargs):
        return import_recording(self.root, io.BytesIO(content), kwargs.pop('length', len(content)),
                                kwargs.pop('mime', 'video/x-msvideo'), kwargs.pop('sha', hashlib.sha256(content).hexdigest()), **kwargs)
    def test_success_is_hash_named_and_retry_is_idempotent(self):
        file, reused = self.receive()
        self.assertFalse(reused)
        self.assertEqual(file.name, 'import-' + SHA + '.avi')
        self.assertEqual(file.read_bytes(), VIDEO)
        self.assertTrue(self.receive()[1])
        self.assertEqual(len(list(self.root.iterdir())), 1)
        if os.name != 'nt': self.assertEqual(file.stat().st_mode & 0o777, 0o600)
    def test_changed_existing_import_never_overwrites(self):
        file, _ = self.receive(); file.write_bytes(b'x' * len(VIDEO))
        with self.assertRaises(ImportError): self.receive()
        self.assertEqual(file.read_bytes(), b'x' * len(VIDEO))
    def test_wrong_hash_playlist_and_mismatched_container_leave_no_files(self):
        for content, kwargs in [(VIDEO, {'sha':'0'*64}), (b'#EXTM3U\nhttps://example.test/video', {}), (VIDEO, {'mime':'video/webm'})]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ImportError): self.receive(content, **kwargs)
            self.assertEqual(list(self.root.iterdir()), [])
    def test_overflow_unsafe_mime_and_interrupted_body_leave_no_files(self):
        for kwargs in ({'length':MAX_IMPORT_BYTES+1}, {'length':len(VIDEO)+10}, {'mime':'text/plain'}, {'sha':'../unsafe'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ImportError): self.receive(**kwargs)
            self.assertEqual(list(self.root.iterdir()), [])
    def test_timeout_and_disk_reserve_fail_cleanly(self):
        with self.assertRaises(ImportError): self.receive(clock=iter([0,31]).__next__)
        with patch('edge.recording_import.shutil.disk_usage', return_value=SimpleNamespace(free=1)), self.assertRaises(ImportError): self.receive()
        self.assertEqual(list(self.root.iterdir()), [])
    def test_total_storage_and_file_limits_include_interrupted_parts(self):
        path = self.root / '.dvr-import-interrupted.part'
        with path.open('wb') as f: f.truncate(MAX_INBOX_BYTES)
        with self.assertRaises(ImportError): self.receive()
        path.unlink()
        for i in range(20): (self.root / f'import-{i}.avi').write_bytes(b'x')
        with self.assertRaises(ImportError): self.receive()

    def test_another_service_or_crash_lock_refuses_import_without_reclaim(self):
        lock=self.root/'.dvr-import.lock';lock.write_bytes(b'owner')
        with self.assertRaisesRegex(ImportError,'Another import'): self.receive()
        self.assertEqual(lock.read_bytes(),b'owner')
    @unittest.skipIf(os.name == 'nt', 'Windows symlink privileges vary')
    def test_links_are_refused_without_touching_targets(self):
        target = self.root / 'original'; target.write_bytes(VIDEO)
        (self.root / ('import-'+SHA+'.avi')).symlink_to(target)
        with self.assertRaises(ImportError): self.receive()
        self.assertEqual(target.read_bytes(), VIDEO)

    def test_request_guards_run_before_any_recording_bytes_are_read(self):
        # The production handler and guards, with in-memory transport. Real HTTP
        # remains covered by the socket-enabled CI and browser scenarios.
        jobs = SimpleNamespace(receive_recording=lambda *args: {'ok':True})
        def handler(headers):
            h=Handler.__new__(Handler)
            h.server=SimpleNamespace(origin='http://127.0.0.1:4183',token='secret',jobs=jobs,feeds=None)
            h.client_address=('127.0.0.1',1); h.command='POST'; h.path='/api/analysis/recordings'
            h.headers=Message()
            for key,value in headers: h.headers[key]=value
            h.rfile=io.BytesIO(VIDEO); h._json=lambda value,status=200:(status,value)
            return h
        valid=[('Host','127.0.0.1:4183'),('Origin','http://127.0.0.1:4183'),('X-DVR-Token','secret'),
               ('Content-Length',str(len(VIDEO))),('Content-Type','video/x-msvideo'),('X-DVR-SHA256',SHA)]
        self.assertEqual(handler(valid)._dispatch()[0],201)
        for replacement in [('Host','evil.test'),('Origin','https://evil.test'),('X-DVR-Token','wrong'),('Content-Length','bad')]:
            h=handler([(k,v) for k,v in valid if k!=replacement[0]]+[replacement])
            with self.assertRaises(JobError): h._dispatch()
            self.assertEqual(h.rfile.tell(),0)
        for extra in [('Content-Length','1'),('Transfer-Encoding','chunked'),('Content-Type','text/plain'),('X-DVR-SHA256','0'*64)]:
            with self.assertRaises(JobError): handler(valid+[extra])._dispatch()

    def test_disabled_busy_and_native_import_to_result(self):
        build(self.root)
        folder=self.root/'recordings'; catalog=load_catalog(self.root/'config.json')
        data=(folder/'synthetic.webm').read_bytes(); sha=hashlib.sha256(data).hexdigest()
        jobs=Jobs(folder,catalog)
        try:
            with self.assertRaisesRegex(JobError,'allow-recording-import'):
                jobs.receive_recording(io.BytesIO(data),len(data),'video/webm',sha)
            jobs.allow_import=True; jobs.job={'state':'running'}
            with self.assertRaisesRegex(JobError,'current analysis'):
                jobs.receive_recording(io.BytesIO(data),len(data),'video/webm',sha)
            jobs.job=None
            result=jobs.receive_recording(io.BytesIO(data),len(data),'video/webm',sha)
            self.assertIsNone(jobs.job, 'Import must not start inference')
            job=jobs.start({'recording':result['recording']['id'],'model':'synthetic','rules':'presence'})
            jobs.thread.join(20)
            self.assertEqual(jobs.snapshot()['state'],'completed',jobs.snapshot())
            bundle=json.loads(jobs.artifact(job['id'],'result')[0].read_text())
            self.assertEqual(bundle['receipt']['source_sha256'],sha)
            self.assertEqual(bundle['receipt']['frames_analyzed'],6)
            self.assertEqual(hashlib.sha256(jobs.artifact(job['id'],'source')[0].read_bytes()).hexdigest(),sha)
        finally: jobs.close()

    @unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1', 'Real loopback transport runs in CI')
    def test_real_http_binary_import_is_guarded_and_idempotent(self):
        build(self.root)
        jobs=Jobs(self.root/'recordings',load_catalog(self.root/'config.json'),allow_import=True)
        server=LocalServer(0,jobs,self.root)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(**updates):
            headers={'Host':server.origin.removeprefix('http://'),'Origin':server.origin,'X-DVR-Token':jobs.token,
                     'Content-Type':'video/x-msvideo','X-DVR-SHA256':SHA,**updates}
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            try:
                conn.request('POST','/api/analysis/recordings',body=VIDEO,headers=headers)
                response=conn.getresponse();return response.status,json.loads(response.read())
            finally: conn.close()
        try:
            for headers in ({'Origin':'https://other.test'},{'X-DVR-Token':'wrong'},{'Host':'localhost'}):
                self.assertEqual(request(**headers)[0],403)
            self.assertEqual(list((self.root/'recordings').glob('import-*')),[])
            status,first=request();self.assertEqual(status,201);self.assertFalse(first['reused'])
            status,again=request();self.assertEqual(status,201);self.assertTrue(again['reused'])
            self.assertEqual(first['recording']['id'],again['recording']['id'])
            self.assertIsNone(jobs.job)
            self.assertEqual(request(**{'Content-Type':'text/plain'})[0],400)
            jobs.allow_import=False
            self.assertEqual(request()[0],403)
        finally:
            server.shutdown();server.server_close();thread.join();jobs.close()
