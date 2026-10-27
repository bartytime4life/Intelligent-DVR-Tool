// Only user-triggered requests. No address/area cache is persisted to disk.
const configuredPrefix = import.meta.env?.VITE_FACILITY_LOCAL_PREFIX || '/geo';
const localPrefix = /^\/[A-Za-z0-9/_-]+$/.test(configuredPrefix) ? configuredPrefix.replace(/\/$/,'') : '/geo';
export const GEOCODERS = [
  { id: 'public', label: 'Photon public demo', url: 'https://photon.komoot.io/api/' },
  { id: 'local', label: 'Local Photon service', url: localPrefix + '/search' },
];
export const FOOTPRINT_SERVICES = [
  { label: 'Private.coffee public Overpass', url: 'https://overpass.private.coffee/api/interpreter' },
  { label: 'OSM public Overpass', url: 'https://overpass-api.de/api/interpreter' },
  { label: 'Local Overpass service', url: localPrefix + '/overpass' },
];
export async function boundedJson(response, maxBytes = 2e6) {
  if (!response.ok) throw Error(response.status === 429 ? 'Service is busy. Wait before retrying; no automatic retry is made.' : `Service unavailable (${response.status}). Use an offline extract or try later.`);
  if (!response.body) throw Error('Service returned no response body.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error(`Response exceeds ${maxBytes === 2e6 ? '2 MB' : 'the size limit'}. Reduce the area.`);
      chunks.push(value);
    }
  } catch (e) { await reader.cancel(); throw e; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Error('Service did not return valid JSON. Check the local service or import an extract.'); }
}
export function parsePlaces(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > 10) throw Error('Invalid address response.');
  return data.features.flatMap((f) => {
    const p = f?.geometry?.coordinates, props = f?.properties;
    if (f?.geometry?.type !== 'Point' || !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 80 || !props) return [];
    const label = [props.name, [props.housenumber, props.street].filter(Boolean).join(' '), props.city, props.state, props.country].filter(v => typeof v === 'string' && v.trim()).join(', ').slice(0, 300);
    return label ? [{ label, origin: [...p] }] : [];
  });
}
export function createPlaceSearch(fetcher = fetch, clock = Date.now) {
  const cache = new Map();
  let active = false, last = -Infinity;
  return async (query, provider, signal) => {
    const service = GEOCODERS.find(p => p.id === provider);
    const q = query.trim();
    if (!service || q.length < 3 || q.length > 180) throw Error('Enter an address or place name of 3–180 characters.');
    signal?.throwIfAborted();
    const key = service.id + ':' + q.toLowerCase();
    if (cache.has(key)) return structuredClone(cache.get(key));
    if (active || clock() - last < 1500) throw Error('Wait a moment before searching again.');
    active = true; last = clock();
    try {
      const timed = AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]);
      const response = await fetcher(service.url + '?' + new URLSearchParams({q, limit: '5', lang: 'en'}), {signal: timed, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'});
      const places = parsePlaces(await boundedJson(response, 100000));
      timed.throwIfAborted();
      if (cache.size >= 20) cache.delete(cache.keys().next().value);
      cache.set(key, places);
      return structuredClone(places);
    } finally { active = false; }
  };
}
export const searchPlaces = createPlaceSearch();
