import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCounts, liveBoxLabel, boxesFresh, liveObservationEvent, liveDetector, liveRequest, LIVE_BOX_MAX_AGE_MS } from '../src/live-ai.mjs';
import { restoreSnapshot } from '../src/data.mjs';
import { parseRecognition, validateTracking, trackRows, boxLabel, mergeRecognitionEvents } from '../src/recognition.mjs';
import { filterEvents, queueCSV } from '../src/review-queue.mjs';
import { recognitionFixture } from './fixtures/recognition.mjs';

const session = { id: 'a'.repeat(32), camera: 'Front door', model_sha256: 'b'.repeat(64), state: 'live' };
const observation = { id: 'c'.repeat(32), camera: 'Front door', label: 'person', score: .91, seconds: 3.2, started_seconds: 3.2,
  rule: 'person present in door for 0s', review_required: true };

test('live counts, labels and box freshness describe only the analyzed frame', () => {
  const detections = [{ label: 'person', score: .9, track: 3 }, { label: 'person', score: .5 }, { label: 'car', score: .8, track: 1 }, { label: 'dog', score: .2 }];
  assert.deepEqual(liveCounts(detections), [['person', 2], ['car', 1]]);
  assert.equal(liveBoxLabel(detections[0]), 'person #3 0.90');
  assert.equal(liveBoxLabel(detections[1]), 'person 0.50');
  assert.equal(boxesFresh({ result: {}, resultAt: 1000 }, 1000 + LIVE_BOX_MAX_AGE_MS), true);
  assert.equal(boxesFresh({ result: {}, resultAt: 1000 }, 1001 + LIVE_BOX_MAX_AGE_MS), false);
  assert.equal(boxesFresh({ result: null, resultAt: 1000 }, 1000), false);
});

test('a live observation becomes a pending, recording-free queue entry that survives storage validation', () => {
  const event = liveObservationEvent(observation, session, Date.UTC(2026, 10, 1, 18, 4, 5));
  assert.equal(event.id, `live-${'c'.repeat(32)}`);
  assert.equal(event.mode, 'live-model');
  assert.equal(event.status, 'pending');
  assert.equal(event.cameraName, 'Front door');
  assert.deepEqual(event.provenance, { model_sha256: 'b'.repeat(64), state: 'live', session: 'a'.repeat(32), captured_at: '2026-11-01T18:04:05.000Z' });
  assert.equal('source_sha256' in event.provenance, false);
  assert.deepEqual(restoreSnapshot('dvr.events.v1', [event], null), [event]);
  for (const change of [e => { e.provenance.state = 'completed'; }, e => { e.provenance.session = 'x'; }, e => { e.camera = 1; },
    e => { e.provenance.source_sha256 = 'd'.repeat(64); }, e => { e.provenance.captured_at = 'soon'; }, e => { delete e.provenance; }]) {
    const changed = structuredClone(event); change(changed);
    assert.equal(restoreSnapshot('dvr.events.v1', [changed], null), null);
  }
  assert.throws(() => liveObservationEvent({ ...observation, id: 'short' }, session, Date.now()));
  // Live entries join the queue like other observations and keep earlier decisions.
  const merged = mergeRecognitionEvents([{ ...event, status: 'confirmed' }], [event]);
  assert.equal(merged[0].status, 'confirmed');
  assert.equal(filterEvents(merged, { mode: 'live-model' }).length, 1);
  assert.match(queueCSV(merged), /live-model/);
});

function service({ frames = [], startState = 'live' } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method, type: options.headers['Content-Type'], body: options.body });
    const json = value => ({ ok: true, json: async () => value });
    if (url.endsWith('/start')) return json({ ...session, state: startState, error: startState === 'live' ? null : { message: 'Model missing.' } });
    if (url.endsWith('/stop')) return json({ ...session, state: 'stopped' });
    const next = frames.shift();
    if (!next) return new Promise(() => {}); // Hold the loop until stop() aborts.
    if (next.error) return { ok: false, status: next.status || 409, json: async () => ({ error: next.error }) };
    return json({ ...next, session });
  };
  return { calls, fetcher };
}

test('the detector starts explicitly, sends one frame at a time and keeps observations with their still', async () => {
  const frame = { width: 640, height: 360, detector: 'ran', detections: [{ label: 'person', score: .9, box: [.1, .1, .2, .5], track: 1 }], observations: [observation], timing: { total_ms: 80 } };
  const { calls, fetcher } = service({ frames: [frame, { error: { code: 'BUSY', message: 'busy' }, status: 429 }, { ...frame, observations: [] }] });
  const snapshots = [];
  let t = 0;
  const still = new Blob(['jpeg'], { type: 'image/jpeg' });
  const detector = liveDetector({ token: 'tok', model: 'yolox-s', rules: 'presence', camera: 'Front door', capture: async () => still,
    onChange: s => snapshots.push(s), fetcher, now: () => (t += 50), wall: () => 1000, wait: async () => {} });
  assert.equal(calls.length, 0); // Nothing runs until start().
  await detector.start();
  for (let i = 0; i < 20 && calls.filter(c => c.url.includes('/frame')).length < 4; i++) await new Promise(r => setTimeout(r, 0));
  const frames = calls.filter(c => c.url.includes('/frame'));
  assert.deepEqual(calls[0], { url: '/api/live/start', method: 'POST', type: 'application/json', body: JSON.stringify({ model: 'yolox-s', rules: 'presence', camera: 'Front door' }) });
  assert.ok(frames.length >= 3);
  assert.ok(frames.every(c => c.type === 'image/jpeg' && c.body === still));
  const last = snapshots.at(-1);
  assert.equal(last.state, 'live');
  assert.equal(last.observations.length, 1);
  assert.equal(last.observations[0].still, still);
  assert.equal(last.observations[0].capturedAt, 1000);
  assert.ok(last.fps > 0);
  assert.equal(detector.snapshot.skippedBusy, 1);
  detector.markSent(0);
  assert.equal(snapshots.at(-1).observations[0].sent, true);
  detector.stop();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(snapshots.at(-1).state, 'stopped');
  assert.equal(snapshots.at(-1).observations.length, 1); // Observations stay sendable after Stop AI.
  assert.ok(calls.some(c => c.url === `/api/live/${session.id}/stop`));
});

test('start and frame failures stop the detector with the service message', async () => {
  let snapshots = [];
  let { fetcher } = service({ startState: 'failed' });
  let detector = liveDetector({ token: 't', model: 'm', rules: 'r', camera: 'c', capture: async () => new Blob(['x']), onChange: s => snapshots.push(s), fetcher, wait: async () => {} });
  await detector.start();
  assert.equal(snapshots.at(-1).state, 'failed');
  assert.equal(snapshots.at(-1).error, 'Model missing.');
  snapshots = [];
  ({ fetcher } = service({ frames: [{ error: { code: 'WORKER_TIMEOUT', message: 'Local AI took too long.' } }] }));
  detector = liveDetector({ token: 't', model: 'm', rules: 'r', camera: 'c', capture: async () => new Blob(['x']), onChange: s => snapshots.push(s), fetcher, wait: async () => {} });
  await detector.start();
  for (let i = 0; i < 10 && snapshots.at(-1).state !== 'failed'; i++) await new Promise(r => setTimeout(r, 0));
  assert.equal(snapshots.at(-1).state, 'failed');
  assert.equal(snapshots.at(-1).error, 'Local AI took too long.');
  await assert.rejects(liveRequest('/x', { token: 't', fetcher: async () => { throw TypeError('offline'); } }), /local AI service is unavailable/);
});

test('recognition results carry validated short-lived tracks', () => {
  const value = recognitionFixture();
  value.trace.frames[0].detections[0].track = 1;
  value.trace.tracking = { schema: 'intelligent-dvr.tracks.v1', method: 'bytetrack-style-iou-kalman-v1', tracks_dropped: 0,
    classes: { person: { tracks: 1, median_duration_seconds: 0, longest_duration_seconds: 0 } },
    tracks: [{ id: 1, label: 'person', first_seconds: 0, last_seconds: 0, duration_seconds: 0, hits: 1, max_score: .9, mean_score: .9,
      path: [[0, .2, .45]], zones: { entry: { entered_seconds: 0, seconds: 0 } } }] };
  const run = parseRecognition(value);
  assert.equal(run.tracking.byId.get(1).label, 'person');
  assert.deepEqual(trackRows(run.tracking, run.trace.frames).map(t => [t.id, t.frame]), [[1, 0]]);
  assert.equal(boxLabel(run.trace.frames[0].detections[0]), 'person #1 0.90');
  assert.equal(parseRecognition(recognitionFixture()).tracking, null); // Older results have no tracks.
  for (const change of [
    v => { v.trace.frames[0].detections[0].track = 2; },
    v => { v.trace.frames[0].detections[1].track = 1; }, // a car box on a person track
    v => { v.trace.frames[0].detections[2].track = 1; }, // the same track twice in one frame
    v => { v.trace.tracking.tracks[0].first_seconds = .1; },
    v => { v.trace.tracking.tracks.push({ ...v.trace.tracking.tracks[0] }); },
    v => { v.trace.tracking.schema = 'other'; },
    v => { delete v.trace.tracking; },
  ]) {
    const changed = structuredClone(value); change(changed);
    assert.throws(() => parseRecognition(changed));
  }
  assert.equal(validateTracking({ frames: [] }), null);
});

test('a restarted detector keeps the previous run’s unsent observations', async () => {
  const kept = { observation, still: new Blob(['x']), capturedAt: 5 };
  const snapshots = [];
  const { fetcher } = service();
  const detector = liveDetector({ token: 't', model: 'm', rules: 'r', camera: 'c', capture: async () => null, observations: [kept],
    onChange: s => snapshots.push(s), fetcher, wait: async () => {} });
  assert.deepEqual(detector.snapshot.observations, [kept]);
  await detector.start();
  assert.equal(snapshots[0].state, 'starting');
  assert.deepEqual(snapshots.at(-1).observations, [kept]);
  detector.stop();
});
