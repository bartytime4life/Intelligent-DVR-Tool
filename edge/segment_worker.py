"""One bounded RTSP segment, using the preview relay and installed OpenCV runtime."""
import hashlib
import json
import os
from pathlib import Path
import sys
import threading
import time

from .feed_worker import PinnedRelay, configure_capture, relay_url
from .local_feeds import LIMITS

SEGMENT_BYTES = 32 * 1024**2
FPS = 10


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, allow_nan=False)
        stream.flush(); os.fsync(stream.fileno())
    temporary.replace(path)


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
            raise ValueError('Invalid segment')
        count = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            count += 1
            if count > expected_frames or (frame.shape[1], frame.shape[0]) != size:
                raise ValueError('Invalid frame inventory')
        if count != expected_frames or count < 2:
            raise ValueError('Incomplete segment')
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
            raise ValueError('No stream')
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                raise ValueError('Interrupted stream')
            now = clock(); elapsed = now - began
            if offsets and elapsed >= seconds:
                break
            if elapsed > seconds + 5:
                raise ValueError('Capture deadline')
            height, width = frame.shape[:2]
            if not 0 < width * height <= LIMITS['input_pixels']:
                raise ValueError('Unsupported dimensions')
            decoded += 1
            if offsets and int(elapsed * FPS) <= int(offsets[-1] * FPS):
                continue
            scale = min(1, 960 / max(width, height))
            output_size = (max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2))
            if writer is None:
                size = output_size
                writer = cv2.VideoWriter(str(temporary), cv2.CAP_FFMPEG, cv2.VideoWriter_fourcc(*'VP80'), FPS, size)
                if not writer.isOpened():
                    raise ValueError('VP8 encoder unavailable')
            if size != output_size:
                raise ValueError('Camera changed dimensions')
            if offsets:
                missed += max(0, int(elapsed * FPS) - int(offsets[-1] * FPS) - 1)
            writer.write(cv2.resize(frame, size) if (width, height) != size else frame)
            offsets.append(round(elapsed, 6))
            if temporary.stat().st_size > SEGMENT_BYTES or len(offsets) > seconds * FPS + 1:
                raise ValueError('Segment bound exceeded')
            if now - last_progress >= .5:
                atomic_json(directory / 'progress.json', {'frames': len(offsets), 'decoded_frames': decoded,
                    'elapsed_seconds': round(elapsed, 3), 'missed_sample_slots': missed, **resources()})
                last_progress = now
        writer.release(); writer = None
        if not 16 <= temporary.stat().st_size <= SEGMENT_BYTES:
            raise ValueError('Segment size')
        validate_video(temporary, len(offsets), size)
        with temporary.open('rb') as stream:
            os.fsync(stream.fileno())
            sha = hashlib.file_digest(stream, 'sha256').hexdigest()
        temporary.replace(directory / 'source.webm')
        atomic_json(directory / 'complete.json', {'sha256': sha, 'bytes': (directory / 'source.webm').stat().st_size,
            'frames': len(offsets), 'decoded_frames': decoded, 'fps': FPS, 'width': size[0], 'height': size[1],
            'started_at': started, 'ended_at': started + offsets[-1], 'finalized_at': wall(), 'receive_offsets_seconds': offsets,
            'missed_sample_slots': missed, 'capture_wall_seconds': round(clock() - began, 3), **resources()})
    finally:
        cap.release()
        if writer is not None:
            writer.release()


def main(directory, seconds):
    handle = configure_capture()
    # Keep stdin open for the worker's entire lifetime. EOF kills an orphan on
    # both supported OSes, even while a native decoder is blocked.
    data = json.loads(sys.stdin.buffer.readline(8192))
    def parent_lifetime():
        sys.stdin.buffer.read(1)
        os._exit(75)
    threading.Thread(target=parent_lifetime, daemon=True).start()
    relay = PinnedRelay(data['host'], data['port'])
    try:
        record(relay_url(data, relay), Path(directory), int(seconds))
    finally:
        relay.close()
    return handle


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2])
    except BaseException:
        sys.exit(1)  # Never expose native exceptions, addresses or credentials.
