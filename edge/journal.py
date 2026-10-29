"""Optional owner-local outcome journal. Never stores sample payloads or retries work.

One controlling thread/process owns a private local directory. SQLite commits
precede IPC dispatch and returned outcomes. Terminal reads are at-least-once;
only an explicit acknowledgment removes a row from the delivery queue.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import time
import uuid

from .scheduler import integer


class JournalError(RuntimeError):
    pass


def _json(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False)


class OutcomeJournal:
    """Linux local-disk SQLite outbox; one ProcessWorkers instance per open run.

    max_bytes is a logical reservation budget, not an OS/filesystem quota.
    Each dispatched row reserves max_result_bytes + 2048 metadata bytes until
    terminal commit. Acknowledged rows count until explicitly prune()d. Full
    journals pause new dispatch; scheduler pending replacement/age limits remain.
    Pending samples, frame bytes, rule state and consumer side effects are absent.
    """
    def __init__(self, directory, *, max_entries=100000, max_bytes=64*1024**2,
                 max_result_bytes=1024**2):
        if sys.platform != 'linux':
            raise ValueError('OutcomeJournal currently requires Linux and a private local directory')
        if (not integer(max_entries, 1, 1000000) or not integer(max_result_bytes, 512, 4*1024**2)
                or not integer(max_bytes, max_result_bytes+2048, 4*1024**3)):
            raise ValueError('Invalid journal reservation bounds')
        # The directory is explicit owner-controlled configuration, never browser input.
        directory = Path(directory).absolute()
        directory.mkdir(mode=0o700, parents=False, exist_ok=True)
        self._private(directory, directory=True)
        import fcntl
        self._lock = os.open(directory/'owner.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self._db = None
        try:
            self._private(directory/'owner.lock')
            try:
                fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise JournalError('Journal already has a live owner') from exc
            path = directory/'outcomes.sqlite3'
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
            for file in (path, directory/'outcomes.sqlite3-wal', directory/'outcomes.sqlite3-shm'):
                if file.exists() or file.is_symlink():
                    self._private(file)
            self._db = sqlite3.connect(path, timeout=.2)
            self._db.execute('PRAGMA trusted_schema=OFF')
            version = self._db.execute('PRAGMA user_version').fetchone()[0]
            tables = self._db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            if version not in (0, 1) or (version == 0 and tables):
                raise JournalError('Unrecognized journal schema; preserve it for inspection')
            if version == 1:
                columns = [r[1] for r in self._db.execute('PRAGMA table_info(entries)')]
                if (set(r[0] for r in tables) != {'entries', 'sqlite_sequence'} or
                        columns != ['id', 'run', 'token', 'status', 'acked', 'charge', 'body']):
                    raise JournalError('Unrecognized journal schema; preserve it for inspection')
            if self._db.execute('PRAGMA journal_mode=WAL').fetchone()[0] != 'wal':
                raise JournalError('Local WAL mode is required')
            self._db.execute('PRAGMA synchronous=FULL')
            self._db.execute('PRAGMA wal_autocheckpoint=64')
            with self._db:
                self._db.execute('''CREATE TABLE IF NOT EXISTS entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, run TEXT NOT NULL,
                    token INTEGER NOT NULL, status TEXT NOT NULL, acked INTEGER NOT NULL DEFAULT 0,
                    charge INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(run, token))''')
                self._db.execute('CREATE INDEX IF NOT EXISTS delivery ON entries(status, acked, id)')
                self._db.execute('PRAGMA user_version=1')
            self.max_entries, self.max_bytes = max_entries, max_bytes
            self.max_result_bytes = max_result_bytes
            self.run_id, self._attached = str(uuid.uuid4()), False
            self._closed = False
            self.recovered = self._recover()
            self._count, self._bytes = self._query('SELECT COUNT(*), COALESCE(SUM(charge),0) FROM entries')[0]
        except Exception:
            if self._db is not None:
                self._db.close()
            os.close(self._lock)
            raise

    @staticmethod
    def _private(path, directory=False):
        info = path.lstat()
        valid = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1
        if not valid or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise JournalError('Journal paths must be private, owner-owned and not symlinks')

    def _query(self, sql, params=()):
        if self._closed:
            raise JournalError('Journal is closed')
        try:
            return self._db.execute(sql, params).fetchall()
        except sqlite3.Error as exc:
            raise JournalError('Journal query failed') from exc

    def _write(self, sql, rows):
        if self._closed:
            raise JournalError('Journal is closed')
        try:
            with self._db:
                self._db.executemany(sql, rows)
        except sqlite3.Error as exc:
            raise JournalError('Journal commit failed; stop dispatch and preserve the directory') from exc

    def _recover(self):
        rows = self._query("SELECT id,body FROM entries WHERE status='dispatched'")
        updates = []
        for receipt_id, raw in rows:
            body = json.loads(raw)
            body.update(status='failed', result=None, processor=None,
                        error='parent-interrupted', finished_ns=time.time_ns())
            updates.append((_json(body), 2048, receipt_id))
        self._write("UPDATE entries SET body=?,charge=?,status='failed' WHERE id=?", updates)
        return len(updates)

    def attach(self, slots, result_limit):
        if self._closed or self._attached:
            raise JournalError('Use one worker adapter per open journal run')
        if slots > self.max_entries or slots*(self.max_result_bytes+2048) > self.max_bytes:
            raise ValueError('Journal must reserve every worker slot')
        if result_limit > self.max_result_bytes:
            raise ValueError('Journal result bound must cover the worker result bound')
        self._attached = True

    def can_reserve(self, count):
        if self._closed:
            raise JournalError('Journal is closed')
        return (self._count+count <= self.max_entries and
                self._bytes+count*(self.max_result_bytes+2048) <= self.max_bytes)

    def reserve(self, works, generation):
        """Commit the entire dispatch batch before any member may enter IPC."""
        works = tuple(works)
        if not works:
            return
        if not self.can_reserve(len(works)):
            raise JournalError('Journal reservation capacity exhausted')
        rows = []
        for work in works:
            sample = work.sample
            body = dict(run_id=self.run_id, token=work.token, camera=sample.camera,
                        sequence=sample.sequence, generation=generation,
                        captured_at=sample.captured_at, dispatched_at=work.dispatched_at,
                        payload_bytes=len(sample.payload), payload_sha256=hashlib.sha256(sample.payload).hexdigest(),
                        status='dispatched', reserved_ns=time.time_ns())
            rows.append((self.run_id, work.token, self.max_result_bytes+2048, _json(body)))
        self._write("INSERT INTO entries(run,token,charge,body,status) VALUES(?,?,?,?,'dispatched')", rows)
        self._count += len(rows)
        self._bytes += len(rows)*(self.max_result_bytes+2048)

    def finish(self, token, *, result, error, processor):
        rows = self._query('SELECT id,status,body,charge FROM entries WHERE run=? AND token=?', (self.run_id, token))
        if not rows or rows[0][1] != 'dispatched':
            raise JournalError('Unknown or already terminal journal token')
        receipt_id, _, raw, previous_charge = rows[0]
        try:
            encoded = _json(result)
        except (TypeError, ValueError, RecursionError) as exc:
            raise JournalError('Result must be finite JSON') from exc
        if len(encoded.encode()) > self.max_result_bytes:
            raise JournalError('Result exceeds its reserved byte bound')
        body = json.loads(raw)
        body.update(status='succeeded' if error is None else 'failed', result=result,
                    error=None if error is None else str(error)[:80], processor=processor,
                    finished_ns=time.time_ns())
        charge = len(encoded.encode())+2048
        self._write('UPDATE entries SET status=?,body=?,charge=? WHERE id=?',
                    [(body['status'], _json(body), charge, receipt_id)])
        self._bytes += charge-previous_charge
        return receipt_id

    def pending(self, limit=100):
        """Read terminal unacknowledged rows in stable ID order; never acknowledges."""
        if not integer(limit, 1, 1000):
            raise ValueError('Delivery limit must be 1–1000')
        return [dict(json.loads(body), id=receipt_id) for receipt_id, body in self._query(
            "SELECT id,body FROM entries WHERE status!='dispatched' AND acked=0 ORDER BY id LIMIT ?", (limit,))]

    def acknowledge(self, receipt_ids):
        ids = tuple(receipt_ids)
        if not 1 <= len(ids) <= 1000 or any(not integer(i, 1, 2**63-1) for i in ids):
            raise ValueError('Acknowledge 1–1000 explicit positive journal IDs')
        # Validate the whole batch before modifying it; repeated acknowledgments are harmless.
        for i in ids:
            rows = self._query('SELECT status FROM entries WHERE id=?', (i,))
            if not rows or rows[0][0] == 'dispatched':
                raise JournalError('Cannot acknowledge missing or nonterminal work')
        self._write('UPDATE entries SET acked=1 WHERE id=?', [(i,) for i in ids])

    def prune(self):
        """Explicitly remove acknowledged terminal rows; never erase unread outcomes."""
        count, size = self._query('SELECT COUNT(*),COALESCE(SUM(charge),0) FROM entries WHERE acked=1')[0]
        self._write('DELETE FROM entries WHERE acked=1', [()])
        self._count -= count
        self._bytes -= size
        return count

    def snapshot(self):
        counts = dict(self._query('SELECT status,COUNT(*) FROM entries GROUP BY status'))
        unread = self._query("SELECT COUNT(*) FROM entries WHERE status!='dispatched' AND acked=0")[0][0]
        return dict(run_id=self.run_id, entries=self._count, reserved_bytes=self._bytes,
                    max_entries=self.max_entries, max_bytes=self.max_bytes,
                    recovered_interrupted=self.recovered, unacknowledged=unread, states=counts)

    def close(self):
        if self._closed:
            return
        self._closed = True
        try:
            self._db.close()
        finally:
            os.close(self._lock)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
