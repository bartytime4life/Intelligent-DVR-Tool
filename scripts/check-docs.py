"""Check authored docs links, media integrity/budget and published test counts.

Standard library only. External URLs and historical-source claims are not fetched.
"""
import hashlib
import json
from pathlib import Path
import re
import runpy
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def check():
    errors = []
    docs = [ROOT / 'README.md', ROOT / 'SECURITY.md', ROOT / 'docs/README.md',
            ROOT / 'docs/verification/README.md',
            ROOT / 'docs/verification/facility-2026-10-27/README.md',
            ROOT / 'docs/verification/native-2026-10-28/README.md',
            ROOT / 'docs/verification/host-2026-10-28/README.md',
            ROOT / 'docs/verification/cuda-2026-10-28/README.md',
            ROOT / 'docs/verification/workers-2026-10-28/README.md',
            ROOT / 'docs/performance-100-cameras.md',
            ROOT / 'edge/README.md', ROOT / 'docs/third-party-notices.md',
            ROOT / 'docs/offline-qualification.md',
            *[ROOT / ('docs/' + n + '.md') for n in
              ('product-status', 'visual-tour', 'getting-started', 'architecture', 'roadmap', 'hardware-guide', 'gpu-planning', 'setup-linux', 'setup-windows', 'resource-controls', 'facility-builder', 'facility-setup-reliability', 'easy-facility-setup', 'map-measurements-and-shapes')],
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

    baseline = ROOT / 'docs/verification/facility-2026-10-27'
    receipt = json.loads((baseline / 'ci-results.json').read_text(encoding="utf-8"))
    excerpts = (baseline / 'ci-test-excerpts.log').read_text(encoding="utf-8")
    if not re.fullmatch(r'[0-9a-f]{40}', receipt['source_commit']) or receipt['source_commit'] not in excerpts:
        errors.append('Baseline source revision disagrees with CI excerpts')
    for platform, label in (('linux', 'Linux'), ('windows', 'Windows')):
        counts = receipt['platforms'][platform]
        marker = f"{label} job {counts['job_id']}\n"
        section = excerpts.split(marker, 1)[-1].split('\n\n', 1)[0] if marker in excerpts else ''
        for suite in ('frontend', 'packaging', 'python'):
            c = counts[suite]
            if any(not isinstance(c[k], int) or isinstance(c[k], bool) or c[k] < 0
                   for k in ('discovered', 'passed', 'failed', 'skipped')):
                errors.append(f'{platform}/{suite}: invalid test counts')
                continue
            if c['discovered'] != c['passed'] + c['failed'] + c['skipped'] or c['failed']:
                errors.append(f'{platform}/{suite}: skips/failures must not be counted as passes')
            if suite == 'python':
                ending = f"OK (skipped={c['skipped']})" if c['skipped'] else 'OK'
                if f"Ran {c['discovered']} tests" not in section or not any(line.endswith('Z ' + ending) for line in section.splitlines()):
                    errors.append(f'{platform}/python: counts disagree with CI excerpts')
            elif not all(f'# {key} {c[field]}' in section for key, field in
                         (('tests', 'discovered'), ('pass', 'passed'), ('fail', 'failed'), ('skipped', 'skipped'))):
                errors.append(f'{platform}/{suite}: counts disagree with CI excerpts')
        if counts['total_passed'] != sum(counts[s]['passed'] for s in ('frontend', 'packaging', 'python')):
            errors.append(f'{platform}: total passed disagrees with suite counts')
    browser = receipt['browser']
    marker = f"Chromium job {browser['job_id']}\n"
    section = excerpts.split(marker, 1)[-1] if marker in excerpts else ''
    if (browser['discovered'] != browser['passed'] + browser['failed'] + browser['skipped']
            or browser['failed'] or browser['skipped']
            or f"Running {browser['discovered']} tests" not in section
            or f"  {browser['passed']} passed (" not in section):
        errors.append('Browser counts disagree with CI excerpts')
    for key in ('scripted_draft_ms', 'scripted_correction_ms'):
        field = 'draftMs' if key == 'scripted_draft_ms' else 'correctionMs'
        if f'"{field}":{browser[key]}' not in section:
            errors.append(f'{key} disagrees with browser excerpt')
    if (browser['novice_study'] is not False or browser['accuracy_measured'] is not False
            or any(value != 'unqualified' for value in receipt['qualification'].values())):
        errors.append('Baseline software checks must retain unqualified operational dimensions')
    native = ROOT / 'docs/verification/native-2026-10-28'
    native_summary = json.loads((native / 'summary.json').read_text(encoding="utf-8"))
    native_log = (native / 'python-tests-verified-runtime.log').read_text(encoding="utf-8")
    counts = native_summary['checks']['python']
    if (counts['discovered'] != counts['passed'] or counts['failed'] or counts['skipped']
            or f"Ran {counts['discovered']} tests" not in native_log
            or not re.search(r'^OK\s*$', native_log, re.M)):
        errors.append('Native-runtime success counts disagree with the original log')
    model = json.loads((native / 'yolox-s-contract.json').read_text(encoding="utf-8"))
    recording = json.loads((native / 'yolox-s-recording.json').read_text(encoding="utf-8"))
    if (model['state'] != 'contract-smoke-passed' or model['recognition_accuracy'] != 'unmeasured'
            or recording['state'] != 'completed'
            or recording['frames_analyzed'] != native_summary['checks']['recording_frames']
            or any(v not in ('unqualified', 'unmeasured') for v in native_summary['qualification'].values())):
        errors.append('Native probe must retain its synthetic and unqualified evidence boundary')
    if errors:
        raise ValueError('\n'.join(errors))
    runpy.run_path(str(ROOT / 'docs/verification/host-2026-10-28/verify-results.py'))['check']()
    runpy.run_path(str(ROOT / 'docs/verification/cuda-2026-10-28/verify-results.py'))['check']()
    runpy.run_path(str(ROOT / 'docs/verification/workers-2026-10-28/verify-results.py'))['check']()
    print(f'Documentation checks passed: {links} local links, {len(manifest["assets"])} media hashes, {total:,} media bytes, test-count consistency.')


if __name__ == '__main__':
    try:
        check()
    except (OSError, ValueError, KeyError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
