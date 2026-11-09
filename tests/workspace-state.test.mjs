import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEvents, initialRules, parseReceipt, reviewEvent, restoreSnapshot } from '../src/data.mjs';
import { mergeRecognitionEvents } from '../src/recognition.mjs';
import { recognitionFixture } from './fixtures/recognition.mjs';
import { workspaceFromHash, readWorkspace, writeWorkspace, preserveUnreadable, unreadableKey, reviewExport, parseReviewExport, resetSamples, pauseHiddenPlayback } from '../src/workspace-state.mjs';
import { outsideDialog, backdropDismiss } from '../src/dialog-dismiss.mjs';
import { createWorkspaceSave, MAX_WORKSPACE_BACKUPS, workspaceBackupKey } from '../src/workspace-save.mjs';

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
test('sample review exports refuse optional fields that would crash event consumers',()=>{
  for(const patch of [{provenance:{source_sha256:1}},{cameraName:{}},{seconds:'wrong'}])
    assert.throws(()=>parseReviewExport(reviewExport([{...initialEvents[0],...patch}])));
});
test('all file players pause when hidden, including a player started in a hidden page',()=>{
  const listeners=new Map();let paused=0;
  const documentRef={hidden:false,querySelectorAll:()=>[{srcObject:null,pause:()=>paused++},{srcObject:{},pause:()=>assert.fail('camera has its own lifecycle')}],
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const stop=pauseHiddenPlayback(documentRef);
  assert.equal(paused,0);documentRef.hidden=true;listeners.get('visibilitychange')();listeners.get('play')();
  assert.equal(paused,2);stop();assert.equal(listeners.size,0);
});

const saveHarness = (raw = JSON.stringify(imported())) => {
  const key = 'dvr.events.v1', map = new Map(raw === null ? [] : [[key, raw]]);
  let failWrites = false, failReads = false;
  const storage = {
    getItem:name => {if (failReads) throw Error('permission'); return map.get(name) ?? null;},
    setItem:(name, value) => {if (failWrites) throw Error('quota'); map.set(name, value);},
    removeItem:name => {if (failWrites) throw Error('permission'); map.delete(name);},
  };
  return {key, map, storage, failWrites:value => {failWrites=value;}, failReads:value => {failReads=value;},
    session:createWorkspaceSave(storage, key, [], {withLock:work => work()})};
};
const changedReview = (events, status = 'confirmed', note = 'This tab') => reviewEvent(events, events[0].id, status, note);
const backupValues = harness => [...harness.map].filter(([key]) => key.startsWith(`${harness.key}.conflict-backup.`)).map(([,raw]) => JSON.parse(raw).raw);

test('successive review decisions preserve the last edit while its shared save lock is pending', async () => {
  const [base]=imported(), events=['a','b','c'].map(id=>({...base,id:`import-${id}`,sourceId:id}));
  const h=saveHarness(JSON.stringify(events));let release, delay=false;
  const barrier=new Promise(resolve=>{release=resolve;});
  const session=createWorkspaceSave(h.storage,h.key,[],{withLock:work=>delay ? barrier.then(work) : Promise.resolve().then(work)});
  session.update(previous=>reviewEvent(previous,'import-a','confirmed',''));
  assert.equal(await session.flush(),true);
  session.update(previous=>reviewEvent(previous,'import-c','dismissed','cd'));
  assert.equal(await session.flush(),true);
  delay=true;
  session.update(previous=>reviewEvent(previous,'import-b','dismissed',''));
  const saving=session.flush();
  const statuses=value=>Object.fromEntries(value.map(event=>[event.id,event.status]));
  const finished={'import-a':'confirmed','import-b':'dismissed','import-c':'dismissed'};
  // Rendering the last decision does not imply that the async lock has committed it.
  assert.deepEqual(statuses(session.snapshot().value),finished);
  assert.equal(session.snapshot().hasUnsavedChanges,true);
  assert.deepEqual(statuses(JSON.parse(h.map.get(h.key))),{...finished,'import-b':'pending'});
  release();assert.equal(await saving,true);
  assert.deepEqual(statuses(JSON.parse(h.map.get(h.key))),finished);
  assert.equal(JSON.parse(h.map.get(h.key)).find(event=>event.id==='import-c').note,'cd');
  assert.equal(session.snapshot().hasUnsavedChanges,false);
});

test('several review edits queued before a shared lock opens persist without replacing each other', async () => {
  const [base]=imported(), events=['a','b','c'].map(id=>({...base,id:`import-${id}`,sourceId:id}));
  const h=saveHarness(JSON.stringify(events));let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const session=createWorkspaceSave(h.storage,h.key,[],{withLock:work=>barrier.then(work)});
  const saves=[];
  for (const [id,status,note] of [['import-a','confirmed',''],['import-c','dismissed','cd'],['import-b','dismissed','']]) {
    session.update(previous=>reviewEvent(previous,id,status,note));saves.push(session.flush());
  }
  release();await Promise.all(saves);
  const persisted=JSON.parse(h.map.get(h.key));
  assert.deepEqual(persisted.map(event=>event.status),['confirmed','dismissed','dismissed']);
  assert.equal(persisted.find(event=>event.id==='import-c').note,'cd');
  assert.equal(session.snapshot().hasUnsavedChanges,false);
});

test('clean tabs adopt validated saves and removals without writing them back', async () => {
  const h = saveHarness(), remote = changedReview(imported(), 'dismissed', 'Other tab');
  h.map.set(h.key, JSON.stringify(remote)); h.session.receive();
  assert.deepEqual(h.session.snapshot().value, remote);
  assert.equal(h.session.snapshot().hasUnsavedChanges, false);
  assert.equal(await h.session.flush(), false);
  h.map.delete(h.key); h.session.receive();
  assert.deepEqual(h.session.snapshot().value, []);
  assert.equal(h.map.has(h.key), false);
});
test('quota-failed local reviews survive another tab save and further local edits', async () => {
  const h = saveHarness(), local = changedReview(imported());
  h.failWrites(true); h.session.update(local); assert.equal(await h.session.flush(), false);
  const remote = changedReview(imported(), 'dismissed', 'Other tab');
  h.map.set(h.key, JSON.stringify(remote)); h.session.receive();
  assert.deepEqual(h.session.snapshot().value, local);
  assert.match(h.session.snapshot().error, /only in memory/);
  assert.equal(h.session.snapshot().conflict.remoteRaw, JSON.stringify(remote));
  const later = changedReview(local, 'confirmed', 'More local work');
  h.failWrites(false); h.session.update(later);
  assert.equal(await h.session.flush(), false);
  assert.deepEqual(h.session.snapshot().value, later);
  assert.match(h.session.snapshot().conflict.localRaw, /More local work/);
  assert.equal(h.map.get(h.key), JSON.stringify(remote));
  assert.equal(h.session.snapshot().hasUnsavedChanges, true);
});
test('unsaved edits detect a competing write before their first save effect', async () => {
  const h = saveHarness(), local = changedReview(imported()), remote = changedReview(imported(), 'dismissed');
  h.session.update(local); h.map.set(h.key, JSON.stringify(remote));
  assert.equal(await h.session.flush(), false);
  assert.deepEqual(h.session.snapshot().value, local);
  assert.deepEqual(h.session.snapshot().conflict.remoteValue, remote);
  assert.equal(h.map.get(h.key), JSON.stringify(remote));
});
test('keeping this tab preserves the displaced remote snapshot before saving', async () => {
  const h = saveHarness(), local = changedReview(imported()), remote = changedReview(imported(), 'dismissed');
  h.session.update(local); h.map.set(h.key, JSON.stringify(remote)); h.session.receive();
  assert.equal(await h.session.snapshot().conflict.keepLocal(), true);
  assert.equal(h.map.get(h.key), JSON.stringify(local));
  assert.ok(backupValues(h).includes(JSON.stringify(remote)));
  assert.equal(h.session.snapshot().conflict, null);
  assert.equal(h.session.snapshot().hasUnsavedChanges, false);
});
test('using the other tab preserves this tab before adopting its decisions', async () => {
  const h = saveHarness(), local = changedReview(imported()), remote = changedReview(imported(), 'dismissed');
  h.session.update(local); h.map.set(h.key, JSON.stringify(remote)); h.session.receive();
  assert.equal(await h.session.snapshot().conflict.useRemote(), true);
  assert.deepEqual(h.session.snapshot().value, remote);
  assert.ok(backupValues(h).includes(JSON.stringify(local)));
  assert.equal(h.session.snapshot().hasUnsavedChanges, false);
});
test('failed backup keeps both conflict versions and does not report resolution', async () => {
  for (const choice of ['keepLocal', 'useRemote']) {
    const h = saveHarness(), local = changedReview(imported()), remote = changedReview(imported(), 'dismissed');
    h.session.update(local); h.map.set(h.key, JSON.stringify(remote)); h.session.receive(); h.failWrites(true);
    assert.equal(await h.session.snapshot().conflict[choice](), false);
    assert.equal(h.map.get(h.key), JSON.stringify(remote));
    assert.deepEqual(h.session.snapshot().value, local);
    assert.ok(h.session.snapshot().conflict);
    assert.match(h.session.snapshot().error, /only in memory/);
  }
});
test('explicit choices refuse stale remote snapshots and refresh the conflict first', async () => {
  for (const choice of ['keepLocal', 'useRemote']) {
    const h = saveHarness(), local = changedReview(imported());
    h.session.update(local); h.map.set(h.key, JSON.stringify(changedReview(imported(), 'dismissed', 'First remote'))); h.session.receive();
    const originalChoice = h.session.snapshot().conflict[choice];
    const newer = changedReview(imported(), 'dismissed', 'Newer remote'); h.map.set(h.key, JSON.stringify(newer));
    assert.equal(await originalChoice(), false);
    assert.equal(h.map.get(h.key), JSON.stringify(newer));
    assert.deepEqual(h.session.snapshot().value, local);
    assert.deepEqual(h.session.snapshot().conflict.remoteValue, newer);
  }
});
test('a write during backup is detected before the conflict choice replaces anything', async () => {
  const h = saveHarness(), local = changedReview(imported()), newer = changedReview(imported(), 'dismissed', 'Racing save');
  h.session.update(local); h.map.set(h.key, JSON.stringify(changedReview(imported(), 'dismissed'))); h.session.receive();
  const original = h.storage.setItem;
  h.storage.setItem = (key, raw) => {original(key, raw); if (key.includes('.conflict-backup.')) h.map.set(h.key, JSON.stringify(newer));};
  assert.equal(await h.session.snapshot().conflict.keepLocal(), false);
  assert.equal(h.map.get(h.key), JSON.stringify(newer));
  assert.deepEqual(h.session.snapshot().conflict.remoteValue, newer);
});
test('clear/remove with unsaved work requires explicit reset and retains a backup', async () => {
  const h = saveHarness(), local = changedReview(imported());
  h.session.update(local); h.map.clear(); h.session.receive();
  assert.deepEqual(h.session.snapshot().value, local);
  assert.equal(h.session.snapshot().conflict.remoteDeleted, true);
  assert.equal(await h.session.snapshot().conflict.useRemote(), true);
  assert.deepEqual(h.session.snapshot().value, []);
  assert.ok(backupValues(h).includes(JSON.stringify(local)));
  assert.equal(h.map.has(h.key), false);
});
test('invalid remote data is preserved and cannot replace a valid local workspace', async () => {
  const h = saveHarness(), local = h.session.snapshot().value;
  h.map.set(h.key, '{invalid remote'); h.session.receive();
  assert.equal(h.session.snapshot().conflict.remoteValid, false);
  assert.equal(await h.session.snapshot().conflict.useRemote(), false);
  assert.deepEqual(h.session.snapshot().value, local);
  assert.equal(await h.session.snapshot().conflict.keepLocal(), true);
  assert.ok(backupValues(h).includes('{invalid remote'));
});
test('unreadable startup data is protected without marking untouched defaults unsaved', async () => {
  const h = saveHarness('{broken');
  assert.equal(h.session.snapshot().hasUnsavedChanges, false);
  assert.equal(await h.session.flush(), false);
  h.map.set(unreadableKey(h.key), '{earlier broken'); h.session.update(imported());
  h.failWrites(true); assert.equal(await h.session.flush(), false);
  assert.equal(h.map.get(h.key), '{broken');
  h.failWrites(false); assert.equal(await h.session.flush(), true);
  assert.equal(h.map.get(unreadableKey(h.key)), '{earlier broken');
  assert.ok(backupValues(h).includes('{broken'));
});
test('occupied backup slots never overwrite an earlier saved version', async () => {
  const h = saveHarness(), remote = changedReview(imported(), 'dismissed');
  for (let i=1; i<=MAX_WORKSPACE_BACKUPS; i++) h.map.set(workspaceBackupKey(h.key, i), `saved backup ${i}`);
  const before = new Map(h.map);
  h.session.update(changedReview(imported())); h.map.set(h.key, JSON.stringify(remote)); h.session.receive();
  assert.equal(await h.session.snapshot().conflict.keepLocal(), false);
  assert.match(h.session.snapshot().error, /10 browser conflict backups/);
  for (let i=1; i<=MAX_WORKSPACE_BACKUPS; i++) assert.equal(h.map.get(workspaceBackupKey(h.key, i)), before.get(workspaceBackupKey(h.key, i)));
  assert.equal(h.map.get(h.key), JSON.stringify(remote));
});

test('download then remove one reviewed backup frees a full store for an explicit choice', async () => {
  const h=saveHarness(), remote=changedReview(imported(),'dismissed'), local=changedReview(imported());
  for (let slot=1;slot<=MAX_WORKSPACE_BACKUPS;slot++) h.map.set(workspaceBackupKey(h.key,slot), `original saved bytes ${slot}`);
  h.session.update(local);h.map.set(h.key,JSON.stringify(remote));h.session.receive();
  assert.equal(await h.session.snapshot().conflict.keepLocal(),false);
  const before=new Map(h.map), first=h.session.snapshot().conflict.savedCopies.copies[0];
  assert.equal(first.downloaded,false);
  assert.equal(await first.remove(),false); // UI and save layer both require the download action.
  assert.equal(h.map.size,before.size);
  const downloadedBytes=first.raw;
  assert.equal(downloadedBytes,before.get(workspaceBackupKey(h.key,1)));
  assert.equal(first.markDownloaded(),true);
  assert.equal(h.session.snapshot().conflict.savedCopies.copies[0].downloaded,true);
  assert.equal(await first.remove(),true);
  assert.equal(h.map.has(workspaceBackupKey(h.key,1)),false);
  for (let slot=2;slot<=MAX_WORKSPACE_BACKUPS;slot++) assert.equal(h.map.get(workspaceBackupKey(h.key,slot)),before.get(workspaceBackupKey(h.key,slot)));
  assert.equal(h.map.get(h.key),JSON.stringify(remote));
  assert.deepEqual(h.session.snapshot().value,local);
  assert.ok(h.session.snapshot().conflict);
  assert.equal(await h.session.snapshot().conflict.keepLocal(),true);
  assert.equal(h.map.get(h.key),JSON.stringify(local));
  assert.equal(JSON.parse(h.map.get(workspaceBackupKey(h.key,1))).raw,JSON.stringify(remote));
});

test('a downloaded backup changed while removal waits for the lock cannot be deleted', async () => {
  const h=saveHarness();let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const session=createWorkspaceSave(h.storage,h.key,[],{withLock:async work=>{await barrier;return work();}});
  const name=workspaceBackupKey(h.key,1);h.map.set(name,'downloaded original bytes');
  session.update(changedReview(imported()));h.map.set(h.key,JSON.stringify(changedReview(imported(),'dismissed')));session.receive();
  const copy=session.snapshot().conflict.savedCopies.copies[0];assert.equal(copy.markDownloaded(),true);
  const removing=copy.remove();h.map.set(name,'new bytes in reused slot');release();
  assert.equal(await removing,false);
  assert.equal(h.map.get(name),'new bytes in reused slot');
  assert.match(session.snapshot().error,/saved copy changed/);
  const updated=session.snapshot().conflict.savedCopies.copies[0];assert.equal(updated.downloaded,false);
  assert.equal(await updated.remove(),false);
  assert.equal(updated.markDownloaded(),true);
  assert.equal(await updated.remove(),true);
});

test('failed backup removal preserves both versions and every saved copy for retry', async () => {
  const h=saveHarness(), name=workspaceBackupKey(h.key,1), remote=changedReview(imported(),'dismissed'), local=changedReview(imported());
  h.map.set(name,'preserve exact unreadable backup bytes');h.session.update(local);h.map.set(h.key,JSON.stringify(remote));h.session.receive();
  const copy=h.session.snapshot().conflict.savedCopies.copies[0];assert.equal(copy.markDownloaded(),true);
  h.failWrites(true);assert.equal(await copy.remove(),false);
  assert.equal(h.map.get(name),copy.raw);assert.equal(h.map.get(h.key),JSON.stringify(remote));
  assert.deepEqual(h.session.snapshot().value,local);assert.match(h.session.snapshot().error,/only in memory/);
  h.failWrites(false);assert.equal(await copy.remove(),true);
  assert.equal(await h.session.snapshot().conflict.keepLocal(),true);
});

test('a stale download action cannot authorize removal of a replacement saved copy', async () => {
  const h=saveHarness(), name=workspaceBackupKey(h.key,1);h.map.set(name,'original backup');
  h.session.update(changedReview(imported()));h.map.set(h.key,JSON.stringify(changedReview(imported(),'dismissed')));h.session.receive();
  const stale=h.session.snapshot().conflict.savedCopies.copies[0];h.map.set(name,'updated backup');
  assert.equal(stale.markDownloaded(),false);assert.equal(await stale.remove(),false);
  assert.equal(h.map.get(name),'updated backup');
  assert.equal(h.session.snapshot().conflict.savedCopies.copies[0].downloaded,false);
});

test('freeing a backup slot never bypasses a newer primary version check', async () => {
  const h=saveHarness(), name=workspaceBackupKey(h.key,1), newer=changedReview(imported(),'dismissed','Newest other tab');
  h.map.set(name,'archived backup');h.session.update(changedReview(imported()));h.map.set(h.key,JSON.stringify(changedReview(imported(),'dismissed')));h.session.receive();
  const conflict=h.session.snapshot().conflict, copy=conflict.savedCopies.copies[0];copy.markDownloaded();
  h.map.set(h.key,JSON.stringify(newer));assert.equal(await copy.remove(),true);
  assert.equal(await conflict.keepLocal(),false);assert.equal(h.map.get(h.key),JSON.stringify(newer));
  assert.deepEqual(h.session.snapshot().conflict.remoteValue,newer);
});
test('a startup read failure never grants permission to overwrite newly readable data', async () => {
  const h = saveHarness(), storage = {...h.storage, getItem:() => {throw Error('permission');}};
  const session = createWorkspaceSave(storage, h.key, [], {withLock:work => work()});
  assert.equal(session.snapshot().hasUnsavedChanges, false);
  session.update(changedReview(imported()));
  storage.getItem = h.storage.getItem;
  assert.equal(await session.flush(), false);
  assert.deepEqual(session.snapshot().conflict.remoteValue, imported());
});
test('simultaneous tabs preserve different local backups in separate coordinated slots', async () => {
  const h = saveHarness(); let tail = Promise.resolve(), entries = 0;
  const withLock = work => {
    const result = tail.then(() => {entries++; return work();});
    tail = result.catch(() => {}); return result;
  };
  const a = createWorkspaceSave(h.storage, h.key, [], {withLock}), b = createWorkspaceSave(h.storage, h.key, [], {withLock});
  const localA = changedReview(imported(), 'confirmed', 'Tab A'), localB = changedReview(imported(), 'confirmed', 'Tab B');
  a.update(localA); b.update(localB);
  const remote = changedReview(imported(), 'dismissed', 'Shared remote'); h.map.set(h.key, JSON.stringify(remote));
  a.receive(); b.receive();
  assert.deepEqual(await Promise.all([a.snapshot().conflict.useRemote(), b.snapshot().conflict.useRemote()]), [true, true]);
  assert.equal(entries, 2);
  assert.equal(backupValues(h).length, 2);
  assert.ok(backupValues(h).includes(JSON.stringify(localA)));
  assert.ok(backupValues(h).includes(JSON.stringify(localB)));
});
test('competing save choices serialize and require a fresh choice for the changed primary', async () => {
  const h = saveHarness(); let tail = Promise.resolve();
  const withLock = work => {const result=tail.then(work); tail=result.catch(()=>{}); return result;};
  const a = createWorkspaceSave(h.storage, h.key, [], {withLock}), b = createWorkspaceSave(h.storage, h.key, [], {withLock});
  const localA=changedReview(imported(), 'confirmed', 'Tab A'), localB=changedReview(imported(), 'confirmed', 'Tab B');
  a.update(localA); b.update(localB);
  const remote=changedReview(imported(), 'dismissed', 'Remote'); h.map.set(h.key, JSON.stringify(remote)); a.receive(); b.receive();
  assert.deepEqual(await Promise.all([a.snapshot().conflict.keepLocal(), b.snapshot().conflict.keepLocal()]), [true, false]);
  assert.equal(h.map.get(h.key), JSON.stringify(localA));
  assert.deepEqual(b.snapshot().value, localB);
  assert.equal(await b.snapshot().conflict.keepLocal(), true);
  assert.equal(h.map.get(h.key), JSON.stringify(localB));
  assert.ok(backupValues(h).includes(JSON.stringify(remote)));
  assert.ok(backupValues(h).includes(JSON.stringify(localA)));
});
test('an edit while a conflict choice waits for the lock requires another explicit choice', async () => {
  const h=saveHarness(); let release;
  const barrier=new Promise(resolve=>{release=resolve;});
  const session=createWorkspaceSave(h.storage,h.key,[],{withLock:async work=>{await barrier; return work();}});
  session.update(changedReview(imported())); h.map.set(h.key,JSON.stringify(changedReview(imported(),'dismissed'))); session.receive();
  const choosing=session.snapshot().conflict.useRemote();
  const latest=changedReview(session.snapshot().value,'confirmed','Edited while waiting'); session.update(latest); release();
  assert.equal(await choosing,false);
  assert.deepEqual(session.snapshot().value,latest);
  assert.ok(session.snapshot().conflict);
  assert.equal(backupValues(h).length,0);
});
test('save coordination unavailable leaves edits exportable and never writes', async () => {
  const h=saveHarness(), session=createWorkspaceSave(h.storage,h.key,[],{withLock:null});
  const before=h.map.get(h.key), local=changedReview(imported()); session.update(local);
  assert.equal(await session.flush(),false);
  assert.equal(h.map.get(h.key),before);
  assert.deepEqual(session.snapshot().value,local);
  assert.match(session.snapshot().error,/cannot coordinate/);
  assert.equal(session.snapshot().hasUnsavedChanges,true);
});
test('zone-rule edits receive the same failed-save conflict protection', async () => {
  const key='dvr.rules.v1', map=new Map([[key,JSON.stringify(initialRules)]]); let fail=true;
  const storage={getItem:name=>map.get(name)??null,setItem:(name,raw)=>{if(fail)throw Error('permission');map.set(name,raw);}};
  const session=createWorkspaceSave(storage,key,initialRules,{withLock:work=>work()});
  const local=initialRules.map((rule,i)=>i===0?{...rule,threshold:.6}:rule);
  session.update(local); assert.equal(await session.flush(),false);
  const remote=initialRules.map((rule,i)=>i===1?{...rule,threshold:.8}:rule); map.set(key,JSON.stringify(remote)); session.receive();
  assert.deepEqual(session.snapshot().value,local);
  assert.deepEqual(session.snapshot().conflict.remoteValue,remote);
  fail=false; assert.equal(await session.snapshot().conflict.keepLocal(),true);
  assert.deepEqual(JSON.parse(map.get(key)),local);
});
