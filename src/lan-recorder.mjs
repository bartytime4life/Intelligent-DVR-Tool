import { boundedBody } from './local-analysis.mjs';
import { parseRecognition, matchRecording, MAX_REVIEW_BYTES, MAX_VIDEO_BYTES } from './recognition.mjs';

export async function recorderRequest(path, {token, body, signal, fetcher = fetch} = {}) {
  const response = await fetcher('/api/recorder' + path, {method: body ? 'POST' : 'GET',
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
    headers: {'X-DVR-Token': token, ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})});
  if (!response.ok) {
    let message = 'Recorder unavailable. Refresh status before trying again.';
    try { message = (await response.json()).error?.message || message; } catch { /* No JSON endpoint. */ }
    throw Error(message);
  }
  return response;
}

export async function openSegment(segment, token, signal, fetcher = fetch) {
  if (segment?.state !== 'completed' || !/^[a-f0-9]{32}$/.test(segment.id)) throw Error('Select a completed segment.');
  const request = path => recorderRequest(`/segments/${segment.id}/${path}`, {token, signal, fetcher});
  const bundle = parseRecognition(JSON.parse(await (await boundedBody(await request('result'), MAX_REVIEW_BYTES)).text()));
  if (bundle.receipt.source_sha256 !== segment.sha256) throw Error('The segment fingerprint changed. Refresh status.');
  const file = await boundedBody(await request('source'), MAX_VIDEO_BYTES);
  await matchRecording(file, segment.sha256);
  if (signal?.aborted) throw new DOMException('Opening cancelled', 'AbortError');
  return {bundle, file, name: `${segment.source}-${segment.id}.webm`};
}

export const recorderErrors = {
  STORAGE_PRESSURE: 'Recording is paused for storage pressure. Free space or increase the configured limits. It will retry while recording is enabled.',
  ANALYSIS_STORAGE_PRESSURE: 'Analysis is waiting for free space on its working volume. Queued segments can expire under retention.',
  CONNECTION_OR_ENCODER_FAILED: 'The stream or encoder stopped. Check camera power, LAN, credentials and VP8 support. Reconnect attempts use a bounded delay.',
  CAPTURE_TIMEOUT: 'The camera did not finish a segment in time. The incomplete recording was discarded.',
  SEGMENT_INVALID: 'A segment failed validation and was discarded.',
  START_FAILED: 'The capture worker could not start. Check the local installation.',
  OPERATOR_STOP: 'Recording stopped. The unfinished segment was discarded.',
  ANALYSIS_FAILED: 'Segment analysis failed or returned incomplete results. Check the model, rules and resources.',
  ANALYSIS_START_FAILED: 'Segment analysis could not start. Check the configured model, rules and recording integrity.',
  ANALYSIS_INTERRUPTED: 'Analysis was interrupted. The verified recording remains queued for the next explicit Start.',
  STORAGE_OR_WORKER_FAILED: 'Recording stopped after a storage or worker failure. Restart the service after checking storage; it will remain stopped.',
};
