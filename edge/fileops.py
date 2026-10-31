"""Atomic replacement that tolerates brief Windows sharing violations, plus
non-blocking regular-file opens and directory sync."""
import os
import stat
import sys
import time

ATTEMPTS = 10  # Nine bounded pauses: 0.45 s in total before giving up.


def replace(source, target, *, best_effort=False):
    """os.replace, retrying PermissionError (WinError 5/32 while the service, an
    indexer or antivirus briefly holds the target open). Re-raises after the
    bounded retries; best_effort returns False instead so a worker skips one
    preview/progress update rather than exiting."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            os.replace(source, target)
            return True
        except PermissionError:
            if attempt == ATTEMPTS:
                if best_effort:
                    return False
                raise
            time.sleep(.01 * attempt)


def sync_directory(path):
    """Persist completed renames in a directory on POSIX; Windows has no directory fsync."""
    if sys.platform == 'win32':
        return
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def open_regular(path):
    """Open for binary reading without following a final symlink or blocking on a
    FIFO/device swapped in after an earlier check; anything else is ValueError."""
    nonblocking = getattr(os, 'O_NONBLOCK', 0)
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | nonblocking)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('Not a regular file')
        if nonblocking:
            os.set_blocking(fd, True)
        return os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise
