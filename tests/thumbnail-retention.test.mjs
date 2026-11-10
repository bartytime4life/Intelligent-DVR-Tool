import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailRetention, THUMBNAIL_REFERENCES_LOCK, THUMBNAIL_PRUNE_LOCK, REVIEWS_SAVE_LOCK } from '../src/thumbnail-retention.mjs';
import { observationImageKey } from '../src/local-images.mjs';
import { initialEvents } from '../src/data.mjs';
import { workspaceBackupKey } from '../src/workspace-save.mjs';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

// A generated Web Locks model: granted callbacks hold their lock until settled;
// queued exclusive requests prevent later shared requests from jumping ahead.
function lockManager() {
  const states = new Map();
  const manager = {fail:null, request(name, options, callback) {
    if (manager.fail?.(name, options)) return Promise.reject(Error('Generated lock failure'));
    const state = states.get(name) || {held:new Set(), queue:[]}; states.set(name, state);
    const compatible = mode => !state.held.size || mode === 'shared' && [...state.held].every(entry => entry.mode === 'shared');
    function pump() {
      while (state.queue.length && compatible(state.queue[0].mode)) {
        const entry = state.queue.shift(); entry.granted = true;
        entry.signal?.removeEventListener('abort', entry.aborted);
        state.held.add(entry);
        Promise.resolve().then(() => entry.callback({name, mode:entry.mode})).then(value => {
          state.held.delete(entry); pump(); entry.resolve(value);
        }, error => {state.held.delete(entry); pump(); entry.reject(error);});
        if (entry.mode !== 'shared') break;
      }
    }
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    if (options.ifAvailable && (state.queue.length || !compatible(options.mode))) return Promise.resolve().then(() => callback(null));
    return new Promise((resolve, reject) => {
      const entry = {mode:options.mode, signal:options.signal, callback, resolve, reject, granted:false};
      entry.aborted = () => {
        if (entry.granted) return;
        state.queue = state.queue.filter(candidate => candidate !== entry); reject(entry.signal.reason); pump();
      };
      entry.signal?.addEventListener('abort', entry.aborted, {once:true});
      state.queue.push(entry); pump();
    });
  }};
  return manager;
}
function fixture({locks = lockManager(), prune = async () => {}} = {}) {
  const values = new Map([['dvr.events.v1', '[]']]);
  const storage = {getItem:key => values.get(key) ?? null};
  const retention = createThumbnailRetention({storage, locks, prune});
  return {values, storage, locks, retention};
}
const event = (id = 'kept') => ({...initialEvents[0], id});

test('startup waits for an existing exclusive prune before allowing workspace reads', async () => {
  const locks = lockManager(), hold = deferred(), entered = deferred();
  const existing = locks.request(THUMBNAIL_REFERENCES_LOCK, {mode:'exclusive'}, async () => {entered.resolve(); await hold.promise;});
  await entered.promise;
  const f = fixture({locks}); let ready = false;
  const opening = f.retention.ready.then(value => {ready = value.ok;});
  await tick(); assert.equal(ready, false);
  hold.resolve(); await existing; await opening;
  assert.equal(ready, true); f.retention.close();
});

test('a peer lease protects Undo, unsaved and suspended-tab references without an expiry', async () => {
  let pruned = 0; const a = fixture({prune:async () => {pruned++;}}), b = fixture({locks:a.locks});
  await Promise.all([a.retention.ready, b.retention.ready]);
  for (let i = 0; i < 3; i++) assert.equal(await a.retention.prune(() => []), false);
  assert.equal(pruned, 0);
  b.retention.close(); await tick();
  assert.equal(await a.retention.prune(() => []), true); assert.equal(pruned, 1);
  a.retention.close();
});

test('simultaneous prune attempts cannot both release their shared leases', async () => {
  let pruned = 0; const locks = lockManager(), prune = async () => {pruned++;};
  const a = fixture({locks, prune}), b = fixture({locks, prune});
  await Promise.all([a.retention.ready, b.retention.ready]);
  assert.deepEqual(await Promise.all([a.retention.prune(() => []), b.retention.prune(() => [])]), [false, false]);
  assert.equal(pruned, 0); a.retention.close(); b.retention.close();
});

test('single-tab pruning keeps committed, Undo and archived evidence and removes only unreferenced images', async () => {
  const saved = event('saved'), undo = event('undo'), archive = event('archive'), unreadableCopy = event('older-backup');
  const records = new Set([saved, undo, archive, unreadableCopy, event('unused')].map(observationImageKey));
  const f = fixture({prune:async (store, keep) => {
    assert.equal(store, 'thumbnails');
    for (const key of records) if (!keep.has(key)) records.delete(key);
  }});
  f.values.set('dvr.events.v1', JSON.stringify([saved]));
  f.values.set('dvr.events.v1.unreadable', JSON.stringify([unreadableCopy]));
  f.values.set(workspaceBackupKey('dvr.events.v1', 1), JSON.stringify({schema:'intelligent-dvr.workspace-backup.v1',key:'dvr.events.v1',raw:JSON.stringify([archive])}));
  await f.retention.ready;
  assert.equal(await f.retention.prune(() => [undo]), true);
  assert.deepEqual([...records], [saved, undo, archive, unreadableCopy].map(observationImageKey));
  f.retention.close();
});

test('local references remain live and committed saves cannot race the IndexedDB cleanup', async () => {
  const entered = deferred(), finish = deferred(), newlyReferenced = event('arrived-during-cleanup'); let local = [], keep;
  const f = fixture({prune:async (store, referenceSet) => {keep = referenceSet; entered.resolve(); await finish.promise;}});
  await f.retention.ready;
  const cleaning = f.retention.prune(() => local); await entered.promise;
  assert.equal(keep.has(observationImageKey(newlyReferenced)), false);
  local = [newlyReferenced]; assert.equal(keep.has(observationImageKey(newlyReferenced)), true);
  assert.equal(await f.locks.request(REVIEWS_SAVE_LOCK, {mode:'exclusive',ifAvailable:true}, lock => Boolean(lock)), false);
  finish.resolve(); await cleaning; f.retention.close();
});

test('unreadable primary, backup and unavailable storage all skip destructive cleanup', async () => {
  for (const key of ['dvr.events.v1', 'dvr.events.v1.unreadable', workspaceBackupKey('dvr.events.v1', 4)]) {
    let pruned = 0; const f = fixture({prune:async () => {pruned++;}});
    f.values.set(key, '{damaged'); await f.retention.ready;
    assert.equal(await f.retention.prune(() => []), false); assert.equal(pruned, 0); f.retention.close();
  }
  const locks = lockManager(); let pruned = 0;
  const f = createThumbnailRetention({locks, storage:{getItem(){throw Error('Unavailable');}}, prune:async () => {pruned++;}});
  await f.ready; assert.equal(await f.prune(() => []), false); assert.equal(pruned, 0); f.close();
});

test('unsupported locks skip cleanup while a failed initial lock refuses unsafe startup', async () => {
  let pruned = 0; const disabled = fixture({locks:null,prune:async () => {pruned++;}});
  assert.equal((await disabled.retention.ready).ok, true);
  assert.equal(await disabled.retention.prune(() => []), false); assert.equal(pruned, 0); disabled.retention.close();
  const locks = lockManager(); locks.fail = () => true;
  const failed = fixture({locks}); assert.equal((await failed.retention.ready).ok, false);
  assert.equal(await failed.retention.prune(() => []), false); failed.retention.close();
});

test('failed lease reacquisition holds the prune mutex until the mounted App closes', async () => {
  let pruned = 0; const locks = lockManager(), f = fixture({locks,prune:async () => {pruned++;}});
  await f.retention.ready;
  let fail = true; locks.fail = (name, options) => name === THUMBNAIL_REFERENCES_LOCK && options.mode === 'shared' && fail && (fail = false, true);
  const cleaning = f.retention.prune(() => []); await tick();
  assert.equal(pruned, 1);
  assert.equal(await locks.request(THUMBNAIL_PRUNE_LOCK, {mode:'exclusive',ifAvailable:true}, lock => Boolean(lock)), false);
  const peer = fixture({locks}); await peer.retention.ready;
  assert.equal(await peer.retention.prune(() => []), false);
  f.retention.close(); await cleaning;
  assert.equal(await peer.retention.prune(() => []), true); peer.retention.close();
});

test('closing while startup waits cancels its pending shared lease', async () => {
  const locks = lockManager(), hold = deferred(), entered = deferred();
  const existing = locks.request(THUMBNAIL_REFERENCES_LOCK, {mode:'exclusive'}, async () => {entered.resolve(); await hold.promise;});
  await entered.promise;
  const f = fixture({locks}); f.retention.close(); assert.equal((await f.retention.ready).ok, false);
  hold.resolve(); await existing;
  assert.equal(await locks.request(THUMBNAIL_REFERENCES_LOCK, {mode:'exclusive',ifAvailable:true}, lock => Boolean(lock)), true);
});
