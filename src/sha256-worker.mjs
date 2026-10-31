import { sha256Blob } from './sha256.mjs';

// One Blob in, one {hash} out. Errors carry no file details; the page falls back and reports.
self.onmessage = async ({ data }) => {
  try { self.postMessage({ hash: await sha256Blob(data, { yieldBetween: false }) }); } catch { self.postMessage({ failed: true }); }
};
