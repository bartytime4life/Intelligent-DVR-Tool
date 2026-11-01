import { initialEvents, restoreSnapshot } from './data.mjs';
import { mergeRecognitionEvents } from './recognition.mjs';

export const WORKSPACES = ['Monitor', 'Recognition', 'Train', 'Facility', 'Events', 'Zones', 'System', 'Settings'];
export function workspaceFromHash(hash) {
  if (hash === '') return 'Monitor';
  return WORKSPACES.find(name => `#${name.toLowerCase()}` === hash) || null;
}

export function readWorkspace(storage, key, fallback) {
  let raw = null;
  try {
    raw = storage.getItem(key);
    if (raw === null) return { value: fallback, error: '' };
    const value = restoreSnapshot(key, JSON.parse(raw), null);
    if (!value) throw Error('Invalid saved data');
    return { value, error: '' };
  } catch {
    return { value: fallback, raw, error: 'Saved data could not be loaded. Defaults are shown; the original saved entry is kept as a browser backup. Download it before relying on this workspace.' };
  }
}

export const unreadableKey = key => `${key}.unreadable`;
// Keep the first unreadable entry before anything replaces it. A failed backup must block the replacement.
export function preserveUnreadable(storage, key, raw) {
  try {
    if (storage.getItem(unreadableKey(key)) === null) storage.setItem(unreadableKey(key), raw);
    return true;
  } catch { return false; }
}

export function writeWorkspace(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return ''; }
  catch { return 'Changes are only in memory. Browser storage is unavailable or full. Export before closing this page.'; }
}

export function reviewExport(events) {
  return { schema: 'intelligent-dvr.review-export.v1', exportedAt: new Date().toISOString(), events };
}

export function parseReviewExport(value) {
  if (value?.schema !== 'intelligent-dvr.review-export.v1' || !restoreSnapshot('dvr.events.v1', value.events, null)) {
    throw Error('Choose a valid review export with up to 1,000 events.');
  }
  return value.events;
}

export function resetSamples(events) {
  // Reset only pending samples. Keep all imported observations and human decisions.
  const retained = events.filter(e => e.mode !== 'sample' || e.status !== 'pending');
  return mergeRecognitionEvents(retained, initialEvents);
}
