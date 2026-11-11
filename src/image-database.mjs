// Bounded access to this browser's still-image database. A timed-out operation
// never reports success later, even if the browser committed before notifying us.
export const STORES = ['thumbnails','zone-stills'];
export const IMAGE_STORAGE_TIMEOUT_MS = 5000;
const timedOut = () => Error('Image storage did not finish in time');

export function createImageDatabase({getIndexedDB = () => globalThis.indexedDB,
  timeoutMs = IMAGE_STORAGE_TIMEOUT_MS, now = () => performance.now(), timers = globalThis} = {}) {
  let connection = null, opening = null;
  const close = db => { if (connection === db) connection = null; db.close(); };
  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening.promise;
    let request;
    try {
      const factory = getIndexedDB();
      if (!factory) throw Error('IndexedDB is unavailable');
      request = factory.open('intelligent-dvr',1);
    } catch (error) { return Promise.reject(error); }
    const entry = {}; opening = entry;
    entry.promise = new Promise((resolve,reject) => {
      let settled = false;
      const began = now();
      const abandon = error => {
        if (settled) return;
        settled = true; timers.clearTimeout(timer); reject(error);
      };
      const terminal = () => {
        timers.clearTimeout(timer);
        if (opening === entry) opening = null;
      };
      const timer = timers.setTimeout(() => abandon(timedOut()),timeoutMs);
      request.onupgradeneeded = () => {
        if (settled) {request.transaction.abort(); return;}
        try { for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store); }
        catch (error) {abandon(error); request.transaction.abort();}
      };
      request.onsuccess = () => {
        if (now() - began >= timeoutMs) abandon(timedOut());
        terminal();
        const db = request.result;
        if (settled) {db.close(); return;}
        settled = true; connection = db;
        db.onversionchange = () => close(db);
        db.onclose = () => {if (connection === db) connection = null;};
        resolve(db);
      };
      request.onerror = () => {terminal(); abandon(request.error || Error('Image storage could not open'));};
      // IndexedDB opens cannot be cancelled. Keep one outstanding request after
      // failure; retries fail promptly until it ends, then close any late handle.
      request.onblocked = () => abandon(Error('Image storage is blocked by another tab'));
    });
    return entry.promise;
  }
  return async function transact(store,mode,work) {
    const deadline = now() + timeoutMs;
    const db = await open();
    const remaining = deadline - now();
    if (remaining <= 0) throw timedOut();
    let tx;
    try {tx = db.transaction(store,mode);}
    catch (error) {close(db); throw error;}
    return new Promise((resolve,reject) => {
      let settled = false, value;
      const fail = error => {
        if (settled) return;
        settled = true; timers.clearTimeout(timer); reject(error);
        try {tx.abort();} catch { /* A committed transaction cannot be undone. */ }
      };
      const timer = timers.setTimeout(() => fail(timedOut()),remaining);
      try {work(tx.objectStore(store),result => {if (!settled) value = result;});}
      catch (error) {fail(error); return;}
      tx.oncomplete = () => {
        if (settled) return;
        if (now() >= deadline) {fail(timedOut()); return;}
        settled = true; timers.clearTimeout(timer); resolve(value);
      };
      tx.onerror = tx.onabort = () => fail(tx.error || Error('Image storage failed'));
    });
  };
}
