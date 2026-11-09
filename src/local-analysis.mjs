import { MAX_REVIEW_BYTES, MAX_VIDEO_BYTES, parseRecognition, matchRecording } from './recognition.mjs';

export const localAnalysisOrigin = location => location?.protocol === 'http:' && location?.hostname === '127.0.0.1';
export const activeJob = job => job && !['completed', 'cancelled', 'failed'].includes(job.state);
const base = '/api/analysis';
export const MAX_IMPORT_BYTES = 64 * 1024 ** 2;

export async function importRecording(file, token, signal, fetcher = fetch) {
  if (!file || file.size < 16 || file.size > MAX_IMPORT_BYTES) throw Error('Choose a recording up to 64 MiB. Larger local files can still use the configured folder.');
  const types = {webm:'video/webm', mp4:'video/mp4', mov:'video/mp4', avi:'video/x-msvideo', mkv:'video/x-matroska'};
  const mime = types[file.name?.split('.').pop().toLowerCase()] || file.type?.split(';')[0];
  if (!Object.values(types).includes(mime)) throw Error('Choose a WebM, MP4/MOV, AVI or MKV recording.');
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
  let response;
  try {
    response = await fetcher(base + '/recordings', { method:'POST', body:bytes, signal,
      credentials:'omit', cache:'no-store', redirect:'error',
      headers:{'X-DVR-Token':token, 'X-DVR-SHA256':sha, 'Content-Type':mime} });
  } catch (error) { throw serviceFailure(error, 'analysis service'); }
  let result;
  try { result = await response.json(); } catch { throw Error('Import response was lost. Reconnect and retry the same file to avoid duplicates.'); }
  if (!response.ok) throw Error(result.error?.message || 'Recording import failed. Reconnect and refresh choices.');
  if (result.sha256 !== sha || !/^[a-f0-9]{32}$/.test(result.recording?.id)) throw Error('Import verification failed. Reconnect and check the recording list.');
  return result;
}

// Browser fetch failures read "Failed to fetch"; explain them in the app's terms. Cancellation stays an AbortError.
export function serviceFailure(error, service) {
  if (error?.name === 'AbortError') return error;
  if (error?.name === 'TimeoutError') return Error(`The local ${service} did not respond in time. Check that the local app is still running, then reconnect.`);
  return Error(`The local ${service} is unavailable. Open the configured local application on this computer, then reconnect.`);
}

export async function analysisRequest(path, { token, method = 'GET', body, signal, fetcher = fetch } = {}) {
  let response;
  try {
    response = await fetcher(base + path, {
      method, signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { ...(token ? { 'X-DVR-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) { throw serviceFailure(error, 'analysis service'); }
  if (!response.ok) {
    let message = 'The local analysis service is unavailable. Open the configured local application, then reconnect.';
    try { message = (await response.json()).error?.message || message; } catch { /* Static previews have no job API. */ }
    throw Object.assign(Error(message), { status: response.status });
  }
  return response;
}
// The service answered and refused the request, so nothing started. Only a lost response or a rejected session is ambiguous.
export const refused = error => Number.isInteger(error?.status) && error.status !== 403;

export async function boundedBody(response, limit, {signal} = {}) {
  const abortReason = () => signal.reason ?? new DOMException('Result reading cancelled', 'AbortError');
  // Refuse an oversized response without leaving its download running in the background.
  if (signal?.aborted || Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    if (signal?.aborted) throw abortReason();
    throw Error('The local result exceeds its size limit. Try a shorter recording.');
  }
  if (!response.body) throw Error('The local result has no content. Reconnect and try opening it again.');
  const reader = response.body.getReader(), parts = [];
  const cancel = () => { void reader.cancel(abortReason()).catch(() => {}); };
  signal?.addEventListener('abort', cancel, {once: true});
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) throw abortReason();
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortReason();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error('The local result exceeds its size limit. Try a shorter recording.');
      parts.push(value);
    }
  } catch (error) {
    // Cleanup failure must not mask the original read/size error or delay cancellation.
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  return new Blob(parts, { type: response.headers.get('content-type') || 'application/octet-stream' });
}

export async function openJobResult(job, token, signal, fetcher = fetch) {
  if (job?.state !== 'completed' || !/^[a-f0-9]{32}$/.test(job.id)) throw Error('This job has no completed result.');
  if (signal?.aborted) throw new DOMException('Result opening cancelled', 'AbortError');
  const result = await analysisRequest(`/jobs/${job.id}/result`, { token, signal, fetcher });
  const bundle = parseRecognition(JSON.parse(await (await boundedBody(result, MAX_REVIEW_BYTES, {signal})).text()));
  const response = await analysisRequest(`/jobs/${job.id}/source`, { token, signal, fetcher });
  const file = await boundedBody(response, MAX_VIDEO_BYTES, {signal});
  await matchRecording(file, bundle.receipt.source_sha256, {signal});
  if (signal?.aborted) throw new DOMException('Result opening cancelled', 'AbortError');
  return { bundle, file, name: job.recording };
}


export function analysisBackendLabel(job, preference) {
  if (job?.backend === 'onnxruntime-cuda') return 'GPU · CUDA';
  const reasons = {
    CUDA_START_FAILED_CPU_FALLBACK:'CPU · GPU could not start',
    GPU_DISABLED_AFTER_FAILURE:'CPU · GPU disabled after failure',
    GPU_SLOT_BUSY:'CPU · GPU worker in use',
    PLATFORM_UNSUPPORTED:'CPU · GPU unavailable on this OS',
    PROFILE_UNSUPPORTED:'CPU · this model has no GPU path',
  };
  if (job?.backend === 'opencv-cpu') return reasons[job.acceleration_code] || 'CPU · OpenCV';
  if (job && job.state === 'running') return 'Preparing analysis · runtime not confirmed';
  if (job) return 'Runtime not reported';
  return preference === 'cuda-preferred' ? 'GPU first · CPU fallback' : preference === 'opencv-cpu' ? 'CPU selected' : 'Local analysis';
}
