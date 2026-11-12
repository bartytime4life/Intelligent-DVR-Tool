"""Generated JSON replacement races; no footage, models, network or inference.

Compare the public baseline evaluator with the working evaluator. Output must be
new; fixture files and the temporary baseline module are removed on completion.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
BASELINE = 'c517b438789efbe81d410f23f2a0a173ed72c86c'
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT/'tests'))
import edge.evaluation as current
from evaluation_fixtures import make_fixture, write_json


def git_bytes(name):
    return subprocess.check_output(['git', 'show', f'{BASELINE}:{name}'], cwd=ROOT)


def replacement(name, value):
    value = copy.deepcopy(value)
    if name == 'manifest.json':
        value['clips'][0]['frames'][1]['objects'].pop(1)
    elif name == 'trace.json':
        for frame in value['frames']:
            frame['detections'] = []
        value['events'] = []
    elif name == 'labels.json':
        value.reverse()
    else:
        for decision in value['decisions']:
            decision['verdict'] = 'confirmed'
    return value


def race(module, name):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        make_fixture(root)
        target = root/name
        original = target.read_bytes()
        changed = replacement(name, json.loads(original))
        snapshot_api = hasattr(module, 'read_json_snapshot')
        # Legacy traces were hashed before parsing; the other JSON inputs were
        # parsed before their separate hashes. Inject at that exact boundary.
        function = 'read_json_snapshot' if snapshot_api else 'digest' if name == 'trace.json' else 'read_json'
        reader = getattr(module, function)
        replaced = False
        def capture_then_replace(path, *args, **kwargs):
            nonlocal replaced
            result = reader(path, *args, **kwargs)
            if Path(path) == target and not replaced:
                replaced = True
                write_json(target, changed)
            return result
        with patch.object(module, function, side_effect=capture_then_replace):
            try:
                report = module.evaluate(root/'manifest.json', root/'reviews.json' if name == 'reviews.json' else None)
            except ValueError as error:
                return {'status': 'rejected', 'reason': str(error)}
        used = target.read_bytes() if not snapshot_api and name == 'trace.json' else original
        reported = report['clips'][0]['trace_sha256'] if name == 'trace.json' else report[{
            'manifest.json': 'manifest_sha256', 'labels.json': 'labels_sha256', 'reviews.json': 'reviews_sha256',
        }[name]]
        return {'status': 'evaluated', 'reported_sha256': reported,
                'evaluated_bytes_sha256': hashlib.sha256(used).hexdigest(),
                'hash_matches_evaluated_bytes': reported == hashlib.sha256(used).hexdigest(),
                'person_counts': report['per_class']['person'],
                'reviewed_false_alerts': report['reviewed_false_alerts']}


def reproduce():
    baseline_bytes = git_bytes('edge/evaluation.py')
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)/'baseline_evaluation.py'
        path.write_bytes(baseline_bytes)
        baseline = types.ModuleType('edge._binding_baseline')
        baseline.__package__, baseline.__file__ = 'edge', str(path)
        exec(compile(baseline_bytes, str(path), 'exec'), baseline.__dict__)
        cases = {name: {'before': race(baseline, name), 'after': race(current, name)}
                 for name in ('manifest.json', 'trace.json', 'labels.json', 'reviews.json')}
    for name, result in cases.items():
        assert result['after']['hash_matches_evaluated_bytes'] is True, name
        if name != 'labels.json':
            assert result['before']['hash_matches_evaluated_bytes'] is False, name
    protected = ('inference.py', 'journal.py', 'supervision.py', 'scheduler.py', 'profiling.py')
    unchanged = {name: git_bytes('edge/'+name) == (ROOT/'edge'/name).read_bytes() for name in protected}
    assert all(unchanged.values())
    return {'schema': 'intelligent-dvr.evaluation-input-binding-proof.v1',
            'baseline_revision': BASELINE, 'generated_only': True,
            'baseline_evaluator_sha256': hashlib.sha256(baseline_bytes).hexdigest(),
            'candidate_evaluator_sha256': current.digest(ROOT/'edge/evaluation.py'),
            'cases': cases, 'protected_runtime_files_unchanged': unchanged,
            'scope': 'Deterministic JSON replacement injection; not camera, model, accuracy or capacity qualification.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New metadata-only proof JSON')
    args = parser.parse_args()
    result = reproduce()
    with args.output.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print('Generated input-binding proof: four captured JSON hashes match evaluated bytes; protected runtime files unchanged.')
