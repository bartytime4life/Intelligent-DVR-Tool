"""Validate explicit resource policies. Does not alter host settings or start workers."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from .evaluation import local_file
from .scheduler import CameraScheduler

POLICY_SCHEMA = 'intelligent-dvr.resource-policy.v1'


def fields(value, expected, label):
    if type(value) is not dict or set(value) != set(expected):
        raise ValueError(f'{label}: use declared fields only')


def numeric(value, lo, hi, label, integer=False):
    if (type(value) not in (int, float) or not math.isfinite(value) or not lo <= value <= hi
            or (integer and int(value) != value)):
        raise ValueError(f'{label}: use a finite {"integer" if integer else "number"} in {lo}–{hi}')


def validate_policy(value):
    fields(value, ('schema', 'platform', 'browser', 'analysis'), 'Resource policy')
    if value['schema'] != POLICY_SCHEMA or value['platform'] not in ('linux', 'windows'):
        raise ValueError('Unsupported policy version or platform')
    b, a = value['browser'], value['analysis']
    fields(b, ('visible_tiles', 'pause_when_hidden', 'overlay_scale'), 'Browser')
    if (type(b['visible_tiles']) is not int or b['visible_tiles'] not in (1, 2, 4) or type(b['pause_when_hidden']) is not bool
            or type(b['overlay_scale']) is not int or b['overlay_scale'] not in (1, 2)):
        raise ValueError('Invalid browser preview settings')
    limits = {'opencv_threads': (1, 8), 'worker_slots': (1, 256), 'thread_budget': (1, 256),
              'max_sample_bytes': (1, 32 * 1024**2), 'max_buffer_bytes': (1, 4 * 1024**3),
              'max_age_seconds': (.1, 3600), 'max_frames': (1, 100000)}
    fields(a, limits, 'Analysis')
    for name, (lo, hi) in limits.items():
        numeric(a[name], lo, hi, name, integer=name != 'max_age_seconds')
    if a['worker_slots'] * a['opencv_threads'] > a['thread_budget']:
        raise ValueError('Worker slots × threads exceeds the thread budget')
    if a['max_buffer_bytes'] < a['max_sample_bytes']:
        raise ValueError('Retained buffer must fit at least one sample')
    # JSON integer-valued floats are normalized for CameraScheduler's strict int contract.
    return {'schema': POLICY_SCHEMA, 'platform': value['platform'], 'browser': dict(b),
            'analysis': {k: float(v) if k == 'max_age_seconds' else int(v) for k, v in a.items()}}


def load_policy(path):
    path = local_file(Path(path))
    with path.open('rb') as stream:
        raw = stream.read(65537)
    if not 0 < len(raw) <= 65536:
        raise ValueError('Resource policy must be 1–65536 bytes')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate policy key')
            result[key] = value
        return result
    def bad_constant(value):
        raise ValueError('Nonfinite policy number')
    result = validate_policy(json.loads(raw.decode('utf-8'), object_pairs_hook=unique, parse_constant=bad_constant))
    return result, hashlib.sha256(raw).hexdigest()


def analyzer_limits(policy=None, threads=None, max_frames=None):
    caps = validate_policy(policy)['analysis'] if policy is not None else {'opencv_threads': 1, 'max_frames': 6000}
    effective = {'threads': caps['opencv_threads'] if threads is None else threads,
                 'max_frames': caps['max_frames'] if max_frames is None else max_frames}
    numeric(effective['threads'], 1, 8, 'threads', integer=True)
    numeric(effective['max_frames'], 1, 100000, 'max-frames', integer=True)
    if policy is not None and (effective['threads'] > caps['opencv_threads'] or effective['max_frames'] > caps['max_frames']):
        raise ValueError('Explicit analyzer values exceed the resource policy; use lower values or revise the policy')
    return {k: int(v) for k, v in effective.items()}


def scheduler_from_policy(camera_ids, policy):
    a = validate_policy(policy)['analysis']
    return CameraScheduler(camera_ids, workers=a['worker_slots'], max_sample_bytes=a['max_sample_bytes'],
                           max_buffer_bytes=a['max_buffer_bytes'], max_age_seconds=a['max_age_seconds'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        policy, sha = load_policy(args.policy)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps({'state': 'validated-only', 'sha256': sha, 'policy': policy,
                      'analyzer_limits': analyzer_limits(policy),
                      'limits': 'No workers, camera ingest, OS CPU/RAM quota or GPU power control started.'}, indent=2))


if __name__ == '__main__':
    main()
