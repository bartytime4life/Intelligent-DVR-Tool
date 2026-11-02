"""Bounded live-detection worker for one explicitly started camera session.

The parent (edge.live_analysis) writes one JSON configuration line, then frames as
[8-byte big-endian seconds][4-byte big-endian length][JPEG bytes]. A zero length or
end of input ends the session. Every frame gets exactly one JSON line back with
detections, short-lived track IDs, rule observations and this computer's timings.

The worker never opens a camera, file, socket or model download. The model bytes
are hash-verified before parsing, as in recording analysis. A cheap frame-difference
motion gate (downscaled, blurred grey frames) skips the detector on still, empty
scenes and re-runs it at least every KEYFRAME_SECONDS, so idle cameras cost little CPU.
"""
import json
import math
import os
import struct
import sys
import time

FRAME_BYTES = 1024 * 1024
INPUT_PIXELS = 1920 * 1080
MEMORY_BYTES = 3 * 1024**3
THREADS = 2
SESSION_SECONDS = 900
# RLIMIT_CPU sums threads: two inference threads for the whole session, plus startup.
CPU_SECONDS = THREADS * SESSION_SECONDS + 120
MOTION_WIDTH, MOTION_DELTA, MOTION_IDLE = 160, 25, .002
KEYFRAME_SECONDS = 2.0
REPORTED_DETECTIONS = 100
HEADER = struct.Struct('>dI')


class LoadFailed(Exception):
    """The configuration, model or rules could not be loaded; no frame was analyzed."""


def read_exact(stream, size):
    data = b''
    while len(data) < size:
        block = stream.read(size - len(data))
        if not block:
            return None
        data += block
    return data


class Motion:
    """Fraction of a small blurred grey frame that changed since the previous frame."""
    def __init__(self, cv2):
        self.cv2, self.previous = cv2, None

    def measure(self, frame):
        cv2 = self.cv2
        height, width = frame.shape[:2]
        small = cv2.resize(frame, (MOTION_WIDTH, max(1, round(height * MOTION_WIDTH / width))), interpolation=cv2.INTER_AREA)
        grey = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
        previous, self.previous = self.previous, grey
        if previous is None or previous.shape != grey.shape:
            return 1.0
        changed = cv2.absdiff(grey, previous) > MOTION_DELTA
        return float(changed.mean())


def validate_config(config):
    from .model_profiles import PROFILES, validate_labels
    keys = {'model', 'model_sha256', 'profile', 'labels', 'rules', 'camera', 'run_id', 'motion_gate'}
    if not isinstance(config, dict) or set(config) != keys:
        raise ValueError('Invalid live configuration')
    if config['profile'] not in PROFILES or not isinstance(config['model'], str) or not isinstance(config['motion_gate'], bool):
        raise ValueError('Invalid live configuration')
    validate_labels(config['labels'])
    if not isinstance(config['rules'], list) or not 1 <= len(config['rules']) <= 100:
        raise ValueError('Invalid live rules')
    return config


def run(stdin, stdout):
    import cv2
    import numpy as np
    from .analyze import decode
    from .cpu_backend import create_backend
    from .model_profiles import prepare, validate_binding
    from .rules import Rule, RuleEngine
    from .tracking import Tracker, zones_from_rules
    started = time.perf_counter()
    try:
        config = validate_config(json.loads(stdin.readline(256 * 1024)))
        cv2.setNumThreads(THREADS)
        validate_binding(config['profile'], config['model_sha256'], config['labels'])
        rules = [Rule(**r) for r in config['rules']]
        if any(r.label not in config['labels'] for r in rules):
            raise ValueError('Every rule label must occur in the model labels')
        engine = RuleEngine(rules, config['camera'], config['run_id'])
        tracker = Tracker(zones=zones_from_rules(rules))
        motion = Motion(cv2)
        backend = create_backend('opencv-cpu', config['model'], config['profile'], cv2, np, THREADS,
                                 model_sha256=config['model_sha256'])
        # One warm-up pass so the first camera frame is not charged for graph setup.
        backend.forward(prepare(np.zeros((360, 640, 3), dtype=np.uint8), config['profile'], cv2, np)[0])
    except Exception as error:
        raise LoadFailed() from error

    def send(value):
        stdout.write(json.dumps(value, allow_nan=False).encode() + b'\n')
        stdout.flush()

    send({'type': 'ready', 'load_ms': round((time.perf_counter() - started) * 1000, 1),
          'runtime': {'opencv': cv2.__version__, **backend.runtime}})
    last_detector, previous = None, None
    try:
        while True:
            header = read_exact(stdin, HEADER.size)
            if header is None:
                return
            seconds, length = HEADER.unpack(header)
            if length == 0:
                return
            if length > FRAME_BYTES or not math.isfinite(seconds) or seconds < 0 or (previous is not None and seconds <= previous):
                send({'type': 'error', 'code': 'PROTOCOL'})
                return
            data = read_exact(stdin, length)
            if data is None:
                return
            previous = seconds
            began = time.perf_counter()
            frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR) if data[:2] == b'\xff\xd8' else None
            if frame is None or frame.ndim != 3:
                send({'type': 'error', 'code': 'FRAME_INVALID'})
                continue
            height, width = frame.shape[:2]
            if width * height > INPUT_PIXELS or min(width, height) < 16:
                send({'type': 'error', 'code': 'FRAME_SIZE'})
                continue
            decoded = time.perf_counter()
            moved = motion.measure(frame)
            following = any(t['state'] == 'tracked' for t in tracker.active())
            idle = (config['motion_gate'] and moved < MOTION_IDLE and not following and last_detector is not None
                    and seconds - last_detector < KEYFRAME_SECONDS)
            result = {'type': 'result', 'seconds': round(seconds, 6), 'width': int(width), 'height': int(height),
                      'motion': round(moved, 5), 'detector': 'skipped-still' if idle else 'ran'}
            detections, observations, inference_ms = [], [], None
            if not idle:
                blob, scale, padding = prepare(frame, config['profile'], cv2, np)
                inference_began = time.perf_counter()
                raw = backend.forward(blob)
                detections = decode(raw, config['labels'], frame.shape, scale, padding, cv2, np, config['profile'])
                inference_ms = (time.perf_counter() - inference_began) * 1000
                observations = engine.update(seconds, detections)
                for detection, track in zip(detections, tracker.update(seconds, detections, int(width), int(height))):
                    if track is not None:
                        detection['track'] = track
                last_detector = seconds
            detections.sort(key=lambda d: -d['score'])
            result.update(
                detections=[{'label': d['label'], 'score': round(d['score'], 4), 'box': [round(v, 5) for v in d['box']],
                             **({'track': d['track']} if 'track' in d else {})} for d in detections[:REPORTED_DETECTIONS]],
                detections_total=len(detections), tracks=tracker.active(), observations=observations,
                timing={'scope': 'This computer, this frame: JPEG decode, motion check, inference and tracking. Excludes browser capture and transfer.',
                        'decode_ms': round((decoded - began) * 1000, 2),
                        'inference_ms': None if inference_ms is None else round(inference_ms, 2),
                        'total_ms': round((time.perf_counter() - began) * 1000, 2)})
            send(result)
    finally:
        backend.close()


def main():
    from .analysis_worker import constrain
    handle = constrain(MEMORY_BYTES, CPU_SECONDS)
    os.environ.update(OMP_NUM_THREADS=str(THREADS), OPENBLAS_NUM_THREADS=str(THREADS), MKL_NUM_THREADS=str(THREADS),
                      OPENCV_IO_MAX_IMAGE_PIXELS=str(INPUT_PIXELS))
    try:
        run(sys.stdin.buffer, sys.stdout.buffer)
    except BaseException as error:
        # One fixed line; native text, paths and frames never reach the parent or logs.
        try:
            sys.stdout.buffer.write(json.dumps({'type': 'error', 'fatal': True,
                'code': 'MODEL_LOAD_FAILED' if isinstance(error, LoadFailed) else 'WORKER_FAILED'}).encode() + b'\n')
            sys.stdout.buffer.flush()
        except OSError:
            pass
        raise
    return handle


if __name__ == '__main__':
    try:
        if sys.platform == 'linux':
            from .supervision import _owned_child
            _owned_child(int(os.environ['DVR_LIVE_PARENT_PID']), main)
        else:
            main()
    except BaseException:
        sys.exit(1)
