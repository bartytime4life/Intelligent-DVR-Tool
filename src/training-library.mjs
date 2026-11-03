import { SENSITIVITY, recommendThreshold } from './training.mjs';
import { checkContextError } from './training-evidence.mjs';

export const TRAINING_LIBRARY_KEY = 'dvr.training.library.v1';
export const TRAINING_LIBRARY_LIMIT = 50;
const MAX_SAMPLES = 6000;
const MAX_LIBRARY_BYTES = 2_000_000;
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const scores = v => Array.isArray(v) && v.length >= 3 && v.length <= MAX_SAMPLES &&
  v.every(n => Number.isFinite(n) && n >= 0 && n <= 1);
const validSamples = v => v && hash(v.sourceHash) && scores(v.present) && scores(v.absent);
const validSession = s => s && typeof s.view === 'string' && s.view.trim().length > 0 && s.view.length <= 64 &&
  typeof s.cameraKey === 'string' && s.cameraKey.length <= 1024 && hash(s.modelHash) && hash(s.labelHash) &&
  typeof s.profile === 'string' && /^[a-z0-9._-]{1,80}$/i.test(s.profile) &&
  Number.isFinite(s.dwell) && s.dwell >= 0 && s.dwell <= 3600 &&
  Number.isFinite(s.maxGap) && s.maxGap > 0 && s.maxGap <= 60 &&
  typeof s.at === 'string' && Number.isFinite(Date.parse(s.at)) && validSamples(s.calibration) &&
  (s.check === null || validSamples(s.check) && s.check.sourceHash !== s.calibration.sourceHash);

export function readTrainingLibrary(storage) {
  try {
    const raw = storage.getItem(TRAINING_LIBRARY_KEY);
    if (raw === null) return { sessions: [], error: '' };
    if (typeof raw !== 'string' || raw.length > MAX_LIBRARY_BYTES) throw Error();
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.sessions) || data.sessions.length > TRAINING_LIBRARY_LIMIT ||
        !data.sessions.every(validSession)) throw Error();
    const sources = data.sessions.flatMap(s => [s.calibration.sourceHash, ...(s.check ? [s.check.sourceHash] : [])]);
    if (new Set(sources).size !== sources.length) throw Error();
    return { sessions: data.sessions, error: '' };
  } catch { return { sessions: [], error: 'Saved training evidence could not be read. Existing evidence was left untouched; new sessions cannot be added until storage is available.' }; }
}

export function compatibleTrainingSessions(sessions, view, outcome) {
  // A saved threshold changes a rule's hash. Match the detector bytes and the
  // rule's other semantics so a later session can build on the newly tuned rule.
  if (!outcome?.canApply || !outcome.timing?.verified) return [];
  return sessions.filter(s => s.view === view.trim() && s.cameraKey === (outcome.cameraKey || '') &&
    s.modelHash === outcome.modelHash && s.labelHash === outcome.labelHash && s.profile === outcome.profile &&
    s.dwell === outcome.rule.dwell && s.maxGap === outcome.rule.max_gap &&
    ![s.calibration.sourceHash, s.check?.sourceHash].includes(outcome.sourceHash));
}

function samples(context) {
  return { sourceHash: context.sourceHash,
    present: context.labeled.filter(f => f.expect === 'present').map(f => f.score),
    absent: context.labeled.filter(f => f.expect === 'absent').map(f => f.score) };
}

export function trainingSessionEvidence(view, outcome, check) {
  if (!outcome.canApply || !outcome.timing?.verified) throw Error('Reliable timing and a single whole-view person rule are needed to combine sessions.');
  const record = { view: view.trim(), cameraKey: outcome.cameraKey || '', at: new Date().toISOString(),
    modelHash: outcome.modelHash, labelHash: outcome.labelHash, profile: outcome.profile,
    dwell: outcome.rule.dwell, maxGap: outcome.rule.max_gap, calibration: samples(outcome), check: null };
  if (check?.confirmed) {
    const mismatch = checkContextError(outcome, check.context);
    if (mismatch) throw Error(mismatch);
    if (!check.context.timing?.verified) throw Error('The check needs reliable recording timing.');
    record.check = samples(check.context);
  }
  if (!validSession(record)) throw Error('Use a camera view name of 1–64 characters and at least three timed samples in each prompt condition before saving combined evidence.');
  return record;
}

function mutateUnlocked(storage, change) {
  const library = readTrainingLibrary(storage);
  if (library.error) return library;
  try {
    const sessions = change(library.sessions);
    const raw = JSON.stringify({ version: 1, sessions });
    if (raw.length > MAX_LIBRARY_BYTES) throw Error('The training evidence library is full. Remove an older session before adding another.');
    storage.setItem(TRAINING_LIBRARY_KEY, raw);
    return { sessions, error: '' };
  } catch (error) { return { ...library, error: error.message || 'Training evidence could not be saved. Existing sessions were preserved.' }; }
}

function withLibraryLock(work) {
  // Serialize read/merge/write across tabs as well as rapid clicks in this tab.
  return globalThis.navigator?.locks ? navigator.locks.request(TRAINING_LIBRARY_KEY, work) : work();
}

async function mutate(storage, change) {
  try { return await withLibraryLock(() => mutateUnlocked(storage, change)); }
  catch { return { ...readTrainingLibrary(storage), error: 'Training evidence could not be saved. Check browser storage and try again.' }; }
}

function addEvidence(sessions, record) {
  const problem = trainingEvidenceAdditionError(sessions, record);
  if (problem) throw Error(problem);
  return [...sessions, record];
}

export function saveTrainingEvidence(storage, record) {
  return mutate(storage, sessions => addEvidence(sessions, record));
}

export function withTrainingLibraryDecision(storage, decide) {
  // Keep the same lock through the asynchronous service checks and rule save.
  // Otherwise another tab could add a contrary example after the last replay.
  return withLibraryLock(() => decide({ library: readTrainingLibrary(storage),
    saveEvidence: record => mutateUnlocked(storage, sessions => addEvidence(sessions, record)) }));
}

export function trainingEvidenceAdditionError(sessions, record) {
  if (!validSession(record)) return 'This training evidence is incomplete.';
  if (reusedTrainingSource(sessions, [record.calibration.sourceHash, record.check?.sourceHash]))
    return 'This recording is already saved. Reused footage does not count as another session.';
  return sessions.length >= TRAINING_LIBRARY_LIMIT ? '50 training sessions are saved. Remove an older session before adding another; existing evidence was preserved.' : '';
}

export function reusedTrainingSource(sessions, hashes) {
  const existing = new Set(sessions.flatMap(s => [s.calibration.sourceHash, s.check?.sourceHash]).filter(Boolean));
  return hashes.filter(Boolean).some(hash => existing.has(hash));
}

export function removeTrainingEvidence(storage, sourceHash) {
  return mutate(storage, sessions => sessions.filter(s => s.calibration.sourceHash !== sourceHash));
}

function measure(sample, threshold) {
  return { found: sample.present.filter(n => n >= threshold).length, presentChecks: sample.present.length,
    falseAlarms: sample.absent.filter(n => n >= threshold).length, emptyChecks: sample.absent.length };
}

export function compareTrainingLibrary(sessions, current, trial, currentCalibration) {
  const clips = sessions.flatMap(s => [s.calibration, ...(s.check ? [s.check] : [])]);
  if (currentCalibration) clips.push(samples(currentCalibration));
  const comparisons = clips.map(clip => ({ baseline: measure(clip, current), candidate: measure(clip, trial) }));
  const regressions = comparisons.filter(({ baseline: b, candidate: c }) => c.found < b.found || c.falseAlarms > b.falseAlarms).length;
  const sum = side => comparisons.reduce((total, pair) => {
    for (const key of Object.keys(total)) total[key] += pair[side][key];
    return total;
  }, { found: 0, presentChecks: 0, falseAlarms: 0, emptyChecks: 0 });
  return { recordings: clips.length, regressions, baseline: sum('baseline'), candidate: sum('candidate') };
}

export function recommendCumulativeThreshold(outcome, sessions) {
  const single = recommendThreshold(outcome.labeled, { current: outcome.current });
  if (!sessions.length) return single;
  // Fit only calibration recordings. Saved fresh checks are regression guards,
  // never optimization samples. Every calibration session gets equal weight.
  const calibration = [...sessions.map(s => s.calibration), samples(outcome)];
  if (calibration.some(s => !scores(s.present) || !scores(s.absent))) return single;
  const emptyMax = calibration.reduce((largest, s) => s.absent.reduce((a, b) => Math.max(a, b), largest), 0);
  const preferred = Math.min(SENSITIVITY.max, Math.max(SENSITIVITY.floor, emptyMax + SENSITIVITY.margin));
  let best = null;
  for (let threshold = SENSITIVITY.floor; threshold <= SENSITIVITY.max + 1e-8; threshold += SENSITIVITY.step) {
    threshold = Number(threshold.toFixed(2));
    const pairs = calibration.map(s => ({ b: measure(s, outcome.current), c: measure(s, threshold) }));
    if (pairs.some(({ b, c }) => !c.found || c.found < b.found || c.falseAlarms > b.falseAlarms) ||
        !pairs.some(({ b, c }) => c.found > b.found || c.falseAlarms < b.falseAlarms)) continue;
    const score = pairs.reduce((n, { c }) => n + c.found / c.presentChecks - c.falseAlarms / c.emptyChecks, 0) / pairs.length;
    if (!best || score > best.score + 1e-10 || Math.abs(score - best.score) < 1e-10 && Math.abs(threshold - preferred) < Math.abs(best.threshold - preferred)) best = { threshold, score };
  }
  return { threshold: best?.threshold ?? outcome.current, reason: best ? 'ok' : 'keep-current', emptyMax };
}

// Receipts contain sample counts and fingerprints, never a camera identifier or
// the per-frame scores retained in private browser storage.
export function trainingLibraryReceipt(sessions, current, trial, outcome) {
  return { prior_sessions: sessions.length, calibration_included: !!outcome,
    prior_sources: sessions.map(s => ({ calibration_sha256: s.calibration.sourceHash, check_sha256: s.check?.sourceHash || null })),
    ...compareTrainingLibrary(sessions, current, trial, outcome) };
}
