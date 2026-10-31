const require = (ok, message) => { if (!ok) throw Error(message); };
const finite = (n, low=0, high=1e12) => Number.isFinite(n) && n >= low && n <= high;
const integer = n => Number.isInteger(n) && n >= 1 && n <= 100000;
const fields = ['schema','source_sha256','status','termination','analysis_frames','validated_frames',
  'declared_frames','declared_duration_seconds','decoded_duration_seconds','duration_tolerance_seconds','anchor','validator_version'].sort();

export function validateCoverage(receipt, trace) {
  const present=Object.hasOwn(receipt,'media_coverage');
  require(present === Object.hasOwn(trace,'media_coverage'), 'Receipt and trace coverage do not match.');
  if (!present) return null; // Historical unsigned files remain readable, explicitly unverified.
  const c=receipt.media_coverage, other=trace.media_coverage;
  const shape=value=>value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.join(',');
  require(shape(c) && shape(other) && fields.every(k=>c[k] === other[k]), 'Receipt and trace coverage do not match.');
  require(c.schema === 'intelligent-dvr.media-coverage.v1' && c.source_sha256 === receipt.source_sha256 &&
    integer(c.analysis_frames) && c.analysis_frames === receipt.frames_read && Number.isInteger(c.validated_frames) && c.validated_frames >= 0 && c.validated_frames <= 100000 &&
    ['not-checked','unverified','inventory-matched'].includes(c.status) && ['source-end','frame-limit','event-limit'].includes(c.termination), 'Invalid media coverage.');
  require(c.declared_frames === null || (integer(c.declared_frames) && c.declared_frames === receipt.frames_read), 'Recording frame inventory differs.');
  require(['declared_duration_seconds','decoded_duration_seconds','duration_tolerance_seconds'].every(k=>c[k] === null || finite(c[k],.000000001)), 'Invalid coverage duration.');
  if(c.status === 'not-checked') {
    require(receipt.state === 'partial' && c.termination !== 'source-end' && c.validated_frames === 0 && c.anchor === 'none' &&
      ['declared_frames','declared_duration_seconds','decoded_duration_seconds','duration_tolerance_seconds','validator_version'].every(k=>c[k] === null), 'Invalid unchecked coverage.');
    return c;
  }
  require(c.termination === 'source-end' && c.validated_frames === c.analysis_frames && typeof c.validator_version === 'string' && c.validator_version.length > 0 && c.validator_version.length <= 40, 'Invalid decoded coverage.');
  const anchors=[...(c.declared_frames !== null ? ['frames'] : []),...(c.declared_duration_seconds !== null && c.decoded_duration_seconds !== null ? ['duration'] : [])];
  require(c.anchor === (anchors.join('+') || 'none'), 'Invalid coverage inventory anchor.');
  if(anchors.includes('duration')) require(c.duration_tolerance_seconds !== null && c.duration_tolerance_seconds <= 3600 && Math.abs(c.declared_duration_seconds-c.decoded_duration_seconds) <= c.duration_tolerance_seconds, 'Recording duration inventory differs.');
  else require(c.duration_tolerance_seconds === null, 'Unexpected coverage tolerance.');
  require((receipt.state === 'completed' && c.status === 'inventory-matched' && anchors.length > 0) ||
    (receipt.state === 'partial' && c.status === 'unverified' && anchors.length === 0), 'Coverage does not justify analysis state.');
  return c;
}

export function coverageLabel(receipt) {
  const c=receipt.media_coverage;
  if (!c) return receipt.state === 'partial' ? 'PARTIAL · legacy result; coverage unverified' : 'Legacy result · recording coverage unverified';
  if (c.termination === 'frame-limit') return 'PARTIAL · decoded-frame limit reached';
  if (c.termination === 'event-limit') return 'PARTIAL · observation limit reached';
  if (c.status === 'unverified') return 'PARTIAL · recording completeness unverified';
  return 'Decoded recording inventory matched';
}
