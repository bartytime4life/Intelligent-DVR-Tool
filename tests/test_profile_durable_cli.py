"""Exercise real bounded synthetic CLI overload, not native/camera capacity."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1]/'scripts/profile-durable.py'


class ProfileCliTest(unittest.TestCase):
    def test_invalid_offer_rates_reject_before_creating_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'unused.json'
            for rate in ('0', '21', 'nan', 'inf'):
                with self.subTest(rate=rate):
                    result = subprocess.run([sys.executable, '-B', str(SCRIPT),
                        '--offer-hz', rate, '--output', str(output)],
                        capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn('--offer-hz', result.stderr)
                    self.assertFalse(output.exists())

    @unittest.skipUnless(sys.platform == 'linux', 'ProcessWorkers admission is Linux-only')
    def test_overload_balances_losses_preserves_bounds_and_closes_child(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'overload.json'
            result = subprocess.run([sys.executable, '-B', str(SCRIPT),
                '--seconds', '1', '--offer-hz', '20', '--payload-bytes', str(2*1024**2),
                '--profile', '--output', str(output)], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(output.read_text())
            self.assertEqual(report['settings']['offer_hz'], 20)
            self.assertGreater(report['budget_dropped'], 0)
            self.assertLessEqual(report['peak_payload_bytes'], 64*1024**2)
            self.assertLessEqual(report['peak_entries'], 1000)
            self.assertEqual(report['journal_policy']['synchronous'], 2)
            self.assertEqual(report['journal_policy']['journal_mode'], 'wal')
            self.assertGreater(report['sampled_peak_wal_bytes'], 0)
            total = sum(report[key] for key in ('completed_in_window','failed_in_window',
                'successful_drain','failed_drain','replacements','stale','budget_dropped','pending','inflight'))
            self.assertEqual(total, report['offered'])
            terminal = sum(report[key] for key in ('completed_in_window','failed_in_window',
                'successful_drain','failed_drain'))
            self.assertEqual(report['unique_delivery_ids'], terminal)
            self.assertEqual(report['journal']['unacknowledged'], 0)
            self.assertEqual(report['inflight'], 0)
            self.assertFalse(report['workers']['child_alive'])
            self.assertTrue(report['profile']['child_final']['1'])
            self.assertEqual(output.stat().st_mode & 0o077, 0)
