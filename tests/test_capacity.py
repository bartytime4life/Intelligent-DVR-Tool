"""100-source scheduler/load tests. No camera, detector or throughput qualification."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from edge.capacity import simulate
from edge.scheduler import CameraScheduler, Sample, MINIMUM_CAMERA_TARGET


class SchedulerTest(unittest.TestCase):
    def sample(self, camera='a', sequence=0, captured=0, payload=b'x'):
        return Sample(camera, sequence, captured, payload)

    def test_100_sources_share_bounded_workers_and_all_receive_service(self):
        names = [str(i) for i in range(100)]
        scheduler = CameraScheduler(names, workers=8, max_sample_bytes=1, max_buffer_bytes=108)
        for name in names:
            scheduler.submit(self.sample(name), 0)
        seen = []
        while scheduler.snapshot()['pending']:
            batch = scheduler.dispatch(0)
            self.assertLessEqual(len(batch), 8)
            self.assertEqual(scheduler.dispatch(0), [])
            for work in batch:
                seen.append(work.sample.camera)
                scheduler.complete(work.token, 0)
        self.assertEqual(seen, names)
        state = scheduler.snapshot()
        self.assertEqual(state['peak_pending'], 100)
        self.assertEqual(state['peak_inflight'], 8)
        self.assertEqual(state['buffered_payload_bytes'], 0)

    def test_latest_sample_replaces_pending_without_cutting_queue(self):
        scheduler = CameraScheduler(['a', 'b', 'c'], workers=1)
        for name in ('a', 'b', 'c'):
            scheduler.submit(self.sample(name), 0)
        work = scheduler.dispatch(0)[0]
        scheduler.submit(self.sample('a', 1), 0)
        for sequence in range(1, 20):
            scheduler.submit(self.sample('b', sequence), 0)
        scheduler.complete(work.token, 0)
        order = []
        while scheduler.snapshot()['pending']:
            work = scheduler.dispatch(0)[0]
            order.append((work.sample.camera, work.sample.sequence))
            scheduler.complete(work.token, 0)
        self.assertEqual(order, [('b', 19), ('c', 0), ('a', 1)])

    def test_only_one_inflight_sample_per_camera(self):
        scheduler = CameraScheduler(['a', 'b'], workers=8)
        scheduler.submit(self.sample('a'), 0)
        first = scheduler.dispatch(0)[0]
        scheduler.submit(self.sample('a', 1), 0)
        self.assertEqual(scheduler.dispatch(0), [])
        scheduler.submit(self.sample('b'), 0)
        second = scheduler.dispatch(0)[0]
        self.assertEqual(second.sample.camera, 'b')
        scheduler.complete(first.token, 0)
        self.assertEqual(scheduler.dispatch(0)[0].sample.sequence, 1)

    def test_memory_budget_counts_inflight_and_pending_and_recovers_after_failure(self):
        scheduler = CameraScheduler(['a', 'b'], workers=1, max_sample_bytes=2, max_buffer_bytes=3)
        scheduler.submit(self.sample('a', payload=b'xx'), 0)
        work = scheduler.dispatch(0)[0]
        self.assertEqual(scheduler.submit(self.sample('b', payload=b'xx'), 0), 'budget-dropped')
        self.assertEqual(scheduler.submit(self.sample('b', 1), 0), 'accepted')
        self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'], 3)
        scheduler.complete(work.token, 0, success=False)
        scheduler.complete(scheduler.dispatch(0)[0].token, 0)
        self.assertEqual(scheduler.snapshot()['buffered_payload_bytes'], 0)
        self.assertEqual(scheduler.snapshot()['per_camera']['a']['failed'], 1)

    def test_stale_samples_are_reported_and_do_not_execute(self):
        scheduler = CameraScheduler(['a', 'b'], max_age_seconds=1)
        scheduler.submit(self.sample('a'), 0)
        self.assertEqual(scheduler.submit(self.sample('b'), 2), 'stale')
        self.assertEqual(scheduler.dispatch(2), [])
        state = scheduler.snapshot()
        self.assertEqual(state['buffered_payload_bytes'], 0)
        self.assertEqual(sum(s['stale'] for s in state['per_camera'].values()), 2)

    def test_admission_order_size_clock_and_completion_checks(self):
        scheduler = CameraScheduler(['a'], max_sample_bytes=1)
        for sample in (self.sample('unknown'), self.sample(payload=b'xx'),
                       self.sample(sequence=True), self.sample(captured=float('nan')),
                       self.sample(captured=1), self.sample(payload=bytearray(b'x'))):
            with self.assertRaises(ValueError):
                scheduler.submit(sample, 0)
        scheduler.submit(self.sample(), 0)
        with self.assertRaises(ValueError):
            scheduler.submit(self.sample(), 0)
        work = scheduler.dispatch(0)[0]
        for token in (False, -1, '1'):
            with self.assertRaises(ValueError):
                scheduler.complete(token, 0)
        scheduler.complete(work.token, 1)
        with self.assertRaises(ValueError):
            scheduler.complete(work.token, 1)
        for now in (0, float('nan'), float('inf'), True):
            with self.assertRaises(ValueError):
                scheduler.dispatch(now)

    def test_threaded_admission_is_safe_without_external_clock_ordering(self):
        names = [str(i) for i in range(100)]
        scheduler = CameraScheduler(names, max_age_seconds=3600)
        def submit(name):
            return scheduler.submit(self.sample(name, captured=time.monotonic()))
        with ThreadPoolExecutor(max_workers=16) as executor:
            self.assertEqual(list(executor.map(submit, names)), ['accepted']*100)
        seen = set()
        while scheduler.snapshot()['pending']:
            batch = scheduler.dispatch()
            self.assertTrue(batch)
            with ThreadPoolExecutor(max_workers=8) as executor:
                list(executor.map(lambda work: scheduler.complete(work.token), batch))
            seen.update(work.sample.camera for work in batch)
        self.assertEqual(seen, set(names))

    def test_configuration_bounds_and_snapshot_isolation(self):
        for names, options in (([], {}), (['a', 'a'], {}), (['a'], {'workers': True}),
                               (['a'], {'max_age_seconds': 0}), (['a'], {'max_buffer_bytes': 0})):
            with self.assertRaises(ValueError):
                CameraScheduler(names, **options)
        scheduler = CameraScheduler(['a'])
        state = scheduler.snapshot()
        state['per_camera']['a']['completed'] = 900
        self.assertEqual(scheduler.snapshot()['per_camera']['a']['completed'], 0)


class CapacitySimulationTest(unittest.TestCase):
    def test_owner_target_and_evaluation_reports_use_100_camera_minimum(self):
        target = json.loads((Path(__file__).parents[1]/'edge'/'capacity-target.json').read_text())
        self.assertEqual(MINIMUM_CAMERA_TARGET, 100)
        self.assertEqual(target['minimum_simultaneous_cameras'], MINIMUM_CAMERA_TARGET)
        self.assertEqual(target['camera_capacity'], 'unqualified')
        from edge.evaluation import evaluate
        fixtures = Path(__file__).parent/'fixtures'/'evaluation'
        result = evaluate(fixtures/'manifest.json')
        self.assertEqual(result['capacity_target_cameras'], 100)
        self.assertEqual(result['qualification']['concurrent_camera_capacity'], 'unqualified')

    def test_100_source_overload_is_deterministic_bounded_and_visible(self):
        result = simulate(service_ms=650)
        self.assertEqual(result, simulate(service_ms=650))
        self.assertEqual(result['cameras_served'], 100)
        self.assertEqual(result['totals']['received'], 2000)
        self.assertGreater(result['totals']['replaced'], 0)
        self.assertTrue(result['modeled_overload'])
        self.assertLessEqual(result['scheduler']['peak_pending'], 100)
        self.assertLessEqual(result['scheduler']['peak_inflight'], 8)
        self.assertLessEqual(result['scheduler']['peak_buffered_payload_bytes'],
                             result['scheduler']['max_buffer_bytes'])
        self.assertEqual(result['scheduler']['pending'], 0)
        self.assertEqual(result['scheduler']['inflight'], 0)
        counts = result['totals']
        self.assertEqual(counts['received'], sum(counts[k] for k in
                         ('replaced', 'stale', 'budget_dropped', 'completed', 'failed')))
        self.assertTrue(all(v == 'unqualified' for v in result['qualification'].values()))

    def test_fast_assumed_workers_can_clear_100_sources_without_replacements(self):
        result = simulate(service_ms=10)
        self.assertEqual(result['totals']['completed'], 2000)
        self.assertEqual(result['totals']['replaced'], 0)
        self.assertEqual(result['totals']['stale'], 0)
        self.assertFalse(result['modeled_overload'])
        self.assertEqual(result['modeled_offered_samples_per_second'], 200)
        self.assertEqual(result['qualification']['concurrent_camera_capacity'], 'unqualified')

    def test_target_is_minimum_not_a_hard_maximum(self):
        self.assertEqual(simulate(cameras=125, service_ms=10)['cameras_served'], 125)

    def test_invalid_or_unbounded_models_are_rejected(self):
        for options in ({'service_ms': 0}, {'sample_fps': float('nan')}, {'workers': True},
                        {'cameras': 10000, 'sample_fps': 60, 'duration_seconds': 60}):
            with self.assertRaises(ValueError):
                simulate(**options)

    def test_cli_requires_assumed_cost_and_never_overwrites_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'simulation.json'
            command = [sys.executable, '-m', 'edge.capacity', '--service-ms', '650', '--output', str(output)]
            subprocess.run(command, check=True, capture_output=True)
            original = output.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(original, output.read_bytes())
            output.unlink()
            self.assertNotEqual(subprocess.run(command[:3]+command[5:], capture_output=True).returncode, 0)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
