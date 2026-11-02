import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingTiming, timedTrainingFrames } from '../src/training-time.mjs';
import { CHECK_SCRIPT, labelFrames } from '../src/training.mjs';

const hash = 'a'.repeat(64);
function recording() {
  // The third sampled image already belongs to the empty-room prompt, even
  // though frame position would put it at 8s and nominal FPS would put it at 4s.
  const pts = [0, 5.1, 13.2, 15, 19.6];
  return {
    origin: 'offline-analyzer', source_timing: 'pyav-relative-pts-v1', source_sha256: hash,
    frames_read: 10, stride: 2,
    frames: pts.map((source_seconds, i) => ({ frame_index: i*2, seconds: i*2, source_seconds, detections: [] })),
    media_coverage: { termination: 'source-end', status: 'unverified', source_sha256: hash,
      analysis_frames: 10, validated_frames: 10, decoded_duration_seconds: 20 },
  };
}

test('uses source PTS for prompt decisions and evidence seeking without changing the source trace', () => {
  const trace = recording();
  const {timing, frames} = timedTrainingFrames(trace, 20.1);
  assert.deepEqual([timing.verified, timing.method], [true, 'source-pts']);
  const labeled = labelFrames(frames, {script: CHECK_SCRIPT});
  assert.equal(labeled[2].expect, 'absent');
  assert.equal(labeled[2].wall, 13.2);
  assert.equal(labeled[2].seconds, 13.2);
  assert.equal(trace.frames[2].seconds, 4);
  assert.equal(trace.media_coverage.status, 'unverified');
});

test('usable duration must agree with active recording and never extrapolates drifted evidence', () => {
  assert.equal(trainingTiming(recording(), 20.5).verified, true);
  for (const elapsed of [20.51, 19.49, 0, undefined, Infinity]) assert.equal(trainingTiming(recording(), elapsed).verified, false);
  const trace = recording();
  const {timing, frames} = timedTrainingFrames(trace, 21);
  assert.deepEqual([timing.verified, timing.method], [false, 'estimated']);
  assert.equal(frames[2].seconds, 8.4);
  delete trace.source_timing;
  assert.equal(timedTrainingFrames(trace, 20).timing.method, 'estimated');
  assert.deepEqual(timedTrainingFrames(null, 20).frames, []);
});

test('rejects missing, inconsistent, malformed or truncated timestamp evidence', () => {
  for (const mutate of [
    t => {t.frames[2].source_seconds = 5.1;}, t => {delete t.frames[2].source_seconds;},
    t => {t.frames[0].source_seconds = 0.05;}, t => {t.frames[3].frame_index = 7;},
    t => {t.frames[4].source_seconds = 20;}, t => {t.frames[4].source_seconds = NaN;},
    t => t.frames.pop(), t => {t.stride = 0;}, t => {t.media_coverage.validated_frames = 8;},
    t => {t.media_coverage.termination = 'frame-limit';}, t => {t.media_coverage.status = 'not-checked';},
    t => {t.media_coverage.source_sha256 = 'b'.repeat(64);}, t => {t.origin = 'precomputed-synthetic';},
    t => {t.media_coverage.decoded_duration_seconds = null;},
  ]) {
    const trace = recording(); mutate(trace);
    assert.equal(trainingTiming(trace, 20).verified, false);
  }
});
