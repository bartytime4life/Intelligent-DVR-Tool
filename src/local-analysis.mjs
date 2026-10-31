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

export async function boundedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw Error('The local result exceeds its size limit. Try a shorter recording.');
  const reader = response.body.getReader(), parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error('The local result exceeds its size limit. Try a shorter recording.');
      parts.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  return new Blob(parts, { type: response.headers.get('content-type') || 'application/octet-stream' });
}

export async function openJobResult(job, token, signal, fetcher = fetch) {
  if (job?.state !== 'completed' || !/^[a-f0-9]{32}$/.test(job.id)) throw Error('This job has no completed result.');
  const result = await analysisRequest(`/jobs/${job.id}/result`, { token, signal, fetcher });
  const bundle = parseRecognition(JSON.parse(await (await boundedBody(result, MAX_REVIEW_BYTES)).text()));
  const response = await analysisRequest(`/jobs/${job.id}/source`, { token, signal, fetcher });
  const file = await boundedBody(response, MAX_VIDEO_BYTES);
  await matchRecording(file, bundle.receipt.source_sha256);
  if (signal?.aborted) throw new DOMException('Result opening cancelled', 'AbortError');
  return { bundle, file, name: job.recording };
}
