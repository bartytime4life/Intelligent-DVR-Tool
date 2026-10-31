"""Offline, fixed-threshold evaluation. No media, model loading or network I/O."""
import hashlib
import json
import math
from pathlib import Path
import statistics

from .model_profiles import ASSETS, YOLOX_PROFILE, validate_binding
from .rules import Rule, RuleEngine, finite
from .scheduler import MINIMUM_CAMERA_TARGET

SCHEMA = 'intelligent-dvr.evaluation.v1'
TRACE_SCHEMA = 'intelligent-dvr.detection-trace.v1'
MANIFEST_SCHEMA = 'intelligent-dvr.evaluation-manifest.v1'
REVIEW_SCHEMA = 'intelligent-dvr.alert-reviews.v1'
MAX_FRAMES = 10000
MAX_DETECTIONS = 100000


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, name, limit=2000):
    require(isinstance(value, str) and 0 < len(value.strip()) <= limit,
            f'{name} must be nonempty text (up to {limit} characters)')
    return value


def number(value, name, low=0, high=1e12):
    require(finite(value) and low <= value <= high, f'Invalid {name}')
    return value


def integer(value, name, low, high):
    require(type(value) is int and low <= value <= high, f'Invalid {name}')
    return value


def sha(value):
    require(isinstance(value, str) and len(value) == 64
            and all(c in '0123456789abcdef' for c in value), 'Invalid SHA-256')
    return value


def anchor(path):
    """Absolute path with its parent resolved once. OS links above a configured
    entry (e.g. Silverblue's /home -> /var/home) are accepted; callers refuse a
    link at the entry itself and beneath it, so nothing escapes a managed tree."""
    path = Path(path).absolute()
    require(path.name not in ('', '..'), 'Name a specific local folder or file')
    return path.parent.resolve() / path.name


def local_file(path, root=None):
    """A regular file with no symlink at or beneath root (default: its own folder).
    root is resolved once, so links above it are accepted; the returned path uses it."""
    path = Path(path).absolute()
    base = path.parent if root is None else Path(root).absolute()
    require(path.is_relative_to(base), 'Inputs must stay inside their configured folder')
    parts = path.relative_to(base).parts
    require(parts and '..' not in parts, 'Inputs must stay inside their configured folder')
    path = base.resolve()
    for part in parts:
        path = path / part
        require(not path.is_symlink(), 'Require local regular files, without symlinks')
    require(path.is_file(), 'Require local regular files, without symlinks')
    return path


def read_json(path, limit=32 * 1024**2):
    path = local_file(path)
    require(0 < path.stat().st_size <= limit, 'JSON file exceeds size bound or is empty')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    def bad_constant(value):
        raise ValueError(f'Nonfinite JSON constant: {value}')
    def finite_float(value):
        result = float(value)
        require(math.isfinite(result), 'Nonfinite JSON number')
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique,
                      parse_constant=bad_constant, parse_float=finite_float)


def relative_file(base, value):
    name = text(value, 'relative input path', 500)
    path = Path(name)
    require(not path.is_absolute() and '..' not in path.parts and ':' not in name,
            'Inputs must be relative paths inside the manifest directory')
    return local_file(Path(base) / path, base)


def box(value):
    require(isinstance(value, list) and len(value) == 4
            and all(finite(x) for x in value), 'Invalid normalized box')
    x, y, w, h = value
    require(min(x, y) >= 0 and min(w, h) > 0 and x+w <= 1.000001
            and y+h <= 1.000001, 'Box must be inside image')
    return value


def iou(a, b):
    x = max(0, min(a[0]+a[2], b[0]+b[2])-max(a[0], b[0]))
    y = max(0, min(a[1]+a[3], b[1]+b[3])-max(a[1], b[1]))
    intersection = x*y
    return intersection / (a[2]*a[3]+b[2]*b[3]-intersection)


def match_frame(predictions, truth, classes, score_threshold, iou_threshold):
    """Score-descending greedy, one-to-one same-class IoU; stable input-order ties."""
    rows = []
    for label in classes:
        remaining = {i for i, obj in enumerate(truth) if obj['label'] == label}
        indices = [i for i, obj in enumerate(predictions)
                   if obj['label'] == label and obj['score'] >= score_threshold]
        indices.sort(key=lambda i: (-predictions[i]['score'], i))
        for index in indices:
            best = max(sorted(remaining), key=lambda j: iou(predictions[index]['box'], truth[j]['box']),
                       default=None)
            overlap = iou(predictions[index]['box'], truth[best]['box']) if best is not None else 0
            matched = best is not None and overlap >= iou_threshold
            if matched:
                remaining.remove(best)
            rows.append({'label': label, 'outcome': 'TP' if matched else 'FP',
                         'prediction_index': index, 'truth_index': best if matched else None,
                         'iou': overlap, 'score': predictions[index]['score']})
        rows.extend({'label': label, 'outcome': 'FN', 'prediction_index': None,
                     'truth_index': j, 'iou': None, 'score': None} for j in sorted(remaining))
    return rows


def quality(counts):
    tp, fp, fn = (counts[k] for k in ('TP', 'FP', 'FN'))
    return {**counts, 'precision': tp/(tp+fp) if tp+fp else None,
            'recall': tp/(tp+fn) if tp+fn else None}


def timing_distribution(values):
    if not values:
        return {'count': 0, 'min_ms': None, 'mean_ms': None, 'p50_ms': None,
                'p90_ms': None, 'p95_ms': None, 'p99_ms': None, 'max_ms': None}
    ordered = sorted(values)
    return {'count': len(values), 'min_ms': ordered[0], 'mean_ms': statistics.mean(ordered),
            **{f'p{p}_ms': ordered[math.ceil(p/100*len(ordered))-1] for p in (50, 90, 95, 99)},
            'max_ms': ordered[-1]}


def validate_trace(trace, labels, labels_hash, clip):
    require(isinstance(trace, dict) and trace.get('schema') == TRACE_SCHEMA,
            'Require a frame-level detection trace, not a receipt or qualification report')
    require(trace.get('state') == 'completed', 'Partial traces cannot establish evaluation coverage')
    require(trace.get('origin') in ('offline-analyzer', 'precomputed-synthetic'), 'Unknown trace origin')
    require(trace.get('camera') == clip['camera'] and trace.get('source_sha256') == clip['source_sha256'],
            'Trace camera/source does not match manifest')
    require(trace.get('labels_sha256') == labels_hash, 'Trace labels hash mismatch')
    validate_binding(trace.get('inference_profile'), sha(trace.get('model_sha256')), labels)
    frame_count = integer(clip['frame_count'], 'frame_count', 1, 100000)
    fps = number(clip['fps'], 'fps', .001, 1000)
    integer(trace.get('frames_read'), 'frames_read', 1, 100000)
    number(trace.get('fps_metadata'), 'fps_metadata', .001, 1000)
    require(trace.get('frames_read') == frame_count and trace.get('fps_metadata') == fps,
            'Trace frame count/FPS differs from independently declared source coverage')
    stride = integer(trace.get('stride'), 'stride', 1, 120)
    frames = trace.get('frames')
    require(isinstance(frames, list) and 1 <= len(frames) <= MAX_FRAMES, 'Invalid trace frame bound')
    require([f.get('frame_index') for f in frames] == list(range(0, frame_count, stride)),
            'Missing, duplicate or out-of-order sampled frames')
    rules = trace.get('rules')
    require(isinstance(rules, list) and 1 <= len(rules) <= 100, 'Require explicit trace rules')
    require(canonical_hash(rules) == trace.get('rules_sha256'), 'Trace rule configuration hash mismatch')
    require(trace.get('rule_engine_sha256') == digest(ASSETS / 'rules.py'),
            'Trace rule engine differs from this evaluator; qualify the version explicitly')
    require(trace.get('run_id') == hashlib.sha256(
        (trace['source_sha256']+trace['model_sha256']).encode()).hexdigest(), 'Trace run identity mismatch')
    engine = RuleEngine([Rule(**r) for r in rules], clip['camera'], trace['run_id'])
    require(all(r.label in labels and stride/fps <= r.max_gap for r in engine.rules),
            'Invalid rule label or sampling gap')
    total = 0
    replayed = []
    for frame in frames:
        integer(frame['frame_index'], 'frame_index', 0, frame_count-1)
        require(frame.get('seconds') == frame['frame_index']/fps, 'Frame time must equal index/FPS')
        detections = frame.get('detections')
        require(isinstance(detections, list) and len(detections) <= 1000, 'Invalid detection count')
        total += len(detections)
        require(total <= MAX_DETECTIONS, 'Trace detection bound exceeded')
        for d in detections:
            require(d.get('label') in labels, 'Unknown prediction label')
            box(d.get('box'))
            number(d.get('score'), 'detection score', .1, 1)
        number(frame.get('inference_decode_ms'), 'inference_decode_ms', 0, 3600000)
        replayed.extend(engine.update(frame['seconds'], detections))
    require(trace.get('events') == replayed, 'Trace events differ from deterministic rule replay')
    from .enhancement import validate_trace as validate_enhancement
    validate_enhancement(trace, labels, current_code=True)
    if 'media_coverage' in trace:
        from .media_coverage import validate as validate_coverage
        validate_coverage(trace['media_coverage'], trace['source_sha256'], frame_count, trace['state'])
    return frames, replayed


def evaluate(manifest_path, reviews_path=None, score_threshold=.5, iou_threshold=.5, warmup_frames=0):
    number(score_threshold, 'score threshold (decoder floor 0.1)', .1, 1)
    number(iou_threshold, 'IoU threshold', .01, 1)
    integer(warmup_frames, 'warmup_frames', 0, MAX_FRAMES)
    manifest_path = local_file(manifest_path)
    base = manifest_path.parent
    manifest = read_json(manifest_path, 8 * 1024**2)
    require(manifest.get('schema') == MANIFEST_SCHEMA, 'Unknown manifest schema')
    kind = manifest.get('data_kind')
    require(kind in ('synthetic', 'approved-local-recordings'), 'Explicit data_kind required')
    approval = manifest['approval']
    for key in ('approved_by', 'source_rights', 'annotation_policy', 'annotated_by', 'split'):
        text(approval.get(key), key)
    labels_path = relative_file(base, manifest['labels'])
    labels = read_json(labels_path, 64 * 1024)
    labels_hash = digest(labels_path)
    classes = manifest['classes']
    require(isinstance(classes, list) and classes and len(set(classes)) == len(classes)
            and all(x in labels for x in classes), 'Use unique evaluated classes from model labels')
    clips = manifest['clips']
    require(isinstance(clips, list) and 1 <= len(clips) <= 100, 'Use 1–100 clips')
    # One source per camera prevents double-counting overlapping camera time without absolute clocks.
    require(len({text(c['camera'], 'camera', 80) for c in clips}) == len(clips),
            'Use one clip per camera in a manifest to avoid overlapping camera-hours')
    require(len({sha(c['source_sha256']) for c in clips}) == len(clips), 'Duplicate source recording')
    review_hash = None
    decisions = {}
    if reviews_path is not None:
        reviews = read_json(reviews_path, 8 * 1024**2)
        require(reviews.get('schema') == REVIEW_SCHEMA and reviews.get('manifest_sha256') == digest(manifest_path),
                'Reviews must bind this exact manifest hash')
        require(isinstance(reviews.get('decisions'), list) and len(reviews['decisions']) <= 100000,
                'Invalid review count')
        review_hash = digest(reviews_path)
        for decision in reviews['decisions']:
            key = (sha(decision['trace_sha256']), text(decision['event_id'], 'event_id', 120))
            require(key not in decisions, 'Duplicate alert review')
            require(decision.get('verdict') in ('confirmed', 'false_alert'), 'Unknown review verdict')
            for field in ('reviewer', 'rationale', 'reviewed_at'):
                text(decision.get(field), field)
            decisions[key] = decision
    counts = {label: {'TP': 0, 'FP': 0, 'FN': 0} for label in classes}
    evidence, clip_results, used_decisions, identity = [], [], set(), None
    all_timings = []
    enhancement_identity = None
    enhancement_counts = {label: {'TP': 0, 'FP': 0, 'FN': 0} for label in classes}
    enhancement_evidence, original_processing, enhanced_processing, enhancement_times = [], [], [], []
    comparison_clips = 0
    frames_annotated = 0
    for clip in clips:
        source = relative_file(base, clip['source'])
        require(digest(source) == clip['source_sha256'], 'Local source SHA-256 mismatch')
        trace_path = relative_file(base, clip['trace'])
        trace_hash = digest(trace_path)
        trace = read_json(trace_path)
        require(kind == 'synthetic' or trace.get('origin') == 'offline-analyzer',
                'Precomputed synthetic traces cannot evaluate representative recordings')
        frames, events = validate_trace(trace, labels, labels_hash, clip)
        enhancement = trace.get('enhancement_comparison')
        if enhancement:
            require(enhancement_identity is None or enhancement_identity == enhancement,
                    'Do not pool different enhancement implementations')
            enhancement_identity = enhancement
            comparison_clips += 1
            original_processing.extend(f['comparison']['original_processing_ms'] for f in frames[warmup_frames:])
            enhanced_processing.extend(f['comparison']['enhanced_processing_ms'] for f in frames[warmup_frames:])
            enhancement_times.extend(f['comparison']['enhancement_ms'] for f in frames[warmup_frames:])
        model_identity = (trace['inference_profile'], trace['model_sha256'])
        require(identity is None or identity == model_identity, 'Do not pool different models/profiles')
        identity = model_identity
        lookup = {f['frame_index']: f for f in frames}
        annotations = clip['frames']
        require(isinstance(annotations, list) and len(annotations) <= MAX_FRAMES,
                'Invalid annotation frame bound')
        seen = set()
        for annotation in annotations:
            index = integer(annotation['frame_index'], 'annotation index', 0, clip['frame_count']-1)
            require(index not in seen and index in lookup, 'Duplicate or unanalyzed annotation frame')
            seen.add(index)
            objects = annotation['objects']
            require(isinstance(objects, list) and len(objects) <= 1000, 'Invalid truth object count')
            for obj in objects:
                require(obj.get('label') in classes, 'Truth label outside declared evaluated classes')
                box(obj.get('box'))
            frame = lookup[index]
            for row in match_frame(frame['detections'], objects, classes, score_threshold, iou_threshold):
                counts[row['label']][row['outcome']] += 1
                evidence.append({**row, 'camera': clip['camera'], 'source_sha256': clip['source_sha256'],
                                 'trace_sha256': trace_hash, 'frame_index': index, 'seconds': frame['seconds']})
            if enhancement:
                for row in match_frame(frame['comparison']['detections'], objects, classes, score_threshold, iou_threshold):
                    enhancement_counts[row['label']][row['outcome']] += 1
                    enhancement_evidence.append({**row, 'camera': clip['camera'], 'source_sha256': clip['source_sha256'],
                        'trace_sha256': trace_hash, 'frame_index': index, 'seconds': frame['seconds'],
                        'enhanced_pixels_sha256': frame['comparison']['enhanced_pixels_sha256']})
        frames_annotated += len(seen)
        intervals = clip.get('alert_review_intervals', [])
        require(isinstance(intervals, list) and len(intervals) <= 1000, 'Invalid review intervals')
        previous = 0
        seconds = 0
        for interval in intervals:
            require(isinstance(interval, list) and len(interval) == 2, 'Use [start,end) intervals')
            start, end = interval
            number(start, 'coverage start', 0, clip['frame_count']/clip['fps'])
            number(end, 'coverage end', 0, clip['frame_count']/clip['fps'])
            require(previous <= start < end, 'Review intervals must be sorted and nonoverlapping')
            previous = end
            seconds += end-start
        alert_rows = []
        for event in events:
            # Use unrounded frame time for half-open interval membership.
            frame = next(f for f in frames if abs(f['seconds']-event['seconds']) < .000001)
            covered = any(a <= frame['seconds'] < b for a, b in intervals)
            key = (trace_hash, event['id'])
            decision = decisions.get(key)
            if decision:
                used_decisions.add(key)
            alert_rows.append({**event, 'source_sha256': clip['source_sha256'], 'trace_sha256': trace_hash,
                               'frame_index': frame['frame_index'], 'in_review_coverage': covered,
                               'review': decision, 'review_required': True})
        covered_rows = [r for r in alert_rows if r['in_review_coverage']]
        pending = sum(r['review'] is None for r in covered_rows)
        false = sum(r['review'] is not None and r['review']['verdict'] == 'false_alert' for r in covered_rows)
        hours = seconds/3600
        available = hours > 0 and pending == 0
        times = [f['inference_decode_ms'] for f in frames[warmup_frames:]]
        all_timings.extend(times)
        clip_results.append({'camera': clip['camera'], 'source_sha256': clip['source_sha256'],
                             'trace_sha256': trace_hash, 'source_hash_verified': True,
                             'frames_analyzed': len(frames), 'frames_annotated': len(seen),
                             'rules_sha256': trace['rules_sha256'], 'rules': trace['rules'],
                             'rules_file_sha256': trace.get('rules_file_sha256'),
                             'runtime': trace.get('runtime'), 'timing': timing_distribution(times),
                             'media_coverage': trace.get('media_coverage'),
                             'alert_review_intervals': intervals, 'reviewed_camera_hours': hours,
                             'covered_alerts': len(covered_rows), 'pending_alert_reviews': pending,
                             'reviewed_false_alerts': false,
                             'false_alerts_per_camera_hour': false/hours if available else None,
                             'false_alert_rate_status': 'available' if available else
                             ('no_reviewed_coverage' if not hours else 'incomplete_alert_reviews'),
                             'alerts': alert_rows})
    require(set(decisions) == used_decisions, 'Review references an unknown trace/event')
    require(comparison_clips in (0, len(clips)), 'Every clip must include the paired comparison before pooling')
    hours = sum(c['reviewed_camera_hours'] for c in clip_results)
    rate_available = hours > 0 and all(c['pending_alert_reviews'] == 0 for c in clip_results)
    false = sum(c['reviewed_false_alerts'] for c in clip_results)
    provenance = None
    if identity[0] == YOLOX_PROFILE:
        provenance = read_json(ASSETS / 'candidates' / (YOLOX_PROFILE + '.json'))
    result = {'schema': SCHEMA, 'state': 'evaluated', 'data_kind': kind,
            'capacity_target_cameras': MINIMUM_CAMERA_TARGET,
            'manifest_sha256': digest(manifest_path), 'reviews_sha256': review_hash,
            'evaluator_sha256': digest(Path(__file__)), 'approval_declarations': approval,
            'rule_engine_sha256': digest(ASSETS / 'rules.py'),
            'model_profiles_sha256': digest(ASSETS / 'model_profiles.py'),
            'inference_profile': identity[0], 'model_sha256': identity[1],
            'labels_sha256': labels_hash, 'model_provenance': provenance,
            'method': {'score_threshold': score_threshold, 'iou_threshold': iou_threshold,
                       'matching': 'score-descending greedy, same-class one-to-one IoU; input-order ties',
                       'boxes': 'normalized [left,top,width,height]; exhaustive evaluated-class labels on annotated frames',
                       'timing': 'per-frame inference and decode only; nearest-rank quantiles; pooled samples',
                       'warmup_frames_excluded_per_clip_from_timing_only': warmup_frames,
                       'alerts': 'existing class/zone/dwell rules; false only by explicit human adjudication'},
            'frames_annotated': frames_annotated,
            'per_class': {label: quality(counts[label]) for label in classes},
            'micro': quality({k: sum(c[k] for c in counts.values()) for k in ('TP', 'FP', 'FN')}),
            'timing': timing_distribution(all_timings), 'clips': clip_results,
            'reviewed_camera_hours': hours, 'reviewed_false_alerts': false,
            'false_alerts_per_camera_hour': false/hours if rate_available else None,
            'detection_evidence': evidence, 'human_review_required': True,
            'qualification': {'representative_scene_accuracy': 'unqualified',
                              'target_hardware_performance': 'unqualified',
                              'concurrent_camera_capacity': 'unqualified',
                              'five_camera_capacity': 'unqualified', 'camera_compatibility': 'unqualified'},
            'limitations': ['Synthetic metrics validate arithmetic and plumbing, not recognition.',
                            'Real metrics describe only supplied annotations, thresholds, sampling and review coverage.',
                            'No AP/mAP, tracking, event recall, unsampled-frame accuracy or reliable recognition claim.',
                            'Source FPS/frame count and exhaustive labels/coverage are human declarations; verify CFR and media integrity.',
                            'Traces and human reviews are unsigned local evidence, not an authenticated audit trail.',
                            'Timings exclude capture, preprocessing, rendering and review; sequential clips do not measure camera concurrency.',
                            'No cameras, continuous monitoring, footage transmission or paid services are used.']}
    if enhancement_identity:
        result['enhancement_comparison'] = {
            'declaration': enhancement_identity,
            'per_class': {label: quality(enhancement_counts[label]) for label in classes},
            'micro': quality({k: sum(c[k] for c in enhancement_counts.values()) for k in ('TP', 'FP', 'FN')}),
            'original_processing': timing_distribution(original_processing),
            'enhanced_processing': timing_distribution(enhanced_processing),
            'enhancement_only': timing_distribution(enhancement_times),
            'detection_evidence': enhancement_evidence,
            'timing_scope': 'Sampled-frame transform, preprocessing, inference and decode; excludes media reads, pixel hashing, reporting and human review. Original is always run first; this is not a randomized benchmark.',
            'rule_observations': 'original-only', 'qualification': 'unqualified'}
    return result
