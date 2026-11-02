import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES_KEY, readDefaultRules, readTrainingSelection, resolveTrainingSelection, writeDefaultRules } from '../src/training.mjs';

const catalog = {
  models: [{ id: 'other' }, { id: 'yolox' }],
  rules: [
    { id: 'general', models: ['other', 'yolox'] },
    { id: 'trained-abc', models: ['other', 'yolox'] },
    { id: 'manual', models: ['other'] },
  ],
};
const checked = { modelId: 'yolox', rulesId: 'trained-abc' };
const ordinary = { modelId: 'other', rulesId: 'general' };

test('stores the checked detector and rule together and reads existing single-rule entries', () => {
  const values = new Map(); let writes = 0;
  const storage = { getItem: key => values.get(key), setItem: (key, value) => { writes++; values.set(key, value); } };
  assert.equal(writeDefaultRules(storage, checked.rulesId, checked.modelId), true);
  assert.equal(writes, 1);
  assert.deepEqual(JSON.parse(values.get(DEFAULT_RULES_KEY)), checked);
  assert.deepEqual(readTrainingSelection(storage), checked);
  assert.equal(readDefaultRules(storage), checked.rulesId);
  assert.equal(writeDefaultRules(storage, checked.rulesId, '../bad'), false);
  assert.equal(writes, 1);
  storage.setItem(DEFAULT_RULES_KEY, 'old-rule');
  assert.deepEqual(readTrainingSelection(storage), { modelId: '', rulesId: 'old-rule' });
  assert.equal(readDefaultRules(storage), 'old-rule');
  for (const invalid of ['{}', '{"modelId":"other"}', '{"modelId":"..","rulesId":"valid"}']) {
    storage.setItem(DEFAULT_RULES_KEY, invalid);
    assert.equal(readTrainingSelection(storage), null);
  }
  assert.equal(readTrainingSelection({ getItem() { throw Error('blocked'); } }), null);
});

test('Recognition starts with the measured detector even when another compatible model is listed first', () => {
  assert.deepEqual(resolveTrainingSelection(catalog, checked), checked);
  const legacy = { modelId: '', rulesId: checked.rulesId };
  assert.deepEqual(resolveTrainingSelection(catalog, legacy), { modelId: 'other', rulesId: checked.rulesId });
});

test('a removed or incompatible checked detector cannot silently transfer the checked rule', () => {
  const withoutModel = { ...catalog, models: [{ id: 'other' }] };
  assert.deepEqual(resolveTrainingSelection(withoutModel, checked), ordinary);
  assert.deepEqual(resolveTrainingSelection({ ...withoutModel, rules: [catalog.rules[1]] }, checked),
    { modelId: 'other', rulesId: '' });
  const withoutRule = { ...catalog, rules: [catalog.rules[0]] };
  assert.deepEqual(resolveTrainingSelection(withoutRule, checked), ordinary);
  const incompatible = { ...catalog, rules: [catalog.rules[0], { id: checked.rulesId, models: ['other'] }] };
  assert.deepEqual(resolveTrainingSelection(incompatible, checked), ordinary);
});

test('an explicit compatible choice survives refresh and an unavailable manual one falls back safely', () => {
  const manual = { modelId: 'other', rulesId: 'manual' };
  assert.deepEqual(resolveTrainingSelection(catalog, checked, manual), manual);
  assert.deepEqual(resolveTrainingSelection(catalog, checked, { modelId: 'other', rulesId: '' }), ordinary);
  assert.deepEqual(resolveTrainingSelection(catalog, checked, { modelId: 'removed', rulesId: 'manual' }), checked);
  assert.deepEqual(resolveTrainingSelection({ models: [], rules: [] }, checked), { modelId: '', rulesId: '' });
});
