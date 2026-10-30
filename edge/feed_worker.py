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

from .local_feeds import LIMITS


def relay_messages(reader, writer):
    """Bound RTSP replies/RTP packets; never pass a redirect to the decoder."""
    while True:
        first = reader.read(1)
        if not first:
            return
        if first == b'$':
            header = reader.read(3)
            if len(header) != 3:
                raise ValueError('Incomplete interleaved packet')
            length = int.from_bytes(header[1:], 'big')
            body = reader.read(length)
            if len(body) != length:
                raise ValueError('Incomplete interleaved payload')
            writer.sendall(first + header + body)
            continue
        line = first + reader.readline(4096)
        if not re.fullmatch(rb'RTSP/1\.0 [1-5][0-9][0-9] [^\r\n]*\r\n', line) or 300 <= int(line.split()[1]) < 400:
            raise ValueError('Unsupported response or redirect')
        headers, total, length, lengths = [line], len(line), 0, 0
        while True:
            line = reader.readline(8192)
            total += len(line)
            if not line.endswith(b'\r\n') or total > 64 * 1024:
                raise ValueError('Oversized RTSP headers')
            headers.append(line)
            if line == b'\r\n':
                break
            key, sep, value = line.partition(b':')
            if not sep:
                raise ValueError('Malformed RTSP header')
            if key.lower() == b'location':
                raise ValueError('Redirect refused')
            if key.lower() == b'content-length':
                lengths += 1
                length = int(value.strip())
                if lengths != 1 or not 0 <= length <= 64 * 1024:
                    raise ValueError('Oversized RTSP body')
        body = reader.read(length)
        if len(body) != length:
            raise ValueError('Incomplete RTSP body')
        writer.sendall(b''.join(headers) + body)


class PinnedRelay:
    """One local decoder and one fixed owner-configured upstream; no DNS/redirects."""
    def __init__(self, host, port):
        self.host, self.port = host, port
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(('127.0.0.1', 0)); self.listener.listen(1); self.listener.settimeout(10)
        self.local_port = self.listener.getsockname()[1]
        self.connections = []
        self.thread = threading.Thread(target=self.run, daemon=True); self.thread.start()

    def run(self):
        try:
            downstream, address = self.listener.accept()
            self.connections.append(downstream); downstream.settimeout(8)
            self.listener.close()  # Exactly one decoder connection.
            upstream = socket.create_connection((self.host, self.port), timeout=5)
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
                relay_messages(reader, downstream)
        except (OSError, ValueError):
            pass
        finally:
            self.close()

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
            raise ValueError('Cannot open stream')
        began, emitted = time.monotonic(), 0
        while time.monotonic() - began < seconds:
            ok, frame = cap.read()
            if not ok or frame is None:
                raise ValueError('No frame')
            height, width = frame.shape[:2]
            if not 0 < width * height <= LIMITS['input_pixels']:
                raise ValueError('Use a stream at or below 1080p')
            now = time.monotonic()
            if now - emitted < 1 / LIMITS['preview_fps']:
                continue
            emitted = now
            scale = min(1, LIMITS['preview_width'] / max(width, height))
            if scale < 1:
                frame = cv2.resize(frame, (max(1, int(width * scale)), max(1, int(height * scale))))
            ok, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if not ok or len(encoded) > LIMITS['frame_bytes']:
                raise ValueError('Frame limit')
            temporary = directory / 'frame.tmp'
            temporary.write_bytes(encoded.tobytes()); temporary.replace(directory / 'frame.jpg')
    finally:
        cap.release()


def configure_capture():
    """Shared bounded native RTSP configuration for previews and segment capture."""
    from . import analysis_worker
    analysis_worker.MEMORY_BYTES = LIMITS['memory_bytes']
    handle = analysis_worker.constrain()
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


def main(directory):
    handle = configure_capture()
    data = json.loads(sys.stdin.buffer.read(8192))
    if data.get('kind') in ('public-jpeg', 'public-mjpeg'):
        from .public_feed import capture_public
        capture_public(data, Path(directory))
        return handle
    relay = PinnedRelay(data['host'], data['port'])
    try:
        capture(relay_url(data, relay), Path(directory))
    finally:
        relay.close()
    return handle


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except BaseException:
        sys.exit(1)  # Native details and credentials never reach app logs.
