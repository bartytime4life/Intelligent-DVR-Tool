"""Tracker contract tests on synthetic boxes: continuity rules, not tracking accuracy."""
import itertools
import random
import unittest

import numpy as np

from edge.tracking import (MAX_ACTIVE, MAX_PATH, REPORTED_PATH, Kalman, Tracker, TrackerConfig, assign, assign_gated, class_summary, iou,
                           zones_from_rules)
from edge.rules import Rule

W, H = 1280, 720


def box(x, y, w=80, h=200, score=.9, label='person'):
    return {'label': label, 'score': score, 'box': [x / W, y / H, w / W, h / H]}


class AssignmentTest(unittest.TestCase):
    def test_matches_brute_force_on_random_rectangular_costs(self):
        rng = random.Random(7)
        for _ in range(400):
            n, m = rng.randint(1, 5), rng.randint(1, 5)
            cost = [[rng.random() for _ in range(m)] for _ in range(n)]
            limit = rng.choice([.25, .5, .75, 1.])
            pairs, free_rows, free_cols = assign(cost, limit)
            best = None
            for chosen in itertools.permutations(range(max(n, m)), min(n, m)):
                pp = list(zip(range(n), chosen)) if n <= m else list(zip(chosen, range(m)))
                feasible = [(r, c) for r, c in pp if cost[r][c] <= limit]
                key = (-len(feasible), round(sum(cost[r][c] for r, c in feasible), 9))
                best = key if best is None or key < best else best
            self.assertEqual((-len(pairs), round(sum(cost[r][c] for r, c in pairs), 9)), best)
            self.assertEqual(sorted({r for r, _ in pairs} | set(free_rows)), list(range(n)))
            self.assertEqual(sorted({c for _, c in pairs} | set(free_cols)), list(range(m)))

    def test_empty_and_fully_infeasible_inputs(self):
        self.assertEqual(assign([[]], 1), ([], [0], []))
        self.assertEqual(assign([[2., 3.]], 1), ([], [0], [0, 1]))

    def test_iou(self):
        self.assertAlmostEqual(iou([[0, 0, 10, 10]], [[5, 0, 10, 10]])[0, 0], 50 / 150)
        self.assertEqual(iou([[0, 0, 10, 10]], [[20, 20, 5, 5]])[0, 0], 0)


class KalmanTest(unittest.TestCase):
    def test_elapsed_noise_matches_split_predictions_at_fixed_height(self):
        kalman = Kalman()
        mean, cov = kalman.initiate(kalman.measure([100, 100, 80, 200]))
        # No height velocity: the noise rates stay fixed over the whole interval.
        for a, b in ((4, 6), (.1, .3), (0, 2), (1.25, 9.5)):
            with self.subTest(a=a, b=b):
                whole_mean, whole_cov = kalman.predict(mean, cov, a + b)
                split_mean, split_cov = kalman.predict(mean, cov, a)
                split_mean, split_cov = kalman.predict(split_mean, split_cov, b)
                np.testing.assert_allclose(whole_mean, split_mean, atol=1e-10)
                np.testing.assert_allclose(whole_cov, split_cov, atol=1e-10)

    def test_velocity_noise_propagates_into_position_and_cross_covariance(self):
        from edge.tracking import WEIGHT_POSITION, WEIGHT_VELOCITY
        kalman = Kalman()
        mean = np.array([100., 100., .4, 200., 0, 0, 0, 0])
        steps = 10
        _, cov = kalman.predict(mean, np.zeros((8, 8)), steps)
        qp, qv = (WEIGHT_POSITION * 200)**2, (WEIGHT_VELOCITY * 200)**2
        self.assertAlmostEqual(cov[0, 0], qp * steps + qv * steps**3 / 3)
        self.assertAlmostEqual(cov[0, 4], qv * steps**2 / 2)
        self.assertAlmostEqual(cov[4, 4], qv * steps)
        self.assertGreaterEqual(np.linalg.eigvalsh(cov).min(), -1e-10)

    def test_repeated_irregular_updates_keep_covariance_symmetric_positive(self):
        kalman = Kalman()
        mean, cov = kalman.initiate(kalman.measure([100, 100, 80, 200]))
        for k in range(500):
            mean, cov = kalman.predict(mean, cov, (.03, .7, 8.)[k % 3])
            mean, cov = kalman.update(mean, cov, kalman.measure([100 + k / 10, 100, 80, 200]))
            self.assertTrue(np.isfinite(mean).all() and np.isfinite(cov).all())
            np.testing.assert_allclose(cov, cov.T, atol=1e-12)
            self.assertGreaterEqual(np.linalg.eigvalsh(cov).min(), -1e-10)


class TrackerTest(unittest.TestCase):
    def test_crossing_people_keep_ids_through_a_miss_and_a_low_score_frame(self):
        tracker, ids = Tracker(), []
        for k in range(40):
            a, b = box(100 + 20 * k, 200), box(1000 - 20 * k, 260, score=.85)
            if k == 25:
                a['score'] = .3  # ByteTrack's second stage keeps a low-confidence box on its track.
            ids.append(tracker.update(k / 3, [b] if k == 20 else [a, b], W, H))
        self.assertEqual(ids[0], [1, 2])  # The first frame's confident boxes are confirmed at once.
        self.assertEqual(ids[20], [2])
        self.assertTrue(all(x == [1, 2] for i, x in enumerate(ids) if i != 20))
        record = tracker.finish()
        self.assertEqual([t['id'] for t in record['tracks']], [1, 2])
        self.assertEqual(record['classes']['person']['tracks'], 2)
        self.assertEqual(record['tracks_dropped'], 0)

    def test_new_tracks_need_a_second_confident_frame_and_ids_stay_contiguous(self):
        tracker = Tracker()
        self.assertEqual(tracker.update(0, [], W, H), [])
        self.assertEqual(tracker.update(.2, [box(500, 300)], W, H), [None])  # tentative
        self.assertEqual(tracker.update(.4, [box(900, 100, label='car', w=200, h=100)], W, H), [None])
        # The tentative person was not matched again, so it was dropped without using an ID.
        self.assertEqual(tracker.update(.6, [box(905, 100, label='car', w=200, h=100)], W, H), [1])
        self.assertEqual(tracker.update(.8, [box(500, 300, score=.55)], W, H), [None])  # below new-track score
        self.assertEqual([t['label'] for t in tracker.finish()['tracks']], ['car'])

    def test_matching_is_class_aware(self):
        tracker = Tracker()
        tracker.update(0, [box(500, 300)], W, H)
        self.assertEqual(tracker.update(.2, [box(500, 300, label='dog')], W, H), [None])
        self.assertEqual(tracker.update(.4, [box(500, 300, label='dog'), box(500, 300)], W, H), [2, 1])

    def test_resized_frames_match_the_same_normalized_input_in_a_fixed_size_run(self):
        reference, resized = Tracker(), Tracker()
        sizes = [(W, H), (640, 360), (1920, 1080), (640, 480), (960, 540)]
        for k in range(60):
            detections = [box(120 + 3 * k, 200, score=.3 if k == 11 else .9),
                          box(900 - 2 * k, 100, label='car', w=120, h=80)]
            if k == 10:
                detections.pop(0)
            if k >= 16:
                detections.append(box(600, 400, label='dog', w=50, h=70))
            expected = reference.update(k / 10, detections, W, H)
            self.assertEqual(resized.update(k / 10, detections, *sizes[k % len(sizes)]), expected)
            self.assertEqual(resized.active(), reference.active())
            for a, b in zip(resized.tracks, reference.tracks):
                np.testing.assert_array_equal(a.mean, b.mean)
                np.testing.assert_array_equal(a.cov, b.cov)
        self.assertEqual(resized.finish(), reference.finish())

    def test_lost_box_stays_normalized_when_an_empty_frame_has_a_new_size(self):
        tracker = Tracker()
        detection = {'label': 'person', 'score': .9, 'box': [.6, .2, .1, .3]}
        tracker.update(0, [detection], W, H)
        tracker.update(.1, [], 640, 360)
        self.assertEqual(tracker.active()[0]['box'], detection['box'])
        self.assertEqual(tracker.active()[0]['state'], 'lost')
        self.assertEqual(tracker.update(.2, [detection], 1920, 1080), [1])

    def test_empty_first_frame_establishes_coordinates_without_confirming_later_tracks(self):
        tracker = Tracker()
        tracker.update(0, [], 640, 360)
        detection = {'label': 'person', 'score': .9, 'box': [.6, .2, .1, .3]}
        self.assertEqual(tracker.update(.1, [detection], W, H), [None])
        self.assertEqual(tracker.update(.2, [detection], 320, 240), [1])
        self.assertEqual(tracker.active()[0]['box'], detection['box'])

    def test_resize_does_not_revive_an_expired_track(self):
        tracker = Tracker(TrackerConfig(max_lost_seconds=1))
        detection = box(768, 144, w=128, h=216)
        tracker.update(0, [detection], W, H)
        self.assertEqual(tracker.update(2, [detection], 640, 360), [None])
        self.assertEqual(tracker.update(2.1, [detection], W, H), [2])
        self.assertEqual(len(tracker.finish()['tracks']), 2)

    def test_mixed_classes_use_independent_assignment_blocks_in_all_stages(self):
        from unittest.mock import patch
        tracker = Tracker()
        boxes = [box(100 + 200 * i, 100, label=label) for i in range(2)
                 for label in ('person', 'car', 'dog')]
        tracker.update(0, boxes, W, H)
        with patch('edge.tracking.assign_gated', wraps=assign_gated) as solver:
            # Reverse detection order: local block indices must map back correctly.
            self.assertEqual(tracker.update(.2, boxes[::-1], W, H), [6, 5, 4, 3, 2, 1])
            self.assertEqual([call.args[0].shape for call in solver.call_args_list], [(2, 2)] * 3)
            solver.reset_mock()
            low = [{**b, 'score': .3} for b in boxes]
            self.assertEqual(tracker.update(.4, low, W, H), [1, 2, 3, 4, 5, 6])
            self.assertEqual([call.args[0].shape for call in solver.call_args_list], [(2, 2)] * 3)
        tracker = Tracker()
        tracker.update(0, [], W, H)
        tracker.update(.1, boxes, W, H)
        with patch('edge.tracking.assign_gated', wraps=assign_gated) as solver:
            self.assertEqual(tracker.update(.2, boxes[::-1], W, H), [6, 5, 4, 3, 2, 1])
            self.assertEqual([call.args[0].shape for call in solver.call_args_list], [(2, 2)] * 3)

    def test_classes_without_partners_leave_tracks_lost_and_detections_tentative(self):
        tracker = Tracker()
        tracker.update(0, [box(100, 100, label='person'), box(500, 100, label='car')], W, H)
        self.assertEqual(tracker.update(.1, [box(500, 100, label='car'), box(100, 100, label='dog')], W, H), [2, None])
        self.assertEqual([(t['id'], t['state']) for t in tracker.active()], [(1, 'lost'), (2, 'tracked')])

    def test_class_partition_has_the_same_optimum_as_a_full_assignment(self):
        rng = random.Random(41)
        for _ in range(100):
            tracker = Tracker()
            def detections():
                return [box(rng.randrange(1000), rng.randrange(450), w=200, h=200,
                            label=rng.choice(('person', 'car', 'dog')))
                        for _ in range(rng.randint(1, 12))]
            initial, current = detections(), detections()
            tracker.update(0, initial, W, H)
            predicted = [tracker.kalman.box(tracker.kalman.predict(t.mean, t.cov, .3)[0])
                         for t in tracker.tracks]
            observed = [[d['box'][0] * W, d['box'][1] * H, d['box'][2] * W, d['box'][3] * H]
                        for d in current]
            cost = 1 - iou(predicted, observed) * .9
            for r, before in enumerate(initial):
                for c, after in enumerate(current):
                    if before['label'] != after['label']:
                        cost[r, c] = 2
            expected, _, _ = assign(cost, 1 - tracker.config.match_iou)
            ids = tracker.update(.01, current, W, H)
            actual = [(key - 1, c) for c, key in enumerate(ids) if key is not None]
            self.assertEqual(len(actual), len(expected))
            self.assertAlmostEqual(sum(cost[r, c] for r, c in actual), sum(cost[r, c] for r, c in expected))

    def test_lost_tracks_reappear_within_the_buffer_and_expire_after_it(self):
        tracker = Tracker(TrackerConfig(max_lost_seconds=1.0))
        tracker.update(0, [box(500, 300)], W, H)
        tracker.update(.3, [box(505, 300)], W, H)
        tracker.update(.6, [], W, H)
        self.assertEqual(tracker.update(1.2, [box(515, 300)], W, H), [1])  # re-found 0.9 s later
        tracker.update(1.5, [], W, H)
        tracker.update(2.6, [], W, H)  # 1.4 s since last seen: finished
        self.assertEqual(tracker.update(2.8, [box(520, 300)], W, H), [None])
        self.assertEqual(tracker.update(3.0, [box(520, 300)], W, H), [2])
        tracks = tracker.finish()['tracks']
        self.assertEqual([(t['id'], t['first_seconds'], t['last_seconds']) for t in tracks], [(1, 0, 1.2), (2, 2.8, 3.0)])

    def test_per_track_zone_dwell_uses_the_rule_rectangle_label_and_gap(self):
        rules = [Rule(name='door', label='person', rect=(0, 0, .5, 1), max_gap=1), Rule(name='lot', label='car', rect=(0, 0, 1, 1))]
        tracker = Tracker(zones=zones_from_rules(rules))
        for k in range(12):
            tracker.update(k * .5, [box(100 + 50 * k, 300)], W, H)  # centre leaves x <= 0.5 after k = 10 (5 s)
        track = tracker.finish()['tracks'][0]
        self.assertEqual(set(track['zones']), {'door'})
        self.assertEqual(track['zones']['door']['entered_seconds'], 0)
        self.assertAlmostEqual(track['zones']['door']['seconds'], 5.0)

    def test_expiry_precedes_association_even_without_an_intermediate_empty_frame(self):
        for missed in (False, True):
            with self.subTest(missed=missed):
                tracker = Tracker(TrackerConfig(max_lost_seconds=1))
                tracker.update(0, [box(500, 300)], W, H)
                if missed:
                    tracker.update(.5, [], W, H)
                self.assertEqual(tracker.update(3, [box(500, 300)], W, H), [None])
                self.assertEqual(tracker.update(3.2, [box(500, 300)], W, H), [2])
                self.assertEqual([(t['id'], t['last_seconds']) for t in tracker.finish()['tracks']],
                                 [(1, 0), (2, 3.2)])

    def test_exact_expiry_boundary_remains_eligible_and_tentative_tracks_also_expire(self):
        tracker = Tracker(TrackerConfig(max_lost_seconds=1))
        tracker.update(0, [box(500, 300)], W, H)
        self.assertEqual(tracker.update(1, [box(500, 300)], W, H), [1])
        tracker = Tracker(TrackerConfig(max_lost_seconds=1))
        tracker.update(0, [], W, H)
        tracker.update(.1, [box(500, 300)], W, H)
        self.assertEqual(tracker.update(3, [box(500, 300)], W, H), [None])
        self.assertEqual(tracker.update(3.2, [box(500, 300)], W, H), [1])
        self.assertEqual(tracker.finish()['tracks'][0]['first_seconds'], 3)

    def test_expired_tracks_release_capacity_before_new_admission(self):
        from unittest.mock import patch
        with patch('edge.tracking.MAX_ACTIVE', 1):
            tracker = Tracker(TrackerConfig(max_lost_seconds=1))
            tracker.update(0, [box(100, 100)], W, H)
            self.assertEqual(tracker.update(3, [box(900, 100)], W, H), [None])
            self.assertEqual(tracker.dropped, 0)
            self.assertEqual(tracker.update(3.2, [box(900, 100)], W, H), [2])

    def test_paths_are_downsampled_and_active_tracks_are_reported(self):
        tracker = Tracker()
        for k in range(200):
            tracker.update(k / 10, [box(100 + 2 * k, 300)], W, H)
        active = tracker.active()
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]['id'], 1)
        self.assertEqual(active[0]['state'], 'tracked')
        self.assertAlmostEqual(active[0]['box'][0], (100 + 2 * 199) / W, places=5)
        track = tracker.finish()['tracks'][0]
        self.assertEqual(len(track['path']), REPORTED_PATH)
        self.assertEqual(track['path'][0][0], 0)
        self.assertAlmostEqual(track['path'][-1][0], 19.9)

    def test_long_paths_keep_endpoints_and_span_the_whole_run_with_bounded_memory(self):
        from unittest.mock import patch
        # Force several compactions cheaply, then separately cross the production cap.
        for cap, count in ((8, 137), (MAX_PATH, MAX_PATH + 101)):
            with self.subTest(cap=cap), patch('edge.tracking.MAX_PATH', cap):
                tracker = Tracker()
                for k in range(count):
                    tracker.update(k / 10, [box(100 + k / 10, 300)], W, H)
                    self.assertLessEqual(len(tracker.tracks[0].path), cap)
                path = tracker.finish()['tracks'][0]['path']
                times = [p[0] for p in path]
                self.assertLessEqual(len(path), REPORTED_PATH)
                self.assertEqual(times[0], 0)
                self.assertEqual(times[-1], (count - 1) / 10)
                self.assertEqual(times, sorted(set(times)))
                self.assertTrue(any((count - 1) / 30 < t < (count - 1) / 15 for t in times))
                self.assertAlmostEqual(path[-1][1], (140 + (count - 1) / 10) / W, places=5)

    def test_inputs_are_validated_before_state_changes(self):
        tracker = Tracker()
        tracker.update(1, [box(500, 300)], W, H)
        for args in ((1, [], W, H), (-1, [], W, H), (float('nan'), [], W, H), (2, [], 0, H), (2, [], 1.5, H),
                     (2, [{'label': 'person', 'score': 2, 'box': [0, 0, .1, .1]}], W, H),
                     (2, [{'label': 'person', 'score': .9, 'box': [0, 0, .1]}], W, H),
                     *((2, [{**box(500, 300), 'label': label}], W, H)
                       for label in (None, [], '', ' ', 'x' * 81, ' ' * 81 + 'p'))):
            with self.assertRaises(ValueError):
                tracker.update(*args)
            self.assertEqual(tracker.previous, 1)
        with self.assertRaises(ValueError):
            TrackerConfig(high=.7, new_track=.6)
        with self.assertRaises(ValueError):
            TrackerConfig(max_lost_seconds=0)

    def test_active_track_count_is_bounded(self):
        tracker = Tracker()
        many = [box(10 * (i % 120), 6 * (i // 120), w=5, h=5) for i in range(MAX_ACTIVE + 30)]
        tracker.update(0, many, W, H)
        self.assertLessEqual(len(tracker.tracks), MAX_ACTIVE)
        self.assertEqual(tracker.dropped, 30)

    def test_numbered_tracks_never_exceed_the_summary_cap(self):
        from unittest.mock import patch
        from edge import tracking
        with patch.object(tracking, 'MAX_SUMMARIES', 2):
            tracker = Tracker()
            boxes = [box(100, 100), box(500, 100), box(900, 100)]
            self.assertEqual(tracker.update(0, boxes, W, H), [1, 2, None])
            self.assertEqual(tracker.update(.2, boxes, W, H), [1, 2, None])  # Followed, never numbered.
            tracker.update(.4, boxes + [box(300, 400)], W, H)
            self.assertEqual(tracker.update(.6, boxes + [box(300, 400)], W, H)[3], None)
            record = tracker.finish()
        self.assertEqual([t['id'] for t in record['tracks']], [1, 2])
        self.assertEqual(record['tracks_dropped'], 2)

    def test_class_summary(self):
        tracks = [{'label': 'person', 'duration_seconds': d} for d in (1, 5, 3)] + [{'label': 'car', 'duration_seconds': 2}]
        self.assertEqual(class_summary(tracks), {'car': {'tracks': 1, 'median_duration_seconds': 2, 'longest_duration_seconds': 2},
                                                 'person': {'tracks': 3, 'median_duration_seconds': 3, 'longest_duration_seconds': 5}})
        self.assertEqual(class_summary([{'label': 'person', 'duration_seconds': d} for d in (1, 9)])['person']['median_duration_seconds'], 5)


if __name__ == '__main__':
    unittest.main()
