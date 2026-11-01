"""Explicit loopback jobs and previews; bounded recording import is opt-in."""
import argparse
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import ipaddress
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
import tempfile
import threading
import time
from urllib.parse import urlsplit, unquote

from .diagnostics import Diagnostics
from .evaluation import anchor, local_file, read_json, relative_file
from . import failures
from .fileops import open_regular
from .model_profiles import validate_binding
from .rules import Rule, RuleEngine
from .local_feeds import Feeds, FeedError, load_sources, shared_config
from .result_store import ResultStore, VIDEO_BYTES, REVIEW_BYTES as RESULT_BYTES, EXTENSIONS
from .recording_import import import_recording, ImportError as RecordingImportError, MAX_IMPORT_BYTES, MIMES as IMPORT_MIMES
from .enhancement import PROFILE as ENHANCEMENT_PROFILE, validate_trace as validate_enhancement
from .faces import DETECTOR as FACE_DETECTOR, RECOGNIZER as FACE_RECOGNIZER, EMBEDDING, verify_model
from .people import PeopleStore, CONSENT_STATEMENT, PEOPLE_LIMIT, append_view, valid_name, now as utc_now
from .media_coverage import validate as validate_coverage

ROOT = Path(__file__).resolve().parents[1]
MODEL_BYTES = VIDEO_BYTES
LIMITS = {'video_bytes': VIDEO_BYTES, 'wall_seconds': 300, 'max_frames': 6000,
          'stride': 5, 'threads': 2, 'active_jobs': 1, 'memory_bytes': 4 * 1024**3}
TERMINAL = {'completed', 'failed', 'cancelled'}
# Guided training may add tuned rule sets; nothing else from the browser writes rules or models.
TRAINED_LIMIT = 50
TRAINED_NAME = re.compile(r'(trained-[a-f0-9]{12})\.rules\.json')
TRAINING_KEYS = {'name', 'label', 'threshold', 'dwell', 'max_gap', 'rect'}
# Consent-based enrollment: a bounded worker per request, at least five distinct clear views.
FACE_SECONDS, FACE_MIN_VIEWS = 120, 5
# Match suggestions look inside person boxes scoring at least this much, within these bounds.
IDENTIFY_SCORE, IDENTIFY_BOXES, IDENTIFY_FRAMES = 0.3, 10, 1200
FACE_TIPS = {'none': 'No face was found in many frames: face the camera.',
             'several': 'More than one face was in view: only the person enrolling should be visible.',
             'small': 'The face was small: move closer.', 'unclear': 'The face was unclear: face the camera directly.',
             'edge': 'The face was cut off: stay inside the oval.', 'dark': 'It was too dark: add light in front of the face.',
             'bright': 'It was too bright: avoid a window behind the person.',
             'blurry': 'Frames were blurry: hold still for a moment at each prompt.'}


def face_tip(reasons):
    """The most common rejection reason as one fixed sentence."""
    counts = {k: reasons.get(k) for k in FACE_TIPS} if isinstance(reasons, dict) else {}
    counts = {k: v for k, v in counts.items() if isinstance(v, int) and not isinstance(v, bool) and v > 0}
    return FACE_TIPS[max(counts, key=counts.get)] if counts else ''
# Fixed types: mimetypes reads Windows registry overrides (e.g. .js as text/plain),
# which nosniff then turns into a blank module-script UI.
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
         '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
         '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
         '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
         '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.m4v': 'video/mp4',
         '.mov': 'video/quicktime', '.avi': 'video/x-msvideo'}


def content_type(path):
    return TYPES.get(Path(path).suffix.lower(), 'application/octet-stream')


def _endpoint(text):
    # /proc/net/tcp{,6}: 32-bit words of the address in host byte order, hex port.
    address, port = text.split(':')
    ip = ipaddress.ip_address(b''.join(int(address[i:i + 8], 16).to_bytes(4, sys.byteorder) for i in range(0, len(address), 8)))
    return str(getattr(ip, 'ipv4_mapped', None) or ip), int(port, 16)


def peer_uid(client, port, tables=('/proc/net/tcp', '/proc/net/tcp6')):
    """Linux UID owning the client end of a loopback connection to port, or None
    when no live entry is visible (callers fail closed). A dual-stack client socket
    appears in tcp6 as an IPv4-mapped address."""
    wanted, suffixes = ((client[0], client[1]), ('127.0.0.1', port)), (':%04X' % client[1], ':%04X' % port)
    for table in tables:
        try:
            with open(table, encoding='ascii') as rows:
                next(rows, None)
                for row in rows:
                    fields = row.split()
                    if (len(fields) > 7 and fields[1].endswith(suffixes[0]) and fields[2].endswith(suffixes[1]) and
                            (_endpoint(fields[1]), _endpoint(fields[2])) == wanted):
                        return int(fields[7])
        except OSError:
            continue  # e.g. IPv6 disabled; nothing visible means refusal.
    return None


class Upload:
    """A request body bounded by its Content-Length; tracks what is still unread."""
    def __init__(self, stream, length):
        self.stream, self.remaining = stream, length

    def read(self, size=-1):
        size = self.remaining if size is None or size < 0 else min(size, self.remaining)
        block = self.stream.read(size) if size > 0 else b''
        self.remaining -= len(block)
        return block


class JobError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def regular(path, limit):
    path = local_file(path)
    if not 0 < path.stat().st_size <= limit:
        raise ValueError('Empty or oversized local file')
    return path


def signature(st):
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns


def video_header(header):
    return ((header[:4] == b'RIFF' and header[8:12] == b'AVI ') or
            header[:4] == b'\x1aE\xdf\xa3' or header[4:8] == b'ftyp')


def load_catalog(config):
    data = read_json(config, 64 * 1024)
    if not isinstance(data, dict) or not {'models', 'rules'} <= set(data) <= {'models', 'rules', 'faces'}:
        raise ValueError('Configure models and rules arrays')
    result = {}
    if 'faces' in data:
        # Optional: the pinned face detector and recognizer for consent-based enrollment.
        faces = data['faces']
        if not isinstance(faces, dict) or set(faces) != {'detector', 'recognizer'}:
            raise ValueError('Configure faces with detector and recognizer paths')
        result['faces'] = {key: verify_model(regular(relative_file(config.parent, faces[key]), MODEL_BYTES), spec)
                           for key, spec in (('detector', FACE_DETECTOR), ('recognizer', FACE_RECOGNIZER))}
    for kind in ('models', 'rules'):
        entries = data[kind]
        if not isinstance(entries, list) or not 1 <= len(entries) <= 16:
            raise ValueError('Configure 1–16 entries per catalog')
        result[kind] = {}
        for entry in entries:
            if not isinstance(entry, dict) or not re.fullmatch(r'[a-z0-9-]{1,40}', entry.get('id', '')) or entry['id'] in result[kind]:
                raise ValueError('Use unique catalog IDs')
            if not isinstance(entry.get('name'), str) or not 1 <= len(entry['name']) <= 80:
                raise ValueError('Use catalog names up to 80 characters')
            item = dict(entry)
            item['path'] = regular(relative_file(config.parent, entry['path']), MODEL_BYTES if kind == 'models' else 64 * 1024)
            if kind == 'models':
                item['labels'] = regular(relative_file(config.parent, entry['labels']), 64 * 1024)
                labels = read_json(item['labels'], 64 * 1024)
                item['labels_sha256'] = hashlib.sha256(item['labels'].read_bytes()).hexdigest()
                sha = entry.get('sha256', '')
                if not re.fullmatch('[a-f0-9]{64}', sha):
                    raise ValueError('Model SHA-256 must be explicitly pinned')
                validate_binding(entry['profile'], sha, labels)
                item['classes'] = labels
            else:
                item = rules_item(item)
            result[kind][entry['id']] = item
    return result


def rules_item(item):
    """Validate a rule-set file with the analyzer's own rule engine and describe it."""
    rules = read_json(item['path'], 64 * 1024)
    item['sha256'] = hashlib.sha256(item['path'].read_bytes()).hexdigest()
    if not isinstance(rules, list) or not 1 <= len(rules) <= 100:
        raise ValueError('Use 1–100 rules')
    parsed = [Rule(**rule) for rule in rules]
    RuleEngine(parsed)
    item['classes'] = sorted({rule.label for rule in parsed})
    item['summary'] = [f'{r.label} ≥ {r.threshold:g}; {r.dwell:g}s in {r.name}' for r in parsed]
    return item


def load_trained(directory):
    """Rule sets saved by guided training: <catalog folder>/trained, regular files only."""
    entries = {}
    if not directory.is_dir() or directory.is_symlink():
        return entries
    for path in sorted(directory.iterdir())[:1000]:
        match = TRAINED_NAME.fullmatch(path.name)
        if not match or len(entries) == TRAINED_LIMIT:
            continue
        try:
            item = rules_item({'id': match[1], 'path': regular(path, 64 * 1024)})
            item['name'] = read_json(path, 64 * 1024)[0]['name'][:80]
        except (OSError, ValueError, TypeError, KeyError, IndexError):
            continue  # A damaged file stays on disk for the owner to inspect; it is never offered.
        entries[match[1]] = item
    return entries


class Jobs:
    def __init__(self, recordings, catalog, *, wall_seconds=300, process_factory=subprocess.Popen, state_dir=None, allow_import=False,
                 training_dir=None, people_dir=None, face_runner=None):
        # Resolved once (OS links above it are fine); the folder and its entries are not links.
        recordings = anchor(recordings)
        if not recordings.is_dir() or recordings.is_symlink():
            raise ValueError('Select a regular local recordings directory without symlinks')
        self.recordings, self.catalog = recordings, catalog
        self.allow_import = allow_import
        self.training_dir = training_dir
        if training_dir is not None:
            catalog['rules'].update(load_trained(training_dir))
        if people_dir is not None and 'faces' not in catalog:
            raise ValueError('Face enrollment needs the pinned face detector and recognizer in the catalog')
        self.people = PeopleStore(people_dir, {'detector': FACE_DETECTOR['sha256'], 'recognizer': FACE_RECOGNIZER['sha256']}) \
            if people_dir is not None else None
        self.face_runner, self.face_busy = face_runner or self.run_face_worker, False
        self.suggestions = None  # Last match suggestions: {'job', 'views': {(frame, box): {person, embedding}}}
        self.wall_seconds = min(300, max(.1, wall_seconds))
        self.process_factory = process_factory
        self.lock = threading.RLock()
        self.cancel_event = threading.Event()
        self.job = self.thread = self.process = self.directory = None
        self.choices = {}
        self.closed = False
        self.owner = None
        self.managed = False
        self.importing = False
        self.token = secrets.token_urlsafe(32)
        self.store = ResultStore(state_dir) if state_dir is not None else None
        # Codes/ids only, inside the validated private store; off without --state-dir.
        self.diagnostics = Diagnostics(self.store.directory / 'diagnostics' if self.store else None)
        self.store_failed = False
        self.retained_directory = None
        self.model_cache = None  # (path, sha256, file signature) verified for the current owner's session
        if self.store:
            self.job, self.retained_directory = self.store.job, self.store.job_directory

    def available(self):
        with self.lock:
            # Do not recursively scan disks or return filesystem paths.
            choices = {}
            with os.scandir(self.recordings) as entries:
                for entry in itertools.islice(entries, 1000):
                    path = self.recordings / entry.name
                    if path.suffix.lower() not in EXTENSIONS or len(entry.name) > 160:
                        continue
                    try:
                        regular(path, VIDEO_BYTES)
                        sig = signature(path.stat())
                    except (OSError, ValueError):
                        continue
                    key = hashlib.sha256((entry.name + repr(sig)).encode()).hexdigest()[:32]
                    choices[key] = (path, sig)
                    if len(choices) == 200:
                        break
            self.choices = choices
            models = [{k: item[k] for k in ('id', 'name', 'profile')} for item in self.catalog['models'].values()]
            rules = [self.rule_choice(item) for item in self.catalog['rules'].values()]
            return {'recordings': [{'id': key, 'name': p.name, 'bytes': sig[2]} for key, (p, sig) in choices.items()],
                    'models': models, 'rules': rules, 'limits': LIMITS,
                    'enhancement_comparisons': [ENHANCEMENT_PROFILE],
                    'backend': 'opencv-cpu', 'job': None if self.managed else self.snapshot(),
                    'recorder_active': self.owner is not None,
                    'recording_import': {'enabled': self.allow_import, 'max_bytes': MAX_IMPORT_BYTES},
                    'training': {'enabled': self.training_dir is not None, 'limit': TRAINED_LIMIT},
                    'people': {'enabled': self.people is not None, 'statement': CONSENT_STATEMENT, 'limit': PEOPLE_LIMIT},
                    'retention': 'private-local-last-job' if self.store else 'temporary-until-service-exit',
                    'ready': all(importlib.util.find_spec(x) is not None for x in ('cv2', 'numpy', 'av'))}

    def rule_choice(self, item):
        return {**{k: item[k] for k in ('id', 'name', 'summary')},
                'models': [m['id'] for m in self.catalog['models'].values() if set(item['classes']) <= set(m['classes'])]}

    def save_training_rules(self, body):
        """Save one tuned rule as a new rule set. Fixed fields only; files are never overwritten."""
        def number(value):
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        with self.lock:
            if self.training_dir is None:
                raise JobError('TRAINING_DISABLED', 'Restart the local app with --allow-training to save trained settings.', 403)
            if (not isinstance(body, dict) or not {'name', 'label', 'threshold'} <= set(body) <= TRAINING_KEYS
                    or not isinstance(body['name'], str) or not 1 <= len(body['name'].strip()) <= 60
                    or not body['name'].isprintable() or not isinstance(body['label'], str)
                    or not all(number(body[k]) for k in ('threshold', 'dwell', 'max_gap') if k in body)
                    or ('rect' in body and (not isinstance(body['rect'], list) or len(body['rect']) != 4
                                            or not all(number(v) for v in body['rect'])))):
                raise JobError('TRAINING_RULE', 'Send a rule name, a detected class and numeric settings.')
            if not any(body['label'] in model['classes'] for model in self.catalog['models'].values()):
                raise JobError('TRAINING_RULE', 'Choose a class that a configured model detects.')
            rule = {'name': body['name'].strip(), 'label': body['label'], 'rect': list(body.get('rect', [0, 0, 1, 1])),
                    'dwell': body.get('dwell', 1), 'threshold': body['threshold'], 'max_gap': body.get('max_gap', 2)}
            try:
                RuleEngine([Rule(**{**rule, 'rect': tuple(rule['rect'])})])
            except (TypeError, ValueError):
                raise JobError('TRAINING_RULE', 'Use a threshold of 0.1–1, a dwell of 0–3600 s and a gap of up to 60 s inside the frame.') from None
            data = (json.dumps([rule], indent=2) + '\n').encode()
            entry_id = 'trained-' + hashlib.sha256(data).hexdigest()[:12]
            if entry_id in self.catalog['rules']:
                return {'rule': self.rule_choice(self.catalog['rules'][entry_id]), 'created': False}
            if sum(key.startswith('trained-') for key in self.catalog['rules']) >= TRAINED_LIMIT:
                raise JobError('TRAINING_FULL', f'{TRAINED_LIMIT} trained rule sets are saved. Move older files out of the trained folder, then restart the local app.', 409)
            directory = self.training_dir
            try:
                if directory.is_symlink():
                    raise OSError('symlink')
                directory.mkdir(mode=0o700, exist_ok=True)
                path = directory / f'{entry_id}.rules.json'
                # O_EXCL: an existing file is never replaced, even one this service did not list.
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                item = rules_item({'id': entry_id, 'name': rule['name'], 'path': regular(path, 64 * 1024)})
            except FileExistsError:
                raise JobError('TRAINING_CONFLICT', 'A different file already uses this trained rule name. Inspect the trained folder, then restart the local app.', 409) from None
            except (OSError, ValueError):
                raise JobError('TRAINING_WRITE', 'The trained setting could not be saved. Check free space and folder permissions.', 500) from None
            self.catalog['rules'][entry_id] = item
            self.diagnostics.event('TRAINING_RULES_SAVED')
            return {'rule': self.rule_choice(item), 'created': True}

    def require_people(self):
        if self.people is None:
            raise JobError('PEOPLE_DISABLED', 'Restart the local app with --allow-face-enrollment and the pinned face models to enroll people.', 403)
        return self.people

    def people_list(self):
        store = self.require_people()
        return {'people': [store.summary(r) for r in store.records()], 'statement': CONSENT_STATEMENT, 'limit': PEOPLE_LIMIT}

    def run_face_worker(self, payload):
        with tempfile.TemporaryDirectory(prefix='intelligent-dvr-face-') as temp:
            directory = Path(temp)
            os.chmod(directory, 0o700)
            (directory / 'args.json').write_text(json.dumps(payload), encoding='utf-8')
            try:
                subprocess.run([sys.executable, '-m', 'edge.face_worker', str(directory)], cwd=ROOT, stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=FACE_SECONDS, check=False)
            except subprocess.TimeoutExpired:
                return {'error': 'FACE_TIMEOUT'}
            try:
                return read_json(directory / 'result.json', 4 * 1024**2)
            except (OSError, ValueError):
                return {'error': 'FACE_FAILED'}

    def face_job(self, recording, payload, *, path=None):
        """Run the bounded face worker on a listed recording (or a job's own source); no overlap with analysis or imports."""
        with self.lock:
            if self.closed or self.owner is not None or self.importing or self.face_busy or (self.job and self.job['state'] not in TERMINAL):
                raise JobError('BUSY', 'Wait for the current analysis, import or enrollment to finish, then retry.', 409)
            if path is None:
                if not isinstance(recording, str) or recording not in self.choices:
                    self.available()
                if not isinstance(recording, str) or recording not in self.choices:
                    raise JobError('SELECTION', 'Choose a listed recording.')
                path, sig = self.choices[recording]
                if signature(path.stat()) != sig:
                    raise JobError('INPUT_CHANGED', 'The recording changed. Refresh the choices and retry.', 409)
            self.face_busy = True
        try:
            result = self.face_runner({**payload, 'video': str(path), 'detector': str(self.catalog['faces']['detector']),
                                       'recognizer': str(self.catalog['faces']['recognizer'])})
        finally:
            with self.lock:
                self.face_busy = False
        if not isinstance(result, dict) or 'error' in result:
            code = result.get('error') if isinstance(result, dict) else None
            message = {'VIDEO_OPEN_FAILED': 'The recording could not be opened. Record again.',
                       'MODEL_LOAD_FAILED': 'The face models could not be loaded. Check the catalog files.',
                       'FACE_TIMEOUT': 'Face processing took too long. Record a shorter clip.'}.get(code, 'Face processing failed. Record again.')
            raise JobError(code if code in ('VIDEO_OPEN_FAILED', 'MODEL_LOAD_FAILED', 'FACE_TIMEOUT') else 'FACE_FAILED', message, 422)
        if payload['mode'] == 'identify':
            return result
        vectors = result.get('embeddings')
        if (not isinstance(vectors, list) or len(vectors) > 40 or not all(isinstance(v, list) and len(v) == EMBEDDING and
                all(isinstance(x, float) and math.isfinite(x) for x in v) for v in vectors)):
            raise JobError('FACE_FAILED', 'Face processing returned an invalid result. Record again.', 422)
        return result

    def people_enroll(self, body):
        store = self.require_people()
        if (not isinstance(body, dict) or set(body) != {'name', 'consent', 'recording'} or not valid_name(body['name'])
                or body['consent'] != {'confirmed': True, 'statement': CONSENT_STATEMENT}):
            raise JobError('CONSENT', 'Enter the person’s name and confirm that they agree before enrolling.')
        result = self.face_job(body['recording'], {'mode': 'enroll'})
        if len(result['embeddings']) < FACE_MIN_VIEWS:
            raise JobError('FACE_QUALITY', f'Only {len(result["embeddings"])} clear face views were found; {FACE_MIN_VIEWS} are needed. '
                           f'{face_tip(result.get("reasons"))} Nothing was saved.', 422)
        try:
            record = store.create(body['name'], result['embeddings'])
        except OverflowError:
            raise JobError('PEOPLE_FULL', f'{PEOPLE_LIMIT} people are enrolled. Delete someone before adding another.', 409) from None
        self.diagnostics.event('PERSON_ENROLLED')
        return {'person': store.summary(record), 'checked': result['checked'], 'usable': result['usable']}

    def people_verify(self, person_id, body):
        store = self.require_people()
        if not isinstance(body, dict) or set(body) != {'recording'} or not isinstance(body['recording'], str):
            raise JobError('SELECTION', 'Choose a recording to check.')
        try:
            record = store.get(person_id)
        except (KeyError, OSError, ValueError):
            raise JobError('NOT_FOUND', 'This person is no longer enrolled.', 404) from None
        people = [{'id': r['id'], 'embeddings': r['embeddings']} for r in store.records()]
        result = self.face_job(body['recording'], {'mode': 'verify', 'people': people, 'target': person_id})
        usable, matched = result['usable'], result['matched']
        with self.lock:
            # Re-read under the deletion lock: a person deleted during the check is never written back.
            try:
                record = store.get(person_id)
            except (KeyError, OSError, ValueError):
                raise JobError('NOT_FOUND', 'This person was deleted during the check; nothing was saved.', 404) from None
            record['baseline'] = {'at': utc_now(), 'checked': result['checked'], 'usable': usable, 'matched': matched,
                                  'other': result['other'], 'rate': round(matched / usable, 4) if usable else None}
            if result['embeddings']:
                record['embeddings'] = result['embeddings']
            store.write(record)
        return {'person': store.summary(record), 'baseline': record['baseline'], 'tip': face_tip(result.get('reasons')) if not usable else ''}

    def people_identify(self, body):
        """Suggest enrolled people for faces inside a completed job's person boxes."""
        store = self.require_people()
        if not isinstance(body, dict) or set(body) != {'job'} or not isinstance(body['job'], str) or not re.fullmatch('[a-f0-9]{32}', body['job']):
            raise JobError('SELECTION', 'Choose a completed analysis.')
        records = store.records()
        if not records:
            raise JobError('NO_PEOPLE', 'Enroll someone in Train before checking for matches.', 409)
        with self.lock:
            result_path, _ = self.artifact(body['job'], 'result')
            source, _ = self.artifact(body['job'], 'source')
            review = read_json(result_path, RESULT_BYTES)
        frames = []
        for frame in review['trace']['frames']:
            boxes = [[i, d['box']] for i, d in enumerate(frame['detections']) if d.get('label') == 'person' and d.get('score', 0) >= IDENTIFY_SCORE]
            if boxes:
                frames.append({'frame_index': frame['frame_index'], 'boxes': boxes[:IDENTIFY_BOXES]})
        frames = frames[:IDENTIFY_FRAMES]
        if not frames:
            return {'job': body['job'], 'frames': 0, 'faces': 0, 'suggestions': []}
        names = {r['id']: r['name'] for r in records}
        result = self.face_job(None, {'mode': 'identify', 'frames': frames,
                                      'people': [{'id': r['id'], 'embeddings': r['embeddings']} for r in records]}, path=source)
        requested = {(f['frame_index'], index): box for f in frames for index, box in f['boxes']}
        matches = result.get('matches')
        if not isinstance(result.get('faces'), int) or not isinstance(matches, list) or len(matches) > 500 or not all(
                isinstance(m, dict) and (m.get('frame_index'), m.get('box_index')) in requested and m.get('person') in names
                and isinstance(m.get('similarity'), float) and -1 <= m['similarity'] <= 1 and isinstance(m.get('embedding'), list)
                and len(m['embedding']) == EMBEDDING and all(isinstance(x, float) and math.isfinite(x) for x in m['embedding'])
                for m in matches):
            raise JobError('FACE_FAILED', 'Face processing returned an invalid result. Check again.', 422)
        with self.lock:
            # Deletion holds this lock too: anyone deleted while the worker ran gets no suggestions back.
            current = {r['id']: r['name'] for r in store.records()}
            matches = [m for m in matches if m['person'] in current]
            views = {(m['frame_index'], m['box_index']): {'person': m['person'], 'embedding': m['embedding']} for m in matches}
            self.suggestions = {'job': body['job'], 'views': views}  # Embeddings stay here; the browser gets names.
        return {'job': body['job'], 'frames': len(frames), 'faces': result['faces'], 'suggestions': [
            {'frame_index': m['frame_index'], 'box_index': m['box_index'], 'box': requested[(m['frame_index'], m['box_index'])],
             'person': m['person'], 'name': current[m['person']], 'similarity': m['similarity']} for m in matches]}

    def people_confirm(self, person_id, body):
        """A reviewer confirmed a suggestion: that face view joins the person's template."""
        store = self.require_people()
        if (not isinstance(body, dict) or set(body) != {'job', 'frame_index', 'box_index'} or not isinstance(body['job'], str)
                or not all(isinstance(body[k], int) and not isinstance(body[k], bool) for k in ('frame_index', 'box_index'))):
            raise JobError('SELECTION', 'Choose a suggested match.')
        key = (body['frame_index'], body['box_index'])
        with self.lock:
            suggestions = self.suggestions or {}
            view = suggestions['views'].get(key) if suggestions.get('job') == body['job'] else None
            if not view:
                raise JobError('NOT_FOUND', 'Check for enrolled people again, then confirm.', 404)
            if view['person'] != person_id:
                raise JobError('SELECTION', 'This suggestion is for someone else.')
            try:
                record = store.get(person_id)
            except (KeyError, OSError, ValueError):
                raise JobError('NOT_FOUND', 'This person is no longer enrolled.', 404) from None
            record['embeddings'], added = append_view(record['embeddings'], view['embedding'])
            store.write(record)
            suggestions['views'].pop(key)
        return {'person': store.summary(record), 'added': added}

    def people_delete(self, person_id, body):
        store = self.require_people()
        if body != {}:
            raise JobError('BODY', 'Delete takes an empty object.')
        with self.lock:  # Shared with identify, verify and confirm, so none can restore what this removes.
            try:
                store.delete(person_id)
            except (KeyError, OSError):
                raise JobError('NOT_FOUND', 'This person is no longer enrolled.', 404) from None
            if self.suggestions:  # Their pending suggestions go too.
                self.suggestions['views'] = {k: v for k, v in self.suggestions['views'].items() if v['person'] != person_id}
        self.diagnostics.event('PERSON_DELETED')
        return {'deleted': person_id}

    def receive_recording(self, stream, length, mime, expected_hash):
        with self.lock:
            if not self.allow_import:
                raise JobError('IMPORT_DISABLED', 'Restart the local app with --allow-recording-import to save selected recordings here.', 403)
            if self.closed or self.owner is not None or (self.job and self.job['state'] not in TERMINAL):
                raise JobError('BUSY', 'Wait for the current analysis to finish before importing a recording.', 409)
            if self.importing:
                raise JobError('BUSY', 'Another recording import is in progress. Retry after it finishes.', 409)
            listed = self.available()['recordings']
            expected_name = 'import-' + expected_hash + IMPORT_MIMES.get(mime, '')
            if len(listed) >= 200 and not any(item['name'] == expected_name for item in listed):
                raise JobError('CATALOG_FULL', 'The recording catalog is full. Move older files locally and refresh choices before importing.', 409)
            # The bounded transfer runs unlocked so status, cancel and recorder
            # supervision stay responsive; starts are refused until it ends.
            self.importing = True
        try:
            file, reused = import_recording(self.recordings, stream, length, mime, expected_hash)
            with self.lock:
                catalog = self.available()
                recording = next(item for item in catalog['recordings'] if item['name'] == file.name)
            return {'recording': recording, 'sha256': expected_hash, 'reused': reused}
        except RecordingImportError as exc:
            raise JobError('IMPORT_REFUSED', str(exc)) from None
        except (OSError, StopIteration):
            raise JobError('IMPORT_STORAGE', 'Could not publish the recording. Check disk space and permissions; refresh choices before retrying the same file.', 507) from None
        finally:
            with self.lock:
                self.importing = False

    def snapshot(self, job_id=None):
        with self.lock:
            if job_id is not None and (not self.job or self.job['id'] != job_id):
                raise JobError('JOB_GONE', 'This job is no longer retained. Reconnect and explicitly start another recording.', 404)
            return dict(self.job) if self.job else None

    def claim(self, owner):
        with self.lock:
            if self.closed or self.store_failed:
                raise JobError('STOPPED', 'Analysis is unavailable. Check storage and restart the local service.', 503)
            if self.owner is not None or (self.job and self.job['state'] not in TERMINAL):
                raise JobError('BUSY', 'Wait for analysis or stop the LAN recorder first.', 409)
            if self.importing:
                raise JobError('BUSY', 'Wait for the recording import to finish.', 409)
            self.owner = owner; self.model_cache = None

    def release(self, owner):
        with self.lock:
            if self.owner is owner:
                self.owner = None
                cache, self.model_cache = self.model_cache, None
                if cache and not (self.job and self.job['state'] not in TERMINAL):
                    try: cache[0].unlink(missing_ok=True)
                    except OSError: pass  # Restart recovery removes the recorder's work folder.

    def discard_managed_result(self, owner):
        """Recorder has archived the pair (or recorded failure); remove its scratch copy."""
        with self.lock:
            if self.owner is not owner or not self.managed or (self.job and self.job['state'] not in TERMINAL):
                return
            if self.directory:
                try:
                    self.directory.cleanup()
                except OSError:
                    return  # Windows: a download still holds a file open; the next start removes it.
                self.directory = None
            self.job = None

    def start(self, request, *, owner=None, source=None, expected_sha=None, camera='local-recording', scratch_parent=None, model_cache=None):
        with self.lock:
            if self.owner is not owner:
                raise JobError('BUSY', 'Stop the LAN recorder before starting a separate analysis.', 409)
            if self.closed:
                raise JobError('STOPPED', 'The local service is stopping.', 503)
            if self.store_failed:
                raise JobError('STORE_UNAVAILABLE', 'Result storage failed. Check free space and permissions, then restart the service before another job.', 503)
            if self.job and self.job['state'] not in TERMINAL:
                raise JobError('BUSY', 'A recording is already processing. Wait or cancel it first.', 409)
            if self.importing:
                raise JobError('BUSY', 'Wait for the recording import to finish, then refresh the choices.', 409)
            if self.face_busy:
                raise JobError('BUSY', 'Wait for face processing to finish, then retry.', 409)
            if (not isinstance(request, dict) or set(request) not in
                    ({'recording', 'model', 'rules'}, {'recording', 'model', 'rules', 'compare_enhancement'})
                    or any(not isinstance(v, str) for v in request.values())
                    or ('compare_enhancement' in request and
                        (request['compare_enhancement'] != ENHANCEMENT_PROFILE or owner is not None))):
                raise JobError('SELECTION', 'Choose a listed recording, model and rule set.')
            try:
                source, sig = (source, signature(source.stat())) if source is not None and owner is not None else self.choices[request['recording']]
                model = self.catalog['models'][request['model']]
                rules = self.catalog['rules'][request['rules']]
                if not set(rules['classes']) <= set(model['classes']):
                    raise KeyError('incompatible')
            except KeyError:
                raise JobError('SELECTION', 'Selection is unavailable or incompatible. Refresh the choices.') from None
            job = {'id': secrets.token_hex(16), 'state': 'running', 'phase': 'preparing',
                        'recording': source.name, 'model': model['name'], 'rules': rules['name'],
                        'frames_read': 0, 'frames_analyzed': 0, 'max_frames': LIMITS['max_frames'],
                        'elapsed_seconds': 0, 'error': None}
            if 'compare_enhancement' in request:
                job['compare_enhancement'] = request['compare_enhancement']
            if self.store and owner is None:
                try:
                    directory = self.store.begin(job)
                except (OSError, ValueError):
                    self.store_failed = True
                    raise JobError('STORE_UNAVAILABLE', 'The new job could not be saved. Check result-store free space and permissions, then restart the service.', 503) from None
                self.retained_directory = directory
            else:
                if self.directory:
                    self.directory.cleanup()
                self.directory = tempfile.TemporaryDirectory(prefix='intelligent-dvr-job-', dir=scratch_parent)
                directory = Path(self.directory.name)
            self.cancel_event = threading.Event()
            self.job = job
            self.suggestions = None  # They refer to the previous job's frames.
            self.managed = owner is not None
            self.thread = threading.Thread(target=self._run, args=(directory, source, sig, model, rules, expected_sha, camera,
                                           model_cache if owner is not None else None), daemon=True)
            self.thread.start()
            return self.snapshot()

    def cancel(self, job_id):
        with self.lock:
            self.snapshot(job_id)
            if self.job['state'] not in TERMINAL:
                self.cancel_event.set()
                self.job['phase'] = 'cancelling'
            return self.snapshot()

    def _check(self, began):
        if self.cancel_event.is_set():
            raise JobError('CANCELLED', 'Analysis cancelled. No results were opened.')
        if time.monotonic() - began > self.wall_seconds:
            raise JobError('TIME_LIMIT', 'Analysis exceeded the five-minute limit. Choose a shorter recording and try again.')

    def _copy(self, source, target, limit, began, expected=None):
        regular(source, limit)
        before = source.stat()
        if expected and signature(before) != expected:
            raise JobError('SOURCE_CHANGED', 'The selected recording changed. Refresh the choices and select it again.')
        try:
            # Non-blocking open + fstat: a FIFO swapped in after the check cannot hang the job.
            src = open_regular(source)
        except ValueError:
            raise JobError('INPUT_CHANGED', 'An input changed. Restore the configured files and retry.') from None
        with src, target.open('xb') as dst:
            opened = os.fstat(src.fileno())
            if not stat.S_ISREG(opened.st_mode) or signature(opened) != signature(before):
                raise JobError('INPUT_CHANGED', 'An input changed. Restore the configured files and retry.')
            count = 0
            digest = hashlib.sha256()
            while True:
                self._check(began)
                block = src.read(1024 * 1024)
                if not block:
                    break
                count += len(block)
                if count > limit:
                    raise JobError('FILE_LIMIT', 'An input exceeds its size limit. Choose a smaller local file.')
                dst.write(block)
                digest.update(block)
            if signature(os.fstat(src.fileno())) != signature(before) or signature(source.stat()) != signature(before):
                raise JobError('INPUT_CHANGED', 'An input changed during preparation. Refresh and retry.')
        return digest.hexdigest()

    def _model(self, model, directory, began, cache):
        """Manual jobs snapshot the model. Owner jobs reuse one copy verified since claim():
        the same pinned SHA-256 and an unchanged file signature, else copy and verify again."""
        if cache is None:
            target = directory / 'model.onnx'
            if self._copy(model['path'], target, MODEL_BYTES, began) != model['sha256']:
                raise JobError('MODEL_CHANGED', 'The model does not match its configured SHA-256. Restore the approved model before retrying.')
            return target
        with self.lock:
            known = self.model_cache
        try:
            info = cache.lstat()
            if known and known[:2] == (cache, model['sha256']) and stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and signature(info) == known[2]:
                return cache
        except OSError:
            pass
        with self.lock:
            self.model_cache = (cache, None, None)  # Unverified: release() still removes a partial copy.
        cache.unlink(missing_ok=True)
        if self._copy(model['path'], cache, MODEL_BYTES, began) != model['sha256']:
            cache.unlink(missing_ok=True)
            raise JobError('MODEL_CHANGED', 'The model does not match its configured SHA-256. Restore the approved model before retrying.')
        with self.lock:
            self.model_cache = (cache, model['sha256'], signature(cache.lstat()))
        return cache

    def _run(self, directory, source, sig, model, rules, expected_sha=None, camera='local-recording', cache=None):
        began = time.monotonic()
        terminal, error, result_state = 'failed', None, None
        try:
            source_hash = self._copy(source, directory / ('source' + source.suffix.lower()), VIDEO_BYTES, began, sig)
            if expected_sha is not None and source_hash != expected_sha:
                raise JobError('SOURCE_CHANGED', 'The recorded segment fingerprint changed. No results were accepted.')
            video = directory / ('source' + source.suffix.lower())
            with video.open('rb') as stream:
                if not video_header(stream.read(16)):
                    raise JobError('INVALID_VIDEO', 'Choose an MP4/MOV, WebM/MKV or AVI recording. Playlists and text files are not supported.')
            model_path, model_hash = self._model(model, directory, began, cache), model['sha256']
            labels_hash = self._copy(model['labels'], directory / 'labels.json', 64 * 1024, began)
            rules_hash = self._copy(rules['path'], directory / 'rules.json', 64 * 1024, began)
            if labels_hash != model['labels_sha256'] or rules_hash != rules['sha256']:
                raise JobError('CONFIG_CHANGED', 'Configured labels or rules changed. Restart the service to review the new choices before analysis.')
            labels = read_json(directory / 'labels.json', 64 * 1024)
            validate_binding(model['profile'], model_hash, labels)
            parsed_rules = [Rule(**r) for r in read_json(directory / 'rules.json', 64 * 1024)]
            RuleEngine(parsed_rules)
            if not parsed_rules or any(r.label not in labels for r in parsed_rules):
                raise ValueError('Incompatible rules')
            args = ['--video', str(video), '--model', str(model_path), '--labels', str(directory / 'labels.json'),
                    '--rules', str(directory / 'rules.json'), '--profile', model['profile'], '--backend', 'opencv-cpu',
                    '--threads', '2', '--max-frames', '6000', '--stride', '5', '--camera=' + camera,
                    '--output', str(directory / 'receipt.json'), '--review-output', str(directory / 'review.json')]
            if self.job.get('compare_enhancement'):
                args += ['--compare-enhancement', self.job['compare_enhancement']]
            (directory / 'args.json').write_text(json.dumps(args), encoding='utf-8')
            self._check(began)
            self.process = self.process_factory([sys.executable, '-m', 'edge.analysis_worker', str(directory)], cwd=ROOT,
                                               stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                               env={**os.environ, 'DVR_ANALYSIS_PARENT_PID': str(os.getpid()), 'DVR_ANALYSIS_PARENT_PIPE': '1'})
            while self.process.poll() is None:
                self._check(began)
                self._progress(directory, began)
                self.cancel_event.wait(.1)
            self._check(began)
            if self.process.returncode != 0:
                # Strict {"code"} file from the worker, else a classified signal/NTSTATUS exit.
                code = failures.read(directory, failures.ANALYSIS) or failures.exit_cause(self.process.returncode)
                if code:
                    raise JobError(code, failures.ANALYSIS[code])
                raise JobError('PROCESS_FAILED', 'The analyzer stopped. Check that the recording plays, the model matches its profile, and the CPU dependencies are installed. Try a shorter recording; memory and CPU limits also stop jobs.')
            review = read_json(directory / 'review.json', RESULT_BYTES)
            receipt, trace = review['receipt'], review['trace']
            expected = {'source_sha256': source_hash, 'model_sha256': model_hash,
                        'labels_sha256': labels_hash, 'rules_file_sha256': rules_hash}
            if (review['schema'] != 'intelligent-dvr.recognition-review.v1' or
                    any(receipt[k] != v or trace[k] != v for k, v in expected.items()) or
                    receipt['state'] not in ('completed', 'partial')):
                raise JobError('RESULT_MISMATCH', 'Analyzer results do not match this job. Nothing was opened; retry the recording.')
            comparison = validate_enhancement(trace, labels, current_code=True)
            if receipt.get('media_coverage') != trace.get('media_coverage'):
                raise JobError('RESULT_MISMATCH', 'Recording coverage does not match this job. Nothing was opened; retry the recording.')
            validate_coverage(receipt.get('media_coverage'), source_hash, receipt['frames_read'], receipt['state'])
            if (receipt.get('enhancement_comparison') != comparison or
                    bool(comparison) != bool(self.job.get('compare_enhancement'))):
                raise JobError('RESULT_MISMATCH', 'Sharpening results do not match this job. Nothing was opened; retry the recording.')
            self._progress(directory, began)
            terminal, result_state = 'completed', receipt['state']
        except JobError as exc:
            terminal = 'cancelled' if exc.code == 'CANCELLED' else 'failed'
            error = {'code': exc.code, 'message': str(exc)}
        except (Exception, SystemExit):
            error = {'code': 'ANALYSIS_FAILED', 'message': 'Unable to prepare or validate analysis. Check free disk space, file access, configured rules and model files, then retry.'}
        finally:
            if self.process and self.process.poll() is None:
                self.process.kill()
                self.process.wait()
            if self.process and getattr(self.process, 'stdin', None):
                self.process.stdin.close()
            self.process = None
            with self.lock:
                # Cancel wins a race with publication; no partial result is exposed.
                if self.cancel_event.is_set():
                    terminal, result_state = 'cancelled', None
                    error = {'code': 'CANCELLED', 'message': 'Analysis cancelled. No results were opened.'}
                finished = {**self.job, 'state':terminal, 'phase':terminal, 'error':error,
                            'result_state':result_state, 'elapsed_seconds':round(time.monotonic() - began, 1)}
                try:
                    for name in ('model.onnx', 'labels.json', 'rules.json', 'args.json', 'receipt.json', 'progress.json', 'progress.tmp', 'failure.json', 'failure.tmp'):
                        (directory / name).unlink(missing_ok=True)
                    if terminal != 'completed':
                        for path in directory.iterdir():
                            path.unlink()
                    if self.store and not self.managed:
                        self.store.commit(finished, directory)
                except (OSError, ValueError, KeyError, TypeError):
                    self.store_failed = bool(self.store)
                    finished.update(state='failed', phase='failed', result_state=None,
                        error={'code':'STORE_WRITE_FAILED' if self.store else 'CLEANUP_FAILED',
                               'message':'Analysis finished without a confirmed result. Check local storage and restart; no result was opened.'})
                self.job.update(finished)
                self.diagnostics.event('JOB_FINISHED', job=finished['id'], state=finished['state'].upper(), managed=self.managed,
                    code=(finished['error'] or {}).get('code'), result=(finished['result_state'] or '').upper() or None,
                    seconds=finished['elapsed_seconds'])

    def _progress(self, directory, began):
        with self.lock:
            self.job['elapsed_seconds'] = round(time.monotonic() - began, 1)
        try:
            value = read_json(directory / 'progress.json', 2048)
            if value.get('phase') not in ('validating', 'analyzing', 'verifying', 'completed'):
                return
            if any(type(value.get(k)) is not int or not 0 <= value[k] <= 6000 for k in ('frames_read', 'frames_analyzed')):
                return
            with self.lock:
                if not self.cancel_event.is_set():
                    self.job.update(value)
                    self.job['elapsed_seconds'] = round(time.monotonic() - began, 1)
        except (OSError, ValueError):
            pass

    def artifact(self, job_id, kind):
        with self.lock:
            job = self.snapshot(job_id)
            if job['state'] != 'completed':
                raise JobError('NOT_READY', 'Results are available only after successful analysis.', 409)
            directory = self.retained_directory if self.store and not self.managed else Path(self.directory.name)
            if kind == 'result':
                return regular(directory / 'review.json', RESULT_BYTES), 'application/json'
            source = next(directory.glob('source.*'))
            return regular(source, VIDEO_BYTES), content_type(source)

    def open_artifact(self, job_id, kind):
        """Check and open under the lock; the caller streams after releasing it."""
        with self.lock:
            path, mime = self.artifact(job_id, kind)
            return path.open('rb'), mime

    def close(self):
        with self.lock:
            self.closed = True
            self.cancel_event.set()
        if self.thread:
            self.thread.join(timeout=10)
        if self.directory and (not self.thread or not self.thread.is_alive()):
            self.directory.cleanup()
        if self.store and (not self.thread or not self.thread.is_alive()):
            self.store.close()


class LocalServer(ThreadingHTTPServer):
    # One daemon thread per connection, each with a short read/write timeout, so an
    # idle speculative connection or slow download cannot stall preview leases or
    # other API calls. At most HANDLERS run at once; extra connections are closed
    # unanswered. Jobs, Feeds and Recorder lock their own state; file transfers
    # stream after those locks are released. Shutdown does not wait for slow readers.
    # Linux and macOS TIME_WAIT sockets must not prevent a normal stop/restart. An
    # active listener still owns its exact loopback address (sharing it would need
    # SO_REUSEPORT). Windows reuse has different semantics and remains disabled.
    allow_reuse_address = sys.platform in ('linux', 'darwin')
    block_on_close = False
    HANDLERS = 16
    def __init__(self, port, jobs, static_root, feeds=None, recorder=None):
        self.jobs, self.static_root, self.feeds = jobs, Path(static_root).resolve(), feeds
        self.recorder = recorder
        self.token = jobs.token if jobs else secrets.token_urlsafe(32)
        self.slots = threading.BoundedSemaphore(self.HANDLERS)
        super().__init__(('127.0.0.1', port), Handler)
        self.origin = f'http://127.0.0.1:{self.server_port}'

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            return self.shutdown_request(request)
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release(); raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'IntelligentDVR'
    def log_message(self, *_):
        pass  # No filenames, tokens or media requests in access logs.

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def _guard(self, token=False, account=False):
        expected_host = self.server.origin.removeprefix('http://')
        if self.headers.get_all('Host') != [expected_host] or self.client_address[0] != '127.0.0.1':
            raise JobError('HOST', 'Use the exact local application address.', 403)
        if self.headers.get('Origin') not in (None, self.server.origin) or self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
            raise JobError('ORIGIN', 'Open the application directly on this computer.', 403)
        # Loopback is reachable by every local account. On Linux, the API (including
        # the token-issuing session endpoints) answers only this account's sockets.
        if account and sys.platform == 'linux' and peer_uid(self.client_address, self.server.server_port) != os.getuid():
            raise JobError('ACCOUNT', 'This local service belongs to another account on this computer. Open the app from the account that started it.', 403)
        value = self.headers.get('X-DVR-Token', '')
        # compare_digest refuses non-ASCII str; such a token is simply wrong.
        if token and not (isinstance(value, str) and value.isascii() and hmac.compare_digest(value, self.server.token)):
            raise JobError('SESSION', 'Reconnect to the local service and retry.', 403)

    def _headers(self, status, mime, size):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(size))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()

    def _json(self, value, status=200):
        body = json.dumps(value, allow_nan=False).encode()
        self._headers(status, 'application/json', len(body))
        self.wfile.write(body)

    def _file(self, stream, mime):
        with stream:
            self._headers(200, mime, os.fstat(stream.fileno()).st_size)
            shutil.copyfileobj(stream, self.wfile, 256 * 1024)

    @staticmethod
    def _drain(body, seconds=30):
        """Read the rest of an import (bounded) before replying, so a refusal or
        idempotent reuse arrives as JSON instead of a connection reset."""
        if body.remaining > MAX_IMPORT_BYTES:
            return  # Oversized protocol violation: reply and close without reading it.
        deadline = time.monotonic() + seconds
        try:
            while body.remaining > 0 and time.monotonic() < deadline and body.read(256 * 1024):
                pass
        except OSError:
            pass  # The five-second socket timeout bounds a stalled sender.

    def _dispatch(self):
        path = urlsplit(self.path).path
        api = path.startswith('/api/')
        if (self.command == 'GET' and not api and self.client_address[0] == '127.0.0.1'
                and self.headers.get_all('Host') == [f'localhost:{self.server.server_port}']):
            # A localhost bookmark reaches the exact origin, which alone holds the session,
            # camera permission and same-origin checks. The API never answers on localhost.
            self.send_response(307)
            self.send_header('Location', self.server.origin + '/')
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            return self.end_headers()
        self._guard(token=api and path not in ('/api/analysis/session', '/api/feeds/session'), account=api)
        jobs, feeds = self.server.jobs, self.server.feeds
        recorder = getattr(self.server, 'recorder', None)
        if path.startswith('/api/recorder/') and recorder is None:
            raise JobError('RECORDER_DISABLED', 'LAN recording is not configured. Enable it in the local launcher with a reviewed recorder configuration.', 503)
        if path.startswith('/api/analysis/') and jobs is None:
            raise JobError('ANALYSIS_DISABLED', 'Recording analysis is not configured. Restart the local app with a recordings folder and model/rule configuration.', 503)
        if path.startswith('/api/feeds/') and feeds is None:
            raise JobError('FEEDS_DISABLED', 'DVR feeds are not configured. Start the local app with --feeds-config and a local source list.', 503)
        if self.command == 'GET' and path == '/api/feeds/session':
            return self._json({'token': self.server.token, **feeds.available()})
        if self.command == 'GET' and path == '/api/analysis/session':
            return self._json({'token': jobs.token, **jobs.available()})
        if self.command == 'GET' and path == '/api/analysis/people':
            return self._json(jobs.people_list())
        if self.command == 'POST' and path == '/api/analysis/recordings':
            # Authentication and same-origin checks above run before reading bytes.
            lengths = self.headers.get_all('Content-Length') or []
            if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not (lengths[0].isascii() and lengths[0].isdigit()):
                raise JobError('BODY', 'Use a recording with one bounded Content-Length.')
            body = Upload(self.rfile, int(lengths[0]))
            try:
                if len(self.headers.get_all('Content-Type') or []) != 1 or len(self.headers.get_all('X-DVR-SHA256') or []) != 1:
                    raise JobError('BODY', 'Use one video content type and fingerprint.')
                result = jobs.receive_recording(body, body.remaining, self.headers['Content-Type'], self.headers['X-DVR-SHA256'])
            finally:
                self._drain(body)
            return self._json(result, 201)
        if self.command == 'POST':
            if self.headers.get('Transfer-Encoding') or self.headers.get_all('Content-Length') is None or len(self.headers.get_all('Content-Length')) != 1:
                raise JobError('BODY', 'Use a bounded JSON request.')
            try:
                length = int(self.headers['Content-Length'])
            except ValueError:
                raise JobError('BODY', 'Invalid request length.') from None
            if not 0 < length <= 2048 or self.headers.get('Content-Type') != 'application/json':
                raise JobError('BODY', 'Use a JSON request up to 2 KiB.')
            try:
                body = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                raise JobError('BODY', 'Invalid JSON request.') from None
            if path == '/api/feeds/connect':
                return self._json(feeds.connect(body), 202)
            match = re.fullmatch('/api/feeds/([a-f0-9]{32})/disconnect', path)
            if match:
                return self._json(feeds.disconnect(match[1]))
            if path == '/api/analysis/jobs':
                return self._json(jobs.start(body), 202)
            if path == '/api/analysis/training/rules':
                return self._json(jobs.save_training_rules(body), 201)
            if path == '/api/analysis/people':
                return self._json(jobs.people_enroll(body), 201)
            if path == '/api/analysis/people/identify':
                return self._json(jobs.people_identify(body))
            match = re.fullmatch('/api/analysis/people/([a-f0-9]{16})/(verify|confirm|delete)', path)
            if match:
                action = {'verify': jobs.people_verify, 'confirm': jobs.people_confirm, 'delete': jobs.people_delete}[match[2]]
                return self._json(action(match[1], body))
            if path == '/api/recorder/start':
                return self._json(recorder.start(body), 202)
            if path == '/api/recorder/stop':
                if body != {}:
                    raise JobError('BODY', 'Stop takes an empty object.')
                return self._json(recorder.stop())
            match = re.fullmatch('/api/analysis/jobs/([a-f0-9]{32})/cancel', path)
            if match:
                return self._json(jobs.cancel(match[1]))
        if self.command == 'GET':
            if path == '/api/recorder/status':
                return self._json(recorder.status())
            match = re.fullmatch('/api/recorder/segments/([a-f0-9]{32})/(source|result|timing)', path)
            if match:
                # Verified and opened under the recorder lock; retention skips the
                # row while it streams, without blocking supervision on a slow reader.
                with recorder.open_artifact(match[1], match[2]) as (stream, mime):
                    return self._file(stream, mime)
            match = re.fullmatch('/api/feeds/([a-f0-9]{32})(/frame)?', path)
            if match:
                if match[2]:
                    data = feeds.frame(match[1])
                    self._headers(200, 'image/jpeg', len(data))
                    return self.wfile.write(data)
                return self._json(feeds.status(match[1]))
            match = re.fullmatch('/api/analysis/jobs/([a-f0-9]{32})(/(result|source))?', path)
            if match:
                if match[3]:
                    return self._file(*jobs.open_artifact(match[1], match[3]))
                return self._json(jobs.snapshot(match[1]))
            if not api:
                relative = unquote(path).lstrip('/') or 'index.html'
                file = (self.server.static_root / relative).resolve()
                if file.is_relative_to(self.server.static_root) and not any(part.startswith('.') for part in Path(relative).parts):
                    try:
                        regular(file, 32 * 1024**2)
                        stream = file.open('rb')
                    except (ValueError, OSError):
                        pass
                    else:
                        return self._file(stream, content_type(file))
        raise JobError('NOT_FOUND', 'This local resource is unavailable.', 404)

    def do_GET(self):
        try:
            self._dispatch()
        except (JobError, FeedError) as exc:
            self._json({'error': {'code': exc.code, 'message': str(exc)}}, exc.status)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self._json({'error': {'code': 'REQUEST_FAILED', 'message': 'The local request failed. Reconnect and retry.'}}, 500)

    do_POST = do_GET


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recordings', type=Path, help='Explicit local folder; direct recordings only')
    parser.add_argument('--config', type=Path, help='Local model/rule allowlist; see edge/local-analysis.example.json')
    parser.add_argument('--state-dir', type=Path, help='Opt-in Linux private last-job storage; no automatic analysis or resume')
    parser.add_argument('--allow-recording-import', action='store_true', help='Allow explicit same-origin video imports up to 64 MiB; stored locally until manually moved or deleted')
    parser.add_argument('--allow-training', action='store_true', help='Allow guided training to save tuned rule sets in the catalog folder\'s trained/ folder; never overwrites')
    parser.add_argument('--allow-face-enrollment', action='store_true', help='Allow consent-based face templates in the catalog folder\'s people/ folder; needs the pinned face models')
    parser.add_argument('--feeds-config', type=Path, help='Trusted LAN RTSP channels; see edge/local-feeds.example.json')
    parser.add_argument('--recorder-config', type=Path, help='Opt-in one-camera segment recorder; never starts automatically')
    parser.add_argument('--port', type=int, default=4173)
    parser.add_argument('--open-browser', action='store_true', help='Open the local app after binding; never connects cameras')
    args = parser.parse_args(argv)
    if bool(args.recordings) != bool(args.config):
        parser.error('Use --recordings and --config together')
    if args.state_dir and not args.config:
        parser.error('--state-dir requires recording analysis configuration')
    if args.allow_recording_import and not args.config:
        parser.error('--allow-recording-import requires recording analysis configuration')
    if args.allow_training and not args.config:
        parser.error('--allow-training requires recording analysis configuration')
    if args.allow_face_enrollment and not args.config:
        parser.error('--allow-face-enrollment requires recording analysis configuration')
    if args.recorder_config and (not args.config or not args.feeds_config):
        parser.error('--recorder-config requires recording analysis and feeds configuration')
    if not args.config and not args.feeds_config:
        parser.error('Configure recording analysis, DVR feeds, or both')
    if not 1024 <= args.port <= 65535:
        parser.error('port must be 1024–65535')
    if not (ROOT / 'dist/client/index.html').is_file():
        parser.error('Build the local app first with npm run build')
    jobs = feeds = recorder = None
    diagnostics = Diagnostics()
    try:
        if args.config:
            jobs = Jobs(args.recordings, load_catalog(args.config.absolute()), state_dir=args.state_dir, allow_import=args.allow_recording_import,
                        training_dir=args.config.absolute().parent / 'trained' if args.allow_training else None,
                        people_dir=args.config.absolute().parent / 'people' if args.allow_face_enrollment else None)
            diagnostics = jobs.diagnostics
        if args.feeds_config:
            feeds = Feeds(load_sources(args.feeds_config.absolute()), diagnostics=diagnostics)
            if shared_config(args.feeds_config):
                diagnostics.event('FEEDS_CONFIG_SHARED')
                print('Warning: the DVR source list (it holds camera credentials) is readable by other accounts on this computer. '
                      'Restrict it to your account, for example: chmod 600 local-feeds.json', file=sys.stderr, flush=True)
        if args.recorder_config:
            from .lan_recorder import Recorder, validate_config
            config = validate_config(args.recorder_config.absolute(), feeds.sources)
            recorder = Recorder(config, feeds.sources, jobs, jobs.recordings / '.lan-recorder', diagnostics=diagnostics)
        with LocalServer(args.port, jobs, ROOT / 'dist/client', feeds, recorder) as server:
            diagnostics.event('SERVICE_START', analysis=jobs is not None, feeds=feeds is not None, recorder=recorder is not None,
                              imports=args.allow_recording_import, training=args.allow_training,
                              people=args.allow_face_enrollment)
            print(f'Local Intelligent DVR: {server.origin}/ — explicit connections and jobs only; Ctrl+C stops.', flush=True)
            if args.open_browser:
                import webbrowser
                def open_browser():
                    try:
                        webbrowser.open(server.origin + '/')
                    except Exception:
                        print('Open the printed loopback address in your browser.', flush=True)
                threading.Thread(target=open_browser, daemon=True).start()
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))
    finally:
        if recorder:
            recorder.close()
        diagnostics.event('SERVICE_STOP')  # Before the result store releases its owner lock.
        if jobs:
            jobs.close()
        if feeds:
            feeds.close()


if __name__ == '__main__':
    main()
