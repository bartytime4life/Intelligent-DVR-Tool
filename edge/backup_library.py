"""OEM companion: read-only settled-file ingest, verified local copies, opt-in analysis.

No vendor processes, recording settings, source files or camera connections are changed.
A quiet file is a heuristic, not proof that an OEM has closed a recording.
"""
import contextlib
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import stat
import sys
import threading
import tempfile
import time

from .evaluation import read_json
from .fileops import open_regular, sync_directory, replace
from .recording_import import folder_lock
from .result_store import VIDEO_BYTES, REVIEW_BYTES, EXTENSIONS

GIB = 1024**3
MAX_ITEMS, MAX_SCAN = 10000, 10000
MAX_FILE_BYTES = 64 * GIB
BACKUP_EXTENSIONS = EXTENSIONS | {'.bvr', '.dav', '.264', '.265', '.h264', '.h265', '.ts', '.ps', '.mpg', '.mpeg', '.wmv', '.asf'}
CONFIG_KEYS = {'source_folder', 'backup_folder', 'max_storage_gib', 'reserve_gib', 'settle_seconds', 'recursive'}
MIMES = {'.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo'}


def atomic_private_json(path, value):
    """No predictable temporary path, credential exposure or symlink following."""
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix='.dvr-write-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


class LibraryError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def signature(info):
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


def ordinary_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise LibraryError('FOLDER', 'Choose ordinary folders, without symbolic links.')
    return info.st_dev, info.st_ino


def validate_config(body, *, require_source=True):
    if not isinstance(body, dict) or set(body) != CONFIG_KEYS or type(body['recursive']) is not bool:
        raise LibraryError('SETTINGS', 'Choose recording and backup folders and review the storage settings.')
    for key, low, high in (('max_storage_gib', 1, 1000000), ('reserve_gib', 1, 1024), ('settle_seconds', 30, 3600)):
        if type(body[key]) is not int or not low <= body[key] <= high:
            raise LibraryError('SETTINGS', f'{key.replace("_", " ")} must be a whole number from {low} to {high}.')
    paths = []
    for key in ('source_folder', 'backup_folder'):
        value = body[key]
        if not isinstance(value, str) or not 1 <= len(value) <= 1024 or any(ord(c) < 32 for c in value):
            raise LibraryError('FOLDER', 'Choose an absolute folder path on this computer.')
        path = Path(value).expanduser()
        if not path.is_absolute() or path.is_symlink():
            raise LibraryError('FOLDER', 'Use absolute folder paths without symbolic links.')
        paths.append(path.resolve())
    source, backup = paths
    if source == backup or source in backup.parents or backup in source.parents:
        raise LibraryError('FOLDER_OVERLAP', 'Choose separate folders; neither folder can contain the other.')
    if require_source: ordinary_directory(source)
    if os.name == 'nt' and str(backup).startswith('\\\\'):
        raise LibraryError('LOCAL_BACKUP', 'Choose a backup disk attached to this computer, not a network share.')
    return {**body, 'source_folder': str(source), 'backup_folder': str(backup)}


def fingerprint(path, limit=MAX_FILE_BYTES):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise LibraryError('INTEGRITY', 'The saved file is not an ordinary file.')
    with open_regular(path) as stream:
        before = signature(os.fstat(stream.fileno()))
        if not 0 < before[2] <= limit:
            raise LibraryError('INTEGRITY', 'The saved file is empty or exceeds its bound.')
        sha, count = hashlib.sha256(), 0
        while block := stream.read(1024 * 1024):
            count += len(block)
            if count > before[2]:
                raise LibraryError('INTEGRITY', 'The saved file changed while being checked.')
            sha.update(block)
        if count != before[2] or signature(os.fstat(stream.fileno())) != before:
            raise LibraryError('INTEGRITY', 'The saved file changed while being checked.')
        return sha.hexdigest()


class BackupLibrary:
    def __init__(self, jobs, state_dir, *, supervise=True, clock=time.monotonic, wall=time.time, disk_usage=shutil.disk_usage):
        self.jobs, self.clock, self.wall, self.disk_usage = jobs, clock, wall, disk_usage
        self.lock = threading.RLock()
        self.closed = threading.Event()
        self.active = self.analyze = self.scanning = False
        self.analysis = None
        self.copying = None
        self.error = None
        self.finished = False
        self.waiting = 0
        self.scan_limited = False
        self.unsupported = {}
        self.seen = {}
        self.last_scan = -float('inf')
        self.config = None
        self.db = self.backup_lock = None
        self.model = self.rules = ''
        self.state_dir = Path(state_dir).absolute()
        if self.state_dir.is_symlink():
            raise LibraryError('STORAGE', 'Library settings must use an ordinary private folder.')
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        ordinary_directory(self.state_dir)
        os.chmod(self.state_dir, 0o700)
        self.settings_lock = folder_lock(self.state_dir)
        self.settings_lock.__enter__()
        try:
            settings = self.state_dir / 'config.json'
            if settings.exists():
                try:
                    config = validate_config(read_json(settings, 8192), require_source=False)
                    self.config = config
                    self._open(config, create=False)
                except (OSError, ValueError, TypeError, LibraryError, sqlite3.Error):
                    # Optional removable storage must not prevent the local app
                    # and its folder-recovery controls from starting.
                    self._close_store()
                    self.error = 'Backup settings or storage are unavailable. Reconnect the disk or save accessible folders; backup remains paused.'
            self.thread = threading.Thread(target=self._supervise, name='dvr-backup-library', daemon=True) if supervise else None
            if self.thread:
                self.thread.start()
        except BaseException:
            self._close_store()
            self.settings_lock.__exit__(None, None, None)
            self.finished = True
            raise

    def _close_store(self):
        if self.db is not None:
            self.db.close()
            self.db = None
        if self.backup_lock is not None:
            self.backup_lock.__exit__(None, None, None)
            self.backup_lock = None

    def _open(self, config, *, create=True):
        backup = Path(config['backup_folder'])
        if backup.is_symlink():
            raise LibraryError('STORAGE', 'The backup folder cannot be a symbolic link.')
        if create:
            backup.mkdir(mode=0o700, parents=True, exist_ok=True)
        identity = ordinary_directory(backup)
        # Everything owned by this feature is in a separate namespace; never prune arbitrary user files.
        store = backup / 'Intelligent-DVR-Backup'
        if store.is_symlink():
            raise LibraryError('STORAGE', 'The backup library cannot be a symbolic link.')
        if create:
            store.mkdir(mode=0o700, exist_ok=True)
        ordinary_directory(store)
        os.chmod(store, 0o700)
        lease = folder_lock(store)
        lease.__enter__()
        db = None
        try:
            for name in ('library.sqlite3', 'library.sqlite3-wal', 'library.sqlite3-shm'):
                path = store / name
                if path.exists() or path.is_symlink():
                    if not stat.S_ISREG(path.lstat().st_mode) or path.stat().st_nlink != 1:
                        raise LibraryError('STORAGE', 'Library metadata must be ordinary files.')
            db = sqlite3.connect(store / 'library.sqlite3', check_same_thread=False)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT NOT NULL, extension TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, copied_at REAL NOT NULL, state TEXT NOT NULL, error TEXT, observations INTEGER, coverage TEXT, review_sha256 TEXT, UNIQUE(sha256, extension))')
            db.execute('CREATE TABLE IF NOT EXISTS sources (path TEXT PRIMARY KEY, signature TEXT NOT NULL, item TEXT NOT NULL)')
            db.execute("UPDATE items SET state='interrupted', error='Analysis was interrupted; the backup remains saved.' WHERE state='analyzing'")
            db.commit()
            os.chmod(store / 'library.sqlite3', 0o600)
        except BaseException:
            if db is not None: db.close()
            lease.__exit__(None, None, None)
            raise
        self._close_store()
        self.db, self.backup_lock = db, lease
        self.config, self.backup, self.store = config, backup, store
        self.source_identity = ordinary_directory(Path(config['source_folder'])) if Path(config['source_folder']).exists() else None
        self.backup_identity, self.store_identity = identity, ordinary_directory(store)
        self.seen.clear()
        self.last_scan = -float('inf')
        self._recover_receipts()

    def _recover_receipts(self):
        # A crash between file publication and the SQLite commit leaves a complete
        # receipt. Rebuild only from hash-verified pairs; never remove unknown files.
        for directory in itertools.islice(self.store.iterdir(), MAX_ITEMS + 100):
            if not re.fullmatch('[a-f0-9]{32}', directory.name): continue
            ordinary_directory(directory)
            if self.db.execute('SELECT 1 FROM items WHERE id=?', (directory.name,)).fetchone(): continue
            try:
                row = read_json(directory / 'receipt.json', 8192)
                if (row.get('id') != directory.name or row.get('extension') not in BACKUP_EXTENSIONS
                        or not isinstance(row.get('name'), str) or type(row.get('bytes')) is not int
                        or not re.fullmatch('[a-f0-9]{64}', row.get('sha256', ''))):
                    raise ValueError('receipt')
                source = self._source_path(row)
                if source.stat().st_size != row['bytes'] or fingerprint(source) != row['sha256']:
                    raise ValueError('fingerprint')
                row['state'] = 'saved'
                self.db.execute('INSERT OR IGNORE INTO items (id,name,extension,bytes,sha256,copied_at,state) VALUES (:id,:name,:extension,:bytes,:sha256,:copied_at,:state)', row)
                self.db.commit()
            except (OSError, ValueError, TypeError, LibraryError):
                self.error = 'An unfinished or unverified backup remains in the library. Inspect storage; no saved files were deleted.'

    def configure(self, body):
        config = validate_config(body)
        with self.lock:
            if self.active or self.analysis or self.scanning:
                raise LibraryError('BUSY', 'Stop backup and wait for analysis to finish before changing folders.', 409)
            if self.db is not None and self.config and self.config['backup_folder'] == config['backup_folder']:
                try:
                    self._check_roots(include_source=False)
                    self.db.execute('SELECT 1').fetchone()
                except (OSError, LibraryError, sqlite3.Error):
                    # A reattached/replaced volume at the same path needs fresh
                    # identities and a new database handle, not the old lease.
                    self._close_store()
            if self.db is not None and self.config and self.config['backup_folder'] == config['backup_folder']:
                self.config = config
                self.source_identity = ordinary_directory(Path(config['source_folder'])) if Path(config['source_folder']).exists() else None
                self.seen.clear()
            else:
                self._open(config)
            atomic_private_json(self.state_dir / 'config.json', config)
            sync_directory(self.state_dir)
            self.error = None
            return self.status()

    def start(self, body):
        if (not isinstance(body, dict) or set(body) != {'analyze', 'model', 'rules'} or type(body['analyze']) is not bool
                or not all(isinstance(body[k], str) for k in ('model', 'rules'))):
            raise LibraryError('SELECTION', 'Choose whether to analyze backups, with a configured model and rules.')
        with self.lock:
            if not self.config:
                raise LibraryError('NOT_CONFIGURED', 'Save the recording and backup folders first.')
            if self.closed.is_set() or self.analysis or self.scanning:
                raise LibraryError('BUSY', 'Wait for the current analysis to stop before restarting backup.', 409)
            if self.active:
                raise LibraryError('BUSY', 'Backup is already running. Stop before changing analysis options.', 409)
            if self.db is None:
                try:
                    self._open(self.config, create=False)
                except (OSError, ValueError, LibraryError, sqlite3.Error):
                    self._close_store()
                    raise LibraryError('STORAGE', 'Backup storage is unavailable. Reconnect the disk or save accessible folders.', 409) from None
            if body['analyze']:
                model = self.jobs.catalog['models'].get(body['model'])
                rules = self.jobs.catalog['rules'].get(body['rules'])
                if not model or not rules or not set(rules['classes']) <= set(model['classes']):
                    raise LibraryError('SELECTION', 'Choose a compatible model and rule set.')
            if self.source_identity is None:
                self.source_identity = ordinary_directory(Path(self.config['source_folder']))
            self._check_roots()
            self.analyze, self.model, self.rules = body['analyze'], body['model'], body['rules']
            self.active = True
            self.error = None
            return self.status()

    def stop(self):
        with self.lock:
            self.active = False
            if self.analysis:
                self.jobs.cancel(self.analysis['job'])
            return self.status()

    def _check_roots(self, *, include_source=True):
        if ((include_source and ordinary_directory(Path(self.config['source_folder'])) != self.source_identity) or
                ordinary_directory(self.backup) != self.backup_identity or ordinary_directory(self.store) != self.store_identity):
            raise LibraryError('FOLDER_CHANGED', 'A recording or backup folder changed or disconnected. Stop and review the folders.')

    def _usage(self):
        # Include partial/orphaned files after a crash; never silently recover capacity by deleting video.
        total = count = 0
        for root, dirs, files in os.walk(self.store, followlinks=False):
            for name in dirs + files:
                count += 1
                if count > MAX_ITEMS * 5 + 100:
                    raise LibraryError('LIBRARY_FULL', 'The backup library has too many entries. Preserve it and select a new backup folder.')
                path = Path(root) / name
                try: info = path.lstat()
                except FileNotFoundError: continue
                if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                    raise LibraryError('STORAGE', 'The library contains a linked or unsupported file. Inspect it locally.')
                if stat.S_ISREG(info.st_mode): total += info.st_size
        return total

    def status(self):
        with self.lock:
            rows, size, free, count, duplicates = [], 0, None, 0, 0
            if self.config and self.db is not None:
                try:
                    self._check_roots(include_source=False)
                    size = self._usage()
                    free = self.disk_usage(self.backup).free
                    rows = [dict(r) for r in self.db.execute('SELECT * FROM items ORDER BY copied_at DESC, id DESC LIMIT 100')]
                    count = self.db.execute('SELECT COUNT(*) FROM items').fetchone()[0]
                    duplicates = max(0, self.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0] - count)
                except (OSError, LibraryError, sqlite3.Error):
                    self.error = 'Backup storage is unavailable or contains unexpected entries. Inspect the selected folder.'
            for row in rows:
                row['analysis_eligible'] = row['extension'] in EXTENSIONS and row['bytes'] <= VIDEO_BYTES
                row.pop('review_sha256', None)
            return {'configured': self.config is not None, 'config': dict(self.config) if self.config else None,
                    'active': self.active, 'analyzing': self.analysis is not None,
                    'copying': dict(self.copying) if self.copying else None,
                    'analysis_job': self.jobs.snapshot(self.analysis['job']) if self.analysis else None,
                    'state': 'stopping' if (self.analysis or self.scanning) and not self.active else 'running' if self.active else 'paused',
                    'error': self.error, 'items': rows, 'storage_bytes': size, 'disk_free_bytes': free,
                    'waiting': self.waiting, 'scan_limited': self.scan_limited,
                    'unsupported': [{'extension': k, 'count': v} for k, v in sorted(self.unsupported.items())],
                    'limits': {'analysis_max_bytes': VIDEO_BYTES, 'max_items': MAX_ITEMS, 'max_file_bytes': MAX_FILE_BYTES},
                    'counters': {'copied': count, 'duplicates': duplicates}}

    def _candidates(self):
        source = Path(self.config['source_folder'])
        self.scan_limited = False
        self.oversized = 0
        count, pending = 0, [(source, 0)]
        while pending:
            base, depth = pending.pop()
            try:
                with os.scandir(base) as entries:
                    for entry in entries:
                        count += 1
                        if count > MAX_SCAN:
                            self.scan_limited = True
                            return
                        if entry.is_symlink(): continue
                        path = base / entry.name
                        if entry.is_dir(follow_symlinks=False):
                            if self.config['recursive'] and depth < 16:
                                pending.append((path, depth + 1))
                            elif self.config['recursive']:
                                self.scan_limited = True
                            continue
                        if path.suffix.lower() not in BACKUP_EXTENSIONS or len(entry.name) > 200:
                            continue
                        try:
                            # Windows DirEntry.stat omits file identity fields.
                            # Use the same path stat as the later descriptor check.
                            info = path.lstat()
                            if stat.S_ISREG(info.st_mode) and info.st_size > MAX_FILE_BYTES:
                                self.oversized += 1
                            if stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_FILE_BYTES:
                                yield path, info
                        except OSError:
                            continue
            except OSError:
                # Report inaccessible subfolders instead of silently claiming a complete scan.
                self.scan_limited = True
                if base == source: raise

    def _space(self, required):
        if (self._usage() + required > self.config['max_storage_gib'] * GIB or
                self.disk_usage(self.backup).free < required + self.config['reserve_gib'] * GIB):
            raise LibraryError('STORAGE_FULL', 'Backup is waiting for storage. Free space or increase the budget. No saved video was deleted.')

    def _source_safe(self, path):
        source = Path(self.config['source_folder'])
        if source not in path.parents or path.resolve() != path:
            raise LibraryError('SOURCE_CHANGED', 'A source path changed or became a symbolic link. No backup was accepted.')
        self._check_roots()

    def _copy(self, source, info):
        self._source_safe(source)
        with self.lock:
            if self.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0] >= MAX_ITEMS * 5:
                raise LibraryError('INDEX_FULL', 'The library reached its source history limit. Choose a new backup folder; saved copies remain intact.')
        before = signature(info)
        self._space(before[2] + 65536)
        with self.lock:
            if self.db.execute('SELECT COUNT(*) FROM items').fetchone()[0] >= MAX_ITEMS:
                raise LibraryError('LIBRARY_FULL', 'The library reached 10,000 backups. Choose a new backup folder; saved copies remain intact.')
        identifier = secrets.token_hex(16)
        directory = self.store / identifier
        directory.mkdir(mode=0o700)
        target = directory / ('source' + source.suffix.lower())
        part = directory / 'copy.part'
        accepted = False
        with self.lock: self.copying = {'name': source.name, 'bytes': before[2], 'copied_bytes': 0}
        try:
            sha, count = hashlib.sha256(), 0
            with open_regular(source) as incoming, part.open('xb') as output:
                os.chmod(part, 0o600)
                descriptor_before = signature(os.fstat(incoming.fileno()))
                # CPython on Windows reports creation time for path ctime but
                # change time for descriptor ctime. Compare their common fields;
                # retain the full independent before/after checks for both APIs.
                if (descriptor_before[:4] != before[:4] or
                        (sys.platform != 'win32' and descriptor_before != before)):
                    raise LibraryError('SOURCE_CHANGED', 'The OEM recording changed before copying. Waiting for it to settle again.')
                while block := incoming.read(1024 * 1024):
                    if not self.active or self.closed.is_set():
                        raise LibraryError('STOPPED', 'Backup paused. Finished copies remain saved.')
                    count += len(block)
                    if count > before[2]:
                        raise LibraryError('SOURCE_CHANGED', 'The OEM recording is still growing. Waiting before copying again.')
                    # Other writers can consume space while a large copy is running.
                    if self.disk_usage(self.backup).free < len(block) + self.config['reserve_gib'] * GIB:
                        raise LibraryError('STORAGE_FULL', 'Backup is waiting for free disk space. No saved video was deleted.')
                    output.write(block)
                    sha.update(block)
                    with self.lock: self.copying['copied_bytes'] = count
                output.flush()
                os.fsync(output.fileno())
                if count != before[2] or signature(os.fstat(incoming.fileno())) != descriptor_before or signature(source.lstat()) != before:
                    raise LibraryError('SOURCE_CHANGED', 'The OEM recording changed during copying. Waiting before copying again.')
            self._source_safe(source)
            source_hash = sha.hexdigest()
            if fingerprint(part) != source_hash:
                raise LibraryError('INTEGRITY', 'The backup copy failed verification. The original was preserved.')
            with self.lock:
                duplicate = self.db.execute('SELECT * FROM items WHERE sha256=? AND extension=?', (source_hash, source.suffix.lower())).fetchone()
                if duplicate:
                    # Check the actual retained bytes before allowing deduplication.
                    if fingerprint(self._source_path(duplicate)) != source_hash:
                        raise LibraryError('INTEGRITY', 'An existing backup failed verification. Preserve the library and inspect local storage.')
                    self.db.execute('INSERT OR REPLACE INTO sources VALUES (?,?,?)', (str(source), json.dumps(before), duplicate['id']))
                    self.db.commit()
                    return
                os.replace(part, target)  # Inside a freshly/exclusively created private directory.
                row = {'id': identifier, 'name': source.name, 'extension': source.suffix.lower(), 'bytes': count,
                       'sha256': source_hash, 'copied_at': self.wall(),
                       'state': 'queued' if self.analyze and source.suffix.lower() in EXTENSIONS and count <= VIDEO_BYTES else 'saved'}
                receipt = {**row, 'source_path': str(source), 'source_signature': before}
                atomic_private_json(directory / 'receipt.json', receipt)
                sync_directory(directory)
                sync_directory(self.store)
                accepted = True  # If the DB commit fails, preserve the independently verified copy and receipt.
                self.db.execute('INSERT INTO items (id,name,extension,bytes,sha256,copied_at,state) VALUES (:id,:name,:extension,:bytes,:sha256,:copied_at,:state)', row)
                self.db.execute('INSERT OR REPLACE INTO sources VALUES (?,?,?)', (str(source), json.dumps(before), identifier))
                self.db.commit()
        finally:
            with self.lock: self.copying = None
            if not accepted:
                shutil.rmtree(directory)  # Only this operation's new directory, never an accepted copy or source.

    def scan(self):
        if not self.active:
            return
        self._check_roots()
        self.waiting = 0
        self.unsupported = {}
        seen_now, copied = {}, 0
        for source, info in self._candidates():
            if not self.active or self.closed.is_set(): break
            sig = signature(info)
            previous = self.seen.get(str(source))
            began = previous[1] if previous and previous[0] == sig else self.clock()
            seen_now[str(source)] = (sig, began)
            if source.suffix.lower() not in EXTENSIONS:
                self.unsupported[source.suffix.lower()] = self.unsupported.get(source.suffix.lower(), 0) + 1
            with self.lock:
                indexed = self.db.execute('SELECT signature,item FROM sources WHERE path=?', (str(source),)).fetchone()
                if indexed and indexed['signature'] == json.dumps(sig):
                    row = self.db.execute('SELECT * FROM items WHERE id=?', (indexed['item'],)).fetchone()
                    if row and self._source_path(row).is_file(): continue
            quiet = self.config['settle_seconds']
            if self.clock() - began < quiet or self.wall() - info.st_mtime < quiet or copied >= 2:
                self.waiting += 1
                continue
            try:
                self._copy(source, info)
                copied += 1
                self.error = None
            except LibraryError as exc:
                self.error = str(exc)
                if exc.code == 'SOURCE_CHANGED':
                    seen_now[str(source)] = (sig, self.clock())
                    self.waiting += 1
                    continue
                break
        self.seen = seen_now
        if getattr(self, 'oversized', 0):
            self.error = f'{self.oversized} recordings exceed the 64 GiB per-file backup limit. Export shorter parts; those files were not copied.'

    def _source_path(self, row):
        if not re.fullmatch('[a-f0-9]{32}', row['id']) or row['extension'] not in BACKUP_EXTENSIONS:
            raise LibraryError('INTEGRITY', 'Library metadata is invalid. Preserve the library for inspection.')
        directory = self.store / row['id']
        ordinary_directory(directory)
        return directory / ('source' + row['extension'])

    def retry(self, body):
        with self.lock:
            if not isinstance(body, dict) or set(body) != {'id'} or not isinstance(body['id'], str):
                raise LibraryError('SELECTION', 'Choose a saved backup to analyze.')
            if not self.active or not self.analyze:
                raise LibraryError('PAUSED', 'Start backup with local analysis enabled before retrying.')
            row = self.db.execute('SELECT * FROM items WHERE id=?', (body['id'],)).fetchone()
            if not row or row['state'] == 'analyzing' or row['extension'] not in EXTENSIONS or row['bytes'] > VIDEO_BYTES:
                raise LibraryError('SELECTION', 'Choose an eligible saved backup up to 512 MiB.')
            self.db.execute("UPDATE items SET state='queued',error=NULL WHERE id=?", (row['id'],))
            self.db.commit()
            return self.status()

    def _analysis_tick(self):
        with self.lock:
            if self.analysis:
                current = self.analysis
                job = self.jobs.snapshot(current['job'])
                if job['state'] not in ('completed', 'cancelled', 'failed'): return
                try:
                    if job['state'] != 'completed':
                        raise LibraryError('ANALYSIS_FAILED', (job.get('error') or {}).get('message') or 'Analysis stopped. The backup remains saved.')
                    path, _ = self.jobs.artifact(job['id'], 'result')
                    review = read_json(path, REVIEW_BYTES)
                    if review.get('receipt', {}).get('source_sha256') != current['sha256']:
                        raise LibraryError('INTEGRITY', 'Analysis does not match the backup fingerprint.')
                    self._space(path.stat().st_size + 65536)
                    target = self.store / current['id'] / 'review.json'
                    atomic_private_json(target, review)
                    sync_directory(target.parent)
                    coverage = job.get('result_state') or 'unverified'
                    self.db.execute("UPDATE items SET state='completed',error=NULL,observations=?,coverage=?,review_sha256=? WHERE id=?",
                                    (len(review.get('receipt', {}).get('events', [])), coverage, fingerprint(target, REVIEW_BYTES), current['id']))
                except (OSError, ValueError, LibraryError) as exc:
                    self.db.execute('UPDATE items SET state=?,error=? WHERE id=?',
                                    ('failed' if self.active else 'interrupted', str(exc), current['id']))
                finally:
                    self.db.commit()
                    self.analysis = None
                    self.jobs.discard_managed_result(self)
                    self.jobs.release(self)
            if not self.active or not self.analyze: return
            row = self.db.execute("SELECT * FROM items WHERE state IN ('saved','queued','interrupted') AND bytes<=? ORDER BY copied_at,id", (VIDEO_BYTES,)).fetchall()
            row = next((r for r in row if r['extension'] in EXTENSIONS), None)
            if row is None: return
            claimed = False
            try:
                self.jobs.claim(self)
                claimed = True
                path = self._source_path(row)
                if fingerprint(path) != row['sha256']:
                    raise LibraryError('INTEGRITY', 'The saved backup changed. No analysis was accepted.')
                # Scratch is on the backup volume, not a potentially smaller system temp volume.
                model_bytes = self.jobs.catalog['models'][self.model]['path'].stat().st_size
                self._space(row['bytes'] + model_bytes + REVIEW_BYTES)
                self.db.execute("UPDATE items SET state='analyzing',error=NULL WHERE id=?", (row['id'],))
                self.db.commit()
                job = self.jobs.start({'recording': row['id'], 'model': self.model, 'rules': self.rules},
                                      owner=self, source=path, expected_sha=row['sha256'], camera='backup-' + row['id'][:16], scratch_parent=self.store)
                self.analysis = {'id': row['id'], 'sha256': row['sha256'], 'job': job['id']}
            except Exception as exc:
                if claimed: self.jobs.release(self)
                if getattr(exc, 'code', '') == 'BUSY': return
                self.db.execute("UPDATE items SET state='failed',error=? WHERE id=?", (str(exc), row['id']))
                self.db.commit()

    def tick(self):
        if self.config and self.db is not None:
            self._analysis_tick()
            if self.active and self.clock() - self.last_scan >= 5:
                self.last_scan = self.clock()
                with self.lock: self.scanning = True
                try:
                    self.scan()
                finally:
                    with self.lock: self.scanning = False

    def _supervise(self):
        while not self.closed.wait(1):
            try:
                self.tick()
            except Exception:
                with self.lock:
                    self.active = False
                    self.error = 'Backup paused after a storage or folder failure. Existing copies remain saved; check folders and reconnect.'
                    if self.analysis:
                        with contextlib.suppress(Exception): self.jobs.cancel(self.analysis['job'])

    def open_artifact(self, identifier, kind):
        with self.lock:
            if not self.db or not re.fullmatch('[a-f0-9]{32}', identifier):
                raise LibraryError('NOT_FOUND', 'This backup is unavailable.', 404)
            row = self.db.execute('SELECT * FROM items WHERE id=?', (identifier,)).fetchone()
            if row is None:
                raise LibraryError('NOT_FOUND', 'This backup is unavailable.', 404)
            self._check_roots(include_source=False)
            source = self._source_path(row)
            if kind == 'result':
                if row['state'] != 'completed':
                    raise LibraryError('NOT_READY', 'This backup has no completed analysis.', 409)
                path, expected, mime = source.parent / 'review.json', row['review_sha256'], 'application/json'
            else:
                path, expected, mime = source, row['sha256'], MIMES.get(row['extension'], 'application/octet-stream')
            if not stat.S_ISREG(path.lstat().st_mode):
                raise LibraryError('INTEGRITY', 'The saved file is not an ordinary file.', 409)
            stream = open_regular(path)
        try:
            before = signature(os.fstat(stream.fileno()))
            if not 0 < before[2] <= MAX_FILE_BYTES:
                raise LibraryError('INTEGRITY', 'The saved file exceeds its bound.', 409)
            sha, count = hashlib.sha256(), 0
            while block := stream.read(1024 * 1024):
                count += len(block)
                if count > before[2]:
                    raise LibraryError('INTEGRITY', 'The saved file grew while opening.', 409)
                sha.update(block)
            if (count != before[2] or signature(os.fstat(stream.fileno())) != before or sha.hexdigest() != expected):
                raise LibraryError('INTEGRITY', 'The saved file failed its fingerprint check. Nothing was opened.', 409)
            stream.seek(0)
            return stream, mime
        except BaseException:
            stream.close()
            raise

    def close(self):
        if self.finished: return
        self.stop()
        self.closed.set()
        if self.thread: self.thread.join(timeout=15)
        if self.analysis:
            # Do not release Jobs while its worker is still using this owner's files.
            if self.jobs.thread: self.jobs.thread.join(timeout=10)
            with contextlib.suppress(Exception): self._analysis_tick()
        if self.thread and self.thread.is_alive(): return
        with self.lock:
            self._close_store()
            self.settings_lock.__exit__(None, None, None)
            self.finished = True
