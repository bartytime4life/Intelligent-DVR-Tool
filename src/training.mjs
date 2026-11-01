// Guided detection training: a scripted capture whose segments say what the camera
// should see, so sampled detections can be checked without manual labeling.
// Results describe this local session only; they are not accuracy qualification.

export const TRAINING_SCRIPT = Object.freeze([
  { id: 'usual', prompt: 'Stay in view as usual', detail: 'Sit or stand where you normally would and move naturally.', seconds: 10, expect: 'present' },
  { id: 'empty', prompt: 'Leave the camera’s view', detail: 'Walk out of sight and stay out until this countdown ends.', seconds: 12, expect: 'absent' },
  { id: 'far', prompt: 'Walk slowly across the far side', detail: 'Go as far from the camera as the room allows, then walk across.', seconds: 14, expect: 'present' },
  { id: 'partial', prompt: 'Stand partly hidden', detail: 'Stand behind a chair or door frame so only part of you shows.', seconds: 10, expect: 'present' },
  { id: 'close', prompt: 'Come back and face the camera', detail: 'Return to your usual spot and stay until recording ends.', seconds: 8, expect: 'present' },
]);
// Enrollment needs still, close, slightly varied views of one face.
export const ENROLL_SCRIPT = Object.freeze([
  { id: 'look', prompt: 'Look at the camera', detail: 'Keep your face inside the oval and hold still.', seconds: 6 },
  { id: 'left', prompt: 'Turn your head slightly left', detail: 'A small turn; keep both eyes visible.', seconds: 5 },
  { id: 'right', prompt: 'Turn your head slightly right', detail: 'A small turn; keep both eyes visible.', seconds: 5 },
  { id: 'back', prompt: 'Lean back a little', detail: 'Stay inside the oval and hold still.', seconds: 4 },
]);
// The baseline check uses everyday views, so it reflects how the camera will see the person.
export const BASELINE_SCRIPT = Object.freeze([
  { id: 'natural', prompt: 'Move naturally in view', detail: 'Look around the room as you normally would.', seconds: 6 },
  { id: 'step', prompt: 'Step back and face the camera', detail: 'Stand where the camera usually sees people.', seconds: 6 },
]);
export const CONSENT_TEXT = 'This person agrees that Intelligent DVR may keep a face template on this computer to suggest possible matches for human review. The template can be deleted at any time. Video and templates are never uploaded.';
export const baselineText = b => !b ? 'No baseline check yet'
  : b.usable ? `Recognized in ${b.matched} of ${b.usable} face views (${percent(b.rate)})` : 'Last check found no clear face views';

// Frames just after a prompt changes are ambiguous while the person reacts.
export const TRANSITION_SECONDS = 2;
// The margin covers lighting changes: a wall portrait scored 0.26 in the evening and 0.43 in daylight.
export const SENSITIVITY = Object.freeze({ min: 0.3, max: 0.9, step: 0.05, margin: 0.2, floor: 0.4 });
export const HISTORY_KEY = 'dvr.training.history.v1';
export const DEFAULT_RULES_KEY = 'dvr.analysis.defaultRules';
const HISTORY_LIMIT = 50;

export function scriptTimeline(script = TRAINING_SCRIPT) {
  let start = 0;
  return script.map(segment => {
    const item = { ...segment, start, end: start + segment.seconds };
    start = item.end;
    return item;
  });
}
export const scriptSeconds = (script = TRAINING_SCRIPT) => script.reduce((sum, s) => sum + s.seconds, 0);

export function segmentAt(timeline, seconds) {
  return timeline.find(s => seconds >= s.start && seconds < s.end) || null;
}

const roundTo = (value, step) => Math.round(value / step) * step;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function labelScore(frame, label = 'person') {
  return frame.detections.reduce((best, d) => d.label === label && d.score > best ? d.score : best, 0);
}

// Browser recordings declare unreliable frame rates (one fake camera decoded as 22 s for
// 54 s recorded), so a frame's place in the script comes from its position among the
// decoded frames, scaled to the recorded (unpaused) length. Without both, use video time.
export function labelFrames(frames, { script = TRAINING_SCRIPT, recordedSeconds, totalFrames, label = 'person', transition = TRANSITION_SECONDS } = {}) {
  const timeline = scriptTimeline(script);
  const positional = recordedSeconds > 0 && totalFrames > 0;
  return frames.map(frame => {
    const wall = positional && Number.isFinite(frame.frame_index) ? frame.frame_index / totalFrames * recordedSeconds : frame.seconds;
    const segment = segmentAt(timeline, wall);
    const settling = segment && segment.start > 0 && wall < segment.start + transition;
    return { seconds: frame.seconds, wall, score: labelScore(frame, label),
      segment: segment && !settling ? segment.id : null, expect: segment && !settling ? segment.expect : null };
  });
}

// Same semantics as edge/rules.py: a run continues while matches are at most maxGap apart.
export function countObservations(labeled, threshold, { dwell = 1, maxGap = 2 } = {}) {
  let count = 0, start = null, last = null, emitted = false;
  for (const frame of labeled) {
    if (frame.score < threshold) continue;
    if (start === null || frame.seconds - last > maxGap) { start = frame.seconds; emitted = false; }
    last = frame.seconds;
    if (!emitted && frame.seconds - start >= dwell) { count++; emitted = true; }
  }
  return count;
}

export function evaluate(labeled, threshold, script = TRAINING_SCRIPT, rule = {}) {
  const segments = script.map(s => {
    const checks = labeled.filter(f => f.segment === s.id);
    return { id: s.id, prompt: s.prompt, expect: s.expect, checks: checks.length, hits: checks.filter(f => f.score >= threshold).length };
  });
  const present = segments.filter(s => s.expect === 'present'), absent = segments.filter(s => s.expect === 'absent');
  const presentChecks = present.reduce((n, s) => n + s.checks, 0), found = present.reduce((n, s) => n + s.hits, 0);
  return { threshold, segments,
    presentChecks, found, detectionRate: presentChecks ? found / presentChecks : null,
    emptyChecks: absent.reduce((n, s) => n + s.checks, 0), falseAlarms: absent.reduce((n, s) => n + s.hits, 0),
    observations: countObservations(labeled, threshold, rule) };
}

// Prefer zero false alarms in the empty room, then leave headroom above the
// strongest empty-room score. When no setting can separate the person from
// something in the empty room, keep the current one: raising it would only
// hide the person. More sessions give a better-founded setting.
export function recommendThreshold(labeled, options = {}) {
  const { min, max, step, margin, floor, current = 0.5 } = { ...SENSITIVITY, ...options };
  const present = labeled.filter(f => f.expect === 'present'), absent = labeled.filter(f => f.expect === 'absent');
  if (!present.some(f => f.score >= min)) return { threshold: null, reason: 'not-seen', emptyMax: null };
  if (!absent.length) return { threshold: current, reason: 'no-empty-check', emptyMax: null };
  const emptyMax = Math.max(0, ...absent.map(f => f.score));
  if (emptyMax + margin > max) return { threshold: current, reason: 'empty-room-busy', emptyMax };
  const threshold = clamp(roundTo(Math.max(emptyMax + margin, floor) + step / 2 - 1e-9, step), min, max);
  return { threshold: Number(threshold.toFixed(2)), reason: 'ok', emptyMax };
}

// At most one moment per `spacing` seconds, so the stills show different situations.
export function frameMoments(labeled, threshold, limit = 6, spacing = 2) {
  const misses = labeled.filter(f => f.expect === 'present' && f.score < threshold).sort((a, b) => a.score - b.score);
  const alarms = labeled.filter(f => f.expect === 'absent' && f.score >= threshold).sort((a, b) => b.score - a.score);
  const picked = [];
  for (const f of [...alarms.map(f => ({ ...f, kind: 'false-alarm' })), ...misses.map(f => ({ ...f, kind: 'missed' }))]) {
    if (picked.length === limit) break;
    if (picked.every(p => Math.abs(p.wall - f.wall) >= spacing)) picked.push(f);
  }
  return picked;
}
export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const validEntry = e => e && typeof e.at === 'string' && e.kind === 'detection' && Number.isFinite(e.threshold) &&
  (e.detectionRate === null || Number.isFinite(e.detectionRate)) && Number.isInteger(e.falseAlarms);

export function readHistory(storage) {
  try {
    const value = JSON.parse(storage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.filter(validEntry).slice(-HISTORY_LIMIT) : [];
  } catch { return []; }
}

export function appendHistory(storage, entry) {
  const history = [...readHistory(storage), entry].slice(-HISTORY_LIMIT);
  try { storage.setItem(HISTORY_KEY, JSON.stringify(history)); return { history, error: '' }; }
  catch { return { history, error: 'This session could not be saved in browser storage; the trained setting itself is saved on this computer.' }; }
}

export function readDefaultRules(storage) {
  try { const value = storage.getItem(DEFAULT_RULES_KEY); return /^[a-z0-9-]{1,40}$/.test(value || '') ? value : ''; }
  catch { return ''; }
}
export function writeDefaultRules(storage, id) {
  try { storage.setItem(DEFAULT_RULES_KEY, id); return true; } catch { return false; }
}

export const percent = value => value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
