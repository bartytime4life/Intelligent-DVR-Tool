"""Tracker contract tests on synthetic boxes: continuity rules, not tracking accuracy."""
import itertools
import random
import unittest

from edge.tracking import (MAX_ACTIVE, REPORTED_PATH, Tracker, TrackerConfig, assign, class_summary, iou,
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

    def test_inputs_are_validated_before_state_changes(self):
        tracker = Tracker()
        tracker.update(1, [box(500, 300)], W, H)
        for args in ((1, [], W, H), (-1, [], W, H), (float('nan'), [], W, H), (2, [], 0, H), (2, [], 1.5, H),
                     (2, [{'label': 'person', 'score': 2, 'box': [0, 0, .1, .1]}], W, H),
                     (2, [{'label': 'person', 'score': .9, 'box': [0, 0, .1]}], W, H)):
            with self.assertRaises(ValueError):
                tracker.update(*args)
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


if __name__ == '__main__':
    unittest.main()
