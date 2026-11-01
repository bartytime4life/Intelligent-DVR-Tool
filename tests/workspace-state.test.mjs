import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEvents, parseReceipt, reviewEvent, restoreSnapshot } from '../src/data.mjs';
import { mergeRecognitionEvents } from '../src/recognition.mjs';
import { recognitionFixture } from './fixtures/recognition.mjs';
import { workspaceFromHash, readWorkspace, writeWorkspace, preserveUnreadable, unreadableKey, reviewExport, parseReviewExport, resetSamples } from '../src/workspace-state.mjs';
import { outsideDialog, backdropDismiss } from '../src/dialog-dismiss.mjs';

const imported = () => parseReceipt(recognitionFixture().receipt);
test('receipt reimport preserves human decisions, notes and review time', () => {
  const reviewed = reviewEvent(imported(), imported()[0].id, 'dismissed', 'Checked source recording');
  assert.deepEqual(mergeRecognitionEvents(reviewed, imported()), reviewed);
});
test('a fully cleared queue accepts a maximum 1000-observation run and remains restorable', () => {
  const events = Array.from({length:1000}, (_, i) => ({...imported()[0], id:`import-${i}`}));
  assert.equal(mergeRecognitionEvents([], events).length, 1000);
  assert.throws(() => mergeRecognitionEvents(initialEvents, events), /1,000/);
  assert.deepEqual(parseReviewExport(reviewExport(events)), events);
  assert.deepEqual(restoreSnapshot('dvr.events.v1', [], initialEvents), []);
});
test('sample insertions and resets refuse overflow without dropping model observations', () => {
  const events = Array.from({length:1000}, (_, i) => ({...imported()[0], id:`import-${i}`}));
  const before = structuredClone(events);
  assert.throws(() => mergeRecognitionEvents(events, [initialEvents[0]]), /1,000/);
  assert.throws(() => resetSamples(events), /1,000/);
  assert.deepEqual(events, before);
});
test('sample reset retains imported and reviewed sample decisions', () => {
  const reviewed = reviewEvent(initialEvents, initialEvents[0].id, 'confirmed', 'sample note');
  const saved = mergeRecognitionEvents(reviewed, imported());
  const reset = resetSamples(saved);
  assert.deepEqual(reset.find(e => e.id === reviewed[0].id), reviewed[0]);
  assert.deepEqual(reset.find(e => e.mode === 'offline-model'), imported()[0]);
});
test('restore and undo merge with later decisions instead of overwriting them', () => {
  const backup = parseReviewExport(reviewExport(imported()));
  const current = reviewEvent(imported(), imported()[0].id, 'confirmed', 'later decision');
  assert.deepEqual(mergeRecognitionEvents(current, backup), current);
});
test('same observation ID with changed source, model or observation fields is rejected atomically', () => {
  const existing = imported();
  for (const changed of [
    {...existing[0], rule:'different rule'},
    {...existing[0], cameraName:'different camera'},
    {...existing[0], score:.3},
    {...existing[0], provenance:{...existing[0].provenance, source_sha256:'f'.repeat(64)}},
    {...existing[0], provenance:{...existing[0].provenance, model_sha256:'f'.repeat(64)}},
  ]) assert.throws(() => mergeRecognitionEvents(existing, [changed]), /conflicts/);
  assert.deepEqual(existing, imported());
});
test('review restoration rejects malformed, duplicated and misbound saved evidence', () => {
  for (const events of [[...imported(), ...imported()], [{...imported()[0], camera:1}], [{...initialEvents[0], camera:99}], [{...imported()[0], note:'x'.repeat(2001)}]]) {
    assert.throws(() => parseReviewExport(reviewExport(events)), /valid review export/);
  }
  assert.throws(() => parseReviewExport({schema:'other',events:[]}), /valid/);
});
test('corrupt or unavailable storage is reported without replacing the saved entry', () => {
  const storage = {getItem:() => '{broken', setItem:() => { throw Error('must not write'); }};
  const loaded = readWorkspace(storage, 'dvr.events.v1', initialEvents);
  assert.match(loaded.error, /kept as a browser backup/);
  assert.equal(loaded.raw, '{broken');
  assert.match(readWorkspace({getItem:() => {throw Error('denied');}}, 'dvr.events.v1', []).error, /could not be loaded/);
  assert.match(writeWorkspace(storage, 'dvr.events.v1', imported()), /only in memory/);
  const full = {getItem:() => null, setItem:() => { throw Error('quota'); }};
  assert.equal(preserveUnreadable(full, 'dvr.events.v1', loaded.raw), false);
});
test('the first unreadable entry is backed up once before replacement', () => {
  const map = new Map(), storage = {getItem:k => map.get(k) ?? null, setItem:(k,v) => map.set(k,v)};
  assert.equal(preserveUnreadable(storage, 'dvr.rules.v1', '{first'), true);
  assert.equal(preserveUnreadable(storage, 'dvr.rules.v1', '{second'), true);
  assert.equal(map.get(unreadableKey('dvr.rules.v1')), '{first');
});
test('storage round trip includes empty queues and can recover after a quota error', () => {
  const map = new Map(), storage = {getItem:k => map.get(k) ?? null, setItem:(k,v) => map.set(k,v)};
  assert.equal(writeWorkspace(storage, 'dvr.events.v1', []), '');
  assert.deepEqual(readWorkspace(storage, 'dvr.events.v1', initialEvents), {value:[],error:''});
});
test('dialogs dismiss only for presses that start and end on the backdrop', () => {
  const dialog = {dataset:{}, getBoundingClientRect:() => ({left:100, right:500, top:100, bottom:400})};
  const at = (x, y, target = dialog) => ({currentTarget:dialog, target, clientX:x, clientY:y});
  assert.equal(outsideDialog(at(110, 110)), false); // the dialog's own padding
  assert.equal(outsideDialog(at(20, 20)), true);
  assert.equal(outsideDialog(at(20, 20, {})), false);
  let closed = 0;
  const props = backdropDismiss(() => closed++);
  props.onPointerDown(at(200, 200)); props.onClick(at(20, 20)); // a selection dragged out of the dialog
  props.onPointerDown(at(20, 20)); props.onClick(at(200, 200));
  assert.equal(closed, 0);
  props.onPointerDown(at(20, 20)); props.onClick(at(30, 30));
  assert.equal(closed, 1);
});
test('every workspace has a bookmark while skip links remain local anchors', () => {
  for(const name of ['Monitor','Recognition','Train','Facility','Events','Zones','System','Settings']) assert.equal(workspaceFromHash(`#${name.toLowerCase()}`), name);
  assert.equal(workspaceFromHash('#workspace'), null);
  assert.equal(workspaceFromHash('#untrusted'), null);
});

test('restored or undone human reviews replace matching pending entries only', () => {
  for (const pending of [initialEvents, imported()]) {
    const restored = reviewEvent(pending, pending[0].id, 'confirmed', 'Exported decision');
    const merged = mergeRecognitionEvents(pending, parseReviewExport(reviewExport(restored)));
    assert.deepEqual(merged[0], restored[0]);
    const later = reviewEvent(pending, pending[0].id, 'dismissed', 'Newer decision');
    assert.deepEqual(mergeRecognitionEvents(later, restored)[0], later[0]);
  }
});
test('root history entry restores Monitor while the skip link leaves the workspace alone', () => {
  assert.equal(workspaceFromHash(''), 'Monitor');
  assert.equal(workspaceFromHash('#workspace'), null);
});
