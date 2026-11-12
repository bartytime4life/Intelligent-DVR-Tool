import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_SCRIPT, compareTrainingCheck, labelFrames } from '../src/training.mjs';
import { trainingContext, checkContextError, makeTrainingReceipt } from '../src/training-evidence.mjs';

const marker = 'PRIVATE-DO-NOT-EXPORT';
const model = { id: 'detector', name: marker, profile: 'yolov8-raw-640' };
const activeRules = { id: 'active', name: marker, summary: ['person ≥ 0.99'] };
const person = { name: marker, label: 'person', rect: [0, 0, 1, 1] };

function context(definitions = [person], source = '1', cameraKey = marker, coverage = {}, reason = 'Script complete') {
  return trainingContext({ receipt: { source_sha256: source.repeat(64), model_sha256: '2'.repeat(64),
    rules_sha256: '3'.repeat(64), labels_sha256: '4'.repeat(64), inference_profile: model.profile, frames_read: 60 },
    coverage: { termination: 'source-end', status: 'inventory-matched', analysis_frames: 60, validated_frames: 60, ...coverage },
    trace: { rules: definitions } }, model, activeRules, { cameraKey, name: marker, reason });
}

function frame(seconds, score) {
  return { seconds, detections: [{ label: 'person', score }] };
}

test('calibration reads the recorded numeric person rule and preserves backend defaults', () => {
  const current = context();
  assert.equal(current.current, .7);
  assert.deepEqual(current.rule, { label: 'person', rect: [0, 0, 1, 1], threshold: .7, dwell: 0, max_gap: 2 });
  assert.equal(current.canApply, true);
  assert.equal(context([{ ...person, threshold: .55, dwell: .25, max_gap: 1.25 }]).rule.max_gap, 1.25);
  for (const bad of [{ threshold: null }, { max_gap: 0 }, { rect: [0, 0, 2, 1] }])
    assert.throws(() => context([{ ...person, ...bad }]), /invalid settings/);
  assert.throws(() => context([]), /no person rule/);
  assert.throws(() => context([person, person]), /multiple person/);
});

test('a specialized rule set can be measured but a new whole-view rule cannot replace it from Train', () => {
  for (const rules of [[person, { ...person, label: 'car' }], [{ ...person, rect: [0, .2, 1, .8] }]]) {
    const result = context(rules);
    assert.equal(result.canApply, false);
    assert.match(result.applyReason, /whole camera view/);
  }
});

test('partial prefixes and interrupted recordings cannot be stretched over the full prompt schedule', () => {
  for (const coverage of [{ termination: 'event-limit' }, { termination: 'frame-limit' },
    { validated_frames: 30 }, { status: 'not-checked' }])
    assert.throws(() => context(undefined, '1', '', coverage), /through the end/);
  assert.throws(() => context(undefined, '1', '', {}, 'Camera disconnected'), /recording ended/);
  assert.equal(context(undefined, '1', '', { status: 'unverified' }).coverageStatus, 'unverified');
});

test('fresh checks require a distinct recording and matching detector, labels, rules and known camera', () => {
  const first = context(), second = context(undefined, '5');
  assert.equal(checkContextError(first, second), '');
  assert.match(checkContextError(first, first), /fresh check/);
  for (const key of ['modelHash', 'rulesHash', 'labelHash', 'profile', 'modelId', 'rulesId', 'current'])
    assert.match(checkContextError(first, { ...second, [key]: 'different' }), /changed/);
  assert.match(checkContextError(first, { ...second, cameraKey: 'different' }), /different camera/);
  assert.equal(checkContextError(first, { ...second, cameraKey: '' }), '');
  assert.match(checkContextError(first, { ...second, sourceHash: '' }), /verified source/);
});

test('the receipt compares the frozen setting on both clips and only exports counts and recording provenance', () => {
  const outcome = { ...context(), labeled: labelFrames([frame(2, .55), frame(13, .2)]), frames: 2,
    value: .6, token: marker, source: marker };
  const labeled = labelFrames([frame(1, .61), frame(2, .7), frame(3, .66), frame(13, .2),
    frame(14, .1), frame(15, .3)], { script: CHECK_SCRIPT });
  const result = compareTrainingCheck(labeled, outcome.current, .6);
  const check = { value: .6, context: context(undefined, '5', ''), result, confirmed: true };
  const receipt = JSON.parse(JSON.stringify(makeTrainingReceipt(outcome, check)));
  assert.equal(receipt.calibration.recommended_threshold, .4);
  assert.equal(receipt.calibration.candidate.threshold, .6);
  assert.equal(receipt.calibration.candidate.person_found, 0);
  assert.deepEqual(receipt.fresh_check.candidate, { threshold: .6, person_checks: 3, person_found: 3,
    empty_view_checks: 3, empty_view_detections: 0 });
  assert.equal(receipt.fresh_check.baseline.person_found, 1);
  assert.equal(receipt.fresh_check.source_sha256, '5'.repeat(64));
  assert.equal(receipt.fresh_check.verdict, 'improved');
  assert.equal(receipt.fresh_check.camera_comparison, 'operator-confirmed');
  assert.equal(JSON.stringify(receipt).includes(marker), false);
  assert.equal(makeTrainingReceipt(outcome, { ...check, confirmed: false }).fresh_check.verdict, 'awaiting-operator-confirmation');
  assert.equal(makeTrainingReceipt(outcome).fresh_check, null);
  assert.throws(() => makeTrainingReceipt(outcome, { ...check, value: .7 }), /settings changed/);
  assert.throws(() => makeTrainingReceipt(outcome, { ...check, context: outcome }), /fresh check/);
});

test('exported calibration and frozen fresh-check thresholds retain empirical precision', () => {
  const calibration = { ...context([{ ...person, threshold: .5 }]),
    labeled: labelFrames([frame(2, .514), frame(13, .512)]), frames: 2, value: .514 };
  const labeled = labelFrames([frame(1, .514), frame(2, .514), frame(3, .514),
    frame(13, .512), frame(14, .512), frame(15, .512)], { script: CHECK_SCRIPT });
  const check = { value: .514, context: context([{ ...person, threshold: .5 }], '5'),
    result: compareTrainingCheck(labeled, .5, .514), confirmed: true };
  const receipt = JSON.parse(JSON.stringify(makeTrainingReceipt(calibration, check)));
  assert.equal(receipt.calibration.recommended_threshold, .514);
  assert.equal(receipt.calibration.candidate.threshold, .514);
  assert.equal(receipt.fresh_check.candidate.threshold, .514);
  assert.equal(receipt.fresh_check.verdict, 'improved');
  assert.throws(() => makeTrainingReceipt(calibration, { ...check, value: .51 }), /settings changed/);
});
