// The Training Lab scores one-to-one, same-class box matches on reviewed evaluation frames.
const pin = 'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063';
const digest = /^[0-9a-f]{64}$/;
const labels = new Set(['person', 'car']);
export const maxReceiptBytes = 16 * 1024 * 1024;

function validBox(item) {
  if (!labels.has(item?.label) || !Array.isArray(item.box) || item.box.length !== 4 ||
      !item.box.every(Number.isFinite)) return false;
  const [x, y, w, h] = item.box;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.00001 && y + h <= 1.00001;
}

function overlap([x, y, w, h], [a, b, c, d]) {
  const width = Math.max(0, Math.min(x + w, a + c) - Math.max(x, a));
  const height = Math.max(0, Math.min(y + h, b + d) - Math.max(y, b));
  const intersection = width * height;
  return intersection / (w * h + c * d - intersection);
}

function score(frame, predictions, threshold, counts) {
  if (frame.reviewed !== true || !Array.isArray(frame.labels) || frame.labels.length > 100 ||
      !frame.labels.every(validBox) || !Array.isArray(predictions) || predictions.length > 1000 ||
      !predictions.every(p => validBox(p) && Number.isFinite(p.score) && p.score >= 0 && p.score <= 1)) {
    throw Error('The receipt contains incomplete labels or invalid predictions.');
  }
  const matched = new Set();
  for (const p of predictions.filter(p => p.score >= threshold).sort((a, b) => b.score - a.score)) {
    let best = -1;
    let bestOverlap = 0.499999999; // Match the v1 Lab evaluator's boundary and tie handling.
    frame.labels.forEach((label, i) => {
      if (label.label !== p.label || matched.has(i)) return;
      const value = overlap(label.box, p.box);
      if (value > bestOverlap) { best = i; bestOverlap = value; }
    });
    if (best < 0) counts.fp++;
    else matched.add(best);
  }
  counts.tp += matched.size;
  counts.fn += frame.labels.length - matched.size;
  counts.frames++;
}

export async function readLabReceipt(file) {
  if (!file || !file.size || file.size > maxReceiptBytes) throw Error('Choose a Training Lab receipt up to 16 MiB.');
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw Error('Choose the JSON receipt exported from Training Lab Reports.'); }
  if (data?.schema !== 'intelligent-dvr.lab-receipt.v1' || !digest.test(data.receipt_payload_sha256)) {
    throw Error('In Training Lab, open Reports and download the JSON run receipt.');
  }
  const { receipt_payload_sha256: expected, hash_method, ...payload } = data;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  if (Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('') !== expected) {
    throw Error('The receipt fingerprint differs from the exported contents. Export the run again.');
  }
  const fixture = payload.data_kind === 'synthetic' && payload.engine === 'pixel-components-v1' && payload.backend === 'browser-javascript';
  const native = payload.data_kind === 'recording' && payload.model?.sha256 === pin &&
    payload.engine === 'opencv-zoo-yolox-s-2022nov' && ['opencv-cpu','onnxruntime-cuda'].includes(payload.backend);
  const threshold = payload.settings?.threshold;
  if (!(fixture || native) || payload.settings?.iou !== .5 || !Number.isFinite(threshold) ||
      threshold < 0 || threshold > 1 || !Array.isArray(payload.sources) || payload.sources.length > 12) {
    throw Error('This receipt uses an unsupported scoring method or detector.');
  }
  const counts = { frames: 0, tp: 0, fp: 0, fn: 0 };
  const sources = new Set(), frames = new Set();
  for (const source of payload.sources) {
    if (!digest.test(source?.sha256) || sources.has(source.sha256) || !['train','eval'].includes(source.split) ||
        !Array.isArray(source.frames) || !source.frames.length || source.frames.length > 16) {
      throw Error('The dataset has duplicate sources or unreadable frame records.');
    }
    sources.add(source.sha256);
    for (const frame of source.frames) {
      if (typeof frame?.id !== 'string' || frames.has(frame.id) || frames.size >= 96) throw Error('Invalid or repeated sample frame.');
      frames.add(frame.id);
      if (source.split === 'eval') score(frame, Object.hasOwn(payload.predictions ?? {}, frame.id) ? payload.predictions[frame.id] : null, threshold, counts);
    }
  }
  if (!counts.frames || Object.keys(counts).some(key => counts[key] !== payload.metrics?.[key])) {
    throw Error('The held-out labels and predictions do not reproduce the recorded counts.');
  }
  // Explicit projection. No strings supplied by an operator, filenames, boxes or notes enter a prompt.
  return { stage: 'Training Lab receipt', scope: fixture ? 'synthetic' : 'imported recording', threshold, ...counts };
}

const steps = {
  inspect_misses: 'In Review, inspect missed labels. Look for occlusion, small objects, or samples where the label needs correction.',
  inspect_flags: 'Inspect unmatched detection boxes. Look for background objects or duplicate boxes that triggered a false alarm.',
  test_recording: 'Repeat the test on a separate, owner-authorized recording with independently reviewed labels.',
  check_labels: 'Review a second set of labeled frames from the same camera before choosing a setting.',
};

export function allowedSteps(summary) {
  return [...(summary.fn ? ['inspect_misses'] : []), ...(summary.fp ? ['inspect_flags'] : []),
    summary.scope === 'synthetic' ? 'test_recording' : 'check_labels'];
}

export function receiptAdvice(evidence, text) {
  const allowed = allowedSteps(evidence);
  if (text === undefined) return steps[allowed[0]];
  let reply;
  try { reply = JSON.parse(text); } catch { throw Error('The model returned an unreadable review suggestion.'); }
  if (!allowed.includes(reply?.action)) throw Error('The suggested action does not fit these measurements.');
  return steps[reply.action];
}
