"""Generate Wiki mirrors; optionally stage public pages/media in a verified clone.

No network, commits or publishing. --check verifies exact generated content.
"""
import argparse
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://github.com/bartytime4life/Intelligent-DVR-Tool'
WIKI_RAW = 'https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/'
PAGES = {
    'README.md': 'Home',
    'docs/README.md': 'Guide-index',
    'docs/how-to.md': 'Visual-handbook',
    'docs/getting-started.md': 'Getting-started',
    'docs/visual-atlas.md': 'Visual-atlas',
    'docs/product-status.md': 'Product-status',
    'docs/setup-macos.md': 'Mac-setup',
    'docs/pc-testing.md': 'PC-testing',
    'docs/setup-linux.md': 'Linux-setup',
    'docs/setup-windows.md': 'Windows-setup',
    'docs/troubleshooting.md': 'Troubleshooting',
    'docs/local-camera-feeds.md': 'Camera-sources',
    'docs/public-webcams.md': 'Public-webcams',
    'docs/live-detection.md': 'Live-AI-and-tracking',
    'docs/recording-workflow.md': 'Recording-workflow',
    'docs/local-analysis-service.md': 'Local-analysis-service',
    'docs/recording-recognition.md': 'Recognition-details',
    'docs/recording-coverage.md': 'Recording-coverage',
    'docs/lan-recording.md': 'LAN-recording',
    'docs/review-and-events.md': 'Review-and-events',
    'docs/zones.md': 'Zones',
    'docs/training.md': 'Guided-training',
    'docs/person-enrollment.md': 'Person-enrollment',
    'docs/enhancement-comparison.md': 'Enhancement-comparison',
    'docs/facility-builder.md': 'Facility-planning',
    'docs/saved-facilities.md': 'Saved-facilities',
    'docs/map-measurements-and-shapes.md': 'Maps-and-shapes',
    'docs/facility-setup-reliability.md': 'Facility-setup-reliability',
    'docs/facility-local-delivery.md': 'Local-map-services',
    'docs/facility-novice-study.md': 'Facility-study-kit',
    'docs/facility-image-diagnostics.md': 'Image-diagnostics',
    'docs/facility-calibration.md': 'Planar-calibration',
    'docs/resource-controls.md': 'Resource-controls',
    'docs/hardware-guide.md': 'Hardware-guide',
    'docs/gpu-planning.md': 'GPU-planning',
    'docs/performance-100-cameras.md': '100-camera-plan',
    'docs/field-acceptance.md': 'Field-acceptance',
    'docs/offline-evaluation.md': 'Offline-evaluation',
    'docs/offline-qualification.md': 'Offline-qualification',
    'docs/pilot-scope.md': 'Pilot-scope',
    'docs/architecture.md': 'Architecture-and-data',
    'edge/README.md': 'Edge-CLI',
    'SECURITY.md': 'Security-boundary',
    'docs/third-party-notices.md': 'Third-party-notices',
    'docs/verification/README.md': 'Evidence-and-validation',
    'docs/roadmap.md': 'Roadmap',
    'docs/media/guide/README.md': 'Visual-provenance',
    'docs/media/current/README.md': 'PR61-visual-provenance',
    'docs/media/README.md': 'Historical-visual-provenance',
    'docs/wiki/README.md': 'Wiki-publication',
    'docs/visual-tour.md': 'Visual-tour',
    'docs/easy-facility-setup.md': 'Facility-setup-research',
    'docs/facility-workspace-upgrades.md': 'Facility-upgrades-2026-10-29',
    'docs/experience-review-2026-10-29.md': 'Experience-review-2026-10-29',
    'docs/review-2026-10-30.md': 'Review-2026-10-30',
    'docs/project-assessment-2026-10-30.md': 'Assessment-2026-10-30',
    'docs/workspace-ux-audit-2026-10-31.md': 'Workspace-audit-2026-10-31',
    'docs/model-qualification-20261026.md': 'Model-qualification-2026-10-26',
}
GROUPS = {
    'Start here': ['Home', 'Visual-handbook', 'Guide-index', 'Getting-started', 'Visual-atlas', 'Product-status'],
    'Install and recover': ['Mac-setup', 'PC-testing', 'Linux-setup', 'Windows-setup', 'Troubleshooting'],
    'Connect, analyze, review': ['Camera-sources', 'Public-webcams', 'Live-AI-and-tracking', 'Recording-workflow', 'Local-analysis-service', 'Recognition-details', 'Recording-coverage', 'LAN-recording', 'Review-and-events', 'Zones'],
    'Train': ['Guided-training', 'Person-enrollment', 'Enhancement-comparison'],
    'Plan the facility': ['Facility-planning', 'Saved-facilities', 'Maps-and-shapes', 'Facility-setup-reliability', 'Local-map-services', 'Facility-study-kit', 'Image-diagnostics', 'Planar-calibration'],
    'Plan and qualify the machine': ['Resource-controls', 'Hardware-guide', 'GPU-planning', '100-camera-plan', 'Field-acceptance', 'Offline-evaluation', 'Offline-qualification', 'Pilot-scope'],
    'Engineering and evidence': ['Architecture-and-data', 'Edge-CLI', 'Security-boundary', 'Third-party-notices', 'Evidence-and-validation', 'Roadmap', 'Visual-provenance', 'Wiki-publication'],
    'Dated records': ['Visual-tour', 'PR61-visual-provenance', 'Historical-visual-provenance', 'Facility-setup-research', 'Facility-upgrades-2026-10-29', 'Experience-review-2026-10-29', 'Review-2026-10-30', 'Assessment-2026-10-30', 'Workspace-audit-2026-10-31', 'Model-qualification-2026-10-26'],
}
MEDIA_SUFFIXES = {'.gif', '.webp', '.png', '.jpg', '.svg'}
LINK = re.compile(r'\]\(([^)]+)\)')


def validate_ref(source_ref):
    if source_ref != 'main' and not re.fullmatch(r'[0-9a-f]{40}', source_ref):
        raise ValueError('Source ref must be main or a complete commit SHA')


def source_link(source, source_ref):
    return BASE + '/blob/' + source_ref + '/' + quote(source, safe='/')


def generated(source_ref='main'):
    validate_ref(source_ref)
    output, assets = {}, set()
    for source, title in PAGES.items():
        file = ROOT / source

        def rewrite(match):
            target = match[1].strip().strip('<>')
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path:
                return match[0]
            destination = (file.parent / unquote(parts.path)).resolve()
            if not destination.is_relative_to(ROOT) or not destination.is_file():
                raise ValueError(f'{source}: missing or outside-repository link {target}')
            resolved = destination.relative_to(ROOT).as_posix()
            if resolved in PAGES:
                url = BASE + '/wiki/' + PAGES[resolved]
            elif destination.suffix in MEDIA_SUFFIXES:
                if not destination.is_relative_to(ROOT / 'docs/media'):
                    raise ValueError(f'Wiki media must be reviewed public documentation media: {resolved}')
                assets.add(resolved)
                url = WIKI_RAW + quote(resolved, safe='/')
            else:
                url = source_link(resolved, source_ref)
            if parts.fragment:
                url += '#' + parts.fragment
            return '](' + url + ')'

        text = LINK.sub(rewrite, file.read_text(encoding='utf-8'))
        text += f'\n---\n\n[Canonical source]({source_link(source, source_ref)}) · Generated companion; dated evidence, examples and illustrations retain their labels.\n'
        output[title + '.md'] = text
    ordered = [title for group in GROUPS.values() for title in group]
    if len(ordered) != len(set(ordered)) or set(ordered) != set(PAGES.values()):
        raise ValueError('Every Wiki page must appear once in task navigation')
    output['_Sidebar.md'] = '# Intelligent DVR\n\n' + '\n\n'.join(
        '### ' + group + '\n\n' + '\n'.join(
            f'- [{title.replace("-", " ")}]({BASE}/wiki/{title})' for title in titles)
        for group, titles in GROUPS.items()) + f'\n\n[Repository]({BASE})\n'
    output['_Footer.md'] = (
        '**Local pilot:** previews, bounded recording analysis, guided tuning and consent-based possible matches require explicit actions. '
        'Physical-device accuracy, sustained operation and 100-camera capacity remain unqualified.\n\n'
        f'[Handbook]({BASE}/wiki/Visual-handbook) · [Troubleshooting]({BASE}/wiki/Troubleshooting) · '
        f'[Evidence]({BASE}/wiki/Evidence-and-validation) · [Security]({BASE}/wiki/Security-boundary)\n')
    return output, assets


def wiki_target(path):
    target = Path(path).absolute()
    if target.is_symlink() or not target.is_dir() or not (target / '.git').is_dir():
        raise ValueError('Wiki destination must be an existing non-symlink Git clone')
    target = target.resolve()
    top = subprocess.check_output(['git', '-C', str(target), 'rev-parse', '--show-toplevel'], text=True).strip()
    origin = subprocess.check_output(['git', '-C', str(target), 'remote', 'get-url', 'origin'], text=True).strip()
    if Path(top).resolve() != target or origin not in (
            BASE + '.wiki.git', 'git@github.com:bartytime4life/Intelligent-DVR-Tool.wiki.git'):
        raise ValueError('Refusing destination: expected this project’s separate .wiki.git clone')
    return target


def write_files(dest, files, check=False):
    # Preflight the entire write set before changing any file. Preserve unknown pages.
    for rel in files:
        path = dest / rel
        if not path.resolve().is_relative_to(dest.resolve()):
            raise ValueError(f'Outside destination: {rel}')
        if any(p.is_symlink() for p in (path, *(dest / p for p in Path(rel).parents))):
            raise ValueError(f'Symlink destination: {rel}')
    for rel, raw in files.items():
        path = dest / rel
        if check:
            if not path.is_file() or path.read_bytes() != raw:
                raise ValueError(f'Wiki drift: {rel}; regenerate or stage the matching source')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--wiki-dir', help='Stage pages and referenced public images in the project Wiki clone')
    parser.add_argument('--source-ref', default='main', help='Canonical source links: main or full published commit SHA')
    args = parser.parse_args()
    output, assets = generated(args.source_ref)
    files = {name: text.encode('utf-8') for name, text in output.items()}
    dest = wiki_target(args.wiki_dir) if args.wiki_dir else ROOT / 'docs/wiki'
    if args.wiki_dir:
        files.update({rel: (ROOT / rel).read_bytes() for rel in sorted(assets)})
    write_files(dest, files, args.check)
    print(f'Wiki {"checked" if args.check else "staged" if args.wiki_dir else "generated"}: {len(output)} pages/navigation files' +
          (f', {len(assets)} public images.' if args.wiki_dir else '.'))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
