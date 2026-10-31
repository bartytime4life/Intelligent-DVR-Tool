// Incremental SHA-256 (FIPS 180-4) in plain JS: hashes Blob slices without the
// full-recording ArrayBuffer that WebCrypto's one-shot digest requires.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export const CHUNK_BYTES = 4 * 1024 ** 2;

export class Sha256 {
  constructor() {
    this.h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.w = new Uint32Array(64); this.pending = new Uint8Array(64); this.used = 0; this.bytes = 0; this.done = false;
  }
  update(data) {
    if (this.done) throw Error('SHA-256 already finalized.');
    let offset = 0; this.bytes += data.length;
    if (this.used) {
      offset = Math.min(64 - this.used, data.length);
      this.pending.set(data.subarray(0, offset), this.used); this.used += offset;
      if (this.used < 64) return this;
      this.block(this.pending, 0); this.used = 0;
    }
    for (; offset + 64 <= data.length; offset += 64) this.block(data, offset);
    if (offset < data.length) { this.pending.set(data.subarray(offset)); this.used = data.length - offset; }
    return this;
  }
  block(data, offset) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++, offset += 4) w[i] = data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = w[i - 16] + ((x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ x >>> 3) + w[i - 7] +
        ((y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ y >>> 10);
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = k + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + (e & f ^ ~e & g) + K[i] + w[i] | 0;
      const t2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + (a & b ^ a & c ^ b & c) | 0;
      k = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  hex() {
    const bytes = this.bytes, tail = new Uint8Array((this.used < 56 ? 64 : 128) - this.used);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer); // 64-bit big-endian bit length, exact below 2^53 bytes.
    view.setUint32(tail.length - 8, Math.floor(bytes / 0x20000000)); view.setUint32(tail.length - 4, (bytes % 0x20000000) * 8);
    this.update(tail); this.done = true;
    return [...this.h].map(x => x.toString(16).padStart(8, '0')).join('');
  }
}

const aborted = signal => signal.reason ?? new DOMException('Recording verification cancelled', 'AbortError');
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

// Reads one bounded slice at a time and (on the page) yields between slices; abort stops it.
export async function sha256Blob(blob, {signal, chunkBytes = CHUNK_BYTES, yieldBetween = true} = {}) {
  const hash = new Sha256();
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    if (signal?.aborted) throw aborted(signal);
    hash.update(new Uint8Array(await blob.slice(offset, offset + chunkBytes).arrayBuffer()));
    if (yieldBetween) await pause();
  }
  if (signal?.aborted) throw aborted(signal);
  return hash.hex();
}

// Prefer a module worker (the page stays responsive); any worker failure falls back to
// the same-thread loop, which produces the definitive result or read error.
export function sha256File(blob, {signal, createWorker} = {}) {
  if (signal?.aborted) return Promise.reject(aborted(signal));
  let worker = null;
  try { worker = createWorker?.() ?? null; } catch { worker = null; }
  if (!worker) return sha256Blob(blob, {signal});
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => { settled = true; worker.terminate(); signal?.removeEventListener('abort', cancel); };
    const cancel = () => { if (!settled) { finish(); reject(aborted(signal)); } };
    const fallback = event => { event?.preventDefault?.(); if (!settled) { finish(); sha256Blob(blob, {signal}).then(resolve, reject); } };
    signal?.addEventListener('abort', cancel, {once: true});
    worker.onmessage = ({data}) => {
      if (settled) return;
      if (typeof data?.hash === 'string' && /^[a-f0-9]{64}$/.test(data.hash)) { finish(); resolve(data.hash); } else fallback();
    };
    worker.onerror = fallback; worker.onmessageerror = fallback;
    try { worker.postMessage(blob); } catch { fallback(); }
  });
}
