import { feedRequest, webcamController } from './live-feeds.mjs';

const sessionId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const sourceId = value => typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value);
const degrees = value => ((value % 360) + 360) % 360;
export function plannedViewAngles(camera) {
  if (!camera || ![camera.bearing, camera.hfov, camera.vfov, camera.tilt].every(Number.isFinite)) return null;
  return { left: degrees(camera.bearing - camera.hfov / 2), center: degrees(camera.bearing),
    right: degrees(camera.bearing + camera.hfov / 2), horizontal: camera.hfov,
    vertical: camera.vfov, tilt: camera.tilt };
}

export function configuredFacilitySources(catalog) {
  return Array.isArray(catalog?.sources) ? catalog.sources.filter(s => s?.kind === 'rtsp' && sourceId(s.id) &&
    typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 80).slice(0, 100) : [];
}

// Exactly one explicit preview. No endpoints or credentials are accepted from a plan.
export function facilityPreviewController({ media, onState, request = feedRequest,
  schedule = setTimeout, cancel = clearTimeout, urls = URL }) {
  let generation = 0, mode = '', session = null, timer = null, pollAbort = null, image = '', sourceName = '';
  const emit = state => onState({ ...state, sourceName });
  const webcam = webcamController(media, state => { if (mode === 'webcam') emit({ ...state, kind: 'webcam' }); });
  const releaseImage = () => { if (image) urls.revokeObjectURL(image); image = ''; };
  async function close(value) {
    if (!value || !sessionId(value.id)) return;
    try { await request(`/${value.id}/disconnect`, { token: value.token, body: {}, signal: AbortSignal.timeout(4000) }); }
    catch { /* The server enforces a 15-second lease when disconnect cannot be delivered. */ }
  }
  function stop(message = 'Preview disconnected') {
    generation++; mode = ''; webcam.stop(); pollAbort?.abort(); pollAbort = null;
    if (timer !== null) cancel(timer); timer = null;
    const previous = session; session = null; releaseImage(); sourceName = '';
    emit({ state: 'disconnected', message: previous ? `${message} The server lease expires within 15 seconds if disconnect cannot be delivered.` : message });
    return close(previous);
  }
  async function poll(ticket) {
    if (ticket !== generation || !session) return;
    const current = session;
    const abort = new AbortController(); pollAbort = abort;
    const deadline = setTimeout(() => abort.abort(), 4000);
    try {
      const next = await (await request(`/${current.id}`, { token: current.token, signal: abort.signal })).json();
      if (ticket !== generation) return;
      if (!['connecting', 'live'].includes(next.state)) {
        releaseImage(); session = null; mode = '';
        emit({ state: 'failed', message: 'This source stopped. Check the local service and connect again.' });
        await close(current); return;
      }
      if (next.state === 'live') {
        const response = await request(`/${current.id}/frame`, { token: current.token, signal: abort.signal });
        const blob = await response.blob();
        if (blob.type !== 'image/jpeg' || blob.size > 512 * 1024) throw Error('Invalid preview frame');
        if (ticket !== generation) return;
        const previous = image; image = urls.createObjectURL(blob); if (previous) urls.revokeObjectURL(previous);
      }
      emit({ state: next.state, kind: 'rtsp', image, message: next.state === 'live' ? 'Receiving local DVR frames' : 'Waiting for camera frames…' });
    } catch {
      if (ticket !== generation) return;
      releaseImage(); session = null; mode = '';
      emit({ state: 'failed', message: 'Preview connection was lost. Reconnect to retry. The server stops an unreachable preview within 15 seconds.' });
      await close(current); return;
    } finally { clearTimeout(deadline); if (pollAbort === abort) pollAbort = null; }
    if (ticket === generation && session) timer = schedule(() => { timer = null; void poll(ticket); }, 250);
  }
  return {
    stop,
    async connectWebcam(deviceId = '', name = 'Browser default webcam') {
      const pendingStop = stop();
      const ticket = generation;
      await pendingStop;
      if (ticket !== generation) return;
      mode = 'webcam'; sourceName = name;
      await webcam.connect(deviceId);
    },
    async connectNetwork(catalog, id) {
      const source = configuredFacilitySources(catalog).find(s => s.id === id);
      if (!source || catalog?.ready !== true || typeof catalog.token !== 'string' || !catalog.token || catalog.token.length > 256)
        throw Error('Choose a configured local DVR channel from the refreshed list.');
      const pendingStop = stop();
      const ticket = generation;
      await pendingStop;
      if (ticket !== generation) return;
      mode = 'rtsp'; sourceName = source.name;
      emit({ state: 'connecting', kind: 'rtsp', message: 'Connecting the selected local source…' });
      try {
        const next = await (await request('/connect', { token: catalog.token, body: { source: id }, signal: AbortSignal.timeout(4000) })).json();
        if (!sessionId(next.id)) throw Error('Invalid session');
        const value = { id: next.id, token: catalog.token };
        if (ticket !== generation) { await close(value); return; }
        session = value; void poll(ticket);
      } catch {
        if (ticket === generation) { mode = ''; emit({ state: 'failed', message: 'The source could not connect. Check the local service and retry. Any unfinished preview expires within 15 seconds.' }); }
      }
    },
  };
}
