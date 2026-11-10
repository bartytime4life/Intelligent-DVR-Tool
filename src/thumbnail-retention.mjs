import { restoreSnapshot } from './data.mjs';
import { observationImageKey, pruneImages } from './local-images.mjs';
import { MAX_WORKSPACE_BACKUPS, workspaceBackupKey } from './workspace-save.mjs';
import { unreadableKey } from './workspace-state.mjs';

const REVIEWS = 'dvr.events.v1';
export const THUMBNAIL_REFERENCES_LOCK = 'intelligent-dvr.thumbnail-references';
export const THUMBNAIL_PRUNE_LOCK = 'intelligent-dvr.thumbnail-prune';
// The same lock used by createWorkspaceSave for the committed review queue.
export const REVIEWS_SAVE_LOCK = `intelligent-dvr.workspace-save:${REVIEWS}`;

function storedReferences(storage) {
  const events = [];
  const add = raw => {
    if (raw === null) return;
    const value = restoreSnapshot(REVIEWS, JSON.parse(raw), null);
    if (!value) throw Error('Unreadable review references');
    events.push(...value);
  };
  add(storage.getItem(REVIEWS));
  add(storage.getItem(unreadableKey(REVIEWS)));
  for (let slot = 1; slot <= MAX_WORKSPACE_BACKUPS; slot++) {
    const raw = storage.getItem(workspaceBackupKey(REVIEWS, slot));
    if (raw === null) continue;
    const copy = JSON.parse(raw);
    if (copy.schema !== 'intelligent-dvr.workspace-backup.v1' || copy.key !== REVIEWS || typeof copy.raw !== 'string')
      throw Error('Unreadable saved-copy references');
    add(copy.raw);
  }
  return events;
}

// Each mounted App holds a shared lease, including hidden/suspended tabs. No
// expiry can establish that another tab has released its Undo or unsaved work.
export function createThumbnailRetention({ storage, locks = globalThis.navigator?.locks, prune = pruneImages } = {}) {
  let closed = false, shared = null, pruning = false, enabled = typeof locks?.request === 'function';
  const lifetime = new AbortController();
  let finishLifetime;
  const finished = new Promise(resolve => { finishLifetime = resolve; });
  function acquire() {
    let grant, refuse, release;
    const granted = new Promise((resolve, reject) => { grant = resolve; refuse = reject; });
    const held = new Promise(resolve => { release = resolve; });
    const lease = { release, granted, done: null };
    try {
      lease.done = Promise.resolve(locks.request(THUMBNAIL_REFERENCES_LOCK, {mode:'shared', signal:lifetime.signal}, async () => {
        if (closed) { refuse(new DOMException('Closed', 'AbortError')); return; }
        shared = lease; grant();
        await held;
        if (shared === lease) shared = null;
      }));
    } catch (error) { lease.done = Promise.reject(error); }
    lease.done.catch(refuse);
    return lease;
  }
  const ready = enabled ? acquire().granted.then(() => ({ok:true}), () => ({ok:false,
    error:'Shared image protection could not be opened. Reload to try again; saved browser data has not been changed.'}))
    : Promise.resolve({ok:true});

  return {
    ready,
    async prune(getLocalReferences) {
      if (!enabled || closed || pruning || !shared) return false;
      pruning = true;
      try {
        return await locks.request(THUMBNAIL_PRUNE_LOCK, {mode:'exclusive', ifAvailable:true}, async attempt => {
          if (!attempt || closed || !shared) return false;
          // Without this mutex two peers could both drop their shared leases,
          // allowing either to prune the other's still-referenced images.
          const lease = shared;
          lease.release(); await lease.done;
          try {
            return await locks.request(THUMBNAIL_REFERENCES_LOCK, {mode:'exclusive', ifAvailable:true}, async exclusive => {
              if (!exclusive || closed) return false;
              return locks.request(REVIEWS_SAVE_LOCK, {mode:'exclusive', ifAvailable:true}, async saved => {
                if (!saved || closed) return false;
                let persisted;
                try { persisted = storedReferences(storage); } catch { return false; }
                const keep = new Set(persisted.flatMap(event => [event.id, observationImageKey(event)]));
                let localReferences, localKeys = new Set();
                // Local edits can arrive while IndexedDB's cursor is running.
                // Re-read their references for each deletion, not only at start.
                const liveKeep = {has(key) {
                  if (closed || keep.has(key)) return true;
                  try {
                    const current = getLocalReferences();
                    if (current !== localReferences) {
                      localKeys = new Set(current.flatMap(event => [event.id, observationImageKey(event)]));
                      localReferences = current;
                    }
                    return localKeys.has(key);
                  } catch { return true; }
                }};
                await prune('thumbnails', liveKeep);
                return true;
              });
            });
          } finally {
            if (!closed) {
              try { await acquire().granted; }
              catch {
                // A failed reacquisition must not expose this mounted App's
                // references. Keep the prune mutex until the App closes.
                enabled = false;
                await finished;
              }
            }
          }
        });
      } catch { return false; }
      finally { pruning = false; }
    },
    close() {
      closed = true; lifetime.abort(); shared?.release(); finishLifetime();
    },
  };
}
