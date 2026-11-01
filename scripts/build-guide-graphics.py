"""Build the editable vector workflow illustrations used by the operator guides."""
from html import escape
from pathlib import Path
import argparse
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/media/guide'
GUIDES = {
    'start': ('START WITH A READY COMPUTER', 'Install. Check. Start.', 'Software setup comes before a camera or an analysis job.', [
        ('Install', 'Install-Mac / Install-Windows', 'Linux: --install', 'Keep existing private settings', 'server'),
        ('Check', 'Run the readiness check', 'Resolve failed checks first', 'No device connections made', 'check'),
        ('Start', 'Open the printed local address', 'Keep the terminal running', 'Connect a source deliberately', 'screen')]),
    'sources': ('MONITOR / CHOOSE ONE SOURCE', 'Three doors into Monitor', 'A preview connects only after your explicit choice.', [
        ('Computer webcam', 'Built-in or USB camera', 'Approve camera permission', 'Microphone stays off', 'camera'),
        ('Local DVR / IP camera', 'Configure a private LAN channel', 'Load the list, then connect', 'Check host, credentials and path', 'server'),
        ('Approved public webcam', 'Choose a permitted HTTPS source', 'Keep provider attribution', 'Respect the provider’s usage terms', 'screen')]),
    'recording': ('RECOGNITION / ONE RECORDING', 'From a clip to a reviewed report', 'Keep the original recording and its matching result together.', [
        ('Capture or import', 'Record an explicit webcam clip', 'Or import an approved local file', 'Import alone does not analyze', 'play'),
        ('Analyze recording', 'Choose the model and rules', 'Inspect progress or cancel', 'Check complete / partial status', 'screen'),
        ('Review and export', 'Inspect the matched source', 'Send observations to Events', 'Export decisions and result pair', 'check')]),
    'training': ('TRAIN / IMPROVE DETECTION', 'Tune the setting for this view', 'Guided training adjusts a rule threshold; it does not retrain the model.', [
        ('Check the camera', 'Train → Start session', 'Frame the room and check light', 'Connect camera when ready', 'camera'),
        ('Follow the prompts', 'In view → away → far → hidden', 'Keep the window in front', 'Let local analysis finish', 'play'),
        ('Compare and apply', 'Inspect found / missed moments', 'Compare threshold settings', 'Save a new rule or keep current', 'check')]),
    'enrollment': ('TRAIN / ENROLL A CONSENTING PERSON', 'A local baseline, then human review', 'A possible match is a suggestion; it is not proof of identity.', [
        ('Get agreement first', 'Enter the person’s name', 'Confirm the person agrees', 'No capture before consent', 'check'),
        ('Capture and check', 'Follow the guided face views', 'Run an optional baseline check', 'Template stays on this computer', 'camera'),
        ('Review a suggestion', 'Analyze a local recording', 'Check for enrolled people', 'Confirm or dismiss the suggestion', 'screen')]),
    'facility': ('FACILITY / A PLAN YOU CAN EDIT', 'Build the space in layers', 'Plan geometry and camera coverage are estimates until measured.', [
        ('Site and shell', 'Choose a map origin or local grid', 'Add a footprint or reviewed draft', 'Set building size and floors', 'building'),
        ('Interior and openings', 'Sketch rooms and shared walls', 'Place doors, windows and stairs', 'Preview, save, or Undo', 'building'),
        ('Cameras and backup', 'Place and aim planned cameras', 'Inspect estimated coverage', 'Export the named facility plan', 'camera')]),
    'preserve': ('UPDATES / THREE DIFFERENT PLACES', 'Save the work you want to keep', 'A Git checkout is not a backup of recordings or browser storage.', [
        ('Browser exports', 'Export reviews, rules and plans', 'Keep the same browser and port', 'Browser storage is separate', 'screen'),
        ('Private local folder', 'Back up models and catalog', 'Keep recordings, trained, people', 'Preserve private source settings', 'folder'),
        ('Verified backup', 'Keep a copy outside the checkout', 'Verify it before updating', 'Install → Check → Start again', 'check')]),
    'system': ('SYSTEM / PLAN BEFORE YOU SCALE', 'Budget. Apply. Measure.', 'Planning arithmetic does not establish device throughput.', [
        ('Budget resources', 'Enter camera and retention needs', 'Review storage, RAM and VRAM', 'Compare estimates openly', 'server'),
        ('Apply supported limits', 'Choose visible preview tiles', 'Adjust overlay / playback limits', 'Export the analyzer resource policy', 'screen'),
        ('Qualify in stages', 'Test one authorized source first', 'Measure recording and analysis', 'Advance 1 → 5 → 25 → 50 → 100', 'check')]),
    'zones': ('ZONES / START FROM THE RIGHT IMAGE', 'A still. A region. A rule.', 'Image regions belong to that camera view; they are not map coverage.', [
        ('Choose a still', 'Use a deliberate Monitor capture', 'Or a matched Recognition frame', 'Keep the source view consistent', 'camera'),
        ('Draw and name', 'Draw the image-space region', 'Choose class, threshold and dwell', 'Review its position on the still', 'screen'),
        ('Export analyzer rules', 'Save the analyzer-ready JSON', 'Add it to a reviewed local catalog', 'Analyze and review observations', 'folder')]),
    'science': ('FACILITY / IMAGE SCIENCE', 'Inspect pixels. Test geometry.', 'Diagnostics and planar calibration have explicit limits.', [
        ('Freeze an image', 'Choose an explicit local frame', 'Inspect histogram and detail', 'Measure sampled image pixels', 'camera'),
        ('Compare A and B', 'Capture both views deliberately', 'Inspect differences and exposure', 'Keep originals and context', 'screen'),
        ('Calibrate a plane', 'Enter measured ground markers', 'Use independent check markers', 'Review residual error and limits', 'building')]),
}


def icon(kind, x, y, color):
    shapes = {
        'camera': '<rect x="-59" y="-29" width="88" height="58" rx="12"/><path d="M29 -18L62 -34V34L29 18"/><circle cx="-15" cy="0" r="16"/>',
        'server': '<rect x="-63" y="-46" width="126" height="92" rx="14"/><path d="M-63 -13H63M-63 16H63"/><circle cx="-39" cy="-29" r="3"/><circle cx="-39" cy="2" r="3"/><circle cx="-39" cy="31" r="3"/><path d="M-15 -29H40M-15 2H40M-15 31H40"/>',
        'screen': '<rect x="-71" y="-44" width="142" height="85" rx="12"/><path d="M-22 62H22M0 41V62M-49 10L-22 -6L2 7L39 -20"/><path d="M-49 -23H-18"/>',
        'check': '<circle r="51"/><path d="M-24 0L-5 19L29 -20"/><path d="M-66 43L-46 61M50 -58L70 -42"/>',
        'play': '<rect x="-64" y="-45" width="128" height="90" rx="13"/><path d="M-12 -23L25 0L-12 23Z"/><path d="M-43 63H43M-33 57V69M15 57V69"/>',
        'folder': '<path d="M-65 -20V-42H-9L9 -24H65V48H-65Z"/><path d="M-65 -20H65M-36 7H35M-36 24H15"/>',
        'building': '<path d="M-67 26L0 -16L67 26L0 66Z M-67 26V-30L0 -68L67 -30V26 M0 -16V-68 M-33 5V-48 M34 5V-48 M-33 5L34 -36"/>',
    }
    return f'<g transform="translate({x} {y})" fill="none" stroke="{color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">{shapes[kind]}</g>'


def build(name, eyebrow, title, subtitle, cards):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="610" viewBox="0 0 1440 610" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(subtitle+" "+" ".join(c[0]+": "+"; ".join(c[1:4])+"." for c in cards))}</desc>',
             '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0c1a29"/><stop offset="1" stop-color="#101e2b"/></linearGradient></defs>',
             '<rect width="1440" height="610" rx="24" fill="url(#bg)"/>',
             f'<text x="48" y="49" fill="#79d8d0" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="2">{escape(eyebrow)}</text>',
             f'<text x="48" y="105" fill="#f1f6fc" font-family="Arial,sans-serif" font-size="39" font-weight="700">{escape(title)}</text>',
             f'<text x="48" y="144" fill="#b2c2d3" font-family="Arial,sans-serif" font-size="21">{escape(subtitle)}</text>']
    for i, (heading, *rest) in enumerate(cards):
        lines, kind = rest[:3], rest[3]
        x=48+i*456; color='#f5bd53' if i==2 else '#77d5cc'
        parts += [f'<rect x="{x}" y="181" width="432" height="374" rx="19" fill="#142737" stroke="#304859"/>',
                  f'<circle cx="{x+37}" cy="219" r="18" fill="{color}"/>',
                  f'<text x="{x+37}" y="225" text-anchor="middle" fill="#10222d" font-family="Arial,sans-serif" font-size="17" font-weight="700">{i+1}</text>',
                  icon(kind,x+216,294,color),
                  f'<text x="{x+28}" y="400" fill="#f0f5fa" font-family="Arial,sans-serif" font-size="27" font-weight="700">{escape(heading)}</text>']
        for row, text in enumerate(lines):
            parts.append(f'<text x="{x+28}" y="{444+row*31}" fill="#bbcad8" font-family="Arial,sans-serif" font-size="19">{escape(text)}</text>')
        if i<2:
            parts.append(f'<path d="M{x+437} 368H{x+451}M{x+446} 363L{x+451} 368L{x+446} 373" fill="none" stroke="#73b9b7" stroke-width="2"/>')
    parts.append('<text x="48" y="587" fill="#83a0b4" font-family="Arial,sans-serif" font-size="15">INTELLIGENT DVR / VISUAL GUIDE / Explanatory diagram; no live camera or measured performance implied.</text></svg>')
    return '\n'.join(parts)+'\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    for name, (eyebrow, title, subtitle, cards) in GUIDES.items():
        path = OUT / (name + '.svg')
        expected = build(name, eyebrow, title, subtitle, cards)
        if args.check:
            if not path.is_file() or path.read_text(encoding='utf-8') != expected:
                raise ValueError(f'Guide graphic drift: {path.name}')
        else:
            OUT.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding='utf-8')
    print(f'{"Checked" if args.check else "Built"} {len(GUIDES)} editable workflow graphics.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
