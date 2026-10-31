import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, reviewEvent } from '../src/data.mjs';
import { recognitionFixture } from './fixtures/recognition.mjs';
import { eventSeconds, filterEvents, queueChoices, nextPending, queueCSV, dismissPending, restorePending } from '../src/review-queue.mjs';

const queue = () => {
  const base = parseReceipt(recognitionFixture().receipt)[0];
  const at = (id, seconds, score, extra = {}) => ({...base, id, sourceId: id, seconds, time: `Clip +${seconds.toFixed(1)}s`, score, ...extra});
  return [
    at('a', 9, .6),
    at('b', 2, .9, {cameraName: 'gate', provenance: {...base.provenance, source_sha256: 'b'.repeat(64)}}),
    at('c', 5, .7, {status: 'confirmed'}),
    at('d', 1, .8),
  ];
};

test('receipt events keep numeric clip seconds and older events fall back to their label', () => {
  const [event] = parseReceipt(recognitionFixture().receipt);
  assert.ok(Number.isFinite(event.seconds));
  assert.equal(eventSeconds({time: 'Clip +12.3s'}), 12.3);
  assert.equal(eventSeconds({time: 'unknown'}), null);
});

test('filters by camera and recording and sorts without losing queue order on ties', () => {
  const events = queue();
  assert.deepEqual(filterEvents(events, {source: 'gate'}).map(e => e.id), ['b']);
  assert.deepEqual(filterEvents(events, {recording: 'b'.repeat(64)}).map(e => e.id), ['b']);
  assert.deepEqual(filterEvents(events, {sort: 'score'}).map(e => e.id), ['b', 'd', 'c', 'a']);
  assert.deepEqual(filterEvents(events, {sort: 'clip'}).map(e => e.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(filterEvents(events, {status: 'pending', query: 'GATE', label: e => e.cameraName}).map(e => e.id), ['b']);
  const choices = queueChoices(events);
  assert.deepEqual(choices.sources.map(s => s.value).sort(), ['gate', events[0].cameraName].sort());
  assert.equal(choices.recordings.length, 2);
});

test('review advances to the next pending item in display order and wraps once', () => {
  const list = queue();
  assert.equal(nextPending(list, 'a').id, 'b');
  assert.equal(nextPending(list, 'b').id, 'd'); // skips the confirmed item
  assert.equal(nextPending(list, 'd').id, 'a'); // wraps
  assert.equal(nextPending(list, 'a', -1).id, 'd');
  assert.equal(nextPending([list[0]], 'a'), null);
  assert.equal(nextPending(list, 'missing').id, 'a');
});

test('CSV export neutralizes spreadsheet formulas and keeps review notes', () => {
  const [event] = queue();
  const csv = queueCSV([{...reviewEvent([event], event.id, 'dismissed', '=HYPERLINK("x")')[0]}]);
  assert.match(csv, /^"event_id","status"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.ok(csv.endsWith('\r\n'));
});

test('bulk dismissal undo restores only entries still carrying that decision', () => {
  const events = queue();
  const result = dismissPending(events, ['a', 'b', 'c'], 'bulk', '2026-10-31T00:00:00.000Z');
  assert.deepEqual(result.previous.map(e => e.id), ['a', 'b']); // confirmed c is unchanged
  const later = reviewEvent(result.events, 'b', 'dismissed', 'checked footage');
  const restored = restorePending(later, result);
  assert.equal(restored.find(e => e.id === 'a').status, 'pending');
  assert.equal(restored.find(e => e.id === 'b').note, 'checked footage');
  assert.equal(restored.find(e => e.id === 'c').status, 'confirmed');
});
