import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendThreshold } from '../src/training.mjs';
import { TRAINING_LIBRARY_KEY, readTrainingLibrary, trainingSessionEvidence, saveTrainingEvidence,
  removeTrainingEvidence, compatibleTrainingSessions, recommendCumulativeThreshold,
  compareTrainingLibrary, trainingLibraryReceipt, withTrainingLibraryDecision } from '../src/training-library.mjs';

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
  assert.deepEqual(recommendation, recommendCumulativeThreshold(next, [{ ...past, check: null }]));
  assert.ok(recommendation.threshold < .6); // the check did not train the suggestion
  const result = compareTrainingLibrary([past], next.current, recommendation.threshold, next);
  assert.equal(result.regressions, 1); // nevertheless cannot apply this proposal
});

test('cumulative empirical search preserves every recording instead of hiding a regression in totals', () => {
  const next = { ...outcome(3, [.514, .514, .514], [.512, .512, .512]), current: .5 };
  const past = evidence(1, [.514, .514, .514], [.512, .512, .512]);
  const recommendation = recommendCumulativeThreshold(next, [past]);
  assert.equal(recommendation.threshold, .514);
  const replay = compareTrainingLibrary([past], .5, .514, next);
  assert.equal(replay.regressions, 0);
  assert.deepEqual(replay.candidate, { found: 6, presentChecks: 6, falseAlarms: 0, emptyChecks: 6 });
  const vulnerable = evidence(2, [.511, .8, .8], [.512, .512, .512]);
  assert.equal(compareTrainingLibrary([vulnerable], .5, .514, next).regressions, 1);
  assert.equal(recommendCumulativeThreshold(next, [vulnerable]).threshold, .5);
});

test('identical score distributions use the same margin tie policy alone or across independent recordings', () => {
  const next = { ...outcome(2, [.9, .9, .9], [.41, .41, .41]), current: .4 };
  const past = evidence(1, [.9, .9, .9], [.41, .41, .41]);
  assert.deepEqual(recommendCumulativeThreshold(next, [past]), recommendThreshold(next.labeled, { current: .4 }));
});

test('a long calibration clip has one session vote and equal weight for each prompt condition', () => {
  const next = outcome(2, [.6, .6, .95], [.1, .1, .1]);
  const small = evidence(1, [.95, .95, .95], [.8, .1, .1]);
  const long = evidence(1, Array(1000).fill([.95, .95, .95]).flat(), Array(1000).fill([.8, .1, .1]).flat());
  const shortRecommendation = recommendCumulativeThreshold(next, [small]);
  const longRecommendation = recommendCumulativeThreshold(next, [long]);
  // Lowering gains 2/3 person finds in the short session; raising removes 1/3
  // empty flags in the other. Pooling frames would let the long clip reverse it.
  assert.equal(shortRecommendation.threshold, .6);
  assert.deepEqual(longRecommendation, shortRecommendation);
  assert.equal(compareTrainingLibrary([long], next.current, longRecommendation.threshold, next).regressions, 0);
});

test('empirical sweep matches an exhaustive operating-state oracle on small generated sessions', () => {
  const alphabet = [.412, .414, .8];
  const prior = evidence(1, [.414, .8, .8], [.412, .412, .8]);
  const counts = (sample, threshold) => ({
    found: sample.present.filter(score => score >= threshold).length,
    alarms: sample.absent.filter(score => score >= threshold).length,
  });
  for (let encoded = 0; encoded < alphabet.length ** 6; encoded++) {
    let rest = encoded;
    const scores = Array.from({ length: 6 }, () => { const score = alphabet[rest % alphabet.length]; rest = Math.floor(rest / alphabet.length); return score; });
    for (const current of [.413, .5, .8]) {
      const next = { ...outcome(2, scores.slice(0, 3), scores.slice(3)), current };
      const samples = [prior.calibration, { present: scores.slice(0, 3), absent: scores.slice(3) }];
      // Endpoints and interval midpoints independently cover every possible
      // classifier state, including equality and the all-negative state.
      const endpoints = [...new Set([.4, .9, ...samples.flatMap(s => [...s.present, ...s.absent])])].sort((a, b) => a - b);
      const oracleCandidates = [...endpoints, ...endpoints.slice(1).map((value, i) => (value + endpoints[i]) / 2)];
      const baselines = samples.map(sample => counts(sample, current));
      const admissibleScore = threshold => {
        const pairs = samples.map((sample, i) => ({ sample, before: baselines[i], after: counts(sample, threshold) }));
        if (pairs.some(({ before, after }) => !after.found || after.found < before.found || after.alarms > before.alarms) ||
          !pairs.some(({ before, after }) => after.found > before.found || after.alarms < before.alarms)) return null;
        return pairs.reduce((sum, { sample, after }) => sum + after.found / sample.present.length - after.alarms / sample.absent.length, 0) / pairs.length;
      };
      const attainable = oracleCandidates.map(admissibleScore).filter(score => score !== null);
      const recommendation = recommendCumulativeThreshold(next, [prior]);
      const context = `scores=${scores}; current=${current}`;
      if (!attainable.length) assert.equal(recommendation.threshold, current, context);
      else {
        const selectedScore = admissibleScore(recommendation.threshold);
        assert.notEqual(selectedScore, null, context);
        assert.ok(Math.abs(selectedScore - Math.max(...attainable)) < 1e-10, context);
      }
    }
  }
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

test('a decision holds the browser lock through service waits without deadlocking its own evidence save', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let tail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request(name, work) {
    assert.equal(name, TRAINING_LIBRARY_KEY);
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  } } } });
  try {
    const store = storage();
    await saveTrainingEvidence(store, evidence(1));
    let release, started;
    const waiting = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    const decision = withTrainingLibraryDecision(store, async ({ library, saveEvidence }) => {
      assert.equal(library.sessions.length, 1);
      started();
      await waiting; // models/rules request and rule save are in flight
      return saveEvidence(evidence(2));
    });
    await ready;
    const otherTab = saveTrainingEvidence(store, evidence(3));
    await Promise.resolve();
    assert.equal(readTrainingLibrary(store).sessions.length, 1);
    release();
    assert.equal((await decision).sessions.length, 2);
    assert.equal((await otherTab).sessions.length, 3);
    assert.deepEqual(readTrainingLibrary(store).sessions.map(s => s.calibration.sourceHash), [sha(1), sha(2), sha(3)]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});
