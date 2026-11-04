import test from 'node:test';
import assert from 'node:assert/strict';
import {observationImageKey} from '../src/local-images.mjs';
import {parseRecognition,mergeRecognitionEvents} from '../src/recognition.mjs';
import {recognitionFixture} from './fixtures/recognition.mjs';

test('image keys keep source/model/session evidence separate despite conflicting unsigned IDs',()=>{
  const old=parseRecognition(recognitionFixture()).events[0];
  const changed=parseRecognition(recognitionFixture('f'.repeat(64))).events[0];
  assert.equal(old.id,changed.id);
  assert.throws(()=>mergeRecognitionEvents([old],[changed]),/conflicts/);
  assert.notEqual(observationImageKey(old),observationImageKey(changed));
  assert.equal(observationImageKey(old),observationImageKey({...old,status:'confirmed',note:'Reviewed'}));
  for(const provenance of [{...old.provenance,model_sha256:'1'.repeat(64)},{...old.provenance,session:'2'.repeat(32)}])
    assert.notEqual(observationImageKey(old),observationImageKey({...old,provenance}));
});
