"""Evidence collection/preflight integrity; no camera, native inference or network."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from edge.qualification import (collect, verify, preflight, log_summaries,
                                write_new, MAX_ARTIFACT_BYTES)

PLAN = Path(__file__).parents[1] / 'edge/qualification-plan.example.json'


def completed_plan():
    p = json.loads(PLAN.read_text())
    p['workload'].update(codec='test-codec', width=640, height=480, source_fps=10,
                         analysis_fps_per_camera=2, maximum_event_delay_seconds=2,
                         recording_required=False, retention_days=0, duration_minutes=10,
                         maximum_analytics_drop_fraction=0)
    p['hardware'].update(host_count=1, cpu_label='synthetic test host', ram_gib=32,
                         gpu_label='CPU-only', worker_count=8)
    p['quality'].update(classes=['person'], score_threshold=.5, iou_threshold=.5,
                        minimum_precision=.9, minimum_recall=.8,
                        maximum_false_alerts_per_camera_hour=1,
                        minimum_reviewed_camera_hours=10)
    p['approvals'] = {k: True for k in p['approvals']}
    return p


class QualificationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'edge').mkdir()
        (self.root/'edge/local_adapter.py').write_text('VALUE = 1\n')
        (self.root/'checks.log').write_text('Ran 134 tests in 1.0s\n\nOK (skipped=12)\n')

    def collect(self):
        with patch('edge.qualification.git_provenance',
                   return_value={'commit': None, 'worktree': 'unknown'}):
            return collect(self.root, ['checks.log'])

    def test_inventory_omits_secrets_media_and_contents_retains_actual_skip_counts(self):
        (self.root/'.env').write_text('SECRET_TOKEN=never-copy-this')
        (self.root/'models').mkdir()
        (self.root/'models/weights.json').write_text('private weight metadata')
        (self.root/'edge/.env.local').write_text('SECRET=also-never-copy')
        (self.root/'recordings').mkdir()
        (self.root/'recordings/source.mp4').write_bytes(b'private pixels')
        result = self.collect()
        self.assertEqual(result['state'], 'collected')
        self.assertEqual([f['path'] for f in result['source']['files']], ['edge/local_adapter.py'])
        self.assertNotIn(str(self.root), json.dumps(result))
        self.assertNotIn('never-copy', json.dumps(result))
        self.assertNotIn('VALUE = 1', json.dumps(result))
        c = result['artifacts'][0]['test_summaries'][0]
        self.assertEqual((c['discovered'], c['passed'], c['skipped']), (134, 122, 12))
        self.assertTrue(c['consistent'])
        self.assertTrue(all(x == 'unqualified' for x in result['qualification'].values()))

    def test_verification_detects_changed_or_missing_source_and_log(self):
        bundle = self.collect()
        self.assertEqual(verify(self.root, bundle)['state'], 'matched')
        (self.root/'edge/local_adapter.py').write_text('VALUE = 2\n')
        (self.root/'checks.log').unlink()
        result = verify(self.root, bundle)
        self.assertEqual(result['state'], 'mismatch')
        self.assertEqual({r['path'] for r in result['mismatches']},
                         {'edge/local_adapter.py', 'checks.log'})

    def test_tampered_inventory_and_path_escape_never_read_outside_root(self):
        bundle = self.collect()
        bundle['source']['files'][0]['bytes'] += 1
        with self.assertRaisesRegex(ValueError, 'Inventory hash'):
            verify(self.root, bundle)
        for name in ('../outside.log', '/outside.log', 'rtsp://camera'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                collect(self.root, [name])

    def test_symlink_source_is_partial_and_symlink_artifact_rejected(self):
        try:
            (self.root/'edge/link.py').symlink_to(self.root/'edge/local_adapter.py')
        except OSError:
            self.skipTest('Host does not permit test symlinks')
        result = self.collect()
        self.assertEqual(result['state'], 'partial')
        self.assertEqual(len(result['source']['omitted']), 1)
        with self.assertRaises(ValueError):
            collect(self.root, ['edge/link.py'])

    def test_oversized_and_duplicate_artifacts_are_rejected(self):
        with (self.root/'large.log').open('wb') as stream:
            stream.truncate(MAX_ARTIFACT_BYTES+1)
        with self.assertRaises(ValueError):
            collect(self.root, ['large.log'])
        with self.assertRaises(ValueError):
            collect(self.root, ['checks.log', 'checks.log'])

    def test_concatenated_logs_keep_distinct_runs_and_failures(self):
        text = ('2026-10-28T19:00:00.000Z Ran 5 tests in 1s\n'
                '2026-10-28T19:00:00.001Z FAILED (failures=1, errors=1, skipped=1)\n'
                'Ran 4 tests in 1s\nOK\n'
                '# tests 3\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 1\n')
        rows = log_summaries(text)
        self.assertEqual(len(rows), 3)
        self.assertEqual((rows[0]['passed'], rows[0]['failed'], rows[0]['skipped']), (2, 2, 1))
        self.assertEqual(rows[1]['passed'], 4)
        self.assertEqual((rows[2]['skipped'], rows[2]['todo']), (1, 1))
        self.assertEqual(log_summaries('Ran 2 tests in 1s\nOK (skipped=3)\n')[0]['consistent'], False)
        self.assertEqual(log_summaries('Ran 3 tests in 1s\n'), [])

    def test_blank_template_blocks_without_inventing_decisions(self):
        p = json.loads(PLAN.read_text())
        result = preflight(p)
        self.assertEqual(result['state'], 'blocked')
        self.assertIn('workload.codec', result['blockers'])
        self.assertIn('approvals.workload_accepted', result['blockers'])
        self.assertIsNone(p['quality']['minimum_precision'])
        self.assertTrue(all(v == 'unqualified' for v in result['qualification'].values()))

    def test_complete_plan_only_opens_offline_trial_not_operational_qualification(self):
        result = preflight(completed_plan())
        self.assertEqual(result['state'], 'ready-for-offline-trial')
        self.assertEqual(result['blockers'], [])
        self.assertTrue(all(v == 'unqualified' for v in result['qualification'].values()))
        self.assertIn('Separate live-camera and operational acceptance', result['measurements_required'])

    def test_invalid_plan_types_ranges_and_inconsistent_cadence_rejected(self):
        mutations = (
            lambda p: p.update(minimum_simultaneous_cameras=99),
            lambda p: p.update(stages=[True, 5, 25, 50, 100]),
            lambda p: p['workload'].update(width=True),
            lambda p: p['workload'].update(source_fps=float('nan')),
            lambda p: p['workload'].update(source_fps=10**1000),
            lambda p: p['workload'].update(analysis_fps_per_camera=20),
            lambda p: p['hardware'].update(worker_count=1.5),
            lambda p: p['quality'].update(classes=['person', 'person']),
            lambda p: p['quality'].update(classes=[[]]),
            lambda p: p['approvals'].update(workload_accepted='yes'),
            lambda p: p.update(command='run-anything'))
        for mutate in mutations:
            p = completed_plan()
            mutate(p)
            with self.subTest(plan=p), self.assertRaises(ValueError):
                preflight(p)

    def test_existing_outputs_are_never_overwritten(self):
        path = self.root/'existing.json'
        path.write_text('original')
        with self.assertRaises(ValueError):
            write_new(path, {'changed': True})
        self.assertEqual(path.read_text(), 'original')

    def test_cli_blocked_exit_is_distinct_and_preserves_receipt(self):
        output = self.root/'preflight.json'
        cmd = [sys.executable, '-m', 'edge.qualification', 'plan',
               '--plan', str(PLAN), '--output', str(output)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 3, result.stderr)
        before = output.read_bytes()
        result = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(before, output.read_bytes())


if __name__ == '__main__':
    unittest.main()
