"""Prepare a private local analysis folder from an explicitly selected pinned model."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def prepare(model, *, root=ROOT, face_detector=None, face_recognizer=None):
    """No download/inference. Validate copied weights before publishing settings."""
    from .evaluation import local_file
    if (face_detector is None) != (face_recognizer is None):
        raise ValueError('Select both the pinned face detector and face recognizer, or neither.')
    model = local_file(model)
    candidate = json.loads((root / 'edge/candidates/opencv-zoo-yolox-s-2022nov.json').read_text())
    if model.stat().st_size != candidate['model_bytes']:
        raise ValueError('Select the pinned OpenCV Zoo YOLOX-S ONNX model (35,858,002 bytes).')
    destination = root / 'local-analysis'
    if destination.exists() or destination.is_symlink():
        raise ValueError('local-analysis already exists. Existing models, settings and recordings were preserved. Use --analysis or choose a fresh installation folder.')
    temp = Path(tempfile.mkdtemp(prefix='.analysis-setup-', dir=root))
    try:
        copied = temp / 'yolox-s.onnx'
        digest = hashlib.sha256()
        size = 0
        with model.open('rb') as source, copied.open('xb') as target:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                size += len(block)
                if size > candidate['model_bytes']:
                    raise ValueError('Model changed during setup.')
                target.write(block); digest.update(block)
        if size != candidate['model_bytes'] or digest.hexdigest() != candidate['model_sha256']:
            raise ValueError('Model fingerprint does not match the pinned pretrained model. Nothing was configured.')
        labels = (root / candidate['labels_path']).read_bytes()
        if hashlib.sha256(labels).hexdigest() != candidate['labels_sha256']:
            raise ValueError('Installed label fingerprint is invalid. Restore the trusted installation.')
        (temp / 'coco80.json').write_bytes(labels)
        # Whole-frame class presence only; users can add their own reviewed zones.
        rules = [{'name':'whole-frame person presence', 'label':'person', 'rect':[0,0,1,1], 'threshold':.5, 'dwell':0}]
        (temp / 'rules.json').write_text(json.dumps(rules, indent=2)+'\n', encoding='utf-8')
        config = {'models':[{'id':'yolox-s','name':'YOLOX-S · 80 classes · CPU','path':'yolox-s.onnx',
            'labels':'coco80.json','profile':candidate['profile'],'sha256':candidate['model_sha256']}],
            'rules':[{'id':'person-presence','name':'Person present · whole frame','path':'rules.json'}]}
        if face_detector is not None:
            from .faces import DETECTOR, RECOGNIZER, verify_model
            (temp / 'faces').mkdir(mode=0o700)
            config['faces'] = {}
            for key, source, spec in (('detector', face_detector, DETECTOR), ('recognizer', face_recognizer, RECOGNIZER)):
                source = local_file(source)
                if source.stat().st_size != spec['bytes']:
                    raise ValueError('Select the pinned OpenCV Zoo face models.')
                target = temp / 'faces' / spec['file']
                # Bound the copy even if the selected file changes while being read.
                with source.open('rb') as stream, target.open('xb') as output:
                    remaining = spec['bytes'] + 1
                    while remaining:
                        block = stream.read(min(1024 * 1024, remaining))
                        if not block:
                            break
                        output.write(block)
                        remaining -= len(block)
                verify_model(target, spec)
                config['faces'][key] = 'faces/' + spec['file']
            (temp / 'face-model-source.json').write_text(json.dumps({
                'upstream_repository': 'opencv/opencv_zoo',
                'upstream_revision': candidate['upstream_revision'],
                'detector': DETECTOR, 'recognizer': RECOGNIZER,
            }, indent=2)+'\n', encoding='utf-8')
        (temp / 'catalog.json').write_text(json.dumps(config, indent=2)+'\n', encoding='utf-8')
        (temp / 'recordings').mkdir(mode=0o700)
        (temp / 'model-source.json').write_text(json.dumps(candidate, indent=2)+'\n', encoding='utf-8')
        for file in temp.rglob('*'):
            if file.is_file():
                file.chmod(0o600)
        # Exclusive directory creation avoids replacing another setup in a race.
        destination.mkdir(mode=0o700)
        # Publish the catalog last; an interrupted copy must not look configured.
        for child in sorted(temp.iterdir(), key=lambda p: p.name == 'catalog.json'):
            os.rename(child, destination / child.name)
        return destination
    finally:
        shutil.rmtree(temp)
