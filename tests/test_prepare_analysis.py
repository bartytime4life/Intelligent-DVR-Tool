import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from edge.prepare_analysis import prepare, ROOT


class PrepareAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        (self.root/'edge/candidates').mkdir(parents=True); (self.root/'edge/labels').mkdir()
        labels=(ROOT/'edge/labels/coco80.json').read_bytes(); (self.root/'edge/labels/coco80.json').write_bytes(labels)
        self.model=self.root/'selected.onnx'; self.model.write_bytes(b'synthetic-pinned-test-model')
        c=json.loads((ROOT/'edge/candidates/opencv-zoo-yolox-s-2022nov.json').read_text())
        c['model_bytes']=self.model.stat().st_size;c['model_sha256']=hashlib.sha256(self.model.read_bytes()).hexdigest()
        (self.root/'edge/candidates/opencv-zoo-yolox-s-2022nov.json').write_text(json.dumps(c))
    def tearDown(self): self.temp.cleanup()
    def test_preparation_verifies_copy_and_builds_portable_catalog_without_inference(self):
        path=prepare(self.model,root=self.root)
        self.assertEqual((path/'yolox-s.onnx').read_bytes(),self.model.read_bytes())
        catalog=json.loads((path/'catalog.json').read_text())
        self.assertEqual(catalog['models'][0]['labels'],'coco80.json')
        self.assertTrue((path/'recordings').is_dir())
        self.assertEqual(json.loads((path/'rules.json').read_text())[0]['rect'],[0,0,1,1])
        self.assertEqual(list(self.root.glob('.analysis-setup-*')),[])
    def test_wrong_model_or_labels_leave_no_configuration(self):
        for path in (self.model,self.root/'edge/labels/coco80.json'):
            original=path.read_bytes(); path.write_bytes(b'x'*len(original))
            with self.assertRaises(ValueError): prepare(self.model,root=self.root)
            self.assertFalse((self.root/'local-analysis').exists())
            self.assertEqual(list(self.root.glob('.analysis-setup-*')),[])
            path.write_bytes(original)
    def test_existing_settings_and_recordings_are_never_replaced(self):
        path=prepare(self.model,root=self.root); private=path/'recordings/keep.webm';private.write_bytes(b'original')
        with self.assertRaisesRegex(ValueError,'preserved'): prepare(self.model,root=self.root)
        self.assertEqual(private.read_bytes(),b'original')

    def face_models(self):
        from edge.faces import DETECTOR, RECOGNIZER
        result=[]
        for spec in (DETECTOR, RECOGNIZER):
            data=('synthetic '+spec['profile']).encode()
            source=self.root/spec['file'];source.write_bytes(data)
            result.append((source,{**spec,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}))
        return result

    def test_both_face_models_verified_before_catalog_is_published(self):
        (detector,ds),(recognizer,rs)=self.face_models()
        with patch('edge.faces.DETECTOR',ds),patch('edge.faces.RECOGNIZER',rs):
            path=prepare(self.model,root=self.root,face_detector=detector,face_recognizer=recognizer)
        config=json.loads((path/'catalog.json').read_text())
        self.assertEqual((path/config['faces']['detector']).read_bytes(),detector.read_bytes())
        self.assertEqual((path/config['faces']['recognizer']).read_bytes(),recognizer.read_bytes())
        self.assertEqual(json.loads((path/'face-model-source.json').read_text())['recognizer']['sha256'],rs['sha256'])
        if __import__('os').name!='nt':
            self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in path.rglob('*') if p.is_file()))

    def test_missing_or_wrong_face_model_never_configures_analysis(self):
        (detector,ds),(recognizer,rs)=self.face_models()
        with self.assertRaises(ValueError): prepare(self.model,root=self.root,face_detector=detector)
        recognizer.write_bytes(b'x'*rs['bytes'])
        with patch('edge.faces.DETECTOR',ds),patch('edge.faces.RECOGNIZER',rs),self.assertRaises(ValueError):
            prepare(self.model,root=self.root,face_detector=detector,face_recognizer=recognizer)
        self.assertFalse((self.root/'local-analysis').exists())
        self.assertEqual(list(self.root.glob('.analysis-setup-*')),[])

    def test_interrupted_publication_does_not_leave_a_usable_catalog(self):
        with patch('edge.prepare_analysis.os.rename',side_effect=OSError('disk full')),self.assertRaises(OSError):
            prepare(self.model,root=self.root)
        self.assertFalse((self.root/'local-analysis/catalog.json').exists())
        with self.assertRaisesRegex(ValueError,'preserved'): prepare(self.model,root=self.root)
