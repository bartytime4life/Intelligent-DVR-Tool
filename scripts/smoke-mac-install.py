"""Mac CI: isolated source install, repeat install, analysis, duplicate launch and restart.

Only generated video/ONNX and fixture credentials; never uses the operator's data.
"""
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main(evidence):
    if sys.platform != 'darwin':
        raise RuntimeError('Run this install smoke on an Apple silicon Mac.')
    evidence = Path(evidence).resolve(); evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='DVR Mac source with spaces ') as temp:
        root = Path(temp)
        for name in ('edge','scripts','src','public','worker','.openai'):
            shutil.copytree(ROOT/name, root/name, ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        for name in ('Start-Mac.command','Install-Mac.command','Check-Mac.command',
                     'package.json','package-lock.json','index.html','vite.config.mjs','.npmrc'):
            shutil.copyfile(ROOT/name,root/name)
        env = {k:v for k,v in os.environ.items() if not k.startswith('DVR_')}
        def args(mode,*extra):
            return ['bash',str(root/(mode.title()+'-Mac.command')),*extra]
        def run(mode,*extra,success=True):
            result=subprocess.run(args(mode,*extra),cwd=root,env=env,capture_output=True,text=True,timeout=300)
            with (evidence/'install-and-check.log').open('a',encoding='utf-8') as log:
                log.write(result.stdout+result.stderr)
            if (result.returncode==0)!=success:
                raise RuntimeError('Unexpected '+mode+' exit; see install-and-check.log')
            return result
        run('install')
        spec=importlib.util.spec_from_file_location('mac_fixture',ROOT/'tests/local_analysis_fixture.py')
        fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
        folder=fixture.build(root/'local-analysis')
        (folder/'config.json').rename(folder/'catalog.json')
        for subdir in ('people','trained'):
            (folder/subdir).mkdir();(folder/subdir/'preserve.bin').write_bytes(b'private fixture data')
        # A configured LAN address must remain idle throughout installation/check/start.
        (root/'local-feeds.json').write_text(json.dumps({'sources':[{'id':'idle','name':'Idle fixture',
            'host':'192.168.1.123','path':'/fixture','username':'viewer','password':'private-fixture'}]}))
        def private_hashes():
            return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in [root/'local-feeds.json',*folder.rglob('*')] if p.is_file()}
        before=private_hashes();run('install');assert private_hashes()==before
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        report=evidence/'readiness.json'
        run('check','--port',str(port),'--report',str(report))
        assert json.loads(report.read_text())['ready']
        assert all(secret not in report.read_text() for secret in ('private-fixture','192.168.1.123'))
        def request(path,body=None,token=None):
            connection=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
            headers={'Origin':f'http://127.0.0.1:{port}'}
            if token:headers['X-DVR-Token']=token
            if body is not None:headers['Content-Type']='application/json'
            try:
                connection.request('POST' if body is not None else 'GET',path,
                                   json.dumps(body) if body is not None else None,headers)
                response=connection.getresponse();return response.status,response.read()
            finally:connection.close()
        frames=None
        for iteration in range(2):
            if iteration:
                with (root/'scripts/prepare-sites-build.mjs').open('a') as f:f.write('\n// build refresh fixture\n')
            with (evidence/f'launch-{iteration}.log').open('w',encoding='utf-8') as log:
                process=subprocess.Popen(args('start','--no-browser','--port',str(port)),cwd=root,env=env,
                                         stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                try:
                    deadline=time.monotonic()+60
                    while True:
                        if process.poll() is not None:raise RuntimeError('Mac launcher exited')
                        try:
                            status,data=request('/api/analysis/session')
                            if status==200:break
                        except OSError:pass
                        if time.monotonic()>deadline:raise RuntimeError('Mac launch deadline exceeded')
                        time.sleep(.2)
                    session=json.loads(data);token=session['token']
                    assert session['ready'] and session['training']['enabled'] and session['recording_import']['enabled']
                    assert not session['people']['enabled'] and session['job'] is None
                    assert request('/')[0]==200
                    duplicate=run('start','--no-browser','--port',str(port),success=False)
                    assert 'already in use' in duplicate.stderr and process.poll() is None
                    run('check','--skip-port-check','--port',str(port))
                    if not iteration:
                        recording=next(v['id'] for v in session['recordings'] if v['name']=='synthetic.webm')
                        status,data=request('/api/analysis/jobs',{'recording':recording,'model':'synthetic','rules':'presence'},token)
                        assert status==202
                        job=json.loads(data);deadline=time.monotonic()+30
                        while job['state']=='running':
                            assert time.monotonic()<deadline
                            time.sleep(.1)
                            status,data=request('/api/analysis/jobs/'+job['id'],token=token)
                            assert status==200;job=json.loads(data)
                        assert job['state']=='completed',job
                        status,data=request('/api/analysis/jobs/'+job['id']+'/result',token=token)
                        assert status==200
                        receipt=json.loads(data)['receipt'];frames=receipt['frames_analyzed']
                        assert frames==6 and receipt['source_sha256']==hashlib.sha256((folder/'recordings/synthetic.webm').read_bytes()).hexdigest()
                finally:
                    if process.poll() is None:os.killpg(process.pid,signal.SIGINT)
                    process.wait(timeout=15)
            assert private_hashes()==before
            run('check','--port',str(port))
        summary={'schema':'intelligent-dvr.mac-install-smoke.v1','fresh_install':'passed',
                 'repeat_install_preserved_private_files':'passed','readiness':'passed',
                 'duplicate_launch_kept_existing_service':'passed','rebuild_and_restart':'passed',
                 'generated_recording_analysis':'passed','frames_analyzed':frames,'camera_connections':0,
                 'scope':'Synthetic software checks; no physical device, recognition accuracy or capacity qualification'}
        (evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(summary))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',type=Path,required=True)
    main(parser.parse_args().evidence)
