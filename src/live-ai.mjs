// Explicit live AI on one Monitor tile: the browser sends the frame it is already
// showing to this computer's local service and draws the returned detections.
// One frame is in flight per camera, so analysis never builds a backlog.

export const LIVE_DISPLAY_SCORE = 0.4;
// Boxes belong to the frame they were computed on. Hide them once that frame is old.
export const LIVE_BOX_MAX_AGE_MS = 1500;
export const LIVE_OBSERVATIONS = 20;

const hex = (v, n) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);

export async function liveRequest(path, { token, body, jpeg, signal, fetcher = fetch } = {}) {
  let response;
  try {
    response = await fetcher(`/api/live${path}`, {
      method: body === undefined && !jpeg ? 'GET' : 'POST', signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'X-DVR-Token': token, ...(jpeg ? { 'Content-Type': 'image/jpeg' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(jpeg ? { body: jpeg } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
    throw Error('The local AI service is unavailable. Open the local app on this computer and retry.');
  }
  if (!response.ok) {
    let value; try { value = await response.json(); } catch { /* no detail */ }
    throw Object.assign(Error(value?.error?.message || 'Local AI request failed.'), { status: response.status, code: value?.error?.code });
  }
  return response.json();
}

// Per-label counts of what the AI currently sees, e.g. [['person', 2], ['car', 1]].
export function liveCounts(detections, threshold = LIVE_DISPLAY_SCORE) {
  const counts = new Map();
  for (const d of detections || []) if (d.score >= threshold) counts.set(d.label, (counts.get(d.label) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function liveBoxLabel(d) {
  return `${d.label}${Number.isInteger(d.track) ? ` #${d.track}` : ''} ${d.score.toFixed(2)}`;
}

export const boxesFresh = (state, now) => Boolean(state?.result && state.resultAt && now - state.resultAt <= LIVE_BOX_MAX_AGE_MS);

// A rule observation from live AI as a pending review-queue entry. There is no
// recording behind it: the still frame saved in this browser is the only image.
export function liveObservationEvent(observation, session, capturedAt) {
  if (!hex(observation?.id, 32) || !hex(session?.id, 32) || !hex(session?.model_sha256, 64)) throw Error('Invalid live observation.');
  const at = new Date(capturedAt);
  if (!Number.isFinite(at.getTime())) throw Error('Invalid live observation time.');
  return {
    id: `live-${observation.id}`, sourceId: observation.id, camera: null,
    cameraName: String(session.camera).slice(0, 80), title: `${observation.label} observed live`,
    label: observation.label, time: `Live ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
    seconds: observation.seconds, score: observation.score, rule: String(observation.rule).slice(0, 200),
    status: 'pending', mode: 'live-model', note: '',
    provenance: { model_sha256: session.model_sha256, state: 'live', session: session.id, captured_at: at.toISOString() },
  };
}

// Capture the currently displayed picture as a JPEG no wider than maxWidth.
export async function captureJpeg(element, { maxWidth = 960, quality = 0.8, documentRef = globalThis.document } = {}) {
  const width = element?.videoWidth || element?.naturalWidth, height = element?.videoHeight || element?.naturalHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, maxWidth / width), canvas = documentRef.createElement('canvas');
  canvas.width = Math.max(16, Math.round(width * scale)); canvas.height = Math.max(16, Math.round(height * scale));
  canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Drives one live session. capture() returns the current frame as a JPEG Blob (or
// null while no picture is shown). onChange receives a fresh snapshot after every step.
export function liveDetector({ token, model, rules, camera, capture, onChange, fetcher = fetch,
  now = () => performance.now(), wall = () => Date.now(), wait = ms => new Promise(r => setTimeout(r, ms)), maxFps = 5 }) {
  let running = false, controller = null;
  const state = { state: 'idle', session: null, result: null, resultAt: 0, error: '', observations: [],
    fps: 0, latencyMs: null, skippedBusy: 0, frameErrors: 0 };
  const emit = patch => { Object.assign(state, patch); onChange?.({ ...state, observations: [...state.observations] }); };
  async function loop() {
    let previous = null;
    while (running) {
      const began = now();
      let blob = null;
      try { blob = await capture(); } catch { blob = null; }
      if (!running) break;
      if (!blob) { await wait(250); continue; }
      const capturedAt = wall();
      try {
        const result = await liveRequest(`/${state.session.id}/frame`, { token, jpeg: blob, signal: controller.signal, fetcher });
        if (!running) break;
        const finished = now(), interval = previous === null ? null : finished - previous;
        previous = finished;
        // Exponential moving average of analyzed frames per second, from actual reply spacing.
        const fps = interval ? (state.fps ? state.fps * 0.8 + 200 / interval : 1000 / interval) : state.fps;
        const added = (result.observations || []).map(o => ({ observation: o, still: blob, capturedAt }));
        emit({ state: 'live', session: result.session, result, resultAt: finished, fps, latencyMs: finished - began, error: '',
          observations: [...added.reverse(), ...state.observations].slice(0, LIVE_OBSERVATIONS) });
      } catch (error) {
        if (!running || error.name === 'AbortError') break;
        if (error.code === 'BUSY') { state.skippedBusy++; }
        else if (['FRAME_INVALID', 'FRAME_SIZE'].includes(error.code)) { emit({ frameErrors: state.frameErrors + 1 }); }
        else { running = false; emit({ state: 'failed', error: error.message, result: null }); break; }
      }
      const spare = 1000 / maxFps - (now() - began);
      if (running && spare > 0) await wait(spare);
    }
  }
  return {
    get snapshot() { return { ...state }; },
    async start() {
      if (running) return;
      running = true; controller = new AbortController();
      emit({ state: 'starting', error: '', result: null, observations: [], fps: 0, latencyMs: null });
      try {
        const session = await liveRequest('/start', { token, body: { model, rules, camera }, signal: controller.signal, fetcher });
        if (!running) { void liveRequest(`/${session.id}/stop`, { token, body: {}, fetcher }).catch(() => {}); return; }
        if (session.state !== 'live') { running = false; emit({ state: 'failed', session, error: session.error?.message || 'Local AI did not start.' }); return; }
        emit({ state: 'live', session });
        void loop();
      } catch (error) {
        if (running) { running = false; emit({ state: 'failed', error: error.message }); }
      }
    },
    stop(message = '') {
      const id = state.session?.id, wasRunning = running;
      running = false; controller?.abort();
      if (id && (wasRunning || state.state === 'live')) void liveRequest(`/${id}/stop`, { token, body: {}, fetcher }).catch(() => {});
      emit({ state: 'stopped', result: null, error: message });
    },
    dismiss(index) { state.observations.splice(index, 1); emit({}); },
    markSent(index) { if (state.observations[index]) { state.observations[index] = { ...state.observations[index], sent: true }; emit({}); } },
  };
}
