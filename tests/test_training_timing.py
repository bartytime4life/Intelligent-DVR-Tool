"""Bounded presentation timestamps from the analyzer's existing strict decode."""
import contextlib
from fractions import Fraction
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from edge.evaluation import digest
from edge.media_coverage import CoverageError, validate, verify


class SampleTimingTest(unittest.TestCase):
    def test_missing_or_regressing_unsampled_pts_disables_the_entire_extension(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'synthetic.webm'
            source.write_bytes(b'\x1aE\xdf\xa3'+bytes(30))
            source_hash = digest(source)
            for times, expected in [([40, 41, 45, 51], [0., .5]), ([40, None, 45, 51], [None, None]),
                                    ([40, 41, 45, 42], [None, None])]:
                frames = [SimpleNamespace(pts=pts, time_base=Fraction(1, 10), duration=1, width=32,
                                          height=24, is_corrupt=False) for pts in times]
                video = SimpleNamespace(frames=4, duration=None, codec_context=SimpleNamespace(width=32, height=24, options={}))
                class Streams(list): pass
                streams = Streams([video]); streams.video = [video]
                container = SimpleNamespace(streams=streams, duration=None,
                    demux=lambda stream: [SimpleNamespace(is_corrupt=False, decode=lambda: frames)])
                av = SimpleNamespace(open=lambda *a, **kw: contextlib.nullcontext(container),
                                     __version__='test', error=SimpleNamespace(FFmpegError=OSError))
                with self.subTest(times=times), patch.dict('sys.modules', av=av):
                    selected = {0: None, 2: None}
                    coverage = verify(source, source_hash, 4, sampled_pts=selected)
                    self.assertEqual(list(selected.values()), expected)
                    validate(coverage, source_hash, 4, 'completed')
                    self.assertNotIn('source_timing', coverage)
                    wrong_hash = {0: None}
                    with self.assertRaises(CoverageError): verify(source, 'b'*64, 4, sampled_pts=wrong_hash)
                    self.assertEqual(wrong_hash, {0: None})

    @unittest.skipUnless(all(importlib.util.find_spec(x) for x in ['av', 'cv2', 'onnx', 'numpy']),
                         'Requires native analysis dependencies')
    def test_vfr_recording_normal_entry_point_preserves_both_clocks(self):
        import av
        import numpy as np
        from edge.analyze import main
        from local_analysis_fixture import build
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); build(root)
            source = root/'variable.webm'
            with av.open(str(source), 'w') as container:
                stream = container.add_stream('libvpx', rate=25)
                stream.width = 96; stream.height = 64; stream.pix_fmt = 'yuv420p'
                for timestamp in [0, 1, 2, 6, 12, 13]:
                    frame = av.VideoFrame.from_ndarray(np.full((64, 96, 3), 120, np.uint8), format='bgr24')
                    frame.pts = timestamp; frame.time_base = Fraction(1, 25)
                    for packet in stream.encode(frame): container.mux(packet)
                for packet in stream.encode(): container.mux(packet)
            args = ['--video', str(source), '--model', str(root/'fixture.onnx'), '--labels', str(root/'labels.json'),
                    '--rules', str(root/'rules.json'), '--stride', '2', '--max-frames', '8',
                    '--output', str(root/'receipt.json'), '--review-output', str(root/'review.json')]
            with contextlib.redirect_stdout(io.StringIO()): main(args)
            bundle = json.loads((root/'review.json').read_text())
            trace = bundle['trace']; coverage = trace['media_coverage']
            self.assertEqual(trace['source_timing'], 'pyav-relative-pts-v1')
            self.assertEqual([f['source_seconds'] for f in trace['frames']], [0., .08, .48])
            for f in trace['frames']: self.assertEqual(f['seconds'], f['frame_index']/trace['fps_metadata'])
            self.assertEqual(coverage, bundle['receipt']['media_coverage'])
            validate(coverage, digest(source), 6, trace['state'])
