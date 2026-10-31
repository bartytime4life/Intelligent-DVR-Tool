import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from edge.local_feeds import Feeds, FeedError, load_sources, LIMITS, ROOT
from edge.feed_worker import relay_messages

SOURCE = {'id':'dock', 'name':'Dock channel', 'host':'192.168.1.20', 'port':554,
          'path':'/channel/1', 'username':'viewer', 'password':'private-test-password'}
JPEG = b'\xff\xd8synthetic-unit-fixture\xff\xd9'

class Process:
    def __init__(self, code=None): self.code = code; self.stdin = io.BytesIO(); self.killed = False
    def poll(self): return self.code
    def kill(self): self.killed = True; self.code = -9
    def wait(self): return self.code

class FeedsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.services=[]; self.now=100.
    def tearDown(self):
        for service in self.services: service.close()
        self.temp.cleanup()
    def service(self, **kwargs):
        service = Feeds({f'camera-{i}':{**SOURCE,'id':f'camera-{i}'} for i in range(6)},
            clock=lambda:self.now, process_factory=kwargs.get('process_factory', lambda *a,**k:Process()))
        self.services.append(service); return service
    def start(self, service, name='camera-0'):
        return service.connect({'source':name})
    def frame(self, service, identifier, data=JPEG):
        (Path(service.sessions[identifier]['directory'].name)/'frame.jpg').write_bytes(data)
    def test_only_owner_configured_private_ipv4_sources(self):
        config=self.root/'sources.json'
        config.write_text(json.dumps({'sources':[SOURCE]}))
        self.assertEqual(load_sources(config)['dock'], SOURCE)
        for changed in ({'host':'127.0.0.1'},{'host':'169.254.169.254'},{'host':'8.8.8.8'},
                        {'host':'camera.local'}, {'host':'::1'}, {'host':'192.168.1.020'},
                        {'path':'rtsp://192.168.1.1/x'}, {'path':'//other/x'}, {'path':'/x\r\nHost:evil'},
                        {'port':True}, {'port':0}, {'port':65536}, {'url':'rtsp://private'}, {'password':'secret\n'}):
            config.write_text(json.dumps({'sources':[{**SOURCE, **changed}]}))
            with self.subTest(changed=changed), self.assertRaises(ValueError): load_sources(config)
    def test_catalog_and_errors_never_return_credentials_or_endpoint(self):
        service=self.service()
        self.assertNotIn('192.168.', json.dumps(service.available()))
        self.assertNotIn('password', json.dumps(service.available()))
        first=self.start(service)
        self.assertNotIn('password', json.dumps(first))
        self.assertNotIn('/channel/', json.dumps(first))
        for value in ({'source':'rtsp://evil'}, {'source':'camera-0','url':'http://evil'}, {'source':[]}):
            with self.assertRaises(FeedError): service.connect(value)
    def test_explicit_start_success_frame_and_disconnect(self):
        service=self.service(); self.assertEqual(service.sessions,{})
        first=self.start(service); self.assertEqual(first['state'],'connecting')
        self.frame(service,first['id']); state=service.status(first['id'])
        self.assertEqual(state['state'],'live'); self.assertEqual(service.frame(first['id']),JPEG)
        s=service.sessions[first['id']]; process=s['process']; directory=s['directory'].name
        self.assertEqual(service.disconnect(first['id'])['state'],'disconnected')
        self.assertTrue(process.killed); self.assertFalse(Path(directory).exists())
        with self.assertRaises(FeedError): service.frame(first['id'])
        self.assertEqual(service.disconnect(first['id'])['state'],'disconnected')
    def test_capacity_duplicate_and_explicit_recovery(self):
        service=self.service(); first=self.start(service)
        with self.assertRaises(FeedError) as caught: self.start(service)
        self.assertEqual(caught.exception.code,'IN_USE')
        for i in range(1,4): self.start(service,f'camera-{i}')
        with self.assertRaises(FeedError) as caught: self.start(service,'camera-4')
        self.assertEqual(caught.exception.code,'CAPACITY')
        service.disconnect(first['id']); self.start(service,'camera-4')
        self.assertEqual(len(service.sessions),4)
    def test_deadlines_stale_frames_and_leases_kill_workers(self):
        for kind,seconds,code in [('opening',13,'OPEN_TIMEOUT'),('stale',9,'STALE'),('lease',16,'LEASE_EXPIRED'),('session',901,'SESSION_LIMIT')]:
            service=self.service(); first=self.start(service); state=service.sessions[first['id']]; process=state['process']
            if kind != 'opening': self.frame(service,first['id']); service.status(first['id'])
            self.now += seconds
            if kind=='session': state['touched']=self.now
            result=service.status(first['id']); self.assertEqual(result['error']['code'],code)
            self.assertTrue(process.killed)
            self.assertNotEqual(self.start(service)['id'],first['id'])
    def test_process_failure_and_spawn_failure_are_recoverable(self):
        service=self.service(); first=self.start(service); service.sessions[first['id']]['process'].code=2
        self.assertEqual(service.status(first['id'])['error']['code'],'CONNECTION_FAILED')
        self.assertEqual(self.start(service)['state'],'connecting')
        def broken(*a,**k): raise OSError('password secret /local/path')
        service=self.service(process_factory=broken); result=self.start(service)
        self.assertEqual(result['error']['code'],'START_FAILED'); self.assertNotIn('secret',json.dumps(result))
        service.process_factory=lambda *a,**k:Process(); self.assertEqual(self.start(service)['state'],'connecting')
    def test_credentials_only_pass_through_stdin(self):
        threads=[]
        def process(command,**kwargs):
            self.assertNotIn('192.168',str(command)); self.assertNotIn('password',str(command))
            self.assertEqual(kwargs['stderr'],subprocess.DEVNULL)
            self.assertEqual(kwargs['env']['DVR_FEED_PARENT_PID'],str(os.getpid()))
            threads.append(threading.current_thread()); return Process()
        service=self.service(process_factory=process); state=self.start(service)
        stdin=service.sessions[state['id']]['process'].stdin
        # One line on the private pipe, which stays open as the worker's lifetime lease.
        self.assertFalse(stdin.closed); self.assertEqual(json.loads(stdin.getvalue())['password'],SOURCE['password'])
        self.assertTrue(stdin.getvalue().endswith(b'\n'))
        self.assertEqual(list(Path(service.sessions[state['id']]['directory'].name).iterdir()),[])
        # Linux parent-death signals follow the spawning thread: never a request thread.
        self.start(service,'camera-1'); self.assertIs(threads[0],threads[1]); self.assertIsNot(threads[0],threading.current_thread())
        service.disconnect(state['id']); self.assertTrue(stdin.closed)
    def test_cleanup_and_supervision_failures_never_stop_the_reaper(self):
        service=self.service(); first=self.start(service); directory=service.sessions[first['id']]['directory'].name
        self.frame(service,first['id'])
        try:
            # A Windows sharing violation during cleanup still ends the session.
            with patch('os.unlink',side_effect=PermissionError('sharing violation')):
                self.assertEqual(service.disconnect(first['id'])['state'],'disconnected')
        finally: shutil.rmtree(directory,ignore_errors=True)
        broken=self.start(service,'camera-1'); healthy=self.start(service,'camera-2')
        def fail(): raise OSError('invalid handle')
        service.sessions[broken['id']]['process'].poll=fail
        self.now+=16; deadline=time.monotonic()+3
        while any(service.sessions[i]['state']=='connecting' for i in (broken['id'],healthy['id'])) and time.monotonic()<deadline: time.sleep(.05)
        self.assertEqual(service.sessions[broken['id']]['error']['code'],'PREVIEW_FAILED')
        self.assertEqual(service.status(healthy['id'])['error']['code'],'LEASE_EXPIRED')
        self.assertTrue(service.thread.is_alive())
        self.assertEqual(self.start(service,'camera-3')['state'],'connecting')
    def test_invalid_and_oversized_frames_are_never_served(self):
        for data in (b'not-jpeg', b'\xff\xd8'+b'x'*LIMITS['frame_bytes']+b'\xff\xd9'):
            service=self.service(); first=self.start(service); self.frame(service,first['id'],data)
            with self.assertRaises(FeedError): service.frame(first['id'])
            self.assertEqual(service.status(first['id'])['error']['code'],'FRAME_INVALID')
    def test_close_reaps_real_process_and_drops_frames(self):
        children=[]
        def spawn(command,**kwargs):
            child=subprocess.Popen([sys.executable,'-c','import sys,time; sys.stdin.buffer.read(); time.sleep(60)'],
                stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            children.append(child); return child
        service=self.service(process_factory=spawn); state=self.start(service)
        directory=service.sessions[state['id']]['directory'].name
        service.close(); self.assertIsNotNone(children[0].poll()); self.assertFalse(Path(directory).exists())
        with self.assertRaises(FeedError): self.start(service)
    def test_preview_worker_exits_when_service_pipe_closes(self):
        # Production main()/limits with the network decoder replaced by a blocked stand-in.
        script=("import sys, time, types; from edge import feed_worker as w\n"
                "w.PinnedRelay = lambda *a: types.SimpleNamespace(local_port=9, close=lambda: None)\n"
                "def capture(*a):\n"
                "    if sys.platform == 'linux':\n"
                "        import resource; limit = resource.getrlimit(resource.RLIMIT_CPU)[0]\n"
                "    else: limit = w.CPU_SECONDS\n"
                "    print('ready', limit, flush=True); time.sleep(60)\n"
                "w.capture = capture; w.main(sys.argv[1])")
        child=subprocess.Popen([sys.executable,'-c',script,str(self.root)],cwd=ROOT,
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:
            child.stdin.write(json.dumps(SOURCE).encode()+b'\n'); child.stdin.flush()
            ready,cpu=child.stdout.readline().split()
            self.assertEqual(ready,b'ready')
            # RLIMIT_CPU sums threads; a full 900 s preview must fit inside it.
            self.assertGreaterEqual(int(cpu),LIMITS['session_seconds']+60)
            child.stdin.close()  # Service death closes the pipe even if the decoder is blocked.
            self.assertEqual(child.wait(timeout=5),75)
        finally:
            if child.poll() is None: child.kill(); child.wait()
            child.stdout.close()
    @unittest.skipUnless(sys.platform=='linux','Parent-death signal is Linux-only')
    def test_linux_preview_worker_arms_owned_child_before_reading_credentials(self):
        result=subprocess.run([sys.executable,'-m','edge.feed_worker',str(self.root)],cwd=ROOT,input=b'',
            env={**os.environ,'DVR_FEED_PARENT_PID':'0'},capture_output=True,timeout=20)
        self.assertEqual(result.returncode,72)
    def test_unknown_session_does_not_auto_reconnect(self):
        service=self.service()
        for action in (service.status,service.frame,service.disconnect):
            with self.assertRaises(FeedError): action('0'*32)
        self.assertEqual(service.sessions,{})

class RelayTest(unittest.TestCase):
    def relay(self,data):
        out=io.BytesIO()
        class Writer:
            def sendall(self,data): out.write(data)
        relay_messages(io.BytesIO(data),Writer()); return out.getvalue()
    def test_bounded_replies_auth_challenges_and_interleaved_rtp(self):
        for data in (b'RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 4\r\n\r\ntest',
                     b'RTSP/1.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm="fixture", nonce="xyz"\r\n\r\n',
                     b'$\x00\x00\x04test'):
            self.assertEqual(self.relay(data),data)
    def test_redirects_malformed_lengths_and_unbounded_headers_refused(self):
        for data in (b'RTSP/1.0 302 Found\r\nLocation: rtsp://169.254.169.254/x\r\n\r\n',
                     b'RTSP/1.0 200 OK\r\nLocation: rtsp://8.8.8.8/x\r\n\r\n',
                     b'RTSP/1.0 200 OK\r\nContent-Length: 65537\r\n\r\n',
                     b'RTSP/1.0 200 OK\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\na',
                     b'RTSP/1.0 200 OK\r\nX: '+b'a'*65536+b'\r\n\r\n', b'$\x00\x00\x05test'):
            with self.assertRaises(ValueError): self.relay(data)


@unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS')=='1','Set DVR_TEST_SOCKETS=1 on a host allowing loopback')
class NativeFeedTest(unittest.TestCase):
    def test_real_rtsp_tcp_auth_decode_and_http_guards(self):
        import http.client
        import threading
        from local_feeds_fixture import SyntheticRtsp, sources
        from edge.local_service import LocalServer
        fixture=SyntheticRtsp(); feeds=Feeds(sources(fixture.server_address[1]))
        server=LocalServer(0,None,Path(__file__).resolve().parents[1]/'dist/client',feeds)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(path,method='GET',body=None,**headers):
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            conn.request(method,path,body,headers);res=conn.getresponse();result=(res.status,res.read());conn.close();return result
        try:
            status,body=request('/api/feeds/session');self.assertEqual(status,200)
            public=json.loads(body);self.assertNotIn('fixture-secret',body.decode())
            headers={'X-DVR-Token':public['token'],'Content-Type':'application/json'}
            self.assertEqual(request('/api/feeds/session',Origin='https://evil.test')[0],403)
            self.assertEqual(request('/api/feeds/session',Host='evil.test')[0],403)
            self.assertEqual(request('/api/feeds/connect','POST','{"source":"video"}')[0],403)
            self.assertEqual(request('/api/analysis/session')[0],503)
            status,body=request('/api/feeds/connect','POST','{"source":"video"}',**headers);self.assertEqual(status,202)
            identifier=json.loads(body)['id']; deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                state=feeds.status(identifier)
                if state['state']!='connecting':break
                time.sleep(.1)
            self.assertEqual(state['state'],'live',state)
            # An active stream survives >8 seconds with no decoder requests.
            # Keeping the browser lease alive must not hide media-worker exits.
            sustained=time.monotonic()+10
            while time.monotonic()<sustained:
                self.assertEqual(feeds.status(identifier)['state'],'live')
                time.sleep(.2)
            self.assertEqual(request('/api/feeds/'+identifier+'/frame')[0],403)
            status,frame=request('/api/feeds/'+identifier+'/frame',**headers);self.assertEqual(status,200)
            import cv2,numpy as np
            image=cv2.imdecode(np.frombuffer(frame,dtype=np.uint8),cv2.IMREAD_COLOR)
            self.assertEqual(image.shape[:2],(240,320))
            self.assertLess(len(frame),LIMITS['frame_bytes'])
            self.assertEqual(request('/api/feeds/'+identifier+'/disconnect','POST','{}',**headers)[0],200)
            self.assertEqual(request('/api/feeds/'+identifier+'/frame',**headers)[0],409)
            redirect=feeds.connect({'source':'redirect'});deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                state=feeds.status(redirect['id'])
                if state['state']=='failed':break
                time.sleep(.1)
            self.assertEqual(state['state'],'failed');self.assertGreater(fixture.redirects,0)
            self.assertEqual((state['error']['code'],state['cause']),('CONNECTION_FAILED','REDIRECT_REFUSED'))
        finally:
            feeds.close();server.shutdown();server.server_close();thread.join();fixture.close()

if __name__=='__main__': unittest.main()
