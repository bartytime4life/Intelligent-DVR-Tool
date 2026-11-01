"""Explicit live detection on camera frames the browser is already showing.

An operator presses Start AI on one Monitor tile. This service then starts one
bounded worker (edge.live_worker) with a catalog model and rule set, and answers
each posted frame with detections, short-lived track IDs and rule observations.
Only one frame per session is in flight: a frame that arrives while the previous
one is still being analyzed is refused, so there is no backlog and latency stays
visible. Sessions end when the page stops sending frames (lease), after 15
minutes, on Stop, or when the service stops. Nothing is recorded or uploaded.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import secrets
import subprocess
import sys
import threading
import time

from .diagnostics import Diagnostics
from .live_worker import FRAME_BYTES, HEADER, INPUT_PIXELS, KEYFRAME_SECONDS, SESSION_SECONDS, THREADS
from .rules import Rule, RuleEngine

ROOT = Path(__file__).resolve().parents[1]
LIMITS = {'active_sessions': 2, 'lease_seconds': 15, 'session_seconds': SESSION_SECONDS, 'start_seconds': 30,
          'frame_seconds': 6, 'frame_bytes': FRAME_BYTES, 'input_pixels': INPUT_PIXELS, 'max_fps': 5,
          'threads': THREADS, 'keyframe_seconds': KEYFRAME_SECONDS, 'observations_kept': 50}
ACTIVE = ('starting', 'live')
MESSAGES = {
    'MODEL_LOAD_FAILED': 'The local AI model could not be loaded. Run Check, confirm the model file still matches its SHA-256, then start AI again.',
    'WORKER_FAILED': 'Local AI stopped unexpectedly. Start AI again; if this repeats, run Check and review the diagnostic log.',
    'WORKER_EXITED': 'Local AI stopped (worker exited, possibly at a CPU or memory limit). Start AI again when ready.',
    'WORKER_TIMEOUT': 'Local AI took too long to answer, so it was stopped to protect this computer. Start AI again or close other heavy apps.',
    'START_TIMEOUT': 'Local AI did not finish loading in 30 seconds. Close other heavy apps and start AI again.',
    'PROTOCOL': 'Local AI refused an invalid frame stream. Start AI again.',
    'LEASE_EXPIRED': 'AI stopped because this page stopped sending frames. Start AI again when ready.',
    'SESSION_LIMIT': 'The 15-minute AI session ended. Start AI again explicitly to continue.',
    'START_FAILED': 'Local AI could not start. Check the local Python/OpenCV installation and retry.',
}
FRAME_ERRORS = {'FRAME_INVALID': 'The browser sent an unreadable frame; it was skipped.',
                'FRAME_SIZE': 'The frame exceeds 1080p or is too small; it was skipped.'}
CAMERA = re.compile(r'[^\x00-\x1f\x7f]{1,80}')


class LiveError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def _read(path, expected, limit=64 * 1024):
    """Read a catalog file once and bind it to the SHA-256 recorded at service start."""
    data = Path(path).read_bytes()
    if len(data) > limit or hashlib.sha256(data).hexdigest() != expected:
        raise LiveError('CONFIG_CHANGED', 'Configured labels or rules changed. Restart the local app to review the new choices.', 409)
    return json.loads(data)


class Live:
    def __init__(self, catalog, *, process_factory=subprocess.Popen, clock=time.monotonic, diagnostics=None,
                 lease_seconds=None, start_seconds=None, frame_seconds=None):
        self.catalog, self.process_factory, self.clock = catalog, process_factory, clock
        self.log = (diagnostics or Diagnostics()).event
        self.lease = lease_seconds or LIMITS['lease_seconds']
        self.start_limit = start_seconds or LIMITS['start_seconds']
        self.frame_limit = frame_seconds or LIMITS['frame_seconds']
        self.lock = threading.RLock()
        self.sessions = {}
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._supervise, daemon=True)
        self.thread.start()

    def available(self):
        models = [{k: m[k] for k in ('id', 'name', 'profile')} for m in self.catalog['models'].values()]
        rules = [{'id': r['id'], 'name': r['name'], 'summary': r['summary'],
                  'models': [m['id'] for m in self.catalog['models'].values() if set(r['classes']) <= set(m['classes'])]}
                 for r in self.catalog['rules'].values()]
        with self.lock:
            active = sum(s['state'] in ACTIVE for s in self.sessions.values())
        return {'enabled': True, 'models': models, 'rules': rules, 'limits': LIMITS, 'active': active,
                'backend': 'opencv-cpu'}

    def start(self, body):
        if (not isinstance(body, dict) or set(body) != {'model', 'rules', 'camera'}
                or not all(isinstance(body[k], str) for k in body) or not CAMERA.fullmatch(body['camera'])):
            raise LiveError('SELECTION', 'Choose a listed model and rule set for a named camera.')
        model, rules = self.catalog['models'].get(body['model']), self.catalog['rules'].get(body['rules'])
        if model is None or rules is None or not set(rules['classes']) <= set(model['classes']):
            raise LiveError('SELECTION', 'That model and rule set are unavailable or incompatible. Refresh the choices.')
        labels = _read(model['labels'], model['labels_sha256'])
        rule_list = _read(rules['path'], rules['sha256'])
        RuleEngine([Rule(**r) for r in rule_list])
        with self.lock:
            if self.closed.is_set():
                raise LiveError('STOPPED', 'The local service is stopping.', 503)
            for key in [k for k, s in self.sessions.items() if s['state'] not in ACTIVE]:
                del self.sessions[key]
            if sum(s['state'] in ACTIVE for s in self.sessions.values()) >= LIMITS['active_sessions']:
                raise LiveError('CAPACITY', 'Two cameras already have live AI. Stop one first; each uses two CPU threads.', 409)
            identifier = secrets.token_hex(16)
            session = {'id': identifier, 'camera': body['camera'], 'model': model['name'], 'model_id': model['id'],
                       'model_sha256': model['sha256'], 'rules': rules['name'], 'rules_id': rules['id'],
                       'state': 'starting', 'error': None, 'began': self.clock(), 'touched': self.clock(),
                       'frames': 0, 'analyzed': 0, 'skipped_still': 0, 'refused_busy': 0, 'frame_errors': 0,
                       'observations': [], 'observations_total': 0, 'runtime': None, 'load_ms': None,
                       'process': None, 'lines': queue.Queue(maxsize=4), 'busy': False, 'previous': 0.0,
                       'tracks_seen': set()}
            self.sessions[identifier] = session
        config = {'model': str(model['path']), 'model_sha256': model['sha256'], 'profile': model['profile'],
                  'labels': labels, 'rules': rule_list, 'camera': body['camera'], 'run_id': secrets.token_hex(16),
                  'motion_gate': True}
        try:
            process = self.process_factory([sys.executable, '-m', 'edge.live_worker'], cwd=ROOT,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env={**os.environ, 'DVR_LIVE_PARENT_PID': str(os.getpid())})
            session['process'] = process
            threading.Thread(target=self._reader, args=(session,), daemon=True).start()
            process.stdin.write(json.dumps(config).encode() + b'\n'); process.stdin.flush()
        except (OSError, ValueError):
            with self.lock:
                self._stop(session, 'failed', 'START_FAILED')
                return self._public(session)
        line = self._next(session, self.start_limit)
        with self.lock:
            if session['state'] != 'starting':
                return self._public(session)
            if line is None:
                self._stop(session, 'failed', 'START_TIMEOUT')
            elif line.get('type') != 'ready':
                self._stop(session, 'failed', line.get('code') if line.get('code') in MESSAGES else 'WORKER_FAILED')
            else:
                session.update(state='live', runtime=line.get('runtime'), load_ms=line.get('load_ms'), touched=self.clock())
                self.log('LIVE_START', session=identifier)
            return self._public(session)

    def _reader(self, session):
        """Bounded line reader: at most one JSON result is ever outstanding per session."""
        process = session['process']
        try:
            for raw in iter(lambda: process.stdout.readline(4 * 1024 * 1024), b''):
                try:
                    value = json.loads(raw)
                except ValueError:
                    value = {'type': 'error', 'code': 'WORKER_FAILED', 'fatal': True}
                with contextlib.suppress(queue.Full):
                    session['lines'].put_nowait(value if isinstance(value, dict) else {'type': 'error', 'code': 'WORKER_FAILED', 'fatal': True})
        except (OSError, ValueError):
            pass
        with contextlib.suppress(queue.Full):
            session['lines'].put_nowait(None)  # End of output.

    def _next(self, session, timeout):
        try:
            return session['lines'].get(timeout=timeout)
        except queue.Empty:
            return None

    def _find(self, identifier):
        if identifier not in self.sessions:
            raise LiveError('LIVE_GONE', 'This AI session has ended. Start AI again.', 404)
        return self.sessions[identifier]

    def frame(self, identifier, data):
        with self.lock:
            s = self._find(identifier)
            if s['state'] != 'live':
                raise LiveError('NOT_LIVE', (s['error'] or {}).get('message') or 'This AI session is not running.', 409)
            if s['busy']:
                s['refused_busy'] += 1
                raise LiveError('BUSY', 'The previous frame is still being analyzed; this frame was skipped.', 429)
            if not 4 <= len(data) <= FRAME_BYTES or data[:2] != b'\xff\xd8':
                raise LiveError('FRAME', 'Send one JPEG frame up to 1 MiB.')
            s['busy'], s['touched'] = True, self.clock()
            seconds = max(s['previous'] + 1e-3, self.clock() - s['began'])
            s['previous'], s['frames'] = seconds, s['frames'] + 1
            # Discard anything stale so this frame's reply is the next line.
            while not s['lines'].empty():
                with contextlib.suppress(queue.Empty):
                    if s['lines'].get_nowait() is None:
                        s['lines'].put_nowait(None); break
            process = s['process']
        try:
            process.stdin.write(HEADER.pack(seconds, len(data)) + data); process.stdin.flush()
            line = self._next(s, self.frame_limit)
        except (OSError, ValueError):
            line = {'type': 'error', 'code': 'WORKER_EXITED', 'fatal': True}
        with self.lock:
            s['busy'] = False
            if s['state'] != 'live':
                raise LiveError('NOT_LIVE', (s['error'] or {}).get('message') or 'This AI session has stopped.', 409)
            if line is None:
                self._stop(s, 'failed', 'WORKER_TIMEOUT' if process.poll() is None else 'WORKER_EXITED')
                raise LiveError(s['error']['code'], s['error']['message'], 409)
            if line.get('type') == 'error':
                if line.get('code') in FRAME_ERRORS and not line.get('fatal'):
                    s['frame_errors'] += 1
                    raise LiveError(line['code'], FRAME_ERRORS[line['code']], 422)
                self._stop(s, 'failed', line.get('code') if line.get('code') in MESSAGES else 'WORKER_FAILED')
                raise LiveError(s['error']['code'], s['error']['message'], 409)
            s['touched'] = self.clock()
            if line.get('detector') == 'skipped-still':
                s['skipped_still'] += 1
            else:
                s['analyzed'] += 1
            for t in line.get('tracks', []):
                s['tracks_seen'].add((t.get('label'), t.get('id')))
            for o in line.get('observations', []):
                s['observations_total'] += 1
                s['observations'] = ([o] + s['observations'])[:LIMITS['observations_kept']]
            return {**line, 'session': self._public(s)}

    def status(self, identifier):
        with self.lock:
            s = self._find(identifier)
            s['touched'] = self.clock()
            return self._public(s)

    def stop(self, identifier):
        with self.lock:
            s = self._find(identifier)
            if s['state'] in ACTIVE:
                self._stop(s, 'stopped', None)
            return self._public(s)

    def _public(self, s):
        tracks = {}
        for label, _ in s['tracks_seen']:
            tracks[label] = tracks.get(label, 0) + 1
        return {'id': s['id'], 'camera': s['camera'], 'state': s['state'], 'error': s['error'],
                'model': s['model'], 'model_id': s['model_id'], 'model_sha256': s['model_sha256'],
                'rules': s['rules'], 'rules_id': s['rules_id'], 'runtime': s['runtime'], 'load_ms': s['load_ms'],
                'elapsed_seconds': round(max(0, self.clock() - s['began']), 1),
                'frames': s['frames'], 'analyzed': s['analyzed'], 'skipped_still': s['skipped_still'],
                'refused_busy': s['refused_busy'], 'frame_errors': s['frame_errors'],
                'observations_total': s['observations_total'], 'tracks_by_label': dict(sorted(tracks.items())),
                'limits': LIMITS}

    def _stop(self, s, state, code):
        process = s['process']
        if process is not None:
            with contextlib.suppress(OSError, ValueError):
                process.stdin.write(HEADER.pack(0.0, 0)); process.stdin.flush()
            with contextlib.suppress(OSError, ValueError):
                process.stdin.close()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
            s['process'] = None
        s['state'] = state
        s['error'] = {'code': code, 'message': MESSAGES.get(code, 'Local AI stopped.')} if code else None
        s['busy'] = False
        self.log('LIVE_STOP', session=s['id'], code=code)

    def _supervise(self):
        while not self.closed.wait(.5):
            with self.lock, contextlib.suppress(Exception):
                now = self.clock()
                for s in self.sessions.values():
                    if s['state'] not in ACTIVE or s['busy']:
                        continue
                    if s['state'] == 'live' and now - s['touched'] > self.lease:
                        self._stop(s, 'failed', 'LEASE_EXPIRED')
                    elif now - s['began'] > LIMITS['session_seconds']:
                        self._stop(s, 'failed', 'SESSION_LIMIT')
                    elif s['state'] == 'live' and s['process'] is not None and s['process'].poll() is not None:
                        self._stop(s, 'failed', 'WORKER_EXITED')

    def close(self):
        self.closed.set(); self.thread.join(timeout=2)
        with self.lock:
            for s in self.sessions.values():
                if s['state'] in ACTIVE:
                    with contextlib.suppress(Exception):
                        self._stop(s, 'stopped', None)
