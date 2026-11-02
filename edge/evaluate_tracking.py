"""Measure saved tracking traces against independently labeled local sequences."""
import argparse
import json
from pathlib import Path

from .tracking_evaluation import evaluate_tracking


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New local report; never overwritten')
    parser.add_argument('--score-threshold', type=float, default=.1)
    parser.add_argument('--iou-threshold', type=float, default=.5)
    args = parser.parse_args(argv)
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output must be a new file')
    created = False
    try:
        report = evaluate_tracking(args.manifest, args.score_threshold, args.iou_threshold)
        encoded = json.dumps(report, indent=2, allow_nan=False)+'\n'
        with args.output.open('x', encoding='utf-8') as stream:
            created = True
            stream.write(encoded)
    except (ValueError, TypeError, KeyError, OSError) as error:
        if created:
            args.output.unlink()
        parser.error(str(error))
    print(f'Scored {report["frames_scored"]} sampled frames; data_kind={report["data_kind"]}; '
          'physical-camera tracking accuracy remains unqualified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
