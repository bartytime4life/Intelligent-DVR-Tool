"""Actual spawned-CUDA 100-frame agreement with existing CPU traces."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import time

HERE=Path(__file__).resolve().parent;ASSETS=HERE.parents[1];REPO=HERE/'source'
sys.path.insert(0,str(REPO))
from edge.scheduler import CameraScheduler,Sample
from edge.supervision import ProcessWorkers
from edge.journal import OutcomeJournal
from edge.evaluation import iou
from native_factory import NativeFactory


def run():
    import cv2
    cv2.setNumThreads(4);examples=[];bindings=[]
    for kind,name in [('vehicle','meva-school-G339.avi'),('person','person-entry-10s.avi')]:
        trace_path=ASSETS/f'qa-local/gpu-backend-20261028/runs/{kind}-opencv-cpu-trace.json'
        reference=json.loads(trace_path.read_text());rows={r['frame_index']:r for r in reference['frames']}
        bindings.append(dict(name=kind,trace_sha256=hashlib.sha256(trace_path.read_bytes()).hexdigest()))
        cap=cv2.VideoCapture(str(ASSETS/'qa-local/public-pilot-20261028/incoming'/name));index=0
        try:
            while True:
                good,frame=cap.read()
                if not good:break
                if index in rows:
                    payload=struct.pack('<III',frame.shape[1],frame.shape[0],frame.strides[0])+frame.tobytes()
                    examples.append((payload,rows[index]['detections']))
                index+=1
        finally:cap.release()
    assert len(examples)==100
    import numpy as np
    from edge.inference import create_backend
    from edge.model_profiles import YOLOX_PROFILE
    current_cpu=NativeFactory(str(ASSETS/'qa-local/pr14-host-20261028T2029Z/models/yolox-s.onnx'),str(REPO/'edge/labels/coco80.json'))
    # Rebuild the reference with CURRENT CPU code. Old traces select frames only.
    from native_factory import NativeProcessor
    backend=create_backend('opencv-cpu',Path(current_cpu.model),YOLOX_PROFILE,cv2,np,4)
    processor=NativeProcessor(backend,json.loads(Path(current_cpu.labels).read_text()),1,'none','')
    references=[]
    try:
        for index,(payload,_) in enumerate(examples):
            references.append(processor(Sample(f'cpu-{index}',0,time.monotonic(),payload))['detections'])
    finally:processor.close()
    (HERE/'current-cpu-reference.json').write_text(json.dumps(references,indent=2)+'\n')
    examples=[(payload,references[i]) for i,(payload,_) in enumerate(examples)]
    names=[f'fixed-{i}' for i in range(100)]
    scheduler=CameraScheduler(names,workers=4,max_sample_bytes=32*1024**2,
                              max_buffer_bytes=64*1024**2,max_age_seconds=30)
    factory=NativeFactory(str(ASSETS/'qa-local/pr14-host-20261028T2029Z/models/yolox-s.onnx'),
                          str(REPO/'edge/labels/coco80.json'))
    journal=OutcomeJournal(HERE/'parity-journal')
    workers=ProcessWorkers(scheduler,factory,startup_timeout=30,task_timeout=5,journal=journal)
    outputs=[];submitted=0;slots=set();generations=set();deadline=time.monotonic()+60
    try:
        while len(outputs)<100 and time.monotonic()<deadline:
            # Admit bounded batches; no fixture payload exceeds 64 MiB retention.
            if workers.snapshot()['state']=='running':
                while submitted<100 and scheduler.snapshot()['buffered_payload_bytes']+len(examples[submitted][0])<=64*1024**2:
                    payload,_=examples[submitted]
                    scheduler.submit(Sample(names[submitted],0,time.monotonic(),payload));submitted+=1
            for outcome in workers.step():
                if outcome.error:raise outcome.error
                slots.add(outcome.processor);generations.add(outcome.generation)
                assert outcome.result['generation']==outcome.generation
                outputs.append((int(outcome.work.sample.camera.split('-')[1]),outcome.result['detections']))
            if workers.snapshot()['state']=='failed':raise RuntimeError('Supervised CUDA startup/execution failed')
            time.sleep(.0005)
        assert len(outputs)==100
        assert len({index for index,_ in outputs})==100 and generations=={1} and slots<=set(range(4))
        minimum=1.;delta=0.
        for index,detections in outputs:
            reference=examples[index][1];assert len(reference)==len(detections)
            remaining=list(detections)
            for a in reference:
                same=[b for b in remaining if b['label']==a['label']];assert same
                b=max(same,key=lambda b:iou(a['box'],b['box']));remaining.remove(b)
                minimum=min(minimum,iou(a['box'],b['box']));delta=max(delta,abs(a['score']-b['score']))
        assert minimum>=.99 and delta<=.001
    finally:workers.close(timeout=1)
    result=dict(frames=100,passed=True,minimum_iou=minimum,maximum_score_delta=delta,
                criteria=dict(minimum_iou=.99,maximum_score_delta=.001,matching_counts_and_labels=True),
                source_bindings=bindings,workers=workers.snapshot(),scheduler=scheduler.snapshot())
    assert not result['workers']['child_alive'] and result['workers']['failed']==0
    result['journal']=journal.snapshot()
    assert result['journal']['states']=={'succeeded':100} and result['journal']['unacknowledged']==100
    journal.close()
    (HERE/'process-parity.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Spawned-process CUDA matched CPU references on all 100 fixed frames; child was reaped.')


if __name__=='__main__':run()
