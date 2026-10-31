// Small stills kept in this browser only (IndexedDB). Every call fails soft: no storage means no image.
const DB = 'intelligent-dvr', VERSION = 1;
export const STORES = ['thumbnails', 'zone-stills'];
// A still written moments ago may belong to observations that are still being added to the queue.
const GRACE_MS = 60_000;
let opening = null;

function open() {
  if (!globalThis.indexedDB) return Promise.reject(Error('IndexedDB is unavailable'));
  opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Image storage is blocked by another tab'));
  }).catch(error => { opening = null; throw error; });
  return opening;
}

async function transact(store, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let value;
    work(tx.objectStore(store), result => { value = result; });
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error || Error('Image storage failed'));
  });
}

export async function putImage(store, key, blob) {
  try { await transact(store, 'readwrite', s => s.put({blob, at: Date.now()}, key)); return true; } catch { return false; }
}

export async function getImage(store, key) {
  try {
    return await transact(store, 'readonly', (s, done) => { const r = s.get(key); r.onsuccess = () => done(r.result?.blob || null); });
  } catch { return null; }
}

export async function deleteImage(store, key) {
  try { await transact(store, 'readwrite', s => s.delete(key)); return true; } catch { return false; }
}

// Remove stills whose key is no longer kept, except very recent ones.
export async function pruneImages(store, keep, now = Date.now()) {
  try {
    return await transact(store, 'readwrite', (s, done) => {
      let removed = 0;
      const cursor = s.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return done(removed);
        if (!keep.has(c.key) && !(now - (c.value?.at || 0) < GRACE_MS)) { c.delete(); removed++; }
        c.continue();
      };
    });
  } catch { return 0; }
}

function once(target, ok, timeout) {
  return new Promise((resolve, reject) => {
    const done = error => { clearTimeout(timer); target.removeEventListener(ok, pass); target.removeEventListener('error', fail); error ? reject(error) : resolve(); };
    const pass = () => done(), fail = () => done(Error('The recording could not be read for stills.'));
    const timer = setTimeout(() => done(Error('Reading stills timed out.')), timeout);
    target.addEventListener(ok, pass); target.addEventListener('error', fail);
  });
}

// Draw small JPEG stills at the given recording times from a verified local Blob or blob: URL.
export async function captureStills(source, times, {width = 160, quality = .7, limit = 200, signal} = {}) {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source), video = document.createElement('video');
  const stills = new Map();
  video.muted = true; video.preload = 'auto'; video.playsInline = true;
  try {
    const ready = once(video, 'loadeddata', 15000);
    video.src = url;
    await ready;
    if (!video.videoWidth || !video.videoHeight) return stills;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
    const context = canvas.getContext('2d');
    for (const seconds of [...new Set(times)].filter(Number.isFinite).slice(0, limit)) {
      if (signal?.aborted) break;
      const seeked = once(video, 'seeked', 5000);
      video.currentTime = Math.max(0, Math.min(seconds, (video.duration || seconds) - 0.001));
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob) stills.set(seconds, blob);
    }
  } finally {
    video.removeAttribute('src'); video.load();
    if (url !== source) URL.revokeObjectURL(url);
  }
  return stills;
}

// Capture and store one still per observation; returns how many were saved.
export async function saveObservationStills(source, run, options) {
  const times = run.events.map((_, i) => run.trace.frames[run.eventFrames[i]]?.seconds);
  let stills;
  try { stills = await captureStills(source, times, options); } catch { return 0; }
  let saved = 0;
  for (const [i, event] of run.events.entries()) {
    const blob = stills.get(times[i]);
    if (blob && await putImage('thumbnails', event.id, blob)) saved++;
  }
  return saved;
}

// Copy the frame currently shown by an <img> or <video> into a JPEG; re-encoding drops file metadata.
export async function grabFrame(element, {maxWidth = 1920, quality = .85} = {}) {
  const width = element.videoWidth || element.naturalWidth, height = element.videoHeight || element.naturalHeight;
  if (!width || !height) throw Error('No image is available from this source yet.');
  const scale = Math.min(1, maxWidth / width), canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(element, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw Error('This image could not be captured.');
  return {blob, width: canvas.width, height: canvas.height};
}

export async function imageFileFrame(file) {
  if (!file?.type?.startsWith('image/') || file.size > 20 * 1024 ** 2) throw Error('Choose a JPEG, PNG or WebP image up to 20 MiB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('This image could not be opened.')); image.src = url; });
    return await grabFrame(image);
  } finally { URL.revokeObjectURL(url); }
}
