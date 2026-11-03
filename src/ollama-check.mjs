import { explain, modelResidency, runtimeVersion } from './ollama.mjs';

function setting(role, threshold, found, presentChecks, falseAlarms, emptyChecks) {
  return { role, threshold, found, presentChecks, falseAlarms, emptyChecks };
}

export const checkCases = [
  { id: 'tradeoff', stage: 'Fresh check', promptConditionsConfirmed: true, settings: [
    setting('Current', 0.65, 5, 12, 1, 9), setting('Trial', 0.45, 10, 12, 4, 9),
  ] },
  { id: 'low-coverage', stage: 'Fresh check', promptConditionsConfirmed: true, settings: [
    setting('Current', 0.55, 1, 2, 2, 7), setting('Trial', 0.70, 1, 2, 0, 7),
  ] },
];

const holdoutCases = [
  { id: 'fresh-gain', stage: 'Fresh check', promptConditionsConfirmed: true, settings: [
    setting('Current', 0.50, 7, 11, 3, 8), setting('Trial', 0.68, 7, 11, 0, 8),
  ] },
  { id: 'needs-confirmation', stage: 'Fresh check', promptConditionsConfirmed: false, settings: [
    setting('Current', 0.50, 8, 10, 1, 6), setting('Trial', 0.40, 9, 10, 1, 6),
  ] },
];
export const casesFor = mode => mode === 'holdout' ? holdoutCases : checkCases;

// Observe only the model under test. Missing telemetry must not fail a scorecard.
async function observedRun(model, evidence, signal, profile) {
  const monitor = new AbortController();
  let residency = null, pending = false;
  const timer = setInterval(async () => {
    if (residency || pending) return;
    pending = true;
    try { residency = await modelResidency(model, monitor.signal); } catch { /* Optional snapshot. */ }
    finally { pending = false; }
  }, 1000);
  try {
    return { ...await explain(model, evidence, signal, profile), residency };
  } catch (error) {
    error.residency = residency;
    throw error;
  } finally {
    clearInterval(timer);
    monitor.abort();
  }
}

export async function checkModels(names, signal, onProgress, mode, heldoutProfile = 'checked') {
  const version = await runtimeVersion(signal).catch(() => null);
  const rows = [];
  for (const [index, model] of names.entries()) {
    let profiles = [mode === 'holdout' ? heldoutProfile : mode];
    if (mode === 'compare') profiles = index % 2 ? ['standard', 'concise'] : ['concise', 'standard'];
    for (const profile of profiles) {
      for (const { id, ...evidence } of casesFor(mode)) {
        signal.throwIfAborted();
        onProgress({ version, model, profile, id, rows: [...rows] });
        const start = performance.now();
        try {
          const answer = await observedRun(model, evidence, signal, profile);
          rows.push({ model, profile, id, ...answer });
        } catch (error) {
          signal.throwIfAborted();
          rows.push({ model, profile, id, error: error.message, observed: error.observed, residency: error.residency, elapsedMs: performance.now() - start });
        }
      }
    }
  }
  onProgress({ version, rows });
}

const storageKey = 'dvr.training.ollama-checked.v1';

export function rankChecks(rows, digests, mode = 'checked') {
  const byModel = new Map();
  for (const row of rows) {
    if (row.profile !== mode) continue;
    if (!byModel.has(row.model)) byModel.set(row.model, []);
    byModel.get(row.model).push(row);
  }
  return [...byModel].map(([model, trials]) => {
    const passed = checkCases.filter(c => trials.some(r => r.id === c.id && !r.error && !r.truncated && Number.isFinite(r.elapsedMs))).length;
    return { model, profile: mode, digest: digests[model], passed, total: checkCases.length,
      meanMs: trials.reduce((sum, r) => sum + r.elapsedMs, 0) / trials.length };
  }).sort((a, b) => b.passed - a.passed || a.meanMs - b.meanMs);
}

export function preferChecks(previous, candidates) {
  const best = new Map(previous.map(row => [row.model, row]));
  for (const candidate of candidates) {
    const old = best.get(candidate.model);
    if (!old || old.digest !== candidate.digest || candidate.passed > old.passed ||
      (candidate.passed === old.passed && candidate.meanMs < old.meanMs)) best.set(candidate.model, candidate);
  }
  return [...best.values()].sort((a, b) => b.passed - a.passed || a.meanMs - b.meanMs);
}

export function readCheckedModels(digests) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return saved.filter(row => typeof row.digest === 'string' && row.digest === digests[row.model] && row.total === checkCases.length);
  } catch { return []; }
}

export function saveCheckedModels(ranking) {
  try { localStorage.setItem(storageKey, JSON.stringify(ranking)); return true; } catch { return false; }
}
