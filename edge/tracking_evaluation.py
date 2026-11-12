"""Offline tracking evaluation on independently labeled, fully sampled sequences.

Reuse detection-manifest/source/rule validation and the existing trace contract.
TrackEval supplies metric calculations; no camera, media decoder or model opens.
"""
import platform
from collections import Counter
from pathlib import Path

import numpy as np

from .evaluation import (evaluate, read_json, read_json_snapshot, local_file, relative_file, digest,
                         require, text, integer, number, iou)
from .model_profiles import ASSETS
from .tracking import SCHEMA as TRACK_SCHEMA, METHOD, TrackerConfig
from ._vendor.trackeval.metrics.clear import CLEAR
from ._vendor.trackeval.metrics.identity import Identity
from ._vendor.trackeval.metrics.hota import HOTA

SCHEMA = 'intelligent-dvr.tracking-evaluation.v1'
LABEL_SCHEMA = 'intelligent-dvr.tracking-labels.v1'
MAX_IDS = 500  # combined truth/prediction IDs per clip and class; bounds dense ID matrices
MAX_PAIRS = 2_000_000  # total frame-level pair comparisons per clip


def plain(value):
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [plain(v) for v in value]
    return value.item() if isinstance(value, np.generic) else value


def validate_tracks(trace):
    """Mirror Recognition's references; require the current recorded tracker version."""
    tracking = trace.get('tracking')
    require(isinstance(tracking, dict) and tracking.get('schema') == TRACK_SCHEMA,
            'Tracking record required; re-analyze recordings that predate tracking')
    require(tracking.get('method') == METHOD
            and tracking.get('tracker_sha256') == digest(ASSETS/'tracking.py'),
            'Tracker version differs; explicitly re-analyze with this revision')
    require(tracking.get('parameters') == TrackerConfig().describe(),
            'Require the recording analyzer tracking parameters')
    summaries = tracking.get('tracks')
    require(isinstance(summaries, list) and len(summaries) <= 2000, 'Invalid track summary count')
    integer(tracking.get('tracks_dropped'), 'tracks_dropped', 0, 100000)
    by_id = {}
    for track in summaries:
        require(isinstance(track, dict), 'Invalid track summary')
        key = integer(track.get('id'), 'track ID', 1, 10**9)
        require(key not in by_id, 'Duplicate track summary ID')
        text(track.get('label'), 'track label', 80)
        first = number(track.get('first_seconds'), 'track first time')
        number(track.get('last_seconds'), 'track last time', first)
        integer(track.get('hits'), 'track hits', 1, 100000)
        by_id[key] = track
    for frame in trace['frames']:
        seen = set()
        for detection in frame['detections']:
            if 'track' not in detection:
                continue
            key = integer(detection['track'], 'detection track ID', 1, 10**9)
            summary = by_id.get(key)
            require(summary is not None and key not in seen
                    and summary['label'] == detection['label']
                    and summary['first_seconds']-1e-6 <= frame['seconds'] <= summary['last_seconds']+1e-6,
                    'Missing, duplicated or inconsistent detection track reference')
            seen.add(key)
    return tracking


def metric_data(truth_frames, prediction_frames):
    gt_keys = sorted({o['track_id'] for f in truth_frames for o in f})
    pred_keys = sorted({o['track'] for f in prediction_frames for o in f})
    require(len(gt_keys)+len(pred_keys) <= MAX_IDS,
            f'At most {MAX_IDS} combined track IDs per clip/class; split the recording')
    gt_lookup = {key: i for i, key in enumerate(gt_keys)}
    pred_lookup = {key: i for i, key in enumerate(pred_keys)}
    similarities = [np.array([[iou(g['box'], p['box']) for p in pred] for g in gt], dtype=float)
                    .reshape(len(gt), len(pred)) for gt, pred in zip(truth_frames, prediction_frames)]
    return {'num_timesteps': len(truth_frames), 'num_gt_ids': len(gt_keys),
            'num_tracker_ids': len(pred_keys),
            'num_gt_dets': sum(map(len, truth_frames)),
            'num_tracker_dets': sum(map(len, prediction_frames)),
            'gt_ids': [np.array([gt_lookup[o['track_id']] for o in f], dtype=int) for f in truth_frames],
            'tracker_ids': [np.array([pred_lookup[o['track']] for o in f], dtype=int) for f in prediction_frames],
            'similarity_scores': similarities}


def measurements(results, gt_count):
    clear, identity, hota = (plain(results[k]) for k in ('CLEAR', 'Identity', 'HOTA'))
    # Ratios with no ground truth are undefined, rather than evidence of quality.
    return {'TP': clear['CLR_TP'], 'FP': clear['CLR_FP'], 'FN': clear['CLR_FN'],
            'IDSW': clear['IDSW'], 'MOTA': clear['MOTA'] if gt_count else None,
            'IDTP': identity['IDTP'], 'IDFP': identity['IDFP'], 'IDFN': identity['IDFN'],
            'IDF1': identity['IDF1'] if gt_count else None,
            'HOTA': float(np.mean(hota['HOTA'])) if gt_count else None,
            'DetA': float(np.mean(hota['DetA'])) if gt_count else None,
            'AssA': float(np.mean(hota['AssA'])) if gt_count else None,
            'MOTP': clear['MOTP'] if clear['CLR_TP'] else None,
            'mostly_tracked': clear['MT'], 'mostly_lost': clear['ML'],
            'reference_results': {'CLEAR': clear, 'Identity': identity, 'HOTA': hota}}


def evaluate_tracking(manifest_path, score_threshold=.1, iou_threshold=.5):
    # Validation stays shared with the existing evaluator. It checks source/label
    # hashes, timestamps, frame inventory, model binding, rules and event replay.
    detection = evaluate(manifest_path, score_threshold=score_threshold, iou_threshold=iou_threshold)
    manifest_path = local_file(manifest_path)
    manifest, manifest_hash = read_json_snapshot(manifest_path, 8*1024**2)
    require(manifest_hash == detection['manifest_sha256'], 'Manifest changed during evaluation')
    declaration = manifest.get('tracking')
    require(isinstance(declaration, dict) and declaration.get('schema') == LABEL_SCHEMA
            and declaration.get('independent_labels') is True
            and declaration.get('coverage') == 'all-sampled-frames'
            and declaration.get('timebase') == 'constant-frame-rate',
            'Declare independent tracking labels, all-sampled-frames coverage and constant-frame-rate timebase')
    text(declaration.get('id_policy'), 'anonymous object ID policy')
    metrics = {'CLEAR': CLEAR({'THRESHOLD': iou_threshold, 'PRINT_CONFIG': False}),
               'Identity': Identity({'THRESHOLD': iou_threshold, 'PRINT_CONFIG': False}), 'HOTA': HOTA()}
    results = {name: {} for name in metrics}
    sequence_counts, per_clip, errors = {}, [], []
    untracked_total = 0
    for ci, clip in enumerate(manifest['clips']):
        trace_path = relative_file(manifest_path.parent, clip['trace'])
        trace, trace_hash = read_json_snapshot(trace_path)
        require(trace_hash == detection['clips'][ci]['trace_sha256'],
                'Trace changed during evaluation')
        tracking = validate_tracks(trace)
        frames, annotations = trace['frames'], clip['frames']
        require([a['frame_index'] for a in annotations] == [f['frame_index'] for f in frames],
                'Label every sampled frame in order, including explicit empty objects lists')
        # IDs describe anonymous objects across this entire clip, including exits
        # and reentries. They must never come from model output or named people.
        gt_labels = {}
        for annotation, frame in zip(annotations, frames):
            require(annotation.get('seconds') == frame['seconds'],
                    'Annotation seconds must equal sampled frame_index/FPS exactly')
            seen = set()
            for obj in annotation['objects']:
                key = text(obj.get('track_id'), 'anonymous ground-truth track ID', 80)
                require(key not in seen, 'Duplicate ground-truth ID within a frame')
                require(key not in gt_labels or gt_labels[key] == obj['label'],
                        'Ground-truth track ID changes class')
                gt_labels[key] = obj['label']
                seen.add(key)
        pair_count = 0
        for a, f in zip(annotations, frames):
            gt_counts = Counter(g['label'] for g in a['objects'])
            pred_counts = Counter(p['label'] for p in f['detections']
                                  if 'track' in p and p['score'] >= score_threshold)
            pair_count += sum(n*pred_counts[label] for label, n in gt_counts.items())
        require(pair_count <= MAX_PAIRS, 'Tracking pair comparison bound exceeded; split the recording')
        clip_metrics = {}
        for label in manifest['classes']:
            truth = [[o for o in a['objects'] if o['label'] == label] for a in annotations]
            predicted = [[{**d, 'detection_index': di} for di, d in enumerate(f['detections'])
                          if d['label'] == label and d['score'] >= score_threshold and 'track' in d] for f in frames]
            data = metric_data(truth, predicted)
            audit = {}
            data['match_callback'] = lambda t, r, c, switches: audit.update({t: list(zip(r.tolist(), c.tolist(), switches.tolist()))})
            key = f'{ci}:{label}'
            evaluated = {name: metric.eval_sequence(data) for name, metric in metrics.items()}
            for name in metrics:
                results[name][key] = evaluated[name]
            sequence_counts[key] = data['num_gt_dets']
            clip_metrics[label] = measurements(evaluated, data['num_gt_dets'])
            matched_truth, last_match = set(), {}
            for fi, (gt, pred, frame) in enumerate(zip(truth, predicted, frames)):
                matches = audit.get(fi, [])
                gt_seen, pred_seen = set(), set()
                for gi, pi, switched in matches:
                    gt_seen.add(gi); pred_seen.add(pi); matched_truth.add(gt[gi]['track_id'])
                    if switched:
                        errors.append({'camera': clip['camera'], 'frame_index': frame['frame_index'],
                                       'seconds': frame['seconds'], 'label': label, 'outcome': 'IDSW',
                                       'truth_id': gt[gi]['track_id'], 'prediction_id': pred[pi]['track'],
                                       'previous_prediction_id': last_match[gt[gi]['track_id']]})
                    last_match[gt[gi]['track_id']] = pred[pi]['track']
                for gi, obj in enumerate(gt):
                    if gi not in gt_seen:
                        errors.append({'camera': clip['camera'], 'frame_index': frame['frame_index'],
                                       'seconds': frame['seconds'], 'label': label, 'outcome': 'FN',
                                       'truth_id': obj['track_id'], 'prediction_id': None})
                for pi, obj in enumerate(pred):
                    if pi not in pred_seen:
                        errors.append({'camera': clip['camera'], 'frame_index': frame['frame_index'],
                                       'seconds': frame['seconds'], 'label': label, 'outcome': 'FP',
                                       'truth_id': None, 'prediction_id': obj['track'],
                                       'detection_index': obj['detection_index']})
            missed = sorted({o['track_id'] for f in truth for o in f}-matched_truth)
            clip_metrics[label]['never_matched_truth_tracks'] = missed
        untracked = [{'frame_index': f['frame_index'], 'seconds': f['seconds'], 'detection_index': di,
                      'label': d['label'], 'score': d['score']} for f in frames for di, d in enumerate(f['detections'])
                     if d['label'] in manifest['classes'] and d['score'] >= score_threshold and 'track' not in d]
        untracked_total += len(untracked)
        per_clip.append({'camera': clip['camera'], 'source_sha256': clip['source_sha256'],
                         'trace_sha256': trace_hash, 'tracker': {k: tracking[k] for k in
                             ('method', 'tracker_sha256', 'parameters', 'tracks_dropped')},
                         'frames_scored': len(frames), 'fps': clip['fps'], 'stride': trace['stride'],
                         'sample_interval_seconds': trace['stride']/clip['fps'],
                         'per_class': clip_metrics, 'untracked_detections': untracked})
    def combined(keys):
        values = {name: metric.combine_sequences({k: results[name][k] for k in keys})
                  for name, metric in metrics.items()}
        return measurements(values, sum(sequence_counts[k] for k in keys))
    vendor = Path(__file__).parent/'_vendor'/'trackeval'
    implementation = {p.relative_to(ASSETS).as_posix(): digest(p) for p in
                      sorted(vendor.rglob('*.py'))+[ASSETS/'tracking_evaluation.py', ASSETS/'evaluate_tracking.py',
                                                  ASSETS/'tracking.py', ASSETS/'evaluation.py']}
    return {'schema': SCHEMA, 'data_kind': manifest['data_kind'], 'approval': manifest['approval'],
            'manifest_sha256': detection['manifest_sha256'], 'labels_sha256': detection['labels_sha256'],
            'input_binding': {**detection['input_binding'],
                              'tracking_second_pass': 'captured manifest and trace hashes must match detection stage'},
            'annotation_declaration': declaration, 'frames_scored': sum(c['frames_scored'] for c in per_clip),
            'model': {k: detection[k] for k in ('inference_profile', 'model_sha256', 'model_provenance')},
            'score_threshold': score_threshold, 'iou_threshold': iou_threshold,
            'metric_implementation': {'name': 'TrackEval', **read_json(vendor/'upstream.json'),
                                      'local_sha256': implementation,
                                      'patches': ['Hungarian adapter reuses edge.tracking.assign; deterministic input-order ties.',
                                                  'np.int/np.float replaced with np.int64/np.float64 for NumPy 2.',
                                                  'CLEAR match callback records error locations without changing formulas.'],
                                      'runtime': {'python': platform.python_version(), 'numpy': np.__version__}},
            'aggregate': combined(list(sequence_counts)),
            'per_class': {label: combined([k for k in sequence_counts if k.split(':', 1)[1] == label])
                          for label in manifest['classes']},
            'clips': per_clip, 'errors': errors, 'untracked_detection_count': untracked_total,
            'human_review_required': True,
            'qualification': {'physical_camera_tracking_accuracy': 'unqualified',
                              'identity_verification': 'not-performed', 'multi_camera_capacity': 'unqualified'},
            'conventions': {'scores': 'Ratios (not percentages); MOTA may be negative; no-GT quality ratios are null.',
                            'matching': 'Same class only; reference CLEAR continuity priority and global Identity assignment.',
                            'HOTA': 'Reference HOTA, averaged over IoU alpha 0.05..0.95 in steps of 0.05; independent of CLEAR/Identity IoU option.',
                            'untracked': 'Detections without a track ID do not count as predicted tracks; corresponding labeled objects are misses unless another track matches.',
                            'aggregation': 'Count/association-weighted reference combine_sequences; camera/class IDs remain separate.',
                            'incorrect_matches': 'IDSW counts a changed matched ID even across gaps; FP counts unmatched predicted track boxes.'},
            'limitations': ['Synthetic fixtures validate the evaluator and tracker plumbing, not physical-camera accuracy.',
                            'Real results apply only to the supplied independently labeled sampled frames, classes and thresholds.',
                            'Constant frame rate is an explicit owner declaration; VFR and unsampled frames are not evaluated.',
                            'Track numbers and anonymous labels are continuity references, not verified identities or face labels.',
                            'Inputs are unsigned local evidence; independent labels, rights and completeness require human confirmation.',
                            'No camera activation, model inference, footage collection, uploads or review-decision writes.']}
