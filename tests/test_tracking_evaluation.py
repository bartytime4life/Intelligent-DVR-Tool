"""Known-answer arithmetic, deterministic tracker fixtures and local-only contracts."""
import contextlib
import copy
import hashlib
import io
import itertools
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from edge.evaluate_tracking import main
from edge.tracking_evaluation import evaluate_tracking, metric_data, MAX_IDS
from edge._vendor.trackeval.assignment import linear_sum_assignment
from evaluation_fixtures import write_json
from tracking_evaluation_fixtures import make_fixture, obj, prediction, scenarios


class TrackingEvaluationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def build(self, truth=None, predictions=None, **kwargs):
        self.manifest, self.trace = make_fixture(self.root, truth, predictions, **kwargs)
        return self.score()

    def save(self):
        write_json(self.root/'manifest.json', self.manifest)
        write_json(self.root/'trace.json', self.trace)

    def score(self, **kwargs):
        self.save()
        return evaluate_tracking(self.root/'manifest.json', **kwargs)

    def test_perfect_and_empty_classes_use_ratio_units_and_null_no_truth(self):
        report = self.build()
        for key in ('MOTA', 'IDF1', 'HOTA', 'DetA', 'AssA'):
            self.assertAlmostEqual(report['aggregate'][key], 1)
            self.assertIsNone(report['per_class']['car'][key])
        self.assertTrue(report['human_review_required'])
        self.assertEqual(report['qualification']['physical_camera_tracking_accuracy'], 'unqualified')
        self.assertEqual(report['data_kind'], 'synthetic')

    def test_independently_supplied_swap_known_answers(self):
        truth = [[obj('A', .1), obj('B', .7)] for _ in range(4)]
        preds = [[dict(prediction(o), track=(j+1 if i < 2 else 2-j)) for j, o in enumerate(f)]
                 for i, f in enumerate(truth)]
        report = self.build(truth, preds, tracker=False)
        result = report['aggregate']
        self.assertEqual((result['TP'], result['FP'], result['FN'], result['IDSW']), (8, 0, 0, 2))
        self.assertEqual((result['IDTP'], result['IDFP'], result['IDFN']), (4, 4, 4))
        self.assertAlmostEqual(result['MOTA'], .75)
        self.assertAlmostEqual(result['IDF1'], .5)
        self.assertAlmostEqual(result['HOTA'], (1/3)**.5)
        self.assertEqual([e['frame_index'] for e in report['errors']], [4, 4])

    def test_false_track_and_never_matched_track_known_answers(self):
        truth = [[obj('A'), obj('B', .6)] for _ in range(3)]
        preds = [[dict(prediction(obj('A')), track=1), dict(prediction(obj('C', .3)), track=2)] for _ in truth]
        report = self.build(truth, preds, tracker=False)
        result = report['aggregate']
        self.assertEqual((result['TP'], result['FP'], result['FN'], result['IDSW']), (3, 3, 3, 0))
        self.assertAlmostEqual(result['MOTA'], 0)
        self.assertAlmostEqual(result['IDF1'], .5)
        self.assertAlmostEqual(result['HOTA'], (1/3)**.5)
        self.assertEqual(report['clips'][0]['per_class']['person']['never_matched_truth_tracks'], ['B'])
        self.assertEqual(sum(e['outcome'] == 'FP' for e in report['errors']), 3)
        self.assertEqual(sum(e['outcome'] == 'FN' for e in report['errors']), 3)

    def test_hota_alpha_sweep_uses_reference_thresholds(self):
        truth = [[{'track_id': 'A', 'label': 'person', 'box': [0, 0, .3, .5]}]]
        preds = [[{'track': 1, 'label': 'person', 'box': [.1, 0, .3, .5], 'score': .9}]]
        result = self.build(truth, preds, tracker=False)['aggregate']
        self.assertEqual(result['TP'], 1)
        self.assertAlmostEqual(result['HOTA'], 10/19)
        self.assertEqual(len(result['reference_results']['HOTA']['HOTA']), 19)

    def test_missing_predictions_and_false_only_sequences_are_not_success(self):
        result = self.build([[obj()]]*3, [[]]*3)['aggregate']
        self.assertEqual((result['TP'], result['FN'], result['MOTA'], result['IDF1'], result['HOTA']), (0, 3, 0, 0, 0))
        result = self.build([[]]*3, [[dict(prediction(obj()), track=1)]]*3, tracker=False)['aggregate']
        self.assertEqual(result['FP'], 3)
        self.assertIsNone(result['MOTA']); self.assertIsNone(result['IDF1']); self.assertIsNone(result['HOTA'])

    def test_mota_can_be_negative(self):
        truth = [[obj()]]
        preds = [[dict(prediction(obj('C', .5)), track=i) for i in range(1, 4)]]
        result = self.build(truth, preds, tracker=False)['aggregate']
        self.assertEqual(result['MOTA'], -3)

    def test_untracked_detections_are_visible_and_truth_is_missed(self):
        report = self.build([[obj()]]*2, [[prediction(obj())]]*2, tracker=False)
        self.assertEqual(report['aggregate']['FN'], 2)
        self.assertEqual(report['untracked_detection_count'], 2)
        self.assertEqual(report['aggregate']['IDF1'], 0)

    def test_confidence_threshold_is_explicit_and_low_score_matches_are_scored(self):
        truth, preds = scenarios()['confidence-changes']
        self.build(truth, preds)
        self.assertEqual(self.score()['aggregate']['FN'], 0)
        self.assertEqual(self.score(score_threshold=.5)['aggregate']['FN'], 3)

    def test_real_tracker_scenarios_are_repeatable_and_cover_gap_switch(self):
        for name, (truth, preds) in scenarios().items():
            with self.subTest(name=name):
                folder = self.root/name
                make_fixture(folder, truth, preds)
                before = {p.name: p.read_bytes() for p in folder.iterdir()}
                report = evaluate_tracking(folder/'manifest.json')
                make_fixture(folder, truth, preds)
                self.assertEqual(before, {p.name: p.read_bytes() for p in folder.iterdir()})
                self.assertEqual(report, evaluate_tracking(folder/'manifest.json'))
                if name == 'disappearance-reappearance':
                    self.assertEqual(report['aggregate']['IDSW'], 1)
                    self.assertEqual(report['aggregate']['FN'], 1)
                elif name == 'temporary-occlusion':
                    self.assertEqual(report['aggregate']['FN'], 3)
                    self.assertEqual(report['aggregate']['IDSW'], 0)
                else:
                    self.assertEqual(report['aggregate']['FN'], 0)
                    self.assertEqual(report['aggregate']['IDSW'], 0)

    def test_switch_after_gap_is_counted_against_last_matched_identity(self):
        truth = [[obj()], [], [], [obj()]]
        preds = [[dict(prediction(obj()), track=1)], [], [], [dict(prediction(obj()), track=2)]]
        report = self.build(truth, preds, tracker=False)
        self.assertEqual(report['aggregate']['IDSW'], 1)
        self.assertEqual(report['errors'][0]['frame_index'], 6)

    def test_expiry_separates_visitors_but_the_first_returning_hit_is_untracked(self):
        truth = [[obj('A')], [], [obj('B')], [obj('B')]]
        predictions = [[prediction(o) for o in frame] for frame in truth]
        report = self.build(truth, predictions, fps=2 / 3, stride=1)
        result = report['aggregate']
        # Avoiding an expired-ID join has a deliberate confirmation delay: the
        # new visitor's first detection is tentative and counts as a missed track.
        self.assertEqual((result['TP'], result['FN'], result['IDFP']), (2, 1, 0))
        self.assertEqual(report['untracked_detection_count'], 1)
        self.assertAlmostEqual(result['MOTA'], 2 / 3)
        self.assertAlmostEqual(result['IDF1'], .8)
        self.assertAlmostEqual(result['HOTA'], 2**-.5)
        self.assertEqual(report['qualification']['physical_camera_tracking_accuracy'], 'unqualified')

    def test_fractional_fps_and_stride_use_source_frame_index(self):
        report = self.build(fps=30000/1001, stride=5)
        clip = report['clips'][0]
        self.assertAlmostEqual(clip['sample_interval_seconds'], 5/(30000/1001))
        self.assertEqual(clip['frames_scored'], 4)

    def test_alignment_and_label_coverage_rejections(self):
        self.build()
        original_m, original_t = copy.deepcopy(self.manifest), copy.deepcopy(self.trace)
        mutations = [
            lambda: self.manifest['clips'][0]['frames'].pop(),
            lambda: self.manifest['clips'][0]['frames'].reverse(),
            lambda: self.manifest['clips'][0]['frames'][0].update(seconds=.01),
            lambda: self.trace['frames'][1].update(seconds=.123),
            lambda: self.trace.update(stride=1),
            lambda: self.trace['frames'].pop(),
            lambda: self.manifest['clips'][0]['frames'][0]['objects'].append(obj()),
            lambda: self.manifest['clips'][0]['frames'][0]['objects'][0].pop('track_id'),
            lambda: self.manifest['tracking'].update(independent_labels=False),
            lambda: self.manifest['tracking'].update(timebase='variable-frame-rate'),
            lambda: self.trace.update(state='partial'),
            lambda: self.trace['tracking'].update(tracker_sha256='0'*64),
            lambda: self.trace['frames'][0]['detections'][0].update(track=999),
            lambda: self.trace['frames'][0]['detections'].append(dict(self.trace['frames'][0]['detections'][0])),
            lambda: self.trace['tracking']['tracks'][0].update(label='car'),
            lambda: self.manifest['clips'][0]['frames'][1]['objects'][0].update(label='car'),
        ]
        for i, mutate in enumerate(mutations):
            with self.subTest(case=i):
                self.manifest, self.trace = copy.deepcopy(original_m), copy.deepcopy(original_t)
                mutate()
                with self.assertRaises(ValueError): self.score()

    def test_source_hash_and_synthetic_real_boundary(self):
        self.build()
        self.manifest['data_kind'] = 'approved-local-recordings'
        with self.assertRaisesRegex(ValueError, 'synthetic'): self.score()
        self.manifest['data_kind'] = 'synthetic'
        (self.root/'source.synthetic.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'SHA-256'): self.score()

    def test_classes_never_match_and_sequences_keep_separate_id_namespaces(self):
        first = self.build()
        folder = self.root/'second'
        other, _ = make_fixture(folder)
        clip = copy.deepcopy(other['clips'][0]); clip['camera'] = 'second-camera'
        trace = json.loads((folder/'trace.json').read_text()); trace['camera'] = 'second-camera'
        from edge.rules import RuleEngine, Rule
        engine = RuleEngine([Rule(**r) for r in trace['rules']], trace['camera'], trace['run_id'])
        trace['events'] = [e for f in trace['frames'] for e in engine.update(f['seconds'], f['detections'])]
        write_json(folder/'trace.json', trace)
        clip['source'] = 'second/'+clip['source']; clip['trace'] = 'second/'+clip['trace']
        self.manifest['clips'].append(clip)
        result = self.score()['aggregate']
        self.assertEqual(result['TP'], 2*first['aggregate']['TP'])
        self.assertEqual(result['IDF1'], 1)

    def test_wrong_class_at_same_location_is_false_track_plus_miss(self):
        report = self.build([[obj()]], [[dict(prediction(obj(label='car')), track=1)]], tracker=False)
        result = report['aggregate']
        self.assertEqual((result['TP'], result['FN'], result['FP']), (0, 1, 1))
        self.assertEqual(result['MOTA'], -1)
        self.assertEqual(result['IDF1'], 0)

    def test_aggregation_uses_counts_instead_of_average_clip_percentages(self):
        self.build()
        folder = self.root/'second'
        truth = [[obj()]]*4
        preds = [[dict(prediction(obj()), track=1)]]*2+[[], []]
        other, trace = make_fixture(folder, truth, preds, tracker=False)
        clip = copy.deepcopy(other['clips'][0]); clip['camera'] = 'second-camera'
        trace['camera'] = 'second-camera'
        from edge.rules import RuleEngine, Rule
        engine = RuleEngine([Rule(**r) for r in trace['rules']], trace['camera'], trace['run_id'])
        trace['events'] = [e for f in trace['frames'] for e in engine.update(f['seconds'], f['detections'])]
        write_json(folder/'trace.json', trace)
        clip['source'] = 'second/'+clip['source']; clip['trace'] = 'second/'+clip['trace']
        self.manifest['clips'].append(clip)
        result = self.score()['aggregate']
        self.assertEqual((result['TP'], result['FN']), (6, 2))
        self.assertAlmostEqual(result['MOTA'], .75)
        self.assertAlmostEqual(result['IDF1'], 6/7)
        self.assertAlmostEqual(result['HOTA'], (.75*5/6)**.5)

    def test_work_bounds_and_cli_refuses_overwrite_without_input_mutation(self):
        with self.assertRaisesRegex(ValueError, 'combined track IDs'):
            metric_data([[obj(str(i)) for i in range(MAX_IDS+1)]], [[]])
        self.build()
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        output = self.root/'report.json'
        argv = ['--manifest', str(self.root/'manifest.json'), '--output', str(output)]
        with contextlib.redirect_stdout(io.StringIO()): self.assertEqual(main(argv), 0)
        saved = output.read_bytes()
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): main(argv)
        self.assertEqual(output.read_bytes(), saved)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir() if p != output})
        self.assertEqual(json.loads(saved)['aggregate']['IDF1'], 1)

    def test_evaluation_never_opens_camera_network_model_or_review_store(self):
        self.build()
        with (patch('socket.socket', side_effect=AssertionError('network forbidden')),
              patch('subprocess.Popen', side_effect=AssertionError('worker forbidden'))):
            self.assertEqual(self.score()['aggregate']['TP'], 4)


class AssignmentTest(unittest.TestCase):
    def test_vendored_sources_match_pinned_adaptations(self):
        root = Path(__file__).resolve().parents[1]/'edge/_vendor/trackeval'
        metadata = json.loads((root/'upstream.json').read_text())
        self.assertEqual(metadata['commit'], '12c8791b303e0a0b50f753af204249e622d0281a')
        for name, expected in metadata['adapted_sha256'].items():
            self.assertEqual(hashlib.sha256((root/name).read_bytes()).hexdigest(), expected, name)

    def test_reused_assignment_is_optimal_against_exhaustive_reference(self):
        rng = random.Random(271828)
        for rows in range(1, 5):
            for cols in range(1, 5):
                for trial in range(10):
                    matrix = np.array([[rng.choice([0, 0, 1e10, -1000, rng.random()]) for _ in range(cols)] for _ in range(rows)])
                    r, c = linear_sum_assignment(matrix)
                    work = matrix if rows <= cols else matrix.T
                    expected = min(sum(work[i, col] for i, col in enumerate(p))
                                   for p in itertools.permutations(range(work.shape[1]), work.shape[0]))
                    self.assertAlmostEqual(float(matrix[r, c].sum()), float(expected), delta=1e-5)
                    r2, c2 = linear_sum_assignment(matrix)
                    self.assertEqual((r.tolist(), c.tolist()), (r2.tolist(), c2.tolist()))
        r, c = linear_sum_assignment(np.zeros((0, 2)))
        self.assertEqual(len(r)+len(c), 0)


if __name__ == '__main__':
    unittest.main()
