"""Generated timing checks, with an optional constant-model CPU integration."""
import math
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

from edge.rules import Rule, RuleEngine


DETECTION = {'label': 'person', 'score': .9, 'box': [.3, .3, .2, .2]}


class RuleTimeBoundariesTest(unittest.TestCase):
    def engine(self, dwell=1, gap=.2):
        return RuleEngine([Rule('dock', 'person', (0, 0, 1, 1), dwell=dwell, max_gap=gap)])

    def test_sample_cadence_equal_to_gap_keeps_one_continuous_run(self):
        for fps, stride, dwell in [(25, 5, 1), (10, 1, .5), (30, 1, 1)]:
            with self.subTest(fps=fps, stride=stride):
                engine = self.engine(dwell=dwell, gap=stride/fps)
                observations = []
                for index in range(0, fps*30, stride):
                    observations.extend(engine.update(index/fps, [DETECTION]))
                self.assertEqual([event['seconds'] for event in observations], [dwell])
                self.assertEqual(observations[0]['started_seconds'], 0)

    def test_dwell_equality_does_not_wait_for_an_extra_frame(self):
        engine = self.engine(dwell=.1, gap=1)
        self.assertEqual(engine.update(.2, [DETECTION]), [])
        self.assertEqual([event['seconds'] for event in engine.update(.3, [DETECTION])], [.3])

    def test_genuine_over_gap_still_starts_a_new_run(self):
        engine = self.engine(dwell=.4)
        for index in range(100):
            self.assertEqual(engine.update(index*.200001, [DETECTION]), [])

    def test_genuine_under_dwell_does_not_emit_early(self):
        engine = self.engine(dwell=.1, gap=1)
        engine.update(.2, [DETECTION])
        self.assertEqual(engine.update(.299999, [DETECTION]), [])
        self.assertEqual(len(engine.update(.3, [DETECTION])), 1)

    def test_real_missed_samples_reset_and_qualifying_return_recovers(self):
        engine = self.engine(dwell=.4)
        engine.update(0, [DETECTION])
        engine.update(.2, [DETECTION])
        engine.update(.4, [])
        self.assertEqual(engine.update(.6, [DETECTION]), [])
        self.assertEqual(engine.update(.8, [DETECTION]), [])
        self.assertEqual(len(engine.update(1., [DETECTION])), 1)

    def test_late_recording_indices_keep_the_same_nominal_cadence(self):
        engine = self.engine(dwell=1)
        observations = []
        for index in range(900000, 900500, 5):
            observations.extend(engine.update(index/25, [DETECTION]))
        self.assertEqual([event['seconds'] for event in observations], [36001.])

    def test_underresolved_finite_clocks_do_not_turn_large_gaps_into_continuity(self):
        for start in [float(2**54), 1e100, 1e300]:
            engine = self.engine(dwell=1)
            self.assertEqual(engine.update(start, [DETECTION]), [])
            self.assertEqual(engine.update(math.nextafter(start, math.inf), [DETECTION]), [])

    def test_coarse_clock_preserves_strict_real_dwell_and_gap_boundaries(self):
        start = float(2**54)
        engine = self.engine(dwell=60, gap=60)
        engine.update(start, [DETECTION])
        self.assertEqual(engine.update(start+56, [DETECTION]), [])
        self.assertEqual(len(engine.update(start+60, [DETECTION])), 1)
        reset = self.engine(dwell=60, gap=60)
        reset.update(start, [DETECTION])
        self.assertEqual(reset.update(start+64, [DETECTION]), [])


@unittest.skipUnless(all(importlib.util.find_spec(name) for name in ['cv2', 'numpy', 'onnx', 'av']),
                     'Requires generated-model native analysis dependencies')
class NativeRuleTimeBoundariesTest(unittest.TestCase):
    def test_fractional_sampling_flows_through_analyzer_trace_review_and_evaluator(self):
        import cv2
        import numpy as np
        from edge.analyze import main
        from edge.evaluation import digest, validate_trace
        from local_analysis_fixture import build

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            build(root)
            source = root/'cadence.avi'
            writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*'MJPG'), 25, (96, 64))
            self.assertTrue(writer.isOpened())
            for _ in range(60):
                writer.write(np.full((64, 96, 3), 120, np.uint8))
            writer.release()
            (root/'rules.json').write_text(json.dumps([{
                'name': 'whole frame', 'label': 'person', 'rect': [0, 0, 1, 1],
                'dwell': 1, 'threshold': .7, 'max_gap': .2}]))
            args = ['--video', str(source), '--model', str(root/'fixture.onnx'),
                    '--labels', str(root/'labels.json'), '--rules', str(root/'rules.json'),
                    '--stride', '5', '--backend', 'opencv-cpu', '--output', str(root/'receipt.json'),
                    '--trace-output', str(root/'trace.json'), '--review-output', str(root/'review.json')]
            with contextlib.redirect_stdout(io.StringIO()):
                main(args)
            receipt = json.loads((root/'receipt.json').read_text())
            trace = json.loads((root/'trace.json').read_text())
            review = json.loads((root/'review.json').read_text())
            self.assertEqual(receipt['state'], 'completed')
            self.assertEqual([event['seconds'] for event in receipt['events']], [1.])
            self.assertEqual(trace['events'], receipt['events'])
            self.assertEqual(review['trace'], trace)
            self.assertEqual(review['receipt'], receipt)
            self.assertEqual(trace['rule_engine_sha256'], digest(Path(__file__).parents[1]/'edge/rules.py'))
            clip = {'camera': trace['camera'], 'source_sha256': digest(source), 'frame_count': 60, 'fps': 25}
            validate_trace(trace, ['person'], digest(root/'labels.json'), clip)
            old = {**trace, 'rule_engine_sha256': 'b6614c4a3a36e726beadbf5d444fbf8b78c5d40a844bc4ac77b468b6ea2a74fb'}
            with self.assertRaisesRegex(ValueError, 'rule engine differs'):
                validate_trace(old, ['person'], digest(root/'labels.json'), clip)


if __name__ == '__main__':
    unittest.main()
