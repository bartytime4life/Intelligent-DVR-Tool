"""Generate the GitHub Wiki companion from canonical repository documentation.

No network or publishing. Use --check to detect drift in committed mirrors.
"""
import argparse
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://github.com/bartytime4life/Intelligent-DVR-Tool'
RAW = 'https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/'
PAGES = {
    'README.md': 'Home',
    'docs/visual-tour.md': 'Visual-tour',
    'docs/getting-started.md': 'Getting-started',
    'docs/facility-builder.md': 'Facility-planning',
    'docs/map-measurements-and-shapes.md': 'Maps-and-shapes',
    'docs/architecture.md': 'Architecture-and-data',
    'docs/verification/2026-10-27/README.md': 'Evidence-and-validation',
    'docs/roadmap.md': 'Roadmap',
    'docs/hardware-guide.md': 'Hardware-guide',
    'docs/gpu-planning.md': 'GPU-planning',
    'docs/setup-linux.md': 'Linux-setup',
    'docs/setup-windows.md': 'Windows-setup',
    'docs/resource-controls.md': 'Resource-controls',
}


def generated():
    output = {}
    for source, title in PAGES.items():
        file = ROOT / source

        def rewrite(match):
            target = match[1]
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path:
                return match[0]
            resolved = (file.parent / parts.path).resolve().relative_to(ROOT).as_posix()
            if resolved in PAGES:
                url = BASE + '/wiki/' + PAGES[resolved]
            elif Path(resolved).suffix in ('.gif', '.webp', '.png', '.jpg'):
                url = RAW + resolved
            else:
                url = BASE + '/blob/main/' + resolved
            if parts.fragment:
                url += '#' + parts.fragment
            return '](' + url + ')'

        text = re.sub(r'\]\(([^)]+)\)', rewrite, file.read_text(encoding="utf-8"))
        text += f'\n---\n\n[Canonical source]({BASE}/blob/main/{source}) · Documentation refresh: October 27, 2026.\n'
        output[title + '.md'] = text
    output['_Sidebar.md'] = ('## Intelligent DVR\n\n' + '\n'.join(
        f'- [{title.replace("-", " ")}]({BASE}/wiki/{title})' for title in PAGES.values())
        + f'\n\n[Repository]({BASE}) · [Source documentation]({BASE}/tree/main/docs)\n')
    output['_Footer.md'] = (
        '**Prototype evidence boundary:** generated scenes and simulated rehearsal; '
        'live camera operation, representative accuracy and 100-camera capacity remain unqualified.\n\n'
        f'[Test evidence]({BASE}/wiki/Evidence-and-validation) · [Security boundary]({BASE}/blob/main/SECURITY.md)\n')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    dest = ROOT / 'docs/wiki'
    if not args.check:
        dest.mkdir(parents=True, exist_ok=True)
    for name, text in generated().items():
        path = dest / name
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != text:
                raise ValueError(f'Wiki mirror drift: {name}; run python3 scripts/build-wiki.py')
        else:
            path.write_text(text, encoding="utf-8", newline="\n")
    print(f'Wiki mirrors {"checked" if args.check else "generated"}: {len(generated())} files.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
