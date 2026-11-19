"""Private qualified-frame processor and optional test-only fault injection."""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import struct
import time


@dataclass
class NativeFactory:
    model: str
    labels: str
    fault_mode: str = 'none'
    fault_log: str = ''

    def __call__(self, slot, generation):
        import cv2
        import numpy as np
        from edge.inference import create_backend
        from edge.model_profiles import YOLOX_PROFILE, validate_binding
        labels=json.loads(Path(self.labels).read_text())
        validate_binding(YOLOX_PROFILE,hashlib.sha256(Path(self.model).read_bytes()).hexdigest(),labels)
        cv2.setNumThreads(4)
        backend=create_backend('onnxruntime-cuda',Path(self.model),YOLOX_PROFILE,cv2,np,4)
        return NativeProcessor(backend,labels,generation,self.fault_mode,self.fault_log)


class NativeProcessor:
    def __init__(self,backend,labels,generation,fault_mode,fault_log):
        self.backend,self.labels,self.generation=backend,labels,generation
        self.fault_mode,self.fault_log=fault_mode,fault_log
        self.runtime=backend.runtime

    def __call__(self,sample):
        import cv2
        import numpy as np
        from edge.analyze import decode
        from edge.model_profiles import YOLOX_PROFILE,prepare
        fault=None
        if self.fault_mode=='combined':
            if self.generation==1 and sample.camera=='camera-001' and sample.sequence>=20:fault='software-stall'
            if self.generation==2 and sample.camera=='camera-002' and sample.sequence>=80:fault='abrupt-exit'
        if fault:
            # Test telemetry only: no event, footage or application-state writes.
            with Path(self.fault_log).open('a') as f:
                f.write(json.dumps(dict(fault=fault,generation=self.generation,camera=sample.camera,
                                       sequence=sample.sequence,pid=os.getpid(),at=time.monotonic()))+'\n')
                f.flush();os.fsync(f.fileno())
            if fault=='software-stall':time.sleep(60)
            else:os._exit(86)
        width,height,stride=struct.unpack('<III',sample.payload[:12])
        if not(1<=width<=3840 and 1<=height<=2160 and width*3<=stride<=width*3+256
               and len(sample.payload)==12+stride*height):raise ValueError('Invalid frame payload')
        frame=np.ndarray((height,width,3),dtype=np.uint8,buffer=sample.payload[12:],strides=(stride,3,1))
        began=time.monotonic();blob,scale,padding=prepare(frame,YOLOX_PROFILE,cv2,np)
        detections=decode(self.backend.forward(blob),self.labels,frame.shape,scale,padding,cv2,np,YOLOX_PROFILE)
        ended=time.monotonic()
        return dict(milliseconds=(ended-began)*1000,completion_age_ms=(ended-sample.captured_at)*1000,
                    detections=detections,generation=self.generation)

    def close(self):self.backend.close()
