"""Test-only controlled RTSP server; production configuration never allows loopback cameras."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_analysis_fixture import build
from local_feeds_fixture import SyntheticRtsp, port, sources
from edge.local_service import Jobs, LocalServer, load_catalog
from edge.lan_recorder import Recorder, DEFAULTS

if __name__ == '__main__':
    import tempfile
    with tempfile.TemporaryDirectory(prefix='dvr-recorder-browser-') as temporary:
        root = build(temporary); fixture = SyntheticRtsp()
        jobs = Jobs(root / 'recordings', load_catalog(root / 'config.json'))
        recorder = Recorder({**DEFAULTS, 'source':'video', 'segment_seconds':5},
            sources(fixture.server_address[1]), jobs, root / 'store')
        try:
            with LocalServer(port(4186), jobs, Path('dist/client'), recorder=recorder) as server:
                print('Synthetic LAN recorder browser fixture ready', flush=True)
                server.serve_forever()
        finally:
            recorder.close(); jobs.close(); fixture.close()
