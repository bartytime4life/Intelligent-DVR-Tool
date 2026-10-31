import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseRecognition, frameSummary, canShowBoxes, matchRecording, mergeRecognitionEvents, MAX_VIDEO_BYTES } from '../src/recognition.mjs';
import { Sha256, sha256Blob, sha256File } from '../src/sha256.mjs';
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

const reference = bytes => createHash('sha256').update(bytes).digest('hex');
const pattern = length => Uint8Array.from({length}, (_, i) => (i * 131 + (i >> 8) * 7 + 13) & 255);

test('streaming SHA-256 matches node:crypto and WebCrypto across padding and slice boundaries', async () => {
  for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 4097]) {
    const bytes = pattern(length);
    assert.equal(await sha256Blob(new Blob([bytes])), reference(bytes), `length ${length}`);
    const web = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    assert.equal(new Sha256().update(bytes).hex(), web);
  }
  const large = pattern(3 * 1024 ** 2 + 77), blob = new Blob([large]), expected = reference(large);
  const small = new Blob([large.subarray(0, 4099)]), smallSha = reference(large.subarray(0, 4099));
  for (const chunkBytes of [1, 63, 1000]) assert.equal(await sha256Blob(small, {chunkBytes, yieldBetween: false}), smallSha, `chunk ${chunkBytes}`);
  for (const chunkBytes of [64 * 1024, 1024 ** 2 + 5, undefined]) assert.equal(await sha256Blob(blob, {chunkBytes}), expected, `chunk ${chunkBytes}`);
  // Uneven incremental updates equal one update; finalization is single-use.
  const parts = new Sha256(); for (let i = 0; i < large.length;) { const step = 1 + (i % 97); parts.update(large.subarray(i, i += step)); }
  assert.equal(parts.hex(), expected); assert.throws(() => parts.update(new Uint8Array(1)), /finalized/);
  // The 64-bit bit-length field stays exact past 2^29 bytes (the 512 MiB recording ceiling).
  class Probe extends Sha256 { update(data) { this.tail = data; return super.update(data); } }
  const probe = new Probe(); probe.bytes = 2 ** 29 + 3; probe.used = 3; probe.hex();
  const view = new DataView(probe.tail.buffer);
  assert.deepEqual([probe.tail.length, view.getUint32(probe.tail.length - 8), view.getUint32(probe.tail.length - 4)], [61, 1, 24]);
});

test('recording hashing yields between slices and stops on AbortSignal', async () => {
  const blob = new Blob([pattern(256 * 1024)]);
  let reads = 0; const slice = blob.slice.bind(blob);
  const counted = {size: blob.size, slice: (...args) => { reads++; return slice(...args); }};
  const controller = new AbortController();
  const pending = sha256Blob(counted, {signal: controller.signal, chunkBytes: 1024});
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.ok(reads > 0 && reads < 256, `stopped after ${reads} of 256 slices`);
  const already = new AbortController(); already.abort();
  await assert.rejects(matchRecording(blob, reference(pattern(256 * 1024)), {signal: already.signal}), {name: 'AbortError'});
  const reason = new AbortController(); reason.abort(new DOMException('Opening cancelled', 'AbortError'));
  await assert.rejects(sha256File(blob, {signal: reason.signal}), /Opening cancelled/);
});

test('a module worker hashes off the page, and any worker failure falls back to the same thread', async () => {
  const bytes = pattern(70000), blob = new Blob([bytes]), sha = reference(bytes);
  const made = [];
  class FakeWorker {
    constructor(mode) { this.mode = mode; this.terminated = false; made.push(this); }
    postMessage(data) {
      if (this.mode === 'throws') throw new DOMException('cannot clone', 'DataCloneError');
      setTimeout(async () => {
        if (this.terminated) return;
        if (this.mode === 'error') this.onerror({preventDefault() {}});
        else if (this.mode === 'garbage') this.onmessage({data: {hash: 'not-a-hash'}});
        else if (this.mode === 'hang') return;
        else this.onmessage({data: {hash: await sha256Blob(data, {yieldBetween: false})}});
      });
    }
    terminate() { this.terminated = true; }
  }
  for (const mode of ['ok', 'error', 'garbage', 'throws']) {
    assert.equal(await matchRecording(blob, sha, {createWorker: () => new FakeWorker(mode)}), sha, mode);
    assert.equal(made.at(-1).terminated, true);
  }
  assert.equal(await matchRecording(blob, sha, {createWorker: () => { throw Error('CSP refused the worker'); }}), sha);
  await assert.rejects(matchRecording(new Blob(['other']), sha, {createWorker: () => new FakeWorker('ok')}), /does not match/);
  const controller = new AbortController();
  const pending = matchRecording(blob, sha, {signal: controller.signal, createWorker: () => new FakeWorker('hang')});
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, {name: 'AbortError'}); assert.equal(made.at(-1).terminated, true);
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
