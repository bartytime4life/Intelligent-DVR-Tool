import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES_KEY, readDefaultRules, readTrainingSelection, resolveTrainingSelection, trainedPreferenceMatches, writeDefaultRules } from '../src/training.mjs';

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

test('a checked setting pins detector weights, labels, profile, and the new rule file', () => {
  const binding = { modelHash: '1'.repeat(64), labelHash: '2'.repeat(64), rulesHash: '3'.repeat(64), profile: 'opencv-zoo-yolox-s-2022nov' };
  let raw;
  const storage = { getItem: () => raw, setItem: (_key, text) => { raw = text; } };
  assert.equal(writeDefaultRules(storage, checked.rulesId, checked.modelId, binding), true);
  const saved = readTrainingSelection(storage);
  assert.deepEqual(saved, { ...checked, ...binding });
  assert.equal(readDefaultRules(storage), checked.rulesId);

  const model = { id: checked.modelId, sha256: binding.modelHash, labels_sha256: binding.labelHash, profile: binding.profile };
  const rule = { id: checked.rulesId, sha256: binding.rulesHash, models: [checked.modelId] };
  const choices = { models: [model], rules: [rule, { id: 'ordinary', models: [model.id] }] };
  assert.equal(trainedPreferenceMatches(choices, saved), true);
  assert.deepEqual(resolveTrainingSelection(choices, saved), checked);
  const changed = [
    { ...choices, models: [{ ...model, sha256: '4'.repeat(64) }] },
    { ...choices, models: [{ ...model, labels_sha256: '5'.repeat(64) }] },
    { ...choices, models: [{ ...model, profile: 'different-profile' }] },
    { ...choices, rules: [{ ...rule, sha256: '6'.repeat(64) }, choices.rules[1]] },
    { ...choices, models: [{ id: model.id }] },
  ];
  for (const replacement of changed) {
    assert.equal(trainedPreferenceMatches(replacement, saved), false);
    assert.deepEqual(resolveTrainingSelection(replacement, saved, checked), { modelId: model.id, rulesId: 'ordinary' });
    assert.equal(resolveTrainingSelection({ ...replacement, rules: [replacement.rules[0]] }, saved).rulesId, '');
  }
});

test('incomplete evidence bindings never downgrade to an unpinned ID pair', () => {
  const storage = { getItem: () => JSON.stringify({ ...checked, modelHash: '0'.repeat(64) }) };
  assert.equal(readTrainingSelection(storage), null);
  let writes = 0;
  assert.equal(writeDefaultRules({ setItem: () => writes++ }, checked.rulesId, checked.modelId, { modelHash: '0'.repeat(64) }), false);
  assert.equal(writes, 0);
});
