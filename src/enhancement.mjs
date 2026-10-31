// Additive comparison metadata; original detections remain the event source.
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const require = (ok, message) => { if (!ok) throw Error(message); };
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const parameters = {kernel_size:5, sigma:1, amount:.5, threshold:3, border:'reflect-101', scale:1};

export function validateEnhancement(receipt, trace) {
  const metadata = receipt.enhancement_comparison;
  const present = Object.hasOwn(receipt, 'enhancement_comparison');
  require(present === Object.hasOwn(trace, 'enhancement_comparison'), 'Receipt and trace sharpening declarations do not match.');
  if (!present) {
    require(trace.frames.every(f => !Object.hasOwn(f, 'comparison')), 'Sharpening samples have no declaration.');
    return null;
  }
  require(keys(metadata, ['schema','profile','parameters','implementation_sha256','qualification','rule_observations']) &&
    metadata.schema === 'intelligent-dvr.enhancement-comparison.v1' && metadata.profile === 'mild-unsharp-v1' &&
    metadata.qualification === 'unqualified' && metadata.rule_observations === 'original-only' && hash(metadata.implementation_sha256) &&
    keys(metadata.parameters, Object.keys(parameters)) && Object.entries(parameters).every(([k,v]) => metadata.parameters[k] === v),
    'Unknown sharpening profile, parameters or qualification.');
  const other = trace.enhancement_comparison;
  require(keys(other, Object.keys(metadata)) && Object.keys(metadata).filter(k => k !== 'parameters').every(k => metadata[k] === other[k]) &&
    keys(other.parameters, Object.keys(parameters)) && Object.entries(parameters).every(([k,v]) => other.parameters[k] === v),
    'Receipt and trace sharpening declarations do not match.');
  let count = trace.frames.reduce((sum,f) => sum + f.detections.length, 0);
  for (const frame of trace.frames) {
    const c = frame.comparison;
    require(keys(c, ['detections','original_processing_ms','enhanced_processing_ms','enhancement_ms','source_pixels_sha256','enhanced_pixels_sha256']) &&
      hash(c.source_pixels_sha256) && hash(c.enhanced_pixels_sha256) &&
      ['original_processing_ms','enhanced_processing_ms','enhancement_ms'].every(k => Number.isFinite(c[k]) && c[k] >= 0 && c[k] <= 1e12) &&
      c.enhancement_ms <= c.enhanced_processing_ms && Array.isArray(c.detections) &&
      (count += c.detections.length) <= 100000, 'Incomplete or oversized sharpening comparison.');
    for (const d of c.detections) {
      require(typeof d?.label === 'string' && d.label.length > 0 && d.label.length <= 80 &&
        Number.isFinite(d.score) && d.score >= .1 && d.score <= 1 && Array.isArray(d.box) && d.box.length === 4 && d.box.every(Number.isFinite),
        'Invalid sharpened detection.');
      const [x,y,w,h] = d.box;
      require(x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= 1.000001 && y+h <= 1.000001, 'Sharpened box extends outside its frame.');
    }
  }
  return metadata;
}

export function comparisonSummary(trace, threshold) {
  if (!trace.enhancement_comparison) return null;
  const classes = new Map();
  const samples = trace.frames.map(frame => {
    const row = {frame_index:frame.frame_index, seconds:frame.seconds, original:0, sharpened:0,
      original_processing_ms:frame.comparison.original_processing_ms, enhanced_processing_ms:frame.comparison.enhanced_processing_ms,
      source_pixels_sha256:frame.comparison.source_pixels_sha256, enhanced_pixels_sha256:frame.comparison.enhanced_pixels_sha256};
    for (const [kind, detections] of [['original',frame.detections],['sharpened',frame.comparison.detections]]) {
      for (const d of detections) if (d.score >= threshold) {
        row[kind]++;
        if (!classes.has(d.label)) classes.set(d.label, {label:d.label, original:0, sharpened:0});
        classes.get(d.label)[kind]++;
      }
    }
    return row;
  });
  const mean = field => samples.reduce((sum,s) => sum+s[field],0)/samples.length;
  return {declaration:trace.enhancement_comparison, classes:[...classes.values()].sort((a,b)=>a.label.localeCompare(b.label)), samples,
    mean_original_processing_ms:mean('original_processing_ms'), mean_enhanced_processing_ms:mean('enhanced_processing_ms'),
    qualification:'unqualified', rule_observations:'original-only'};
}
