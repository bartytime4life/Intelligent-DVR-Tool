"""Explicit, short-lived previews of owner-configured LAN and public webcam sources."""
from concurrent.futures import ThreadPoolExecutor
import contextlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time

from .diagnostics import Diagnostics
from .evaluation import read_json
from .failures import FEED, exit_cause, read as read_failure
from .public_feed import KINDS, public_source

ROOT = Path(__file__).resolve().parents[1]
LIMITS = {'active_feeds': 4, 'lease_seconds': 15, 'session_seconds': 900,
          'open_seconds': 12, 'stale_seconds': 8, 'preview_fps': 4,
          'preview_width': 960, 'input_pixels': 1920 * 1080, 'frame_bytes': 512 * 1024,
          'memory_bytes': 2 * 1024**3}
PRIVATE = tuple(ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
# Specific guidance for a worker's fixed failure code; the error code stays CONNECTION_FAILED.
CAUSES = {
    'UPSTREAM_UNREACHABLE': 'The DVR did not accept a connection. Check its power, LAN cable/Wi-Fi, address and RTSP port.',
    'RTSP_UNAUTHORIZED': 'The DVR refused the configured viewer account. Check the username and password in the local source list.',
    'RTSP_NOT_FOUND': 'The DVR has no stream at the configured channel path. Check the exact substream path.',
    'REDIRECT_REFUSED': 'The source answered with a redirect, which is refused. Configure the final direct address.',
    'DIMENSIONS_UNSUPPORTED': 'The stream exceeds 1080p. Select a lower-resolution substream.',
    'DNS_FAILED': 'The public webcam host name could not be resolved. Check the configured host and network.',
    'ADDRESS_REFUSED': 'The public webcam resolved to a private, local or non-IPv4 address, which is refused.',
    'TLS_VERIFY_FAILED': 'The public webcam certificate could not be verified. Its HTTPS identity is not trusted.',
    'HTTP_STATUS_4XX': 'The provider refused the image request (HTTP 4xx). Check the direct image path and provider permission.',
    'HTTP_STATUS_5XX': 'The provider reported a server error (HTTP 5xx). Try again later.',
    'CONTENT_TYPE_REFUSED': 'The provider did not return a direct JPEG/MJPEG image. Websites, players and playlists are refused.',
    'IMAGE_LIMIT': 'The provider image exceeds the 2 MiB or 1080p preview bound.',
}


class FeedError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def load_sources(config):
    """Only the local owner supplies endpoints; never accept browser URLs."""
    data = read_json(config, 64 * 1024)
    if not isinstance(data, dict) or set(data) != {'sources'} or not isinstance(data['sources'], list) or len(data['sources']) > 100:
        raise ValueError('Configure up to 100 sources in a sources array')
    sources = {}
    for item in data['sources']:
        if not isinstance(item, dict):
            raise ValueError('Unsupported source fields')
        if not re.fullmatch(r'[a-z0-9-]{1,40}', item.get('id', '')) or item['id'] in sources:
            raise ValueError('Use unique source IDs')
        if not isinstance(item.get('name'), str) or not 1 <= len(item['name']) <= 80 or any(ord(c) < 32 for c in item['name']):
            raise ValueError('Use source names of 1–80 printable characters')
        if item.get('kind') in KINDS:
            sources[item['id']] = public_source(item)
            continue
        if set(item) - {'id', 'name', 'host', 'port', 'path', 'username', 'password'}:
            raise ValueError('Unsupported source fields')
        try:
            host = ipaddress.IPv4Address(item.get('host', ''))
        except ipaddress.AddressValueError:
            raise ValueError('Use an exact private IPv4 address for each trusted DVR') from None
        if not any(host in net for net in PRIVATE):
            raise ValueError('DVR addresses must be on a private LAN, not loopback, public or link-local')
        port = item.get('port', 554)
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('Use a DVR port from 1 to 65535')
        path = item.get('path', '')
        if not isinstance(path, str) or not re.fullmatch(r'/[A-Za-z0-9_~.!$&\x27()*+,;=:@%/?-]{0,511}', path) or path.startswith('//') or '#' in path:
            raise ValueError('Use an RTSP channel path starting with / (no URL or fragment)')
        for key in ('username', 'password'):
            value = item.get(key, '')
            if not isinstance(value, str) or len(value) > 128 or any(ord(c) < 32 for c in value):
                raise ValueError('Credentials must be printable strings up to 128 characters')
        sources[item['id']] = {**item, 'host': str(host), 'port': port}
    return sources


def shared_config(path):
    """POSIX group/other read access to the plaintext source list, which holds credentials."""
    try:
        return os.name == 'posix' and bool(Path(path).stat().st_mode & 0o044)
    except OSError:
        return False


class Feeds:
    def __init__(self, sources, *, process_factory=subprocess.Popen, clock=time.monotonic, diagnostics=None):
        self.sources, self.process_factory, self.clock = sources, process_factory, clock
        self.log = (diagnostics or Diagnostics()).event
        self.lock = threading.RLock()
        self.sessions = {}
        self.closed = threading.Event()
        # Linux parent-death signals follow the spawning *thread*. Spawn from one
        # long-lived thread, never a short-lived HTTP request thread.
        self.spawner = ThreadPoolExecutor(1, thread_name_prefix='dvr-feed-spawn')
        self.thread = threading.Thread(target=self._supervise, daemon=True)
        self.thread.start()

    def available(self):
        return {'sources': [self._source_info(s) for s in self.sources.values()],
                'limits': LIMITS, 'ready': sys.platform in ('linux', 'win32') and importlib.util.find_spec('cv2') is not None}

    @staticmethod
    def _source_info(source):
        return {k: source[k] for k in ('id', 'name', 'kind', 'provider', 'provider_url', 'refresh_seconds') if k in source} | {'kind': source.get('kind', 'rtsp')}

    def connect(self, body):
        if not isinstance(body, dict) or set(body) != {'source'} or not isinstance(body['source'], str) or body['source'] not in self.sources:
            raise FeedError('SOURCE', 'Select a source from this computer’s approved source list.')
        with self.lock:
            if self.closed.is_set():
                raise FeedError('STOPPED', 'The local service is stopping.', 503)
            self._reap()
            if any(s['source'] == body['source'] for s in self.sessions.values() if s['state'] in ('connecting', 'live')):
                raise FeedError('IN_USE', 'This channel already has a preview. Disconnect it or wait for its preview lease to expire.', 409)
            if sum(s['state'] in ('connecting', 'live') for s in self.sessions.values()) >= LIMITS['active_feeds']:
                raise FeedError('CAPACITY', 'Four network previews are already open. Disconnect one first.', 409)
            # Keep only a bounded number of short-lived terminal receipts.
            for key in list(self.sessions):
                if self.sessions[key]['state'] not in ('connecting', 'live'):
                    del self.sessions[key]
            directory = tempfile.TemporaryDirectory(prefix='intelligent-dvr-feed-', ignore_cleanup_errors=True)
            source = self.sources[body['source']]
            identifier = secrets.token_hex(16)
            session = {'id': identifier, 'source': source['id'], 'name': source['name'], 'state': 'connecting',
                       **{k: v for k, v in self._source_info(source).items() if k not in ('id', 'name')},
                       'error': None, 'cause': None, 'began': self.clock(), 'touched': self.clock(), 'frame_at': None,
                       'directory': directory, 'process': None, 'stamp': None}
            self.sessions[identifier] = session
            try:
                # A private pipe, not command-line arguments, disk or logs, carries
                # credentials. It stays open as the worker's parent-lifetime lease.
                process = self.spawner.submit(self.process_factory, [sys.executable, '-m', 'edge.feed_worker', directory.name],
                    cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    env={**os.environ, 'DVR_FEED_PARENT_PID': str(os.getpid())}).result()
                session['process'] = process
                process.stdin.write(json.dumps(source).encode() + b'\n'); process.stdin.flush()
            except (OSError, ValueError):
                self._stop(session, 'failed', 'START_FAILED', 'Preview could not start. Check the local Python/OpenCV installation and retry.')
            return self._public(session)

    def _public(self, s):
        age = None if s['frame_at'] is None else round(max(0, self.clock() - s['frame_at']), 1)
        return {k: s[k] for k in ('id', 'source', 'name', 'state', 'error', 'cause', 'kind', 'provider', 'provider_url', 'refresh_seconds') if k in s} | {'frame_age_seconds': age, 'limits': LIMITS}

    def _find(self, identifier):
        if identifier not in self.sessions:
            raise FeedError('FEED_GONE', 'This preview has expired. Connect the channel again.', 404)
        return self.sessions[identifier]

    def status(self, identifier):
        with self.lock:
            self._reap()
            s = self._find(identifier); s['touched'] = self.clock()
            return self._public(s)

    def frame(self, identifier):
        with self.lock:
            self._reap()
            s = self._find(identifier)
            if s['state'] != 'live':
                raise FeedError('NO_FRAME', 'No current frame is available. Check the preview status.', 409)
            path = Path(s['directory'].name) / 'frame.jpg'
            try:
                with path.open('rb') as file:
                    data = file.read(LIMITS['frame_bytes'] + 1)
            except OSError:
                raise FeedError('NO_FRAME', 'Frame unavailable. Retry the preview.', 409) from None
            if not 4 <= len(data) <= LIMITS['frame_bytes'] or not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
                self._stop(s, 'failed', 'FRAME_INVALID', 'The channel produced an unsupported frame. Select a lower-resolution substream.')
                raise FeedError('FRAME_INVALID', 'Unsupported camera frame.', 409)
            s['touched'] = self.clock()
            return data

    def disconnect(self, identifier):
        with self.lock:
            s = self._find(identifier)
            self._stop(s, 'disconnected', None, None)
            return self._public(s)

    def _stop(self, s, state, code, message, cause=None):
        process = s['process']
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait()
            if process.stdin and not process.stdin.closed:
                with contextlib.suppress(OSError):
                    process.stdin.close()
            s['process'] = None
        # Terminal before cleanup: a Windows sharing violation can only leave a
        # temporary folder behind, never a "live" session without a worker.
        s['state'] = state
        s['error'] = {'code': code, 'message': message} if code else None
        s['cause'] = cause; s['frame_at'] = None
        if code: self.log('FEED_FAILED', session=s['id'], code=code, cause=cause)
        s['directory'].cleanup()

    def _reap(self):
        now = self.clock()
        for s in self.sessions.values():
            if s['state'] not in ('connecting', 'live'):
                continue
            try:
                self._reap_one(s, now)
            except Exception:
                # One session's OS failure must not stop supervising the others.
                with contextlib.suppress(Exception):
                    s['process'].kill()
                if s['state'] in ('connecting', 'live'):
                    s.update(state='failed', frame_at=None, error={'code': 'PREVIEW_FAILED',
                        'message': 'The local preview worker could not be supervised. Reconnect explicitly; restart the app if this repeats.'})
                s['directory'].cleanup()

    def _reap_one(self, s, now):
        try:
            stamp = (Path(s['directory'].name) / 'frame.jpg').stat().st_mtime_ns
            if stamp != s['stamp']:
                s['stamp'], s['frame_at'], s['state'] = stamp, now, 'live'
        except OSError:
            pass
        error = None
        if now - s['touched'] > LIMITS['lease_seconds']:
            error = ('LEASE_EXPIRED', 'Preview stopped because this page stopped checking it. Connect again when ready.')
        elif now - s['began'] > LIMITS['session_seconds']:
            error = ('SESSION_LIMIT', 'The 15-minute preview ended. Explicitly connect again to continue.')
        elif s['process'] is None or s['process'].poll() is not None:
            # The worker's coded failure file, or a classified signal exit, refines the message.
            cause = None if s['process'] is None else (read_failure(Path(s['directory'].name), FEED) or exit_cause(s['process'].poll()))
            lead, advice = (('Public webcam unavailable.', 'Check provider availability, permission, direct JPEG/MJPEG path, public IPv4 DNS and valid HTTPS certificate. Redirects, login pages and oversized images are refused. Reconnect explicitly.')
                            if s.get('kind') in KINDS else ('No usable RTSP stream.', 'Check DVR power, LAN access, RTSP port, channel path and credentials; use a substream up to 1080p. Redirects are refused.'))
            error = ('CONNECTION_FAILED', lead + ' ' + CAUSES.get(cause, advice), cause)
        elif s['frame_at'] is None and now - s['began'] > LIMITS['open_seconds']:
            error = ('OPEN_TIMEOUT', 'Source did not provide an image in 12 seconds. Check the source settings and network, then retry.')
        elif s['frame_at'] is not None and now - s['frame_at'] > (s.get('refresh_seconds', 0) + LIMITS['open_seconds'] if s.get('kind') == 'public-jpeg' else LIMITS['stale_seconds']):
            error = ('STALE', 'Images stopped arriving. Check the source and reconnect. The previous image has been removed.')
        if error:
            self._stop(s, 'failed', *error)

    def _supervise(self):
        while not self.closed.wait(.25):
            # Per-session failures are recorded on that session; this loop never exits early.
            with self.lock, contextlib.suppress(Exception):
                self._reap()

    def close(self):
        self.closed.set(); self.thread.join(timeout=2)
        with self.lock:
            for s in self.sessions.values():
                with contextlib.suppress(Exception):
                    self._stop(s, 'disconnected', None, None)
        self.spawner.shutdown()
