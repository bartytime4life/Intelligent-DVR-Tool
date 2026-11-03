"""GPU-first service wiring and fault injection. Simulated CUDA is not GPU evidence."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from edge.acceleration import GpuSlot, DEFAULT_BACKEND
from edge.local_service import Jobs, load_catalog
from edge.result_store import validate_job
import test_result_recovery as recovery_fixtures
from test_local_service import FakeProcess
from local_analysis_fixture import build


class SlotTest(unittest.TestCase):
    def test_shared_slot_serializes_owners_and_disables_after_failure(self):
        slot=GpuSlot()
        self.assertEqual(DEFAULT_BACKEND,'cuda-preferred')
        self.assertEqual(slot.acquire('recording'),(True,'CUDA_PROBE_REQUIRED'))
        self.assertEqual(slot.acquire('live'),(False,'GPU_SLOT_BUSY'))
        slot.release('other')
        self.assertEqual(slot.acquire('live'),(False,'GPU_SLOT_BUSY'))
        slot.release('recording')
        self.assertTrue(slot.acquire('live')[0])
        slot.disable();slot.release('live')
        self.assertEqual(slot.acquire('recording'),(False,'GPU_DISABLED_AFTER_FAILURE'))


@unittest.skipUnless(all(importlib.util.find_spec(m) for m in ('cv2','numpy','onnx','av')), 'Native fixture generator required')
class RecordingPreferenceTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=build(Path(self.temp.name))
        self.jobs=None;self.calls=[];self.fail_gpu=False;self.gpu_error='MODEL_LOAD_FAILED';self.bad_proof=False
        # Simulate a GPU-capable model selection. The fixture still contains generated raw-profile bytes.
        self.selection=patch('edge.local_service.candidate',side_effect=lambda preference,profile:(preference=='cuda-preferred','CUDA_PROBE_REQUIRED' if preference=='cuda-preferred' else 'CPU_DEFAULT'))
        self.selection.start();self.guard=patch('edge.live_resources.guard',return_value=threading.Event());self.guard.start()
    def tearDown(self):
        if self.jobs:self.jobs.close()
        self.guard.stop();self.selection.stop();self.temp.cleanup()
    def spawn(self,command,**kwargs):
        directory=Path(command[-1]);args=json.loads((directory/'args.json').read_text());backend=args[args.index('--backend')+1]
        self.calls.append(backend)
        if backend=='onnxruntime-cuda' and self.fail_gpu:
            (directory/'failure.json').write_text(json.dumps({'code':self.gpu_error}))
            return FakeProcess(1)
        result=recovery_fixtures.RecoveryTest.success(command,**kwargs)
        path=directory/'review.json';review=json.loads(path.read_text())
        runtime={'backend_id':backend}
        if backend=='onnxruntime-cuda':runtime['startup_execution']={'node_execution_counts':{'CPUExecutionProvider' if self.bad_proof else 'CUDAExecutionProvider':2}}
        for key in ('receipt','trace'):review[key]['runtime']=runtime
        path.write_text(json.dumps(review));return result
    def start(self,**kwargs):
        self.jobs=Jobs(self.root/'recordings',load_catalog(self.root/'config.json'),process_factory=self.spawn,**kwargs)
        available=self.jobs.available()
        recording=next(r['id'] for r in available['recordings'] if r['name']=='synthetic.webm')
        self.jobs.start({'recording':recording,'model':'synthetic','rules':'presence'})
        self.jobs.thread.join(10);self.assertFalse(self.jobs.thread.is_alive())
        return self.jobs.snapshot()
    def test_default_requires_cuda_proof_and_persists_the_actual_backend(self):
        job=self.start(state_dir=self.root/'retained')
        self.assertEqual(job['state'],'completed',job)
        self.assertEqual(job['backend'],'onnxruntime-cuda')
        self.assertEqual(job['acceleration_code'],'CUDA_STARTUP_VERIFIED')
        self.assertEqual(self.calls,['onnxruntime-cuda']);self.assertIsNone(self.jobs.gpu_slot.owner)
        validate_job(job)
    def test_explicit_cpu_never_attempts_cuda(self):
        job=self.start(backend='opencv-cpu')
        self.assertEqual(job['state'],'completed',job)
        self.assertEqual(self.calls,['opencv-cpu']);self.assertEqual(job['backend'],'opencv-cpu')
    def test_gpu_load_failure_uses_a_fresh_cpu_worker_and_names_fallback(self):
        self.fail_gpu=True
        job=self.start()
        self.assertEqual(job['state'],'completed',job)
        self.assertEqual(self.calls,['onnxruntime-cuda','opencv-cpu'])
        self.assertEqual(job['backend'],'opencv-cpu')
        self.assertEqual(job['acceleration_code'],'CUDA_START_FAILED_CPU_FALLBACK')
        self.assertTrue(self.jobs.gpu_slot.failed);self.assertIsNone(self.jobs.gpu_slot.owner)
    def test_busy_gpu_uses_cpu_without_stealing_the_live_lease(self):
        slot=GpuSlot();slot.acquire('live')
        job=self.start(gpu_slot=slot)
        self.assertEqual(job['state'],'completed',job)
        self.assertEqual(job['acceleration_code'],'GPU_SLOT_BUSY')
        self.assertEqual(self.calls,['opencv-cpu']);self.assertEqual(slot.owner,'live')
    def test_mid_recording_gpu_failure_is_visible_and_not_replayed_on_cpu(self):
        self.fail_gpu=True;self.gpu_error='INFERENCE_FAILED'
        job=self.start()
        self.assertEqual(job['state'],'failed');self.assertEqual(job['error']['code'],'INFERENCE_FAILED')
        self.assertEqual(self.calls,['onnxruntime-cuda']);self.assertIsNone(self.jobs.gpu_slot.owner)
    def test_cancel_reaps_gpu_before_releasing_slot_and_does_not_fallback(self):
        running=FakeProcess()
        self.jobs=Jobs(self.root/'recordings',load_catalog(self.root/'config.json'),process_factory=lambda *a,**k:running)
        choices=self.jobs.available()
        recording=next(r['id'] for r in choices['recordings'] if r['name']=='synthetic.webm')
        job=self.jobs.start({'recording':recording,'model':'synthetic','rules':'presence'})
        deadline=time.monotonic()+3
        while self.jobs.process is None and time.monotonic()<deadline:time.sleep(.01)
        self.assertEqual(self.jobs.gpu_slot.owner,job['id'])
        self.jobs.cancel(job['id']);self.jobs.thread.join(3)
        self.assertFalse(self.jobs.thread.is_alive())
        self.assertTrue(running.killed)
        self.assertIsNone(self.jobs.gpu_slot.owner)
        self.assertFalse(self.jobs.gpu_slot.failed)
        self.assertEqual(self.jobs.snapshot()['state'],'cancelled')

    def test_missing_cuda_only_proof_cannot_publish_gpu_result(self):
        self.bad_proof=True
        job=self.start()
        self.assertEqual(job['state'],'failed');self.assertEqual(job['error']['code'],'RESULT_MISMATCH')
        self.assertIsNone(self.jobs.gpu_slot.owner)
