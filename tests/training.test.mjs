import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAINING_SCRIPT, scriptTimeline, scriptSeconds, labelFrames, countObservations, evaluate, recommendThreshold,
  frameMoments, plural, readHistory, appendHistory, readDefaultRules, writeDefaultRules, HISTORY_KEY, percent } from '../src/training.mjs';

const frame = (seconds, ...scores) => ({ seconds, detections: scores.map(score => ({ label: 'person', score, box: [0, 0, .5, .5] })) });
function memory(fail = false) {
  const data = new Map();
  return { data, getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => { if (fail) throw Error('full'); data.set(k, v); } };
}

test('the script fits inside one 60-second clip and its segments are contiguous', () => {
  const timeline = scriptTimeline();
  assert.equal(scriptSeconds(), 54);
  assert.deepEqual(timeline.map(s => [s.id, s.start, s.end]),
    [['usual', 0, 10], ['empty', 10, 22], ['far', 22, 36], ['partial', 36, 46], ['close', 46, 54]]);
  assert.ok(TRAINING_SCRIPT.some(s => s.expect === 'absent'));
});

test('frames map onto the script and skip settling time after each prompt', () => {
  const frames = [frame(1, .9), frame(10.5, .9), frame(13, .2), frame(60, .9), frame(13.2, .9, .3)];
  const labeled = labelFrames(frames);
  assert.deepEqual(labeled.map(f => f.segment), ['usual', null, 'empty', null, 'empty']);
  assert.equal(labeled[4].score, .9);
});

test('a frame’s script position comes from its place among decoded frames, not the declared frame rate', () => {
  // 540 decoded frames over 54 recorded seconds, but the file claims a rate that makes it 22 s long.
  const at = index => ({ frame_index: index, seconds: index / 24.5, detections: [] });
  const labeled = labelFrames([at(0), at(125), at(300), at(420), at(500)], { recordedSeconds: 54, totalFrames: 540 });
  assert.deepEqual(labeled.map(f => [Number(f.wall.toFixed(1)), f.segment]),
    [[0, 'usual'], [12.5, 'empty'], [30, 'far'], [42, 'partial'], [50, 'close']]);
  // Without the frame count the analyzer's own time is used.
  assert.equal(labelFrames([at(245)], { recordedSeconds: 54 })[0].wall, 10);
});

test('evaluation counts found frames, empty-room false alarms and rule-like observations', () => {
  const labeled = labelFrames([frame(1, .9), frame(5, .55), frame(15, .45), frame(18), frame(30, .7), frame(40, .2), frame(50, .9)]);
  const result = evaluate(labeled, .5);
  assert.deepEqual([result.presentChecks, result.found, result.emptyChecks, result.falseAlarms], [5, 4, 2, 0]);
  assert.equal(result.detectionRate, .8);
  assert.deepEqual(result.segments.map(s => [s.id, s.checks, s.hits]), [['usual', 2, 2], ['empty', 2, 0], ['far', 1, 1], ['partial', 1, 0], ['close', 1, 1]]);
  assert.equal(evaluate(labeled, .4).falseAlarms, 1);
});

test('observations follow the rule engine: misses within max_gap keep one run', () => {
  const run = [0, .5, 1, 1.5, 2.5, 3, 3.5].map(s => ({ seconds: s, score: s === 2.5 ? .1 : .9 }));
  assert.equal(countObservations(run, .5, { dwell: 1, maxGap: 2 }), 1);
  const split = [0, 1, 2, 5, 6, 7].map(s => ({ seconds: s, score: .9 }));
  assert.equal(countObservations(split, .5, { dwell: 1, maxGap: 2 }), 2);
  assert.equal(countObservations(split, .95), 0);
});

test('recommended sensitivity leaves headroom above the empty room and explains edge cases', () => {
  const labeled = (empty, present = .9) => [{ expect: 'present', score: present }, { expect: 'absent', score: empty }];
  assert.deepEqual(recommendThreshold(labeled(.26)), { threshold: .5, reason: 'ok', emptyMax: .26 });
  assert.equal(recommendThreshold(labeled(0)).threshold, .4);
  // Nothing separates the person from the empty room: keep the current setting rather than hide the person.
  assert.deepEqual(recommendThreshold(labeled(.8), { current: .7 }), { threshold: .7, reason: 'empty-room-busy', emptyMax: .8 });
  assert.equal(recommendThreshold(labeled(.1, .2)).reason, 'not-seen');
  assert.deepEqual(recommendThreshold([{ expect: 'present', score: .9 }], { current: .6 }), { threshold: .6, reason: 'no-empty-check', emptyMax: null });
});

test('moments list false alarms first, then the weakest misses, spread at least 2 s apart', () => {
  const labeled = [{ expect: 'present', score: .2, wall: 1 }, { expect: 'present', score: .45, wall: 30 }, { expect: 'absent', score: .7, wall: 14 },
    { expect: 'absent', score: .6, wall: 14.5 }, { expect: 'present', score: .3, wall: 1.4 }, { expect: 'present', score: .9, wall: 40 }];
  assert.deepEqual(frameMoments(labeled, .5).map(m => [m.kind, m.score]), [['false-alarm', .7], ['missed', .2], ['missed', .45]]);
  assert.equal(frameMoments(labeled, .5, 1).length, 1);
  assert.equal(plural(1, 'observation'), '1 observation'); assert.equal(plural(3, 'observation'), '3 observations');
});

test('history keeps the last 50 valid sessions and reports storage failures', () => {
  const storage = memory();
  storage.setItem(HISTORY_KEY, JSON.stringify([{ bad: true }, { at: 'x', kind: 'detection', threshold: .5, detectionRate: .9, falseAlarms: 0 }]));
  assert.equal(readHistory(storage).length, 1);
  for (let i = 0; i < 55; i++) appendHistory(storage, { at: `t${i}`, kind: 'detection', threshold: .5, detectionRate: null, falseAlarms: 0 });
  assert.equal(readHistory(storage).length, 50);
  assert.equal(readHistory(storage).at(-1).at, 't54');
  storage.setItem(HISTORY_KEY, '{broken'); assert.deepEqual(readHistory(storage), []);
  assert.match(appendHistory(memory(true), { at: 'x', kind: 'detection', threshold: .5, detectionRate: 1, falseAlarms: 0 }).error, /could not be saved/);
});

test('the default rule set id is validated before use', () => {
  const storage = memory();
  assert.equal(readDefaultRules(storage), '');
  assert.equal(writeDefaultRules(storage, 'trained-0123456789ab'), true);
  assert.equal(readDefaultRules(storage), 'trained-0123456789ab');
  storage.setItem('dvr.analysis.defaultRules', '../x'); assert.equal(readDefaultRules(storage), '');
  assert.equal(writeDefaultRules(memory(true), 'x'), false);
  assert.equal(percent(.876), '88%'); assert.equal(percent(null), '—');
});
