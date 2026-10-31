import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

import test_local_service as fixtures
from edge.local_service import Jobs, JobError, load_catalog
from edge.result_store import ResultStore


@unittest.skipUnless(sys.platform == 'linux', 'Private persistent storage is Linux-only')
class RecoveryTest(unittest.TestCase):
    setUp = fixtures.ServiceTest.setUp
    tearDown = fixtures.ServiceTest.tearDown
    service = fixtures.ServiceTest.service
    start = fixtures.ServiceTest.start
    finish = fixtures.ServiceTest.finish

    @staticmethod
    def success(command, **kwargs):
        directory = Path(command[-1])
        names = {'source_sha256':next(directory.glob('source.*')), 'model_sha256':directory/'model.onnx',
                 'labels_sha256':directory/'labels.json', 'rules_file_sha256':directory/'rules.json'}
        receipt = {key:hashlib.sha256(path.read_bytes()).hexdigest() for key,path in names.items()}
        receipt['state'] = 'completed'
        receipt['frames_read'] = 1
        receipt['media_coverage'] = {'schema':'intelligent-dvr.media-coverage.v1',
            'source_sha256':receipt['source_sha256'], 'status':'inventory-matched',
            'termination':'source-end', 'analysis_frames':1, 'validated_frames':1,
            'declared_frames':1, 'declared_duration_seconds':None, 'decoded_duration_seconds':None,
            'duration_tolerance_seconds':None, 'anchor':'frames', 'validator_version':'synthetic-fixture'}
        (directory/'review.json').write_text(json.dumps({'schema':'intelligent-dvr.recognition-review.v1', 'receipt':receipt, 'trace':receipt}))
        return fixtures.FakeProcess(0)

    def completed(self):
        service = self.service(state_dir=self.root/'state', process_factory=self.success)
        job = self.start(service)
        self.assertEqual(self.finish(service)['state'], 'completed')
        return service, job

    def test_completed_result_and_frozen_source_survive_restart_without_execution(self):
        service, job = self.completed()
        source, _ = service.artifact(job['id'], 'source'); original = source.read_bytes()
        token = service.token; service.close()
        (self.recordings/'video.avi').unlink()
        recovered = self.service(state_dir=self.root/'state', process_factory=lambda *a, **k:self.fail('Startup must not execute work'))
        self.assertEqual(recovered.available()['retention'], 'private-local-last-job')
        self.assertEqual(recovered.snapshot()['id'], job['id'])
        self.assertTrue(recovered.snapshot()['recovered'])
        self.assertNotEqual(token, recovered.token)
        self.assertEqual(recovered.artifact(job['id'], 'source')[0].read_bytes(), original)
        self.assertIsNone(recovered.thread)

    def test_inspection_preserves_completed_and_interrupted_bytes(self):
        from edge.pc_setup import persistence_check
        service, _ = self.completed(); service.close()
        def snapshot():
            return {p.relative_to(self.root/'state').as_posix(): (p.read_bytes(), p.stat().st_mode)
                    for p in (self.root/'state').rglob('*') if p.is_file()}
        before = snapshot()
        self.assertEqual(persistence_check(self.root/'state')['recovery'], 'completed')
        self.assertEqual(snapshot(), before)
        state = self.root/'state/state.json'; record = json.loads(state.read_text())
        record['job'].update(state='running',phase='analyzing',result_state=None,error=None)
        record['artifacts'] = None; state.write_text(json.dumps(record))
        before = snapshot()
        self.assertEqual(persistence_check(self.root/'state')['recovery'], 'SERVICE_INTERRUPTED on start')
        self.assertEqual(snapshot(), before)

    def test_inspection_refuses_live_owner_corruption_and_invalid_paths(self):
        from edge.pc_setup import persistence_check
        service, _ = self.completed()
        with self.assertRaises(ValueError): persistence_check(self.root/'state')
        service.close()
        state = self.root/'state/state.json'; state.write_text('{broken')
        with self.assertRaises(ValueError): persistence_check(self.root/'state')
        self.assertEqual(state.read_text(), '{broken')
        for mode in (0o755, 0o500):
            folder = self.root/str(mode); folder.mkdir(mode=mode)
            with self.assertRaises(ValueError): persistence_check(folder)
            folder.chmod(0o700)
        with self.assertRaises(ValueError): persistence_check(self.root/'missing/child')
        link = self.root/'linked'; link.symlink_to(self.root/'state', target_is_directory=True)
        with self.assertRaises(ValueError): persistence_check(link)
        with patch('edge.result_store.os.getuid', return_value=os.getuid()+1):
            with self.assertRaises(ValueError): persistence_check(self.root/'state')

    def test_new_explicit_job_replaces_only_the_previous_retained_job(self):
        service, first = self.completed(); old = service.retained_directory
        second = self.start(service); self.finish(service)
        self.assertNotEqual(first['id'], second['id']); self.assertFalse(old.exists())
        self.assertEqual(len(list((self.root/'state').glob('job-*'))), 1)
        with self.assertRaises(JobError):service.artifact(first['id'], 'result')
        self.assertTrue((self.recordings/'video.avi').exists())

    def test_running_record_recovers_as_interrupted_and_never_resumes(self):
        service, previous = self.completed(); service.close()
        state = self.root/'state/state.json'; record = json.loads(state.read_text())
        record['job'].update(state='running',phase='analyzing',result_state=None,error=None)
        record['artifacts'] = None; state.write_text(json.dumps(record))
        recovered = self.service(state_dir=self.root/'state', process_factory=lambda *a,**k:self.fail('No replay'))
        self.assertEqual(recovered.snapshot()['error']['code'], 'SERVICE_INTERRUPTED')
        self.assertEqual(recovered.snapshot()['state'], 'failed')
        self.assertFalse(list((self.root/'state').glob('job-*')))
        with self.assertRaises(JobError):recovered.artifact(previous['id'], 'source')

    def test_cancelled_job_remains_cancelled_after_restart(self):
        service = self.service(state_dir=self.root/'state', process_factory=lambda *a,**k:fixtures.FakeProcess())
        job = self.start(service); service.cancel(job['id']); self.finish(service); service.close()
        recovered = self.service(state_dir=self.root/'state')
        self.assertEqual(recovered.snapshot()['state'], 'cancelled')
        self.assertIsNone(recovered.retained_directory)

    def test_corrupted_or_substituted_artifacts_fail_closed_and_remain_for_inspection(self):
        for kind in ('source','result'):
            service, job = self.completed()
            artifact = service.artifact(job['id'], kind)[0]; service.close()
            original = artifact.read_bytes(); artifact.write_bytes(original+b'tampered')
            with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')
            self.assertEqual(artifact.read_bytes(), original+b'tampered')
            artifact.write_bytes(original)

    def test_private_paths_symlinks_corrupt_state_and_foreign_contents_refused(self):
        path = self.root/'unsafe'; path.mkdir(mode=0o755)
        with self.assertRaises(ValueError):ResultStore(path)
        path.chmod(0o700); (path/'foreign.txt').write_text('owner data')
        with self.assertRaises(ValueError):ResultStore(path)
        self.assertTrue((path/'foreign.txt').exists())
        link = self.root/'linked'; link.symlink_to(path, target_is_directory=True)
        with self.assertRaises(ValueError):ResultStore(link)
        service, _ = self.completed(); service.close()
        state = self.root/'state/state.json'; state.write_text('{broken')
        with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')
        self.assertEqual(state.read_text(), '{broken')

    def test_second_process_cannot_open_an_owned_store(self):
        service, _ = self.completed()
        code = 'from edge.result_store import ResultStore; import sys; ResultStore(sys.argv[1])'
        result = subprocess.run([sys.executable, '-c', code, str(self.root/'state')], capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'live service owner', result.stderr)

    def test_missing_metadata_preserves_previously_completed_artifacts(self):
        service, job = self.completed(); artifact=service.artifact(job['id'],'source')[0]
        original=artifact.read_bytes(); service.close(); (self.root/'state/state.json').unlink()
        with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')
        self.assertEqual(artifact.read_bytes(), original)

    def test_oversized_retained_files_are_refused_before_reading_or_deleting(self):
        service, job = self.completed()
        paths = [(service.artifact(job['id'], 'source')[0], 512 * 1024**2),
                 (service.artifact(job['id'], 'result')[0], 32 * 1024**2)]
        service.close()
        for path, limit in paths:
            original = path.read_bytes()
            with path.open('r+b') as stream:stream.truncate(limit + 1)
            with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')
            self.assertEqual(path.stat().st_size, limit + 1)
            path.write_bytes(original)

    def test_symlink_and_hardlink_artifacts_are_refused_without_following_or_deleting(self):
        service, job = self.completed(); artifact=service.artifact(job['id'],'source')[0]; service.close()
        outside=self.root/'outside'; original=artifact.read_bytes(); artifact.rename(outside); artifact.symlink_to(outside)
        with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')
        self.assertEqual(outside.read_bytes(), original); artifact.unlink(); outside.rename(artifact)
        os.link(artifact,outside)
        with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')
        self.assertEqual(outside.read_bytes(), original)

    def test_manifest_cannot_redirect_paths_or_substitute_a_different_source_binding(self):
        service, job = self.completed(); review=service.artifact(job['id'],'result')[0]; service.close()
        path=self.root/'state/state.json'; original=path.read_bytes(); state=json.loads(original)
        state['artifacts']['source']='../outside.avi'; path.write_text(json.dumps(state))
        with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')
        path.write_bytes(original); state=json.loads(original); data=json.loads(review.read_text())
        data['receipt']['source_sha256']='0'*64; review.write_text(json.dumps(data))
        state['artifacts']['review_sha256']=hashlib.sha256(review.read_bytes()).hexdigest(); path.write_text(json.dumps(state))
        with self.assertRaises(ValueError):self.service(state_dir=self.root/'state')

    def test_uncommitted_metadata_cannot_replace_a_valid_completed_state(self):
        service, job = self.completed(); service.close()
        temporary=self.root/'state/state.tmp'; temporary.write_text('{incomplete'); temporary.chmod(0o600)
        recovered=self.service(state_dir=self.root/'state')
        self.assertEqual(recovered.snapshot()['id'],job['id']); self.assertEqual(recovered.snapshot()['state'],'completed')

    def test_failed_atomic_publication_recovers_interruption_instead_of_success(self):
        service=self.service(state_dir=self.root/'state',process_factory=self.success)
        original=os.replace
        def replace(path,target):
            path=Path(path)
            if path.name=='state.tmp' and json.loads(path.read_text())['job']['state']=='completed':
                raise OSError('injected rename failure')
            return original(path,target)
        with patch('edge.fileops.os.replace',replace):
            job=self.start(service); self.assertEqual(self.finish(service)['error']['code'],'STORE_WRITE_FAILED')
        service.close(); recovered=self.service(state_dir=self.root/'state')
        self.assertEqual(recovered.snapshot()['error']['code'],'SERVICE_INTERRUPTED')
        with self.assertRaises(JobError):recovered.artifact(job['id'],'result')

    def test_metadata_size_nonfinite_counts_and_schema_fail_closed(self):
        service, _=self.completed(); service.close(); path=self.root/'state/state.json'; original=path.read_bytes()
        variants=[b'x'*16385,b'{"schema":NaN}',b'{}']
        for change in ({'frames_analyzed':6001},{'frames_read':0,'frames_analyzed':1},{'id':'../outside'},
                       {'elapsed_seconds':-1},{'state':'completed','phase':'analyzing'}):
            state=json.loads(original);state['job'].update(change);variants.append(json.dumps(state).encode())
        for data in variants:
            with self.subTest(data=data[:50]):
                path.write_bytes(data)
                with self.assertRaises((ValueError,OSError)):self.service(state_dir=self.root/'state')
        path.write_bytes(original)

    def test_non_linux_opt_in_is_rejected_before_creating_storage(self):
        with patch('edge.result_store.sys.platform','win32'):
            with self.assertRaises(ValueError):ResultStore(self.root/'not-created')
        self.assertFalse((self.root/'not-created').exists())

    @unittest.skipUnless(fixtures.AVAILABLE, 'Pinned synthetic native dependencies required')
    def test_hard_service_exit_kills_real_native_worker_and_recovers_interruption(self):
        import ctypes
        import signal
        import cv2
        import numpy as np
        libc=ctypes.CDLL(None,use_errno=True);old=ctypes.c_int()
        if libc.prctl(37,ctypes.byref(old),0,0,0) or libc.prctl(36,1,0,0,0):
            self.skipTest('Child subreaper unavailable for native parent-exit test')
        fixtures.build(self.root/'native')
        video=self.root/'native/recordings/long.avi'
        writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'MJPG'),30,(320,240))
        self.assertTrue(writer.isOpened())
        try:
            frame=np.zeros((240,320,3),dtype=np.uint8)
            for _ in range(6000):writer.write(frame)
        finally:writer.release()
        code='''import json, subprocess, sys, time
from pathlib import Path
from edge.local_service import Jobs,load_catalog
root=Path(sys.argv[1])
def spawn(*args,**kwargs):
    child=subprocess.Popen(*args,**kwargs)
    (root/'worker.pid').write_text(str(child.pid))
    return child
service=Jobs(root/'native/recordings',load_catalog(root/'native/config.json'),state_dir=root/'crash-state',process_factory=spawn)
recording=next(v['id'] for v in service.available()['recordings'] if v['name']=='long.avi')
service.start({'recording':recording,'model':'synthetic','rules':'presence'})
time.sleep(30)
'''
        parent=None;child=None
        try:
            parent=subprocess.Popen([sys.executable,'-c',code,str(self.root)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            deadline=time.monotonic()+10;armed=False
            while time.monotonic()<deadline and parent.poll() is None:
                pid_file=self.root/'worker.pid'
                if pid_file.exists():child=int(pid_file.read_text())
                files=list((self.root/'crash-state').glob('job-*/progress.json'))
                if files:
                    try:progress=json.loads(files[0].read_text())
                    except (ValueError,OSError):progress={}
                    if progress.get('phase')=='analyzing' and progress.get('frames_read',0)>0:
                        armed=True;break
                time.sleep(.002)
            self.assertTrue(armed,'Real native worker must reach analysis before its parent is killed')
            parent.kill();parent.wait(timeout=5)
            deadline=time.monotonic()+5;status=None
            while time.monotonic()<deadline:
                waited, result=os.waitpid(child,os.WNOHANG)
                if waited:status=result;child=None;break
                time.sleep(.01)
            self.assertIsNotNone(status,'Native child must be killed and reaped after service death')
            self.assertTrue(os.WIFSIGNALED(status));self.assertEqual(os.WTERMSIG(status),signal.SIGKILL)
            recovered=Jobs(self.root/'native/recordings',load_catalog(self.root/'native/config.json'),state_dir=self.root/'crash-state',
                           process_factory=lambda *a,**k:self.fail('No restart dispatch'))
            self.services.append(recovered)
            self.assertEqual(recovered.snapshot()['error']['code'],'SERVICE_INTERRUPTED')
            self.assertIsNone(recovered.thread);self.assertTrue(video.exists())
        finally:
            if parent:
                if parent.poll() is None:parent.kill()
                parent.wait(timeout=5)
                if parent.stderr:parent.stderr.close()
            if child:
                try:os.kill(child,signal.SIGKILL);os.waitpid(child,0)
                except (ProcessLookupError,ChildProcessError):pass
            libc.prctl(36,old.value,0,0,0)

    def test_commit_failure_publishes_no_success_and_stops_new_dispatch(self):
        service = self.service(state_dir=self.root/'state', process_factory=self.success)
        with patch.object(service.store, 'commit', side_effect=OSError('private device path')):
            job = self.start(service); state = self.finish(service)
        self.assertEqual(state['error']['code'], 'STORE_WRITE_FAILED')
        self.assertNotIn('private device path', json.dumps(state))
        with self.assertRaises(JobError):service.artifact(job['id'], 'result')
        with self.assertRaises(JobError) as raised:self.start(service)
        self.assertEqual(raised.exception.code, 'STORE_UNAVAILABLE')

    def test_cleanup_failure_is_terminal_and_stops_new_dispatch(self):
        service = self.service(state_dir=self.root/'state', process_factory=self.success)
        original = Path.unlink
        def unlink(path, *args, **kwargs):
            if path.name == 'model.onnx' and path.parent.name.startswith('job-'):
                raise OSError('injected cleanup failure')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'unlink', unlink):
            job = self.start(service); state = self.finish(service)
        self.assertEqual(state['state'], 'failed')
        self.assertEqual(state['error']['code'], 'STORE_WRITE_FAILED')
        with self.assertRaises(JobError):service.artifact(job['id'], 'result')
        with self.assertRaises(JobError):self.start(service)
        service.close()
        recovered = self.service(state_dir=self.root/'state')
        self.assertEqual(recovered.snapshot()['error']['code'], 'SERVICE_INTERRUPTED')

    def test_failed_admission_keeps_previous_result_and_never_dispatches(self):
        service, job = self.completed()
        original = service.artifact(job['id'], 'result')[0].read_bytes()
        with patch.object(service.store, '_save', side_effect=OSError('injected admission failure')):
            with patch.object(service, 'process_factory', side_effect=AssertionError('No dispatch')):
                with self.assertRaises(JobError):self.start(service)
        self.assertEqual(service.snapshot()['id'], job['id'])
        service.close(); recovered = self.service(state_dir=self.root/'state')
        self.assertEqual(recovered.snapshot()['id'], job['id'])
        self.assertEqual(recovered.artifact(job['id'], 'result')[0].read_bytes(), original)

    def test_uncertain_final_sync_is_revalidated_after_restart(self):
        service = self.service(state_dir=self.root/'state', process_factory=self.success)
        original = service.store._sync_directory
        def sync():
            state = json.loads((self.root/'state/state.json').read_text())
            if state['job']['state'] == 'completed':
                raise OSError('injected final directory sync failure')
            original()
        with patch.object(service.store, '_sync_directory', sync):
            job = self.start(service); state = self.finish(service)
        self.assertEqual(state['error']['code'], 'STORE_WRITE_FAILED')
        with self.assertRaises(JobError):service.artifact(job['id'], 'result')
        service.close(); recovered = self.service(state_dir=self.root/'state')
        self.assertEqual(recovered.snapshot()['state'], 'completed')
        self.assertTrue(recovered.artifact(job['id'], 'result')[0].is_file())

    @unittest.skipUnless(fixtures.AVAILABLE, 'Pinned synthetic native dependencies required')
    def test_real_native_bundle_reopens_after_service_restart(self):
        fixtures.build(self.root/'native')
        recordings = self.root/'native/recordings'; catalog = load_catalog(self.root/'native/config.json')
        first = Jobs(recordings, catalog, state_dir=self.root/'native-state'); self.services.append(first)
        choices = first.available()['recordings']; recording = next(v['id'] for v in choices if v['name']=='synthetic.webm')
        job = first.start({'recording':recording,'model':'synthetic','rules':'presence'})
        self.assertEqual(self.finish(first)['state'], 'completed'); original=first.artifact(job['id'],'result')[0].read_bytes(); first.close()
        second = Jobs(recordings,catalog,state_dir=self.root/'native-state'); self.services.append(second)
        self.assertTrue(second.snapshot()['recovered']); self.assertIsNone(second.thread)
        self.assertEqual(second.artifact(job['id'],'result')[0].read_bytes(), original)
