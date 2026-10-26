"""Synthetic contract tests; none of these fixtures recognize objects."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from edge.model_profiles import (DEFAULT_PROFILE, YOLOX_PROFILE, validate_binding,
                                 prepare, yolox_to_yolov8)
from edge.qualify import inspect_graph, run_bounded

AVAILABLE = all(importlib.util.find_spec(x) for x in ('cv2', 'numpy', 'onnx'))
ROOT = Path(__file__).resolve().parents[1]
LABELS = ROOT / 'edge/labels/coco80.json'
PINNED = 'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063'


class BindingTest(unittest.TestCase):
    def test_pinned_model_and_exact_label_order_are_required(self):
        labels = json.loads(LABELS.read_text())
        validate_binding(YOLOX_PROFILE, PINNED, labels)
        for digest, names in [('0' * 64, labels), (PINNED, list(reversed(labels))), (PINNED, ['person'])]:
            with self.assertRaises(ValueError):
                validate_binding(YOLOX_PROFILE, digest, names)

    def test_labels_reject_duplicates_and_profile_typos(self):
        with self.assertRaises(ValueError):
            validate_binding(DEFAULT_PROFILE, 'unused', ['person', 'person'])
        with self.assertRaises(ValueError):
            validate_binding('yolox-auto', PINNED, ['person'])


@unittest.skipUnless(AVAILABLE, 'Install edge/requirements-test.txt for synthetic qualification tests')
class ProfileTest(unittest.TestCase):
    def test_profiles_preserve_color_range_resize_and_padding(self):
        import cv2
        import numpy as np
        image = np.full((239, 317, 3), (10, 30, 250), dtype=np.uint8)
        blob, scale, padding = prepare(image, YOLOX_PROFILE, cv2, np)
        self.assertEqual(blob.shape, (1, 3, 640, 640))
        self.assertEqual(blob.dtype, np.float32)
        np.testing.assert_array_equal(blob[0, :, 0, 0], [250, 30, 10])
        self.assertEqual(padding, (0, 0))
        end = int(239 * scale)
        np.testing.assert_array_equal(blob[0, :, end - 1, 0], [250, 30, 10])
        np.testing.assert_array_equal(blob[0, :, end, 0], [114] * 3)
        old, _, old_padding = prepare(image, DEFAULT_PROFILE, cv2, np)
        self.assertGreater(old_padding[1], 0)
        np.testing.assert_allclose(old[0, :, 320, 320], np.array([250, 30, 10]) / 255)

    def test_grid_stride_objectness_mapping_and_class_aware_nms(self):
        import cv2
        import numpy as np
        from edge.analyze import decode
        labels = ['person', 'car']
        raw = np.zeros((1, 8400, 7), dtype=np.float32)
        # Grid (20,30), stride 8 -> center (164,244), size (32,48).
        raw[0, 30 * 80 + 20] = [.5, .5, np.log(4), np.log(6), .5, .8, .1]
        # Same box/class at stride 16 should be suppressed, other class kept.
        raw[0, 6400 + 15 * 40 + 10] = [.25, .25, np.log(2), np.log(3), .5, .6, .1]
        raw[0, 8000 + 7 * 20 + 5] = [.125, .625, 0, np.log(1.5), .8, .1, .9]
        result = decode(raw, labels, (320, 320, 3), 2, (0, 0), cv2, np, YOLOX_PROFILE)
        self.assertEqual([d['label'] for d in result], labels)
        self.assertAlmostEqual(result[0]['score'], .4, places=6)
        np.testing.assert_allclose(result[0]['box'], [148/640, 220/640, 32/640, 48/640])
        self.assertAlmostEqual(result[1]['score'], .72, places=6)
        # Objectness must not be ignored when the class is confident.
        raw[0, :, 4] = .01
        self.assertEqual(decode(raw, labels, (320,320,3), 2, (0,0), cv2, np, YOLOX_PROFILE), [])

    def test_bad_shape_probabilities_finite_values_and_overflow_rejected(self):
        import numpy as np
        for raw in [np.zeros((1,85,8400)), np.zeros((1,8399,85))]:
            with self.assertRaises(ValueError):
                yolox_to_yolov8(raw, list(range(80)), np)
        for column, value in [(4, 1.1), (5, -.1), (0, float('nan')), (2, 10000)]:
            raw = np.zeros((1,8400,6), dtype=np.float32)
            raw[0,0,column] = value
            with self.assertRaises(ValueError):
                yolox_to_yolov8(raw, ['person'], np)


@unittest.skipUnless(AVAILABLE and sys.platform == 'linux', 'Linux plus edge test requirements needed')
class QualificationTest(unittest.TestCase):
    def fixture(self, root, output_shape=(1,5,1)):
        import onnx
        import numpy as np
        from onnx import helper as h, TensorProto as T, numpy_helper as nh
        size = int(np.prod(output_shape))
        graph = h.make_graph([
            h.make_node('GlobalAveragePool',['images'],['pool']),
            h.make_node('Flatten',['pool'],['flat']),
            h.make_node('Gemm',['flat','w','b'],['row'], transB=1),
            h.make_node('Reshape',['row','shape'],['detections'])], 'synthetic-not-detector',
            [h.make_tensor_value_info('images',T.FLOAT,[1,3,640,640])],
            [h.make_tensor_value_info('detections',T.FLOAT,list(output_shape))],
            [nh.from_array(np.zeros((size,3),np.float32),'w'),
             nh.from_array(np.zeros(size,np.float32),'b'),
             nh.from_array(np.array(output_shape,np.int64),'shape')])
        model = h.make_model(graph,opset_imports=[h.make_opsetid('',11)])
        model.ir_version = 7
        onnx.save(model,str(root/'fixture.onnx'))
        (root/'labels.json').write_text('["person"]')
        return argparse.Namespace(model=root/'fixture.onnx', labels=root/'labels.json',
                                  profile=DEFAULT_PROFILE, memory_mib=2048, timeout_seconds=15, threads=1)

    def test_subprocess_smoke_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.fixture(root)
            command = [sys.executable,'-m','edge.qualify','--model',str(args.model),
                       '--labels',str(args.labels),'--output',str(root/'report.json')]
            subprocess.run(command,cwd=ROOT,check=True,capture_output=True)
            original = (root/'report.json').read_bytes()
            report = json.loads(original)
            self.assertEqual(report['state'], 'contract-smoke-passed')
            self.assertEqual(len(report['probes']), 3)
            self.assertEqual(report['recognition_accuracy'], 'unmeasured')
            again = subprocess.run(command,cwd=ROOT,capture_output=True)
            self.assertNotEqual(again.returncode, 0)
            self.assertEqual((root/'report.json').read_bytes(), original)

    def test_wrong_export_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.fixture(Path(directory), (1,6,1))
            with self.assertRaises(ValueError):
                inspect_graph(args.model, DEFAULT_PROFILE, ['person'])
            report = run_bounded(args)
            self.assertEqual(report['state'], 'failed')
            self.assertNotIn('probes', report)

    def test_timeout_cannot_be_reported_as_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.fixture(Path(directory))
            with patch('edge.qualify.subprocess.run', side_effect=subprocess.TimeoutExpired('worker', 1)):
                report = run_bounded(args)
            self.assertEqual(report['state'], 'timeout')
            self.assertEqual(report['operational_use'], 'not_qualified')
            self.assertNotIn('probes', report)


if __name__ == '__main__':
    unittest.main()
