"""Exercise the legacy local-geo launcher opt-in against synthetic loopback providers."""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]


def main():
    calls = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            calls.append(self.path.split('?')[0])
            body = b'{"features":[]}'
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def do_POST(self):
            self.rfile.read(int(self.headers.get('Content-Length',0)))
            calls.append(self.path)
            body = b'{"elements":[]}'
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    provider = ThreadingHTTPServer(('127.0.0.1',0), Provider)
    thread = threading.Thread(target=provider.serve_forever,daemon=True)
    thread.start()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
    env = dict(os.environ)
    for key in ('DVR_FEEDS_CONFIG','DVR_RECORDINGS','DVR_ANALYSIS_CONFIG','DVR_PORT'):
        env.pop(key,None)
    env.update(DVR_GEO_LOCAL='1',DVR_PYTHON=sys.executable,
               DVR_PHOTON_PORT=str(provider.server_port),DVR_OVERPASS_PORT=str(provider.server_port))
    is_windows = sys.platform == 'win32'
    # No --facility flag: preserve the original documented environment opt-in.
    args = (['pwsh','-NoProfile','-File',str(ROOT/'scripts/Start-IntelligentDvr.ps1'),
             '-Python',sys.executable,'-NoBrowser','-Port',str(port)] if is_windows else
            ['bash',str(ROOT/'scripts/run-linux.sh'),'--no-browser','--port',str(port)])
    def request(path, body=None):
        conn = http.client.HTTPConnection('127.0.0.1',port,timeout=5)
        try:
            conn.request('POST' if body is not None else 'GET',path,body,
                         {'Content-Type':'application/x-www-form-urlencoded'} if body is not None else {})
            response = conn.getresponse()
            return response.status,response.read()
        finally:
            conn.close()
    process = None
    with tempfile.TemporaryFile(mode='w+',encoding='utf-8') as log:
        try:
            process = subprocess.Popen(args,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,
                **({'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP} if is_windows else {'start_new_session':True}))
            deadline = time.monotonic()+30
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Source preview exited')
                try:
                    if request('/')[0] == 200: break
                except OSError:
                    pass
                if time.monotonic()>deadline:
                    raise RuntimeError('Source preview startup timed out')
                time.sleep(.2)
            status, body = request('/geo/search?q=Example&limit=5&lang=en')
            if status != 200 or json.loads(body) != {'features':[]}:
                raise RuntimeError('Local Photon route failed: '+str(status))
            query = subprocess.check_output(['node','--input-type=module','-e',
                "import {osmQuery,searchBounds} from './src/facility-starter.mjs'; process.stdout.write(osmQuery(searchBounds([-98,38.5],0,0,250,250)))"],
                cwd=ROOT,text=True,timeout=15)
            status, body = request('/geo/overpass',urlencode({'data':query}))
            if status != 200 or json.loads(body) != {'elements':[]}:
                raise RuntimeError('Local Overpass route failed: '+str(status))
            if calls != ['/api/','/api/interpreter']:
                raise RuntimeError('Unexpected provider paths')
            print(json.dumps({'source_launcher_geo':'passed','platform':sys.platform,
                              'search':'passed','footprints':'passed','providers':'synthetic loopback',
                              'camera_connections':0}),flush=True)
        except Exception:
            log.seek(0)
            print(log.read(),flush=True)
            raise
        finally:
            if process is not None and process.poll() is None:
                if is_windows:
                    subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,timeout=10)
                else:
                    os.killpg(process.pid,signal.SIGINT)
                process.wait(timeout=15)
            provider.shutdown();provider.server_close();thread.join()


if __name__ == '__main__':
    main()
