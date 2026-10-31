"""Analyze an explicitly supplied local recording with an owner-supplied ONNX model.

Default: YOLOv8-style raw output [1, 4+C, N], 640px square letterbox input.
An explicit hash-bound OpenCV Zoo YOLOX profile is also supported. No model download,
camera probing, cloud calls, face identification or automatic response.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics
import time
import platform
from contextlib import ExitStack
from .rules import Rule, RuleEngine
from .evaluation import (TRACE_SCHEMA, MAX_FRAMES, MAX_DETECTIONS, canonical_hash,
                         local_file)
from .model_profiles import (DEFAULT_PROFILE, YOLOX_PROFILE, PROFILES, prepare,
                             validate_binding, yolox_to_yolov8)
from .resources import load_policy, analyzer_limits
from .inference import BACKENDS, create_backend


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()


def decode(raw, labels, frame_shape, scale, padding, cv2, np, profile=DEFAULT_PROFILE):
    if profile == YOLOX_PROFILE:
        raw = yolox_to_yolov8(raw, labels, np)
    elif profile != DEFAULT_PROFILE:
        raise ValueError('Unknown inference profile')
    if raw.ndim != 3 or raw.shape[0] != 1 or raw.shape[1] != 4+len(labels):
        raise ValueError('Unsupported ONNX output: expected [1,4+number_of_labels,N]')
    if raw.shape[2] > 100000 or not np.isfinite(raw).all():
        raise ValueError('Invalid or oversized model output')
    rows = raw[0].T
    ids = rows[:,4:].argmax(axis=1)
    scores = rows[np.arange(len(rows)), 4+ids]
    if (rows[:,4:] < 0).any() or (rows[:,4:] > 1).any():
        raise ValueError('Expected post-sigmoid class scores in [0,1]')
    height, width = frame_shape[:2]
    boxes, values, classes = [], [], []
    for row, cls, score in zip(rows, ids, scores):
        if score < .1:
            continue
        cx, cy, bw, bh = map(float, row[:4])
        x = max(0., min(float(width), (cx-bw/2-padding[0])/scale))
        y = max(0., min(float(height), (cy-bh/2-padding[1])/scale))
        right = max(0., min(float(width), (cx+bw/2-padding[0])/scale))
        bottom = max(0., min(float(height), (cy+bh/2-padding[1])/scale))
        if right <= x or bottom <= y:
            continue
        boxes.append([x,y,right-x,bottom-y]);values.append(float(score));classes.append(int(cls))
    result = []
    # Per-class NMS avoids one class suppressing another.
    for cls in sorted(set(classes)):
        indices = [i for i,c in enumerate(classes) if c == cls]
        keep = cv2.dnn.NMSBoxes([boxes[i] for i in indices], [values[i] for i in indices], .1, .45)
        for k in np.asarray(keep).reshape(-1):
            i=indices[int(k)];x,y,w,h=boxes[i]
            result.append({'label':labels[cls], 'score':values[i], 'box':[x/width,y/height,w/width,h/height]})
    return result


def main(argv=None, progress=None, local_capture=False):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',type=Path,required=True)
    parser.add_argument('--model',type=Path,required=True)
    parser.add_argument('--labels',type=Path,required=True,help='JSON array matching ONNX class order')
    parser.add_argument('--profile',choices=PROFILES,default=DEFAULT_PROFILE)
    parser.add_argument('--backend',choices=BACKENDS,default='opencv-cpu',
                        help='Explicit execution backend; CUDA requires the pinned YOLOX profile and separate runtime, with no fallback')
    parser.add_argument('--rules',type=Path,required=True,help='JSON array of edge Rule objects; see example')
    parser.add_argument('--output',type=Path,required=True,help='New receipt path (will not overwrite)')
    parser.add_argument('--trace-output',type=Path,
                        help='Optional new frame-level evaluation trace; metadata only')
    parser.add_argument('--review-output',type=Path,
                        help='Optional new recognition review bundle; metadata only, open in Recognition')
    parser.add_argument('--threads',type=int,help='OpenCV CPU threads, 1–8; default 1 or policy cap')
    parser.add_argument('--resource-policy',type=Path,help='Explicit local resource policy exported from System')
    parser.add_argument('--camera',default='offline-camera')
    parser.add_argument('--stride',type=int,default=5)
    parser.add_argument('--max-frames',type=int,help='Decoded-frame ceiling; default 6000 or policy cap')
    args=parser.parse_args(argv)
    report = progress or (lambda **fields: None)
    report(phase='validating', frames_read=0, frames_analyzed=0)
    if args.backend == 'onnxruntime-cuda' and args.profile != YOLOX_PROFILE:
        parser.error('CUDA backend requires --profile '+YOLOX_PROFILE)
    policy_hash = None
    try:
        policy = None
        if args.resource_policy is not None:
            policy, policy_hash = load_policy(args.resource_policy)
        limits = analyzer_limits(policy, args.threads, args.max_frames)
        args.threads, args.max_frames = limits['threads'], limits['max_frames']
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    if not 1 <= args.stride <= 120 or not 1 <= args.max_frames <= 100000:
        parser.error('stride must be 1–120 and max-frames 1–100000')
    if not 1 <= args.threads <= 8:
        parser.error('threads must be 1–8')
    for path in [args.video,args.model,args.labels,args.rules]:
        try:
            local_file(path)
        except ValueError as error:
            parser.error(str(error))
    outputs = [p for p in (args.output, args.trace_output, args.review_output) if p is not None]
    if len({p.resolve() for p in outputs}) != len(outputs):
        parser.error('Receipt, trace and review require distinct output paths')
    if any(p.exists() or p.is_symlink() for p in outputs):
        parser.error('Output must be a new file')
    retain_frames = args.trace_output is not None or args.review_output is not None
    if retain_frames and math.ceil(args.max_frames/args.stride) > MAX_FRAMES:
        parser.error('Trace mode permits up to 10,000 sampled frames; reduce max-frames or increase stride')
    input_hashes = {p: digest(p) for p in (args.video, args.model, args.labels, args.rules)} if args.review_output else {}
    labels=json.loads(args.labels.read_text())
    model_hash=digest(args.model)
    try:
        validate_binding(args.profile,model_hash,labels)
    except ValueError as error:
        parser.error(str(error))
    config=json.loads(args.rules.read_text())
    if not isinstance(config,list) or not 1 <= len(config) <= 100:
        parser.error('Use 1–100 explicit rules')
    rules=[Rule(**r) for r in config]
    if any(r.label not in labels for r in rules):
        parser.error('Every rule label must occur in the model labels file')
    try:
        import cv2
        import numpy as np
    except ImportError:
        parser.error('Install the optional edge requirements first; see edge/README.md')
    source_hash=digest(args.video)
    run_id=hashlib.sha256((source_hash+model_hash).encode()).hexdigest()
    engine=RuleEngine(rules,args.camera,run_id)
    if local_capture:
        # Service worker: FFmpeg only, and decoder threads under the same cap as
        # inference so the summed CPU-time limit holds (older builds lack the property).
        params=[cv2.CAP_PROP_N_THREADS,args.threads] if hasattr(cv2,'CAP_PROP_N_THREADS') else None
        capture=cv2.VideoCapture(str(args.video), cv2.CAP_FFMPEG, params) if params else cv2.VideoCapture(str(args.video), cv2.CAP_FFMPEG)
    else:
        capture=cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        parser.error('Video could not be opened')
    fps=capture.get(cv2.CAP_PROP_FPS)
    if not math.isfinite(fps) or fps <= 0:
        capture.release();parser.error('A valid frame rate is required for recording timestamps')
    if any(args.stride/fps > r.max_gap for r in rules):
        capture.release();parser.error('Sampling interval exceeds a rule max_gap; reduce stride')
    cv2.setNumThreads(args.threads)
    try:
        backend=create_backend(args.backend,args.model,args.profile,cv2,np,args.threads,model_sha256=model_hash)
    except Exception:
        capture.release()
        raise
    runtime={'python':platform.python_version(),'opencv':cv2.__version__,
             'numpy':np.__version__,'machine':platform.machine(),**backend.runtime}
    frames=0;processed=0;events=[];latencies=[];partial=False
    trace_frames=[];detection_count=0
    report(phase='analyzing', frames_read=0, frames_analyzed=0)
    try:
        while frames < args.max_frames:
            ok,frame=capture.read()
            if not ok:
                break
            index=frames;frames+=1
            if index % args.stride:
                continue
            if frame.shape[0]*frame.shape[1] > 3840*2160:
                raise ValueError('Video exceeds the 4K pixel bound')
            blob,scale,padding=prepare(frame,args.profile,cv2,np)
            began=time.perf_counter()
            raw=backend.forward(blob)
            detections=decode(raw,labels,frame.shape,scale,padding,cv2,np,args.profile)
            elapsed=(time.perf_counter()-began)*1000
            latencies.append(elapsed)
            processed+=1;events.extend(engine.update(index/fps,detections))
            report(phase='analyzing', frames_read=frames, frames_analyzed=processed)
            if retain_frames:
                detection_count += len(detections)
                if detection_count > MAX_DETECTIONS:
                    raise ValueError('Evaluation trace exceeds 100,000 detections; split the recording')
                trace_frames.append({'frame_index':index,'seconds':index/fps,
                                     'width':int(frame.shape[1]),'height':int(frame.shape[0]),
                                     'detections':detections,'inference_decode_ms':elapsed})
            if len(events) >= 1000:
                events=events[:1000];partial=True;break
        else:
            partial=True
    finally:
        capture.release()
        backend.close()
    if not processed:
        raise ValueError('No frames were decoded; no receipt was written')
    report(phase='verifying', frames_read=frames, frames_analyzed=processed)
    if input_hashes and any(digest(p) != expected for p, expected in input_hashes.items()):
        raise ValueError('An input changed during analysis; no review result was written')
    ordered=sorted(latencies)
    receipt={'schema':'intelligent-dvr.receipt.v1','mode':'offline-model',
             'state':'partial' if partial else 'completed','events':events,
             'model_sha256':model_hash,'source_sha256':source_hash,'camera':args.camera,
             'inference_profile':args.profile,'labels_sha256':digest(args.labels),
             'rules_sha256':canonical_hash(config),'rules_file_sha256':digest(args.rules),
             'frames_read':frames,'frames_analyzed':processed,'fps_metadata':fps,'stride':args.stride,
             'runtime':runtime,
             'timing':{'scope':'local inference and postprocessing only; not end-to-end camera latency',
                       'p50_ms':statistics.median(ordered),'p95_ms':ordered[math.ceil(.95*len(ordered))-1]},
             'limitations':['No identity tracking: dwell is continuous class presence, not the same object.',
                            'Frame timing assumes a constant-frame-rate recording; verify variable-rate sources.',
                            'No camera compatibility or production detection quality has been qualified.']}
    documents = [(args.output, receipt)]
    if policy_hash is not None:
        receipt['resource_policy'] = {'sha256': policy_hash, 'opencv_threads': args.threads,
                                      'max_frames': args.max_frames,
                                      'scope': 'Analyzer thread and decoded-frame limits only; no OS/GPU quota or worker pool.'}
    if retain_frames:
        from .model_profiles import ASSETS
        trace = {'schema':TRACE_SCHEMA,'origin':'offline-analyzer','state':receipt['state'],
                 'source_sha256':source_hash,'model_sha256':model_hash,
                 'labels_sha256':digest(args.labels),'inference_profile':args.profile,
                 'rules_sha256':canonical_hash(config),'rules_file_sha256':digest(args.rules),
                 'rule_engine_sha256':digest(ASSETS/'rules.py'),
                 'rules':config,'camera':args.camera,'run_id':run_id,'frames_read':frames,
                 'fps_metadata':fps,'stride':args.stride,'frames':trace_frames,'events':events,
                 'runtime':dict(runtime),
                 'timing_scope':receipt['timing']['scope'],'human_review_required':True}
        if policy_hash is not None:
            trace['runtime']['resource_policy_sha256'] = policy_hash
        if args.trace_output is not None:
            documents.append((args.trace_output, trace))
        if args.review_output is not None:
            documents.append((args.review_output, {
                'schema':'intelligent-dvr.recognition-review.v1',
                'receipt':receipt, 'trace':trace,
                'limitations':[
                    'Detected classes and rule-based presence only; no identity or learned scene understanding.',
                    'Counts are per sampled frame, not unique people or objects.',
                    'Metadata is unsigned; source hash matching does not authenticate detections.',
                ],
            }))
    # Reserve every destination exclusively before writing either document.
    # On a write failure, remove only files created by this invocation.
    created=[]
    try:
        with ExitStack() as stack:
            streams=[]
            for path,document in documents:
                streams.append((stack.enter_context(path.open('x',encoding='utf-8')),document))
                created.append(path)
            for stream,document in streams:
                json.dump(document,stream,indent=2,allow_nan=False)
                stream.write('\n')
                if document.get('schema') in (TRACE_SCHEMA, 'intelligent-dvr.recognition-review.v1') and stream.tell() > 32*1024**2:
                    raise ValueError('Trace/review exceeds the 32 MiB JSON bound; split the recording')
    except BaseException:
        for path in created:
            path.unlink()
        raise
    print(f'Wrote {len(events)} observations; state={receipt["state"]}; human review required.')
    report(phase='completed', frames_read=frames, frames_analyzed=processed)


if __name__=='__main__':
    main()
