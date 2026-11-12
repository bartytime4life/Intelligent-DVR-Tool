// Explicit live AI on one Monitor tile: the browser sends the frame it is already
// showing to this computer's local service and draws the returned detections.
// One frame is in flight per camera, so analysis never builds a backlog.
import {parseLiveSession, parseLiveFrame, LIVE_REPLY_ERROR} from './live-reply.mjs';

export const LIVE_DISPLAY_SCORE = 0.4;
// Boxes belong to the frame they were computed on. Hide them once that frame is old.
export const LIVE_BOX_MAX_AGE_MS = 1500;
export const LIVE_OBSERVATIONS = 20;

// Validate the fields Monitor renders or sends back when the operator starts AI.
// An incomplete/older service reply must not take the camera preview down.
export function liveSetupInfo(value) {
  const unavailable = {state:'unavailable', message:'Live AI needs a configured local model and compatible rules. Run Check, then Start.'};
  const invalid = {state:'unavailable', message:'Live AI setup needs attention. Run Check, restart the local app, then choose Check again. Camera preview is still available.'};
  const record = entry => entry !== null && typeof entry === 'object' && !Array.isArray(entry);
  const choice = entry => record(entry) && typeof entry.id === 'string' && /^[a-z0-9-]{1,40}$/.test(entry.id)
    && typeof entry.name === 'string' && entry.name.trim().length > 0 && [...entry.name].length <= 80;
  if (!record(value)) return invalid;
  const live = value.live;
  if (live == null || live.enabled === false) return unavailable;
  if (!record(live) || live.enabled !== true || typeof value.token !== 'string' || !value.token.trim()
      || !record(live.limits) || !Number.isSafeInteger(live.limits.active_sessions) || live.limits.active_sessions < 1
      || !Array.isArray(live.models) || !Array.isArray(live.rules)
      || !live.models.every(choice) || !live.rules.every(choice)) return invalid;
  const modelIds = new Set(live.models.map(model => model.id));
  if (modelIds.size !== live.models.length || new Set(live.rules.map(rule => rule.id)).size !== live.rules.length
      || !live.rules.every(rule => Array.isArray(rule.models) && rule.models.every(id => modelIds.has(id)))) return invalid;
  if (!live.models.length || !live.rules.some(rule => rule.models.includes(live.models[0].id))) return unavailable;
  return {state:'ready', token:value.token, live:{
    models:live.models.map(({id,name}) => ({id,name})),
    rules:live.rules.map(({id,name,models}) => ({id,name,models:[...models]})),
    limits:{active_sessions:live.limits.active_sessions},
  }};
}

export function liveBackendLabel(session) {
  if (session?.runtime?.backend_id === 'onnxruntime-cuda') return 'GPU · CUDA';
  const code = session?.acceleration?.code;
  if (code === 'CUDA_START_FAILED_CPU_FALLBACK') return 'CPU · GPU could not start';
  if (code === 'GPU_DISABLED_AFTER_FAILURE') return 'CPU · GPU disabled after failure';
  if (code === 'GPU_SLOT_BUSY') return 'CPU · GPU worker in use';
  if (code === 'PLATFORM_UNSUPPORTED') return 'CPU · GPU unavailable on this OS';
  if (code === 'PROFILE_UNSUPPORTED') return 'CPU · this model has no GPU path';
  return 'CPU · OpenCV';
}

const hex = (v, n) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(v);

export async function liveRequest(path, { token, body, jpeg, signal, fetcher = fetch, timeout = 15000 } = {}) {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean));
  let response;
  try {
    response = await fetcher(`/api/live${path}`, {
      method: body === undefined && !jpeg ? 'GET' : 'POST', signal:boundedSignal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'X-DVR-Token': token, ...(jpeg ? { 'Content-Type': 'image/jpeg' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(jpeg ? { body: jpeg } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    if (error.name === 'TimeoutError') throw Object.assign(Error('The local AI service did not respond in time. Check that the local app is running, then try again.'), {name:'TimeoutError'});
    throw Error('The local AI service is unavailable. Open the local app on this computer and retry.');
  }
  if (!response.ok) {
    let value; try { value = await response.json(); } catch { /* no detail */ }
    throw Object.assign(Error(value?.error?.message || 'Local AI request failed.'), { status: response.status, code: value?.error?.code });
  }
  try { return await response.json(); }
  catch (error) {
    if (error.name === 'TimeoutError') throw Object.assign(Error('The local AI reply did not finish in time. Check that the local app is running, then try again.'), {name:'TimeoutError'});
    if (error.name === 'SyntaxError') throw Object.assign(Error(LIVE_REPLY_ERROR),{code:'LIVE_REPLY_INVALID'});
    throw error;
  }
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

export const boxesFresh = (state, now) => Boolean(state?.result && Number.isFinite(state.resultAt)
  && Number.isFinite(now) && now >= state.resultAt && now - state.resultAt <= LIVE_BOX_MAX_AGE_MS);

// Counts and empty-scene messages expire with the boxes; no reply is not a
// negative detection. Keep this separate from historical rule observations.
export function liveFrameStatus(state, now) {
  if (!state?.result) return 'waiting';
  return boxesFresh(state, now) ? 'fresh' : 'stale';
}

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
  now = () => performance.now(), wall = () => Date.now(), wait = ms => new Promise(r => setTimeout(r, ms)), maxFps = 5, observations = [], observationsDropped = 0, timeouts = {} }) {
  let running = false, controller = null, generation = 0;
  // A restarted detector keeps a previous run's unsent observations so they can still be sent.
  const state = { state: 'idle', session: null, result: null, resultAt: 0, error: '', errorCode: '', observations: observations.slice(0, LIVE_OBSERVATIONS),
    fps: 0, latencyMs: null, skippedBusy: 0, frameErrors: 0,
    observationsDropped: observationsDropped + observations.slice(LIVE_OBSERVATIONS).filter(o => !o.sent).length };
  const emit = patch => { Object.assign(state, patch); onChange?.({ ...state, observations: [...state.observations] }); };
  async function loop(ticket, signal) {
    let previous = null;
    while (running && ticket === generation) {
      const began = now();
      let blob = null;
      try { blob = await capture(); } catch { blob = null; }
      if (!running || ticket !== generation) break;
      if (!blob) { await wait(250); continue; }
      const capturedAt = wall();
      const capturedMonotonic = now();
      try {
        const reply = await liveRequest(`/${state.session.id}/frame`, { token, jpeg: blob, signal, fetcher, timeout:timeouts.frame ?? 15000 });
        if (!running || ticket !== generation) break;
        const result = parseLiveFrame(reply,state.session);
        if (result.observations.some(o => state.observations.some(kept => kept.observation.id === o.id)))
          throw Object.assign(Error(LIVE_REPLY_ERROR),{code:'LIVE_REPLY_INVALID'});
        const finished = now(), interval = previous === null ? null : finished - previous;
        previous = finished;
        // Exponential moving average of analyzed frames per second, from actual reply spacing.
        const fps = interval ? (state.fps ? state.fps * 0.8 + 200 / interval : 1000 / interval) : state.fps;
        const added = (result.observations || []).map(o => ({ observation: o, still: blob, capturedAt, session: {...result.session} }));
        const combined = [...added.reverse(), ...state.observations];
        const dropped = combined.slice(LIVE_OBSERVATIONS).filter(o => !o.sent).length;
        emit({ state: 'live', session: result.session, result, resultAt: capturedMonotonic, fps, latencyMs: finished - began, error: '', errorCode: '',
          observations: combined.slice(0, LIVE_OBSERVATIONS), observationsDropped: state.observationsDropped + dropped });
      } catch (error) {
        if (!running || ticket !== generation || error.name === 'AbortError') break;
        if (error.code === 'BUSY') { emit({ skippedBusy: state.skippedBusy + 1 }); }
        else if (['FRAME_INVALID', 'FRAME_SIZE'].includes(error.code)) { emit({ frameErrors: state.frameErrors + 1 }); }
        else {
          // Reject the whole reply before publishing it. Stop the trusted session,
          // never an identifier supplied by a mismatched frame reply.
          if (error.code === 'LIVE_REPLY_INVALID') void liveRequest(`/${state.session.id}/stop`,
            {token,body:{},fetcher,timeout:timeouts.stop ?? 5000}).catch(() => {});
          running = false; emit({ state: 'failed', error: error.message, errorCode: error.code || '', result: null }); break;
        }
      }
      const spare = 1000 / maxFps - (now() - began);
      if (running && spare > 0) await wait(spare);
    }
  }
  return {
    get snapshot() { return { ...state }; },
    async start() {
      if (running) return;
      const ticket = ++generation;
      running = true; controller = new AbortController();
      const signal = controller.signal;
      emit({ state: 'starting', session:null, error: '', errorCode: '', result: null, fps: 0, latencyMs: null });
      try {
        // A GPU startup can use its 30 s allowance, then retry once on CPU.
        const reply = await liveRequest('/start', { token, body: { model, rules, camera }, signal, fetcher, timeout:timeouts.start ?? 75000 });
        if (!running || ticket !== generation) {
          try {
            const late = parseLiveSession(reply,{camera,model_id:model,rules_id:rules});
            void liveRequest(`/${late.id}/stop`, { token, body: {}, fetcher, timeout:timeouts.stop ?? 5000 }).catch(() => {});
          } catch { /* Untrusted replies never choose a Stop path; the unused lease expires. */ }
          return;
        }
        if (['failed','stopped'].includes(reply?.state)) {
          running = false; emit({state:'failed',error:typeof reply.error?.message === 'string' ? reply.error.message.slice(0,1000) : 'Local AI did not start.'}); return;
        }
        const session = parseLiveSession(reply,{camera,model_id:model,rules_id:rules});
        emit({ state: 'live', session });
        void loop(ticket, signal);
      } catch (error) {
        if (running && ticket === generation) { running = false; emit({ state: 'failed', errorCode: error.code || '', error: error.name === 'TimeoutError'
          ? `${error.message} Startup could not be confirmed. If it started locally, its lease expires without frames.` : error.message }); }
      }
    },
    stop(message = '') {
      const id = state.session?.id, wasRunning = running;
      const ticket = ++generation;
      running = false; controller?.abort();
      if (id && (wasRunning || state.state === 'live')) void liveRequest(`/${id}/stop`, { token, body: {}, fetcher, timeout:timeouts.stop ?? 5000 }).catch(() => {
        if (!running && ticket === generation) emit({error:'AI stop could not be confirmed. This page has stopped sending frames; the local session expires after its 15-second lease.'});
      });
      emit({ state: 'stopped', result: null, error: message || (wasRunning
        ? id ? 'AI stopped in this page. If Stop could not reach the local service, its session expires after its 15-second lease.'
          : 'AI startup cancelled in this page. A start already submitted locally may still finish; its lease expires without frames.' : '') });
    },
    dismiss(id) { state.observations = state.observations.filter(o => o.observation.id !== id); emit({}); },
    // Events now owns the locally saved still; release the tile's Blob reference.
    markSent(id) { state.observations = state.observations.map(o => o.observation.id === id ? {...o, sent:true, still:null} : o); emit({}); },
  };
}
