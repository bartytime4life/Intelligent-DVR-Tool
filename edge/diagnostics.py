"""Opt-in local diagnostic log: event codes, opaque hex ids and numbers only.

Lives in <state-dir>/diagnostics and rotates at 1 MiB across three owner-only files.
Any other value is written as REDACTED, so paths, URLs, credentials, addresses,
host/user/file names and native messages cannot reach the log. Without a state
directory it is off. Logging never raises into the service.
"""
import contextlib
from itertools import islice
import os
from pathlib import Path
import re
import stat
import sys
import threading
import time

LIMIT = 1024**2
NAMES = ('service.log', 'service.log.1', 'service.log.2')
CODE = re.compile(r'[A-Z][A-Z0-9_]{0,63}')
VALUE = re.compile(r'[A-Z][A-Z0-9_]{0,63}|[a-f0-9]{8,64}')


def private(path, directory=False):
    info = path.lstat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
        raise ValueError('Diagnostic log entries must be ordinary files and directories')
    if sys.platform == 'linux' and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise ValueError('Diagnostic log must be private to its owner')


def check(directory):
    """Validate an existing log folder (result-store inspection); never creates files."""
    private(directory, True)
    for entry in islice(directory.iterdir(), len(NAMES) + 1):
        if entry.name not in NAMES:
            raise ValueError('Unexpected diagnostic log file')
        private(entry)
        if entry.stat().st_size > LIMIT:
            raise ValueError('Oversized diagnostic log')


def token(value):
    if isinstance(value, bool):
        return str(int(value))
    if isinstance(value, (int, float)) and value == value and abs(value) < 1e15:
        return str(round(value, 3))
    return value if isinstance(value, str) and VALUE.fullmatch(value) else 'REDACTED'


class Diagnostics:
    def __init__(self, directory=None):
        self.directory, self.lock = directory and Path(directory), threading.Lock()
        if self.directory:
            self.directory.mkdir(mode=0o700, exist_ok=True)
            check(self.directory)

    def event(self, name, /, **fields):
        if not self.directory:
            return
        line = ' '.join([str(int(time.time())), name if CODE.fullmatch(name) else 'INVALID_EVENT'] +
                        [f'{key}={token(value)}' for key, value in fields.items()
                         if value is not None and re.fullmatch('[a-z_]{1,32}', key)])[:1024] + '\n'
        with self.lock, contextlib.suppress(OSError):
            current = self.directory / NAMES[0]
            try:
                size = current.lstat().st_size
            except FileNotFoundError:
                size = 0
            if size + len(line) > LIMIT:
                for older, newer in zip(reversed(NAMES[1:]), reversed(NAMES[:-1])):
                    if (self.directory / newer).exists():
                        os.replace(self.directory / newer, self.directory / older)
            fd = os.open(current, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            try:
                os.write(fd, line.encode('ascii', 'replace'))
            finally:
                os.close(fd)
