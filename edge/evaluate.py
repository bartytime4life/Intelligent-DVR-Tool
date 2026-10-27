"""Evaluate explicit local traces and labels; never opens cameras or loads a model."""
import argparse
import json
from pathlib import Path

from .evaluation import evaluate


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--reviews', type=Path, help='Optional hash-bound human alert decisions')
    parser.add_argument('--output', type=Path, required=True, help='New evaluation report, never overwritten')
    parser.add_argument('--score-threshold', type=float, default=.5)
    parser.add_argument('--iou-threshold', type=float, default=.5)
    parser.add_argument('--warmup-frames', type=int, default=0,
                        help='Exclude first N analyzed frames of each clip from timing only')
    args = parser.parse_args(argv)
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output must be a new file')
    try:
        report = evaluate(args.manifest, args.reviews, args.score_threshold,
                          args.iou_threshold, args.warmup_frames)
        with args.output.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, indent=2, allow_nan=False)
            stream.write('\n')
    except (ValueError, TypeError, KeyError, OSError) as error:
        parser.error(str(error))
    print(f'Evaluated {report["frames_annotated"]} annotated frames; '
          f'data_kind={report["data_kind"]}; operational qualification remains incomplete.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
