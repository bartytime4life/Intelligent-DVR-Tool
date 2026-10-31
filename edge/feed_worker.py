"""Bounded RTSP/TCP preview. Native decoder sees only a pinned local relay."""
import json
import os
from pathlib import Path
import re
import socket
import sys
import threading
import time
from urllib.parse import quote

from . import failures
from .failures import Failure
from .fileops import replace
from .local_feeds import LIMITS

# RLIMIT_CPU sums threads: one decoder plus relay I/O for a full preview session.
CPU_SECONDS = 2 * LIMITS['session_seconds'] + 60


def relay_messages(reader, writer, on_status=None):
    """Bound RTSP replies/RTP packets; never pass a redirect to the decoder."""
    while True:
        first = reader.read(1)
        if not first:
            return
        if first == b'$':
            header = reader.read(3)
            if len(header) != 3:
                raise Failure('STREAM_INTERRUPTED', 'Incomplete interleaved packet')
            length = int.from_bytes(header[1:], 'big')
            body = reader.read(length)
            if len(body) != length:
                raise Failure('STREAM_INTERRUPTED', 'Incomplete interleaved payload')
            writer.sendall(first + header + body)
            continue
        line = first + reader.readline(4096)
        if not re.fullmatch(rb'RTSP/1\.0 [1-5][0-9][0-9] [^\r\n]*\r\n', line):
            raise Failure('RTSP_RESPONSE_INVALID', 'Unsupported response')
        if 300 <= int(line.split()[1]) < 400:
            raise Failure('REDIRECT_REFUSED', 'Unsupported response or redirect')
        if on_status:
            on_status(int(line.split()[1]))
        headers, total, length, lengths = [line], len(line), 0, 0
        while True:
            line = reader.readline(8192)
            total += len(line)
            if not line.endswith(b'\r\n') or total > 64 * 1024:
                raise Failure('RTSP_RESPONSE_INVALID', 'Oversized RTSP headers')
            headers.append(line)
            if line == b'\r\n':
                break
            key, sep, value = line.partition(b':')
            if not sep:
                raise Failure('RTSP_RESPONSE_INVALID', 'Malformed RTSP header')
            if key.lower() == b'location':
                raise Failure('REDIRECT_REFUSED', 'Redirect refused')
            if key.lower() == b'content-length':
                lengths += 1
                length = int(value.strip())
                if lengths != 1 or not 0 <= length <= 64 * 1024:
                    raise Failure('RTSP_RESPONSE_INVALID', 'Oversized RTSP body')
        body = reader.read(length)
        if len(body) != length:
            raise Failure('RTSP_RESPONSE_INVALID', 'Incomplete RTSP body')
        writer.sendall(b''.join(headers) + body)


class PinnedRelay:
    """One local decoder and one fixed owner-configured upstream; no DNS/redirects."""
    def __init__(self, host, port):
        self.host, self.port = host, port
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(('127.0.0.1', 0)); self.listener.listen(1); self.listener.settimeout(10)
        self.local_port = self.listener.getsockname()[1]
        self.connections = []; self.failure = self.status = None
        self.thread = threading.Thread(target=self.run, daemon=True); self.thread.start()

    def run(self):
        try:
            downstream, address = self.listener.accept()
            self.connections.append(downstream); downstream.settimeout(8)
            self.listener.close()  # Exactly one decoder connection.
            try:
                upstream = socket.create_connection((self.host, self.port), timeout=5)
            except OSError:
                self.failure = 'UPSTREAM_UNREACHABLE'; raise
            self.connections.append(upstream); upstream.settimeout(8)
            def requests():
                try:
                    while True:
                        try:
                            block = downstream.recv(64 * 1024)
                        except socket.timeout:
                            # RTSP/RTCP keepalives can be much less frequent than
                            # media. Only upstream/media inactivity is stale.
                            continue
                        if not block:
                            break
                        upstream.sendall(block)
                except OSError:
                    pass
                finally:
                    self.close()
            threading.Thread(target=requests, daemon=True).start()
            with upstream.makefile('rb') as reader:
                relay_messages(reader, downstream, lambda status: setattr(self, 'status', status))
        except Failure as error:
            self.failure = self.failure or error.failure
        except (OSError, ValueError):
            pass
        finally:
            self.close()

    def cause(self, default):
        """A specific fixed code for a decoder open/read failure; never the address or path."""
        if self.failure:
            return self.failure
        if self.status in (401, 403):
            return 'RTSP_UNAUTHORIZED'
        if self.status == 404:
            return 'RTSP_NOT_FOUND'
        return {4: 'RTSP_STATUS_4XX', 5: 'RTSP_STATUS_5XX'}.get((self.status or 0) // 100, default)

    def close(self):
        self.listener.close()
        for connection in self.connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()


def capture(url, directory, *, seconds=900):
    import cv2
    cv2.setNumThreads(1)
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000,
                          cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_N_THREADS, 1])
    try:
        if not cap.isOpened():
            raise Failure('STREAM_OPEN_FAILED', 'Cannot open stream')
        began, emitted = time.monotonic(), 0
        while time.monotonic() - began < seconds:
            ok, frame = cap.read()
            if not ok or frame is None:
                raise Failure('STREAM_INTERRUPTED', 'No frame')
            height, width = frame.shape[:2]
            if not 0 < width * height <= LIMITS['input_pixels']:
                raise Failure('DIMENSIONS_UNSUPPORTED', 'Use a stream at or below 1080p')
            now = time.monotonic()
            if now - emitted < 1 / LIMITS['preview_fps']:
                continue
            emitted = now
            scale = min(1, LIMITS['preview_width'] / max(width, height))
            if scale < 1:
                frame = cv2.resize(frame, (max(1, int(width * scale)), max(1, int(height * scale))))
            ok, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if not ok or len(encoded) > LIMITS['frame_bytes']:
                raise Failure('FRAME_LIMIT', 'Frame limit')
            temporary = directory / 'frame.tmp'
            temporary.write_bytes(encoded.tobytes()); replace(temporary, directory / 'frame.jpg', best_effort=True)
    finally:
        cap.release()


def configure_capture():
    """Shared bounded native RTSP configuration for previews and segment capture."""
    from . import analysis_worker
    handle = analysis_worker.constrain(LIMITS['memory_bytes'], CPU_SECONDS)
    os.environ.update(OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', MKL_NUM_THREADS='1',
        OPENCV_IO_MAX_IMAGE_PIXELS=str(LIMITS['input_pixels']), OPENCV_IO_MAX_IMAGE_WIDTH='4096', OPENCV_IO_MAX_IMAGE_HEIGHT='4096',
        OPENCV_VIDEOIO_PRIORITY_LIST='FFMPEG',
        OPENCV_FFMPEG_CAPTURE_OPTIONS='rtsp_transport;tcp|protocol_whitelist;rtsp,tcp|allowed_media_types;video')
    return handle


def relay_url(data, relay):
    credentials = ''
    if data.get('username') or data.get('password'):
        credentials = quote(data.get('username', ''), safe='') + ':' + quote(data.get('password', ''), safe='') + '@'
    return f'rtsp://{credentials}127.0.0.1:{relay.local_port}{data["path"]}'


def relayed(relay, operation, *args):
    """Run a decoder against the relay; refine stream failures with what the relay saw."""
    try:
        return operation(*args)
    except Failure as error:
        if error.failure in ('STREAM_OPEN_FAILED', 'STREAM_INTERRUPTED'):
            error.failure = relay.cause(error.failure)
        raise
    finally:
        relay.close()


def main(directory):
    handle = configure_capture()
    # As in segment_worker, stdin stays open for the worker's lifetime: EOF ends
    # an orphaned preview on both OSes, even while a native decoder is blocked.
    data = json.loads(sys.stdin.buffer.readline(8192))
    from .analysis_worker import watch_parent_pipe
    watch_parent_pipe()
    if data.get('kind') in ('public-jpeg', 'public-mjpeg'):
        from .public_feed import capture_public
        capture_public(data, Path(directory))
        return handle
    relay = PinnedRelay(data['host'], data['port'])
    relayed(relay, capture, relay_url(data, relay), Path(directory))
    return handle


if __name__ == '__main__':
    try:
        if sys.platform == 'linux':
            from .supervision import _owned_child
            _owned_child(int(os.environ['DVR_FEED_PARENT_PID']), main, sys.argv[1])
        else:
            main(sys.argv[1])
    except BaseException as error:
        if len(sys.argv) > 1: failures.record(sys.argv[1], error, failures.FEED)  # One fixed code, never native text.
        sys.exit(1)  # Native details and credentials never reach app logs.
