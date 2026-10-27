"""Deterministic supplied detections/timings. No pixels or recognition evidence."""
import hashlib
import json
from pathlib import Path

from edge.evaluation import (MANIFEST_SCHEMA, REVIEW_SCHEMA, TRACE_SCHEMA,
                             canonical_hash, digest)
from edge.model_profiles import ASSETS, DEFAULT_PROFILE
from edge.rules import Rule, RuleEngine


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+'\n', encoding='utf-8', newline='\n')


def make_fixture(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    (root/'source.synthetic.txt').write_text('SYNTHETIC metadata source. This is not a recording.\n',
                                           encoding='utf-8', newline='\n')
    write_json(root/'labels.json', ['person', 'car', 'bicycle'])
    model_hash = hashlib.sha256(b'synthetic fixture; no trained detector').hexdigest()
    source_hash = digest(root/'source.synthetic.txt')
    rules = [{'name': 'fixture zone', 'label': 'person', 'rect': [0, 0, 1, 1],
              'threshold': .7, 'dwell': 0, 'max_gap': 2}]
    person = {'label': 'person', 'score': .9, 'box': [.1, .1, .2, .2]}
    car = {'label': 'car', 'score': .8, 'box': [.6, .6, .2, .2]}
    run_id = hashlib.sha256((source_hash+model_hash).encode()).hexdigest()
    engine = RuleEngine([Rule(**r) for r in rules], 'synthetic-camera', run_id)
    observations = [[person, {**person, 'score': .8}, car],
                    [person, car, {**person, 'score': .2}], [], [person]]
    frames = [{'frame_index': i, 'seconds': i/1, 'detections': detections,
               'inference_decode_ms': (i+1)*10} for i, detections in enumerate(observations)]
    events = [event for frame in frames for event in engine.update(frame['seconds'], frame['detections'])]
    trace = {'schema': TRACE_SCHEMA, 'origin': 'precomputed-synthetic', 'state': 'completed',
             'source_sha256': source_hash, 'model_sha256': model_hash,
             'labels_sha256': digest(root/'labels.json'), 'inference_profile': DEFAULT_PROFILE,
             'rules_sha256': canonical_hash(rules), 'rules': rules, 'run_id': run_id,
             'rule_engine_sha256': digest(ASSETS/'rules.py'),
             'camera': 'synthetic-camera', 'frames_read': 4, 'fps_metadata': 1, 'stride': 1,
             'frames': frames, 'events': events,
             'runtime': {'scope': 'supplied synthetic timing values; no model execution'}}
    write_json(root/'trace.json', trace)
    manifest = {'schema': MANIFEST_SCHEMA, 'data_kind': 'synthetic',
                'approval': {'approved_by': 'synthetic-fixture', 'source_rights': 'generated text; no footage',
                             'annotated_by': 'deterministic-fixture-generator', 'split': 'regression-only',
                             'annotation_policy': 'exhaustive classes on listed frames; supplied synthetic boxes'},
                'labels': 'labels.json', 'classes': ['person', 'car', 'bicycle'],
                'clips': [{'camera': 'synthetic-camera', 'source': 'source.synthetic.txt',
                           'source_sha256': source_hash, 'frame_count': 4, 'fps': 1,
                           'trace': 'trace.json', 'alert_review_intervals': [[0, 4]],
                           'frames': [{'frame_index': 0, 'objects': [{'label': 'person', 'box': person['box']}]},
                                      {'frame_index': 1, 'objects': [
                                          {'label': 'person', 'box': person['box']},
                                          {'label': 'person', 'box': [.4, .1, .2, .2]},
                                          {'label': 'car', 'box': car['box']}]},
                                      {'frame_index': 2, 'objects': []},
                                      {'frame_index': 3, 'objects': []}]}]}
    write_json(root/'manifest.json', manifest)
    reviews = {'schema': REVIEW_SCHEMA, 'manifest_sha256': digest(root/'manifest.json'),
               'decisions': [{'trace_sha256': digest(root/'trace.json'), 'event_id': event['id'],
                              'verdict': verdict, 'reviewer': 'synthetic-fixture-reviewer',
                              'rationale': 'Supplied synthetic decision, not an actual human scene review.',
                              'reviewed_at': '2026-10-27T00:00:00Z'}
                             for event, verdict in zip(events, ('confirmed', 'false_alert'))]}
    write_json(root/'reviews.json', reviews)
    return manifest, trace, reviews


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='New empty fixture directory')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Use a new directory; do not overwrite fixtures/evidence')
    make_fixture(args.output)
