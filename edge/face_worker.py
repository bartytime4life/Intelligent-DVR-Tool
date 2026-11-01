"""Private bounded face worker: one local recording in, face templates or a match count out.

The service writes args.json into a private directory; this process applies the
analysis worker's limits before importing native libraries and writes result.json.
Results contain codes, counts and embeddings only: no paths, pixels or native text.
"""
import json
import os
from pathlib import Path
import sys

from .fileops import replace

MAX_FRAMES = 2400   # 60 s at up to 40 fps
SAMPLE_EVERY = 5
REASONS = ('none', 'several', 'small', 'unclear', 'edge', 'dark', 'bright', 'blurry')


def scan(models, video, cv2, np, quality, mode):
    capture = cv2.VideoCapture(str(video), cv2.CAP_FFMPEG)
    if not capture.isOpened():
        raise LookupError('VIDEO_OPEN_FAILED')
    reasons, accepted, checked, index = dict.fromkeys(REASONS, 0), [], 0, 0
    try:
        while index < MAX_FRAMES:
            ok, frame = capture.read()
            if not ok:
                break
            if index % SAMPLE_EVERY == 0:
                checked += 1
                faces = models.detect(frame)
                if not faces:
                    reasons['none'] += 1
                elif len(faces) > 1:
                    reasons['several'] += 1  # Templates come only from frames with exactly one face.
                else:
                    aligned = models.align(frame, faces[0])
                    reason = quality(frame, faces[0], aligned, cv2, mode)
                    if reason:
                        reasons[reason] += 1
                    else:
                        accepted.append(models.embed(aligned, np))
            index += 1
    finally:
        capture.release()
    return checked, accepted, reasons


def run(directory):
    directory = Path(directory)
    args = json.loads((directory / 'args.json').read_text(encoding='utf-8'))
    from .analysis_worker import constrain
    handle = constrain()
    os.environ.update(OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2',
                      OPENCV_FFMPEG_CAPTURE_OPTIONS='protocol_whitelist;file', OPENCV_VIDEOIO_PRIORITY_LIST='FFMPEG')
    try:
        import cv2
        import numpy as np
        from . import faces
        cv2.setNumThreads(2)
        try:
            models = faces.Models(args['detector'], args['recognizer'], cv2)
        except cv2.error:
            raise LookupError('MODEL_LOAD_FAILED') from None
        checked, accepted, reasons = scan(models, args['video'], cv2, np, faces.quality, args['mode'])
        result = {'checked': checked, 'usable': len(accepted), 'reasons': reasons}
        if args['mode'] == 'enroll':
            result['embeddings'] = [[float(v) for v in t] for t in faces.add_diverse([], accepted, np)]
        else:
            people = [{'id': p['id'], 'embeddings': p['embeddings']} for p in args['people']]
            outcomes = [faces.match(e, people, np) for e in accepted]
            mine = [e for e, m in zip(accepted, outcomes) if m and m['person'] == args['target']]
            # Matched views refine the person's template, so each check also improves recognition.
            own = next(p['embeddings'] for p in people if p['id'] == args['target'])
            result.update(matched=len(mine), other=sum(1 for m in outcomes if m and m['person'] != args['target']),
                          embeddings=[[float(v) for v in t] for t in faces.add_diverse(own, mine, np)])
    except LookupError as error:
        result = {'error': str(error)}
    except Exception:
        result = {'error': 'FACE_FAILED'}  # Never native text or paths.
    temporary = directory / 'result.tmp'
    temporary.write_text(json.dumps(result), encoding='utf-8')
    replace(temporary, directory / 'result.json')
    return handle


if __name__ == '__main__':
    try:
        run(sys.argv[1])
    except BaseException:
        sys.exit(1)
