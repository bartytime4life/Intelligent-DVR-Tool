import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAINING_LIBRARY_KEY, readTrainingLibrary, trainingSessionEvidence, saveTrainingEvidence,
  removeTrainingEvidence, compatibleTrainingSessions, recommendCumulativeThreshold,
  compareTrainingLibrary, trainingLibraryReceipt } from '../src/training-library.mjs';

const sha = n => n.toString(16).padStart(64, '0');
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
function outcome(n, present = [.45, .5, .6], absent = [.1, .2, .25]) {
  return { sourceHash: sha(n), modelHash: sha(100), labelHash: sha(101), rulesHash: sha(102),
    modelId: 'detector', rulesId: 'person', profile: 'yolov8-raw-640', cameraKey: 'PRIVATE-DEVICE',
    canApply: true, timing: { verified: true }, current: .7, rule: { dwell: 1, max_gap: 2 },
    labeled: [...present.map(score => ({ expect: 'present', score })), ...absent.map(score => ({ expect: 'absent', score }))] };
}
const evidence = (n, present, absent) => trainingSessionEvidence('Door', outcome(n, present, absent));

test('two independently saved sessions survive reopening and replay at a newly saved threshold', async () => {
  const store = storage();
  assert.equal((await saveTrainingEvidence(store, evidence(1))).error, '');
  const checked = { confirmed: true, context: outcome(3) };
  assert.equal((await saveTrainingEvidence(store, trainingSessionEvidence('Door', outcome(2), checked))).sessions.length, 2);
  const reopened = readTrainingLibrary(store);
  const next = { ...outcome(4), current: .5, rulesHash: sha(999), rulesId: 'trained-new' };
  const matching = compatibleTrainingSessions(reopened.sessions, 'Door', next);
  assert.equal(matching.length, 2); // tuned rule hashes and IDs may change
  const replay = compareTrainingLibrary(matching, .7, .4);
  assert.equal(replay.recordings, 3);
  assert.deepEqual(replay.candidate, { found: 9, presentChecks: 9, falseAlarms: 0, emptyChecks: 9 });
  assert.equal(replay.regressions, 0);
  assert.equal(JSON.stringify(trainingLibraryReceipt(matching, .7, .4)).includes('PRIVATE-DEVICE'), false);
  assert.equal((await removeTrainingEvidence(store, sha(1))).sessions.length, 1);
});

test('camera/view/model/labels/profile and other rule settings cannot be silently combined', () => {
  const sessions = [evidence(1)];
  for (const patch of [{ cameraKey: '' }, { cameraKey: 'other' }, { modelHash: sha(200) }, { labelHash: sha(200) },
    { profile: 'other' }, { rule: { dwell: 0, max_gap: 2 } }, { rule: { dwell: 1, max_gap: 3 } },
    { canApply: false }, { timing: { verified: false } }]) {
    assert.equal(compatibleTrainingSessions(sessions, 'Door', { ...outcome(2), ...patch }).length, 0);
  }
  assert.equal(compatibleTrainingSessions(sessions, 'Moved camera', outcome(2)).length, 0);
  assert.equal(compatibleTrainingSessions(sessions, 'Door', outcome(1)).length, 0);
});

test('earlier calibration changes the suggestion and prevents a newest-session-only false alarm', () => {
  const past = evidence(1, [.6, .65, .68], [.44, .44, .44]);
  const next = outcome(2, [.45, .55, .6], [.1, .1, .1]);
  const recommendation = recommendCumulativeThreshold(next, [past]);
  assert.ok(recommendation.threshold > .44);
  assert.ok(recommendation.threshold <= .6);
  assert.equal(compareTrainingLibrary([past], .7, .4, next).regressions, 1);
  assert.equal(compareTrainingLibrary([past], .7, recommendation.threshold, next).regressions, 0);
});

test('saved fresh checks guard changes but are excluded from fitting', () => {
  const past = trainingSessionEvidence('Door', outcome(1), { confirmed: true, context: outcome(2, [.8, .8, .8], [.6, .6, .6]) });
  const next = outcome(3);
  const recommendation = recommendCumulativeThreshold(next, [past]);
  assert.ok(recommendation.threshold < .6); // the check did not train the suggestion
  const result = compareTrainingLibrary([past], next.current, recommendation.threshold, next);
  assert.equal(result.regressions, 1); // nevertheless cannot apply this proposal
});

test('duplicates never inflate session counts, including cross-use of a saved check', async () => {
  const store = storage();
  const first = trainingSessionEvidence('Door', outcome(1), { confirmed: true, context: outcome(2) });
  await saveTrainingEvidence(store, first);
  for (const incoming of [first, evidence(2), trainingSessionEvidence('Door', outcome(3), { confirmed: true, context: outcome(1) })]) {
    assert.match((await saveTrainingEvidence(store, incoming)).error, /already saved/);
    assert.equal(readTrainingLibrary(store).sessions.length, 1);
  }
});

test('unsafe timing, too few samples and an unrelated fresh check cannot enter the library', () => {
  for (const invalid of [{ ...outcome(1), timing: { verified: false } }, { ...outcome(1), canApply: false }, outcome(1, [.5], [.1])])
    assert.throws(() => trainingSessionEvidence('Door', invalid));
  assert.throws(() => trainingSessionEvidence('Door', outcome(1), { confirmed: true, context: { ...outcome(2), modelHash: sha(999) } }), /changed/);
  assert.throws(() => trainingSessionEvidence('Door', outcome(1), { confirmed: true, context: outcome(1) }), /fresh/);
});

test('capacity, corrupt data and storage errors preserve previous evidence', async () => {
  const store = storage();
  for (let n = 1; n <= 50; n++) assert.equal((await saveTrainingEvidence(store, evidence(n))).error, '');
  const before = store.getItem(TRAINING_LIBRARY_KEY);
  assert.match((await saveTrainingEvidence(store, evidence(51))).error, /50 training/);
  assert.equal(store.getItem(TRAINING_LIBRARY_KEY), before);
  const blocked = { getItem: store.getItem, setItem: () => { throw Error('storage full'); } };
  assert.ok((await removeTrainingEvidence(blocked, sha(1))).error);
  assert.equal(store.getItem(TRAINING_LIBRARY_KEY), before);
  store.setItem(TRAINING_LIBRARY_KEY, '{broken');
  assert.ok((await saveTrainingEvidence(store, evidence(51))).error);
  assert.equal(store.getItem(TRAINING_LIBRARY_KEY), '{broken');
});
