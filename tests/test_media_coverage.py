"""Controlled decoder faults and generated media; no camera or accuracy claim."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from edge.media_coverage import CoverageError, MESSAGES, unchecked, validate, verify
from edge.evaluation import digest, evaluate
from evaluation_fixtures import make_fixture, write_json

AVAILABLE = all(importlib.util.find_spec(x) for x in ('av','cv2','numpy','onnx'))


def coverage(source_hash, frames):
    return {**unchecked(source_hash, frames, 'source-end'), 'status':'inventory-matched',
            'validated_frames':frames, 'declared_frames':frames, 'anchor':'frames',
            'validator_version':'synthetic-fixture'}


class CoverageContractTest(unittest.TestCase):
    def test_state_source_counts_and_inventory_must_agree(self):
        valid=coverage('a'*64,30)
        self.assertEqual(validate(valid,'a'*64,30,'completed'),valid)
        changes=[{'source_sha256':'b'*64},{'analysis_frames':7},{'validated_frames':7},
                 {'declared_frames':29},{'anchor':'none'},{'status':'unverified'},
                 {'termination':'event-limit'},{'analysis_frames':True},
                 {'declared_duration_seconds':3,'decoded_duration_seconds':2,'duration_tolerance_seconds':.001,'anchor':'frames+duration'}]
        for change in changes:
            with self.subTest(change=change),self.assertRaises(ValueError):
                validate({**valid,**change},'a'*64,30,'completed')
        for why in ('frame-limit','event-limit'):
            c=unchecked('a'*64,30,why);validate(c,'a'*64,30,'partial')
            with self.assertRaises(ValueError):validate(c,'a'*64,30,'completed')

    def test_evaluator_checks_new_coverage_but_preserves_explicitly_legacy_inputs(self):
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw);manifest,trace,_=make_fixture(root)
            self.assertIsNone(evaluate(root/'manifest.json')['clips'][0]['media_coverage'])
            trace['media_coverage']=coverage(trace['source_sha256'],4)
            write_json(root/'trace.json',trace)
            self.assertEqual(evaluate(root/'manifest.json')['clips'][0]['media_coverage']['validated_frames'],4)
            trace['media_coverage']['declared_frames']=5
            write_json(root/'trace.json',trace)
            with self.assertRaises(ValueError):evaluate(root/'manifest.json')

    def test_worker_writes_only_allowlisted_failure_code_and_service_cleans_it(self):
        from edge import analysis_worker
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw);(root/'args.json').write_text('[]')
            with patch.dict(os.environ),patch.object(analysis_worker,'constrain',return_value=None), \
                    patch('edge.analyze.main',side_effect=CoverageError('MEDIA_INCOMPLETE')):
                os.environ.pop('DVR_ANALYSIS_PARENT_PIPE',None)
                with self.assertRaises(CoverageError):analysis_worker.run(root)
            self.assertEqual(json.loads((root/'failure.json').read_text()),{'code':'MEDIA_INCOMPLETE'})
            self.assertFalse((root/'failure.tmp').exists())


@unittest.skipUnless(AVAILABLE,'Install optional edge native test dependencies')
class NativeCoverageTest(unittest.TestCase):
    def setUp(self):
        import cv2
        import numpy as np
        from local_analysis_fixture import build
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);build(self.root)
        self.avi=self.root/'recordings'/'source.avi'
        writer=cv2.VideoWriter(str(self.avi),cv2.VideoWriter_fourcc(*'MJPG'),10,(320,240))
        self.assertTrue(writer.isOpened())
        for i in range(30):
            image=np.full((240,320,3),40+i,np.uint8);image[:,160:]=170
            writer.write(image)
        writer.release()

    def args(self, source=None):
        return ['--video',str(source or self.avi),'--model',str(self.root/'fixture.onnx'),
                '--labels',str(self.root/'labels.json'),'--rules',str(self.root/'rules.json'),
                '--max-frames','31','--output',str(self.root/'receipt.json'),
                '--trace-output',str(self.root/'trace.json'),'--review-output',str(self.root/'review.json')]

    def analyze(self,args):
        from edge.analyze import main
        with contextlib.redirect_stdout(io.StringIO()):main(args)

    def assert_no_result(self):
        for name in ('receipt.json','trace.json','review.json'):
            self.assertFalse((self.root/name).exists())

    def test_seven_of_thirty_no_longer_publishes_completed_or_sharpened_result(self):
        import cv2
        original=cv2.VideoCapture
        class EarlyStop:
            def __init__(self,*args):self.cap=original(*args);self.reads=0
            def isOpened(self):return self.cap.isOpened()
            def get(self,key):return self.cap.get(key)
            def release(self):self.cap.release()
            def read(self):
                if self.reads==7:return False,None
                self.reads+=1;return self.cap.read()
        before=self.avi.read_bytes()
        with patch.object(cv2,'VideoCapture',EarlyStop),self.assertRaises(CoverageError) as caught:
            self.analyze(self.args()+['--compare-enhancement','mild-unsharp-v1'])
        self.assertEqual(caught.exception.code,'MEDIA_INCOMPLETE')
        self.assert_no_result();self.assertEqual(self.avi.read_bytes(),before)

    def test_real_avi_webm_and_mp4_match_inventory_and_preserve_source(self):
        import av
        import cv2
        import numpy as np
        mp4=self.root/'recordings'/'source.mp4'
        writer=cv2.VideoWriter(str(mp4),cv2.VideoWriter_fourcc(*'mp4v'),10,(320,240))
        self.assertTrue(writer.isOpened())
        for _ in range(30):writer.write(np.full((240,320,3),80,np.uint8))
        writer.release()
        bframes=self.root/'recordings'/'bframes.mp4'
        with av.open(str(bframes),'w') as c:
            stream=c.add_stream('mpeg4',rate=10);stream.width=320;stream.height=240;stream.pix_fmt='yuv420p'
            stream.codec_context.max_b_frames=2
            for i in range(30):
                frame=av.VideoFrame.from_ndarray(np.full((240,320,3),40+i,np.uint8),format='bgr24')
                for packet in stream.encode(frame):c.mux(packet)
            for packet in stream.encode():c.mux(packet)
        with av.open(str(bframes)) as c:
            self.assertGreater(sum(f.pict_type==3 for f in c.decode(video=0)),0)
        for source in (self.avi,self.root/'recordings'/'synthetic.webm',mp4,bframes):
            before=digest(source);c=verify(source,before,30)
            self.assertEqual(c['status'],'inventory-matched');self.assertEqual(c['validated_frames'],30)
            validate(c,before,30,'completed');self.assertEqual(digest(source),before)
        self.analyze(self.args())
        bundle=json.loads((self.root/'review.json').read_text())
        self.assertEqual(bundle['receipt']['state'],'completed')
        self.assertEqual(bundle['receipt']['media_coverage'],bundle['trace']['media_coverage'])
        self.assertEqual(bundle['receipt']['media_coverage']['analysis_frames'],30)

    def test_actual_truncation_and_last_frame_loss_do_not_publish_success(self):
        import av
        sources=(self.avi,self.root/'recordings'/'synthetic.webm')
        for source in sources:
            with self.subTest(source=source.suffix):
                damaged=self.root/('truncated'+source.suffix)
                raw=source.read_bytes();damaged.write_bytes(raw[:len(raw)//2])
                with self.assertRaises((CoverageError,ValueError,SystemExit)):
                    self.analyze(self.args(damaged))
                self.assert_no_result()
        with av.open(str(self.avi)) as c:
            packets=[(p.pos,p.size) for p in c.demux(video=0) if p.size and p.pos is not None]
            offsets=[pos for pos,size in packets]
        last=self.root/'last-frame-missing.avi'
        last.write_bytes(self.avi.read_bytes()[:offsets[-1]-8])
        with self.assertRaises(CoverageError):self.analyze(self.args(last))
        self.assert_no_result()
        # Damage a middle JPEG Huffman-table length while leaving the AVI inventory intact.
        payload=bytearray(self.avi.read_bytes());pos,size=packets[15]
        marker=payload.find(b'\xff\xc4',pos,pos+size)
        self.assertGreaterEqual(marker,pos)
        payload[marker+2:marker+4]=b'\xff\xff'
        corrupt=self.root/'corrupt-middle.avi';corrupt.write_bytes(payload)
        with self.assertRaises(CoverageError) as caught:self.analyze(self.args(corrupt))
        self.assertEqual(caught.exception.code,'MEDIA_CORRUPT');self.assert_no_result()

    def no_inventory(self, original):
        """Retain real native decode while suppressing inventory anchors deliberately."""
        class StreamProxy:
            frames=0;duration=None
            def __init__(self,stream):self.stream=stream
            def __getattr__(self,name):return getattr(self.stream,name)
        class Streams:
            def __init__(self,streams):self.video=[StreamProxy(streams.video[0])]
            def __len__(self):return 1
        class ContainerProxy:
            duration=None
            def __init__(self,c):self.c=c;self.streams=Streams(c.streams)
            def __enter__(self):return self
            def __exit__(self,*args):self.c.close()
            def demux(self,stream):return self.c.demux(stream.stream)
        return lambda *args,**kwargs:ContainerProxy(original(*args,**kwargs))

    def test_missing_inventory_is_explicitly_unverified_and_not_a_frame_limit(self):
        import av
        with patch.object(av,'open',self.no_inventory(av.open)):
            self.analyze(self.args())
        bundle=json.loads((self.root/'review.json').read_text());r=bundle['receipt']
        self.assertEqual(r['state'],'partial');self.assertEqual(r['media_coverage']['status'],'unverified')
        self.assertEqual(r['media_coverage']['termination'],'source-end')
        self.assertEqual(r['frames_read'],30)
        validate(r['media_coverage'],r['source_sha256'],30,'partial')

    def test_caps_stay_partial_and_coverage_pass_is_bounded(self):
        count=[]
        with self.assertRaises(CoverageError):verify(self.avi,digest(self.avi),7,progress=count.append)
        self.assertEqual(count,list(range(1,8)))
        args=self.args();args[args.index('--max-frames')+1]='7'
        with patch('edge.analyze.verify_coverage',side_effect=AssertionError('Do not fully decode beyond a deliberate cap')):
            self.analyze(args)
        r=json.loads((self.root/'receipt.json').read_text())
        self.assertEqual(r['state'],'partial');self.assertEqual(r['media_coverage']['termination'],'frame-limit')
        self.assertEqual(r['media_coverage']['validated_frames'],0)

    def test_service_surfaces_known_failure_without_paths_and_allows_retry(self):
        from edge.local_service import Jobs,load_catalog,JobError
        from test_local_service import FakeProcess
        def fail(command,**kwargs):
            directory=Path(command[-1]);(directory/'failure.json').write_text('{"code":"MEDIA_INCOMPLETE"}')
            return FakeProcess(1)
        service=Jobs(self.root/'recordings',load_catalog(self.root/'config.json'),process_factory=fail)
        try:
            choice=service.available()['recordings'][0]['id']
            job=service.start({'recording':choice,'model':'synthetic','rules':'presence'})
            service.thread.join(20);self.assertFalse(service.thread.is_alive())
            result=service.snapshot();self.assertEqual(result['state'],'failed')
            self.assertEqual(result['error'],{'code':'MEDIA_INCOMPLETE','message':MESSAGES['MEDIA_INCOMPLETE']})
            self.assertNotIn(str(self.root),json.dumps(result))
            self.assertEqual(list(Path(service.directory.name).iterdir()),[])
            with self.assertRaises(JobError):service.artifact(job['id'],'result')
            service.process_factory=__import__('subprocess').Popen
            service.start({'recording':choice,'model':'synthetic','rules':'presence'})
            service.thread.join(20);self.assertEqual(service.snapshot()['state'],'completed',service.snapshot())
        finally:service.close()
