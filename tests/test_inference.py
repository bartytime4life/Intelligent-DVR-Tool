"""Integration tests use an explicitly synthetic ONNX output, not a trained detector."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

AVAILABLE=all(importlib.util.find_spec(x) for x in ['cv2','numpy','onnx'])


@unittest.skipUnless(AVAILABLE,'Install edge/requirements-test.txt for synthetic inference integration')
class InferenceTest(unittest.TestCase):
    def test_recording_to_review_receipt_with_synthetic_onnx(self):
        import cv2
        import numpy as np
        import onnx
        from onnx import helper,TensorProto,numpy_helper
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            # A tiny network emits a constant box regardless of image contents.
            # This checks importer/preprocessing/decoding/receipt plumbing only.
            nodes=[helper.make_node('GlobalAveragePool',['image'],['pooled']),
                   helper.make_node('Flatten',['pooled'],['flat']),
                   helper.make_node('Gemm',['flat','weights','bias'],['row'],transB=1),
                   helper.make_node('Reshape',['row','shape'],['detections'])]
            initializers=[numpy_helper.from_array(np.zeros((5,3),dtype=np.float32),'weights'),
                          numpy_helper.from_array(np.array([320,320,160,160,.9],dtype=np.float32),'bias'),
                          numpy_helper.from_array(np.array([1,5,1],dtype=np.int64),'shape')]
            graph=helper.make_graph(nodes,'synthetic-fixture',
                 [helper.make_tensor_value_info('image',TensorProto.FLOAT,[1,3,640,640])],
                 [helper.make_tensor_value_info('detections',TensorProto.FLOAT,[1,5,1])],initializers)
            model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',11)]);model.ir_version=7
            onnx.save(model,str(root/'fixture.onnx'))
            writer=cv2.VideoWriter(str(root/'sample.avi'),cv2.VideoWriter_fourcc(*'MJPG'),10,(320,240))
            self.assertTrue(writer.isOpened())
            for _ in range(30):writer.write(np.zeros((240,320,3),dtype=np.uint8))
            writer.release()
            (root/'labels.json').write_text('["person"]')
            (root/'rules.json').write_text('[{"name":"fixture","label":"person","rect":[0,0,1,1],"dwell":1}]')
            command=[sys.executable,'-m','edge.analyze','--video',str(root/'sample.avi'),
                     '--model',str(root/'fixture.onnx'),'--labels',str(root/'labels.json'),
                     '--rules',str(root/'rules.json'),'--output',str(root/'receipt.json'),'--stride','5',
                     '--trace-output',str(root/'trace.json')]
            subprocess.run(command,check=True,capture_output=True,text=True)
            receipt=json.loads((root/'receipt.json').read_text())
            self.assertEqual(receipt['state'],'completed')
            self.assertEqual(receipt['frames_analyzed'],6)
            self.assertEqual(len(receipt['events']),1)
            self.assertEqual(receipt['events'][0]['seconds'],1)
            self.assertEqual(len(receipt['model_sha256']),64)
            self.assertEqual(len(receipt['source_sha256']),64)
            self.assertTrue(receipt['events'][0]['review_required'])
            self.assertEqual(receipt['runtime']['backend_id'],'opencv-cpu')
            self.assertEqual(receipt['runtime']['fallback'],'none')
            from edge.evaluation import evaluate, digest, MANIFEST_SCHEMA
            trace=json.loads((root/'trace.json').read_text())
            self.assertEqual([f['frame_index'] for f in trace['frames']],[0,5,10,15,20,25])
            self.assertEqual(trace['events'],receipt['events'])
            self.assertEqual(trace['runtime']['threads'],1)
            self.assertEqual(trace['runtime']['backend'],'OpenCV CPU')
            # Independently specified geometry for the constant network output.
            # Perfect fixture scores demonstrate plumbing, never recognition.
            manifest={'schema':MANIFEST_SCHEMA,'data_kind':'synthetic',
                      'approval':{'approved_by':'test','source_rights':'generated synthetic pixels',
                                  'annotated_by':'test','annotation_policy':'constant output geometry',
                                  'split':'regression-only'},
                      'labels':'labels.json','classes':['person'],
                      'clips':[{'camera':'offline-camera','source':'sample.avi',
                                'source_sha256':digest(root/'sample.avi'),'frame_count':30,'fps':10,
                                'trace':'trace.json','alert_review_intervals':[[0,3]],
                                'frames':[{'frame_index':i,'objects':[
                                    {'label':'person','box':[.375,1/3,.25,1/3]}]} for i in (0,10)]}]}
            (root/'manifest.json').write_text(json.dumps(manifest))
            result=evaluate(root/'manifest.json')
            self.assertEqual(result['per_class']['person']['precision'],1)
            self.assertEqual(result['per_class']['person']['recall'],1)
            self.assertEqual(result['timing']['count'],6)
            self.assertIsNone(result['false_alerts_per_camera_hour'])
            self.assertEqual(result['qualification']['representative_scene_accuracy'],'unqualified')
            # The tool must never overwrite prior evidence.
            again=subprocess.run(command,capture_output=True)
            self.assertNotEqual(again.returncode,0)
            # A trace collision must not create a second receipt.
            changed=command.copy()
            changed[changed.index('--output')+1]=str(root/'other-receipt.json')
            self.assertNotEqual(subprocess.run(changed,capture_output=True).returncode,0)
            self.assertFalse((root/'other-receipt.json').exists())
            # Receipt-only callers retain the existing schema and review events.
            legacy=command[:-2]
            legacy[legacy.index('--output')+1]=str(root/'receipt-only.json')
            subprocess.run(legacy,check=True,capture_output=True)
            receipt_only=json.loads((root/'receipt-only.json').read_text())
            self.assertEqual(receipt_only['schema'],'intelligent-dvr.receipt.v1')
            self.assertEqual(receipt_only['events'],receipt['events'])
            # A browser-exported policy applies real analyzer caps, not just UI labels.
            policy=json.loads((Path(__file__).parent/'fixtures/resource-policy.json').read_text())
            policy['analysis']['max_frames']=10
            (root/'policy.json').write_text(json.dumps(policy))
            bounded=command.copy()
            bounded[bounded.index('--output')+1]=str(root/'bounded.json')
            bounded[bounded.index('--trace-output')+1]=str(root/'bounded-trace.json')
            bounded += ['--resource-policy',str(root/'policy.json')]
            subprocess.run(bounded,check=True,capture_output=True)
            limited=json.loads((root/'bounded.json').read_text())
            self.assertEqual(limited['frames_read'],10)
            self.assertEqual(limited['frames_analyzed'],2)
            self.assertEqual(limited['resource_policy']['opencv_threads'],1)
            self.assertEqual(limited['resource_policy']['max_frames'],10)
            self.assertEqual(len(limited['resource_policy']['sha256']),64)
            failed=subprocess.run(bounded+['--threads','2'],capture_output=True)
            self.assertNotEqual(failed.returncode,0)
            self.assertIn(b'exceed',failed.stderr)

    def test_decoder_rejects_unsupported_shape_and_maps_letterbox(self):
        import cv2
        import numpy as np
        from edge.analyze import decode
        with self.assertRaises(ValueError):decode(np.zeros((1,6,1)),['person'],(240,320,3),2,(0,80),cv2,np)
        raw=np.array([[[320],[320],[160],[160],[.9]]],dtype=np.float32)
        result=decode(raw,['person'],(240,320,3),2,(0,80),cv2,np)
        self.assertAlmostEqual(result[0]['box'][0],.375)
        self.assertAlmostEqual(result[0]['box'][1],1/3)
        self.assertAlmostEqual(result[0]['box'][2],.25)
        self.assertAlmostEqual(result[0]['box'][3],1/3)
        raw[0,4,0]=2
        with self.assertRaises(ValueError):decode(raw,['person'],(240,320,3),2,(0,80),cv2,np)
