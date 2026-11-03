// Real map layers for Facility Studio. Every external request is made only after the
// user chooses Streets or Aerial; Grid (local geometry only) stays the default.
export const BASEMAP_KEY = 'dvr.facility.basemap';
export const BASEMAP_FADE_KEY = 'dvr.facility.basemapFade';
export const BASEMAPS = [
  { id: 'grid', label: 'Grid', title: 'Local grid', external: false,
    disclosure: 'Local plan geometry only. No map pictures are requested.' },
  { id: 'streets', label: 'Streets', title: 'Streets · OpenStreetMap', external: true, host: 'tile.openstreetmap.org',
    tiles: ['dvr-osm://tiles/{z}/{x}/{y}.png'], maxzoom: 19, coverage: 'world',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    disclosure: 'Your browser requests street-map pictures of the area you view from tile.openstreetmap.org and identifies the request with the app’s origin. Building outlines appear where volunteers have mapped them.' },
  { id: 'aerial', label: 'Aerial', title: 'Aerial · USGS The National Map', external: true, host: 'basemap.nationalmap.gov', photoHost: 'imagery.nationalmap.gov',
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, coverage: 'us',
    // Acknowledgment wording requested by USGS for The National Map services.
    attribution: 'Map services and data available from <a href="https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map" target="_blank" rel="noreferrer">U.S. Geological Survey, National Geospatial Program</a> · USDA NAIP imagery',
    disclosure: 'Your browser requests aerial pictures of the area you view from basemap.nationalmap.gov and one sharper site photo from imagery.nationalmap.gov (U.S. Geological Survey). Coverage is the contiguous United States.' },
];
export const basemap = id => BASEMAPS.find(b => b.id === id) || BASEMAPS[0];
// OSM sometimes returns HTTP 200 with a warning PNG. Cross-origin requests may
// hide X-Blocked, so also recognize the exact two examples published by OSMF:
// https://community.openstreetmap.org/t/133421/1
const blockedStreetImages = new Map([
  [7412, '6eabebf6e8f2ff16f9109c808d7e7a0228fed0235a05c074b4a1ef99f964edfd'],
  [7044, '7f1c4a9af4d86ed75964a017a36497d123613628f34e22c2493be14f89a24bae'],
]);
export class StreetTileBlocked extends Error {
  constructor() { super('OpenStreetMap declined the street map request.'); }
}

export async function loadStreetTile({ url }, { signal }, fetcher = fetch) {
  const tile = /^dvr-osm:\/\/tiles\/(\d+\/\d+\/\d+\.png)$/.exec(url);
  if (!tile) throw Error('Invalid street tile address.');
  const response = await fetcher(`https://tile.openstreetmap.org/${tile[1]}`, {
    signal, headers: { Accept: 'image/png' }, referrerPolicy: 'strict-origin',
    credentials: 'omit', redirect: 'error',
  });
  if (response.status === 403 || response.status === 429 || response.headers.has('x-blocked')) {
    throw new StreetTileBlocked();
  }
  if (!response.ok) throw Error(`Street map unavailable (HTTP ${response.status}).`);
  const data = await response.arrayBuffer();
  const expected = blockedStreetImages.get(data.byteLength);
  if (expected && globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    if (Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') === expected) throw new StreetTileBlocked();
  }
  return { data, cacheControl: response.headers.get('cache-control'), expires: response.headers.get('expires') };
}

const FADES = [0.4, 0.55, 0.7, 0.85, 1];
export const DEFAULT_FADE = 0.85;
// Reading window.localStorage itself throws when the browser blocks site storage, so it is
// resolved inside each guard; without storage the layer falls back to Grid and is not remembered.
const storageOf = storage => storage === undefined ? globalThis.localStorage : storage;
export function readBasemapPreference(storage) {
  let id = 'grid', fade = DEFAULT_FADE;
  try {
    const store = storageOf(storage);
    id = basemap(store?.getItem(BASEMAP_KEY)).id;
    const stored = Number(store?.getItem(BASEMAP_FADE_KEY));
    if (FADES.includes(stored)) fade = stored;
  } catch {}
  return { id, fade };
}
export function writeBasemapPreference({ id, fade }, storage) {
  try {
    const store = storageOf(storage);
    store?.setItem(BASEMAP_KEY, basemap(id).id);
    if (FADES.includes(fade)) store?.setItem(BASEMAP_FADE_KEY, String(fade));
  } catch {}
}
export const fadeChoices = () => [...FADES];
// The NAIP mosaic covers the conterminous United States. This box is deliberately coarse:
// parts of Canada and Mexico fall inside it and simply return no imagery (transparent pixels).
export function inAerialCoverage([lng, lat]) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -125 && lng <= -66.5 && lat >= 24.3 && lat <= 49.5;
}
// One sharper 800 m photo of the site area from the NAIP image service (about 0.6 m per pixel);
// the service renders it on request, which has taken 6–45 s in testing.
// The cached tiles stop at zoom 16 (about 2 m per pixel), which is too coarse to trace a roof.
export const SITE_PHOTO = {
  url: 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage',
  halfSize: 400, pixels: 1360, maxBytes: 6e6, timeout: 60000,
};
const R = 6378137, HALF_WORLD = Math.PI * R;
const toMercator = ([lng, lat]) => [lng * HALF_WORLD / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * R];
const fromMercator = ([x, y]) => [x * 180 / HALF_WORLD, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
export function sitePhotoRequest(center, { halfSize = SITE_PHOTO.halfSize, pixels = SITE_PHOTO.pixels } = {}) {
  if (!inAerialCoverage(center)) throw Error('Aerial photos cover the contiguous United States only.');
  const [x, y] = toMercator(center), half = halfSize / Math.cos(center[1] * Math.PI / 180);
  const box = [x - half, y - half, x + half, y + half];
  const params = new URLSearchParams({ bbox: box.map(v => v.toFixed(2)).join(','), bboxSR: '3857', imageSR: '3857',
    size: `${pixels},${pixels}`, format: 'jpgpng', f: 'image' });
  // MapLibre image sources take corners clockwise from the top left.
  const coordinates = [[box[0], box[3]], [box[2], box[3]], [box[2], box[1]], [box[0], box[1]]].map(fromMercator);
  return { url: `${SITE_PHOTO.url}?${params}`, coordinates, metresPerPixel: 2 * halfSize / pixels, key: center.map(v => v.toFixed(5)).join(',') };
}
// Reads at most maxBytes of an image; the caller owns and must revoke the returned object URL.
export async function loadSitePhoto(request, signal, fetcher = fetch, { maxBytes = SITE_PHOTO.maxBytes, timeout = SITE_PHOTO.timeout } = {}) {
  const timed = AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]);
  const response = await fetcher(request.url, { signal: timed, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!response.ok) throw Error(`Aerial photo service unavailable (${response.status}).`);
  const type = response.headers.get('content-type') || '';
  if (!/^image\/(jpeg|png)\b/.test(type)) throw Error('Aerial photo service did not return an image.');
  if (Number(response.headers.get('content-length')) > maxBytes) throw Error('Aerial photo is larger than expected.');
  if (!response.body) throw Error('Aerial photo service returned no data.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('Aerial photo is larger than expected.');
      chunks.push(value);
    }
  } catch (e) { await reader.cancel().catch(() => {}); throw e; }
  finally { reader.releaseLock(); }
  timed.throwIfAborted();
  return new Blob(chunks, { type: type.split(';')[0] });
}
export function photoFailure(e) {
  return e?.name === 'TimeoutError' ? 'The sharper aerial photo timed out. Coarser aerial pictures are still shown.' :
    e?.name === 'TypeError' ? 'Could not reach the aerial photo service. Coarser pictures may still show; check the connection.' :
    (e?.message || 'The sharper aerial photo could not be loaded.');
}
