"""Explicit, short-lived previews of owner-configured LAN RTSP sources."""
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

from .evaluation import read_json

ROOT = Path(__file__).resolve().parents[1]
LIMITS = {'active_feeds': 4, 'lease_seconds': 15, 'session_seconds': 900,
          'open_seconds': 12, 'stale_seconds': 8, 'preview_fps': 4,
          'preview_width': 960, 'input_pixels': 1920 * 1080, 'frame_bytes': 512 * 1024,
          'memory_bytes': 2 * 1024**3}
PRIVATE = tuple(ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))


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
        if not isinstance(item, dict) or set(item) - {'id', 'name', 'host', 'port', 'path', 'username', 'password'}:
            raise ValueError('Unsupported source fields')
        if not re.fullmatch(r'[a-z0-9-]{1,40}', item.get('id', '')) or item['id'] in sources:
            raise ValueError('Use unique source IDs')
        if not isinstance(item.get('name'), str) or not 1 <= len(item['name']) <= 80 or any(ord(c) < 32 for c in item['name']):
            raise ValueError('Use source names of 1–80 printable characters')
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


class Feeds:
    def __init__(self, sources, *, process_factory=subprocess.Popen, clock=time.monotonic):
        self.sources, self.process_factory, self.clock = sources, process_factory, clock
        self.lock = threading.RLock()
        self.sessions = {}
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._supervise, daemon=True)
        self.thread.start()

    def available(self):
        return {'sources': [{'id': s['id'], 'name': s['name'], 'kind': 'rtsp'} for s in self.sources.values()],
                'limits': LIMITS, 'ready': sys.platform in ('linux', 'win32') and importlib.util.find_spec('cv2') is not None}

    def connect(self, body):
        if not isinstance(body, dict) or set(body) != {'source'} or not isinstance(body['source'], str) or body['source'] not in self.sources:
            raise FeedError('SOURCE', 'Select a source from this computer’s configured DVR channels.')
        with self.lock:
            if self.closed.is_set():
                raise FeedError('STOPPED', 'The local service is stopping.', 503)
            self._reap()
            if any(s['source'] == body['source'] for s in self.sessions.values() if s['state'] in ('connecting', 'live')):
                raise FeedError('IN_USE', 'This channel already has a preview. Disconnect it or wait for its preview lease to expire.', 409)
            if sum(s['state'] in ('connecting', 'live') for s in self.sessions.values()) >= LIMITS['active_feeds']:
                raise FeedError('CAPACITY', 'Four DVR previews are already open. Disconnect one first.', 409)
            # Keep only a bounded number of short-lived terminal receipts.
            for key in list(self.sessions):
                if self.sessions[key]['state'] not in ('connecting', 'live'):
                    del self.sessions[key]
            directory = tempfile.TemporaryDirectory(prefix='intelligent-dvr-feed-')
            source = self.sources[body['source']]
            identifier = secrets.token_hex(16)
            session = {'id': identifier, 'source': source['id'], 'name': source['name'], 'state': 'connecting',
                       'error': None, 'began': self.clock(), 'touched': self.clock(), 'frame_at': None,
                       'directory': directory, 'process': None, 'stamp': None}
            self.sessions[identifier] = session
            try:
                # A private pipe, not command-line arguments, disk or logs, carries credentials.
                process = self.process_factory([sys.executable, '-m', 'edge.feed_worker', directory.name],
                    cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                session['process'] = process
                process.stdin.write(json.dumps(source).encode()); process.stdin.close()
            except (OSError, ValueError):
                self._stop(session, 'failed', 'START_FAILED', 'Preview could not start. Check the local Python/OpenCV installation and retry.')
            return self._public(session)

    def _public(self, s):
        age = None if s['frame_at'] is None else round(max(0, self.clock() - s['frame_at']), 1)
        return {k: s[k] for k in ('id', 'source', 'name', 'state', 'error')} | {'frame_age_seconds': age, 'limits': LIMITS}

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

    def _stop(self, s, state, code, message):
        process = s['process']
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait()
        s['process'] = None
        s['directory'].cleanup()
        s['state'] = state
        s['error'] = {'code': code, 'message': message} if code else None
        s['frame_at'] = None

    def _reap(self):
        now = self.clock()
        for s in self.sessions.values():
            if s['state'] not in ('connecting', 'live'):
                continue
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
                error = ('CONNECTION_FAILED', 'No usable RTSP stream. Check DVR power, LAN access, RTSP port, channel path and credentials; use a substream up to 1080p. Redirects are refused.')
            elif s['frame_at'] is None and now - s['began'] > LIMITS['open_seconds']:
                error = ('OPEN_TIMEOUT', 'DVR did not provide a frame in 12 seconds. Check its RTSP settings, credentials and network, then retry.')
            elif s['frame_at'] is not None and now - s['frame_at'] > LIMITS['stale_seconds']:
                error = ('STALE', 'Frames stopped arriving. Check the DVR connection and reconnect.')
            if error:
                self._stop(s, 'failed', *error)

    def _supervise(self):
        while not self.closed.wait(.25):
            with self.lock:
                self._reap()

    def close(self):
        self.closed.set(); self.thread.join(timeout=2)
        with self.lock:
            for s in self.sessions.values():
                self._stop(s, 'disconnected', None, None)
