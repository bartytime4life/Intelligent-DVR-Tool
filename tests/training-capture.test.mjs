import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingTake, createPromptChime } from '../src/training-capture.mjs';

function setup(seconds = 10) {
  let time = 0, callbacks;
  const calls = [], clips = [], errors = [], states = [];
  const track = { readyState: 'live', muted: false, enabled: true, getSettings: () => ({ deviceId: 'camera-for-this-session' }) };
  const take = createTrainingTake({ stream: { getVideoTracks: () => [track] }, seconds,
    now: () => time, createRecorder(options) {
      callbacks = options;
      return { start: () => calls.push('start'), pause: () => { calls.push('pause'); return true; },
        resume: () => { calls.push('resume'); return true; }, stop: reason => calls.push(reason) };
    }, onError: message => errors.push(message), onComplete: value => clips.push(value), onChange: state => states.push(state) });
  const tick = (ms, visible = true) => { time += ms; take.update(visible); };
  const finish = (changes = {}) => callbacks.onClip({ reason: 'Script complete', elapsed: seconds, blob: new Blob(['test']), ...changes });
  return { take, tick, finish, calls, errors, clips, states, track };
}

test('hiding during the restart countdown freezes capture and resets the countdown', () => {
  const s = setup();
  s.tick(3000); s.tick(2000, false);
  s.tick(20000, false); s.tick(0); s.tick(2000); s.tick(0, false);
  s.tick(5000, false);
  assert.deepEqual(s.calls, ['start', 'pause']);
  assert.equal(s.states.at(-1).elapsed, 2);
  s.tick(0); s.tick(2999); assert.equal(s.calls.includes('resume'), false);
  s.tick(1); s.tick(7999); assert.equal(s.calls.includes('Script complete'), false);
  s.tick(1); s.finish();
  assert.deepEqual(s.calls, ['start', 'pause', 'resume', 'Script complete']);
  assert.equal(s.clips.length, 1);
  assert.equal(s.clips[0].cameraKey, 'camera-for-this-session');
});

test('initial countdown never opens the recorder while hidden', () => {
  const s = setup();
  s.tick(1500, false); s.tick(5000, false); s.tick(0); s.tick(2999);
  assert.deepEqual(s.calls, []);
  s.tick(1); assert.deepEqual(s.calls, ['start']);
});

test('disconnected, truncated, and empty video cannot complete any training script', () => {
  const early = setup();
  early.tick(3000); early.finish({ reason: 'Camera disconnected', elapsed: 1 });
  assert.equal(early.clips.length, 0); assert.equal(early.errors.length, 1);
  for (const changes of [{ elapsed: 3 }, { elapsed: NaN }, { blob: new Blob([]) }, { reason: 'Camera stream ended' }]) {
    const s = setup();
    s.tick(3000); s.tick(10000); s.finish(changes);
    assert.equal(s.clips.length, 0);
    assert.equal(s.errors.length, 1);
  }
});

test('a muted track ends the attempt and late media after leaving cannot enter analysis', () => {
  const s = setup();
  s.tick(3000); s.track.muted = true; s.tick(200);
  assert.match(s.errors[0], /Camera frames stopped/);
  s.finish(); assert.equal(s.clips.length, 0);
  const cancelled = setup();
  cancelled.tick(3000); cancelled.take.cancel(); cancelled.finish();
  assert.deepEqual(cancelled.calls, ['start', 'Left training']);
  assert.deepEqual(cancelled.clips, []);
});

test('optional cue generates one or two speaker tones and cancellation releases every output', async () => {
  const ramps = [], speakers = [], stops = [];
  let closeCount = 0;
  class Audio {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { closeCount++; this.state = 'closed'; return Promise.resolve(); }
    createOscillator() {
      return { frequency: {}, connect() {}, disconnect() {}, start() {}, stop: time => stops.push(time) };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime: value => ramps.push(value) },
        connect: dest => speakers.push(dest), disconnect() {} };
    }
  }
  const cue = createPromptChime(Audio);
  await cue.ring();
  assert.equal(ramps.length, 0);
  await cue.enable();
  const prompt = cue.ring(); cue.silence(); await prompt;
  assert.equal(ramps.filter(v => v > 0).length, 1);
  const finish = cue.ring(true); cue.close(); await finish;
  assert.equal(ramps.filter(v => v > 0).length, 3);
  assert.equal(speakers.length, 2);
  assert.deepEqual(stops, [.12, undefined, .27, undefined]);
  await cue.ring(); cue.close(); assert.equal(closeCount, 1);
});
