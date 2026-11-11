// Review memory is independent of a camera connection. Each detector already
// bounds its snapshot to 20 observations; admit at most four occupied snapshots.
export const MAX_LIVE_REVIEW_SESSIONS = 4;
export const LIVE_REVIEW_LIMIT_MESSAGE = 'Live review slots are full. Send or dismiss unsent observations from a stopped source before starting AI for another preview. Camera connections and Stop remain available.';

const active = state => ['starting','live'].includes(state?.state);
export const pendingLiveCount = state => Array.isArray(state?.observations)
  ? state.observations.filter(item => !item.sent).length : 0;
const occupied = state => active(state) || pendingLiveCount(state) > 0;
export const pendingLiveReviews = states => Object.values(states).reduce((count,state) => count + pendingLiveCount(state), 0);

export function canStartLiveReview(states, id) {
  return occupied(states[id]) || Object.values(states).filter(occupied).length < MAX_LIVE_REVIEW_SESSIONS;
}

export function pruneLiveReviews(states, sourceIds) {
  const visible = new Set(sourceIds);
  const entries = Object.entries(states).filter(([id,state]) => visible.has(id) || occupied(state));
  return entries.length === Object.keys(states).length ? states : Object.fromEntries(entries);
}

export function retainedLiveTiles(states, sourceIds) {
  const visible = new Set(sourceIds);
  return Object.entries(states).filter(([id,state]) => !visible.has(id) && pendingLiveCount(state) > 0)
    .map(([id,state]) => ({id, name:state.cameraName || state.session?.camera || 'Disconnected source',
      kind:'retained', state:'stopped', reviewOnly:true}));
}
