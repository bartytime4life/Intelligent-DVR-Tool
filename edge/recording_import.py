"""Bounded, explicit same-computer recording imports. No network clients here."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import time

MAX_IMPORT_BYTES = 64 * 1024**2
MAX_INBOX_BYTES = 512 * 1024**2
MAX_INBOX_FILES = 20
MIMES = {'video/webm': '.webm', 'video/mp4': '.mp4',
         'video/x-msvideo': '.avi', 'video/x-matroska': '.mkv'}


class ImportError(ValueError):
    pass


def usage(folder):
    count = size = 0
    with os.scandir(folder) as entries:
        for index, entry in enumerate(entries):
            if index >= 1000:
                raise ImportError('Recording folder has too many entries. Move older files before importing.')
            if not (entry.name.startswith('import-') or entry.name.startswith('.dvr-import-')):
                continue
            info = entry.stat(follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                raise ImportError('The recording inbox contains an unsafe entry. Inspect it locally.')
            count += 1
            size += info.st_size
    return count, size


def import_recording(folder, stream, length, mime, expected_hash, *, clock=time.monotonic):
    """Serialize imports even across service processes sharing a recording folder."""
    folder = Path(folder).absolute()
    if not folder.is_dir() or any(p.is_symlink() for p in (folder, *folder.parents)):
        raise ImportError('Use a regular local recording folder without links.')
    lock = folder / '.dvr-import.lock'
    try:
        fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise ImportError('Another import owns this recording folder. Retry after it finishes. After a crash, stop all services and inspect .dvr-import.lock before removing it.') from None
    try:
        os.close(fd)
        return _import_recording(folder, stream, length, mime, expected_hash, clock=clock)
    finally:
        lock.unlink()


def _import_recording(folder, stream, length, mime, expected_hash, *, clock):
    """Hash before publishing; no caller paths, filenames, overwrites or decoding."""
    if type(length) is not int or not 16 <= length <= MAX_IMPORT_BYTES or mime not in MIMES:
        raise ImportError('Import a WebM, MP4, AVI or MKV recording up to 64 MiB.')
    if not isinstance(expected_hash, str) or not re.fullmatch('[a-f0-9]{64}', expected_hash):
        raise ImportError('A recording SHA-256 is required. Choose the file again.')
    destination = folder / ('import-' + expected_hash + MIMES[mime])
    # Idempotent retry after a lost response; never replace existing content.
    if destination.exists() or destination.is_symlink():
        info = destination.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size != length:
            raise ImportError('An existing import conflicts with this file. Inspect the recording folder.')
        with destination.open('rb') as existing:
            if hashlib.file_digest(existing, 'sha256').hexdigest() != expected_hash:
                raise ImportError('An existing import changed. Inspect the recording folder.')
        return destination, True
    count, size = usage(folder)
    if count >= MAX_INBOX_FILES or size + length > MAX_INBOX_BYTES:
        raise ImportError('Recording inbox is full (20 files / 512 MiB). Export or move older imports locally first.')
    if shutil.disk_usage(folder).free < length + MAX_IMPORT_BYTES:
        raise ImportError('Not enough free disk space for this recording and a 64 MiB reserve.')
    began = clock()
    temp = None
    try:
        fd, name = tempfile.mkstemp(prefix='.dvr-import-', suffix='.part', dir=folder)
        temp = Path(name)
        digest, remaining, header = hashlib.sha256(), length, b''
        with os.fdopen(fd, 'wb') as output:
            while remaining:
                if clock() - began > 30:
                    raise ImportError('Recording import timed out. Reconnect and retry the same file.')
                block = stream.read(min(256 * 1024, remaining))
                if not block:
                    raise ImportError('Recording transfer was interrupted. Retry the same file.')
                header = (header + block)[:16] if len(header) < 16 else header
                remaining -= len(block)
                output.write(block)
                digest.update(block)
            if digest.hexdigest() != expected_hash:
                raise ImportError('Recording fingerprint changed during import. Choose the file again.')
            valid = ((mime in ('video/webm', 'video/x-matroska') and header[:4] == b'\x1aE\xdf\xa3') or
                     (mime == 'video/mp4' and header[4:8] == b'ftyp') or
                     (mime == 'video/x-msvideo' and header[:4] == b'RIFF' and header[8:12] == b'AVI '))
            if not valid:
                raise ImportError('This file does not have the selected video container header. Playlists and text are refused.')
            output.flush()
            os.fsync(output.fileno())
        # Same-filesystem hard link publishes the complete file exclusively on
        # Linux and Windows. A racing existing target can never be overwritten.
        os.link(temp, destination)
        return destination, False
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)
