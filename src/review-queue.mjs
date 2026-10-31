import { csvCell } from './recognition-report.mjs';

// Older saved events keep clip time only in their "Clip +12.3s" label.
export function eventSeconds(e) {
  if (Number.isFinite(e?.seconds)) return e.seconds;
  const match = /\+(\d+(?:\.\d+)?)s/.exec(e?.time || '');
  return match ? Number(match[1]) : null;
}
export const eventSource = e => e?.cameraName || (e?.camera != null ? `Plan ${e.camera}` : '');
export const eventRecording = e => e?.provenance?.source_sha256 || '';

export function queueChoices(events) {
  const sources = new Map(), recordings = new Map();
  for (const e of events) {
    const source = eventSource(e), recording = eventRecording(e);
    if (source) sources.set(source, (sources.get(source) || 0) + 1);
    if (recording) recordings.set(recording, (recordings.get(recording) || 0) + 1);
  }
  const sorted = map => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({value, count}));
  return {sources: sorted(sources), recordings: sorted(recordings)};
}

export const SORTS = {
  // Queue order: newest additions first, as merged.
  newest: () => 0,
  score: (a, b) => b.score - a.score,
  clip: (a, b) => (eventSeconds(a) ?? Infinity) - (eventSeconds(b) ?? Infinity),
};

export function filterEvents(events, {status = 'all', mode = 'all', source = 'all', recording = 'all', query = '', sort = 'newest', label = e => ''} = {}) {
  const q = query.trim().toLowerCase();
  const kept = events.filter(e => (status === 'all' || e.status === status) && (mode === 'all' || e.mode === mode) &&
    (source === 'all' || eventSource(e) === source) && (recording === 'all' || eventRecording(e) === recording) &&
    (!q || `${e.title} ${label(e)} ${e.rule}`.toLowerCase().includes(q)));
  // Array.prototype.sort is stable, so ties keep queue order.
  return sort === 'newest' ? kept : [...kept].sort(SORTS[sort] || SORTS.newest);
}

// The next pending item after `id` in the displayed order, wrapping once; null when none remain.
export function nextPending(list, id, step = 1) {
  const pending = list.filter(e => e.status === 'pending' && e.id !== id);
  if (!pending.length) return null;
  const at = list.findIndex(e => e.id === id);
  if (at < 0) return step > 0 ? pending[0] : pending.at(-1);
  for (let i = 1; i <= list.length; i++) {
    const e = list[(at + step * i + list.length * list.length) % list.length];
    if (e.status === 'pending' && e.id !== id) return e;
  }
  return null;
}

export function queueCSV(events) {
  const rows = [['event_id', 'status', 'source', 'clip_seconds', 'label', 'rule', 'model_score', 'mode', 'source_sha256', 'model_sha256', 'reviewed_at', 'review_note']];
  for (const e of events) rows.push([e.id, e.status, eventSource(e), eventSeconds(e) ?? '', e.label, e.rule, e.score, e.mode,
    eventRecording(e), e.provenance?.model_sha256 || '', e.reviewedAt || '', e.note || '']);
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Dismiss many pending items at once; returns the updated queue and the prior entries for Undo.
export function dismissPending(events, ids, note = '', at = new Date().toISOString()) {
  const chosen = new Set(ids), previous = [];
  const next = events.map(e => {
    if (!chosen.has(e.id) || e.status !== 'pending') return e;
    previous.push(e);
    return {...e, status: 'dismissed', note: note.slice(0, 2000) || e.note, reviewedAt: at};
  });
  return {events: next, previous, at};
}

export function restorePending(events, {previous, at}) {
  const byId = new Map(previous.map(e => [e.id, e]));
  // Only entries still carrying that bulk decision return to pending; later decisions win.
  return events.map(e => byId.has(e.id) && e.status === 'dismissed' && e.reviewedAt === at ? byId.get(e.id) : e);
}
