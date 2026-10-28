"""Local evidence inventory and workload preflight. No inference or network I/O."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess

from .evaluation import canonical_hash, local_file, read_json, require

BUNDLE_SCHEMA = 'intelligent-dvr.local-evidence.v1'
PLAN_SCHEMA = 'intelligent-dvr.qualification-plan.v1'
MAX_FILES = 4000
MAX_SOURCE_BYTES = 8 * 1024**2
MAX_TOTAL_BYTES = 64 * 1024**2
MAX_ARTIFACT_BYTES = 1024**2
SKIP_DIRS = {'.git', '.venv', 'node_modules', 'dist', '__pycache__',
             'recordings', 'models', 'receipts', 'qa-local'}
SOURCE_DIRS = {'src', 'edge', 'tests', 'scripts', 'docs', '.github'}
SOURCE_SUFFIXES = {'.py', '.js', '.jsx', '.mjs', '.json', '.md', '.yml', '.yaml',
                   '.txt', '.ps1', '.sh', '.toml'}
ROOT_FILES = {'AGENTS.md', 'README.md', 'SECURITY.md', 'package.json',
              'package-lock.json', 'pyproject.toml'}
UNQUALIFIED = {key: 'unqualified' for key in (
    'recognition_accuracy', 'target_hardware_performance',
    'live_camera_operation', 'concurrent_camera_capacity')}


def project_root(value):
    root = Path(value).absolute()
    require(root.is_dir() and not any(p.is_symlink() for p in (root, *root.parents)),
            'Project must be a local directory without symlink components')
    return root


def member(root, name):
    require(isinstance(name, str) and 0 < len(name) <= 500,
            'Require a bounded relative file path')
    path = Path(name)
    require(not path.is_absolute() and '..' not in path.parts and ':' not in name,
            'Evidence inputs must stay inside the explicit project directory')
    return local_file(root / path)


def fingerprint(path, root, limit):
    local_file(path)
    before = path.stat()
    require(before.st_size <= limit, 'File exceeds the inventory size bound')
    h = hashlib.sha256()
    blob = hashlib.sha1()
    blob.update(f'blob {before.st_size}\0'.encode())
    total = 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024**2), b''):
            total += len(chunk)
            require(total <= limit, 'File grew beyond the inventory size bound')
            h.update(chunk)
            blob.update(chunk)
    after = path.stat()
    require((before.st_size, before.st_mtime_ns, before.st_ino) ==
            (after.st_size, after.st_mtime_ns, after.st_ino) and total == before.st_size,
            'File changed while being inventoried; retry when the worktree is idle')
    return {'path': path.relative_to(root).as_posix(), 'bytes': total,
            'sha256': h.hexdigest(), 'git_blob_sha1': blob.hexdigest()}


def git_provenance(root):
    """Fixed read-only Git commands; never execute project code or hooks."""
    prefix = ['git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
              '-C', str(root)]
    try:
        top = subprocess.run(prefix + ['rev-parse', '--show-toplevel'],
                             capture_output=True, text=True, timeout=5, check=True)
        require(Path(top.stdout.strip()).resolve() == root.resolve(),
                'Project directory must be the Git worktree root')
        head = subprocess.run(prefix + ['rev-parse', '--verify', 'HEAD'],
                              capture_output=True, text=True, timeout=5, check=True)
        require(re.fullmatch(r'[0-9a-f]{40,64}', head.stdout.strip()) is not None,
                'Unrecognized Git revision')
        status = subprocess.run(prefix + ['status', '--porcelain=v1', '-z',
                                         '--untracked-files=normal'],
                                capture_output=True, timeout=5, check=True)
        return {'commit': head.stdout.strip(),
                'worktree': 'dirty' if status.stdout else 'clean'}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {'commit': None, 'worktree': 'unknown'}


def log_summaries(text):
    """Extract separate unittest/TAP summaries, retaining skips and failures."""
    text = re.sub(r'^\d{4}-\d\d-\d\dT\S+Z\s*', '', text, flags=re.M)
    results = []
    runs = list(re.finditer(r'^Ran (\d+) tests?\b', text, re.M))
    for i, match in enumerate(runs):
        section = text[match.end():runs[i+1].start() if i+1 < len(runs) else len(text)]
        end = re.search(r'^(OK|FAILED)(?: \(([^)]*)\))?\s*$', section, re.M)
        if not end:
            continue
        fields = dict(re.findall(r'(\w+)=(\d+)', end[2] or ''))
        n = int(match[1])
        failed = int(fields.get('failures', 0)) + int(fields.get('errors', 0))
        skipped = int(fields.get('skipped', 0))
        valid = n >= failed + skipped and ((end[1] == 'FAILED' and failed > 0)
                                          or (end[1] == 'OK' and failed == 0))
        results.append({'format': 'unittest', 'discovered': n,
                        'passed': n-failed-skipped if valid else None,
                        'failed': failed, 'skipped': skipped,
                        'consistent': valid, 'outcome': end[1].lower()})
    runs = list(re.finditer(r'^# tests (\d+)\s*$', text, re.M))
    for i, match in enumerate(runs):
        section = text[match.end():runs[i+1].start() if i+1 < len(runs) else len(text)]
        fields = dict(re.findall(r'^# (pass|fail|cancelled|skipped|todo) (\d+)\s*$',
                                 section, re.M))
        if not {'pass', 'fail', 'cancelled', 'skipped', 'todo'} <= fields.keys():
            continue
        c = {key: int(value) for key, value in fields.items()}
        n = int(match[1])
        results.append({'format': 'tap', 'discovered': n, 'passed': c['pass'],
                        'failed': c['fail'], 'skipped': c['skipped'],
                        'cancelled': c['cancelled'], 'todo': c['todo'],
                        'consistent': n == sum(c.values())})
    return results


def collect(root, artifacts=()):
    root = project_root(root)
    require(len(artifacts) <= 16 and len(set(artifacts)) == len(artifacts),
            'Select at most 16 distinct artifacts')
    files, omitted, directories, total_bytes = [], [], 0, 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        directories += 1
        require(directories <= MAX_FILES, 'Source directory count exceeds the inventory bound')
        parent = Path(directory)
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and
                         (parent != root or d in SOURCE_DIRS))
        for d in list(dirs):
            if (parent / d).is_symlink():
                omitted.append({'path': (parent/d).relative_to(root).as_posix(),
                                'reason': 'symlink directory excluded'})
                dirs.remove(d)
        for name in sorted(names):
            path = parent / name
            if name.startswith('.') or (parent == root and name not in ROOT_FILES):
                continue
            if path.suffix.lower() not in SOURCE_SUFFIXES:
                continue
            require(len(files) + len(omitted) < MAX_FILES, 'Source inventory exceeds 4,000 entries')
            try:
                local_file(path)
                require(path.stat().st_size <= MAX_TOTAL_BYTES - total_bytes,
                        'Source byte count exceeds the inventory bound')
                record = fingerprint(path, root, MAX_SOURCE_BYTES)
                require(total_bytes + record['bytes'] <= MAX_TOTAL_BYTES,
                        'Source byte count exceeds the inventory bound')
                files.append(record)
                total_bytes += record['bytes']
            except (OSError, ValueError):
                omitted.append({'path': path.relative_to(root).as_posix(),
                                'reason': 'unreadable, linked, changing or oversized file'})
    files.sort(key=lambda row: row['path'])
    records = []
    for name in artifacts:
        path = member(root, name)
        record = fingerprint(path, root, MAX_ARTIFACT_BYTES)
        if path.suffix.lower() in {'.log', '.txt'}:
            with path.open('rb') as stream:
                raw = stream.read(MAX_ARTIFACT_BYTES + 1)
            require(len(raw) <= MAX_ARTIFACT_BYTES, 'Artifact exceeds the log size bound')
            record['test_summaries'] = log_summaries(raw.decode('utf-8'))
        elif path.suffix.lower() == '.json':
            data = read_json(path, MAX_ARTIFACT_BYTES)
            record['declared_schema'] = data.get('schema') if isinstance(data, dict) else None
        # Do not bind a summary to bytes that changed during its second read.
        require(fingerprint(path, root, MAX_ARTIFACT_BYTES) == {
            k: v for k, v in record.items() if k in {'path', 'bytes', 'sha256', 'git_blob_sha1'}},
            'Artifact changed during collection')
        records.append(record)
    packages = {}
    for name in ('numpy', 'onnx', 'opencv-python', 'opencv-python-headless'):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    return {'schema': BUNDLE_SCHEMA, 'state': 'partial' if omitted or not files else 'collected',
            'created_utc': datetime.now(timezone.utc).isoformat(),
            'source': {'git': git_provenance(root), 'files': files,
                       'inventory_sha256': canonical_hash(files), 'omitted': omitted},
            'artifacts': records,
            'runtime': {'python': platform.python_version(), 'os': platform.system(),
                        'packages': packages},
            'qualification': dict(UNQUALIFIED),
            'limits': ['Metadata and hashes only; no source/artifact contents copied.',
                       'No tests or inventoried source files executed; no models, cameras or network requests.',
                       'Log summaries are unsigned claims; inventory does not prove they ran on this source.',
                       'No host/user names, absolute project paths or Git remote URLs recorded.']}


def verify(root, bundle):
    root = project_root(root)
    require(bundle.get('schema') == BUNDLE_SCHEMA, 'Require a local-evidence bundle')
    source = bundle.get('source')
    require(isinstance(source, dict) and isinstance(source.get('files'), list) and
            isinstance(bundle.get('artifacts'), list), 'Invalid bundle lists')
    require(0 < len(source['files']) <= MAX_FILES and len(bundle['artifacts']) <= 16,
            'Bundle exceeds inventory bounds')
    require(canonical_hash(source['files']) == source.get('inventory_sha256'),
            'Inventory hash mismatch')
    mismatches, seen = [], set()
    for record in source['files'] + bundle['artifacts']:
        name = record.get('path')
        require(isinstance(name, str), 'Invalid evidence record')
        key = (name, record.get('sha256'))
        if key in seen:
            continue
        seen.add(key)
        try:
            current = fingerprint(member(root, name), root, MAX_SOURCE_BYTES)
            if any(current.get(k) != record.get(k) for k in ('bytes', 'sha256', 'git_blob_sha1')):
                mismatches.append({'path': name, 'reason': 'bytes changed'})
        except (OSError, ValueError):
            mismatches.append({'path': name, 'reason': 'missing, linked, invalid or unreadable'})
    return {'schema': 'intelligent-dvr.evidence-verification.v1',
            'state': 'mismatch' if mismatches else 'matched',
            'mismatches': mismatches, 'qualification': dict(UNQUALIFIED),
            'scope': 'Listed file bytes only; no log authenticity, Git cleanliness or capacity qualification.'}


def preflight(plan):
    expected = {'schema', 'minimum_simultaneous_cameras', 'stages', 'workload',
                'hardware', 'quality', 'approvals'}
    require(isinstance(plan, dict) and set(plan) == expected and
            plan['schema'] == PLAN_SCHEMA, 'Invalid qualification plan fields/schema')
    n = plan['minimum_simultaneous_cameras']
    require(type(n) is int and 100 <= n <= 10000, 'The camera requirement must be at least 100')
    require(isinstance(plan['stages'], list) and all(type(v) is int for v in plan['stages'])
            and plan['stages'] == [1, 5, 25, 50, n],
            'Use the explicit 1/5/25/50/target ladder')
    specs = {
        'workload': {'codec': 'text', 'width': (1, 16384), 'height': (1, 16384),
                     'source_fps': (.000001, 1000), 'analysis_fps_per_camera': (.000001, 1000),
                     'maximum_event_delay_seconds': (.000001, 86400),
                     'recording_required': 'bool', 'retention_days': (0, 3650),
                     'duration_minutes': (.000001, 100000),
                     'maximum_analytics_drop_fraction': (0, 1)},
        'hardware': {'host_count': (1, 1000), 'cpu_label': 'text', 'ram_gib': (.000001, 1e6),
                     'gpu_label': 'text', 'worker_count': (1, 256)},
        'quality': {'classes': 'classes', 'score_threshold': (.1, 1), 'iou_threshold': (.000001, 1),
                    'minimum_precision': (0, 1), 'minimum_recall': (0, 1),
                    'maximum_false_alerts_per_camera_hour': (0, 1e9),
                    'minimum_reviewed_camera_hours': (.000001, 1e9)}}
    blockers = []
    integer_fields = {'width', 'height', 'host_count', 'worker_count'}
    for group, fields in specs.items():
        values = plan[group]
        require(isinstance(values, dict) and set(values) == set(fields), f'Invalid {group} fields')
        for name, rule in fields.items():
            value = values[name]
            if value is None:
                blockers.append(f'{group}.{name}')
                continue
            if rule == 'text':
                valid = isinstance(value, str) and 0 < len(value.strip()) <= 200
            elif rule == 'bool':
                valid = type(value) is bool
            elif rule == 'classes':
                valid = isinstance(value, list) and 0 < len(value) <= 1000 and all(
                    isinstance(x, str) and 0 < len(x.strip()) <= 80 for x in value)
                valid = valid and len(set(value)) == len(value)
            else:
                try:
                    valid = type(value) in (int, float) and math.isfinite(value) and rule[0] <= value <= rule[1]
                except OverflowError:
                    valid = False
                valid = valid and (name not in integer_fields or type(value) is int)
            require(valid, f'Invalid {group}.{name}')
    approvals = plan['approvals']
    require(isinstance(approvals, dict) and set(approvals) == {
        'recording_permission_confirmed', 'annotation_review_confirmed', 'workload_accepted'},
        'Invalid approval fields')
    for name, value in approvals.items():
        require(type(value) is bool, f'Invalid approvals.{name}')
        if not value:
            blockers.append('approvals.' + name)
    w = plan['workload']
    if w['source_fps'] is not None and w['analysis_fps_per_camera'] is not None:
        require(w['analysis_fps_per_camera'] <= w['source_fps'], 'Analysis cadence exceeds source FPS')
    if w['recording_required'] is True and w['retention_days'] == 0:
        blockers.append('workload.retention_days must be positive when recording is required')
    return {'schema': 'intelligent-dvr.qualification-preflight.v1',
            'state': 'blocked' if blockers else 'ready-for-offline-trial',
            'plan_sha256': canonical_hash(plan), 'blockers': blockers,
            'qualification': dict(UNQUALIFIED),
            'measurements_required': ['Independent held-out detection/alert quality',
                                      'Sustained staged target-host decode/inference and resource use',
                                      'Per-source service cadence, drops, staleness and event delay',
                                      'Recording continuity, recovery and retention when required',
                                      'Separate live-camera and operational acceptance'],
            'scope': 'Validating declarations does not execute or qualify a workload.'}


def write_new(path, document):
    path = Path(path)
    require(not path.exists() and not path.is_symlink(), 'Output must be a new file')
    require(not any(p.is_symlink() for p in path.parents), 'Output parents must not be symlinks')
    raw = json.dumps(document, indent=2, allow_nan=False) + '\n'
    with path.open('x', encoding='utf-8') as stream:
        stream.write(raw)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('collect', help='Read source hashes and explicitly selected local artifacts')
    p.add_argument('--project', type=Path, required=True)
    p.add_argument('--artifact', action='append', default=[], help='Relative local log/JSON file; repeatable')
    p.add_argument('--output', type=Path, required=True)
    p = commands.add_parser('verify', help='Compare listed evidence hashes with current local files')
    p.add_argument('--project', type=Path, required=True)
    p.add_argument('--bundle', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p = commands.add_parser('plan', help='List missing decisions; never claim qualified capacity')
    p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'collect':
            result = collect(args.project, args.artifact)
        elif args.command == 'verify':
            result = verify(args.project, read_json(args.bundle, 8*1024**2))
        else:
            result = preflight(read_json(args.plan, 64*1024))
        write_new(args.output, result)
    except (OSError, ValueError, KeyError, TypeError, OverflowError) as error:
        parser.error(str(error))
    print(f'Wrote {result["schema"]}; state={result["state"]}; operational claims remain unqualified.')
    return 3 if result['state'] in {'partial', 'mismatch', 'blocked'} else 0


if __name__ == '__main__':
    raise SystemExit(main())
