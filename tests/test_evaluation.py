"""Evaluation arithmetic/integrity tests; no representative-scene accuracy claim."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from edge.evaluation import (evaluate, digest, canonical_hash, iou, match_frame,
                             read_json, timing_distribution)
from evaluation_fixtures import make_fixture, write_json


class EvaluationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest, self.trace, self.reviews = make_fixture(self.root)

    def run_eval(self, reviews=True, **options):
        return evaluate(self.root/'manifest.json', self.root/'reviews.json' if reviews else None, **options)

    def save_manifest(self):
        write_json(self.root/'manifest.json', self.manifest)

    def save_trace(self):
        write_json(self.root/'trace.json', self.trace)

    def test_known_precision_recall_false_alerts_and_evidence(self):
        result = self.run_eval()
        self.assertEqual(result['per_class']['person'],
                         {'TP': 2, 'FP': 2, 'FN': 1, 'precision': .5, 'recall': 2/3})
        self.assertEqual(result['per_class']['car'],
                         {'TP': 1, 'FP': 1, 'FN': 0, 'precision': .5, 'recall': 1})
        self.assertIsNone(result['per_class']['bicycle']['precision'])
        self.assertIsNone(result['per_class']['bicycle']['recall'])
        self.assertEqual(result['micro']['recall'], .75)
        self.assertAlmostEqual(result['reviewed_camera_hours'], 4/3600)
        self.assertEqual(result['false_alerts_per_camera_hour'], 900)
        self.assertEqual(result['reviewed_false_alerts'], 1)
        self.assertEqual(result['timing']['p50_ms'], 20)
        self.assertEqual(result['timing']['p95_ms'], 40)
        for row in result['detection_evidence']:
            self.assertEqual(row['source_sha256'], self.trace['source_sha256'])
            self.assertEqual(row['trace_sha256'], digest(self.root/'trace.json'))
            self.assertIn(row['frame_index'], range(4))
        self.assertTrue(all(e['review_required'] for e in result['clips'][0]['alerts']))
        self.assertTrue(all(v == 'unqualified' for v in result['qualification'].values()))
        self.assertEqual(result, self.run_eval())

    def test_committed_corpus_matches_regenerator_and_expected_metrics(self):
        committed = Path(__file__).parent/'fixtures'/'evaluation'
        for path in self.root.iterdir():
            self.assertEqual(path.read_bytes(), (committed/path.name).read_bytes(), path.name)
        self.assertEqual(evaluate(committed/'manifest.json', committed/'reviews.json')['micro']['recall'], .75)

    def test_missing_or_partial_reviews_never_count_as_zero_false_alerts(self):
        self.assertIsNone(self.run_eval(False)['false_alerts_per_camera_hour'])
        self.reviews['decisions'].pop()
        write_json(self.root/'reviews.json', self.reviews)
        result = self.run_eval()
        self.assertIsNone(result['false_alerts_per_camera_hour'])
        self.assertEqual(result['clips'][0]['pending_alert_reviews'], 1)

    def test_empty_coverage_and_missing_labels_have_undefined_metrics(self):
        self.manifest['clips'][0]['alert_review_intervals'] = []
        self.manifest['clips'][0]['frames'] = []
        self.save_manifest()
        result = self.run_eval(False)
        self.assertIsNone(result['false_alerts_per_camera_hour'])
        self.assertEqual(result['frames_annotated'], 0)
        self.assertIsNone(result['micro']['precision'])
        self.assertIsNone(result['micro']['recall'])

    def test_unannotated_frames_do_not_affect_detection_counts(self):
        self.manifest['clips'][0]['frames'].pop()  # Exclude negative frame 3.
        self.save_manifest()
        result = self.run_eval(False)
        self.assertEqual(result['per_class']['person']['FP'], 1)
        self.assertEqual(result['frames_annotated'], 3)
        self.assertEqual(len(result['clips'][0]['alerts']), 2)

    def test_warmup_only_changes_timings_and_empty_timing_is_null(self):
        a, b = self.run_eval(), self.run_eval(warmup_frames=2)
        self.assertEqual(a['per_class'], b['per_class'])
        self.assertEqual(b['timing']['count'], 2)
        self.assertEqual(b['timing']['mean_ms'], 35)
        self.assertIsNone(self.run_eval(warmup_frames=4)['timing']['p95_ms'])

    def test_half_open_coverage_and_excluded_alerts(self):
        self.manifest['clips'][0]['alert_review_intervals'] = [[0, 3]]
        self.save_manifest()
        self.reviews['manifest_sha256'] = digest(self.root/'manifest.json')
        write_json(self.root/'reviews.json', self.reviews)
        result = self.run_eval()
        self.assertEqual(result['false_alerts_per_camera_hour'], 0)
        self.assertFalse(result['clips'][0]['alerts'][1]['in_review_coverage'])

    def test_coverage_with_no_emitted_alerts_can_report_zero(self):
        self.manifest['clips'][0]['alert_review_intervals'] = [[1, 3]]
        self.save_manifest()
        result = self.run_eval(False)
        self.assertEqual(result['false_alerts_per_camera_hour'], 0)
        self.assertEqual(result['clips'][0]['covered_alerts'], 0)

    def test_bad_coverage_rejected(self):
        for intervals in ([[0, 5]], [[2, 3], [1, 2]], [[0, 2], [1, 3]], [[0, 0]], [[True, 2]]):
            with self.subTest(intervals=intervals):
                self.manifest['clips'][0]['alert_review_intervals'] = intervals
                self.save_manifest()
                with self.assertRaises(ValueError):
                    self.run_eval(False)

    def test_source_hash_frame_count_fps_camera_and_partial_mismatches_fail(self):
        original = copy.deepcopy(self.manifest)
        for field, value in [('source_sha256', '0'*64), ('frame_count', 5), ('fps', 2),
                             ('camera', 'other'), ('frame_count', True)]:
            with self.subTest(field=field):
                self.manifest = copy.deepcopy(original)
                self.manifest['clips'][0][field] = value
                self.save_manifest()
                with self.assertRaises(ValueError):
                    self.run_eval(False)
        self.manifest = original
        self.save_manifest()
        self.trace['state'] = 'partial'
        self.save_trace()
        with self.assertRaises(ValueError):
            self.run_eval(False)

    def test_missing_duplicate_or_unanalyzed_annotation_frames_fail(self):
        self.trace['frames'].pop(1)
        self.save_trace()
        with self.assertRaises(ValueError):
            self.run_eval(False)
        self.manifest, self.trace, self.reviews = make_fixture(self.root)
        self.manifest['clips'][0]['frames'].append(self.manifest['clips'][0]['frames'][0])
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.run_eval(False)

    def test_rule_hash_replay_and_run_identity_are_bound(self):
        original = copy.deepcopy(self.trace)
        for mutate in (lambda t: t['rules'][0].update(threshold=.99),
                       lambda t: t['events'].pop(), lambda t: t.update(run_id='changed'),
                       lambda t: t.update(rule_engine_sha256='0'*64)):
            self.trace = copy.deepcopy(original)
            mutate(self.trace)
            self.save_trace()
            with self.assertRaises(ValueError):
                self.run_eval(False)

    def test_changed_labels_hash_is_rejected(self):
        self.trace['labels_sha256'] = '0'*64
        self.save_trace()
        with self.assertRaises(ValueError):
            self.run_eval(False)

    def test_receipt_or_model_qualification_cannot_be_used_as_trace(self):
        for schema in ('intelligent-dvr.receipt.v1', 'intelligent-dvr.model-compatibility.v1'):
            self.trace['schema'] = schema
            self.save_trace()
            with self.assertRaises(ValueError):
                self.run_eval(False)

    def test_review_binding_duplicates_unknown_events_and_invalid_verdicts_fail(self):
        original = copy.deepcopy(self.reviews)
        for mutate in (lambda r: r.update(manifest_sha256='0'*64),
                       lambda r: r['decisions'].append(r['decisions'][0]),
                       lambda r: r['decisions'][0].update(event_id='unknown'),
                       lambda r: r['decisions'][0].update(trace_sha256='0'*64),
                       lambda r: r['decisions'][0].update(verdict='pending'),
                       lambda r: r['decisions'][0].update(reviewer='')):
            reviews = copy.deepcopy(original)
            mutate(reviews)
            write_json(self.root/'reviews.json', reviews)
            with self.assertRaises(ValueError):
                self.run_eval()

    def test_unknown_labels_geometry_and_nonfinite_predictions_fail(self):
        original = copy.deepcopy(self.trace)
        for change in ({'label': 'unknown'}, {'box': [0, 0, 2, 2]}, {'score': True}, {'score': -.1}):
            self.trace = copy.deepcopy(original)
            self.trace['frames'][0]['detections'][0].update(change)
            self.save_trace()
            with self.assertRaises(ValueError):
                self.run_eval(False)

    def test_hash_bound_yolox_profile_cannot_accept_fixture_or_reordered_labels(self):
        self.trace['inference_profile'] = 'opencv-zoo-yolox-s-2022nov'
        self.save_trace()
        with self.assertRaises(ValueError):
            self.run_eval(False)
        self.trace['model_sha256'] = 'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063'
        self.save_trace()
        with self.assertRaises(ValueError):
            self.run_eval(False)

    def test_real_data_cannot_use_precomputed_synthetic_trace(self):
        self.manifest['data_kind'] = 'approved-local-recordings'
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.run_eval(False)

    def test_duplicate_camera_source_and_path_escape_are_rejected(self):
        original = copy.deepcopy(self.manifest)
        self.manifest['clips'].append(copy.deepcopy(self.manifest['clips'][0]))
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.run_eval(False)
        self.manifest['clips'][1]['camera'] = 'other'
        self.save_manifest()
        with self.assertRaises(ValueError):
            self.run_eval(False)
        self.manifest = original
        for path in ('../outside.json', '/tmp/outside.json', 'rtsp://camera/stream'):
            self.manifest['labels'] = path
            self.save_manifest()
            with self.assertRaises(ValueError):
                self.run_eval(False)

    def test_symlink_duplicate_keys_and_nan_json_are_rejected(self):
        (self.root/'linked').symlink_to(self.root/'labels.json')
        with self.assertRaises(ValueError):
            read_json(self.root/'linked')
        (self.root/'parent').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            read_json(self.root/'parent'/'labels.json')
        for content in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}'):
            (self.root/'bad.json').write_text(content)
            with self.assertRaises(ValueError):
                read_json(self.root/'bad.json')

    def test_cli_is_reproducible_nonoverwriting_and_no_report_on_invalid_input(self):
        output = self.root/'report.json'
        command = [sys.executable, '-m', 'edge.evaluate', '--manifest', str(self.root/'manifest.json'),
                   '--reviews', str(self.root/'reviews.json'), '--output', str(output)]
        subprocess.run(command, check=True, capture_output=True)
        original = output.read_bytes()
        again = subprocess.run(command, capture_output=True)
        self.assertNotEqual(again.returncode, 0)
        self.assertEqual(output.read_bytes(), original)
        output.unlink()
        self.trace['state'] = 'partial'
        self.save_trace()
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
        self.assertFalse(output.exists())

    def test_two_camera_hours_are_summed_without_inventing_concurrency(self):
        # Distinct generated source per camera; sequential traces cannot qualify load.
        second = self.root/'second'
        m2, t2, _ = make_fixture(second)
        (second/'source.synthetic.txt').write_text('Another synthetic source, no recording.\n')
        t2['camera'] = 'synthetic-camera-2'
        t2['source_sha256'] = digest(second/'source.synthetic.txt')
        import hashlib
        from edge.rules import Rule, RuleEngine
        t2['run_id'] = hashlib.sha256((t2['source_sha256']+t2['model_sha256']).encode()).hexdigest()
        engine = RuleEngine([Rule(**r) for r in t2['rules']], t2['camera'], t2['run_id'])
        t2['events'] = [e for f in t2['frames'] for e in engine.update(f['seconds'], f['detections'])]
        write_json(second/'trace.json', t2)
        clip = m2['clips'][0]
        clip.update(camera=t2['camera'], source_sha256=t2['source_sha256'],
                    source='second/source.synthetic.txt', trace='second/trace.json')
        self.manifest['clips'].append(clip)
        self.save_manifest()
        result = self.run_eval(False)
        self.assertAlmostEqual(result['reviewed_camera_hours'], 8/3600)
        self.assertEqual(result['qualification']['five_camera_capacity'], 'unqualified')
        self.assertIsNone(result['false_alerts_per_camera_hour'])

    def test_invalid_thresholds_and_undefined_detection_denominators(self):
        for options in ({'score_threshold': .01}, {'iou_threshold': 0},
                        {'iou_threshold': float('nan')}, {'warmup_frames': -1}):
            with self.assertRaises(ValueError):
                self.run_eval(False, **options)
        result = self.run_eval(False, score_threshold=1)
        self.assertIsNone(result['per_class']['person']['precision'])
        self.assertEqual(result['per_class']['person']['recall'], 0)


class MatchingTest(unittest.TestCase):
    def test_iou_boundary_one_to_one_and_wrong_class(self):
        a = [0, 0, .5, .5]
        b = [0, 0, .25, .5]
        self.assertEqual(iou(a, b), .5)
        truth = [{'label': 'person', 'box': b}]
        predictions = [{'label': 'person', 'box': a, 'score': .9}]*2
        rows = match_frame(predictions, truth, ['person'], .5, .5)
        self.assertEqual([r['outcome'] for r in rows], ['TP', 'FP'])
        self.assertEqual(rows[0]['prediction_index'], 0)
        wrong = [{'label': 'car', 'box': b, 'score': 1}]
        rows = match_frame(wrong, truth, ['person', 'car'], .5, .5)
        self.assertEqual([r['outcome'] for r in rows], ['FN', 'FP'])

    def test_timing_quantiles_are_nearest_rank_not_sustained_throughput(self):
        self.assertEqual(timing_distribution([4, 1, 3, 2])['p50_ms'], 2)
        self.assertEqual(timing_distribution([4, 1, 3, 2])['p99_ms'], 4)
        self.assertIsNone(timing_distribution([])['mean_ms'])


if __name__ == '__main__':
    unittest.main()
