import { MAX_REVIEW_BYTES, MAX_VIDEO_BYTES, parseRecognition, matchRecording } from './recognition.mjs';

export const localAnalysisOrigin = location => location?.protocol === 'http:' && location?.hostname === '127.0.0.1';
export const activeJob = job => job && !['completed', 'cancelled', 'failed'].includes(job.state);
const base = '/api/analysis';

export async function analysisRequest(path, { token, method = 'GET', body, signal, fetcher = fetch } = {}) {
  const response = await fetcher(base + path, {
    method, signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: { ...(token ? { 'X-DVR-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let message = 'The local analysis service is unavailable. Open the configured local application, then reconnect.';
    try { message = (await response.json()).error?.message || message; } catch { /* Static previews have no job API. */ }
    throw Error(message);
  }
  return response;
}

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
