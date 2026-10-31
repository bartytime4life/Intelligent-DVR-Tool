"""Deterministic concurrent-source load model; never opens cameras or runs inference."""
import argparse
from fractions import Fraction
import heapq
import json
import math
from pathlib import Path

from .evaluation import digest, number, integer, timing_distribution
from .scheduler import CameraScheduler, Sample, MINIMUM_CAMERA_TARGET


def simulate(cameras=MINIMUM_CAMERA_TARGET, sample_fps=2, workers=8,
             service_ms=650, duration_seconds=10, max_age_seconds=2):
    integer(cameras, 'cameras', 1, 10000)
    integer(workers, 'workers', 1, 256)
    number(sample_fps, 'sample_fps', .1, 60)
    number(service_ms, 'assumed service_ms', .01, 60000)
    integer(duration_seconds, 'duration_seconds', 1, 60)
    number(max_age_seconds, 'max_age_seconds', .001, 3600)
    # Keep this diagnostic bounded even for pathological CLI combinations.
    if cameras*math.ceil(duration_seconds*sample_fps) > 200000:
        raise ValueError('Load model permits at most 200,000 offered samples')
    names = [f'camera-{i+1:04d}' for i in range(cameras)]
    scheduler = CameraScheduler(names, workers=workers, max_sample_bytes=1024,
                                max_buffer_bytes=(cameras+workers)*1024,
                                max_age_seconds=max_age_seconds)
    payload = b'synthetic sample; no pixels'
    completions = []
    ages = []
    first_dispatch = {}
    offered_batches = math.ceil(duration_seconds*sample_fps)
    batch = 0
    now = 0
    while batch < offered_batches or completions:
        next_arrival = round(batch/sample_fps, 9) if batch < offered_batches else math.inf
        next_completion = completions[0][0] if completions else math.inf
        now = min(next_arrival, next_completion)
        while completions and completions[0][0] <= now:
            _, token, captured = heapq.heappop(completions)
            scheduler.complete(token, now)
            ages.append((now-captured)*1000)
        if next_arrival == now:
            for camera in names:
                scheduler.submit(Sample(camera, batch, now, payload), now)
            batch += 1
        for work in scheduler.dispatch(now):
            first_dispatch.setdefault(work.sample.camera, now)
            heapq.heappush(completions, (round(now+service_ms/1000, 9), work.token,
                                        work.sample.captured_at))
    state = scheduler.snapshot()
    # Exact decimal arithmetic: 3 cameras x 1 fps x 700 ms is exactly 3 workers at 70%,
    # not 4 from binary rounding. str() recovers the decimal a CLI float was parsed from.
    offered_ms = Fraction(str(cameras)) * Fraction(str(sample_fps)) * Fraction(str(service_ms))
    totals = {key: sum(s[key] for s in state['per_camera'].values())
              for key in ('received', 'accepted', 'replaced', 'stale', 'budget_dropped',
                          'dispatched', 'completed', 'failed')}
    return {'schema': 'intelligent-dvr.capacity-simulation.v1', 'state': 'simulation-completed',
            'minimum_camera_target': MINIMUM_CAMERA_TARGET,
            'assumptions': {'cameras': cameras, 'samples_per_camera_second': sample_fps,
                            'workers': workers, 'constant_worker_service_ms': service_ms,
                            'offered_duration_seconds': duration_seconds,
                            'max_sample_age_at_dispatch_seconds': max_age_seconds,
                            'arrival_pattern': 'all cameras at each sample tick; virtual clock',
                            'payload': 'shared synthetic text, not decoded image memory'},
            'modeled_offered_samples_per_second': cameras*sample_fps,
            'idealized_worker_service_samples_per_second': workers*1000/service_ms,
            'modeled_overload': offered_ms > workers*1000,
            'worker_equivalents_at_70_percent_utilization': math.ceil(offered_ms / 700),
            'modeled_drain_finished_seconds': now, 'totals': totals,
            'cameras_served': len(first_dispatch),
            'modeled_max_first_dispatch_seconds': max(first_dispatch.values(), default=None),
            'modeled_completion_age': timing_distribution(ages), 'scheduler': state,
            'scheduler_sha256': digest(Path(__file__).with_name('scheduler.py')),
            'simulation_sha256': digest(Path(__file__)),
            'qualification': {'concurrent_camera_capacity': 'unqualified',
                              'target_hardware_performance': 'unqualified',
                              'recognition_accuracy': 'unqualified'},
            'limitations': ['Virtual time and assumed constant service costs are not measured throughput.',
                            'Worker equivalents are abstract capacity, not a CPU-core or GPU purchase recommendation.',
                            'No real frames, decoding, GPU contention, networking, recording or UI load are modeled.',
                            'Replacing or expiring samples loses coverage; quality and dwell must be requalified.',
                            'Freshness is checked at dispatch; in-flight work has no cancellation or hard deadline.',
                            'The scheduler does not create workers, capture sources or a production monitoring service.']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cameras', type=int, default=MINIMUM_CAMERA_TARGET)
    parser.add_argument('--sample-fps', type=float, default=2)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--service-ms', type=float, required=True, help='Explicit assumed cost, not a measured result')
    parser.add_argument('--duration-seconds', type=int, default=10)
    parser.add_argument('--max-age-seconds', type=float, default=2)
    parser.add_argument('--output', type=Path, required=True, help='New simulation report path')
    args = parser.parse_args(argv)
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output must be a new file')
    created = False
    try:
        report = simulate(args.cameras, args.sample_fps, args.workers, args.service_ms,
                          args.duration_seconds, args.max_age_seconds)
        encoded = json.dumps(report, indent=2, allow_nan=False)+'\n'
        with args.output.open('x', encoding='utf-8') as stream:
            created = True
            stream.write(encoded)
    except (ValueError, OSError) as error:
        if created:
            args.output.unlink()
        parser.error(str(error))
    print(f'Modeled {args.cameras} synthetic sources; actual concurrent camera capacity remains unqualified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
