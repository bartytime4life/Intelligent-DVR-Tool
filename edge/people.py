"""Consent-based face templates saved on this computer, one private file per person.

Files are 0600 in a 0700 folder beside the analysis catalog. The browser receives
names, view counts and baselines only, never embeddings. Delete overwrites, then
removes the file.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets

from .faces import DUPLICATE, MAX_TEMPLATES

SCHEMA = 'intelligent-dvr.person-template.v1'
CONSENT_STATEMENT = 'local-face-template-v1'
PEOPLE_LIMIT = 50
PERSON_ID = re.compile(r'[a-f0-9]{16}')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def append_view(templates, vector, limit=MAX_TEMPLATES):
    """Add one confirmed view unless it repeats a kept one; the oldest views give way when full."""
    if any(sum(a * b for a, b in zip(kept, vector)) >= DUPLICATE for kept in templates):
        return list(templates), False
    return (list(templates) + [list(vector)])[-limit:], True


def valid_name(value):
    return isinstance(value, str) and 1 <= len(value.strip()) <= 60 and value.strip().isprintable()


class PeopleStore:
    def __init__(self, directory, models):
        self.directory, self.models = Path(directory), models
        if self.directory.is_symlink():
            raise ValueError('The people folder cannot be a symlink')

    def path(self, person_id):
        if not isinstance(person_id, str) or not PERSON_ID.fullmatch(person_id):
            raise KeyError(person_id)
        return self.directory / f'{person_id}.json'

    def records(self):
        if not self.directory.is_dir():
            return []
        found = []
        for path in sorted(self.directory.iterdir())[:1000]:
            if path.suffix != '.json' or not PERSON_ID.fullmatch(path.stem) or path.is_symlink():
                continue
            try:
                record = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue  # A damaged file stays for the owner to inspect; it is never matched.
            if record.get('schema') == SCHEMA and record.get('id') == path.stem and record.get('models') == self.models:
                found.append(record)
        return found[:PEOPLE_LIMIT]

    @staticmethod
    def summary(record):
        return {'id': record['id'], 'name': record['name'], 'created': record['created'],
                'views': len(record['embeddings']), 'baseline': record.get('baseline')}

    def get(self, person_id):
        path = self.path(person_id)
        record = json.loads(path.read_text(encoding='utf-8'))
        if record.get('schema') != SCHEMA or record.get('id') != person_id:
            raise KeyError(person_id)
        return record

    def write(self, record, *, new=False):
        self.directory.mkdir(mode=0o700, exist_ok=True)
        os.chmod(self.directory, 0o700)
        path = self.path(record['id'])
        data = json.dumps(record).encode()
        if new:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        else:
            temporary = path.with_suffix('.tmp')
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if not new:
            os.replace(temporary, path)
        return record

    def create(self, name, embeddings):
        if len(self.records()) >= PEOPLE_LIMIT:
            raise OverflowError('people')
        record = {'schema': SCHEMA, 'id': secrets.token_hex(8), 'name': name.strip(), 'created': now(),
                  'consent': {'statement': CONSENT_STATEMENT, 'confirmed_at': now()},
                  'models': self.models, 'embeddings': embeddings, 'baseline': None}
        return self.write(record, new=True)

    def delete(self, person_id):
        path = self.path(person_id)
        size = path.stat().st_size
        with open(path, 'r+b') as stream:  # Overwrite before removal; filesystems may still keep old blocks.
            stream.write(b'\0' * size)
            stream.flush()
            os.fsync(stream.fileno())
        path.unlink()
