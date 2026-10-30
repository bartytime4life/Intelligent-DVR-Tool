"""Install, check and launch a foreground PC test setup without activating cameras."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = 'edge/requirements-qualification.txt'


class SetupError(Exception):
    pass


def host_check():
    if sys.platform not in ('linux', 'win32') or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise SetupError('This PC test kit supports Linux or Windows on x86-64.')
    if sys.version_info[:2] != (3, 12) or sys.maxsize <= 2**32:
        raise SetupError('Install 64-bit Python 3.12 with pip and venv support, then retry.')


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def verify_kit(root=ROOT):
    """Detect damaged/incomplete kits; this manifest is not a publisher signature."""
    path = root / 'pc-kit.json'
    if not path.exists():
        if not (root / 'package-lock.json').is_file() or not (root / 'src/main.jsx').is_file():
            raise SetupError('PC kit manifest is missing. Extract a fresh complete kit.')
        return 'source checkout'
    try:
        if path.is_symlink() or path.stat().st_size > 1024 * 1024:
            raise ValueError()
        data = json.loads(path.read_text(encoding='utf-8'))
        entries = data['files']
        if (data['schema'] != 'intelligent-dvr.pc-kit.v1' or
                not re.fullmatch('[a-f0-9]{40}', data['source_commit']) or
                not isinstance(entries, dict) or not 1 <= len(entries) <= 10000 or
                not {'edge/pc_setup.py', REQUIREMENTS, 'dist/client/index.html'} <= entries.keys()):
            raise ValueError()
        for name, expected in entries.items():
            relative = Path(name)
            if ('\\' in name or ':' in name or relative.is_absolute() or '..' in relative.parts or
                    not re.fullmatch('[a-f0-9]{64}', expected)):
                raise ValueError()
            file = root / relative
            if (any((root / part).is_symlink() for part in (relative, *relative.parents)) or
                    not file.resolve().is_relative_to(root.resolve()) or not file.is_file() or digest(file) != expected):
                raise ValueError()
        return data['source_commit']
    except (OSError, ValueError, TypeError, KeyError):
        raise SetupError('PC kit integrity check failed. Extract a fresh complete kit; keep local settings separately.') from None


def command(args, message, *, root=ROOT, timeout=900, capture=False):
    try:
        result = subprocess.run([str(x) for x in args], cwd=root, timeout=timeout,
                                capture_output=capture, text=capture)
    except (OSError, subprocess.TimeoutExpired):
        raise SetupError(message) from None
    if result.returncode:
        raise SetupError(message)
    return result.stdout if capture else None


def environment_python(root=ROOT):
    return root / '.venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')


def validate_environment(root=ROOT):
    python = environment_python(root)
    folder = root / '.venv'
    if folder.is_symlink() or (hasattr(folder, 'is_junction') and folder.is_junction()):
        raise SetupError('Use a real local .venv folder, not a linked environment.')
    if not python.is_file():
        raise SetupError('Local Python environment is missing. Run the installer first.')
    value = command([python, '-c', 'import json,sys; print(json.dumps([list(sys.version_info[:2]),sys.maxsize,sys.prefix]))'],
                    'Existing .venv cannot run. Use a fresh extracted folder and reinstall.',
                    root=root, timeout=15, capture=True)
    try:
        version, size, prefix = json.loads(value)
        if version != [3, 12] or size <= 2**32 or Path(prefix).resolve() != (root / '.venv').resolve():
            raise ValueError()
    except (TypeError, ValueError):
        raise SetupError('Existing .venv is incompatible. Keep it intact and install in a fresh folder.') from None
    return python


def create_settings(root=ROOT):
    try:
        fd = os.open(root / 'local-feeds.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return  # Never overwrite credentials or a user-maintained catalog.
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write('{"sources": []}\n')


def install(root=ROOT):
    host_check()
    if verify_kit(root) == 'source checkout':
        node, npm = shutil.which('node'), shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
        if not node or not npm:
            raise SetupError('Source installation needs Node.js 22 and npm; the prebuilt PC kit needs only Python 3.12.')
        major = command([node, '-p', 'process.versions.node.split(".")[0]'], 'Cannot run Node.js.', root=root, capture=True)
        if major.strip() != '22':
            raise SetupError('Use Node.js 22 for a source build, or install the prebuilt PC kit.')
        command([npm, 'ci'], 'Frontend dependency installation failed. Check network access and rerun.', root=root)
        command([npm, 'run', 'build'], 'Frontend build failed; correct the reported error and rerun.', root=root)
    folder = root / '.venv'
    if folder.is_symlink() or (hasattr(folder, 'is_junction') and folder.is_junction()):
        raise SetupError('Use a real local .venv folder, not a linked environment.')
    if not folder.exists():
        command([sys.executable, '-m', 'venv', root / '.venv'],
                'Could not create .venv. Install Python 3.12 venv/pip support and use a writable folder.', root=root)
    python = validate_environment(root)
    command([python, '-m', 'pip', 'install', '--only-binary=:all:', '-r', REQUIREMENTS],
            'Pinned runtime installation failed. Check network access and rerun; settings are preserved.', root=root)
    command([python, '-m', 'pip', 'check'], 'Python dependencies conflict. Install in a fresh folder.', root=root)
    create_settings(root)
    print('Installation complete. Run Check, then Start. No server, camera or analysis job was started.', flush=True)


def native_probe():
    # Bounded child only: no endpoint, trained model, recording or user path input.
    from . import analysis_worker
    analysis_worker.MEMORY_BYTES = 2 * 1024**3
    handle = analysis_worker.constrain()
    for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
        os.environ[key] = '1'
    os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'protocol_whitelist;file'
    versions = {}
    for line in (ROOT / REQUIREMENTS).read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        package, expected = line.split('==')
        actual = importlib.metadata.version(package)
        if actual != expected:
            raise SetupError('Pinned dependency mismatch. Rerun the installer in this folder.')
        versions[package] = actual
    import cv2
    import numpy as np
    cv2.setNumThreads(1)
    if not cv2.videoio_registry.hasBackend(cv2.CAP_FFMPEG):
        raise SetupError('OpenCV has no FFmpeg backend. Reinstall the pinned runtime.')
    with tempfile.TemporaryDirectory(prefix='dvr-install-probe-') as directory:
        path = str(Path(directory) / 'synthetic.avi')
        writer = cv2.VideoWriter(path, cv2.CAP_FFMPEG, cv2.VideoWriter_fourcc(*'MJPG'), 5, (64, 48))
        try:
            if not writer.isOpened():
                raise SetupError('The local synthetic video encoder could not open.')
            for value in (30, 80, 150):
                writer.write(np.full((48, 64, 3), value, dtype=np.uint8))
        finally:
            writer.release()
        capture = cv2.VideoCapture(path, cv2.CAP_FFMPEG)
        try:
            ok, frame = capture.read()
            if not ok or frame.shape != (48, 64, 3):
                raise SetupError('The local synthetic video decoder failed.')
            ok, jpeg = cv2.imencode('.jpg', frame)
            if not ok or cv2.imdecode(jpeg, cv2.IMREAD_COLOR) is None:
                raise SetupError('The local JPEG round trip failed.')
        finally:
            capture.release()
    return {'packages': versions, 'synthetic_codec': 'passed', 'worker_memory_limit': 'applied'}


def built_interface(root=ROOT):
    if not (root / 'dist/client/index.html').is_file() or not any((root / 'dist/client/assets').glob('*.js')):
        raise SetupError('Built interface is missing. Rerun installation or extract a complete kit.')
    return 'present'


def facility_command(port, open_browser=True, root=ROOT):
    if verify_kit(root) != 'source checkout':
        raise SetupError('Local geo delivery needs a source checkout with Node.js 22. For camera-kit testing, clear DVR_GEO_LOCAL and omit --facility.')
    built_interface(root)
    node, npm = shutil.which('node'), shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
    if not node or not npm or not (root / 'node_modules/vite/bin/vite.js').is_file():
        raise SetupError('Install the source checkout first; local geo preview needs Node.js 22 and npm dependencies.')
    major = command([node, '-p', 'process.versions.node.split(".")[0]'], 'Cannot run Node.js.', root=root, capture=True)
    if major.strip() != '22':
        raise SetupError('Use Node.js 22 for the source facility preview.')
    return [npm, 'run', 'preview', '--', '--host', '127.0.0.1', '--port', str(port), '--strictPort'] + (['--open'] if open_browser else [])


def persistence_check(directory):
    """Reuse store validation/recovery without creating, pruning or rewriting state."""
    from .result_store import ResultStore
    store = ResultStore(directory, inspect_only=True)
    try:
        job = store.job
        recovery = ('SERVICE_INTERRUPTED on start' if job and (job.get('error') or {}).get('code') == 'SERVICE_INTERRUPTED'
                    else job['state'] if job else 'no retained job')
        return {'mode': 'private-local-last-job', 'recovery': recovery,
                'free_bytes': shutil.disk_usage(store.directory if store.directory.exists() else store.directory.parent).free,
                'state_changed': False}
    finally:
        store.close()


def check(port=4173, feeds_config=None, recordings=None, config=None, *, root=ROOT, bind=True, facility=False, state_dir=None):
    host_check()
    checks = []
    def record(name, operation):
        try:
            checks.append({'check': name, 'status': 'pass', 'detail': operation()})
        except (SetupError, OSError, ValueError, TypeError, KeyError):
            checks.append({'check': name, 'status': 'fail'})
    record('kit_integrity', lambda: verify_kit(root))
    record('built_interface', lambda: built_interface(root))
    if facility:
        def facility_ready():
            facility_command(port, False, root)
            return 'source Vite route available; provider endpoints not contacted'
        record('facility_preview', facility_ready)
    def runtime():
        python = validate_environment(root)
        result = command([python, '-m', 'edge.pc_setup', '--native-probe'],
                         'Runtime probe failed. Rerun the installer.', root=root, timeout=30, capture=True)
        return json.loads(result)
    record('native_runtime', runtime)
    def temporary_storage():
        with tempfile.TemporaryDirectory(prefix='dvr-install-check-') as directory:
            path = Path(directory) / 'probe'
            path.write_bytes(b'local test')
            path.unlink()
        return 'temporary write and cleanup passed'
    record('temporary_storage', temporary_storage)
    def sources():
        from .local_feeds import load_sources
        path = Path(feeds_config) if feeds_config else root / 'local-feeds.json'
        return {'configured_sources': len(load_sources(path))}
    record('dvr_config', sources)
    if recordings or config:
        def analysis():
            from .local_service import Jobs, load_catalog
            if not recordings or not config:
                raise ValueError()
            catalog = load_catalog(Path(config).absolute())
            for item in catalog['models'].values():
                if digest(item['path']) != item['sha256']:
                    raise ValueError()
            job = Jobs(recordings, catalog)
            job.close()
            return {'models': len(catalog['models']), 'rules': len(catalog['rules'])}
        record('analysis_config', analysis)
    else:
        checks.append({'check': 'analysis_config', 'status': 'not_configured'})
    if state_dir is not None:
        def persistence():
            if not recordings or not config or facility:
                raise ValueError('Persistence requires recording analysis')
            return persistence_check(state_dir)
        record('analysis_persistence', persistence)
    else:
        checks.append({'check': 'analysis_persistence', 'status': 'disabled'})
    if bind:
        def loopback():
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                if sys.platform == 'linux':
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(('127.0.0.1', port))
                sock.listen(1)
            return 'loopback port available at check time; no requests served'
        record('loopback_port', loopback)
    return {'schema': 'intelligent-dvr.pc-readiness.v1',
            'ready': not any(c['status'] == 'fail' for c in checks),
            'checked_at_unix': int(time.time()), 'checks': checks,
            'physical_devices': 'not_tested', 'recognition_quality': 'not_measured'}


REMEDIES = {
    'facility_preview': 'Use a source checkout with Node.js 22 for local map services; clear DVR_GEO_LOCAL for the PC camera kit.',
    'kit_integrity': 'Extract a complete unmodified kit, or rebuild from a trusted source checkout.',
    'built_interface': 'Run the installer or extract a complete kit.',
    'native_runtime': 'Rerun the installer. If it persists, use a fresh folder and check Python 3.12/pip output.',
    'temporary_storage': 'Check free space and permissions on the operating system temporary directory.',
    'dvr_config': 'Check local-feeds.json against edge/local-feeds.example.json; an empty sources array is valid.',
    'analysis_config': 'Supply the recording folder and catalog together; verify local paths, model hash, labels and rules.',
    'analysis_persistence': 'Use --state-dir with recording analysis on Linux. Use a dedicated owner-owned 0700 folder, no symlinks, with an existing writable parent. Stop any other store owner. Preserve suspect state for inspection; --temporary bypasses it without deleting it.',
    'loopback_port': 'Close the existing app or choose an unused --port / -Port. Keep the origin stable for saved reviews.',
}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--install', action='store_true')
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--prepare-analysis', type=Path, metavar='MODEL_ONNX', help='Prepare local analysis from the pinned existing YOLOX-S model; no download or inference')
    modes.add_argument('--native-probe', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--feeds', action='store_true', help='Compatibility alias; the local feed service is the default')
    parser.add_argument('--analysis', action='store_true')
    parser.add_argument('--allow-recording-import', action='store_true', help='Enable explicit same-computer recording imports (64 MiB per file)')
    parser.add_argument('--facility', action='store_true', help='Source-only Vite preview, preserving opt-in local geo delivery')
    parser.add_argument('--feeds-config', type=Path, default=Path(os.environ.get('DVR_FEEDS_CONFIG') or ROOT / 'local-feeds.json'))
    parser.add_argument('--recordings', type=Path, default=os.environ.get('DVR_RECORDINGS') or None)
    parser.add_argument('--config', type=Path, default=os.environ.get('DVR_ANALYSIS_CONFIG') or None)
    retention = parser.add_mutually_exclusive_group()
    retention.add_argument('--state-dir', type=Path, help='Opt-in Linux last-analysis recovery in a dedicated private folder (or DVR_STATE_DIR)')
    retention.add_argument('--temporary', action='store_true', help='Disable recovery for this launch, overriding DVR_STATE_DIR; preserves saved state')
    parser.add_argument('--port', type=int, default=os.environ.get('DVR_PORT') or 4173)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--report', type=Path, help='New readiness report, without camera endpoints or credentials')
    args = parser.parse_args(argv)
    try:
        host_check()
        if args.native_probe:
            print(json.dumps(native_probe()))
            return 0
        if args.prepare_analysis:
            verify_kit()
            from .prepare_analysis import prepare
            try:
                prepare(args.prepare_analysis)
            except ValueError as exc:
                raise SetupError(str(exc)) from None
            print('Analysis prepared: pinned YOLOX-S, 80 class labels and whole-frame person-presence rules. No inference or camera was started.')
            print('Start with --analysis --allow-recording-import. Review the configured rules before use.')
            return 0
        if not 1024 <= args.port <= 65535:
            raise SetupError('Use a port from 1024 to 65535.')
        if args.analysis and not args.recordings and not args.config and (ROOT / 'local-analysis/catalog.json').is_file():
            args.recordings = ROOT / 'local-analysis/recordings'
            args.config = ROOT / 'local-analysis/catalog.json'
        if args.analysis and (not args.recordings or not args.config):
            raise SetupError('Supply --recordings and --config together for recording analysis.')
        if args.allow_recording_import and (not args.recordings or not args.config):
            raise SetupError('--allow-recording-import requires recording analysis configuration.')
        if args.report and not args.check:
            raise SetupError('--report is available with --check only.')
        state_dir = None if args.temporary else args.state_dir or (Path(os.environ['DVR_STATE_DIR']) if os.environ.get('DVR_STATE_DIR') and not args.install else None)
        if state_dir is not None:
            if sys.platform != 'linux':
                raise SetupError('Analysis recovery requires Linux. Use --temporary or clear DVR_STATE_DIR on Windows.')
            if args.install or args.native_probe:
                raise SetupError('Enable recovery with Start or Check, after installation. Install does not create or change retained state.')
            if not args.recordings or not args.config:
                raise SetupError('--state-dir / DVR_STATE_DIR requires --recordings and --config together.')
        if args.install:
            install()
            return 0
        facility = args.facility or os.environ.get('DVR_GEO_LOCAL') == '1'
        if facility and (state_dir is not None or args.analysis or args.feeds or args.recordings or args.config or
                         args.feeds_config.absolute() != (ROOT / 'local-feeds.json').absolute()):
            raise SetupError('Local geo preview and the camera/analysis service use separate launch modes. Clear DVR_GEO_LOCAL for camera/analysis testing.')
        if args.check:
            result = check(args.port, args.feeds_config, args.recordings, args.config, facility=facility, state_dir=state_dir)
            for item in result['checks']:
                print(f"{item['status'].upper()}: {item['check']}")
                if item['status'] == 'fail':
                    print('  ' + REMEDIES[item['check']])
                elif item['check'] == 'dvr_config':
                    print(f"  {item['detail']['configured_sources']} configured channels; none connected.")
                elif item['check'] == 'analysis_persistence' and item['status'] == 'pass':
                    print(f"  Recovery: {item['detail']['recovery']}; {item['detail']['free_bytes']} bytes free (not reserved). Saved state unchanged.")
            print('READY for explicit PC testing.' if result['ready'] else 'NOT READY. Correct failed checks and run Check again.')
            if args.report:
                with args.report.open('x', encoding='utf-8') as file:
                    json.dump(result, file, indent=2)
                    file.write('\n')
            return 0 if result['ready'] else 1
        if facility:
            preview = facility_command(args.port, not args.no_browser)
            print('Source facility preview: local geo follows DVR_GEO_LOCAL. Camera and analysis service APIs are separate.', flush=True)
            return subprocess.call(preview, cwd=ROOT)
        verify_kit()
        built_interface()
        python = validate_environment()
        if not args.feeds_config.is_file():
            raise SetupError('DVR config is missing. Run the installer to create an empty local-feeds.json.')
        service = [str(python), '-m', 'edge.local_service', '--feeds-config', str(args.feeds_config), '--port', str(args.port)]
        if args.recordings or args.config:
            if not args.recordings or not args.config:
                raise SetupError('Supply the recording folder and analysis catalog together.')
            service += ['--recordings', str(args.recordings), '--config', str(args.config)]
        if args.allow_recording_import:
            service.append('--allow-recording-import')
        if state_dir is not None:
            try:
                persistence_check(state_dir)
            except (OSError, ValueError, TypeError, KeyError):
                raise SetupError(REMEDIES['analysis_persistence']) from None
            service += ['--state-dir', str(state_dir)]
            print('Linux analysis recovery enabled: one last job; no automatic analysis or resume.', flush=True)
        else:
            print('Analysis recovery disabled: temporary results. Existing saved state is untouched.', flush=True)
        if not args.no_browser:
            service.append('--open-browser')
        if sys.platform == 'linux':
            os.execv(str(python), service)
        return subprocess.call(service, cwd=ROOT)
    except KeyboardInterrupt:
        return 130
    except (SetupError, OSError) as exc:
        print(str(exc) if isinstance(exc, SetupError) else
              'Local setup could not access a file or executable. Check permissions, free space and the installation folder.',
              file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
