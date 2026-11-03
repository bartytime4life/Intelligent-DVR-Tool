import { boundedBody, serviceFailure } from './local-analysis.mjs';
import { parseRecognition, matchRecording, MAX_REVIEW_BYTES, MAX_VIDEO_BYTES } from './recognition.mjs';
import { coverageLabel } from './media-coverage.mjs';

export const DEFAULT_LIBRARY_CONFIG = Object.freeze({ source_folder: '', backup_folder: '', max_storage_gib: 100, reserve_gib: 2, settle_seconds: 60, recursive: true });

// All requests stay on this application's origin. Tokens and camera passwords never enter URLs or browser storage.
export async function libraryRequest(path, { token, body, signal, fetcher = fetch, setup = false, timeout = 15000 } = {}) {
  if (!path.startsWith('/') || path.includes('..') || path.includes('?') || path.includes('#')) throw Error('Invalid local backup request.');
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean));
  let response;
  try {
    response = await fetcher((setup ? '/api/setup' : '/api/library') + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: boundedSignal,
      headers: { 'X-DVR-Token': token, ...(body === undefined ? {} : {'Content-Type': 'application/json'}) },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
  } catch (error) { throw serviceFailure(error, 'backup service'); }
  if (!response.ok) {
    let message = 'The local backup service is unavailable. Reconnect to check its status.';
    try { const value = await response.json(); message = typeof value.error === 'string' ? value.error : value.error?.message || message; } catch { /* Static previews have no local API. */ }
    throw Object.assign(Error(message), {status: response.status});
  }
  return response;
}

export function libraryConfig(values) {
  const config = {...DEFAULT_LIBRARY_CONFIG, ...values};
  for (const field of ['source_folder', 'backup_folder']) {
    if (typeof config[field] !== 'string' || !config[field].trim()) throw Error('Choose the DVR source folder and a separate backup folder.');
    config[field] = config[field].trim();
  }
  if (config.source_folder.replace(/[\\/]+$/, '') === config.backup_folder.replace(/[\\/]+$/, '')) throw Error('Choose a backup folder separate from your DVR source folder.');
  for (const [field, min, max, label] of [['max_storage_gib', 1, 1000000, 'Storage budget'], ['reserve_gib', 1, 1024, 'Free-space reserve'], ['settle_seconds', 30, 3600, 'File quiet time']]) {
    const value = typeof config[field] === 'string' && config[field].trim() ? Number(config[field]) : config[field];
    if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`${label} must be a whole number from ${min} to ${max}.`);
    config[field] = value;
  }
  if (typeof config.recursive !== 'boolean') throw Error('Choose whether to include subfolders.');
  return Object.fromEntries(Object.keys(DEFAULT_LIBRARY_CONFIG).map(key => [key, config[key]]));
}

export function cameraConfig(values) {
  const name = values.name?.trim(), host = values.host?.trim(), path = values.path?.trim();
  if (!name) throw Error('Give this camera or DVR channel a name.');
  const octets = host?.split('.');
  if (!octets || octets.length !== 4 || !octets.every(n => /^(0|[1-9]\d{0,2})$/.test(n) && Number(n) <= 255)) throw Error('Enter the private IPv4 address shown by your camera or DVR.');
  const [a, b] = octets.map(Number);
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) throw Error('Use a camera or DVR on your private local network (10.x, 172.16–31.x or 192.168.x).');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Enter an RTSP port from 1 to 65535.');
  if (!path?.startsWith('/') || path.startsWith('//') || /[\r\n\s#]/.test(values.path)) throw Error('Enter the channel path from your camera or DVR documentation, beginning with /.');
  return {name, host, port, path, username: values.username || '', password: values.password || ''};
}

export async function openLibraryItem(item, token, signal, fetcher = fetch) {
  if (item?.state !== 'completed' || !/^[a-f0-9]{32}$/.test(item.id) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('Choose a completed backup analysis.');
  if (item.bytes > MAX_VIDEO_BYTES) throw Error('This backup is too large for browser review. The saved copy remains in your backup folder.');
  const request = path => libraryRequest(`/items/${item.id}/${path}`, {token, signal, fetcher, timeout: 120000});
  const bundle = parseRecognition(JSON.parse(await (await boundedBody(await request('result'), MAX_REVIEW_BYTES)).text()));
  if (bundle.receipt.source_sha256 !== item.sha256) throw Error('The backup result fingerprint changed. Refresh status before reviewing.');
  const file = await boundedBody(await request('source'), MAX_VIDEO_BYTES);
  await matchRecording(file, item.sha256);
  if (signal?.aborted) throw new DOMException('Opening cancelled', 'AbortError');
  return {bundle, file, name: item.name};
}

export function libraryCoverage(item) {
  if (item?.state !== 'completed') return '';
  if (item.coverage === 'completed') return 'Analysis coverage: completed';
  if (item.coverage === 'partial') return 'Partial analysis — recording limits reached';
  if (!item.coverage || typeof item.coverage !== 'object') return 'Recording coverage unverified';
  if (['frame-limit','event-limit'].includes(item.coverage.termination) || item.coverage.status === 'unverified' ||
      (item.coverage.status === 'inventory-matched' && item.coverage.termination === 'source-end')) {
    return coverageLabel({media_coverage: item.coverage, state: item.coverage.status === 'inventory-matched' ? 'completed' : 'partial'});
  }
  return 'Recording coverage unverified';
}

export const storageSize = bytes => Number.isFinite(bytes) ? bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB` : 'not available';
