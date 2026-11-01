"""Repeatable Apple silicon source install, readiness check and foreground launch.

No model downloads, camera connections or automatic analysis jobs. Local models,
recordings, templates, tuned rules and credentials are never replaced by install.
"""
import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sys

from . import pc_setup as pc

ROOT = Path(__file__).resolve().parents[1]


def host_check():
    if sys.platform != 'darwin':
        raise pc.SetupError('Use the Mac entry points on an Apple silicon Mac source checkout.')
    pc.host_check()


def frontend_fingerprint(root):
    # Include deletions, changed dependencies, build scripts and hosting inputs.
    files = [root / name for name in ('index.html', 'package.json', 'package-lock.json',
             'vite.config.mjs', 'scripts/prepare-sites-build.mjs', '.openai/hosting.json', 'worker/index.js')]
    for folder in ('src', 'public'):
        files.extend(p for p in (root / folder).rglob('*') if p.is_file())
    digest = hashlib.sha256()
    for file in sorted(files):
        digest.update(file.relative_to(root).as_posix().encode() + b'\0')
        digest.update(hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


def stamp_matches(path, expected):
    return path.is_file() and path.read_text(encoding='utf-8').strip() == expected


def ensure_frontend(root=ROOT):
    node, npm = shutil.which('node'), shutil.which('npm')
    if not node or not npm:
        raise pc.SetupError('Install Node.js 22 and npm, then run Install-Mac.command.')
    version = pc.command([node, '-p', 'process.versions.node.split(".")[0]'],
                         'Cannot run Node.js.', root=root, capture=True)
    if version.strip() != '22':
        raise pc.SetupError('Use Node.js 22 for the Mac source build.')
    modules = root / 'node_modules'
    if modules.is_symlink():
        raise pc.SetupError('Use a local node_modules folder, not a linked directory.')
    lock = hashlib.sha256((root / 'package-lock.json').read_bytes()).hexdigest()
    installed = modules / '.dvr-lock.sha256'
    if not stamp_matches(installed, lock):
        pc.command([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                   'Interface dependency installation failed; rerun Start after correcting the error.', root=root)
        installed.write_text(lock+'\n', encoding='utf-8')
        # An existing build must be refreshed after reinstalling dependencies.
        (root / 'dist/.mac-source.sha256').unlink(missing_ok=True)
    signature = frontend_fingerprint(root)
    stamp = root / 'dist/.mac-source.sha256'
    if not (root / 'dist/client/index.html').is_file() or not stamp_matches(stamp, signature):
        stamp.unlink(missing_ok=True)
        pc.command([npm, 'run', 'build'], 'Interface build failed; no service was started.', root=root)
        stamp.write_text(signature+'\n', encoding='utf-8')
    return npm


def analysis_options(root=ROOT):
    folder = root / 'local-analysis'
    config = folder / 'catalog.json'
    if folder.is_symlink():
        raise pc.SetupError('Use a real local-analysis folder, not a linked directory. Existing files were preserved.')
    if not config.exists():
        if folder.exists() or folder.is_symlink():
            raise pc.SetupError('local-analysis is incomplete. Preserve it and repair the catalog; setup never overwrites it.')
        return []
    from .local_service import Jobs, load_catalog
    try:
        catalog = load_catalog(config)
        for model in catalog['models'].values():
            if pc.digest(model['path']) != model['sha256']:
                raise ValueError('Model fingerprint mismatch')
        jobs = Jobs(folder / 'recordings', catalog, training_dir=folder / 'trained',
                    people_dir=folder / 'people' if 'faces' in catalog else None)
        jobs.close()
    except (OSError, ValueError, KeyError, TypeError):
        raise pc.SetupError('Local analysis configuration failed verification. Preserve local-analysis and check its model hashes, paths, labels and rules.') from None
    options = ['--recordings', str(folder / 'recordings'), '--config', str(config),
               '--allow-recording-import', '--allow-training']
    if 'faces' in catalog:
        options.append('--allow-face-enrollment')
    return options


def ensure_port_available(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(('127.0.0.1', port))
            sock.listen(1)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            raise pc.SetupError(f'Port {port} is already in use. Open http://127.0.0.1:{port}/ if your DVR is running. '
                                'To use this checkout instead, stop the older DVR terminal with Ctrl+C, then reopen Start-Mac.command. '
                                'No process was stopped. Keep the same address to retain browser saves.') from None
        raise pc.SetupError('Cannot bind the local port. Check local permissions and retry.') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--install', action='store_true')
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--prepare-analysis', type=Path, metavar='MODEL_ONNX')
    parser.add_argument('--face-detector', type=Path)
    parser.add_argument('--face-recognizer', type=Path)
    parser.add_argument('--port', type=int, default=os.environ.get('DVR_PORT') or 4180)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--skip-port-check', action='store_true', help='With --check only: inspect an installation while its service is running')
    parser.add_argument('--report', type=Path, help='With --check: create a new redacted readiness report')
    args = parser.parse_args(argv)
    try:
        host_check()
        if not 1024 <= args.port <= 65535:
            raise pc.SetupError('Use a port from 1024 to 65535.')
        if (args.face_detector or args.face_recognizer) and not args.prepare_analysis:
            raise pc.SetupError('Use face model paths with --prepare-analysis in a fresh installation.')
        if (args.report or args.skip_port_check) and not args.check:
            raise pc.SetupError('--report and --skip-port-check are available with --check only.')
        if args.install:
            pc.install(ROOT)
            (ROOT / 'node_modules/.dvr-lock.sha256').write_text(pc.digest(ROOT / 'package-lock.json')+'\n', encoding='utf-8')
            (ROOT / 'dist/.mac-source.sha256').write_text(frontend_fingerprint(ROOT)+'\n', encoding='utf-8')
            return 0
        if args.prepare_analysis:
            from .prepare_analysis import prepare
            prepare(args.prepare_analysis, root=ROOT, face_detector=args.face_detector, face_recognizer=args.face_recognizer)
            print('Local analysis prepared from verified models. Existing installations are never replaced. Run Check-Mac.command next.')
            return 0
        if args.check:
            options = analysis_options()
            result = pc.check(args.port, root=ROOT, bind=not args.skip_port_check,
                              recordings=ROOT / 'local-analysis/recordings' if options else None,
                              config=ROOT / 'local-analysis/catalog.json' if options else None)
            for item in result['checks']:
                print(f"{item['status'].upper()}: {item['check']}")
                if item['status'] in ('fail', 'warn'):
                    print('  '+pc.REMEDIES[item['check']])
            if args.skip_port_check:
                print('Port availability was not checked; the current server was left running.')
            print(('READY for local analysis and guided training.' if options else
                   'READY for interface/preview testing; local analysis is not configured.') if result['ready'] else
                  'NOT READY. Correct failed checks and run Check again.')
            if args.report:
                fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'w', encoding='utf-8') as output:
                    json.dump(result, output, indent=2)
                    output.write('\n')
            return 0 if result['ready'] else 1
        # Diagnose a duplicate launch before installing or rebuilding anything.
        ensure_port_available(args.port)
        options = analysis_options()
        python = pc.validate_environment(ROOT) if options else None
        if python:
            pc.command([python, '-m', 'edge.pc_setup', '--native-probe'],
                       'Local Python runtime is not ready. Run Install-Mac.command, then Check-Mac.command.',
                       root=ROOT, timeout=30, capture=True)
        npm = ensure_frontend()
        if not options:
            print('Local analysis is not configured; serving the interface only. See docs/setup-macos.md.', flush=True)
            command = [npm, 'run', 'preview', '--', '--host', '127.0.0.1', '--port', str(args.port), '--strictPort']
            if not args.no_browser:
                command.append('--open')
        else:
            pc.create_settings(ROOT)
            command = [str(python), '-m', 'edge.local_service', '--feeds-config', str(ROOT / 'local-feeds.json'),
                       *options, '--port', str(args.port)]
            if not args.no_browser:
                command.append('--open-browser')
        os.execv(str(command[0]), [str(x) for x in command])
        return 0
    except KeyboardInterrupt:
        return 130
    except (pc.SetupError, OSError, ValueError) as exc:
        print(str(exc) if isinstance(exc, (pc.SetupError, ValueError)) else
              'Could not access local setup files. Check permissions and free space; existing data was preserved.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
