import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluate } from '../src/training.mjs';
import { trainingSessionEvidence } from '../src/training-library.mjs';

// Exercise the actual component under the same JSX compiler used by Vite.
// Externalizing React by absolute path shares the server renderer's hook state.
const require = createRequire(import.meta.url);
let working, Scorecard;
before(async () => {
  working = await mkdtemp(join(tmpdir(), 'dvr-training-scorecard-'));
  const destination = join(working, 'scorecard.cjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/TrainingScorecard.jsx', import.meta.url))],
    outfile: destination, bundle: true, format: 'cjs', platform: 'node', loader: { '.css': 'empty' },
    plugins: [{ name: 'shared-react', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve('react'), external: true }));
    } }],
  });
  Scorecard = require(destination).default;
});
after(async () => { if (working) await rm(working, { recursive: true, force: true }); });

const labeled = [
  ...[0, 1, 2, 3].map(seconds => ({ segment: 'usual', expect: 'present', score: .45, seconds, wall: seconds })),
  ...[14, 15, 16].map(seconds => ({ segment: 'empty', expect: 'absent', score: .1, seconds, wall: seconds })),
];
const outcome = { labeled, current: .5, frames: labeled.length, canApply: true };
const baseline = evaluate(labeled, .5);
const candidate = evaluate(labeled, .4);
const check = { value: .4, result: { baseline, candidate, verdict: 'improved' }, confirmed: true };
const render = (changes = {}) => renderToStaticMarkup(createElement(Scorecard, {
  outcome, service: { training: { enabled: true } }, ...changes,
}));

test('apply requires matching frozen thresholds, a compatible rule and a confirmed improvement', () => {
  assert.match(render({ check }), /Use checked setting 0\.40/);
  for (const verdict of ['unchanged', 'worse', 'tradeoff', 'insufficient']) {
    assert.doesNotMatch(render({ check: { ...check, result: { ...check.result, verdict } } }), /Use checked setting/);
  }
  assert.doesNotMatch(render({ check: { ...check, confirmed: false } }), /Use checked setting/);
  assert.doesNotMatch(render({ check: { ...check, value: .35 } }), /Use checked setting/);
  assert.doesNotMatch(render({ check, outcome: { ...outcome, current: .6 } }), /Use checked setting/);
  const specialized = render({ check, outcome: { ...outcome, canApply: false, applyReason: 'This rule uses a zone.' } });
  assert.match(specialized, /whole-view person scores/);
  assert.match(specialized, /This rule uses a zone/);
  assert.doesNotMatch(specialized, /Use checked setting/);
  assert.match(specialized, /Keep current setting/);
});

test('calibration allows exploration and the returned check locks the tested setting', () => {
  const initial = render();
  assert.match(initial, /Check on a new recording/);
  assert.match(initial, /type="range"/);
  assert.doesNotMatch(initial, /Use checked setting/);
  const readOnly = render({ check, service: { training: { enabled: false } } });
  assert.doesNotMatch(readOnly, /type="range"/);
  assert.match(readOnly, /<button[^>]*disabled=""[^>]*>[^]*?Use checked setting 0\.40/);
});

test('missing empty prompts are disclosed separately from zero person flags', () => {
  const html = render({ outcome: { ...outcome, labeled: labeled.filter(f => f.expect === 'present') } });
  assert.match(html, /No samples/);
  assert.match(html, /No comparison available/);
});

test('an improved fresh result cannot override regression on an earlier session', () => {
  const previous = trainingSessionEvidence('Door', {
    ...outcome, sourceHash: '1'.repeat(64), modelHash: '2'.repeat(64), labelHash: '3'.repeat(64),
    profile: 'yolov8-raw-640', cameraKey: '', timing: { verified: true }, rule: { dwell: 0, max_gap: 2 },
    labeled: [...[.8, .8, .8].map(score => ({ expect: 'present', score })),
      ...[.45, .45, .45].map(score => ({ expect: 'absent', score }))],
  });
  const html = render({ check, pastSessions: [previous], viewName: 'Door' });
  assert.match(html, /adds empty-room flags/);
  assert.doesNotMatch(html, /Use checked setting/);
  assert.match(html, /Keep current setting/);
  assert.doesNotMatch(render({ check, libraryError: 'Could not read saved evidence' }), /Use checked setting/);
});
