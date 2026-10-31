"""Linux extracted-kit launcher acceptance using generated video and a synthetic model."""
import argparse
from contextlib import contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time


def main(root, fixtures, evidence):
    root, fixtures, evidence = map(lambda p: Path(p).resolve(), (root, fixtures, evidence))
    evidence.mkdir(parents=True, exist_ok=True)
    python = root/'.venv/bin/python'
    data = root.parent/'generated recovery inputs'
    subprocess.run([python, fixtures, '--output', data], check=True, timeout=20)
    # Long enough to observe native progress before killing the service.
    subprocess.run([python, '-c', '''import cv2,numpy as np,sys
w=cv2.VideoWriter(sys.argv[1],cv2.VideoWriter_fourcc(*'MJPG'),30,(640,480))
assert w.isOpened()
frame=np.full((480,640,3),80,dtype=np.uint8)
for _ in range(3000): w.write(frame)
w.release()
''', data/'recordings/long.avi'], check=True, timeout=30)
    state = root.parent/'retained analysis state'
    env = dict(os.environ)
    for key in ('DVR_STATE_DIR','DVR_GEO_LOCAL','DVR_PORT','DVR_FEEDS_CONFIG','DVR_RECORDINGS','DVR_ANALYSIS_CONFIG'):
        env.pop(key, None)
    env.update(DVR_PYTHON=str(python), DVR_STATE_DIR=str(state))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    base = ['bash',str(root/'scripts/run-linux.sh')]
    analysis = ['--recordings',str(data/'recordings'),'--config',str(data/'config.json'),'--port',str(port)]

    def run(*args, success=True):
        result=subprocess.run(base+list(args),cwd=root,env=env,capture_output=True,text=True,timeout=240)
        if (result.returncode==0) != success:
            raise AssertionError(result.stdout+result.stderr)
        return result

    def request(path, body=None, token=None):
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
        headers={'Origin':f'http://127.0.0.1:{port}'}
        if token: headers['X-DVR-Token']=token
        if body is not None: headers['Content-Type']='application/json'
        try:
            conn.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
            response=conn.getresponse(); raw=response.read()
            assert response.status in (200,202), (response.status,raw)
            return json.loads(raw) if 'application/json' in response.getheader('Content-Type','') else raw
        finally: conn.close()

    def until(operation, predicate, seconds=30):
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            value=operation()
            if predicate(value): return value
            time.sleep(.01)
        raise AssertionError('Timed out waiting for installed service state')

    @contextmanager
    def server(name, *extra):
        with (evidence/(name+'.log')).open('w') as log:
            process=subprocess.Popen(base+analysis+['--no-browser']+list(extra),cwd=root,env=env,
                                     stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            try:
                def ready():
                    assert process.poll() is None, (evidence/(name+'.log')).read_text()
                    try: return request('/api/analysis/session')
                    except OSError: return None
                session=until(ready,lambda v: v and v['ready'])
                yield process,session
            finally:
                if process.poll() is None: process.send_signal(signal.SIGINT)
                process.wait(timeout=15)

    def start(session, name):
        recording=next(r['id'] for r in session['recordings'] if r['name']==name)
        return request('/api/analysis/jobs',{'recording':recording,'model':'synthetic','rules':'presence'},session['token'])

    def snapshot(folder=state):
        return {p.relative_to(folder).as_posix():[hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mode & 0o777]
                for p in folder.rglob('*') if p.is_file()}

    # The service appends its start and stop to the diagnostic log; job artifacts must not change.
    def artifacts(files):
        return {name:value for name,value in files.items() if not name.startswith('diagnostics/')}

    def diagnostics():
        folder=state/'diagnostics'
        assert folder.stat().st_mode & 0o777 == 0o700
        assert all(p.name in ('service.log','service.log.1','service.log.2') and p.stat().st_mode & 0o777 == 0o600
                   for p in folder.iterdir())
        lines=(folder/'service.log').read_text(encoding='ascii').splitlines()
        for line in lines:  # Codes, hex ids and numbers only.
            assert re.fullmatch(r'\d+ [A-Z][A-Z0-9_]*( [a-z_]+=([A-Z][A-Z0-9_]*|[a-f0-9]{8,64}|-?\d+(\.\d+)?|REDACTED))*',line), line
        return lines

    report=evidence/'recovery-readiness.json'
    run('--check',*analysis,'--report',str(report))
    assert not state.exists(), 'Check must not create the store'
    with server('fresh') as (_,session):
        assert session['job'] is None and session['retention']=='private-local-last-job'
        time.sleep(.2)
        assert request('/api/analysis/session')['job'] is None, 'Startup must not dispatch'
        job=start(session,'synthetic.webm')
        finished=until(lambda:request('/api/analysis/session'),lambda v:v['job']['state']!='running')
        assert finished['job']['state']=='completed', finished
        review=request('/api/analysis/jobs/'+job['id']+'/result',token=session['token'])
        source=request('/api/analysis/jobs/'+job['id']+'/source',token=session['token'])
        # A second launcher cannot share this store even on another port.
        run(*analysis,'--no-browser','--port',str(port+1 if port<65535 else port-1),success=False)
    before=snapshot()
    assert state.stat().st_mode & 0o777 == 0o700 and state.stat().st_uid==os.getuid()
    run('--check',*analysis)
    run('--install')  # Inherited opt-in must not interfere with reinstall.
    assert snapshot()==before, 'Check/reinstall changed retained state'
    logged=diagnostics()
    assert [line.split()[1] for line in logged]==['SERVICE_START','JOB_FINISHED','SERVICE_STOP'], logged
    assert f"job={job['id']} state=COMPLETED" in logged[1], logged
    with server('restart') as (_,recovered):
        assert recovered['job']['id']==job['id'] and recovered['job']['recovered']
        assert recovered['token']!=session['token']
        assert request('/api/analysis/jobs/'+job['id']+'/result',token=recovered['token'])==review
        assert request('/api/analysis/jobs/'+job['id']+'/source',token=recovered['token'])==source
        time.sleep(.2)
        assert request('/api/analysis/session')['job']['id']==job['id']
    assert artifacts(snapshot())==artifacts(before), 'Restart changed retained job artifacts'
    assert [line.split()[1] for line in diagnostics()[len(logged):]]==['SERVICE_START','SERVICE_STOP']
    before=snapshot()

    # Invalid state must fail both Check and Start and retain all input bytes.
    invalid=[]
    file=root.parent/'not a directory'; file.write_text('keep'); invalid.append(file)
    shared=root.parent/'shared'; shared.mkdir(mode=0o755); invalid.append(shared)
    linked=root.parent/'linked'; linked.symlink_to(state,target_is_directory=True); invalid.append(linked)
    invalid.append(root.parent/'missing parent'/'state')
    foreign=root.parent/'foreign'; foreign.mkdir(mode=0o700); (foreign/'keep').write_text('keep'); invalid.append(foreign)
    corrupt=root.parent/'corrupt'; shutil.copytree(state,corrupt); (corrupt/'state.json').write_text('{broken'); invalid.append(corrupt)
    for path in invalid:
        preserved=snapshot(path) if path.is_dir() else None
        for mode in ('--check','--no-browser'):
            run(mode,*analysis,'--state-dir',str(path),success=False)
        if preserved is not None: assert snapshot(path)==preserved
    assert file.read_text()=='keep' and snapshot()==before

    run('--check','--temporary',*analysis)
    with server('temporary','--temporary') as (_,temporary):
        assert temporary['job'] is None and temporary['retention']=='temporary-until-service-exit'
        start(temporary,'synthetic.webm')
        assert until(lambda:request('/api/analysis/session'),lambda v:v['job']['state']!='running')['job']['state']=='completed'
    with server('temporary-restart','--temporary') as (_,temporary):
        assert temporary['job'] is None
    assert snapshot()==before, 'Temporary operation changed the persistent store'

    with server('interrupt') as (process,session):
        start(session,'long.avi')
        until(lambda:request('/api/analysis/session'),lambda v:v['job']['state']=='running' and v['job']['frames_read']>0)
        process.kill(); process.wait(timeout=5)
    interrupted=snapshot()
    run('--check',*analysis)
    assert snapshot()==interrupted, 'Check rewrote interrupted state'
    with server('interrupted-restart') as (_,recovered):
        assert recovered['job']['state']=='failed'
        assert recovered['job']['error']['code']=='SERVICE_INTERRUPTED'
        time.sleep(.2)
        assert request('/api/analysis/session')['job']==recovered['job'], 'Interrupted job resumed'
    summary={'schema':'intelligent-dvr.pc-recovery-smoke.v1',
             'source_commit':json.loads((root/'pc-kit.json').read_text())['source_commit'],
             'fresh_start':'passed','completed_restart_same_artifacts':'passed','interrupted_analysis':'SERVICE_INTERRUPTED',
             'readiness_and_reinstall_preserved_state':'passed','invalid_paths':len(invalid),
             'temporary_override_and_restart':'passed','private_owner_permissions':'passed','competing_owner':'refused',
             'automatic_jobs':0,'explicit_synthetic_jobs':3,'camera_connections':0,'owner_installed_app':'not_upgraded_or_accepted'}
    (evidence/'recovery-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installation',required=True)
    parser.add_argument('--fixtures',required=True)
    parser.add_argument('--evidence',required=True)
    args=parser.parse_args()
    main(args.installation,args.fixtures,args.evidence)
