"""One bounded RTSP segment, using the preview relay and installed OpenCV runtime."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from . import failures
from .failures import Failure
from .feed_worker import PinnedRelay, configure_capture, relay_url, relayed
from .fileops import replace, sync_directory
from .local_feeds import LIMITS

SEGMENT_BYTES = 32 * 1024**2
FPS = 10


def atomic_json(path, value, best_effort=False):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, allow_nan=False)
        stream.flush(); os.fsync(stream.fileno())
    return replace(temporary, path, best_effort=best_effort)


def resources():
    rss = None
    if sys.platform == 'linux':
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    elif sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes as w
        class Memory(ctypes.Structure):
            _fields_ = [('cb', w.DWORD), ('faults', w.DWORD)] + [(k, ctypes.c_size_t) for k in
                ('peak_rss', 'rss', 'peak_paged', 'paged', 'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile')]
        kernel = ctypes.WinDLL('kernel32'); psapi = ctypes.WinDLL('psapi')
        kernel.GetCurrentProcess.restype = w.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD]
        counters = Memory(); counters.cb = ctypes.sizeof(counters)
        if psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            rss = counters.peak_rss
    return {'cpu_seconds': round(time.process_time(), 3), 'peak_rss_bytes': rss}


def validate_video(path, expected_frames, size):
    """Decode every output frame before publishing a completion marker."""
    import cv2
    # The live decoder only allows RTSP/TCP. Verification opens an already-local
    # finalized container and must explicitly use the analyzer's file-only policy.
    prior = os.environ.get('OPENCV_FFMPEG_CAPTURE_OPTIONS')
    os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'protocol_whitelist;file'
    cap = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            raise Failure('SEGMENT_VERIFY_FAILED', 'Invalid segment')
        count = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            count += 1
            if count > expected_frames or (frame.shape[1], frame.shape[0]) != size:
                raise Failure('SEGMENT_VERIFY_FAILED', 'Invalid frame inventory')
        if count != expected_frames or count < 2:
            raise Failure('SEGMENT_VERIFY_FAILED', 'Incomplete segment')
    finally:
        cap.release()
        if prior is None:
            os.environ.pop('OPENCV_FFMPEG_CAPTURE_OPTIONS', None)
        else:
            os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = prior


def record(url, directory, seconds, *, capture_factory=None, clock=time.monotonic, wall=time.time):
    """Sample video only, at most 10 fps/960px. Receive times remain separate from CFR time."""
    import cv2
    cv2.setNumThreads(1)
    cap = (capture_factory or (lambda: cv2.VideoCapture(url, cv2.CAP_FFMPEG,
        [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_N_THREADS, 1])))()
    writer = None
    temporary = directory / 'capture.webm'
    began, started, offsets, decoded, missed, last_progress = clock(), wall(), [], 0, 0, -1
    size = None
    try:
        if not cap.isOpened():
            raise Failure('STREAM_OPEN_FAILED', 'No stream')
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                raise Failure('STREAM_INTERRUPTED', 'Interrupted stream')
            now = clock(); elapsed = now - began
            if offsets and elapsed >= seconds:
                break
            if elapsed > seconds + 5:
                raise Failure('CAPTURE_DEADLINE', 'Capture deadline')
            height, width = frame.shape[:2]
            if not 0 < width * height <= LIMITS['input_pixels']:
                raise Failure('DIMENSIONS_UNSUPPORTED', 'Unsupported dimensions')
            decoded += 1
            if offsets and int(elapsed * FPS) <= int(offsets[-1] * FPS):
                continue
            scale = min(1, 960 / max(width, height))
            output_size = (max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2))
            if writer is None:
                size = output_size
                writer = cv2.VideoWriter(str(temporary), cv2.CAP_FFMPEG, cv2.VideoWriter_fourcc(*'VP80'), FPS, size)
                if not writer.isOpened():
                    raise Failure('ENCODER_UNAVAILABLE', 'VP8 encoder unavailable')
            if size != output_size:
                raise Failure('DIMENSIONS_UNSUPPORTED', 'Camera changed dimensions')
            if offsets:
                missed += max(0, int(elapsed * FPS) - int(offsets[-1] * FPS) - 1)
            writer.write(cv2.resize(frame, size) if (width, height) != size else frame)
            offsets.append(round(elapsed, 6))
            if temporary.stat().st_size > SEGMENT_BYTES or len(offsets) > seconds * FPS + 1:
                raise Failure('SEGMENT_LIMIT', 'Segment bound exceeded')
            if now - last_progress >= .5:
                atomic_json(directory / 'progress.json', {'frames': len(offsets), 'decoded_frames': decoded,
                    'elapsed_seconds': round(elapsed, 3), 'missed_sample_slots': missed, **resources()}, best_effort=True)
                last_progress = now
        writer.release(); writer = None
        if not 16 <= temporary.stat().st_size <= SEGMENT_BYTES:
            raise Failure('SEGMENT_LIMIT', 'Segment size')
        validate_video(temporary, len(offsets), size)
        with temporary.open('r+b') as stream:
            os.fsync(stream.fileno())
            sha = hashlib.file_digest(stream, 'sha256').hexdigest()
        replace(temporary, directory / 'source.webm')
        atomic_json(directory / 'complete.json', {'sha256': sha, 'bytes': (directory / 'source.webm').stat().st_size,
            'frames': len(offsets), 'decoded_frames': decoded, 'fps': FPS, 'width': size[0], 'height': size[1],
            'started_at': started, 'ended_at': started + offsets[-1], 'finalized_at': wall(), 'receive_offsets_seconds': offsets,
            'missed_sample_slots': missed, 'capture_wall_seconds': round(clock() - began, 3), **resources()})
        sync_directory(directory)  # Both renames reach disk before the parent sees exit 0.
    finally:
        cap.release()
        if writer is not None:
            writer.release()


def main(directory, seconds):
    handle = configure_capture()
    # Keep stdin open for the worker's entire lifetime. EOF kills an orphan on
    # both supported OSes, even while a native decoder is blocked.
    data = json.loads(sys.stdin.buffer.readline(8192))
    from .analysis_worker import watch_parent_pipe
    watch_parent_pipe()
    relay = PinnedRelay(data['host'], data['port'])
    relayed(relay, record, relay_url(data, relay), Path(directory), int(seconds))
    return handle


if __name__ == '__main__':
    try:
        if sys.platform == 'linux':
            # Spawned only from the recorder's long-lived supervisor thread, whose
            # exit (close/failure) already kills capture; prctl follows that thread.
            from .supervision import _owned_child
            _owned_child(int(os.environ['DVR_SEGMENT_PARENT_PID']), main, sys.argv[1], sys.argv[2])
        else:
            main(sys.argv[1], sys.argv[2])
    except BaseException as error:
        # One fixed code beside the discarded segment; never native text, addresses or credentials.
        if len(sys.argv) > 1: failures.record(sys.argv[1], error, failures.CAPTURE)
        sys.exit(1)
