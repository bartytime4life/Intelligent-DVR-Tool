import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseRecognition, frameSummary, canShowBoxes, matchRecording, mergeRecognitionEvents, MAX_VIDEO_BYTES } from '../src/recognition.mjs';
import { recognitionFixture } from './fixtures/recognition.mjs';

test('recognition review retains real class names, provenance and event-frame association', () => {
  const run = parseRecognition(recognitionFixture());
  assert.equal(run.events[0].mode, 'offline-model');
  assert.equal(run.events[0].camera, null);
  assert.deepEqual(run.eventFrames, [0]);
  assert.deepEqual(frameSummary(run.trace.frames[0]).counts, [['car', 1], ['person', 1]]);
  assert.deepEqual(frameSummary(run.trace.frames[0], .95).counts, []);
  assert.deepEqual(frameSummary(run.trace.frames[1]).counts, []);
  assert.equal(run.receipt.events.length, 1);
});

test('mixed-source/model/settings/observation bundles fail closed', () => {
  for (const change of [
    v => { v.trace.source_sha256 = 'f'.repeat(64); },
    v => { v.trace.model_sha256 = 'f'.repeat(64); },
    v => { v.trace.rules_sha256 = 'f'.repeat(64); },
    v => { v.trace.stride = 1; },
    v => { v.trace.state = 'partial'; },
    v => { v.trace.events = []; },
    v => { v.trace.origin = 'fixture'; },
    v => { v.receipt.events[0].seconds = .25; },
    v => { v.receipt.events[0].camera = 'another-camera'; },
  ]) { const value = recognitionFixture(); change(value); assert.throws(() => parseRecognition(value)); }
});

test('invalid geometry, timestamps, lengths and labels are rejected', () => {
  for (const change of [
    v => { v.trace.frames[1].seconds = .6; },
    v => { v.trace.frames[1].frame_index = 0; },
    v => { v.trace.frames.pop(); },
    v => { v.trace.frames[0].width = 0; },
    v => { v.trace.frames[0].detections[0].score = NaN; },
    v => { v.trace.frames[0].detections[0].box = [.9,0,.2,.2]; },
    v => { v.trace.frames[0].detections[0].box = [0,0,0,.2]; },
    v => { v.trace.frames[0].detections[0].label = 'x'.repeat(81); },
    v => { v.trace.frames[0].detections = Array(100001).fill({}); },
  ]) { const value = recognitionFixture(); change(value); assert.throws(() => parseRecognition(value)); }
});

test('partial coverage is preserved and display filtering never changes rule observations', () => {
  const value = recognitionFixture(); value.receipt.state = value.trace.state = 'partial';
  const run = parseRecognition(value), before = JSON.stringify(value);
  assert.equal(run.receipt.state, 'partial');
  frameSummary(run.trace.frames[0], 1);
  assert.equal(JSON.stringify(value), before);
  assert.throws(() => frameSummary(run.trace.frames[0], NaN));
});

test('overlays require matched source and the paused, correctly sized sampled frame', () => {
  const frame = recognitionFixture().trace.frames[1];
  const ready = { matched: true, ready: true, paused: true, seeking: false, seconds: .5, width: 320, height: 240 };
  assert.equal(canShowBoxes(frame, 10, ready), true);
  for (const change of [{matched:false},{ready:false},{paused:false},{seeking:true},{seconds:1},{seconds:NaN},{width:640},{height:480}]) {
    assert.equal(canShowBoxes(frame, 10, {...ready,...change}), false);
  }
});

test('hash match admits exact local bytes and rejects changed/oversized/empty recordings', async () => {
  const data = new Blob(['explicit synthetic source, not footage']);
  const sha = createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex');
  assert.equal(await matchRecording(data, sha), sha);
  await assert.rejects(matchRecording(new Blob(['different']), sha), /does not match/);
  await assert.rejects(matchRecording(new Blob([]), sha), /nonempty/);
  await assert.rejects(matchRecording({size: MAX_VIDEO_BYTES+1}, sha), /512 MiB/);
});

test('untrusted class text stays data and prototype-like labels can be counted', () => {
  const v = recognitionFixture();
  v.trace.frames[0].detections[0].label = '__proto__';
  const run = parseRecognition(v);
  assert.deepEqual(frameSummary(run.trace.frames[0]).counts, [['__proto__',1],['car',1]]);
});

test('repeat import keeps decisions, and queue overflow does not silently discard records', () => {
  const added = parseRecognition(recognitionFixture()).events;
  const previous = [{...added[0], status:'confirmed', note:'Reviewed original recording.'}];
  assert.deepEqual(mergeRecognitionEvents(previous, added), previous);
  assert.throws(() => mergeRecognitionEvents(Array.from({length:1000}, (_,i) => ({id:`old-${i}`})), added), /exceed/);
});
