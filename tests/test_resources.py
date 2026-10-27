"""Resource policies and read-only host reporting; no cameras or host tuning."""
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from edge.host import snapshot, gpu_snapshot, main as host_main
from edge.resources import validate_policy, load_policy, analyzer_limits, scheduler_from_policy
from edge.scheduler import Sample

FIXTURE = Path(__file__).parent / 'fixtures/resource-policy.json'


class ResourcePolicyTest(unittest.TestCase):
    def policy(self):
        return json.loads(FIXTURE.read_text())

    def test_shared_browser_export_is_accepted_on_both_os_profiles(self):
        for os_name in ('linux', 'windows'):
            p = self.policy()
            p['platform'] = os_name
            self.assertEqual(validate_policy(p), p)
            self.assertEqual(analyzer_limits(p), {'threads': 1, 'max_frames': 6000})

    def test_unsafe_extra_fields_booleans_nonfinite_and_overcommit_rejected(self):
        mutations = [lambda p: p.update(command='anything'),
                     lambda p: p['analysis'].update(opencv_threads=True),
                     lambda p: p['analysis'].update(opencv_threads=9),
                     lambda p: p['analysis'].update(max_age_seconds=float('nan')),
                     lambda p: p['analysis'].update(max_age_seconds=10**1000),
                     lambda p: p['analysis'].update(max_buffer_bytes=2**40),
                     lambda p: p['analysis'].update(max_buffer_bytes=1),
                     lambda p: p['analysis'].update(thread_budget=1),
                     lambda p: p['browser'].update(visible_tiles=True),
                     lambda p: p['browser'].update(pause_when_hidden='false')]
        for mutate in mutations:
            p = self.policy()
            mutate(p)
            with self.assertRaises(ValueError):
                validate_policy(p)

    def test_explicit_analyzer_flags_cannot_exceed_policy(self):
        p = self.policy()
        self.assertEqual(analyzer_limits(), {'threads': 1, 'max_frames': 6000})
        self.assertEqual(analyzer_limits(None, 8, 100000), {'threads': 8, 'max_frames': 100000})
        self.assertEqual(analyzer_limits(p, 1, 20), {'threads': 1, 'max_frames': 20})
        for args in ((p, 2, 20), (p, 1, 6001), (None, 0, 20)):
            with self.assertRaises(ValueError):
                analyzer_limits(*args)

    def test_hash_binds_exact_file_and_json_reader_rejects_duplicates_and_oversize(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'policy.json'
            file.write_text(json.dumps(self.policy()))
            policy, digest = load_policy(file)
            self.assertEqual(digest, hashlib.sha256(file.read_bytes()).hexdigest())
            self.assertEqual(policy, self.policy())
            for raw in ('{"schema":1,"schema":2}', ' ' * 65537, '{"analysis":NaN}'):
                file.write_text(raw)
                with self.assertRaises(ValueError):
                    load_policy(file)

    def test_scheduler_adapter_actually_enforces_bytes_slots_and_age(self):
        p = self.policy()
        p['analysis'].update(worker_slots=1, max_sample_bytes=4, max_buffer_bytes=8, max_age_seconds=.5)
        scheduler = scheduler_from_policy(['a', 'b', 'c'], p)
        self.assertEqual(scheduler.submit(Sample('a', 1, 0, b'1234'), now=0), 'accepted')
        self.assertEqual(scheduler.submit(Sample('b', 1, 0, b'1234'), now=0), 'accepted')
        self.assertEqual(scheduler.submit(Sample('c', 1, 0, b'1234'), now=0), 'budget-dropped')
        work = scheduler.dispatch(now=0)
        self.assertEqual(len(work), 1)
        self.assertEqual(scheduler.dispatch(now=0), [])
        scheduler.complete(work[0].token, now=.1)
        self.assertEqual(scheduler.dispatch(now=1), [])
        self.assertEqual(scheduler.snapshot()['per_camera']['b']['stale'], 1)

    def test_integer_valued_json_numbers_normalize_to_scheduler_contract(self):
        p = self.policy()
        p['analysis']['worker_slots'] = 8.0
        self.assertIs(type(validate_policy(p)['analysis']['worker_slots']), int)
        self.assertEqual(scheduler_from_policy(['a'], p).workers, 8)


class HostSnapshotTest(unittest.TestCase):
    def test_actual_local_report_omits_identity_and_selected_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch('edge.host.gpu_snapshot') as gpu:
                report = snapshot([Path(temp)])
                gpu.assert_not_called()
            self.assertIn(report['platform'], ('linux', 'windows'))
            self.assertGreaterEqual(report['cpu_logical'], 1)
            self.assertTrue(report['ram_total_bytes'] is None or report['ram_total_bytes'] > 0)
            self.assertGreater(report['volumes'][0]['total_bytes'], 0)
            self.assertNotIn(temp, json.dumps(report))
            for key in ('hostname', 'username', 'serial', 'ip', 'paths'):
                self.assertNotIn(key, report)

    def test_probe_exclusive_output_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / 'host.json'
            args = ['--path', temp, '--output', str(file)]
            with redirect_stdout(io.StringIO()):
                host_main(args)
            before = file.read_bytes()
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                host_main(args)
            self.assertEqual(file.read_bytes(), before)

    def test_unknown_ram_and_unsupported_platform_are_explicit(self):
        with patch('edge.host.physical_memory', side_effect=OSError('unavailable')):
            self.assertIsNone(snapshot()['ram_total_bytes'])
        with patch('edge.host.platform.system', return_value='Darwin'), self.assertRaises(ValueError):
            snapshot()
        with self.assertRaises(ValueError):
            snapshot([Path('.')] * 9)

    def test_gpu_inventory_is_read_only_and_bounded(self):
        with patch('edge.host.shutil.which', return_value='/approved/nvidia-smi'), patch('edge.host.subprocess.run') as run:
            run.return_value.stdout = 'NVIDIA sample GPU, 16384\n'
            gpus, error = gpu_snapshot()
            self.assertIsNone(error)
            self.assertEqual(gpus[0]['memory_mib'], 16384)
            args, kwargs = run.call_args
            self.assertEqual(args[0][1:], ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
            self.assertEqual(kwargs['timeout'], 5)
            self.assertNotIn('shell', kwargs)

    def test_gpu_failures_do_not_invent_a_zero_capacity_device(self):
        with patch('edge.host.shutil.which', return_value=None):
            gpus, error = gpu_snapshot()
            self.assertEqual(gpus, [])
            self.assertIn('unknown', error)
        with patch('edge.host.shutil.which', return_value='/approved/nvidia-smi'), patch('edge.host.subprocess.run', side_effect=subprocess.TimeoutExpired('gpu', 5)):
            gpus, error = gpu_snapshot()
            self.assertEqual(gpus, [])
            self.assertIn('unknown', error)


if __name__ == '__main__':
    unittest.main()
