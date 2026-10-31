import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzerRules, analyzerFilename } from '../src/zone-rules.mjs';
import { initialRules, restoreSnapshot } from '../src/data.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/zone-rules-export.json', import.meta.url)));

test('analyzer export matches the fixture that edge/rules.py loads', () => {
  assert.deepEqual(analyzerRules(fixture.input), fixture.rules);
  assert.equal(analyzerFilename(fixture.input), 'dvr-rules-plan-1-person.json');
});

test('export trims the browser edge tolerance to the strict analyzer bound', () => {
  const [rule] = analyzerRules({...fixture.input, rect:[.3333, .5, .6677, .5004]});
  assert.ok(rule.rect[0] + rule.rect[2] <= 1 && rule.rect[1] + rule.rect[3] <= 1);
});

test('export refuses legacy labels, disabled rules and unusable gaps', () => {
  assert.throws(() => analyzerRules({...fixture.input, label:'object'}), /model class/);
  assert.throws(() => analyzerRules({...fixture.input, enabled:false}), /Enable/);
  assert.throws(() => analyzerRules({...fixture.input, maxGap:0}), /gap/);
  assert.deepEqual(analyzerRules({...fixture.input, maxGap:undefined})[0].max_gap, 2);
});

test('saved rules keep optional camera names and gaps, and old rules still load', () => {
  const rules = initialRules.map((r, i) => i ? r : {...r, planName:'North gate', maxGap:1.5});
  assert.deepEqual(restoreSnapshot('dvr.rules.v1', rules, null), rules);
  assert.equal(restoreSnapshot('dvr.rules.v1', initialRules, null), initialRules);
  assert.equal(restoreSnapshot('dvr.rules.v1', initialRules.map((r, i) => i ? r : {...r, maxGap:90}), null), null);
});
