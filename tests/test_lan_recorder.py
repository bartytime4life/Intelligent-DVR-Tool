"""Synthetic recording/analysis plumbing and fault injection, never camera acceptance."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from edge.lan_recorder import Recorder, Store, DEFAULTS, validate_config
from edge.local_service import Jobs, JobError, load_catalog
from edge.local_feeds import FeedError, load_sources
from edge.segment_worker import record, validate_video, atomic_json
from local_analysis_fixture import build

SOURCE = {'id': 'dock', 'name': 'Authorized test camera', 'host': '192.168.1.50', 'port': 554,
          'path': '/video', 'username': 'viewer', 'password': 'fixture-private'}


class Process:
    def __init__(self, code=None):
        self.returncode = code; self.stdin = io.BytesIO(); self.killed = False
    def poll(self): return self.returncode
    def kill(self): self.killed = True; self.returncode = -9
    def wait(self, timeout=None): return self.returncode


class GeneratedCapture:
    def __init__(self, clock, fail_at=None):
        import numpy as np
        self.frame = np.full((120, 160, 3), (50, 80, 30), dtype=np.uint8)
        self.clock, self.fail_at, self.count = clock, fail_at, 0
        self.released = False
    def isOpened(self): return True
    def read(self):
        self.clock[0] += .101; self.count += 1
        return (False, None) if self.fail_at == self.count else (True, self.frame.copy())
    def release(self): self.released = True


def synthetic_segment(directory, seconds=5, fail_at=None):
    clock = [0.0]; cap = GeneratedCapture(clock, fail_at)
    record('unused-injected-source', directory, seconds, capture_factory=lambda: cap,
           clock=lambda: clock[0], wall=lambda: 1000 + clock[0])
    return cap


class RecorderTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = build(Path(self.temp.name))
        self.jobs = Jobs(self.root / 'recordings', load_catalog(self.root / 'config.json'))
        self.now = 1010.0; self.free = 10 * 1024**3; self.calls = []; self.recorders = []
        self.config = {**DEFAULTS, 'source': 'dock', 'segment_seconds': 5}
    def tearDown(self):
        for rec in self.recorders:
            if rec.store.fd is not None: rec.close()
        self.jobs.close(); self.temp.cleanup()
    def make(self, **kwargs):
        def spawn(command, **options):
            process = Process(); self.calls.append((command, options, process)); return process
        rec = Recorder(self.config, {'dock': SOURCE}, self.jobs, self.root / 'recordings' / '.lan-recorder',
            clock=lambda: self.now, wall=lambda: self.now, disk_usage=lambda p: SimpleNamespace(free=self.free),
            process_factory=spawn, supervise=False, **kwargs)
        self.recorders.append(rec); return rec
    def start(self, rec):
        rec.start({'model': 'synthetic', 'rules': 'presence'}); rec.tick()
    def complete(self, rec):
        directory = rec.store.path / rec.capture['id']; synthetic_segment(directory)
        self.calls[-1][2].returncode = 0; rec.tick()
    def finish_analysis(self, rec):
        self.jobs.thread.join(timeout=15); self.assertFalse(self.jobs.thread.is_alive())
        rec.tick()

    def test_config_rejects_public_unconfigured_sources_and_unbounded_values(self):
        path = self.root / 'recorder.json'
        for value in ({'source':'unknown'}, {'source':'dock', 'max_segments':101}, {'source':'dock', 'segment_seconds':True},
                      {'source':'dock', 'reserve_mib':0}, {'source':'dock', 'url':'rtsp://internet'}):
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError): validate_config(path, {'dock':SOURCE})
        path.write_text('{"source":"dock"}')
        with self.assertRaises(ValueError): validate_config(path, {'dock':{**SOURCE, 'kind':'public-mjpeg'}})
        for host in ('127.0.0.1', '8.8.8.8', '169.254.169.254', 'camera.example'):
            path.write_text(json.dumps({'sources':[{**SOURCE, 'host':host}]}))
            with self.assertRaises(ValueError): load_sources(path)

    def test_explicit_start_single_owner_credentials_only_on_private_pipe(self):
        rec = self.make(); rec.tick(); rec.status(); self.assertEqual(self.calls, [])
        self.start(rec)
        command, options, process = self.calls[0]
        self.assertNotIn('192.168', str(command)); self.assertNotIn('fixture-private', str(command))
        self.assertEqual(options['stderr'], subprocess.DEVNULL)
        self.assertEqual(options['env']['DVR_SEGMENT_PARENT_PID'], str(os.getpid()))
        self.assertEqual(json.loads(process.stdin.getvalue())['password'], SOURCE['password'])
        self.assertNotIn(SOURCE['password'], json.dumps(rec.status()))
        self.assertNotIn(SOURCE['password'], (rec.store.path / 'state.json').read_text())
        with self.assertRaises(FeedError): self.start(rec)
        with self.assertRaises((OSError, ValueError)): Store(rec.store.path)
        with self.assertRaises(JobError): self.jobs.start({'recording':'x','model':'synthetic','rules':'presence'})
        rec.stop(); self.assertTrue(process.killed); self.assertIsNone(self.jobs.owner)
        self.assertEqual(rec.status()['counters']['dropped'], 1)

    def test_generated_video_to_existing_native_analysis_and_bound_result(self):
        rec = self.make(); self.start(rec); self.complete(rec); self.finish_analysis(rec)
        row = next(r for r in rec.rows if r['state'] == 'completed')
        source, mime = rec.artifact(row['id'], 'source'); result, _ = rec.artifact(row['id'], 'result')
        review = json.loads(result.read_text())
        self.assertEqual(mime, 'video/webm')
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), review['receipt']['source_sha256'])
        self.assertEqual(review['receipt']['camera'], 'dock')
        self.assertEqual(review['receipt']['frames_read'], row['frames'])
        self.assertGreater(review['receipt']['frames_analyzed'], 0)
        self.assertGreaterEqual(row['analysis_lag_seconds'], 0)
        self.assertIsNone(self.jobs.available()['job'])  # No automatic replacement of a human review.
        self.assertTrue(self.jobs.available()['recorder_active'])

    def test_disconnect_backoff_timeout_and_recovery_discard_partial(self):
        rec = self.make(); self.start(rec)
        directory = rec.store.path / rec.capture['id']; (directory / 'capture.webm').write_bytes(b'incomplete')
        self.calls[-1][2].returncode = 1; rec.tick()
        self.assertFalse(directory.exists()); self.assertEqual(rec.state, 'reconnecting')
        before = len(self.calls); rec.tick(); self.assertEqual(len(self.calls), before)
        self.now += 2; rec.tick(); self.assertEqual(len(self.calls), before + 1)
        self.now += 26; rec.tick(); self.assertEqual(rec.error, 'CAPTURE_TIMEOUT')
        self.assertTrue(self.calls[-1][2].killed)
        self.now += 4; rec.tick(); self.complete(rec); self.finish_analysis(rec)
        self.assertEqual(rec.counters['analyzed'], 1); self.assertEqual(rec.counters['dropped'], 2)

    def test_disk_exhaustion_before_and_during_recording_is_visible(self):
        rec = self.make(); self.free = 1; self.start(rec)
        self.assertEqual(self.calls, []); self.assertEqual(rec.state, 'disk_pressure')
        self.free = 10 * 1024**3; rec.tick(); process = self.calls[-1][2]
        self.free = 1; rec.tick(); self.assertTrue(process.killed)
        self.assertEqual(rec.counters['dropped'], 1); self.assertEqual(rec.state, 'disk_pressure')
        self.free = 10 * 1024**3; rec.tick(); self.assertEqual(rec.state, 'recording')

    def test_disk_write_failure_stops_without_success_receipt(self):
        rec = self.make(); self.start(rec)
        with patch('edge.lan_recorder.atomic_json', side_effect=OSError('disk full secret')):
            with self.assertRaises(OSError): rec.stop()
        self.assertFalse(rec.active); self.assertTrue(self.calls[-1][2].killed)
        self.assertFalse(any(r['state']=='completed' for r in rec.rows))

    def test_corrupt_completed_recording_never_reaches_analysis(self):
        rec = self.make(); self.start(rec)
        directory = rec.store.path / rec.capture['id']; synthetic_segment(directory)
        (directory / 'source.webm').write_bytes(b'corrupt recording bytes')
        self.calls[-1][2].returncode = 0; rec.tick()
        self.assertIsNone(self.jobs.job); self.assertEqual(rec.error, 'SEGMENT_INVALID')
        self.assertEqual(rec.counters['dropped'], 1)

    def test_complete_segments_and_interrupted_work_recover_stopped(self):
        rec = self.make(); self.start(rec); self.complete(rec); self.finish_analysis(rec)
        row = next(r for r in rec.rows if r['state']=='completed'); segment_id = row['id']
        # Simulated abrupt parent loss: stop OS worker, leave journal intent intact.
        rec._kill_capture(); rec.store.close(); self.jobs.release(rec)
        calls = len(self.calls); recovered = self.make(); recovered.tick()
        self.assertFalse(recovered.active); self.assertEqual(calls, len(self.calls))
        self.assertTrue(any(r['state']=='interrupted' and r['error']=='SERVICE_INTERRUPTED' for r in recovered.rows))
        self.assertTrue(recovered.artifact(segment_id, 'source')[0].is_file())
        self.assertEqual(recovered.counters['analyzed'], 1)

    def test_restart_detects_corruption_and_retains_no_claim_of_success(self):
        rec = self.make(); self.start(rec); self.complete(rec); self.finish_analysis(rec); rec.stop()
        row = next(r for r in rec.rows if r['state']=='completed')
        (rec.store.path / row['id'] / 'review.json').write_text('{}')
        rec.close(); recovered = self.make()
        damaged = next(r for r in recovered.rows if r['id']==row['id'])
        self.assertEqual(damaged['error'], 'INTEGRITY_FAILED')
        with self.assertRaises(FeedError): recovered.artifact(row['id'], 'result')

    def test_retention_and_queue_bounds_expose_drops(self):
        self.config.update(max_segments=2, retention_minutes=1)
        rec = self.make(); self.start(rec)
        # Enough headroom to capture, but not to snapshot model/source/results.
        rec.disk_usage = lambda p: SimpleNamespace(free=(self.config['reserve_mib'] + 100) * 1024**2)
        self.complete(rec); self.complete(rec)
        self.assertLessEqual(len(rec.rows), 2)
        self.assertEqual(rec.counters['expired'], 1); self.assertEqual(rec.counters['dropped'], 1)
        self.now += 61; rec.tick()
        self.assertGreaterEqual(rec.counters['expired'], 2)

    def test_expired_queue_is_pruned_before_analysis_admission(self):
        self.config['retention_minutes'] = 1
        rec = self.make(); self.start(rec)
        directory = rec.store.path / rec.capture['id']; synthetic_segment(directory)
        self.calls[-1][2].returncode = 0; rec._capture_tick(); rec.stop()
        self.now += 61; self.start(rec)
        self.assertIsNone(self.jobs.job)
        self.assertEqual(rec.counters['expired'], 1); self.assertEqual(rec.counters['dropped'], 1)

    def test_byte_budget_prunes_old_entries_before_reserving_another_segment(self):
        self.config['max_storage_mib'] = 256
        rec = self.make()
        for i in range(9):
            row = {'id':format(i, '032x'), 'source':'dock', 'state':'failed', 'created_at':self.now}
            rec.rows.append(row); directory = rec.store.path / row['id']; directory.mkdir(mode=0o700)
            with (directory / 'capture.webm').open('wb') as stream: stream.truncate(32 * 1024**2)
        rec.store.save(); self.start(rec)
        self.assertGreater(rec.counters['expired'], 0)
        from edge.lan_recorder import RESERVATION
        self.assertLessEqual(rec.store.usage() + RESERVATION, 256 * 1024**2)

    def test_retained_bytes_cannot_starve_queued_analysis(self):
        self.config['max_storage_mib'] = 256
        rec = self.make(); self.start(rec)
        queued = rec.capture
        synthetic_segment(rec.store.path / queued['id'])
        self.calls[-1][2].returncode = 0; rec._capture_tick()
        for i in range(5):
            row = {'id':format(i, '032x'), 'source':'dock', 'state':'failed', 'created_at':self.now}
            rec.rows.append(row); directory = rec.store.path / row['id']; directory.mkdir(mode=0o700)
            with (directory / 'capture.webm').open('wb') as stream: stream.truncate(32 * 1024**2)
        rec.store.save(); rec.tick()
        self.assertIs(rec.analysis, queued)
        self.assertGreaterEqual(rec.counters['expired'], 2)
        self.finish_analysis(rec)
        self.assertEqual(queued['state'], 'completed')
        self.assertEqual(rec.counters['analyzed'], 1)

    def row(self, rec, index, size, state='failed'):
        row = {'id':format(index, '032x'), 'source':'dock', 'state':state, 'created_at':self.now}
        rec.rows.append(row); directory = rec.store.path / row['id']; directory.mkdir(mode=0o700)
        with (directory / 'capture.webm').open('wb') as stream: stream.truncate(size)
        return row

    def test_in_flight_analysis_scratch_is_reserved_once(self):
        from edge.lan_recorder import RESERVATION
        from edge.result_store import REVIEW_BYTES
        self.config['max_storage_mib'] = 256; rec = self.make(); MiB = 1024**2
        rows = [self.row(rec, i, 16 * MiB) for i in range(2)]; analyzing = self.row(rec, 2, 0, 'analyzing')
        rec.store.save()
        scratch = rec.work / 'intelligent-dvr-job-abcdefgh'; scratch.mkdir(mode=0o700)
        with (scratch / 'model.onnx').open('wb') as stream: stream.truncate(60 * MiB)
        with (scratch / 'source.webm').open('wb') as stream: stream.truncate(32 * MiB)
        # A running job: its scratch bytes are part of, not additional to, its budget.
        rec.analysis = analyzing; rec.analysis_budget = 60 * MiB + 32 * MiB + REVIEW_BYTES
        total, work = rec.store.usage(split=True); self.assertEqual(work, 92 * MiB)
        self.assertGreater(total + RESERVATION + rec.analysis_budget, 256 * MiB)  # Former double count.
        rec._expire(room=True)
        self.assertEqual(rec.counters['expired'], 0); self.assertTrue(all(r in rec.rows for r in rows))
        self.assertTrue(rec._space())
        rec.analysis_budget = 160 * MiB  # A genuinely larger reservation still evicts the oldest row.
        rec._expire(room=True)
        self.assertNotIn(rows[0], rec.rows); self.assertIn(rows[1], rec.rows); self.assertIn(analyzing, rec.rows)
        rec.analysis = None; rec.analysis_budget = 0

    def test_external_free_space_pressure_evicts_oldest_unprotected_rows(self):
        from edge.lan_recorder import RESERVATION
        MiB = 1024**2; rec = self.make()
        rows = [self.row(rec, i, 8 * MiB) for i in range(3)]; rec.store.save()
        floor = self.config['reserve_mib'] * MiB + RESERVATION; capacity = [0]
        rec.disk_usage = lambda p: SimpleNamespace(free=capacity[0] - rec.store.usage())
        # Eviction cannot restore the reserve: keep the evidence and report pressure.
        capacity[0] = floor - 64 * MiB + rec.store.usage(); self.start(rec)
        self.assertEqual(rec.state, 'disk_pressure'); self.assertEqual(rec.counters['expired'], 0)
        self.assertEqual(self.calls, [])
        # Another application leaves 4 MiB too little: only the oldest row is removed.
        capacity[0] = floor - 4 * MiB + rec.store.usage(); rec.tick()
        self.assertEqual(rec.state, 'recording'); self.assertEqual(rec.counters['expired'], 1)
        self.assertEqual(rec.rows[:2], rows[1:]); self.assertFalse((rec.store.path / rows[0]['id']).exists())
        # Retained rows are evicted oldest first; the in-progress capture never is.
        capture = rec.capture; capacity[0] = floor - 12 * MiB + rec.store.usage(); rec._expire(room=True)
        self.assertEqual(rec.rows, [capture]); self.assertEqual(rec.counters['expired'], 3)

    def test_finished_segment_is_accepted_after_a_supervisor_stall(self):
        rec = self.make(); self.start(rec)
        synthetic_segment(rec.store.path / rec.capture['id']); self.calls[-1][2].returncode = 0
        # The worker exited before the deadline/free-space checks were next run.
        self.now += self.config['segment_seconds'] + 30; self.free = 1; rec.tick()
        self.assertEqual(rec.counters['recorded'], 1); self.assertEqual(rec.counters['dropped'], 0)
        self.assertEqual(rec.rows[0]['state'], 'queued')
        # Pressure now blocks only the next capture/analysis; nothing was discarded.
        self.assertEqual((rec.state, rec.error), ('disk_pressure', 'STORAGE_PRESSURE'))

    def test_segment_download_streams_without_the_lock_and_pins_retention(self):
        rec = self.make(); self.start(rec); self.complete(rec); self.finish_analysis(rec); rec.stop()
        row = next(r for r in rec.rows if r['state'] == 'completed')
        with rec.open_artifact(row['id'], 'source') as (stream, mime):
            self.assertEqual(mime, 'video/webm')
            acquired = []
            thread = threading.Thread(target=lambda: acquired.append(rec.lock.acquire(timeout=2)) or rec.lock.release())
            thread.start(); thread.join(5); self.assertEqual(acquired, [True])
            self.now += self.config['retention_minutes'] * 60 + 1; rec._expire()
            self.assertIn(row, rec.rows)
            self.assertEqual(hashlib.sha256(stream.read()).hexdigest(), row['sha256'])
        rec._expire(); self.assertNotIn(row, rec.rows); self.assertEqual(rec.reading, {})

    def test_supervisor_failure_during_analysis_returns_jobs_after_cancel(self):
        rec = self.make(); self.start(rec); self.complete(rec)
        row = rec.analysis; job = row['job_id']
        def broken(): raise OSError('storage vanished')
        rec._capture_tick = broken
        rec._supervise()  # One failing tick; returns after the failure hand-off.
        self.assertTrue(rec.failed); self.assertEqual(rec.state, 'failed')
        self.assertIn(self.jobs.snapshot(job)['state'], ('completed', 'failed', 'cancelled'))
        self.assertIsNone(self.jobs.owner); self.assertIsNone(rec.analysis)
        self.assertEqual((row['state'], row['error']), ('queued', 'ANALYSIS_INTERRUPTED'))
        # Manual analysis works without restarting the service.
        recording = next(r for r in self.jobs.available()['recordings'] if r['name'] == 'synthetic.webm')
        self.jobs.start({'recording':recording['id'], 'model':'synthetic', 'rules':'presence'})
        self.jobs.thread.join(timeout=15); self.assertEqual(self.jobs.snapshot()['state'], 'completed')
        with self.assertRaises(FeedError): rec.start({'model':'synthetic', 'rules':'presence'})

    def test_segment_directory_is_synced_before_its_row_is_committed(self):
        rec = self.make(); self.start(rec); directory = rec.store.path / rec.capture['id']; events = []
        with patch('edge.segment_worker.sync_directory', side_effect=lambda p: events.append(
                ('worker', Path(p), sorted(f.name for f in Path(p).iterdir())))):
            synthetic_segment(directory)
        # After both final renames (capture.webm -> source.webm, complete.json).
        self.assertEqual(events, [('worker', directory, ['complete.json', 'progress.json', 'source.webm'])])
        save = rec.store.save; events.clear()
        with patch('edge.lan_recorder.sync_directory', side_effect=lambda p: events.append(('sync', Path(p)))), \
                patch.object(rec.store, 'save', side_effect=lambda: (events.append(('save', rec.rows[0]['state'])), save())):
            self.calls[-1][2].returncode = 0; rec._capture_tick()
        # Segment folder first, then the state commit (which syncs the store folder itself).
        self.assertEqual(events, [('sync', directory), ('save', 'queued'), ('sync', rec.store.path)])

    @unittest.skipUnless(sys.platform == 'linux', 'Parent-death signal is Linux-only')
    def test_linux_segment_worker_arms_owned_child_before_reading_credentials(self):
        result = subprocess.run([sys.executable, '-m', 'edge.segment_worker', str(self.root), '5'], input=b'',
            env={**os.environ, 'DVR_SEGMENT_PARENT_PID': '0'}, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 72)

    def test_symlinked_ancestor_is_resolved_but_links_at_or_beneath_roots_are_refused(self):
        # Silverblue-style /home -> /var/home above every configured folder.
        alias = self.root / 'home'
        try: alias.symlink_to(self.root, target_is_directory=True)
        except OSError: self.skipTest('Host does not permit test symlinks')
        catalog = load_catalog(alias / 'config.json')
        self.assertEqual(catalog['models']['synthetic']['path'], (self.root / 'fixture.onnx').resolve())
        jobs = Jobs(alias / 'recordings', catalog)
        try:
            self.assertIn('synthetic.webm', [r['name'] for r in jobs.available()['recordings']])
            Store(alias / 'recordings' / 'aliased-store').close()
            if sys.platform == 'linux':
                from edge.result_store import ResultStore
                ResultStore(alias / 'state').close()
        finally: jobs.close()
        # A link named as the root, or anywhere beneath it, still cannot redirect inputs or storage.
        (self.root / 'linked').symlink_to(self.root, target_is_directory=True)
        config = json.loads((self.root / 'config.json').read_text()); config['models'][0]['path'] = 'linked/fixture.onnx'
        (self.root / 'linked-config.json').write_text(json.dumps(config))
        with self.assertRaises(ValueError): load_catalog(alias / 'linked-config.json')
        with self.assertRaises(ValueError): Jobs(alias / 'linked', catalog)
        (self.root / 'store-link').symlink_to(self.root / 'recordings' / 'aliased-store', target_is_directory=True)
        with self.assertRaises(ValueError): Store(alias / 'store-link')

    def test_wrong_result_and_timing_fingerprint_are_rejected(self):
        rec = self.make(); self.start(rec); self.complete(rec); self.finish_analysis(rec)
        row = next(r for r in rec.rows if r['state']=='completed')
        timing = rec.store.path / row['id'] / 'complete.json'; timing.write_text('{}')
        with self.assertRaises(FeedError): rec.artifact(row['id'], 'timing')
        with self.assertRaises(ValueError): Store.bind_review({'schema':'intelligent-dvr.recognition-review.v1',
            'receipt': {'source_sha256':'0'*64,'state':'completed'}, 'trace':{'source_sha256':'0'*64,'state':'completed'}}, row)

    def test_input_changed_before_snapshot_checks_exact_recording_hash(self):
        rec = self.make(); self.start(rec)
        directory = rec.store.path / rec.capture['id']; synthetic_segment(directory)
        row = rec.capture; self.calls[-1][2].returncode = 0; rec._capture_tick()
        path = directory / 'source.webm'; expected = row['sha256']; path.write_bytes(path.read_bytes() + b'changed')
        job = self.jobs.start({'recording':row['id'],'model':'synthetic','rules':'presence'}, owner=rec, source=path, expected_sha=expected)
        self.jobs.thread.join(timeout=10)
        self.assertEqual(self.jobs.snapshot(job['id'])['error']['code'], 'SOURCE_CHANGED')

    def test_native_encoder_rejects_disconnect_and_corrupt_media(self):
        path = self.root / 'worker'; path.mkdir()
        with self.assertRaises(ValueError): synthetic_segment(path, fail_at=6)
        self.assertFalse((path / 'complete.json').exists())
        shutil.rmtree(path); path.mkdir(); synthetic_segment(path)
        source = path / 'source.webm'; source.write_bytes(source.read_bytes()[:80])
        with self.assertRaises(ValueError): validate_video(source, 49, (160, 120))

    def test_finalized_video_verification_switches_network_policy_to_local_only(self):
        directory = self.root / 'verification'; directory.mkdir()
        with patch.dict(os.environ, {'OPENCV_FFMPEG_CAPTURE_OPTIONS':'rtsp_transport;tcp|protocol_whitelist;rtsp,tcp|allowed_media_types;video'}):
            synthetic_segment(directory)
            self.assertIn('protocol_whitelist;rtsp,tcp', os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'])
        self.assertTrue((directory / 'complete.json').is_file())

    def test_stopped_analysis_is_queued_and_retried_only_after_explicit_start(self):
        rec = self.make(); self.start(rec)
        # Complete capture without dispatching, then simulate persisted in-flight analysis.
        directory = rec.store.path / rec.capture['id']; synthetic_segment(directory)
        self.calls[-1][2].returncode = 0; rec._capture_tick()
        row = rec.rows[0]; row.update(state='analyzing', job_id='b'*32); rec.store.save()
        rec.store.close(); self.jobs.release(rec)
        recovered = self.make(); recovered.tick()
        self.assertEqual(recovered.rows[0]['state'], 'queued'); self.assertIsNone(self.jobs.job)
        self.start(recovered); self.finish_analysis(recovered)
        self.assertEqual(recovered.rows[0]['state'], 'completed')

    def test_analysis_scratch_is_owned_bounded_and_cleaned_on_restart(self):
        rec = self.make(); self.start(rec); self.complete(rec)
        self.assertTrue(Path(self.jobs.directory.name).is_relative_to(rec.work))
        self.finish_analysis(rec); self.assertEqual(list(rec.work.iterdir()), [])
        rec._kill_capture(); scratch = rec.work / 'intelligent-dvr-job-abcdefgh'; scratch.mkdir(mode=0o700)
        (scratch / 'model.onnx').write_bytes(b'interrupted model copy')
        rec.store.close(); self.jobs.release(rec)
        recovered = self.make(); self.assertEqual(list(recovered.work.iterdir()), [])
        self.assertFalse(recovered.active)

    def test_parent_pipe_closure_terminates_native_worker_lifetime_on_both_platforms(self):
        child = subprocess.Popen([sys.executable, '-c',
            "from edge.analysis_worker import watch_parent_pipe; import time; watch_parent_pipe(); print('ready', flush=True); time.sleep(60)"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            self.assertEqual(child.stdout.readline().strip(), b'ready')
            child.stdin.close()
            self.assertEqual(child.wait(timeout=5), 75)
        finally:
            if child.poll() is None: child.kill(); child.wait()
            child.stdout.close()

    def test_parent_watch_allows_native_runtime_and_normal_worker_exit(self):
        child = subprocess.Popen([sys.executable, '-c',
            "from edge.analysis_worker import watch_parent_pipe; watch_parent_pipe(); import cv2; cap = cv2.VideoCapture(); cap.release()"],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.assertEqual(child.wait(timeout=10), 0)
        finally:
            if child.poll() is None: child.kill(); child.wait()
            child.stdin.close()

    @unittest.skipUnless(sys.platform == 'linux', 'Existing manual last-job recovery is Linux-only')
    def test_managed_analysis_does_not_replace_manual_persistent_result(self):
        self.jobs.close()
        self.jobs = Jobs(self.root / 'recordings', load_catalog(self.root / 'config.json'), state_dir=self.root / 'manual-state')
        choices = self.jobs.available()['recordings']; recording = next(r for r in choices if r['name']=='synthetic.webm')
        manual = self.jobs.start({'recording':recording['id'],'model':'synthetic','rules':'presence'})
        self.jobs.thread.join(timeout=15); self.assertEqual(self.jobs.snapshot()['state'], 'completed')
        before = (self.root / 'manual-state' / 'state.json').read_bytes()
        rec = self.make(); self.start(rec); self.complete(rec); self.finish_analysis(rec); rec.close(); self.jobs.close()
        self.assertEqual((self.root / 'manual-state' / 'state.json').read_bytes(), before)
        self.jobs = Jobs(self.root / 'recordings', load_catalog(self.root / 'config.json'), state_dir=self.root / 'manual-state')
        self.assertEqual(self.jobs.snapshot()['id'], manual['id'])


@unittest.skipUnless(os.getenv('DVR_TEST_SOCKETS') == '1', 'Requires controlled loopback sockets')
class RtspRecorderTest(unittest.TestCase):
    def test_actual_rtsp_relay_segment_worker_http_analysis_and_restart(self):
        import http.client
        import threading
        from local_feeds_fixture import SyntheticRtsp, sources
        from edge.local_service import LocalServer
        with tempfile.TemporaryDirectory() as temporary:
            root = build(temporary); fixture = SyntheticRtsp(); configured = sources(fixture.server_address[1])
            jobs = Jobs(root / 'recordings', load_catalog(root / 'config.json'))
            recorder = Recorder({**DEFAULTS,'source':'video','segment_seconds':5}, configured, jobs, root / 'store')
            server = LocalServer(0, jobs, root, recorder=recorder)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            def request(path, body=None, **headers):
                conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=10)
                conn.request('POST' if body is not None else 'GET', path, body, headers)
                res = conn.getresponse(); result = res.status, res.read(); conn.close(); return result
            try:
                time.sleep(.3); self.assertEqual(recorder.counters['recorded'], 0)
                headers = {'X-DVR-Token':jobs.token, 'Content-Type':'application/json'}
                self.assertEqual(request('/api/recorder/status')[0], 403)
                self.assertEqual(request('/api/recorder/status', **{**headers, 'Origin':'https://evil.test'})[0], 403)
                self.assertEqual(request('/api/recorder/status', **{**headers, 'Host':'evil.test'})[0], 403)
                self.assertEqual(request('/api/recorder/start', '{"model":"synthetic","rules":"presence"}', **headers)[0], 202)
                deadline = time.monotonic() + 30
                while recorder.counters['analyzed'] == 0 and time.monotonic() < deadline: time.sleep(.1)
                self.assertGreater(recorder.counters['analyzed'], 0, recorder.status())
                state = json.loads(request('/api/recorder/status', **headers)[1]); row = next(r for r in state['segments'] if r['state']=='completed')
                code, source = request('/api/recorder/segments/'+row['id']+'/source', **headers)
                self.assertEqual(code, 200); self.assertEqual(hashlib.sha256(source).hexdigest(), row['sha256'])
                # Actual upstream teardown, bounded reconnect, then media recovery.
                fixture.disconnect_after = 4
                deadline = time.monotonic() + 20
                while recorder.counters['dropped'] == 0 and time.monotonic() < deadline: time.sleep(.1)
                self.assertGreater(recorder.counters['dropped'], 0, recorder.status())
                before = recorder.counters['analyzed']; fixture.disconnect_after = None
                deadline = time.monotonic() + 30
                while recorder.counters['analyzed'] <= before and time.monotonic() < deadline: time.sleep(.1)
                self.assertGreater(recorder.counters['analyzed'], before, recorder.status())
                self.assertEqual(request('/api/recorder/stop', '{}', **headers)[0], 200)
            finally:
                server.shutdown(); server.server_close(); thread.join(); recorder.close(); jobs.close(); fixture.close()
            recovered_jobs = Jobs(root / 'recordings', load_catalog(root / 'config.json'))
            recovered = Recorder({**DEFAULTS,'source':'video','segment_seconds':5}, configured, recovered_jobs, root / 'store')
            try:
                self.assertFalse(recovered.active); self.assertTrue(recovered.artifact(row['id'], 'result')[0].is_file())
            finally: recovered.close(); recovered_jobs.close()


if __name__ == '__main__': unittest.main()
