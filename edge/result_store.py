"""Opt-in Linux local job recovery. One owner, one retained job, no automatic work."""
import hashlib
from itertools import islice
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys

from .evaluation import anchor, read_json
from .fileops import replace

VIDEO_BYTES = 512 * 1024**2
REVIEW_BYTES = 32 * 1024**2
EXTENSIONS = {'.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm'}
JOB_KEYS = {'id', 'state', 'phase', 'recording', 'model', 'rules', 'frames_read',
            'frames_analyzed', 'max_frames', 'elapsed_seconds', 'error', 'result_state'}


def private(path, directory=False):
    info = path.lstat()
    valid = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    if not valid or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Result-store paths must be private, owner-owned and not symlinks')


def fingerprint(path, limit):
    private(path)
    with path.open('rb') as stream:
        before = os.fstat(stream.fileno())
        if not 0 < before.st_size <= limit:
            raise ValueError('Retained result exceeds its file bound')
        digest = hashlib.sha256()
        count = 0
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            count += len(block)
            if count > limit:
                raise ValueError('Retained result grew beyond its file bound')
            digest.update(block)
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('Retained result changed while checking integrity')
        return digest.hexdigest()


def validate_job(job):
    if not isinstance(job, dict) or set(job) - JOB_KEYS:
        raise ValueError('Unsupported retained job fields')
    if not isinstance(job.get('id'), str) or not re.fullmatch('[a-f0-9]{32}', job['id']) or job.get('state') not in ('running', 'completed', 'failed', 'cancelled'):
        raise ValueError('Invalid retained job identity or state')
    if job.get('phase') not in ('preparing', 'validating', 'analyzing', 'verifying', 'cancelling', 'running', 'completed', 'failed', 'cancelled'):
        raise ValueError('Invalid retained job phase')
    for key in ('recording', 'model', 'rules'):
        if not isinstance(job.get(key), str) or not 1 <= len(job[key]) <= 160:
            raise ValueError('Invalid retained job description')
    for key in ('frames_read', 'frames_analyzed', 'max_frames'):
        if type(job.get(key)) is not int or not 0 <= job[key] <= 6000:
            raise ValueError('Invalid retained frame count')
    if job['frames_analyzed'] > job['frames_read'] or job['frames_read'] > job['max_frames']:
        raise ValueError('Inconsistent retained frame counts')
    if job['state'] != 'running' and job['phase'] != job['state']:
        raise ValueError('Inconsistent retained terminal state')
    elapsed = job.get('elapsed_seconds')
    if type(elapsed) not in (int, float) or not math.isfinite(elapsed) or not 0 <= elapsed <= 3600:
        raise ValueError('Invalid retained elapsed time')
    error = job.get('error')
    if error is not None and (not isinstance(error, dict) or set(error) != {'code', 'message'} or
            any(not isinstance(error[k], str) or len(error[k]) > 1024 for k in error)):
        raise ValueError('Invalid retained error')
    if job.get('result_state') not in (None, 'completed', 'partial'):
        raise ValueError('Invalid retained analysis coverage')


class ResultStore:
    """Linux owner-local storage; checksums detect corruption, not owner tampering.

    Caller holds its job lock. The file lock excludes other service processes.
    A committed completed record follows fsync of its two retained artifacts.
    Only a new explicit job replaces the last job; close preserves committed data.
    inspect_only validates and predicts recovery without creating or changing files.
    It holds an existing owner lock until close; startup must revalidate afterward.
    """
    def __init__(self, directory, *, inspect_only=False):
        if sys.platform != 'linux':
            raise ValueError('Persistent analysis results currently require Linux; omit --state-dir for temporary storage')
        # OS links above the store are resolved once; the store and its contents are never links.
        self.directory = anchor(directory)
        self.fd = None
        if self.directory.is_symlink():
            raise ValueError('Result-store paths cannot contain symlinks')
        if inspect_only and not self.directory.exists():
            if not self.directory.parent.is_dir() or not os.access(self.directory.parent, os.W_OK | os.X_OK):
                raise ValueError('Result-store parent must exist and be writable')
            self.job = self.job_directory = None
            return
        if not inspect_only:
            self.directory.mkdir(mode=0o700, parents=False, exist_ok=True)
        private(self.directory, directory=True)
        if inspect_only and (self.directory.stat().st_mode & 0o700 != 0o700 or
                             not os.access(self.directory, os.R_OK | os.W_OK | os.X_OK)):
            raise ValueError('Result-store directory needs owner read, write and search permissions')
        try:
            self._check_contents()
            import fcntl
            lock = self.directory/'owner.lock'
            if not inspect_only or lock.exists():
                self.fd = os.open(lock, (os.O_RDONLY if inspect_only else os.O_CREAT | os.O_RDWR) | os.O_NOFOLLOW, 0o600)
                private(lock)
                try:
                    fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as exc:
                    raise ValueError('Result store already has a live service owner') from exc
            self._check_contents()
            self.job, self.job_directory = self._recover(inspect_only=inspect_only)
        except BaseException:
            self.close()
            raise

    def _check_contents(self):
        entries = list(islice(self.directory.iterdir(), 6))
        if len(entries) > 5:
            raise ValueError('Unexpected result-store contents; preserve the folder for inspection')
        for path in entries:
            if path.name in ('owner.lock', 'state.json', 'state.tmp'):
                private(path)
                if path.name != 'owner.lock' and path.stat().st_size > 16384:
                    raise ValueError('Oversized result-store metadata')
            elif re.fullmatch('job-[a-f0-9]{32}', path.name):
                private(path, directory=True)
                files = list(islice(path.iterdir(), 13))
                if len(files) > 12:
                    raise ValueError('Unexpected retained job contents')
                for file in files:
                    if file.name not in ('model.onnx', 'labels.json', 'rules.json', 'args.json', 'receipt.json',
                            'review.json', 'progress.json', 'progress.tmp') and not (file.stem == 'source' and file.suffix in EXTENSIONS):
                        raise ValueError('Unexpected retained job file')
                    # Work-in-progress files are protected by their 0700 directory.
                    info = file.lstat()
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
                        raise ValueError('Unsafe retained job file')
            else:
                raise ValueError('Use a dedicated empty result-store folder')

    def _sync_directory(self):
        fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)

    def _save(self, job, artifacts=None):
        job = {k:v for k,v in job.items() if k != 'recovered'}
        validate_job(job)
        data = json.dumps({'schema':'intelligent-dvr.local-result-state.v1', 'job':job, 'artifacts':artifacts}, allow_nan=False).encode()
        if len(data) > 16384:
            raise ValueError('Oversized result-store metadata')
        temporary = self.directory/'state.tmp'
        if temporary.exists():
            private(temporary); temporary.unlink()
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        replace(temporary, self.directory/'state.json')
        self._sync_directory()

    def _prune(self, keep=None):
        self._check_contents()
        for path in self.directory.iterdir():
            if re.fullmatch('job-[a-f0-9]{32}', path.name) and path != keep:
                shutil.rmtree(path)
        self._sync_directory()

    def begin(self, job):
        directory = self.directory/('job-'+job['id'])
        directory.mkdir(mode=0o700)
        # Commit new running identity before replacing the previous result or dispatching.
        self._save(job)
        self._prune(keep=directory)
        return directory

    def commit(self, job, directory):
        artifacts = None
        if job['state'] == 'completed':
            source = list(directory.glob('source.*'))
            if len(source) != 1 or source[0].suffix not in EXTENSIONS:
                raise ValueError('Missing frozen recording')
            for file in (source[0], directory/'review.json'):
                os.chmod(file, 0o600)
                with file.open('rb') as stream:os.fsync(stream.fileno())
            artifacts = {'source':source[0].name, 'source_sha256':fingerprint(source[0], VIDEO_BYTES),
                         'review_sha256':fingerprint(directory/'review.json', REVIEW_BYTES)}
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
            self._verify(directory, artifacts)
        self._save(job, artifacts)

    def _verify(self, directory, artifacts):
        if not isinstance(artifacts, dict) or set(artifacts) != {'source', 'source_sha256', 'review_sha256'}:
            raise ValueError('Invalid retained artifact manifest')
        name = artifacts['source']
        if not isinstance(name, str) or Path(name).stem != 'source' or Path(name).suffix not in EXTENSIONS or Path(name).name != name:
            raise ValueError('Invalid retained recording name')
        if fingerprint(directory/name, VIDEO_BYTES) != artifacts['source_sha256'] or fingerprint(directory/'review.json', REVIEW_BYTES) != artifacts['review_sha256']:
            raise ValueError('Retained recording or result failed integrity verification')
        review = read_json(directory/'review.json', REVIEW_BYTES)
        if (not isinstance(review, dict) or not isinstance(review.get('receipt'), dict) or not isinstance(review.get('trace'), dict) or
                review.get('schema') != 'intelligent-dvr.recognition-review.v1' or
                review['receipt'].get('source_sha256') != artifacts['source_sha256'] or
                review['trace'].get('source_sha256') != artifacts['source_sha256'] or
                review['receipt'].get('state') not in ('completed', 'partial')):
            raise ValueError('Retained review is not bound to its recording')

    def _recover(self, *, inspect_only=False):
        path = self.directory/'state.json'
        if not path.exists():
            if any(self.directory.glob('job-*')):
                raise ValueError('Result metadata is missing; preserve retained files for inspection')
            return None, None
        record = read_json(path, 16384)
        if not isinstance(record, dict) or set(record) != {'schema', 'job', 'artifacts'} or record['schema'] != 'intelligent-dvr.local-result-state.v1':
            raise ValueError('Unsupported result-store state; preserve it for inspection')
        job = record['job']; validate_job(job)
        directory = self.directory/('job-'+job['id'])
        if job['state'] == 'completed':
            private(directory, directory=True)
            self._verify(directory, record['artifacts'])
            if not inspect_only:
                self._prune(keep=directory)
        else:
            if record['artifacts'] is not None:
                raise ValueError('Unexpected artifacts for an unsuccessful retained job')
            if job['state'] == 'running':
                job.update(state='failed', phase='failed', result_state=None,
                           error={'code':'SERVICE_INTERRUPTED', 'message':'The service stopped during analysis. No result was recovered. Start another job explicitly.'})
                if not inspect_only:
                    self._save(job)
            if not inspect_only:
                self._prune()
            directory = None
        return {**job, 'recovered':True}, directory

    def close(self):
        if self.fd is not None:
            os.close(self.fd); self.fd = None
