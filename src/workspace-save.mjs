import { readWorkspace, unreadableKey } from './workspace-state.mjs';

export const MAX_WORKSPACE_BACKUPS = 10;
export const workspaceBackupKey = (key, slot) => `${key}.conflict-backup.${slot}`;
const unavailable = 'Changes are only in memory. Browser storage is unavailable or full. Export before closing this page.';
const conflictMessage = 'Another tab changed this workspace. This tab’s version is kept in memory. Export both versions, then choose which one to use. Saving stays paused until you choose.';

// Own the save baseline outside React's render/effect timing. A storage event
// arriving immediately after a local edit must already see that edit as dirty.
export function createWorkspaceSave(storage, key, initial, {withLock} = {}) {
  let initialRaw;
  const loaded = readWorkspace({getItem: name => (initialRaw = storage.getItem(name))}, key, initial);
  let value = loaded.value, committed = JSON.stringify(value), baseline = initialRaw;
  let dirty = false, error = '', conflict = null, editVersion = 0, backupKeys = [];
  const downloadedCopies = new Map();
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  const parse = raw => raw === null ? {value:initial, error:''} : readWorkspace({getItem:() => raw}, key, null);
  // Hold one shared lock from backup-slot selection through primary commit.
  // Separate tabs must never claim and overwrite the same empty backup slot.
  const coordinate = withLock === undefined ? (globalThis.navigator?.locks?.request
    ? work => globalThis.navigator.locks.request(`intelligent-dvr.workspace-save:${key}`, {mode:'exclusive'}, work) : null)
    : withLock;
  async function transaction(work) {
    if (!coordinate) {
      error = 'This browser cannot coordinate workspace saves between tabs. Changes stay in memory. Export this version before closing, or open the app in a browser with shared save locking.';
      emit(); return false;
    }
    try { return await coordinate(work); }
    catch { error = unavailable; emit(); return false; }
  }

  function capture(raw) {
    const remote = parse(raw);
    conflict = {remoteRaw:raw, remoteValue:remote.error ? null : remote.value,
      remoteValid:!remote.error, remoteDeleted:raw === null};
    emit();
  }
  function changedDuringChoice(raw) {
    error = 'A version changed while your choice was waiting. Both versions are kept. Review or download the updated versions, then choose again.';
    capture(raw); return false;
  }
  function backup(raw) {
    if (raw === null || raw === undefined) return;
    let available = null;
    backupKeys = [];
    for (let slot = 1; slot <= MAX_WORKSPACE_BACKUPS; slot++) {
      const name = workspaceBackupKey(key, slot), saved = storage.getItem(name);
      if (saved === null) { available ??= name; continue; }
      backupKeys.push(name);
      try {
        const old = JSON.parse(saved);
        if (old.schema === 'intelligent-dvr.workspace-backup.v1' && old.key === key && old.raw === raw) return;
      } catch { /* An unreadable backup still occupies its slot; never replace it. */ }
    }
    if (!available) throw Error('All 10 browser conflict backups are occupied. Open Saved conflict copies, download a copy, then remove that browser copy to free a slot. No saved version was replaced.');
    storage.setItem(available, JSON.stringify({schema:'intelligent-dvr.workspace-backup.v1', key, raw, savedAt:new Date().toISOString()}));
    backupKeys.push(available);
  }
  function protectUnreadable() {
    if (loaded.raw == null) return;
    const held = storage.getItem(unreadableKey(key));
    if (held === null) storage.setItem(unreadableKey(key), loaded.raw);
    else if (held !== loaded.raw) backup(loaded.raw);
  }
  function adopt(raw, remote) {
    value = remote.value; committed = JSON.stringify(value); baseline = raw;
    dirty = false; error = ''; conflict = null;
    emit();
  }
  function update(next) {
    value = typeof next === 'function' ? next(value) : next;
    dirty = JSON.stringify(value) !== committed;
    if (!dirty && !conflict) error = '';
    editVersion++;
    emit();
  }
  async function flush() {
    if (!dirty || conflict) return false;
    return transaction(() => {
      if (!dirty || conflict) return false;
      try {
        const current = storage.getItem(key);
        if ((baseline !== undefined && current !== baseline) || (baseline === undefined && current !== null)) {
          capture(current); return false;
        }
        protectUnreadable();
        const raw = JSON.stringify(value);
        storage.setItem(key, raw);
        baseline = raw; committed = raw; dirty = false; error = '';
        emit(); return true;
      } catch { error = unavailable; emit(); return false; }
    });
  }
  function receive() {
    try {
      // Read current storage: queued events can describe an older save that has
      // already been superseded, including by this tab's own successful write.
      const raw = storage.getItem(key);
      if (raw === baseline && !conflict) return;
      const remote = parse(raw);
      if (!dirty && !conflict && !remote.error) adopt(raw, remote);
      else capture(raw);
    } catch { error = unavailable; emit(); }
  }
  async function resolve(choice, expectedRaw, expectedEdit) {
    if (!conflict) return false;
    return transaction(() => {
      if (!conflict) return false;
      try {
        const current = storage.getItem(key);
        if (current !== expectedRaw || editVersion !== expectedEdit) return changedDuringChoice(current);
        if (choice === 'remote') {
          if (!conflict.remoteValid) return false;
          backup(JSON.stringify(value));
          protectUnreadable();
          // Re-check before adopting, including changes by clients that do not
          // participate in this app's shared save lock.
          if (storage.getItem(key) !== current) return changedDuringChoice(storage.getItem(key));
          adopt(current, parse(current));
          return true;
        }
        backup(current);
        protectUnreadable();
        if (storage.getItem(key) !== current) return changedDuringChoice(storage.getItem(key));
        const raw = JSON.stringify(value);
        storage.setItem(key, raw);
        baseline = raw; committed = raw; dirty = false; error = ''; conflict = null;
        emit(); return true;
      } catch (problem) {
        error = problem.message?.startsWith('All 10 browser') ? problem.message : unavailable;
        emit(); return false;
      }
    });
  }
  function markCopyDownloaded(name, expectedRaw) {
    try {
      if (storage.getItem(name) !== expectedRaw) {
        downloadedCopies.delete(name);
        error = 'This saved copy changed. Download its updated version before removing it.';
        emit(); return false;
      }
      downloadedCopies.set(name, expectedRaw);
      emit(); return true;
    } catch { error = unavailable; emit(); return false; }
  }
  async function removeCopy(name, expectedRaw) {
    return transaction(() => {
      if (downloadedCopies.get(name) !== expectedRaw) return false;
      try {
        // A different tab may have reused the slot while the lock was pending.
        // The downloaded snapshot authorizes removal of these exact bytes only.
        if (storage.getItem(name) !== expectedRaw) {
          downloadedCopies.delete(name);
          error = 'This saved copy changed. Download its updated version before removing it.';
          emit(); return false;
        }
        storage.removeItem(name);
        downloadedCopies.delete(name);
        if (error.startsWith('All 10 browser') || error.startsWith('This saved copy changed.')) error = '';
        emit(); return true;
      } catch { error = unavailable; emit(); return false; }
    });
  }
  function savedCopies() {
    const copies = [];
    try {
      for (let slot = 1; slot <= MAX_WORKSPACE_BACKUPS; slot++) {
        const name = workspaceBackupKey(key, slot), raw = storage.getItem(name);
        if (raw === null) continue;
        let savedAt = null;
        try {
          const record = JSON.parse(raw);
          if (record.schema === 'intelligent-dvr.workspace-backup.v1' && record.key === key &&
              typeof record.savedAt === 'string' && Number.isFinite(Date.parse(record.savedAt))) savedAt = record.savedAt;
        } catch { /* Original bytes can still be downloaded and explicitly removed. */ }
        copies.push({slot, raw, savedAt, downloaded:downloadedCopies.get(name) === raw,
          markDownloaded:() => markCopyDownloaded(name, raw), remove:() => removeCopy(name, raw)});
      }
      return {copies, error:''};
    } catch { return {copies:[], error:'Saved conflict copies could not be read. Reconnect browser storage before removing a copy.'}; }
  }
  function snapshot() {
    const expectedRaw = conflict?.remoteRaw, expectedEdit = editVersion;
    return {value, error, editVersion, hasUnsavedChanges:dirty || Boolean(conflict), conflict:conflict ? {
      ...conflict, message:conflictMessage, error, localRaw:JSON.stringify(value), backupKeys:[...backupKeys], savedCopies:savedCopies(),
      keepLocal:() => resolve('local', expectedRaw, expectedEdit), useRemote:() => resolve('remote', expectedRaw, expectedEdit),
    } : null};
  }
  return {loaded, snapshot, update, flush, receive, subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);}};
}
