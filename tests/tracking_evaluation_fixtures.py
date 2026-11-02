"""Synthetic anonymous paths and detector inputs; labels never use tracker output.

No footage, pixels, model, human identity or camera access. Repeatable bytes.
"""
import argparse
import hashlib
from pathlib import Path

from edge.evaluation import MANIFEST_SCHEMA, TRACE_SCHEMA, canonical_hash, digest
from edge.model_profiles import ASSETS, DEFAULT_PROFILE
from edge.rules import Rule, RuleEngine
from edge.tracking import Tracker
from edge.tracking_evaluation import LABEL_SCHEMA
from evaluation_fixtures import write_json


def obj(key='A', x=.1, y=.2, label='person'):
    return {'track_id': key, 'label': label, 'box': [x, y, .18, .3]}


def prediction(truth, score=.9):
    return {'label': truth['label'], 'box': list(truth['box']), 'score': score}


def scenarios():
    # Two independently prescribed paths pass each other. At the exact overlap
    # the labeler keeps both anonymous IDs; no inference is used to label them.
    crossing = [[obj('A', .1+i*.03), obj('B', .7-i*.03)] for i in range(21)]
    occlusion = [[obj(x=.1+i*.005)] for i in range(10)]
    leaving = [[obj()] if i < 3 or i >= 18 else [] for i in range(22)]
    confidence = [[obj(x=.1+i*.003)] for i in range(10)]
    return {
        'crossing': (crossing, [[prediction(o) for o in f] for f in crossing]),
        'temporary-occlusion': (occlusion, [[prediction(o) for o in f] if i not in (3, 4, 5) else []
                                            for i, f in enumerate(occlusion)]),
        'disappearance-reappearance': (leaving, [[prediction(o) for o in f] for f in leaving]),
        'confidence-changes': (confidence, [[prediction(o, [.9, .9, .35, .2, .1, .9, .55, .9, .9, .9][i])
                                           for o in f] for i, f in enumerate(confidence)]),
    }


def make_fixture(root, truth_frames=None, predictions=None, fps=10, stride=2, tracker=True):
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    truth_frames = truth_frames if truth_frames is not None else [[obj()] for _ in range(4)]
    predictions = predictions if predictions is not None else [[prediction(o) for o in f] for f in truth_frames]
    (root/'source.synthetic.txt').write_text('SYNTHETIC tracking sequence '+root.name+'; not footage.\n', encoding='utf-8', newline='\n')
    write_json(root/'labels.json', ['person', 'car'])
    source_hash = digest(root/'source.synthetic.txt')
    model_hash = hashlib.sha256(b'no detector; synthetic tracking inputs').hexdigest()
    run_id = hashlib.sha256((source_hash+model_hash).encode()).hexdigest()
    rules = [{'name': 'review', 'label': 'person', 'rect': [0, 0, 1, 1],
              'threshold': .7, 'dwell': 0, 'max_gap': 2}]
    engine = RuleEngine([Rule(**r) for r in rules], 'synthetic-camera', run_id)
    actual = Tracker()
    frames, events = [], []
    for i, objects in enumerate(predictions):
        detections = [dict(d, box=list(d['box'])) for d in objects]
        seconds = i*stride/fps
        if tracker:
            for d, track in zip(detections, actual.update(seconds, detections, 1000, 600)):
                if track is not None:
                    d['track'] = track
        events.extend(engine.update(seconds, detections))
        frames.append({'frame_index': i*stride, 'seconds': seconds, 'width': 1000, 'height': 600,
                       'detections': detections, 'inference_decode_ms': 0})
    tracks = actual.finish()
    if not tracker:
        by_id = {}
        for f in frames:
            for d in f['detections']:
                if 'track' not in d: continue
                t = by_id.setdefault(d['track'], {'id': d['track'], 'label': d['label'],
                    'first_seconds': f['seconds'], 'last_seconds': f['seconds'], 'hits': 0})
                t['last_seconds'] = f['seconds']; t['hits'] += 1
        tracks['tracks'] = list(by_id.values())
    tracks['tracker_sha256'] = digest(ASSETS/'tracking.py')
    trace = {'schema': TRACE_SCHEMA, 'origin': 'precomputed-synthetic', 'state': 'completed',
             'source_sha256': source_hash, 'model_sha256': model_hash,
             'labels_sha256': digest(root/'labels.json'), 'inference_profile': DEFAULT_PROFILE,
             'rules_sha256': canonical_hash(rules), 'rules': rules, 'run_id': run_id,
             'rule_engine_sha256': digest(ASSETS/'rules.py'), 'camera': 'synthetic-camera',
             'frames_read': (len(frames)-1)*stride+1, 'fps_metadata': fps, 'stride': stride,
             'frames': frames, 'events': events, 'tracking': tracks}
    manifest = {'schema': MANIFEST_SCHEMA, 'data_kind': 'synthetic',
                'approval': {'approved_by': 'synthetic fixture', 'source_rights': 'generated metadata; no footage',
                             'annotated_by': 'independent path specification', 'split': 'evaluator-regression',
                             'annotation_policy': 'All named paths on every sampled frame; occluded objects retained as labeled misses.'},
                'tracking': {'schema': LABEL_SCHEMA, 'independent_labels': True,
                             'coverage': 'all-sampled-frames', 'timebase': 'constant-frame-rate',
                             'id_policy': 'Anonymous ID persists through short occlusion and departure/reentry in this clip.'},
                'labels': 'labels.json', 'classes': ['person', 'car'],
                'clips': [{'camera': 'synthetic-camera', 'source': 'source.synthetic.txt',
                           'source_sha256': source_hash, 'frame_count': trace['frames_read'], 'fps': fps,
                           'trace': 'trace.json', 'alert_review_intervals': [],
                           'frames': [{'frame_index': i*stride, 'seconds': i*stride/fps, 'objects': objects}
                                      for i, objects in enumerate(truth_frames)]}]}
    write_json(root/'trace.json', trace); write_json(root/'manifest.json', manifest)
    return manifest, trace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='New directory for metadata-only scenarios')
    args = parser.parse_args(argv)
    args.output.mkdir(exist_ok=False)
    for name, (truth, predictions) in scenarios().items():
        make_fixture(args.output/name, truth, predictions)


if __name__ == '__main__':
    main()
