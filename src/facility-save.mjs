import {LIBRARY_KEY, loadLibrary, validateLibrary, createLibrary, persistLibrary} from './facility-library.mjs';
import {MAX_WORKSPACE_BACKUPS, workspaceBackupKey} from './workspace-save.mjs';

// Download a valid collection's original bytes directly, so JSON escaping in
// its archival envelope cannot make a near-limit collection unimportable.
export function facilityCopyDownload(raw) {
  try {
    const copy = JSON.parse(raw);
    if (copy.schema === 'intelligent-dvr.workspace-backup.v1' && copy.key === LIBRARY_KEY && typeof copy.raw === 'string') {
      validateLibrary(JSON.parse(copy.raw));
      return copy.raw;
    }
  } catch { /* Unreadable archives remain downloadable byte for byte. */ }
  return raw;
}

// Own the complete collection and its saved baseline outside React render timing.
// A queued save always uses the latest edit; separate tabs share one exclusive lock.
export function createFacilitySave(storage, {withLock, canResolve = () => true} = {}) {
  const loaded = loadLibrary(storage);
  let library = loaded.library, baseline = loaded.expectedRaw, dirty = baseline === null || loaded.blocked;
  let error = loaded.error, conflict = null, editVersion = 0, adoption = 0;
  const listeners = new Set(), downloaded = new Map();
  const emit = () => { for (const listener of listeners) listener(); };
  const coordinate = withLock === undefined ? (globalThis.navigator?.locks?.request
    ? work => navigator.locks.request(`intelligent-dvr.workspace-save:${LIBRARY_KEY}`, {mode:'exclusive'}, work) : null) : withLock;
  const unavailable = 'Facilities are only in memory. Browser storage could not save them. Export all facilities before closing, then retry saving.';
  function parse(raw) {
    try { return {value:raw === null ? createLibrary() : validateLibrary(JSON.parse(raw)), valid:true}; }
    catch { return {value:null, valid:false}; }
  }
  function capture(raw, invalidLegacy = false) {
    const remote = parse(raw);
    conflict = {remoteRaw:raw, remoteValue:remote.value, remoteValid:remote.valid && !invalidLegacy, remoteDeleted:raw === null && !invalidLegacy};
    emit();
  }
  if (loaded.blocked) capture(baseline, typeof loaded.recoveryRaw === 'string' && baseline === null);
  async function transaction(work) {
    if (!coordinate) {
      error = 'This browser cannot coordinate facility saves between tabs. Export all facilities before closing, or use a browser with shared save locking.';
      emit(); return false;
    }
    try { return await coordinate(work); }
    catch { error = unavailable; emit(); return false; }
  }
  function update(next) {
    library = validateLibrary(next); dirty = true; editVersion++; emit();
  }
  async function flush() {
    if (!dirty || conflict) return false;
    return transaction(() => {
      if (!dirty || conflict) return false;
      try {
        const raw = storage.getItem(LIBRARY_KEY);
        if (raw !== baseline) { capture(raw); return false; }
        const saved = persistLibrary(storage, library, baseline);
        library = saved.library; baseline = saved.raw; dirty = false; error = ''; emit(); return true;
      } catch (problem) { error = problem.message || unavailable; emit(); return false; }
    });
  }
  function receive() {
    try {
      const raw = storage.getItem(LIBRARY_KEY);
      if (raw !== baseline || conflict) capture(raw);
    } catch { error = unavailable; emit(); }
  }
  function backup(raw) {
    if (raw === null) return;
    let available;
    for (let slot = 1; slot <= MAX_WORKSPACE_BACKUPS; slot++) {
      const key = workspaceBackupKey(LIBRARY_KEY, slot), held = storage.getItem(key);
      if (held === null) { available ??= key; continue; }
      try { const copy = JSON.parse(held); if (copy.schema === 'intelligent-dvr.workspace-backup.v1' && copy.key === LIBRARY_KEY && copy.raw === raw) return; }
      catch { /* Unreadable copies still occupy their slots. */ }
    }
    if (!available) throw Error('All 10 browser conflict backups are occupied. Download a saved copy, then remove its browser copy before choosing a version. No facilities were replaced.');
    storage.setItem(available, JSON.stringify({schema:'intelligent-dvr.workspace-backup.v1', key:LIBRARY_KEY, raw, savedAt:new Date().toISOString()}));
  }
  async function resolve(choice, expectedRaw, expectedEdit) {
    return transaction(() => {
      if (!conflict) return false;
      try {
        if (!canResolve()) { error = 'Save or discard your preview before choosing a facility version.'; emit(); return false; }
        const raw = storage.getItem(LIBRARY_KEY);
        if (raw !== expectedRaw || editVersion !== expectedEdit) {
          error = 'A version changed while your choice was waiting. Review the updated versions, then choose again.'; capture(raw); return false;
        }
        if (choice === 'remote' && !conflict.remoteValid) return false;
        const remote = parse(raw);
        backup(choice === 'remote' ? JSON.stringify(library) : raw);
        if (storage.getItem(LIBRARY_KEY) !== raw) {
          error = 'The saved version changed. Review the updated versions, then choose again.'; capture(storage.getItem(LIBRARY_KEY)); return false;
        }
        if (choice === 'remote' && raw !== null) {
          library = remote.value; baseline = raw; adoption++;
        } else {
          const saved = persistLibrary(storage, choice === 'remote' ? remote.value : library, raw);
          library = saved.library; baseline = saved.raw;
          if (choice === 'remote') adoption++;
        }
        dirty = false; conflict = null; error = ''; emit(); return true;
      } catch (problem) { error = problem.message || unavailable; emit(); return false; }
    });
  }
  function markDownloaded(key, expectedRaw) {
    try {
      if (storage.getItem(key) !== expectedRaw) { downloaded.delete(key); error = 'This saved copy changed. Download it again before removing it.'; emit(); return false; }
      downloaded.set(key, expectedRaw); emit(); return true;
    } catch { error = unavailable; emit(); return false; }
  }
  async function removeCopy(key, expectedRaw) {
    return transaction(() => {
      try {
        if (downloaded.get(key) !== expectedRaw) return false;
        if (storage.getItem(key) !== expectedRaw) { downloaded.delete(key); error = 'This saved copy changed. Download it again before removing it.'; emit(); return false; }
        storage.removeItem(key); downloaded.delete(key); error = ''; emit(); return true;
      } catch { error = unavailable; emit(); return false; }
    });
  }
  function savedCopies() {
    const copies = [];
    try {
      for (let slot = 1; slot <= MAX_WORKSPACE_BACKUPS; slot++) {
        const key = workspaceBackupKey(LIBRARY_KEY, slot), raw = storage.getItem(key);
        if (raw === null) continue;
        let savedAt;
        try { const value = JSON.parse(raw); if (Number.isFinite(Date.parse(value.savedAt))) savedAt = value.savedAt; } catch {}
        copies.push({slot, raw, downloadRaw:facilityCopyDownload(raw), savedAt, downloaded:downloaded.get(key) === raw,
          markDownloaded:() => markDownloaded(key, raw), remove:() => removeCopy(key, raw)});
      }
      return {copies, error:''};
    } catch { return {copies:[], error:'Saved conflict copies could not be read. Reconnect browser storage before removing a copy.'}; }
  }
  function snapshot() {
    const expectedRaw = conflict?.remoteRaw, expectedEdit = editVersion;
    return {library, error, saved:!dirty && !conflict, pending:dirty && !conflict && !error, editVersion, adoption,
      conflict:conflict ? {...conflict, error, savedCopies:savedCopies(),
        keepLocal:() => resolve('local', expectedRaw, expectedEdit), useRemote:() => resolve('remote', expectedRaw, expectedEdit)} : null};
  }
  return {loaded, snapshot, update, flush, receive, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }};
}
