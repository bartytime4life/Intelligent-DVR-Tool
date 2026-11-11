// Only validated, session-bound live replies may reach Monitor or its review list.
// Limits match edge/live_worker.py and the rule engine's 100-rule ceiling.
export const LIVE_REPLY_ERROR = 'Local AI sent an invalid or mismatched reply. AI stopped in this page; camera preview and earlier observations remain available. Run Check, then start AI again. Any unconfirmed local session expires after its 15-second lease.';
const fail = () => { throw Object.assign(Error(LIVE_REPLY_ERROR), {code:'LIVE_REPLY_INVALID'}); };
const need = value => { if (!value) fail(); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' && value.length <= limit * 2 && value.trim().length > 0 && [...value].length <= limit;
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const nonnegative = value => Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const score = value => nonnegative(value) && value <= 1;

export function parseLiveSession(value, expected = {}) {
  need(record(value) && value.state === 'live' && hex(value.id,32) && hex(value.model_sha256,64)
    && text(value.camera,80) && text(value.model,80) && text(value.rules,80));
  for (const key of ['id','camera','model_sha256','model','rules'])
    if (expected[key] !== undefined) need(value[key] === expected[key]);
  const session = Object.fromEntries(['id','state','camera','model_sha256','model','rules'].map(key => [key,value[key]]));
  for (const key of ['model_id','rules_id']) {
    if (value[key] !== undefined) {
      need(typeof value[key] === 'string' && /^[a-z0-9-]{1,40}$/.test(value[key]));
      if (expected[key] !== undefined) need(value[key] === expected[key]);
      session[key] = value[key];
    } else if (expected.id && expected[key] !== undefined) fail();
  }
  for (const key of ['analyzed','skipped_still']) if (value[key] !== undefined) {
    need(count(value[key])); session[key] = value[key];
  }
  if (value.tracks_by_label !== undefined) {
    need(record(value.tracks_by_label) && Object.keys(value.tracks_by_label).length <= 1000);
    need(Object.entries(value.tracks_by_label).every(([label,n]) => text(label,80) && count(n)));
    session.tracks_by_label = {...value.tracks_by_label};
  }
  if (value.runtime != null) {
    need(record(value.runtime) && ['opencv-cpu','onnxruntime-cuda'].includes(value.runtime.backend_id));
    session.runtime = {backend_id:value.runtime.backend_id};
  }
  if (value.acceleration != null) {
    need(record(value.acceleration) && text(value.acceleration.code,80));
    session.acceleration = {code:value.acceleration.code};
  }
  return session;
}

export function parseLiveFrame(value, expected) {
  need(record(value) && record(expected) && hex(expected.id,32) && hex(expected.model_sha256,64) && text(expected.camera,80));
  const session = parseLiveSession(value.session,expected);
  need(Number.isSafeInteger(value.width) && value.width >= 16 && Number.isSafeInteger(value.height)
    && value.height >= 16 && value.width * value.height <= 1920 * 1080);
  need(['ran','skipped-still'].includes(value.detector)
    && Array.isArray(value.detections) && value.detections.length <= 100
    && Array.isArray(value.observations) && value.observations.length <= 100);
  const detections = value.detections.map(d => {
    need(record(d) && text(d.label,80) && score(d.score) && Array.isArray(d.box)
      && d.box.length === 4 && d.box.every(Number.isFinite));
    const [x,y,w,h] = d.box;
    // Worker coordinates are rounded to five decimals; allow that boundary error.
    const edge = 1 + 1e-5 + Number.EPSILON * 4;
    need(x >= 0 && y >= 0 && w > 0 && h > 0 && x+w <= edge && y+h <= edge);
    if (d.track !== undefined) need(Number.isSafeInteger(d.track) && d.track > 0);
    return {label:d.label,score:d.score,box:[...d.box],...(d.track === undefined ? {} : {track:d.track})};
  });
  const seen = new Set();
  const observations = value.observations.map(o => {
    need(record(o) && hex(o.id,32) && !seen.has(o.id) && text(o.label,80) && o.label.length <= 80
      && score(o.score) && nonnegative(o.seconds) && text(o.rule,200) && o.rule.length <= 200);
    if (o.camera !== undefined) need(o.camera === session.camera);
    // RuleEngine rounds the emitted time to six decimals but keeps the raw start.
    if (o.started_seconds !== undefined) need(nonnegative(o.started_seconds) && o.started_seconds <= o.seconds + 1e-6);
    if (o.review_required !== undefined) need(o.review_required === true);
    seen.add(o.id);
    return {id:o.id,label:o.label,score:o.score,seconds:o.seconds,rule:o.rule};
  });
  if (value.detector === 'skipped-still') need(!detections.length && !observations.length);
  let timing;
  if (value.timing !== undefined) {
    need(record(value.timing)); timing = {};
    for (const key of ['inference_ms','total_ms']) if (value.timing[key] !== undefined) {
      need(key === 'inference_ms' && value.timing[key] === null || nonnegative(value.timing[key]));
      timing[key] = value.timing[key];
    }
  }
  return {width:value.width,height:value.height,detector:value.detector,detections,observations,session,...(timing ? {timing} : {})};
}
