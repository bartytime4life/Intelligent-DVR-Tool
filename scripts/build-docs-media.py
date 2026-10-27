"""Compose documentation media from actual browser screenshots; Pillow is optional.

Run after following docs/media/README.md. Source captures are not distributed.
This script never draws a replacement interface or manufactures detection results.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/media'
CAP = OUT / 'captures'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
INK, MUTED, TEAL, BG = '#edf4f8', '#a8bdcc', '#37dcdb', '#081722'


def font(size, bold=False, mono=False):
    return ImageFont.truetype(MONO if mono else BOLD if bold else FONT, size)


def shot(name, width=1100):
    im = Image.open(CAP / (name + '.png')).convert('RGB')
    return im.resize((width, round(im.height * width / im.width)), Image.Resampling.LANCZOS)


def plate(name, title, detail):
    im = shot(name)
    canvas = Image.new('RGB', (im.width, im.height + 112), BG)
    canvas.paste(im, (0, 0))
    d = ImageDraw.Draw(canvas)
    d.line((0, im.height, im.width, im.height), fill=TEAL, width=2)
    d.text((25, im.height + 19), title, font=font(22, True), fill=INK)
    d.text((25, im.height + 59), detail, font=font(15), fill=MUTED)
    return canvas


def gif(frames, path, durations):
    # A shared palette keeps a stable UI and makes unchanged screenshot areas cheap.
    contact = Image.new('RGB', (330, 242 * len(frames)), BG)
    for i, frame in enumerate(frames):
        contact.paste(frame.resize((330, 242)), (0, 242 * i))
    palette = contact.quantize(colors=128)
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    frames[0].save(OUT / path, save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, optimize=True, disposal=1)


def main():
    OUT.mkdir(exist_ok=True)
    # Editorial typography and framing around the unchanged, actual program capture.
    cover = Image.new('RGB', (1600, 1130), BG)
    d = ImageDraw.Draw(cover)
    d.text((64, 42), 'BARTA AI SOLUTIONS  /  INTELLIGENT DVR', font=font(19, mono=True), fill=TEAL)
    d.text((60, 93), 'See the scene. Plan the space.', font=font(60, True), fill=INK)
    d.text((64, 185), 'A visual review workspace. A local analysis foundation. Evidence at every step.', font=font(23), fill=MUTED)
    monitor = shot('monitor', 1472)
    cover.paste(monitor, (64, 248))
    d.rectangle((64, 248, 1536, 248 + monitor.height), outline='#365363', width=2)
    # Keep the full capture; crop only unused editorial canvas below it.
    end = 248 + monitor.height
    if end + 75 > cover.height:
        expanded = Image.new('RGB', (1600, end + 75), BG)
        expanded.paste(cover, (0, 0))
        expanded.paste(monitor, (64, 248))
        cover, d = expanded, ImageDraw.Draw(expanded)
    d.text((64, end + 24), 'ACTUAL PROTOTYPE CAPTURE  /  GENERATED SCENES + SIMULATED OVERLAYS  /  NO CAMERAS CONNECTED', font=font(15, mono=True), fill=TEAL)
    cover.save(OUT / 'cover.webp', quality=88)

    tour = [
        plate('monitor', '01  /  Observe the scene', 'Actual interface. Generated camera scenes; simulated overlays and playback.'),
        plate('review', '02  /  Review the evidence', 'Sample observation. A model score is not a probability of danger.'),
        plate('history', '03  /  Keep the decision in view', 'A sample confirmation saved in this browser; no external action is triggered.'),
        plate('zones', '04  /  Make the rule explicit', 'Choose the zone, supported label, dwell time and score threshold.'),
        plate('facility', '05  /  Plan the space', 'Fictional buildings, camera placement and estimated ground-plane visibility.'),
    ]
    gif(tour, 'workspace-tour.gif', [2300] * len(tour))

    route = [plate(f'route-{i:02d}', f'FACILITY REHEARSAL  /  snapshot {i + 1:02d} of 31',
                   'Actual slider states, time-compressed. Planned route; estimated coverage; no identity tracking.')
             for i in range(31)]
    gif(route, 'facility-rehearsal.gif', [1500] + [180] * 29 + [1500])
    shapes = [plate(name, 'BUILDING STARTERS  /  ' + label,
                    'Actual added geometry. Editable dimensions; on-site verification required. Undo tested.')
              for name, label in [('shape-l', 'L wing'), ('shape-u', 'U wing'), ('shape-round', 'Round')]]
    gif(shapes, 'building-shapes.gif', [2400] * 3)
    for name in ['monitor', 'review', 'history', 'zones', 'facility', 'map-starter', 'route-15', 'shape-u']:
        shot(name, 1400).save(OUT / (name + '.webp'), quality=88)
    print('Created cover, 3 animated walkthroughs and 8 static alternatives.')


if __name__ == '__main__':
    main()
