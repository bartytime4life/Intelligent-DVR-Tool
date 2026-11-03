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
// A separately recorded check scores the two thresholds chosen before capture.
export const CHECK_SCRIPT = Object.freeze([
  { id: 'check-present', prompt: 'Walk through the camera’s view', detail: 'Stay in view and move as you usually would.', seconds: 10, expect: 'present' },
  { id: 'check-empty', prompt: 'Leave the camera’s view', detail: 'Stay out of sight until the recording ends.', seconds: 10, expect: 'absent' },
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

export function compareCounts(baseline, candidate) {
  const extraFound = candidate.found - baseline.found;
  const fewerEmptyHits = baseline.falseAlarms - candidate.falseAlarms;
  if (!extraFound && !fewerEmptyHits) return 'unchanged';
  if (extraFound >= 0 && fewerEmptyHits >= 0) return 'improved';
  if (extraFound <= 0 && fewerEmptyHits <= 0) return 'worse';
  return 'tradeoff';
}

export function compareTrainingCheck(labeled, currentThreshold, candidateThreshold) {
  const baseline = evaluate(labeled, currentThreshold, CHECK_SCRIPT);
  const candidate = evaluate(labeled, candidateThreshold, CHECK_SCRIPT);
  // Three sampled frames per condition is a coverage floor for this clip, not a
  // statistical confidence level. Both settings see exactly the same samples.
  const verdict = baseline.presentChecks >= 3 && baseline.emptyChecks >= 3
    ? compareCounts(baseline, candidate) : 'insufficient';
  return { baseline, candidate, verdict };
}

// Fit the cutoff on calibration prompts. Give the person and empty-room
// conditions equal weight regardless of duration. Prefer the empty-room
// margin when multiple cutoffs give the same counts.
export function recommendThreshold(labeled, options = {}) {
  const { min, max, step, margin, floor, current = 0.5 } = { ...SENSITIVITY, ...options };
  const present = labeled.filter(f => f.expect === 'present'), absent = labeled.filter(f => f.expect === 'absent');
  if (!present.some(f => f.score >= min)) return { threshold: null, reason: 'not-seen', emptyMax: null };
  if (!absent.length) return { threshold: current, reason: 'no-empty-check', emptyMax: null };
  const emptyMax = Math.max(0, ...absent.map(f => f.score));
  const preferred = clamp(roundTo(Math.max(emptyMax + margin, floor) + step / 2 - 1e-9, step), min, max);
  const countsAt = cutoff => ({
    found: present.filter(f => f.score >= cutoff).length,
    falseAlarms: absent.filter(f => f.score >= cutoff).length,
  });
  const baseline = countsAt(current);
  let best = null;
  for (let n = 0; n <= Math.round((max - min) / step); n++) {
    const threshold = Number((min + n * step).toFixed(2));
    if (threshold < floor || threshold > max) continue;
    const candidate = countsAt(threshold);
    if (!candidate.found || compareCounts(baseline, candidate) !== 'improved') continue;
    const score = candidate.found * absent.length - candidate.falseAlarms * present.length;
    if (!best || score > best.score || (score === best.score && Math.abs(threshold - preferred) < Math.abs(best.threshold - preferred))) {
      best = { score, threshold };
    }
  }
  if (best) return { threshold: best.threshold, reason: 'ok', emptyMax };
  return { threshold: current, reason: emptyMax + margin > max ? 'empty-room-busy' : 'keep-current', emptyMax };
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

const catalogId = value => typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value);
export const TRAINING_SELECTION_EVENT = 'dvr-training-selection-changed';
const bindingFields = ['modelHash', 'labelHash', 'rulesHash', 'profile'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validBinding = value => value && digest(value.modelHash) && digest(value.labelHash) &&
  digest(value.rulesHash) && typeof value.profile === 'string' && /^[a-z0-9._-]{1,80}$/i.test(value.profile);

export function readTrainingSelection(storage) {
  try {
    const raw = storage.getItem(DEFAULT_RULES_KEY);
    if (catalogId(raw)) return { modelId: '', rulesId: raw };
    if (typeof raw !== 'string' || raw.length > 512) return null;
    const saved = JSON.parse(raw);
    if (!catalogId(saved?.modelId) || !catalogId(saved?.rulesId)) return null;
    const pair = { modelId: saved.modelId, rulesId: saved.rulesId };
    if (!bindingFields.some(key => Object.hasOwn(saved, key))) return pair;
    if (!validBinding(saved)) return null;
    return { ...pair, modelHash: saved.modelHash, labelHash: saved.labelHash, rulesHash: saved.rulesHash, profile: saved.profile };
  } catch { return null; }
}

export function readDefaultRules(storage) {
  return readTrainingSelection(storage)?.rulesId || '';
}

export function writeDefaultRules(storage, rulesId, modelId = '', binding) {
  if (!catalogId(rulesId) || (modelId !== '' && !catalogId(modelId))) return false;
  if (binding !== undefined && (!modelId || !validBinding(binding))) return false;
  const pair = { modelId, rulesId };
  if (binding) for (const key of bindingFields) pair[key] = binding[key];
  try {
    storage.setItem(DEFAULT_RULES_KEY, modelId ? JSON.stringify(pair) : rulesId);
  } catch { return false; }
  // The standard storage event only fires in other documents. Recognition may
  // already be connected in this tab when the operator saves a checked setting.
  globalThis.window?.dispatchEvent(new Event(TRAINING_SELECTION_EVENT));
  return true;
}

export function trainedPreferenceMatches(catalog, saved) {
  if (!saved || !Array.isArray(catalog?.models) || !Array.isArray(catalog.rules)) return false;
  const rule = catalog.rules.find(r => r.id === saved.rulesId);
  if (!rule || !Array.isArray(rule.models)) return false;
  if (!saved.modelId) return catalog.models.some(m => rule.models.includes(m.id)); // legacy rule-only preference
  const model = catalog.models.find(m => m.id === saved.modelId);
  if (!model || !rule.models.includes(model.id)) return false;
  if (!bindingFields.some(key => Object.hasOwn(saved, key))) return true; // legacy model/rule ID pair
  return validBinding(saved) && model.sha256 === saved.modelHash && model.labels_sha256 === saved.labelHash &&
    model.profile === saved.profile && rule.sha256 === saved.rulesHash;
}

// A newly checked rule travels with its detector. If either is unavailable,
// select an ordinary compatible default. Only an explicit operator selection
// can apply a model-bound saved rule to a different detector.
export function resolveTrainingSelection(catalog, saved, explicit = null) {
  const { models, rules } = catalog;
  const hasModel = id => models.some(m => m.id === id);
  const matches = trainedPreferenceMatches(catalog, saved);
  const savedPair = saved?.modelId && matches;
  const explicitModel = explicit?.modelId && hasModel(explicit.modelId);
  const modelId = explicitModel ? explicit.modelId : savedPair ? saved.modelId : models[0]?.id || '';
  const compatible = rules.filter(rule => rule.models.includes(modelId));
  // A stale preference must also be excluded from the ordinary first-rule
  // fallback and from a selection cached before the catalog changed.
  const staleRule = saved && !matches ? saved.rulesId : '';
  const chosenRule = explicitModel && compatible.find(rule => rule.id === explicit.rulesId && rule.id !== staleRule);
  const excluded = staleRule || (saved?.modelId && saved.modelId !== modelId ? saved.rulesId : '');
  const preferredRule = compatible.find(rule => rule.id === saved?.rulesId && rule.id !== excluded);
  const fallback = compatible.find(rule => rule.id !== excluded);
  return { modelId, rulesId: (chosenRule || preferredRule || fallback)?.id || '' };
}

export const percent = value => value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
