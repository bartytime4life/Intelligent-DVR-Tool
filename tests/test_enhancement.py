"""Synthetic pixels/labels test comparison integrity, not camera recognition."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from edge.enhancement import declaration, sharpen, validate_trace
from edge.evaluation import evaluate
from evaluation_fixtures import make_fixture, write_json

AVAILABLE = all(importlib.util.find_spec(x) for x in ('cv2', 'numpy', 'onnx'))


def attach_comparison(trace):
    trace['enhancement_comparison'] = declaration()
    for frame in trace['frames']:
        frame['comparison'] = {'detections': [], 'original_processing_ms': 10,
            'enhanced_processing_ms': 14, 'enhancement_ms': 2,
            'source_pixels_sha256': 'a'*64, 'enhanced_pixels_sha256': 'b'*64}


class ComparisonEvaluationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest, self.trace, _ = make_fixture(self.root)
        attach_comparison(self.trace)

    def run_eval(self):
        write_json(self.root/'trace.json', self.trace)
        return evaluate(self.root/'manifest.json')

    def test_independent_candidate_errors_leave_original_metrics_and_alerts_unchanged(self):
        result = self.run_eval()
        self.assertEqual(result['per_class']['person']['TP'], 2)
        candidate = result['enhancement_comparison']
        self.assertEqual(candidate['per_class']['person'],
            {'TP':0,'FP':0,'FN':3,'precision':None,'recall':0})
        self.assertEqual(candidate['per_class']['car']['FN'], 1)
        self.assertEqual(candidate['qualification'], 'unqualified')
        self.assertEqual(candidate['rule_observations'], 'original-only')
        self.assertEqual(candidate['original_processing']['p50_ms'], 10)
        self.assertEqual(candidate['enhanced_processing']['p95_ms'], 14)
        self.assertEqual(len(candidate['detection_evidence']), 4)
        self.assertEqual(result['clips'][0]['covered_alerts'], 2)
        self.assertIsNone(result['false_alerts_per_camera_hour'])
        self.assertTrue(all(v == 'unqualified' for v in result['qualification'].values()))
        self.assertEqual(result, self.run_eval())

    def test_bad_or_incomplete_comparisons_fail_instead_of_silently_becoming_baseline(self):
        original = copy.deepcopy(self.trace)
        changes = [
            lambda t: t['enhancement_comparison'].update(implementation_sha256='0'*64),
            lambda t: t['enhancement_comparison'].update(qualification='qualified'),
            lambda t: t['enhancement_comparison']['parameters'].update(scale=True),
            lambda t: t['frames'][0].pop('comparison'),
            lambda t: t.pop('enhancement_comparison'),
            lambda t: t['frames'][0]['comparison'].update(enhancement_ms=15),
            lambda t: t['frames'][0]['comparison'].update(enhanced_pixels_sha256='bad'),
            lambda t: t['frames'][0]['comparison'].update(detections=[{'label':'unknown','score':.9,'box':[0,0,.1,.1]}]),
            lambda t: t['frames'][0]['comparison'].update(detections=[{'label':'person','score':.9,'box':[.9,0,.5,.1]}]),
            lambda t: t['frames'][0]['comparison'].update(detections=[{'label':'person','score':.9,'box':[0,0,.1,.1]}]*100001),
        ]
        for mutate in changes:
            with self.subTest(mutate=mutate):
                self.trace = copy.deepcopy(original); mutate(self.trace)
                with self.assertRaises(ValueError): self.run_eval()

    def test_warmup_changes_only_comparison_timing_and_unlabeled_means_unmeasured(self):
        # Browser JSON serialization writes 1.0 as 1; preserve a valid round-trip.
        self.trace['enhancement_comparison']['parameters']['sigma'] = 1
        self.manifest['clips'][0]['frames'] = []
        write_json(self.root/'manifest.json', self.manifest)
        write_json(self.root/'trace.json', self.trace)
        result = evaluate(self.root/'manifest.json', warmup_frames=4)
        self.assertIsNone(result['enhancement_comparison']['micro']['recall'])
        self.assertIsNone(result['enhancement_comparison']['original_processing']['p95_ms'])


@unittest.skipUnless(AVAILABLE, 'Optional native synthetic-inference runtime required')
class NativeEnhancementTest(unittest.TestCase):
    def test_sharpen_preserves_flat_pixels_dimensions_and_source_and_saturates_edges(self):
        import cv2
        import numpy as np
        flat = np.full((20,30,3), 73, np.uint8)
        self.assertTrue(np.array_equal(sharpen(flat,cv2,np), flat))
        image = np.full((20,30,3), 80, np.uint8); image[:,15:] = 170
        before=image.copy(); result=sharpen(image,cv2,np)
        self.assertTrue(np.array_equal(image,before))
        self.assertEqual(result.shape,image.shape); self.assertEqual(result.dtype,np.uint8)
        self.assertLess(int(result[10,14,0]),80); self.assertGreater(int(result[10,15,0]),170)
        self.assertTrue(np.array_equal(result,sharpen(image,cv2,np)))
        high=np.zeros((20,30,3),np.uint8); high[:,15:]=255
        self.assertTrue(np.array_equal(sharpen(high,cv2,np),high))
        noise=flat.copy(); noise[10,15]=75
        self.assertTrue(np.array_equal(sharpen(noise,cv2,np),noise))
        for bad in (image.astype(np.float32), image[:,:,0], np.zeros((0,2,3),np.uint8),
                    np.zeros((2161,3840,3),np.uint8)):
            with self.assertRaises(ValueError): sharpen(bad,cv2,np)

    def test_native_job_comparison_and_persistent_recovery(self):
        import cv2
        import numpy as np
        from local_analysis_fixture import build
        from edge.local_service import Jobs, load_catalog, JobError
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw); build(root)
            video=root/'recordings'/'edges.avi'
            writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*'MJPG'),10,(320,240))
            self.assertTrue(writer.isOpened())
            image=np.full((240,320,3),80,np.uint8); image[:,160:]=170
            for _ in range(30): writer.write(image)
            writer.release()
            source_before=video.read_bytes()
            state=root/'state' if sys.platform=='linux' else None
            service=Jobs(root/'recordings',load_catalog(root/'config.json'),state_dir=state)
            try:
                choices=service.available()
                self.assertEqual(choices['enhancement_comparisons'],['mild-unsharp-v1'])
                recording=next(v['id'] for v in choices['recordings'] if v['name']=='edges.avi')
                request={'recording':recording,'model':'synthetic','rules':'presence'}
                for bad in (True,'unknown','https://example.test/model'):
                    with self.assertRaises(JobError): service.start({**request,'compare_enhancement':bad})
                job=service.start({**request,'compare_enhancement':'mild-unsharp-v1'})
                service.thread.join(30)
                self.assertFalse(service.thread.is_alive())
                final=service.snapshot()
                self.assertEqual(final['state'],'completed',final)
                result,_=service.artifact(job['id'],'result')
                bundle=json.loads(result.read_text()); trace=bundle['trace']
                self.assertEqual(bundle['receipt']['enhancement_comparison'],declaration())
                self.assertEqual(bundle['receipt']['source_sha256'],hashlib.sha256(source_before).hexdigest())
                self.assertEqual(video.read_bytes(),source_before)
                self.assertEqual(final['frames_analyzed'],6)
                self.assertEqual(len(bundle['receipt']['events']),1)
                self.assertEqual(trace['events'],bundle['receipt']['events'])
                validate_trace(trace,['person'],current_code=True)
                cap=cv2.VideoCapture(str(video)); ok,decoded=cap.read(); cap.release(); self.assertTrue(ok)
                c=trace['frames'][0]['comparison']
                self.assertEqual(c['source_pixels_sha256'],hashlib.sha256(decoded.tobytes()).hexdigest())
                self.assertEqual(c['enhanced_pixels_sha256'],hashlib.sha256(sharpen(decoded,cv2,np).tobytes()).hexdigest())
                self.assertNotEqual(c['source_pixels_sha256'],c['enhanced_pixels_sha256'])
                self.assertEqual(trace['frames'][0]['detections'],c['detections'])  # Constant fixture, not accuracy.
            finally: service.close()
            if state:
                recovered=Jobs(root/'recordings',load_catalog(root/'config.json'),state_dir=state)
                try:
                    self.assertIsNone(recovered.thread)
                    self.assertTrue(recovered.snapshot()['recovered'])
                    self.assertEqual(recovered.snapshot()['compare_enhancement'],'mild-unsharp-v1')
                    result,_=recovered.artifact(job['id'],'result')
                    self.assertEqual(json.loads(result.read_text()),bundle)
                finally: recovered.close()

    def test_comparison_failure_does_not_publish_baseline_as_success(self):
        from local_analysis_fixture import build
        from edge.analyze import main
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw); build(root)
            args=['--video',str(root/'recordings'/'synthetic.webm'),'--model',str(root/'fixture.onnx'),
                  '--labels',str(root/'labels.json'),'--rules',str(root/'rules.json'),
                  '--output',str(root/'receipt.json'),'--review-output',str(root/'review.json'),
                  '--compare-enhancement','mild-unsharp-v1']
            with patch('edge.analyze.sharpen',side_effect=RuntimeError('controlled transform failure')):
                with self.assertRaisesRegex(RuntimeError,'controlled transform'): main(args)
            self.assertFalse((root/'receipt.json').exists()); self.assertFalse((root/'review.json').exists())
            dump=json.dump
            def exhausted(document, stream, **kwargs):
                if document.get('schema') == 'intelligent-dvr.recognition-review.v1':
                    raise OSError(28, 'controlled disk exhaustion')
                return dump(document, stream, **kwargs)
            with patch('edge.analyze.json.dump',side_effect=exhausted):
                with self.assertRaises(OSError): main(args)
            self.assertFalse((root/'receipt.json').exists()); self.assertFalse((root/'review.json').exists())
            with self.assertRaises(SystemExit): main(args[:args.index('--review-output')]+args[-2:])
            main(args+['--max-frames','10'])
            bundle=json.loads((root/'review.json').read_text())
            self.assertEqual(bundle['receipt']['state'],'partial')
            self.assertEqual(len(bundle['trace']['frames']),2)
            validate_trace(bundle['trace'],['person'],current_code=True)
            before=(root/'review.json').read_bytes()
            with self.assertRaises(SystemExit): main(args)
            self.assertEqual((root/'review.json').read_bytes(),before)
