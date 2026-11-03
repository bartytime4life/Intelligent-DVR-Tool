"""Owner-triggered local camera setup. Saving never connects or starts recording."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading

from .backup_library import LibraryError, atomic_private_json
from .evaluation import read_json
from .fileops import sync_directory
from .local_feeds import validate_sources
from .recording_import import folder_lock


class CameraSetup:
    def __init__(self, feeds, path):
        self.feeds, self.path = feeds, Path(path).absolute()
        self.lock = threading.RLock()

    def available(self):
        return {'enabled': True, 'sources': [{'id': s['id'], 'name': s['name']} for s in self.feeds.sources.values()
                                              if s.get('kind', 'rtsp') == 'rtsp'], 'limit': 100}

    def add(self, body):
        if not isinstance(body, dict) or set(body) != {'name', 'host', 'port', 'path', 'username', 'password'}:
            raise LibraryError('CAMERA', 'Enter the camera name, private LAN address, port, channel path and viewer login.')
        with self.lock, self.feeds.lock, folder_lock(self.path.parent):
            if self.path.is_symlink():
                raise LibraryError('CAMERA', 'The local camera configuration cannot be a symbolic link.')
            original = read_json(self.path, 64 * 1024) if self.path.exists() else {'sources': []}
            # Re-read and preserve manually configured sources, including public sources.
            sources = validate_sources(original)
            if len(sources) >= 100:
                raise LibraryError('CAMERA_FULL', '100 sources are configured. Remove an unused source locally first.', 409)
            item = {**body, 'id': 'camera-' + secrets.token_hex(6)}
            data = {'sources': [*original['sources'], item]}
            try:
                validated = validate_sources(data)
            except (ValueError, TypeError) as exc:
                raise LibraryError('CAMERA', str(exc)) from None
            if len(json.dumps(data).encode()) > 64 * 1024:
                raise LibraryError('CAMERA_FULL', 'The camera configuration reached its size limit.', 409)
            # atomic_private_json uses a private file; credentials are never logged or returned.
            atomic_private_json(self.path, data)
            os.chmod(self.path, 0o600)
            sync_directory(self.path.parent)
            self.feeds.sources.update(validated)
            return {**self.available(), 'created': {'id': item['id'], 'name': item['name']}}


def pick_folder():
    """A native dialog only after Choose folder. Tk is optional; text input always works."""
    script = ('import tkinter as t; from tkinter import filedialog; import json; '
              'r=t.Tk(); r.withdraw(); r.attributes("-topmost",True); '
              'p=filedialog.askdirectory(title="Choose a DVR recording or backup folder",mustexist=True); '
              'print(json.dumps({"path":p or None})); r.destroy()')
    try:
        result = subprocess.run([sys.executable, '-c', script], stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=120, check=True)
        if len(result.stdout) > 8192: raise ValueError('oversized path')
        value = json.loads(result.stdout)
        if value.get('path') is not None and not isinstance(value['path'], str): raise ValueError('path')
        return value
    except (OSError, ValueError, subprocess.SubprocessError):
        raise LibraryError('FOLDER_PICKER', 'The folder chooser is unavailable. Paste the folder path from your file manager.') from None
