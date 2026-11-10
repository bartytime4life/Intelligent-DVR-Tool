import { analysisJSON } from './training-analysis.mjs';

export function verifiedPeople(value) {
  const bad = () => { throw Error('The saved people reply could not be verified. Existing verified entries have not been changed.'); };
  if (!Array.isArray(value?.people) || value.people.length > 50) return bad();
  const ids = new Set();
  return value.people.map(person => {
    if (!person || typeof person.id !== 'string' || !/^[a-f0-9]{16}$/.test(person.id) || ids.has(person.id) || typeof person.name !== 'string' ||
        !person.name.trim() || [...person.name].length > 60 || /[\p{Cc}\p{Cs}]/u.test(person.name) ||
        typeof person.created !== 'string' || !Number.isFinite(Date.parse(person.created)) ||
        !Number.isSafeInteger(person.views) || person.views < 0) return bad();
    const b = person.baseline;
    if (b != null && (typeof b !== 'object' || !Number.isSafeInteger(b.usable) || b.usable < 0 ||
        !Number.isSafeInteger(b.matched) || b.matched < 0 || b.matched > b.usable ||
        (b.usable > 0 ? !Number.isFinite(b.rate) || b.rate < 0 || b.rate > 1 : b.rate !== null))) return bad();
    ids.add(person.id);
    return { id: person.id, name: person.name, created: person.created, views: person.views,
      baseline: b == null ? null : { ...b } };
  });
}

export const initialPeopleState = () => ({ people: null, loading: false, deleting: null, blocked: [], error: '', notice: '', unresolved: {} });

// The list is unknown until verified. Reads are versioned; template deletion is
// single-flight across all rows, and only a matching acknowledgement confirms it.
export function createPeopleOperations(onChange, { request = analysisJSON, timeout = 15000 } = {}) {
  let state = initialPeopleState(), closed = false, version = 0, read = null, deletion = null;
  const acknowledgedDeletes = new Map();
  const lifetime = new AbortController();
  const patch = value => { if (!closed) { state = { ...state, ...value }; onChange(state); } };
  const invalidateRead = () => { version++; read?.abort(); read = null; };
  async function load(service, internal = false) {
    if (closed || (deletion && !internal) || !service?.people?.enabled) return false;
    invalidateRead();
    const current = version, controller = new AbortController(); read = controller;
    const signal = AbortSignal.any([lifetime.signal, controller.signal]);
    patch({ loading: true, error: '' });
    try {
      const people = verifiedPeople(await request('/people', { token: service.token, signal, timeout }));
      if (closed || signal.aborted || current !== version) return false;
      patch({ people });
      for (const [id, name] of acknowledgedDeletes) {
        if (!people.some(person => person.id === id)) {
          acknowledgedDeletes.delete(id);
          const { [id]: removed, ...unresolved } = state.unresolved;
          patch({ blocked: state.blocked.filter(blocked => blocked !== id), unresolved, notice: `${name}’s face template was deleted.` });
        }
      }
      return true;
    } catch (error) {
      if (!closed && !signal.aborted && current === version)
        patch({ error: `Saved people could not be refreshed. ${error.message || 'Check the local app and try again.'}` });
      return false;
    } finally {
      if (!closed && current === version) { read = null; patch({ loading: false }); }
    }
  }
  return {
    load,
    async remove(person, service) {
      if (closed || deletion || state.blocked.includes(person.id) || !state.people?.some(p => p.id === person.id)) return false;
      invalidateRead();
      const operation = {}; deletion = operation;
      patch({ deleting: person.id, loading: false, error: '', notice: '', blocked: [...state.blocked, person.id] });
      let acknowledged = false;
      try {
        const reply = await request(`/people/${person.id}/delete`, {
          token: service.token, method: 'POST', body: {}, signal: lifetime.signal, timeout,
        });
        if (closed) return false;
        acknowledged = reply?.deleted === person.id;
        if (acknowledged) acknowledgedDeletes.set(person.id, person.name);
      } catch { /* A missing, failed or malformed reply cannot confirm a write. */ }
      if (closed) return false;
      const refreshed = await load(service, true);
      if (closed || deletion !== operation) return false;
      const listed = state.people?.some(p => p.id === person.id);
      if (acknowledged && refreshed && !listed) {
        patch({ blocked: state.blocked.filter(id => id !== person.id), notice: `${person.name}’s face template was deleted.` });
      } else {
        // PeopleStore omits unreadable/damaged files. Absence alone cannot prove
        // that an unacknowledged deletion removed the private file.
        const notice = acknowledged
          ? `The local app acknowledged ${person.name}’s deletion, but the updated list could not confirm it. Refresh saved people before another template operation.`
          : `Deletion of ${person.name}’s face template could not be confirmed. It may still be saved on this computer. Refresh saved people and check the local app before trying again; an absent entry alone does not prove its file was removed.`;
        patch({ notice, unresolved: { ...state.unresolved, [person.id]: notice } });
      }
      deletion = null; patch({ deleting: null });
      return acknowledged && refreshed && !listed;
    },
    close() { closed = true; invalidateRead(); lifetime.abort(); },
  };
}
