"""Deterministic live GPU contracts. Fakes are not GPU execution evidence."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from edge import live_backend as backend, live_resources as resources
from edge.live_analysis import Live
from edge.model_profiles import YOLOX_PROFILE
from tests import test_live_analysis as fixtures
FakeWorker, result, JPEG = fixtures.FakeWorker, fixtures.result, fixtures.JPEG
from tests.test_backends import FakeOrt, NP


class SelectionTest(unittest.TestCase):
    def test_selection_is_deterministic_and_cpu_does_not_import_ort(self):
        with patch.object(backend.importlib, 'import_module', side_effect=AssertionError('No runtime import')):
            for platform in ('linux', 'win32', 'darwin'):
                self.assertEqual(backend.candidate('opencv-cpu', YOLOX_PROFILE, platform), (False, 'CPU_DEFAULT'))
            for platform in ('linux', 'win32'):
                self.assertEqual(backend.candidate('cuda-preferred', YOLOX_PROFILE, platform), (True, 'CUDA_PROBE_REQUIRED'))
                self.assertEqual(backend.candidate('cuda-preferred', 'yolov8-raw-640', platform), (False, 'PROFILE_UNSUPPORTED'))
            self.assertEqual(backend.candidate('cuda-preferred', YOLOX_PROFILE, 'darwin'), (False, 'PLATFORM_UNSUPPORTED'))
            with self.assertRaises(ValueError):
                backend.candidate('unknown', YOLOX_PROFILE)

    def test_capability_is_only_a_preflight_never_hardware_proof(self):
        for ort, code in [(FakeOrt(), 'STARTUP_PROBE_REQUIRED'),
                          (SimpleNamespace(__version__='wrong'), 'RUNTIME_VERSION'),
                          (SimpleNamespace(__version__=backend.ORT_VERSION, get_available_providers=lambda: []), 'PROVIDER_UNAVAILABLE')]:
            with self.subTest(code=code), patch.object(backend.importlib, 'import_module', return_value=ort):
                self.assertEqual(backend.capability()['code'], code)
        with patch.object(backend.importlib, 'import_module', side_effect=ImportError('/private/path')):
            self.assertEqual(backend.capability(), {'available': False, 'code': 'RUNTIME_UNAVAILABLE'})

    def test_cuda_uses_verified_snapshot_even_if_catalog_path_changes(self):
        with tempfile.TemporaryDirectory(prefix='modèle-') as directory:
            model = Path(directory) / 'model.onnx'
            data = b'fake-onnx'; model.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            def create(name, snapshot, profile, cv2, np, threads):
                model.write_bytes(b'changed-after-verification')
                self.assertNotEqual(snapshot, model)
                self.assertEqual(snapshot.read_bytes(), data)
                self.assertEqual(name, 'onnxruntime-cuda')
                return SimpleNamespace(runtime={})
            with patch.object(backend, 'capability', return_value={'available': True}), \
                    patch('edge.model_profiles.validate_binding'), patch.object(backend, 'qualified_backend', side_effect=create):
                actual = backend.create_cuda(model, digest, YOLOX_PROFILE, None, 2)
            self.assertEqual(actual.runtime['model_sha256'], digest)

    def test_bad_hash_and_profile_never_reach_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / 'm.onnx'; model.write_bytes(b'changed')
            with patch.object(backend, 'qualified_backend', side_effect=AssertionError('Must not load')):
                for profile in (YOLOX_PROFILE, 'yolov8-raw-640'):
                    with self.assertRaises(ValueError):
                        backend.create_cuda(model, '0' * 64, profile, None, 2)

    def test_snapshot_reuses_strict_cuda_execution_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / 'm.onnx'; model.write_bytes(b'fixture')
            ort = FakeOrt()
            with patch('edge.model_profiles.validate_binding'), patch.object(backend.importlib, 'import_module', return_value=ort):
                actual = backend.create_cuda(model, hashlib.sha256(b'fixture').hexdigest(), YOLOX_PROFILE, NP, 2)
            self.assertEqual(actual.runtime['startup_execution']['node_execution_counts'], {'CUDAExecutionProvider': 1})
            self.assertEqual(actual.runtime['precision'], 'FP32, TF32 disabled')
            actual.close()


class RecoveryTest(unittest.TestCase):
    start = fixtures.LiveTest.start
    def setUp(self):
        fixtures.LiveTest.setUp(self)
        self.catalog['models']['model']['profile'] = YOLOX_PROFILE
        self.guard = patch('edge.live_resources.guard', return_value=threading.Event())
        self.guard.start()

    def tearDown(self):
        self.guard.stop()
        fixtures.LiveTest.tearDown(self)

    def live(self, workers, **kwargs):
        return fixtures.LiveTest.live(self, workers, backend=kwargs.pop('backend', 'cuda-preferred'), **kwargs)

    def gpu(self, replies=()):
        worker = FakeWorker(replies)
        worker.out.get_nowait()
        worker.out.put(json.dumps({'type': 'ready', 'load_ms': 5,
            'runtime': {'backend_id': 'onnxruntime-cuda', 'startup_execution': {'node_execution_counts': {'CUDAExecutionProvider': 1}}}}).encode() + b'\n')
        return worker

    def test_one_gpu_slot_and_two_total_sessions(self):
        gpu, cpu = self.gpu(), FakeWorker([])
        live = self.live([gpu, cpu])
        first, second = self.start(live, 'A'), self.start(live, 'B')
        self.assertEqual(first['runtime']['backend_id'], 'onnxruntime-cuda')
        self.assertEqual(first['acceleration']['code'], 'CUDA_STARTUP_VERIFIED')
        self.assertEqual(second['acceleration']['code'], 'GPU_SLOT_BUSY')
        self.assertEqual(second['runtime']['backend_id'], 'opencv-cpu')
        live.stop(first['id'])
        self.assertFalse(live.gpu_failed)

    def test_startup_failure_kills_gpu_then_uses_fresh_cpu_without_frames(self):
        failed = FakeWorker([], ready=False)
        failed.out.put(b'{"type":"error","code":"MODEL_LOAD_FAILED","fatal":true}\n')
        cpu = FakeWorker([result()])
        live = self.live([failed, cpu])
        session = self.start(live)
        self.assertEqual((session['state'], session['runtime']['backend_id']), ('live', 'opencv-cpu'))
        self.assertEqual(session['acceleration']['code'], 'CUDA_START_FAILED_CPU_FALLBACK')
        self.assertEqual(failed.returncode, -9)
        self.assertEqual(failed.sent, [])
        self.assertEqual(live.frame(session['id'], JPEG)['detections'][0]['track'], 1)
        self.assertTrue(live.available()['gpu_disabled'])

    def test_a_cpu_ready_reply_can_never_be_reported_as_gpu_execution(self):
        false_gpu, cpu = FakeWorker([]), FakeWorker([])
        live = self.live([false_gpu, cpu])
        session = self.start(live)
        self.assertEqual(session['runtime']['backend_id'], 'opencv-cpu')
        self.assertEqual(session['acceleration']['code'], 'CUDA_START_FAILED_CPU_FALLBACK')
        self.assertEqual(false_gpu.returncode, -9)

    def test_bad_gpu_receipt_recovers_to_cpu_without_leaving_a_starting_session(self):
        for runtime in ('bad', {'backend_id': 'onnxruntime-cuda', 'startup_execution': 'bad'},
                        {'backend_id': 'onnxruntime-cuda', 'startup_execution': {'node_execution_counts': {'CUDAExecutionProvider': True}}}):
            failed = FakeWorker([], ready=False)
            failed.out.put(json.dumps({'type': 'ready', 'runtime': runtime}).encode() + b'\n')
            live = self.live([failed, FakeWorker([])])
            session = self.start(live)
            self.assertEqual(session['state'], 'live')
            self.assertEqual(session['runtime']['backend_id'], 'opencv-cpu')
            self.assertEqual(failed.returncode, -9)

    def test_gpu_timeout_falls_back_and_stale_gpu_lines_cannot_reach_cpu(self):
        gpu, cpu = FakeWorker([], ready=False), FakeWorker([result()])
        live = self.live([gpu, cpu], start_seconds=.05)
        session = self.start(live)
        self.assertEqual(session['runtime']['backend_id'], 'opencv-cpu')
        gpu.out.put(b'{"type":"error","code":"GPU_FAILED","fatal":true}\n')
        self.assertEqual(live.frame(session['id'], JPEG)['type'], 'result')
        self.assertEqual(gpu.returncode, -9)

    def test_gpu_runtime_failure_stops_and_next_explicit_start_uses_cpu(self):
        gpu, cpu = self.gpu([{'type': 'error', 'code': 'GPU_FAILED', 'fatal': True}]), FakeWorker([result()])
        live = self.live([gpu, cpu])
        first = self.start(live)
        from edge.live_analysis import LiveError
        with self.assertRaises(LiveError) as caught:
            live.frame(first['id'], JPEG)
        self.assertEqual(caught.exception.code, 'GPU_FAILED')
        self.assertEqual(gpu.returncode, -9)
        self.assertEqual(live.status(first['id'])['state'], 'failed')
        second = self.start(live)
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(second['acceleration']['code'], 'GPU_DISABLED_AFTER_FAILURE')
        self.assertEqual(second['runtime']['backend_id'], 'opencv-cpu')

    def test_cancel_during_gpu_load_never_starts_fallback(self):
        gpu = FakeWorker([], ready=False)
        live = self.live([gpu], start_seconds=.1)
        replies = []
        thread = threading.Thread(target=lambda: replies.append(self.start(live)))
        thread.start()
        deadline = time.monotonic() + 2
        while not live.sessions and time.monotonic() < deadline:
            time.sleep(.001)
        identifier = next(iter(live.sessions))
        self.assertEqual(live.stop(identifier)['state'], 'stopped')
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(replies[0]['state'], 'stopped')


class ResourceTest(unittest.TestCase):
    def test_gpu_policy_is_separate_from_cpu_limits_on_each_platform(self):
        with patch('edge.analysis_worker.constrain', return_value='handle') as cap:
            with patch.object(resources.sys, 'platform', 'linux'):
                self.assertEqual(resources.constrain_gpu(3 * 1024**3, 1920), 'handle')
                cap.assert_called_with(resources.GPU_VIRTUAL_BYTES, 1920, file_bytes=resources.GPU_FILE_BYTES)
            with patch.object(resources.sys, 'platform', 'win32'):
                resources.constrain_gpu(3 * 1024**3, 1920)
                cap.assert_called_with(3 * 1024**3, 1920)
            with patch.object(resources.sys, 'platform', 'darwin'), self.assertRaises(RuntimeError):
                resources.constrain_gpu(3 * 1024**3, 1920)

    def test_resident_watchdog_kills_on_limit_or_read_failure(self):
        for unreadable in (False, True):
            killed = threading.Event()
            process = SimpleNamespace(pid=123, poll=lambda: None, kill=killed.set)
            calls = []
            def read(pid):
                calls.append(pid)
                if len(calls) == 1:
                    return 1
                if unreadable:
                    raise OSError('private')
                return 101
            stopped = resources.guard(process, 100, platform='linux', reader=read)
            try:
                self.assertTrue(killed.wait(1))
            finally:
                stopped.set()

    def test_unavailable_monitor_refuses_gpu_before_configuration(self):
        killed = []
        process = SimpleNamespace(pid=123, kill=lambda: killed.append(True))
        with self.assertRaises(RuntimeError):
            resources.guard(process, 100, platform='linux', reader=lambda pid: 101)
        self.assertEqual(killed, [True])

    @unittest.skipUnless(__import__('sys').platform == 'linux', 'Native Linux resource limits')
    def test_real_file_limit_allows_the_pinned_model_snapshot_and_stays_bounded(self):
        import subprocess
        import sys
        # No weights or CUDA required: same byte count as the catalog artifact.
        # The child applies the real OS policy before writing either file and
        # reaches the stub runtime through the production verified-snapshot path.
        code = """
import hashlib,json,resource,tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from edge.live_resources import constrain_gpu,GPU_FILE_BYTES
from edge.live_backend import create_cuda
from edge.model_profiles import YOLOX_PROFILE
size=json.loads(Path('edge/candidates/'+YOLOX_PROFILE+'.json').read_text())['model_bytes']
constrain_gpu(3*1024**3,30)
assert resource.getrlimit(resource.RLIMIT_FSIZE)==(GPU_FILE_BYTES,GPU_FILE_BYTES)
with tempfile.TemporaryDirectory() as directory:
    model=Path(directory)/'fixture.onnx'
    model.write_bytes(b'0'*size)
    def load(name,snapshot,*args):
        assert snapshot.stat().st_size==size
        return SimpleNamespace(runtime={})
    with patch('edge.model_profiles.validate_binding'), patch('edge.live_backend.capability',return_value={'available':True}), patch('edge.live_backend.qualified_backend',side_effect=load):
        create_cuda(model,hashlib.sha256(model.read_bytes()).hexdigest(),YOLOX_PROFILE,None,2)
    try:
        with (Path(directory)/'overflow').open('wb') as f:
            f.truncate(GPU_FILE_BYTES+1)
    except OSError:
        pass
    else:
        raise AssertionError('File quota not enforced')
print('snapshot-size-and-hard-file-limit-passed')
"""
        result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=15,
                                cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('snapshot-size-and-hard-file-limit-passed', result.stdout)


@unittest.skipUnless(fixtures.NATIVE, 'Native fixture requirements needed')
class PipelineParityTest(unittest.TestCase):
    def test_mock_cuda_preserves_decoding_tracks_and_rule_observations(self):
        # CUDA is deliberately simulated by a real CPU fixture backend. This
        # checks pipeline wiring and semantics, never numerical CUDA agreement.
        import cv2
        import numpy as np
        from tests.local_analysis_fixture import build
        from edge import live_worker
        from edge.cpu_backend import create_backend
        with tempfile.TemporaryDirectory() as directory:
            root = build(Path(directory))
            model = root / 'fixture.onnx'
            config = {'model': str(model), 'model_sha256': hashlib.sha256(model.read_bytes()).hexdigest(),
                      'profile': 'yolov8-raw-640', 'labels': ['person'],
                      'rules': [{'name': 'all', 'label': 'person', 'rect': [0, 0, 1, 1]}],
                      'camera': 'Generated fixture', 'run_id': 'f' * 32, 'motion_gate': True}
            stream = json.dumps(config).encode() + b'\n'
            for index in range(4):
                frame = np.full((240, 320, 3), 40 + (index % 2) * 150, dtype=np.uint8)
                jpeg = cv2.imencode('.jpg', frame)[1].tobytes()
                stream += live_worker.HEADER.pack((index + 1) * .5, len(jpeg)) + jpeg
            stream += live_worker.HEADER.pack(0, 0)
            cpu, gpu = io.BytesIO(), io.BytesIO()
            live_worker.run(io.BytesIO(stream), cpu)
            simulated = create_backend('opencv-cpu', model, config['profile'], cv2, np, 2,
                                       model_sha256=config['model_sha256'])
            with patch('edge.live_backend.create_cuda', return_value=simulated):
                live_worker.run(io.BytesIO(stream), gpu, 'onnxruntime-cuda')
            left, right = [[json.loads(line) for line in output.getvalue().splitlines()][1:] for output in (cpu, gpu)]
            for a, b in zip(left, right):
                for value in (a, b):
                    value.pop('timing')
                self.assertEqual(a, b)
            self.assertEqual([r['detections'][0]['track'] for r in left], [1, 1, 1, 1])
            self.assertEqual(sum(len(r['observations']) for r in left), 1)

    def test_comparison_rejects_score_box_label_and_frame_count_differences(self):
        from copy import deepcopy
        from edge.live_benchmark import agreement
        baseline = [result()]
        self.assertTrue(agreement(baseline, deepcopy(baseline)))
        for field, value in [('label', 'car'), ('score', .7), ('box', [.1, .1, .4, .5])]:
            other = deepcopy(baseline)
            other[0]['detections'][0][field] = value
            self.assertFalse(agreement(baseline, other))
        self.assertFalse(agreement(baseline, []))


if __name__ == '__main__':
    unittest.main()
