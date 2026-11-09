const unfinishedSteps = new Set(['record', 'analyze', 'results', 'check-camera', 'check-record', 'check-analyze', 'confirm']);

// A completed decision can release its in-memory recording/results only after
// every save requested by that decision succeeded. A saved rule alone does not
// prove that this browser kept the operator's selection or session evidence.
export function trainingHasPendingWork({ step = null, clip, outcome, check, saved, saving = false,
  includeSession = false, personPending = false } = {}) {
  if (saving || personPending) return true;
  if (step === 'done' && saved) return saved.historySaved !== true ||
    (includeSession && saved.evidenceSaved !== true) || Boolean(saved.evidenceError) ||
    Boolean(saved.rule && saved.selected !== true);
  return Boolean(clip || outcome || check || unfinishedSteps.has(step));
}

// Merely opening enrollment/baseline setup has no data to abandon. Enrollment
// becomes unfinished after consent edits; a successful enrollment is already
// saved when the optional baseline is offered, and a finished baseline is saved.
export function personHasPendingWork({ stage = 'consent', capture = 'camera', name = '', agreed = false,
  busy = false } = {}) {
  if (busy) return true;
  if (stage === 'done') return false;
  if (stage === 'consent') return Boolean(name.trim() || agreed);
  if (stage === 'enroll') return true;
  return stage === 'baseline' && capture === 'record';
}
