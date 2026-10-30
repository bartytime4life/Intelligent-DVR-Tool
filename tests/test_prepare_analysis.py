import hashlib
import json
from pathlib import Path
import tempfile
import unittest
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
