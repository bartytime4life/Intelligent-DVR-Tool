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
from .rules import Rule, RuleEngine
from .model_profiles import (DEFAULT_PROFILE, YOLOX_PROFILE, PROFILES, prepare,
                             validate_binding, yolox_to_yolov8)


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


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video',type=Path,required=True)
    parser.add_argument('--model',type=Path,required=True)
    parser.add_argument('--labels',type=Path,required=True,help='JSON array matching ONNX class order')
    parser.add_argument('--profile',choices=PROFILES,default=DEFAULT_PROFILE)
    parser.add_argument('--rules',type=Path,required=True,help='JSON array of edge Rule objects; see example')
    parser.add_argument('--output',type=Path,required=True,help='New receipt path (will not overwrite)')
    parser.add_argument('--camera',default='offline-camera')
    parser.add_argument('--stride',type=int,default=5)
    parser.add_argument('--max-frames',type=int,default=6000)
    args=parser.parse_args(argv)
    if not 1 <= args.stride <= 120 or not 1 <= args.max_frames <= 100000:
        parser.error('stride must be 1–120 and max-frames 1–100000')
    for path in [args.video,args.model,args.labels,args.rules]:
        if path.is_symlink() or not path.is_file():
            parser.error('Use existing local regular input files, not streams or symlinks')
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output must be a new file')
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
    capture=cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        parser.error('Video could not be opened')
    fps=capture.get(cv2.CAP_PROP_FPS)
    if not math.isfinite(fps) or fps <= 0:
        capture.release();parser.error('A valid frame rate is required for recording timestamps')
    if any(args.stride/fps > r.max_gap for r in rules):
        capture.release();parser.error('Sampling interval exceeds a rule max_gap; reduce stride')
    net=cv2.dnn.readNetFromONNX(str(args.model))
    frames=0;processed=0;events=[];latencies=[];partial=False
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
            net.setInput(blob)
            raw=net.forward()
            detections=decode(raw,labels,frame.shape,scale,padding,cv2,np,args.profile)
            latencies.append((time.perf_counter()-began)*1000)
            processed+=1;events.extend(engine.update(index/fps,detections))
            if len(events) >= 1000:
                events=events[:1000];partial=True;break
        else:
            partial=True
    finally:
        capture.release()
    if not processed:
        raise ValueError('No frames were decoded; no receipt was written')
    ordered=sorted(latencies)
    receipt={'schema':'intelligent-dvr.receipt.v1','mode':'offline-model',
             'state':'partial' if partial else 'completed','events':events,
             'model_sha256':model_hash,'source_sha256':source_hash,'camera':args.camera,
             'inference_profile':args.profile,'labels_sha256':digest(args.labels),
             'frames_read':frames,'frames_analyzed':processed,'fps_metadata':fps,'stride':args.stride,
             'timing':{'scope':'local inference and postprocessing only; not end-to-end camera latency',
                       'p50_ms':statistics.median(ordered),'p95_ms':ordered[math.ceil(.95*len(ordered))-1]},
             'limitations':['No identity tracking: dwell is continuous class presence, not the same object.',
                            'Frame timing assumes a constant-frame-rate recording; verify variable-rate sources.',
                            'No camera compatibility or production detection quality has been qualified.']}
    with args.output.open('x',encoding='utf-8') as stream:
        json.dump(receipt,stream,indent=2,allow_nan=False)
    print(f'Wrote {len(events)} observations; state={receipt["state"]}; human review required.')


if __name__=='__main__':
    main()
