import { parseReceipt } from './data.mjs';
import { validateEnhancement } from './enhancement.mjs';
import { validateCoverage } from './media-coverage.mjs';
import { sha256File } from './sha256.mjs';

export const MAX_REVIEW_BYTES = 32 * 1024 ** 2;
export const MAX_VIDEO_BYTES = 512 * 1024 ** 2;
const finite = Number.isFinite;
const integer = (v, low, high) => Number.isSafeInteger(v) && v >= low && v <= high;
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const require = (ok, message) => { if (!ok) throw Error(message); };

export function parseRecognition(value) {
  require(value?.schema === 'intelligent-dvr.recognition-review.v1', 'Choose a recognition review JSON created with --review-output.');
  const { receipt: r, trace: t } = value;
  const events = parseReceipt(r);
  require(t?.schema === 'intelligent-dvr.detection-trace.v1' && t.origin === 'offline-analyzer', 'Missing analyzer frame trace.');
  for (const key of ['source_sha256', 'model_sha256', 'labels_sha256', 'rules_sha256', 'rules_file_sha256']) {
    require(hash(r[key]) && r[key] === t[key], 'Receipt and trace provenance do not match.');
  }
  require(text(r.camera, 80) && text(r.inference_profile, 80), 'Invalid camera or inference profile.');
  for (const key of ['camera', 'inference_profile', 'state', 'frames_read', 'fps_metadata', 'stride']) {
    require(r[key] === t[key], 'Receipt and trace settings do not match.');
  }
  require(integer(r.frames_read, 1, 100000) && integer(r.stride, 1, 120) && finite(r.fps_metadata) && r.fps_metadata > 0, 'Invalid sampling metadata.');
  require(Array.isArray(t.frames) && t.frames.length > 0 && t.frames.length <= 10000 && t.frames.length === r.frames_analyzed && t.frames.length === Math.ceil(r.frames_read / r.stride), 'Incomplete or oversized frame trace.');
  require(JSON.stringify(r.events) === JSON.stringify(t.events), 'Receipt and trace observations do not match.');
  let count = 0;
  for (const [i, frame] of t.frames.entries()) {
    require(frame?.frame_index === i * r.stride && frame.frame_index < r.frames_read && finite(frame.seconds) && Math.abs(frame.seconds - frame.frame_index / r.fps_metadata) < 1e-6, 'Frame times do not match the sampling metadata.');
    require(integer(frame.width, 1, 16384) && integer(frame.height, 1, 16384) && frame.width * frame.height <= 3840 * 2160, 'Invalid frame dimensions.');
    require(Array.isArray(frame.detections) && (count += frame.detections.length) <= 100000, 'Oversized detection trace.');
    for (const d of frame.detections) {
      require(text(d?.label, 80) && finite(d.score) && d.score >= 0 && d.score <= 1 && Array.isArray(d.box) && d.box.length === 4 && d.box.every(finite), 'Invalid detection label, score or box.');
      const [x, y, w, h] = d.box;
      require(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.000001 && y + h <= 1.000001, 'Detection box extends outside its frame.');
    }
  }
  const eventFrames = r.events.map(e => Math.round(e.seconds * r.fps_metadata / r.stride));
  require(r.events.every((e, i) => e.camera === r.camera && t.frames[eventFrames[i]] && Math.abs(t.frames[eventFrames[i]].seconds - e.seconds) <= 1e-6), 'Observation refers to an unanalyzed frame or another camera.');
  const enhancement = validateEnhancement(r, t);
  const coverage = validateCoverage(r, t);
  return { receipt: r, trace: t, events, eventFrames, enhancement, coverage };
}

export function mergeRecognitionEvents(existing, added) {
  // Repeat imports preserve saved human decisions and notes for the same observation.
  const previous = new Map(existing.map(e => [e.id, e]));
  require(previous.size === existing.length && new Set(added.map(e => e.id)).size === added.length, 'Duplicate observation IDs are not allowed.');
  for (const event of added) {
    const old = previous.get(event.id);
    if (!old) continue;
    // An ID alone is not evidence that two unsigned observations are the same.
    const keys = ['mode', 'camera', 'cameraName', 'title', 'label', 'time', 'score', 'rule'];
    require(keys.every(key => old[key] === event[key]) &&
      ['source_sha256', 'model_sha256'].every(key => old.provenance?.[key] === event.provenance?.[key]),
      'An observation ID conflicts with different evidence already in the queue. Export and clear the queue before reviewing this file separately.');
  }
  const ids = new Set(added.map(e => e.id));
  const merged = [...added.map(e => {
    const old = previous.get(e.id);
    // A restored decision fills a pending entry; current human decisions win.
    return !old || (old.status === 'pending' && ['confirmed', 'dismissed'].includes(e.status)) ? e : old;
  }), ...existing.filter(e => !ids.has(e.id))];
  require(merged.length <= 1000, 'The review queue would exceed 1,000 events. Export and clear earlier reviews before importing this run.');
  return merged;
}

export function frameSummary(frame, threshold = 0.5) {
  require(finite(threshold) && threshold >= 0.1 && threshold <= 1, 'Display threshold must be 0.10–1.00.');
  const detections = frame.detections.filter(d => d.score >= threshold);
  const counts = new Map();
  for (const d of detections) counts.set(d.label, (counts.get(d.label) || 0) + 1);
  return { detections, counts: [...counts].sort(([a], [b]) => a.localeCompare(b)) };
}

// Never hold old boxes over moving footage, an unrelated frame, or an unmatched file.
export function canShowBoxes(frame, fps, { matched, ready, paused, seeking, seconds, width, height }) {
  return Boolean(matched && ready && paused && !seeking && finite(seconds) &&
    Math.abs(seconds - frame.seconds) <= 0.5 / fps && width === frame.width && height === frame.height);
}

// Vite bundles this literal worker URL; Node and worker-less contexts hash on the same thread.
const recordingWorker = () => typeof Worker === 'function'
  ? new Worker(new URL('./sha256-worker.mjs', import.meta.url), { type: 'module' }) : null;

// Streams 4 MiB slices (no whole-recording buffer, no secure-context requirement). An
// aborted options.signal rejects with its reason and stops reading.
export async function matchRecording(file, expectedHash, { signal, createWorker = recordingWorker } = {}) {
  require(hash(expectedHash), 'Invalid source fingerprint.');
  require(file && file.size > 0 && file.size <= MAX_VIDEO_BYTES, 'Choose a nonempty recording up to 512 MiB; split larger recordings before analysis.');
  const actual = await sha256File(file, { signal, createWorker });
  require(actual === expectedHash, 'This recording does not match the analyzed source. Choose the original file; no boxes have been attached.');
  return actual;
}
