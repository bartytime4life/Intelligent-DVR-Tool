import hashlib
import http.client
import io
import json
import os
from email.message import Message
from pathlib import Path
import subprocess
import sys
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
        # Imports resolve their folder; on Windows that expands 8.3 names such as RUNNER~1.
        self.root = Path(self.temp.name).resolve()
    def tearDown(self):
        self.temp.cleanup()
    def entries(self):
        # The OS-released lock file persists by design; it is never listed or counted.
        return [p for p in self.root.iterdir() if p.name != '.dvr-import.lock']
    def receive(self, content=VIDEO, **kwargs):
        return import_recording(self.root, io.BytesIO(content), kwargs.pop('length', len(content)),
                                kwargs.pop('mime', 'video/x-msvideo'), kwargs.pop('sha', hashlib.sha256(content).hexdigest()), **kwargs)
    def test_success_is_hash_named_and_retry_is_idempotent(self):
        file, reused = self.receive()
        self.assertFalse(reused)
        self.assertEqual(file.name, 'import-' + SHA + '.avi')
        self.assertEqual(file.read_bytes(), VIDEO)
        self.assertTrue(self.receive()[1])
        self.assertEqual(len(self.entries()), 1)
        if os.name != 'nt': self.assertEqual(file.stat().st_mode & 0o777, 0o600)
    def test_changed_existing_import_never_overwrites(self):
        file, _ = self.receive(); file.write_bytes(b'x' * len(VIDEO))
        with self.assertRaises(ImportError): self.receive()
        self.assertEqual(file.read_bytes(), b'x' * len(VIDEO))
    def test_wrong_hash_playlist_and_mismatched_container_leave_no_files(self):
        for content, kwargs in [(VIDEO, {'sha':'0'*64}), (b'#EXTM3U\nhttps://example.test/video', {}), (VIDEO, {'mime':'video/webm'})]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ImportError): self.receive(content, **kwargs)
            self.assertEqual(self.entries(), [])
    def test_overflow_unsafe_mime_and_interrupted_body_leave_no_files(self):
        for kwargs in ({'length':MAX_IMPORT_BYTES+1}, {'length':len(VIDEO)+10}, {'mime':'text/plain'}, {'sha':'../unsafe'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ImportError): self.receive(**kwargs)
            self.assertEqual(self.entries(), [])
    def test_timeout_and_disk_reserve_fail_cleanly(self):
        with self.assertRaises(ImportError): self.receive(clock=iter([0,31]).__next__)
        with patch('edge.recording_import.shutil.disk_usage', return_value=SimpleNamespace(free=1)), self.assertRaises(ImportError): self.receive()
        self.assertEqual(self.entries(), [])
    def test_total_storage_and_file_limits_count_imports(self):
        big = self.root / 'import-big.avi'
        with big.open('wb') as f: f.truncate(MAX_INBOX_BYTES - len(VIDEO) + 1)
        with self.assertRaises(ImportError): self.receive()
        big.unlink()
        for i in range(20): (self.root / f'import-{i}.avi').write_bytes(b'x')
        with self.assertRaises(ImportError): self.receive()

    def test_crashed_import_lock_and_partial_file_are_reclaimed(self):
        # A killed import leaves its lock file and a full-size part; neither blocks the next import.
        (self.root/'.dvr-import.lock').write_bytes(b'0')
        part = self.root/'.dvr-import-crashed.part'
        with part.open('wb') as f: f.truncate(MAX_INBOX_BYTES)
        file, reused = self.receive()
        self.assertFalse(reused); self.assertFalse(part.exists()); self.assertEqual(self.entries(), [file])

    def test_live_import_lock_in_another_process_refuses_without_reclaim(self):
        part = self.root/'.dvr-import-live.part'; part.write_bytes(b'in progress')
        holder = subprocess.Popen([sys.executable, '-c', 'import sys; from pathlib import Path; from edge.recording_import import folder_lock\n'
            'with folder_lock(Path(sys.argv[1])):\n    print("held", flush=True); sys.stdin.read()', str(self.root)],
            cwd=Path(__file__).resolve().parents[1], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            self.assertEqual(holder.stdout.readline().strip(), b'held')
            with self.assertRaisesRegex(ImportError, 'Another import'): self.receive()
            self.assertEqual(part.read_bytes(), b'in progress')
            holder.kill(); holder.wait()  # Killed, not cleaned up: the OS releases the lock.
            self.receive(); self.assertFalse(part.exists())
        finally:
            if holder.poll() is None: holder.kill(); holder.wait()
            holder.stdin.close(); holder.stdout.close()
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
            h.server=SimpleNamespace(origin='http://127.0.0.1:4183',token='secret',jobs=jobs,feeds=None,server_port=4183)
            h.client_address=('127.0.0.1',1); h.command='POST'; h.path='/api/analysis/recordings'
            h.headers=Message()
            for key,value in headers: h.headers[key]=value
            h.rfile=io.BytesIO(VIDEO); h._json=lambda value,status=200:(status,value)
            return h
        self.enterContext(patch('edge.local_service.peer_uid',return_value=getattr(os,'getuid',lambda:None)()))
        valid=[('Host','127.0.0.1:4183'),('Origin','http://127.0.0.1:4183'),('X-DVR-Token','secret'),
               ('Content-Length',str(len(VIDEO))),('Content-Type','video/x-msvideo'),('X-DVR-SHA256',SHA)]
        self.assertEqual(handler(valid)._dispatch()[0],201)
        for replacement in [('Host','evil.test'),('Origin','https://evil.test'),('X-DVR-Token','wrong'),('Content-Length','bad')]:
            h=handler([(k,v) for k,v in valid if k!=replacement[0]]+[replacement])
            with self.assertRaises(JobError): h._dispatch()
            self.assertEqual(h.rfile.tell(),0)
        for extra in [('Content-Length','1'),('Transfer-Encoding','chunked'),('Content-Type','text/plain'),('X-DVR-SHA256','0'*64)]:
            with self.assertRaises(JobError): handler(valid+[extra])._dispatch()

    def test_refused_and_reused_uploads_are_drained_before_the_json_reply(self):
        self.enterContext(patch('edge.local_service.peer_uid',return_value=getattr(os,'getuid',lambda:None)()))
        def busy(*args): raise JobError('BUSY','Wait for the current analysis to finish before importing a recording.',409)
        def reused(stream,length,*args): return {'reused':True}
        def received(stream,length,*args): stream.read(length); return {'reused':False}
        def handler(receive,**updates):
            h=Handler.__new__(Handler)
            h.server=SimpleNamespace(origin='http://127.0.0.1:4183',token='secret',jobs=SimpleNamespace(receive_recording=receive),feeds=None,server_port=4183)
            h.client_address=('127.0.0.1',1); h.command='POST'; h.path='/api/analysis/recordings'; h.headers=Message()
            for key,value in {'Host':'127.0.0.1:4183','X-DVR-Token':'secret','Content-Length':str(len(VIDEO)),
                              'Content-Type':'video/x-msvideo','X-DVR-SHA256':SHA,**updates}.items():
                if value is not None: h.headers[key]=value
            h.rfile=io.BytesIO(VIDEO+b'next-request'); h.sent=[]
            h._json=lambda value,status=200:h.sent.append((status,h.rfile.tell()))  # Bytes consumed when replying.
            return h
        for receive,updates,expected in ((busy,{},(409,len(VIDEO))),(reused,{},(201,len(VIDEO))),(received,{},(201,len(VIDEO))),
                                        (busy,{'X-DVR-SHA256':None},(400,len(VIDEO))),
                                        (busy,{'Content-Length':str(MAX_IMPORT_BYTES+1)},(409,0))):
            with self.subTest(receive=receive.__name__,updates=updates):
                h=handler(receive,**updates); h.do_POST(); self.assertEqual(h.sent,[expected])
        with patch('edge.local_service.time.monotonic',side_effect=[0,0,31]):  # Drain is time-bounded too.
            class Slow(io.BytesIO):
                def read(inner,size=-1): return super().read(min(size,8))
            h=handler(busy); h.rfile=Slow(VIDEO); h.do_POST(); self.assertEqual(h.sent,[(409,8)])

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

    def test_import_transfer_runs_without_the_jobs_lock_and_refuses_starts(self):
        build(self.root)
        folder=self.root/'recordings'; data=(folder/'synthetic.webm').read_bytes(); sha=hashlib.sha256(data).hexdigest()
        jobs=Jobs(folder,load_catalog(self.root/'config.json'),allow_import=True); observed=[]
        def probe():
            # Another request thread during a slow upload: answered, not blocked.
            try: jobs.start({'recording':next(iter(jobs.choices)),'model':'synthetic','rules':'presence'})
            except JobError as exc: observed.append(exc.code)
            observed.append(jobs.snapshot())
        class Upload(io.BytesIO):
            def read(inner, size=-1):
                if not observed:
                    thread=threading.Thread(target=probe); thread.start(); thread.join(5)
                return super().read(size)
        try:
            jobs.receive_recording(Upload(data),len(data),'video/webm',sha)
            self.assertEqual(observed,['BUSY',None]); self.assertFalse(jobs.importing)
            with self.assertRaises(JobError): jobs.receive_recording(io.BytesIO(data),len(data),'video/webm','0'*64)
            self.assertFalse(jobs.importing)
        finally: jobs.close()

    @unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1', 'Real loopback transport runs in CI')
    def test_real_http_binary_import_is_guarded_and_idempotent(self):
        build(self.root)
        jobs=Jobs(self.root/'recordings',load_catalog(self.root/'config.json'),allow_import=True)
        server=LocalServer(0,jobs,self.root)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(body=VIDEO,**updates):
            headers={'Host':server.origin.removeprefix('http://'),'Origin':server.origin,'X-DVR-Token':jobs.token,
                     'Content-Type':'video/x-msvideo','X-DVR-SHA256':SHA,**updates}
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            try:
                conn.request('POST','/api/analysis/recordings',body=body,headers=headers)
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
            # A refused multi-megabyte upload is drained: the client reads the JSON reason, not a reset.
            jobs.allow_import=True; jobs.job={'state':'running'}
            large=b'RIFF\0\0\0\0AVI '+b'x'*(8*1024**2); status,body=request(**{'X-DVR-SHA256':hashlib.sha256(large).hexdigest()},body=large)
            self.assertEqual((status,body['error']['code']),(409,'BUSY')); jobs.job=None
        finally:
            server.shutdown();server.server_close();thread.join();jobs.close()
