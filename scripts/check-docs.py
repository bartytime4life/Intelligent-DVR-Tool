"""Check authored docs links, media integrity/budget and published test counts.

Standard library only. External URLs and historical-source claims are not fetched.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def check():
    errors = []
    docs = [ROOT / 'README.md', ROOT / 'docs/README.md',
            *[ROOT / ('docs/' + n + '.md') for n in
              ('visual-tour', 'getting-started', 'architecture', 'roadmap', 'hardware-guide', 'gpu-planning', 'setup-linux', 'setup-windows', 'resource-controls')],
            ROOT / 'docs/media/README.md', ROOT / 'docs/wiki/README.md',
            ROOT / 'docs/verification/2026-10-27/README.md',
            ROOT / 'docs/verification/hardware-2026-10-27/README.md',
            *sorted((ROOT / 'docs/wiki').glob('*.md'))]
    links = 0
    for file in set(docs):
        if not file.is_file():
            errors.append(f'Missing documentation: {file.relative_to(ROOT)}')
            continue
        content = re.sub(r'```.*?```', '', file.read_text(encoding="utf-8"), flags=re.S)
        for target in re.findall(r'\]\(([^)]+)\)', content):
            target = target.strip().strip('<>')
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path:
                continue
            links += 1
            destination = (file.parent / unquote(parts.path)).resolve()
            if not destination.is_relative_to(ROOT) or not destination.exists():
                errors.append(f'{file.relative_to(ROOT)}: broken local link {target}')
            elif parts.fragment and destination.suffix == '.md':
                headings = []
                for heading in re.findall(r'^#{1,6}\s+(.+)$', destination.read_text(encoding="utf-8"), re.M):
                    headings.append(re.sub(r'[^\w\- ]', '', heading.lower()).replace(' ', '-'))
                if unquote(parts.fragment) not in headings:
                    errors.append(f'{file.relative_to(ROOT)}: missing heading {target}')

    manifest = json.loads((ROOT / 'docs/media/manifest.json').read_text(encoding="utf-8"))
    total = 0
    for entry in manifest['assets']:
        p = ROOT / entry['path']
        raw = p.read_bytes()
        if len(raw) != entry['bytes'] or hashlib.sha256(raw).hexdigest() != entry['sha256']:
            errors.append(f'Media integrity mismatch: {entry["path"]}')
        if p.suffix == '.gif' and not raw.startswith((b'GIF87a', b'GIF89a')):
            errors.append(f'Invalid GIF signature: {p.name}')
        if p.suffix == '.webp' and not (raw[:4] == b'RIFF' and raw[8:12] == b'WEBP'):
            errors.append(f'Invalid WebP signature: {p.name}')
        total += len(raw)
    if total > 3_000_000:
        errors.append('Published documentation media exceeds the 3 MB budget.')

    v = ROOT / 'docs/verification/2026-10-27'
    result = json.loads((v / 'summary.json').read_text(encoding="utf-8"))
    for name in ('node', 'sites'):
        log = (v / (name + '-tests.log')).read_text(encoding="utf-8")
        if f'# pass {result[name]["passed"]}\n' not in log or '# fail 0\n' not in log:
            errors.append(f'{name} result disagrees with test log')
    log = (v / 'python-tests.log').read_text(encoding="utf-8")
    p = result['python']
    if f'Ran {p["run"]} tests' not in log or f'OK (skipped={p["skipped"]})' not in log or p['passed'] + p['skipped'] != p['run']:
        errors.append('Python counts disagree with the test log')
    for name in ('overloaded', 'idealized'):
        report = json.loads((v / (name + '.json')).read_text(encoding="utf-8"))
        if report['qualification']['concurrent_camera_capacity'] != 'unqualified':
            errors.append('Simulation must not claim qualified camera capacity')
    if errors:
        raise ValueError('\n'.join(errors))
    print(f'Documentation checks passed: {links} local links, {len(manifest["assets"])} media hashes, {total:,} media bytes, test-count consistency.')


if __name__ == '__main__':
    try:
        check()
    except (OSError, ValueError, KeyError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
