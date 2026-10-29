"""Build a small cross-platform PC test kit from an already-built trusted checkout."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FIXED = (
    'edge/requirements-qualification.txt', 'edge/local-feeds.example.json', 'edge/public-webcams.example.json',
    'edge/local-analysis.example.json', 'edge/rules.example.json',
    'edge/candidates/opencv-zoo-yolox-s-2022nov.json',
    'scripts/run-linux.sh', 'scripts/Start-IntelligentDvr.ps1',
    'Install-Windows.cmd', 'Check-Windows.cmd', 'Start-Windows.cmd',
)


def collect(root=ROOT):
    files = {name: root / name for name in FIXED}
    for pattern in ('edge/*.py', 'edge/labels/*.json', 'dist/client/**/*'):
        for file in root.glob(pattern):
            if file.is_file():
                files[file.relative_to(root).as_posix()] = file
    files['START-HERE.md'] = root / 'docs/pc-testing.md'
    if 'dist/client/index.html' not in files or not any(n.startswith('dist/client/assets/') and n.endswith('.js') for n in files):
        raise ValueError('Run npm ci and npm run build before packaging.')
    for name, file in files.items():
        if (file.is_symlink() or not file.is_file() or
                not file.resolve().is_relative_to(root.resolve())):
            raise ValueError('Unsafe or missing package input: ' + name)
    return {name: file.read_bytes() for name, file in sorted(files.items())}


def build(output, revision, root=ROOT):
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise ValueError('Supply the exact 40-character source commit.')
    files = collect(root)
    manifest = {'schema': 'intelligent-dvr.pc-kit.v1', 'source_commit': revision,
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
                'weights_included': False, 'device_qualification': 'not_established_by_packaging'}
    files['pc-kit.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents an accidental overwrite of a reviewed kit.
    with output.open('xb') as target, zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            item = zipfile.ZipInfo('Intelligent-DVR-PC/' + name, date_time=(2026, 10, 29, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = (0o100755 if name.endswith('.sh') else 0o100644) << 16
            archive.writestr(item, data)
    sha = hashlib.sha256(output.read_bytes()).hexdigest()
    with output.with_suffix('.zip.sha256').open('x', encoding='utf-8', newline='\n') as file:
        file.write(sha + '  ' + output.name + '\n')
    return {'archive': output.name, 'sha256': sha, 'source_commit': revision, 'files': len(files)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.revision)))
