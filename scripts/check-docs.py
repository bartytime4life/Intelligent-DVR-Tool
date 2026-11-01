"""Check authored docs links, media integrity/budget and published test counts.

Standard library only. External URLs and historical-source claims are not fetched.
"""
import hashlib
import json
from pathlib import Path
import re
import runpy
import sys
from xml.etree import ElementTree
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def check():
    errors = []
    docs = [ROOT / 'README.md', ROOT / 'SECURITY.md', ROOT / 'AGENTS.md',
            ROOT / 'edge/README.md', ROOT / 'design-qa.md', *sorted((ROOT / 'docs').rglob('*.md'))]
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

    # Keep new screenshot/illustration receipts independent from the dated 2026-10-27
    # media manifest: historical images and hashes must never be silently rewritten.
    current = json.loads((ROOT / 'docs/media/current/manifest.json').read_text(encoding='utf-8'))
    if current.get('schema') != 'intelligent-dvr.current-documentation-media.v1':
        errors.append('Invalid current documentation media manifest schema')
    if len(current.get('assets', [])) != 11:
        errors.append('Expected exactly 11 current screenshot/illustration assets')
    current_total = 0
    for entry in current.get('assets', []):
        rel = entry.get('path', '')
        destination = (ROOT / rel).resolve()
        if not destination.is_relative_to(ROOT / 'docs/media/current') or not destination.is_file():
            errors.append(f'Invalid or missing current-media path: {rel}')
            continue
        raw = destination.read_bytes()
        current_total += len(raw)
        sha = hashlib.sha1(f'blob {len(raw)}\0'.encode('utf-8') + raw).hexdigest()
        if len(raw) != entry.get('bytes') or sha != entry.get('git_blob_sha1'):
            errors.append(f'Current media integrity mismatch: {rel}')
        if entry.get('realCameraFootage') is not False:
            errors.append(f'Current documentation image may not claim real camera footage: {rel}')
        if destination.suffix == '.jpg':
            if not (raw.startswith(b'\xff\xd8') and raw.endswith(b'\xff\xd9')):
                errors.append(f'Not a bounded JPEG screenshot: {rel}')
            if entry.get('kind') != 'actual-browser-screenshot':
                errors.append(f'Unexpected screenshot type: {rel}')
        elif destination.suffix == '.svg':
            if entry.get('kind') != 'original-schematic-svg':
                errors.append(f'Unlabeled SVG illustration: {rel}')
            try:
                document = ElementTree.fromstring(raw)
                if document.tag != '{http://www.w3.org/2000/svg}svg' or document.get('viewBox') is None:
                    raise ValueError('Missing SVG root or viewBox')
                if any(element.tag.rsplit('}', 1)[-1] in ('script', 'foreignObject', 'image', 'use')
                       or any(key.startswith('on') for key in element.attrib)
                       or any(key.endswith('}href') or key == 'href' for key in element.attrib)
                       for element in document.iter()):
                    raise ValueError('Script, remote image, href, handler or foreignObject in static illustration')
            except (ElementTree.ParseError, ValueError) as exc:
                errors.append(f'Unsafe or malformed SVG: {rel}: {exc}')
        else:
            errors.append(f'Unknown current-media extension: {rel}')
    if current_total > 350_000:
        errors.append('Current documentation visual assets exceed 350 KiB budget')

    guide = json.loads((ROOT / 'docs/media/guide/manifest.json').read_text(encoding='utf-8'))
    if guide.get('schema') != 'intelligent-dvr.visual-guide-media.v1':
        errors.append('Invalid visual guide manifest schema')
    guide_total, guide_paths, kinds = 0, set(), {}
    for entry in guide.get('assets', []):
        rel = entry.get('path', '')
        path = (ROOT / rel).resolve()
        if not path.is_relative_to(ROOT / 'docs/media/guide') or not path.is_file() or rel in guide_paths:
            errors.append(f'Invalid, duplicate or missing guide image: {rel}')
            continue
        guide_paths.add(rel)
        raw = path.read_bytes()
        guide_total += len(raw)
        kind = entry.get('kind')
        kinds[kind] = kinds.get(kind, 0) + 1
        if len(raw) != entry.get('bytes') or hashlib.sha256(raw).hexdigest() != entry.get('sha256'):
            errors.append(f'Guide image integrity mismatch: {rel}')
        if entry.get('realCameraFootage') is not False:
            errors.append(f'Guide image must not claim actual camera footage: {rel}')
        if path.suffix == '.jpg':
            if not (raw.startswith(b'\xff\xd8') and raw.endswith(b'\xff\xd9')):
                errors.append(f'Invalid guide JPEG: {rel}')
            if kind not in ('actual-browser-screenshot', 'ai-concept-illustration'):
                errors.append(f'Unlabeled guide JPEG: {rel}')
            if kind == 'actual-browser-screenshot' and entry.get('source_commit') != '2566d845fbbc7b9f54f98441009a604f2fa513ce':
                errors.append(f'Missing capture revision: {rel}')
            if kind == 'ai-concept-illustration' and entry.get('mode') != 'built-in-imagegen-generate':
                errors.append(f'Missing generated-art provenance: {rel}')
        elif path.suffix == '.svg':
            try:
                svg = ElementTree.fromstring(raw)
                if (kind != 'original-schematic-svg' or svg.tag != '{http://www.w3.org/2000/svg}svg'
                        or not svg.get('viewBox') or svg.find('{http://www.w3.org/2000/svg}title') is None
                        or svg.find('{http://www.w3.org/2000/svg}desc') is None):
                    raise ValueError('Missing accessible static SVG metadata')
                if any(e.tag.rsplit('}', 1)[-1] in ('script', 'foreignObject', 'image', 'use')
                       or any(k.startswith('on') or k.endswith('}href') or k == 'href' for k in e.attrib)
                       for e in svg.iter()):
                    raise ValueError('Active or linked SVG content')
            except (ElementTree.ParseError, ValueError) as exc:
                errors.append(f'Unsafe or malformed guide SVG: {rel}: {exc}')
        else:
            errors.append(f'Unexpected guide media: {rel}')
    actual_paths = {p.relative_to(ROOT).as_posix() for p in (ROOT / 'docs/media/guide').iterdir()
                    if p.suffix in ('.jpg', '.svg')}
    if guide_paths != actual_paths or kinds != {'actual-browser-screenshot': 12, 'original-schematic-svg': 10, 'ai-concept-illustration': 1}:
        errors.append('Guide manifest must cover exactly twelve screenshots, ten diagrams and one conceptual hero')
    if guide_total > 2_000_000:
        errors.append('Visual guide images exceed the independent 2 MB budget')

    graphics = runpy.run_path(str(ROOT / 'scripts/build-guide-graphics.py'))
    for name, args in graphics['GUIDES'].items():
        expected = graphics['build'](name, *args)
        path = ROOT / 'docs/media/guide' / (name + '.svg')
        if not path.is_file() or path.read_text(encoding='utf-8') != expected:
            errors.append(f'Guide graphic generator drift: {name}')

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
    runpy.run_path(str(ROOT / 'docs/verification/recovery-2026-10-28/verify-results.py'))['check']()
    runpy.run_path(str(ROOT / 'docs/verification/journal-2026-10-28/verify-results.py'))['check']()
    runpy.run_path(str(ROOT / 'docs/verification/batching-2026-10-28/verify-results.py'))['check']()
    runpy.run_path(str(ROOT / 'docs/verification/durable-overload-2026-10-28/verify-results.py'))['check']()
    print(f'Documentation checks passed: {links} local links, {len(manifest["assets"])} historical media hashes, {len(current["assets"])} current visual blobs, {total:,} historical + {current_total:,} PR61 + {guide_total:,} guide media bytes, test-count consistency.')


if __name__ == '__main__':
    try:
        check()
    except (OSError, ValueError, KeyError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
