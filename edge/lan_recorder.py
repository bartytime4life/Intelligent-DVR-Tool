"""Explicit one-camera capture, bounded local retention, and the existing Jobs queue."""
import itertools
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys
import threading
import time

from .evaluation import digest, read_json
from .local_feeds import FeedError, ROOT
from .result_store import REVIEW_BYTES, VIDEO_BYTES
from .segment_worker import SEGMENT_BYTES, atomic_json

DEFAULTS = {'segment_seconds': 10, 'max_segments': 20, 'max_storage_mib': 1024,
            'retention_minutes': 60, 'reserve_mib': 512}
BOUNDS = {'segment_seconds': (5, 60), 'max_segments': (2, 100), 'max_storage_mib': (256, 8192),
          'retention_minutes': (1, 10080), 'reserve_mib': (256, 16384)}
ENTRY_FILES = {'capture.webm', 'source.webm', 'complete.json', 'complete.tmp',
               'progress.json', 'progress.tmp', 'review.json', 'review.tmp'}
STATES = {'recording', 'queued', 'analyzing', 'completed', 'failed', 'interrupted'}
WORK_FILES = {'source.webm', 'model.onnx', 'labels.json', 'rules.json', 'args.json',
              'receipt.json', 'review.json', 'progress.json', 'progress.tmp'}
# Account for output + result, encoder buffering, and bounded metadata per row.
RESERVATION = SEGMENT_BYTES + REVIEW_BYTES + 4 * 1024**2


def validate_config(path, sources):
    config = read_json(path, 4096)
    if not isinstance(config, dict) or set(config) - (set(DEFAULTS) | {'source'}):
        raise ValueError('Unsupported recorder configuration')
    source = config.get('source')
    if not isinstance(source, str) or source not in sources or sources[source].get('kind', 'rtsp') != 'rtsp':
        raise ValueError('Choose exactly one configured LAN RTSP source; public sources cannot be recorded')
    config = {**DEFAULTS, **config}
    for key, (low, high) in BOUNDS.items():
        if type(config[key]) is not int or not low <= config[key] <= high:
            raise ValueError('Invalid recorder bound: ' + key)
    return config


def safe(path, directory=False):
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
        raise ValueError('Recorder storage must contain ordinary files and directories')
    if sys.platform == 'linux' and (info.st_uid != os.getuid() or (directory and info.st_mode & 0o077)):
        raise ValueError('Recorder directory must be private to its owner')


class Store:
    """Dedicated directory and OS-released owner lock; never remove unrecognized files."""
    def __init__(self, directory):
        self.path = Path(directory).absolute(); self.fd = None
        if any(p.is_symlink() for p in (self.path, *self.path.parents)):
            raise ValueError('Recorder path cannot contain symlinks')
        self.path.mkdir(mode=0o700, exist_ok=True)
        safe(self.path, True)
        try:
            lock = self.path / 'owner.lock'
            self.fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            safe(lock)
            if sys.platform == 'linux':
                import fcntl
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            elif sys.platform == 'win32':
                import msvcrt
                if os.fstat(self.fd).st_size == 0:
                    os.write(self.fd, b'0')
                os.lseek(self.fd, 0, os.SEEK_SET)
                msvcrt.locking(self.fd, msvcrt.LK_NBLCK, 1)
            else:
                raise ValueError('Recorder supports Linux and Windows')
            self.inspect()
            state = self.path / 'state.json'
            self.data = read_json(state, 512 * 1024) if state.exists() else {
                'schema': 'intelligent-dvr.lan-recorder.v1', 'rows': [],
                'counters': {'recorded': 0, 'analyzed': 0, 'dropped': 0, 'expired': 0, 'reconnects': 0, 'interrupted': 0}}
            self.validate()
        except BaseException:
            self.close()
            raise

    def inspect(self):
        entries = list(itertools.islice(self.path.iterdir(), 105))
        if len(entries) > 104:
            raise ValueError('Recorder storage has too many entries')
        for path in entries:
            if path.name in ('state.json', 'state.tmp', 'owner.lock'):
                safe(path)
                if path.stat().st_size > 512 * 1024:
                    raise ValueError('Recorder metadata exceeds its bound')
            elif path.name == 'work':
                safe(path, True)
                jobs = list(itertools.islice(path.iterdir(), 2))
                if len(jobs) > 1: raise ValueError('Too many recorder analysis workers')
                for job in jobs:
                    safe(job, True)
                    if not re.fullmatch('intelligent-dvr-job-[a-z0-9_]{8}', job.name):
                        raise ValueError('Unexpected recorder working directory')
                    files = list(itertools.islice(job.iterdir(), 10))
                    if len(files) > len(WORK_FILES): raise ValueError('Unexpected analysis work files')
                    for file in files:
                        if file.name not in WORK_FILES: raise ValueError('Unexpected analysis work file')
                        try:
                            safe(file)
                            limit = VIDEO_BYTES if file.name == 'model.onnx' else REVIEW_BYTES
                            if file.stat().st_size > limit: raise ValueError('Oversized analysis work file')
                        except FileNotFoundError: pass
            elif re.fullmatch('[a-f0-9]{32}', path.name):
                safe(path, True)
                files = list(itertools.islice(path.iterdir(), 10))
                if len(files) > len(ENTRY_FILES):
                    raise ValueError('Unexpected recorder contents')
                for file in files:
                    if file.name not in ENTRY_FILES:
                        raise ValueError('Unexpected recorder artifact')
                    try:
                        safe(file)
                        if file.stat().st_size > max(SEGMENT_BYTES, REVIEW_BYTES) + 2 * 1024**2:
                            raise ValueError('Oversized recorder artifact')
                    except FileNotFoundError:
                        pass  # Worker atomically replaces progress/complete artifacts.
            else:
                raise ValueError('Use a dedicated empty recorder directory')

    def validate(self):
        d = self.data
        if not isinstance(d, dict) or d.get('schema') != 'intelligent-dvr.lan-recorder.v1' or not isinstance(d.get('rows'), list) or len(d['rows']) > 100:
            raise ValueError('Invalid recorder state')
        if set(d.get('counters', {})) != {'recorded', 'analyzed', 'dropped', 'expired', 'reconnects', 'interrupted'}:
            raise ValueError('Invalid recorder counters')
        if any(type(n) is not int or n < 0 for n in d['counters'].values()):
            raise ValueError('Invalid recorder counter')
        ids = set()
        for row in d['rows']:
            if not isinstance(row, dict) or not re.fullmatch('[a-f0-9]{32}', row.get('id', '')) or row['id'] in ids or row.get('state') not in STATES:
                raise ValueError('Invalid recorder row')
            ids.add(row['id'])
            if type(row.get('created_at')) not in (int, float) or not math.isfinite(row['created_at']):
                raise ValueError('Invalid recording time')
            if not re.fullmatch('[a-z0-9-]{1,40}', row.get('source', '')):
                raise ValueError('Invalid recording source')

    def save(self):
        self.validate()
        atomic_json(self.path / 'state.json', self.data)
        if sys.platform == 'linux':
            fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(fd)
            finally: os.close(fd)

    def usage(self):
        self.inspect()
        total = 0
        for path in self.path.rglob('*'):
            try:
                info = path.stat()
                if stat.S_ISREG(info.st_mode): total += info.st_size
            except FileNotFoundError:
                pass
        return total

    def remove(self, row):
        self.inspect()
        directory = self.path / row['id']
        if directory.exists():
            shutil.rmtree(directory)
        self.data['rows'].remove(row)

    def verify(self, row, result=False):
        directory = self.path / row['id']
        source = directory / 'source.webm'
        safe(directory, True); safe(source)
        if not 16 <= source.stat().st_size <= SEGMENT_BYTES or digest(source) != row.get('sha256'):
            raise ValueError('Recording fingerprint mismatch')
        timing = directory / 'complete.json'; safe(timing)
        if not 0 < timing.stat().st_size <= 64 * 1024 or digest(timing) != row.get('timing_sha256'):
            raise ValueError('Recording timing fingerprint mismatch')
        if result:
            review = directory / 'review.json'; safe(review)
            if not 0 < review.stat().st_size <= REVIEW_BYTES or digest(review) != row.get('review_sha256'):
                raise ValueError('Review fingerprint mismatch')
            self.bind_review(read_json(review, REVIEW_BYTES), row)
        return directory

    @staticmethod
    def bind_review(review, row):
        if (review.get('schema') != 'intelligent-dvr.recognition-review.v1' or
            any(review.get(k, {}).get('source_sha256') != row.get('sha256') for k in ('receipt', 'trace')) or
            review['receipt'].get('state') != 'completed' or review['trace'].get('state') != 'completed' or
            any(review[k].get('frames_read') != row.get('frames') or review[k].get('camera') != row['source'] or
                review[k].get('fps_metadata') != 10 for k in ('receipt', 'trace'))):
            raise ValueError('Incomplete or mismatched segment analysis')

    def close(self):
        if self.fd is not None:
            os.close(self.fd); self.fd = None


class Recorder:
    def __init__(self, config, sources, jobs, directory, *, process_factory=subprocess.Popen,
                 clock=time.monotonic, wall=time.time, disk_usage=shutil.disk_usage, supervise=True):
        self.config, self.sources, self.jobs = config, sources, jobs
        self.process_factory, self.clock, self.wall, self.disk_usage = process_factory, clock, wall, disk_usage
        self.lock = threading.RLock(); self.closed = threading.Event()
        self.active = False; self.state = 'stopped'; self.error = None
        self.failed = False
        self.process = self.capture = self.analysis = None
        self.analysis_budget = 0
        self.retry_at = 0; self.failures = 0; self.selection = None
        self.metrics = {}; self.last_finished = None
        self.store = Store(directory)
        self.work = self.store.path / 'work'
        self.rows = self.store.data['rows']; self.counters = self.store.data['counters']
        try:
            self.recover()
        except BaseException:
            self.store.close(); raise
        self.thread = threading.Thread(target=self._supervise, daemon=True) if supervise else None
        if self.thread:
            self.thread.start()

    def recover(self):
        # Native workers lose their parent pipe on service death. Their one
        # bounded scratch directory is owned by this store, not an orphan in /tmp.
        if self.work.exists(): shutil.rmtree(self.work)
        known = {row['id'] for row in self.rows}
        for directory in self.store.path.iterdir():
            if directory.is_dir() and directory.name not in known:
                # Only known private worker artifact names were accepted by inspect.
                shutil.rmtree(directory); self.counters['interrupted'] += 1; self.counters['dropped'] += 1
        for row in self.rows:
            if row['state'] == 'recording':
                directory = self.store.path / row['id']
                if directory.exists(): shutil.rmtree(directory)
                row.update(state='interrupted', error='SERVICE_INTERRUPTED')
                self.counters['interrupted'] += 1; self.counters['dropped'] += 1
            elif row['state'] in ('queued', 'analyzing', 'completed'):
                try:
                    self.store.verify(row, row['state'] == 'completed')
                    if row['state'] == 'analyzing':
                        row.update(state='queued', error='ANALYSIS_INTERRUPTED')
                        self.counters['interrupted'] += 1
                except (OSError, ValueError, KeyError, TypeError):
                    row.update(state='failed', error='INTEGRITY_FAILED'); self.counters['dropped'] += 1
        self.store.save()  # No worker, network, deletion by age, or analysis starts here.
        self.work.mkdir(mode=0o700)

    def _error(self, code):
        self.error = code

    def start(self, body):
        with self.lock:
            if self.closed.is_set(): raise FeedError('STOPPED', 'The local service is stopping.', 503)
            if self.failed: raise FeedError('RECORDER_FAILED', 'Check local storage and restart the service before recording again.', 503)
            if self.active: raise FeedError('IN_USE', 'This camera is already recording. Refresh its status.', 409)
            if not isinstance(body, dict) or set(body) != {'model', 'rules'} or any(not isinstance(v, str) for v in body.values()):
                raise FeedError('SELECTION', 'Select a model and rules.')
            try:
                model = self.jobs.catalog['models'][body['model']]; rules = self.jobs.catalog['rules'][body['rules']]
                if not set(rules['classes']) <= set(model['classes']): raise KeyError()
            except KeyError:
                raise FeedError('SELECTION', 'Select compatible configured model and rules.') from None
            self.jobs.claim(self)
            self.active = True; self.state = 'starting'; self.error = None; self.selection = dict(body)
            self.failures = 0; self.retry_at = 0
            return self.status()

    def _kill_capture(self):
        if self.process:
            if self.process.poll() is None: self.process.kill()
            self.process.wait(timeout=5)
            if self.process.stdin and not self.process.stdin.closed: self.process.stdin.close()
            self.process = None

    def _discard(self, code):
        self._kill_capture()
        if self.capture:
            directory = self.store.path / self.capture['id']
            if directory.exists(): shutil.rmtree(directory)
            self.capture.update(state='interrupted', error=code)
            self.counters['dropped'] += 1; self.counters['interrupted'] += 1
            self.capture = None
        self._error(code)

    def stop(self, body=None):
        with self.lock:
            self.active = False; self.state = 'stopped'
            self._discard('OPERATOR_STOP') if self.capture else None
            if self.analysis:
                self.jobs.cancel(self.analysis['job_id'])
                # Let the supervisor observe terminal cleanup before releasing Jobs.
                self.state = 'stopping'
            else:
                self.jobs.release(self)
            self.store.save()
            return self.status()

    def _expire(self, room=False, reservation=RESERVATION, keep=None):
        now = self.wall(); protected = {id(r) for r in (self.capture, self.analysis, keep) if r is not None}
        changed = False
        for row in list(self.rows):
            if id(row) in protected: continue
            expired = now - row['created_at'] >= self.config['retention_minutes'] * 60
            full = room and (len(self.rows) >= self.config['max_segments'] or self.store.usage() + reservation + self.analysis_budget > self.config['max_storage_mib'] * 1024**2)
            if expired or full:
                if row['state'] in ('queued', 'analyzing'): self.counters['dropped'] += 1
                self.counters['expired'] += 1
                self.store.remove(row)
                changed = True
        if changed: self.store.save()

    def _space(self):
        return (self.disk_usage(self.store.path).free >= self.config['reserve_mib'] * 1024**2 + RESERVATION and
                self.store.usage() + RESERVATION + self.analysis_budget <= self.config['max_storage_mib'] * 1024**2 and
                len(self.rows) < self.config['max_segments'])

    def _launch(self):
        self._expire(room=True)
        if not self._space():
            self.state = 'disk_pressure'; self._error('STORAGE_PRESSURE'); return
        row = {'id': secrets.token_hex(16), 'source': self.config['source'], 'created_at': self.wall(),
               'state': 'recording', 'error': None, **self.selection}
        self.rows.append(row); self.capture = row
        directory = self.store.path / row['id']; directory.mkdir(mode=0o700)
        self.store.save()  # Intent committed before the credential pipe or camera is opened.
        self.capture_began = self.clock()
        try:
            self.process = self.process_factory([sys.executable, '-m', 'edge.segment_worker', str(directory), str(self.config['segment_seconds'])],
                cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.process.stdin.write(json.dumps(self.sources[self.config['source']]).encode() + b'\n')
            self.process.stdin.flush()  # Remains open as the cross-platform parent-lifetime lease.
            self.state = 'recording'
        except (OSError, ValueError):
            self._connection_failed('START_FAILED')

    def _connection_failed(self, code):
        self._discard(code); self.failures += 1; self.counters['reconnects'] += 1
        self.retry_at = self.clock() + min(60, 2 ** min(self.failures, 6))
        self.state = 'reconnecting'; self.store.save()

    def _capture_tick(self):
        if not self.capture: return
        directory = self.store.path / self.capture['id']
        try:
            self.metrics = read_json(directory / 'progress.json', 4096)
        except (OSError, ValueError): pass
        if self.disk_usage(self.store.path).free < self.config['reserve_mib'] * 1024**2:
            self._discard('STORAGE_PRESSURE'); self.state = 'disk_pressure'; self.store.save(); return
        if self.clock() - self.capture_began > self.config['segment_seconds'] + 20:
            self._connection_failed('CAPTURE_TIMEOUT'); return
        if self.process.poll() is None: return
        code = self.process.returncode
        self._kill_capture()
        if code:
            self._connection_failed('CONNECTION_OR_ENCODER_FAILED'); return
        try:
            result = read_json(directory / 'complete.json', 64 * 1024)
            if (not re.fullmatch('[a-f0-9]{64}', result.get('sha256', '')) or
                    type(result.get('frames')) is not int or not 2 <= result['frames'] <= self.config['segment_seconds'] * 10 + 1 or
                    len(result.get('receive_offsets_seconds', [])) != result['frames']):
                raise ValueError('Invalid completion')
            self.capture.update(sha256=result['sha256'], timing_sha256=digest(directory / 'complete.json'))
            self.store.verify(self.capture)
            if result['bytes'] != (directory / 'source.webm').stat().st_size: raise ValueError('Changed segment')
            self.capture.update(state='queued', ended_at=result['ended_at'], frames=result['frames'],
                first_frame_at=result['started_at'] + result['receive_offsets_seconds'][0],
                capture_seconds=result['capture_wall_seconds'], missed_sample_slots=result['missed_sample_slots'],
                completion_lag_seconds=round(max(0, self.wall() - result['ended_at']), 3))
            previous = [r for r in self.rows if r is not self.capture and 'ended_at' in r]
            self.capture['gap_before_seconds'] = round(max(0, self.capture['first_frame_at'] - previous[-1]['ended_at']), 3) if previous else None
            self.counters['recorded'] += 1
            self.last_finished = self.clock(); self.metrics = {k: v for k, v in result.items() if k != 'receive_offsets_seconds'}
            self.capture = None; self.failures = 0; self.error = None
            self.store.save()
        except (OSError, ValueError, KeyError, TypeError):
            self._connection_failed('SEGMENT_INVALID')

    def _analysis_tick(self):
        if self.analysis:
            row = self.analysis; job = self.jobs.snapshot(row['job_id'])
            if job['state'] not in ('completed', 'failed', 'cancelled'): return
            try:
                if job['state'] != 'completed' or job.get('result_state') != 'completed':
                    raise ValueError('Analysis failed or incomplete')
                directory = self.store.verify(row)
                if (self.store.usage() + REVIEW_BYTES > self.config['max_storage_mib'] * 1024**2 or
                    self.disk_usage(self.store.path).free < self.config['reserve_mib'] * 1024**2 + REVIEW_BYTES):
                    raise OSError('No room to retain result')
                path, _ = self.jobs.artifact(job['id'], 'result')
                review = read_json(path, REVIEW_BYTES); self.store.bind_review(review, row)
                atomic_json(directory / 'review.json', review)
                row.update(review_sha256=digest(directory / 'review.json'))
                self.store.verify(row, True)
                row.update(state='completed', error=None, analysis_seconds=job['elapsed_seconds'],
                    analysis_lag_seconds=round(max(0, self.wall() - row['ended_at']), 3))
                self.counters['analyzed'] += 1
            except (OSError, ValueError, KeyError, TypeError):
                row.update(state='queued' if not self.active else 'failed', error='ANALYSIS_INTERRUPTED' if not self.active else 'ANALYSIS_FAILED')
                if self.active: self.counters['dropped'] += 1
                self._error(row['error'])
            self.analysis = None; self.analysis_budget = 0; self.store.save()
            self.jobs.discard_managed_result(self)
        if not self.active:
            self.jobs.release(self); self.state = 'stopped'; return
        for row in self.rows:
            if row['state'] != 'queued': continue
            try:
                directory = self.store.verify(row)
                model = self.jobs.catalog['models'][row['model']]
                budget = model['path'].stat().st_size + SEGMENT_BYTES + REVIEW_BYTES
                required = budget + RESERVATION
                # Keep the oldest queued source while reclaiming enough space
                # for inference, not just the smaller next-capture reservation.
                self._expire(room=True, reservation=required, keep=row)
                if (self.disk_usage(self.store.path).free < required + self.config['reserve_mib'] * 1024**2 or
                    self.store.usage() + required > self.config['max_storage_mib'] * 1024**2):
                    self._error('ANALYSIS_STORAGE_PRESSURE'); return
                row.update(state='analyzing'); self.store.save()
                job = self.jobs.start({'recording': row['id'], 'model': row['model'], 'rules': row['rules']}, owner=self,
                    source=directory / 'source.webm', expected_sha=row['sha256'], camera=row['source'], scratch_parent=self.work)
                row['job_id'] = job['id']; self.analysis = row; self.analysis_budget = budget; self.store.save()
                return
            except Exception:
                row.update(state='failed', error='ANALYSIS_START_FAILED'); self.counters['dropped'] += 1
                self._error('ANALYSIS_START_FAILED'); self.store.save()

    def tick(self):
        with self.lock:
            # Expired queued recordings must not be admitted for inference when
            # an operator starts again after a long pause.
            if self.active: self._expire()
            self._capture_tick()
            self._analysis_tick()
            if self.active:
                if not self.capture and self.clock() >= self.retry_at: self._launch()

    def _supervise(self):
        while not self.closed.wait(.25):
            try: self.tick()
            except Exception:
                with self.lock:
                    self.active = False; self.failed = True; self.state = 'failed'; self.error = 'STORAGE_OR_WORKER_FAILED'
                    self._kill_capture()
                    if self.analysis:
                        self.jobs.cancel(self.analysis['job_id'])
                    else:
                        self.jobs.release(self)
                # Preserve uncertain artifacts. Restart validates them without recording.
                return

    def status(self):
        with self.lock:
            now = self.wall()
            queued = [r for r in self.rows if r['state'] in ('queued', 'analyzing')]
            return {'state': self.state, 'active': self.active, 'source': self.config['source'],
                'name': self.sources[self.config['source']]['name'], 'error': self.error,
                'limits': self.config, 'counters': dict(self.counters), 'queue_depth': len(queued),
                'oldest_pending_seconds': round(max((max(0, now - r.get('ended_at', r['created_at'])) for r in queued), default=0), 1),
                'seconds_since_completed_segment': None if self.last_finished is None else round(self.clock() - self.last_finished, 1),
                'retry_seconds': round(max(0, self.retry_at - self.clock()), 1) if self.active else 0,
                'storage_bytes': self.store.usage(), 'disk_free_bytes': self.disk_usage(self.store.path).free,
                'worker': dict(self.metrics), 'segments': [dict(r) for r in reversed(self.rows)]}

    def artifact(self, identifier, kind):
        with self.lock:
            row = next((r for r in self.rows if r['id'] == identifier), None)
            if row is None or row['state'] != 'completed':
                raise FeedError('NOT_READY', 'This segment has no retained completed analysis.', 404)
            try:
                directory = self.store.verify(row, True)
                name, mime = {'source': ('source.webm', 'video/webm'), 'result': ('review.json', 'application/json'),
                              'timing': ('complete.json', 'application/json')}[kind]
                return directory / name, mime
            except (OSError, ValueError, KeyError, TypeError):
                raise FeedError('INTEGRITY_FAILED', 'Recording and result verification failed. Preserve local files for inspection.', 409) from None

    def close(self):
        self.closed.set()
        if self.thread: self.thread.join(timeout=10)
        try:
            self.stop()
            if self.analysis:
                if self.jobs.thread: self.jobs.thread.join(timeout=10)
                self._analysis_tick()
            self.jobs.release(self)
        finally:
            self.store.close()
