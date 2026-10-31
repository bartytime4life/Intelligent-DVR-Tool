"""Backend safety contracts use fake ORT sessions, never claim GPU hardware tests."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from edge.inference import CUDA_OPTIONS, ORT_VERSION, create_backend, OnnxRuntimeCuda
from edge.model_profiles import YOLOX_PROFILE


class Options:
    def __init__(self):
        self.config = {}

    def add_session_config_entry(self, key, value):
        self.config[key] = value

    def get_session_config_entry(self, key):
        return self.config[key]


class FakeOrt:
    __version__ = ORT_VERSION
    SessionOptions = Options

    def __init__(self):
        self.available = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        self.node_providers = ['CUDAExecutionProvider']
        self.provider_options = {k: str(v) for k, v in CUDA_OPTIONS.items()}
        self.inputs = [SimpleNamespace(name='images', shape=[1, 3, 640, 640], type='tensor(float)')]
        self.outputs = [SimpleNamespace(name='output', shape=[1, 8400, 85], type='tensor(float)')]
        self.runs = 0
        self.paths = []
        self.fail_run = False
        self.sessions = []

    def get_available_providers(self):
        return self.available

    def preload_dlls(self, **kwargs):
        self.preload = kwargs

    def InferenceSession(self, model, **kwargs):
        self.creation = kwargs
        owner = self

        class Session:
            def disable_fallback(self):
                owner.fallback_disabled = True

            def get_providers(self):
                return owner.available

            def get_session_options(self):
                return kwargs['sess_options']

            def get_inputs(self):
                return owner.inputs

            def get_outputs(self):
                return owner.outputs

            def get_provider_options(self):
                return {'CUDAExecutionProvider': owner.provider_options}

            def run(self, names, values):
                owner.runs += 1
                if owner.fail_run:
                    raise RuntimeError('Simulated CUDA execution failure')
                return ['fake-output']

            def end_profiling(self):
                path = Path(kwargs['sess_options'].profile_file_prefix+'.json')
                path.write_text(json.dumps([{'cat':'Node','args':{'provider':p}} for p in owner.node_providers]))
                owner.paths.append(path)
                return str(path)

        session = Session()
        self.sessions.append(session)
        return session


NP = SimpleNamespace(float32='float32', zeros=lambda shape, dtype: ('zero-input', shape, dtype))


class BackendTest(unittest.TestCase):
    def test_cpu_path_never_imports_onnxruntime(self):
        net = SimpleNamespace(setPreferableBackend=lambda x: None, setPreferableTarget=lambda x: None,
                              setInput=lambda x: None, forward=lambda: 'cpu-output')
        loaded = []
        cv2 = SimpleNamespace(dnn=SimpleNamespace(readNetFromONNX=lambda p: loaded.append(p) or net,
                             DNN_BACKEND_OPENCV=1, DNN_TARGET_CPU=2))
        np = SimpleNamespace(uint8='uint8', frombuffer=lambda data, dtype: ('buffer', bytes(data), dtype))
        with tempfile.TemporaryDirectory(prefix='modèle-') as directory, \
                patch('edge.inference.importlib.import_module', side_effect=AssertionError('Unexpected import')):
            model = Path(directory) / 'model.onnx'; model.write_bytes(b'onnx-bytes')
            backend = create_backend('opencv-cpu', model, 'yolov8-raw-640', cv2, np, 2,
                                     model_sha256=hashlib.sha256(b'onnx-bytes').hexdigest())
            self.assertEqual(backend.forward('blob'), 'cpu-output')
            self.assertEqual(backend.runtime['backend'], 'OpenCV CPU')
            self.assertEqual(backend.runtime['threads'], 2)
            # The verified bytes, never a (possibly non-ASCII) path, reach OpenCV.
            self.assertEqual(loaded, [('buffer', b'onnx-bytes', 'uint8')])
            with self.assertRaisesRegex(ValueError, 'changed'):
                create_backend('opencv-cpu', model, 'yolov8-raw-640', cv2, np, 2, model_sha256='0' * 64)
            self.assertEqual(len(loaded), 1)

    def test_cuda_runtime_missing_fails_without_cpu(self):
        with patch('edge.inference.importlib.import_module', side_effect=ImportError):
            with self.assertRaisesRegex(ValueError, 'separate'):
                OnnxRuntimeCuda(Path('model.onnx'), NP, 1)

    def test_cuda_rejects_wrong_version_and_missing_provider(self):
        for configure, message in [(lambda o: setattr(o,'__version__','1.20.0'),'requires onnxruntime'),
                                   (lambda o: setattr(o,'available',['CPUExecutionProvider']),'unavailable')]:
            ort = FakeOrt(); configure(ort)
            with self.subTest(message=message), patch('edge.inference.importlib.import_module',return_value=ort):
                with self.assertRaisesRegex(ValueError,message):
                    OnnxRuntimeCuda(Path('model.onnx'), NP, 1)
                self.assertEqual(ort.runs, 0)

    def test_cuda_checks_proof_and_cleans_temporary_profile(self):
        ort = FakeOrt()
        with patch('edge.inference.importlib.import_module',return_value=ort):
            backend = create_backend('onnxruntime-cuda',Path('model.onnx'),YOLOX_PROFILE,None,NP,3)
        self.assertFalse(ort.creation['enable_fallback'])
        self.assertTrue(ort.fallback_disabled)
        self.assertEqual(ort.creation['sess_options'].config['session.disable_cpu_ep_fallback'],'1')
        self.assertEqual(ort.creation['sess_options'].intra_op_num_threads,3)
        self.assertEqual(ort.preload,{'directory':''})
        self.assertEqual(backend.runtime['startup_execution']['node_execution_counts'],{'CUDAExecutionProvider':1})
        self.assertEqual(len(backend.runtime['startup_execution']['profile_sha256']),64)
        self.assertTrue(all(not p.parent.exists() for p in ort.paths))
        self.assertEqual(ort.runs,1)
        self.assertEqual(backend.forward('blob'),'fake-output')
        self.assertEqual(ort.runs,2)
        backend.close();self.assertIsNone(backend.session)

    def test_cuda_refuses_cpu_or_empty_execution_proof(self):
        for providers in (['CPUExecutionProvider'],[],['CUDAExecutionProvider','CPUExecutionProvider']):
            ort=FakeOrt();ort.node_providers=providers
            with self.subTest(providers=providers), patch('edge.inference.importlib.import_module',return_value=ort):
                with self.assertRaisesRegex(ValueError,'execution was not established'):
                    OnnxRuntimeCuda(Path('model.onnx'),NP,1)
            self.assertTrue(all(not p.parent.exists() for p in ort.paths))

    def test_cuda_refuses_changed_precision_or_tensor_contract(self):
        for mutate in (lambda o:o.provider_options.update(use_tf32='1'),
                       lambda o:setattr(o.inputs[0],'shape',[1,3,320,320]),
                       lambda o:setattr(o.outputs[0],'type','tensor(float16)')):
            ort=FakeOrt();mutate(ort)
            with self.subTest(mutate=mutate),patch('edge.inference.importlib.import_module',return_value=ort):
                with self.assertRaises(ValueError):OnnxRuntimeCuda(Path('model.onnx'),NP,1)
                self.assertEqual(ort.runs,0)

    def test_cuda_execution_failure_does_not_retry(self):
        ort=FakeOrt()
        with patch('edge.inference.importlib.import_module',return_value=ort):
            backend=OnnxRuntimeCuda(Path('model.onnx'),NP,1)
        ort.fail_run=True
        with self.assertRaisesRegex(RuntimeError,'Simulated CUDA'):
            backend.forward('blob')
        self.assertEqual(ort.runs,2)  # One startup probe and one failed request.

    def test_wrong_profile_and_unknown_backend_reject_before_import(self):
        with patch('edge.inference.importlib.import_module',side_effect=AssertionError('Unexpected import')):
            for name,profile in [('onnxruntime-cuda','yolov8-raw-640'),('unknown',YOLOX_PROFILE)]:
                with self.subTest(name=name),self.assertRaises(ValueError):
                    create_backend(name,Path('model.onnx'),profile,None,NP,1)

    def test_cuda_cli_requires_explicit_profile_before_reading_files(self):
        from edge.analyze import main
        with contextlib.redirect_stderr(io.StringIO()) as errors,self.assertRaises(SystemExit):
            main(['--video','missing.avi','--model','missing.onnx','--labels','missing.json',
                  '--rules','missing-rules.json','--output','unused.json','--backend','onnxruntime-cuda'])
        self.assertIn('requires --profile',errors.getvalue())
