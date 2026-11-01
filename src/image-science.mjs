// Bounded, deterministic RGB image diagnostics. No camera requests, model inference or network.
export const FULL_FRAME = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

export function regionBounds(region = FULL_FRAME, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new RangeError('Unsupported image dimensions');
  }
  const x = clamp(region?.x ?? 0, 0, 1);
  const y = clamp(region?.y ?? 0, 0, 1);
  const right = clamp(x + (region?.width ?? 1), x, 1);
  const bottom = clamp(y + (region?.height ?? 1), y, 1);
  const left = Math.min(width - 1, Math.floor(x * width));
  const top = Math.min(height - 1, Math.floor(y * height));
  return { left, top, right: Math.max(left + 1, Math.ceil(right * width)), bottom: Math.max(top + 1, Math.ceil(bottom * height)) };
}

function check(image) {
  if (!image || !image.data || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 4096 ||
      image.data.length !== image.width * image.height * 4) {
    throw new TypeError('Expected bounded RGBA image data');
  }
}

// Channel-weighted 8-bit sRGB luma proxy, not linear-light photometry.
// Treat raw RGBA the same way as the UI's explicitly black-composited canvas.
// Alpha differences must not disappear from A/B comparisons.
function luma(data, offset) {
  const alpha = data[offset + 3] / 255;
  return Math.round((0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) * alpha);
}

export function analyzeImage(image, region = FULL_FRAME) {
  check(image);
  const { width, height, data } = image, bounds = regionBounds(region, width, height);
  const shades = new Uint8Array(width * height), bins = new Array(16).fill(0);
  const values = new Uint32Array(256);
  let sum = 0, dark = 0, bright = 0, count = 0;
  // Compute full-frame luma for gradient operations, while only reporting selected pixels.
  for (let i = 0, p = 0; i < shades.length; i++, p += 4) shades[i] = luma(data, p);
  for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
    const value = shades[y * width + x];
    bins[value >> 4]++;
    values[value]++;
    sum += value; count++;
    if (value <= 15) dark++;
    if (value >= 240) bright++;
  }
  const percentile = fraction => {
    const target = Math.max(1, Math.ceil(count * fraction));
    let seen = 0;
    for (let i = 0; i < 256; i++) { seen += values[i]; if (seen >= target) return i; }
    return 255;
  };
  let edge = 0, edges = 0;
  // Sobel edge energy, computed only for interior pixels of the selected region.
  for (let y = bounds.top + 1; y < bounds.bottom - 1; y++) for (let x = bounds.left + 1; x < bounds.right - 1; x++) {
    const k = y * width + x;
    const gx = -shades[k - width - 1] + shades[k - width + 1] - 2 * shades[k - 1] + 2 * shades[k + 1] - shades[k + width - 1] + shades[k + width + 1];
    const gy = -shades[k - width - 1] - 2 * shades[k - width] - shades[k - width + 1] + shades[k + width - 1] + 2 * shades[k + width] + shades[k + width + 1];
    edge += Math.hypot(gx, gy) / (4 * 255);
    edges++;
  }
  return {
    pixels: count, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top,
    mean: sum / count, low: percentile(0.05), high: percentile(0.95),
    shadowPercent: dark / count * 100, highlightPercent: bright / count * 100,
    sobel: edges ? edge / edges * 100 : 0, histogram: bins
  };
}

export function compareImages(before, after, region = FULL_FRAME, threshold = 24) {
  check(before); check(after);
  if (before.width !== after.width || before.height !== after.height) return null;
  const { width, height } = before, bounds = regionBounds(region, width, height);
  const limit = clamp(threshold, 0, 255);
  let sum = 0, changed = 0, count = 0;
  for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
    const k = (y * width + x) * 4;
    const d = Math.abs(luma(before.data, k) - luma(after.data, k));
    sum += d;
    if (d >= limit && d > 0) changed++;
    count++;
  }
  return { meanAbsoluteDifference: sum / count, changedPercent: changed / count * 100, threshold: limit, pixels: count };
}

export function pixelRuler(start, end, width, height) {
  if (!start || !end) return null;
  regionBounds(FULL_FRAME, width, height);
  const dx = (clamp(end.x, 0, 1) - clamp(start.x, 0, 1)) * width;
  const dy = (clamp(end.y, 0, 1) - clamp(start.y, 0, 1)) * height;
  return Math.hypot(dx, dy);
}
