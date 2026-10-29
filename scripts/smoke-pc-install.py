"""CI: extract the actual kit, install twice, check, launch and stop without any device."""
import argparse
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import zipfile


def main(archive, evidence):
    evidence = Path(evidence).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='DVR PC install with spaces ') as directory:
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(directory)
        root = Path(directory) / 'Intelligent-DVR-PC'
        env = {**os.environ, 'DVR_NONINTERACTIVE':'1', 'DVR_PYTHON':sys.executable}
        for key in ('DVR_FEEDS_CONFIG', 'DVR_RECORDINGS', 'DVR_ANALYSIS_CONFIG', 'DVR_PORT'):
            env.pop(key, None)
        is_windows = sys.platform == 'win32'
        def launch(action, *extra, ps=False):
            if is_windows:
                if ps:
                    mode = {'install':'-Install', 'check':'-Check'}.get(action)
                    args = ['pwsh', '-NoProfile', '-File', str(root/'scripts/Start-IntelligentDvr.ps1'),
                            '-Python', sys.executable] + ([mode] if mode else []) + list(extra)
                else:
                    args = ['cmd', '/d', '/c', str(root/(action.title()+'-Windows.cmd')), *extra]
            else:
                args = ['bash', str(root/'scripts/run-linux.sh')] + ([] if action=='start' else ['--'+action]) + list(extra)
            return args
        def run(action, *extra, ps=False, success=True):
            result = subprocess.run(launch(action,*extra,ps=ps), cwd=root, env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=240)
            print(result.stdout, flush=True)
            if (result.returncode == 0) != success:
                raise RuntimeError('Unexpected exit status for ' + action)
            return result
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        run('check', '--port', str(port), success=False)
        run('install')
        if not (root/'local-feeds.json').exists():
            raise RuntimeError('Installer did not create the empty source catalog')
        settings = {'sources':[{'id':'configured-only', 'name':'CI configured but never connected',
                     'host':'192.168.1.123', 'port':554, 'path':'/fixture', 'username':'viewer', 'password':'private-fixture'}]}
        (root/'local-feeds.json').write_text(json.dumps(settings), encoding='utf-8')
        before = (root/'local-feeds.json').read_bytes()
        run('install', ps=is_windows)
        if (root/'local-feeds.json').read_bytes() != before:
            raise RuntimeError('Reinstall overwrote source configuration')
        report = evidence/'readiness.json'
        run('check', '--port', str(port), '--report', str(report))
        if is_windows:
            run('check', '-Port', str(port), ps=True)
        data = json.loads(report.read_text())
        if not data['ready'] or 'private-fixture' in report.read_text() or '192.168.1.123' in report.read_text():
            raise RuntimeError('Readiness failed or disclosed private settings')
        def request(path):
            conn = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
            try:
                conn.request('GET',path); response=conn.getresponse()
                return response.status,response.read()
            finally:
                conn.close()
        args = launch('start','-NoBrowser','-Port',str(port),ps=True) if is_windows else launch('start','--no-browser','--port',str(port))
        log = evidence/'launch.log'
        with log.open('w', encoding='utf-8') as output:
            process = subprocess.Popen(args,cwd=root,env=env,stdout=output,stderr=subprocess.STDOUT,
                **({'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP} if is_windows else {'start_new_session':True}))
            try:
                deadline=time.monotonic()+30
                while True:
                    if process.poll() is not None: raise RuntimeError('Installed service exited during startup')
                    try:
                        status,body=request('/api/feeds/session')
                        if status == 200: break
                    except OSError:
                        pass
                    if time.monotonic()>deadline: raise RuntimeError('Installed service did not become available')
                    time.sleep(.2)
                public=json.loads(body)
                if not public['ready'] or len(public['sources'])!=1 or 'private-fixture' in body.decode():
                    raise RuntimeError('Installed catalog contract failed')
                if request('/')[0]!=200: raise RuntimeError('Installed interface unavailable')
                if request('/api/analysis/session')[0]!=503: raise RuntimeError('Unconfigured analysis must remain unavailable')
                # No connect/start API is invoked. A real device is never contacted.
            finally:
                if is_windows:
                    subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,timeout=10)
                elif process.poll() is None:
                    os.killpg(process.pid,signal.SIGINT)
                process.wait(timeout=15)
        run('check','--port',str(port))
        summary={'schema':'intelligent-dvr.pc-install-smoke.v1',
                 'source_commit':json.loads((root/'pc-kit.json').read_text())['source_commit'],
                 'platform':sys.platform, 'fresh_install':'passed','reinstall_preserved_settings':'passed',
                 'readiness':'passed','installed_http_service':'passed','shutdown_port_recovery':'passed',
                 'physical_devices':'not_tested','camera_connections':0,'inference_jobs':0}
        (evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(summary),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',required=True)
    parser.add_argument('--evidence',required=True)
    args=parser.parse_args()
    main(args.archive,args.evidence)
