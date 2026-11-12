"""Generated motion/sampling tests with a Python backend stub, never inference.

JPEG codecs and the real motion gate/tracker run locally. Detections are
prescribed independently; no ONNX model, camera, network or private input is used.
"""
import io
import json
import unittest
from unittest.mock import Mock, patch

from edge import live_worker, tracking

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = np = None


def person():
    return {'label': 'person', 'score': .9, 'box': [.375, .25, .25, .5]}


class DetectionSamplingPolicyTest(unittest.TestCase):
    def test_tentative_state_requires_detection_before_it_has_a_report_id(self):
        tracker = tracking.Tracker()
        tracker.update(0, [], 320, 240)
        self.assertFalse(tracker.needs_detection(0))
        self.assertEqual(tracker.update(.21, [person()], 320, 240), [None])
        self.assertEqual(tracker.active(), [])
        self.assertTrue(tracker.needs_detection(.42))
        self.assertEqual(tracker.update(.42, [person()], 320, 240), [1])

    def test_recently_lost_state_is_eligible_through_exact_expiry_only(self):
        tracker = tracking.Tracker()
        tracker.update(0, [person()], 320, 240)
        tracker.update(.21, [], 320, 240)
        self.assertEqual(tracker.active()[0]['state'], 'lost')
        self.assertTrue(tracker.needs_detection(2.0))
        self.assertFalse(tracker.needs_detection(2.000001))
        # Policy queries must not renew the last-hit timestamp or retire state.
        self.assertEqual(tracker.previous, .21)
        self.assertEqual(tracker.active()[0]['last_seconds'], 0)
        self.assertEqual(tracker.update(2.0, [person()], 320, 240), [1])

    def test_expired_association_cannot_force_detection_or_revive_its_id(self):
        tracker = tracking.Tracker()
        tracker.update(0, [person()], 320, 240)
        tracker.update(.21, [], 320, 240)
        self.assertFalse(tracker.needs_detection(2.000001))
        self.assertEqual(tracker.update(2.000001, [person()], 320, 240), [None])
        self.assertTrue(tracker.needs_detection(2.21))
        self.assertEqual(tracker.update(2.21, [person()], 320, 240), [2])

    def test_report_cap_does_not_disable_sampling_for_unnumbered_tracks(self):
        with patch.object(tracking, 'MAX_SUMMARIES', 0):
            tracker = tracking.Tracker()
            self.assertEqual(tracker.update(0, [person()], 320, 240), [None])
            self.assertEqual(tracker.active(), [])
            self.assertTrue(tracker.needs_detection(.21))
            self.assertEqual(tracker.update(.21, [person()], 320, 240), [None])
            self.assertEqual(tracker.tracks[0].hits, 2)
            self.assertFalse(tracker.needs_detection(2.210001))

    def test_policy_rejects_invalid_or_backwards_query_times(self):
        tracker = tracking.Tracker()
        tracker.update(1, [person()], 320, 240)
        for seconds in (-1, float('nan'), float('inf'), True, None, .99):
            with self.subTest(seconds=seconds), self.assertRaises(ValueError):
                tracker.needs_detection(seconds)


@unittest.skipIf(cv2 is None, 'Optional OpenCV/NumPy dependencies are unavailable')
class MotionGateWorkerTest(unittest.TestCase):
    def run_generated(self, frames, prescribed):
        config = {'model': 'unused-python-stub.onnx', 'model_sha256': 'f' * 64,
                  'profile': 'yolov8-raw-640', 'labels': ['person'],
                  'rules': [{'name': 'all', 'label': 'person', 'rect': [0, 0, 1, 1]}],
                  'camera': 'Generated motion fixture', 'run_id': 'f' * 32,
                  'motion_gate': True}
        stream = io.BytesIO(json.dumps(config).encode() + b'\n')
        stream.seek(0, io.SEEK_END)
        for i, frame in enumerate(frames):
            encoded, data = cv2.imencode('.jpg', frame)
            self.assertTrue(encoded)
            data = data.tobytes()
            stream.write(live_worker.HEADER.pack(i * .21, len(data)) + data)
        stream.write(live_worker.HEADER.pack(0, 0))
        stream.seek(0)
        output = io.BytesIO()
        backend = Mock(runtime={'backend': 'generated-python-stub'})
        backend.forward.return_value = None
        detections = iter(prescribed)
        with patch('edge.cpu_backend.create_backend', return_value=backend), \
             patch('edge.analyze.decode', side_effect=lambda *args: [dict(d, box=list(d['box'])) for d in next(detections)]):
            live_worker.run(stream, output)
        backend.close.assert_called_once()
        return [json.loads(line) for line in output.getvalue().splitlines()][1:], backend.forward.call_count - 1

    @staticmethod
    def frames():
        empty = np.full((240, 320, 3), 80, dtype=np.uint8)
        occupied = empty.copy()
        occupied[60:180, 120:200] = 220
        return empty, occupied

    def test_stationary_arrival_is_confirmed_at_next_point21_second_frame(self):
        empty, occupied = self.frames()
        frames = [empty] + [occupied] * 34
        results, detector_runs = self.run_generated(frames, [[]] + [[person()]] * 34)
        self.assertGreater(results[1]['motion'], live_worker.MOTION_IDLE)
        self.assertEqual(results[2]['motion'], 0)
        self.assertEqual([r['detector'] for r in results], ['ran'] * len(frames))
        self.assertNotIn('track', results[1]['detections'][0])
        self.assertEqual(results[2]['detections'][0]['track'], 1)
        self.assertTrue(all(r['detections'][0]['track'] == 1 for r in results[2:]))
        self.assertEqual(detector_runs, len(frames))

    def test_lost_stationary_object_gets_an_immediate_recovery_sample(self):
        _, occupied = self.frames()
        results, detector_runs = self.run_generated([occupied] * 3, [[person()], [], [person()]])
        self.assertEqual([r['detector'] for r in results], ['ran'] * 3)
        self.assertEqual(results[1]['tracks'][0]['state'], 'lost')
        self.assertEqual(results[2]['detections'][0]['track'], 1)
        self.assertEqual(detector_runs, 3)

    def test_lost_retry_budget_expires_and_idle_keyframes_resume(self):
        _, occupied = self.frames()
        results, detector_runs = self.run_generated([occupied] * 35, [[person()]] + [[]] * 34)
        # Last match is t=0: sample every frame through t=1.89, then stop
        # forcing detection at t=2.1. Subsequent empty keyframes stay 2.1s apart.
        self.assertEqual([i for i, r in enumerate(results) if r['detector'] == 'ran'],
                         [*range(10), 19, 29])
        self.assertEqual(detector_runs, 12)
        self.assertTrue(all(not r['tracks'] for r in results[19:]))

    def test_empty_stationary_scene_retains_its_two_second_keyframes(self):
        empty, _ = self.frames()
        results, detector_runs = self.run_generated([empty] * 35, [[]] * 35)
        self.assertEqual([i for i, r in enumerate(results) if r['detector'] == 'ran'], [0, 10, 20, 30])
        self.assertEqual(detector_runs, 4)
        self.assertTrue(all(not r['detections'] and not r['tracks'] for r in results))

    def test_unnumbered_stationary_tracks_continue_sampling_at_the_summary_cap(self):
        _, occupied = self.frames()
        with patch.object(tracking, 'MAX_SUMMARIES', 0):
            results, detector_runs = self.run_generated([occupied] * 4, [[person()]] * 4)
        self.assertEqual([r['detector'] for r in results], ['ran'] * 4)
        self.assertEqual(detector_runs, 4)
        self.assertTrue(all(not r['tracks'] for r in results))
        self.assertTrue(all('track' not in r['detections'][0] for r in results))


if __name__ == '__main__':
    unittest.main()
