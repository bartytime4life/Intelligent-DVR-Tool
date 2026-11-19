"""Owner-local qualification metadata; no media or identifying host paths exported."""
import hashlib, importlib.metadata, json, os, platform, socket, subprocess, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent; ASSETS=HERE.parents[1]; REPO=HERE/'source'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
checks=[]
for family in (socket.AF_INET,socket.AF_INET6):
 try:
  sock=socket.socket(family,socket.SOCK_STREAM);sock.close();checks.append(dict(family=int(family),denied=False))
 except OSError as e:checks.append(dict(family=int(family),denied=True,errno=e.errno))
assert all(r['denied'] and r['errno']==1 for r in checks)
packages={name:importlib.metadata.version(name) for name in ('onnxruntime-gpu','numpy','opencv-python-headless','onnx','nvidia-cuda-runtime','nvidia-cublas','nvidia-cudnn-cu13')}
import sqlite3
sys.path.append(str(ASSETS/'qa-local/public-pilot-20261028/media-env/lib/python3.12/site-packages'))
import av
result=dict(interpreter_sha256=digest(Path(sys.executable).resolve()),pyav=av.__version__,ffmpeg_libraries=av.library_versions,python=platform.python_version(),sqlite=sqlite3.sqlite_version,packages=packages,
 kernel=platform.release(),system=platform.system(),
 gpu=subprocess.run(['nvidia-smi','--query-gpu=name,driver_version,memory.total','--format=csv,noheader,nounits'],check=True,capture_output=True,text=True).stdout.strip(),
 filesystem=subprocess.run(['findmnt','-T',str(HERE),'-n','-o','FSTYPE,SOURCE'],check=True,capture_output=True,text=True).stdout.strip(),
 process_environment={k:os.environ.get(k) for k in ('OPENCV_FFMPEG_THREADS','OPENBLAS_NUM_THREADS','MALLOC_ARENA_MAX')},
 guard=dict(sha256=digest(ASSETS/'qa-local/pr14-host-20261028T2029Z/offline_guard.py'),checks=checks,passed=True))
import cv2
selection=[]
for kind,name in [('vehicle','meva-school-G339.avi'),('person','person-entry-10s.avi')]:
 p=ASSETS/'qa-local/public-pilot-20261028/incoming'/name
 t=ASSETS/f'qa-local/gpu-backend-20261028/runs/{kind}-opencv-cpu-trace.json'
 rows=json.loads(t.read_text())['frames'];cap=cv2.VideoCapture(str(p))
 selection.append(dict(kind=kind,sha256=digest(p),bytes=p.stat().st_size,frame_indices=[r['frame_index'] for r in rows],frame_selector_sha256=digest(t),width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),fps=cap.get(cv2.CAP_PROP_FPS),frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))))
 cap.release()
result['parity_inputs']=selection
(HERE/'environment.json').write_text(json.dumps(result,indent=2)+'\n')
print('Runtime metadata and IPv4/IPv6 denial verified; local clip hashes captured.')
