"""Real local service + generated CPU-model footage, with accelerated quiet time.

The clock acceleration is confined to this fixture; production waits real seconds.
"""
import os
from pathlib import Path
import shutil
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_analysis_fixture import build
from edge.backup_library import BackupLibrary
from edge.dvr_setup import CameraSetup
from edge.local_feeds import Feeds
from edge.local_service import Jobs, LocalServer, load_catalog

ROOT = Path(__file__).resolve().parents[1]
root = ROOT / 'qa-local/library-native'
if root.exists(): shutil.rmtree(root)
build(root / 'fixture')
source = root / 'oem'; source.mkdir()
shutil.copyfile(root / 'fixture/recordings/synthetic.webm', source / 'entrance.webm')
os.utime(source / 'entrance.webm', (time.time() - 120, time.time() - 120))
feeds_path = root / 'feeds.json'; feeds_path.write_text('{"sources": []}')
jobs = Jobs(root / 'fixture/recordings', load_catalog(root / 'fixture/config.json'))
feeds = Feeds({})
library = BackupLibrary(jobs, root / 'settings', clock=lambda: time.monotonic() * 31)
setup = CameraSetup(feeds, feeds_path)
try:
    with LocalServer(4199, jobs, ROOT / 'dist/client', feeds, library=library, camera_setup=setup,
                     recorder_path=root / 'guided-recorder.json') as server:
        print(server.origin, flush=True)
        server.serve_forever()
finally:
    library.close()
    if server.recorder: server.recorder.close()
    jobs.close(); feeds.close()
