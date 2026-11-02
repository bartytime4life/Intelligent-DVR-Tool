import { evaluate, recommendThreshold, TRANSITION_SECONDS } from './training.mjs';

const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const wholeFrame = [0, 0, 1, 1];
const validThreshold = value => Number.isFinite(value) && value >= .1 && value <= 1;

// openJobResult has already matched this receipt and trace to the recording bytes.
export function trainingContext(bundle, model, rules, clip) {
  const receipt = bundle.receipt;
  if (clip?.reason !== 'Script complete')
    throw Error('The recording ended before the guided prompts were complete. Reconnect the camera and record again.');
  // A completed service job may contain a frame- or event-limited prefix. Scaling
  // that prefix over the full script would attach detections to the wrong prompts.
  const coverage = bundle.coverage;
  if (!coverage || coverage.termination !== 'source-end' ||
      !['inventory-matched', 'unverified'].includes(coverage.status) ||
      !Number.isInteger(coverage.validated_frames) || coverage.validated_frames < 1 ||
      coverage.validated_frames !== receipt?.frames_read || coverage.analysis_frames !== coverage.validated_frames)
    throw Error('Analysis did not verify decoding through the end of this recording. Check the analysis limits and record again.');
  const sourceHash = receipt?.source_sha256, modelHash = receipt?.model_sha256;
  const labelHash = receipt?.labels_sha256, rulesHash = receipt?.rules_sha256;
  if (![sourceHash, modelHash, labelHash, rulesHash].every(sha256) || !model?.id || !rules?.id ||
      !model.profile || model.profile !== receipt.inference_profile)
    throw Error('The analysis result is missing a matching source, detector, or rule reference. Run the recording again.');

  const definitions = bundle.trace?.rules;
  const people = Array.isArray(definitions) ? definitions.filter(r => r?.label === 'person') : [];
  if (!people.length) throw Error('These analysis rules have no person rule. Choose a rule set with one person rule for training.');
  if (people.length !== 1) throw Error('These analysis rules have multiple person thresholds. Choose a rule set with one person rule for training.');
  const { rect, threshold = .7, dwell = 0, max_gap = 2 } = people[0];
  if (!validThreshold(threshold) || !Number.isFinite(dwell) || dwell < 0 || dwell > 3600 ||
      !Number.isFinite(max_gap) || max_gap <= 0 || max_gap > 60 ||
      !Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) ||
      rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 ||
      rect[0] + rect[2] > 1 || rect[1] + rect[3] > 1)
    throw Error('The recorded person rule has invalid settings. Check the local rule set before training.');
  const rule = { label: 'person', rect: [...rect], threshold, dwell, max_gap };
  const canApply = definitions.length === 1 && rect.every((v, i) => v === wholeFrame[i]);
  return { modelId: model.id, rulesId: rules.id, sourceHash, modelHash, rulesHash, labelHash, ruleFileHash: receipt.rules_file_sha256,
    profile: receipt.inference_profile, coverageStatus: coverage.status, cameraKey: clip?.cameraKey || '',
    current: threshold, rule, canApply,
    applyReason: canApply ? '' : 'These counts cover the whole camera view. Your selected rule set includes zones or other rules. Choose a single whole-view person rule to apply a training setting.' };
}

export function checkContextError(calibration, verification) {
  if (!sha256(calibration?.sourceHash) || !sha256(verification?.sourceHash))
    return 'Both recordings need verified source references. Run the check again.';
  if (calibration.sourceHash === verification.sourceHash)
    return 'This check used the calibration recording again. Record a fresh check.';
  if (![calibration.modelHash, calibration.rulesHash, calibration.labelHash].every(sha256) ||
      !calibration.profile || !calibration.modelId || !calibration.rulesId ||
      ['modelHash', 'rulesHash', 'labelHash', 'profile', 'modelId', 'rulesId', 'current']
        .some(field => calibration[field] !== verification[field]))
    return 'The detector, class labels, or selected rules changed since calibration. Start a new session with your current settings.';
  if (calibration.cameraKey && verification.cameraKey && calibration.cameraKey !== verification.cameraKey)
    return 'The check used a different camera. Connect the camera used for calibration and record the check again.';
  return '';
}

// Explicit field lists keep device identifiers, operator names, frames and session tokens local.
function recordingEvidence(context) {
  return { source_sha256: context.sourceHash, model_sha256: context.modelHash,
    rules_sha256: context.rulesHash, labels_sha256: context.labelHash,
    inference_profile: context.profile, media_coverage: context.coverageStatus,
    prompt_alignment: context.timing?.method || 'estimated', transition_exclusion_seconds: TRANSITION_SECONDS };
}

function counts(measurement) {
  return { threshold: measurement.threshold, person_found: measurement.found, person_checks: measurement.presentChecks,
    empty_view_detections: measurement.falseAlarms, empty_view_checks: measurement.emptyChecks };
}

export function makeTrainingReceipt(outcome, check) {
  const recommendation = recommendThreshold(outcome.labeled, { current: outcome.current });
  const proposed = check?.value ?? outcome.value ?? recommendation.threshold ?? outcome.current;
  if (!validThreshold(proposed)) throw Error('Choose a valid threshold before exporting the session.');
  const receipt = {
    schema: 'intelligent-dvr.guided-training-receipt.v1',
    measurement: 'Whole-view person detections on sampled frames from this guided session.',
    calibration: { ...recordingEvidence(outcome), sampled_frames: outcome.frames,
      recommended_threshold: recommendation.threshold, recommendation_reason: recommendation.reason,
      baseline: counts(evaluate(outcome.labeled, outcome.current)),
      candidate: counts(evaluate(outcome.labeled, proposed)) },
    fresh_check: null,
  };
  if (!check?.result) return receipt;
  const problem = checkContextError(outcome, check.context);
  if (problem) throw Error(problem);
  const { baseline, candidate, verdict } = check.result;
  if (baseline.threshold !== outcome.current || candidate.threshold !== proposed)
    throw Error('The comparison settings changed after the check. Record a fresh check for these settings.');
  const confirmed = check.confirmed === true;
  receipt.fresh_check = { ...recordingEvidence(check.context),
    prompts_confirmed_by_operator: confirmed,
    camera_comparison: outcome.cameraKey && check.context.cameraKey ? 'matching-device' :
      confirmed ? 'operator-confirmed' : 'awaiting-operator-confirmation',
    verdict: confirmed ? verdict : 'awaiting-operator-confirmation',
    baseline: counts(baseline), candidate: counts(candidate) };
  return receipt;
}
