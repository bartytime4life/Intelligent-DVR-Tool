import test from 'node:test';
import assert from 'node:assert/strict';
import { BASEMAPS, BASEMAP_KEY, BASEMAP_FADE_KEY, SITE_PHOTO, basemap, readBasemapPreference, writeBasemapPreference, inAerialCoverage, sitePhotoRequest, loadSitePhoto, photoFailure } from '../src/facility-basemap.mjs';
const memory = (values = {}) => ({ values, getItem(k) { return k in this.values ? this.values[k] : null; }, setItem(k, v) { this.values[k] = String(v); } });
const image = (bytes = 3, type = 'image/jpeg', headers = {}) => new Response(new Uint8Array(bytes), { headers: { 'content-type': type, ...headers } });

test('grid is the default layer and the only one that requests nothing', () => {
  assert.equal(readBasemapPreference(memory()).id, 'grid');
  assert.equal(readBasemapPreference(null).id, 'grid');
  assert.deepEqual(BASEMAPS.filter(b => !b.external).map(b => b.id), ['grid']);
  for (const layer of BASEMAPS.filter(b => b.external)) {
    assert.ok(layer.tiles.every(url => url.startsWith(`https://${layer.host}/`)), layer.id);
    assert.ok(layer.attribution && layer.disclosure.includes(layer.host), layer.id);
  }
  assert.equal(basemap('unknown').id, 'grid');
});

test('layer preferences are validated and survive storage failures', () => {
  const storage = memory();
  writeBasemapPreference({ id: 'aerial', fade: 0.55 }, storage);
  assert.deepEqual(readBasemapPreference(storage), { id: 'aerial', fade: 0.55 });
  assert.deepEqual(readBasemapPreference(memory({ [BASEMAP_KEY]: 'https://evil.example/{z}', [BASEMAP_FADE_KEY]: '0.01' })), { id: 'grid', fade: 0.85 });
  const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('full'); } };
  assert.doesNotThrow(() => writeBasemapPreference({ id: 'streets', fade: 1 }, broken));
  assert.equal(readBasemapPreference(broken).id, 'grid');
});

test('blocked browser storage falls back to Grid instead of throwing', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Object.assign(Error('blocked'), { name: 'SecurityError' }); } });
  try {
    assert.deepEqual(readBasemapPreference(), { id: 'grid', fade: 0.85 });
    assert.doesNotThrow(() => writeBasemapPreference({ id: 'aerial', fade: 0.55 }));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
});

test('aerial coverage is limited to the contiguous United States box', () => {
  assert.ok(inAerialCoverage([-98, 38.5]));
  assert.ok(inAerialCoverage([-122.27, 37.8]));
  assert.ok(!inAerialCoverage([11.2575, 46.4553]));
  assert.ok(!inAerialCoverage([-149.9, 61.2]), 'Alaska is not in the NAIP mosaic');
  assert.ok(!inAerialCoverage([NaN, 38]));
  assert.throws(() => sitePhotoRequest([11.2575, 46.4553]), /contiguous United States/);
});

test('the site photo is a square centred on the site at about 0.6 m per pixel', () => {
  const request = sitePhotoRequest([-94.7844298, 38.9698085]);
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, SITE_PHOTO.url);
  assert.equal(url.searchParams.get('bboxSR'), '3857');
  assert.equal(url.searchParams.get('size'), `${SITE_PHOTO.pixels},${SITE_PHOTO.pixels}`);
  assert.equal(url.searchParams.get('format'), 'jpgpng');
  assert.ok(Math.abs(request.metresPerPixel - 0.588) < 0.01);
  const [tl, tr, br, bl] = request.coordinates;
  assert.equal(tl[1], tr[1]); assert.equal(bl[1], br[1]); assert.equal(tl[0], bl[0]); assert.equal(tr[0], br[0]);
  // Ground width along the centre latitude: about 2 × halfSize metres.
  const metres = (tr[0] - tl[0]) * Math.PI / 180 * 6378137 * Math.cos(38.9698085 * Math.PI / 180);
  assert.ok(Math.abs(metres - 2 * SITE_PHOTO.halfSize) < 1, String(metres));
  const centre = [(tl[0] + tr[0]) / 2, (tl[1] + bl[1]) / 2];
  assert.ok(Math.abs(centre[0] + 94.7844298) < 1e-6 && Math.abs(centre[1] - 38.9698085) < 1e-4);
  assert.equal(sitePhotoRequest([-94.78443, 38.96981]).key, request.key, 'tiny origin edits reuse the loaded photo');
});

test('site photos are fetched without credentials and bounded in type and size', async () => {
  let options;
  const request = sitePhotoRequest([-98, 38.5]);
  const blob = await loadSitePhoto(request, undefined, async (url, o) => { options = o; return image(5); });
  assert.equal(blob.size, 5); assert.equal(blob.type, 'image/jpeg');
  assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
  await assert.rejects(() => loadSitePhoto(request, undefined, async () => image(5, 'text/html')), /did not return an image/);
  await assert.rejects(() => loadSitePhoto(request, undefined, async () => new Response('x', { status: 503 })), /unavailable \(503\)/);
  await assert.rejects(() => loadSitePhoto(request, undefined, async () => image(20), { maxBytes: 10 }), /larger than expected/);
  await assert.rejects(() => loadSitePhoto(request, undefined, async () => image(5, 'image/png', { 'content-length': '99' }), { maxBytes: 10 }), /larger than expected/);
  const controller = new AbortController();
  const pending = loadSitePhoto(request, controller.signal, (url, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(o.signal.reason))));
  controller.abort();
  await assert.rejects(() => pending, { name: 'AbortError' });
  assert.match(photoFailure(Object.assign(Error('t'), { name: 'TimeoutError' })), /timed out/);
});
