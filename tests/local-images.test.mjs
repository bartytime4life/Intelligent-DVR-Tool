import test from 'node:test';
import assert from 'node:assert/strict';
import {observationImageKey,captureStills} from '../src/local-images.mjs';
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

const flush = async () => {for(let i=0;i<20;i++) await Promise.resolve();};
function captureFixture(hold) {
  const state = {created:0,loads:0,draws:0,seeks:[],revoked:[],listeners:new Set()};
  class Video extends EventTarget {
    videoWidth = 320; videoHeight = 240; duration = 1;
    addEventListener(name,fn,options) {state.listeners.add(fn); super.addEventListener(name,fn,options);}
    removeEventListener(name,fn) {state.listeners.delete(fn); super.removeEventListener(name,fn);}
    set src(value) {if(hold !== 'load') queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')));}
    set currentTime(value) {
      state.seeks.push(value);
      if(hold === 'throw') throw Error('Generated seek failure');
      if(hold !== 'seek') queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    }
    removeAttribute() {}
    load() {state.loads++;}
  }
  const video = new Video(), canvas = {getContext:() => ({drawImage:() => state.draws++}),
    toBlob(fn) {if(hold === 'encode') state.complete = fn; else queueMicrotask(() => fn(new Blob(['generated pixels'])));}};
  return {state,canvas,options:{
    documentRef:{createElement(tag) {state.created++; return tag === 'video' ? video : canvas;}},
    urls:{createObjectURL:() => 'blob:generated-video',revokeObjectURL:url => state.revoked.push(url)},
  }};
}

test('an already cancelled still capture creates no decoder or object URL', async () => {
  const {state,options} = captureFixture(); const controller = new AbortController();
  controller.abort(Error('Generated cancellation'));
  await assert.rejects(captureStills(new Blob(['video']),[0],{...options,signal:controller.signal}),/Generated cancellation/);
  assert.equal(state.created,0); assert.deepEqual(state.revoked,[]);
});

for(const stage of ['load','seek','encode']) test(`cancel during still ${stage} releases media and ignores late work`, async () => {
  const {state,options} = captureFixture(stage), controller = new AbortController();
  const pending = captureStills(new Blob(['video']),[0,.5],{...options,signal:controller.signal});
  await flush(); controller.abort(Error('Generated cancellation'));
  await assert.rejects(pending,/Generated cancellation/);
  assert.equal(state.loads,1); assert.deepEqual(state.revoked,['blob:generated-video']);
  assert.equal(state.listeners.size,0);
  if(stage === 'encode') {state.complete(new Blob(['late generated still'])); await flush(); assert.equal(state.loads,1);}
  assert.ok(state.draws <= 1);
});

test('failed seek setup cleans its pending listeners and temporary source', async () => {
  const {state,options} = captureFixture('throw');
  await assert.rejects(captureStills(new Blob(['video']),[0],options),/Generated seek failure/);
  assert.equal(state.listeners.size,0); assert.equal(state.loads,1);
  assert.deepEqual(state.revoked,['blob:generated-video']);
});

test('normal still capture keeps unique requested samples and leaves a borrowed URL owned by its caller', async () => {
  const {state,canvas,options} = captureFixture();
  const stills = await captureStills('blob:borrowed-video',[0,.5,.5],options);
  assert.deepEqual([...stills.keys()],[0,.5]); assert.equal(state.draws,2);
  assert.equal(canvas.width,160); assert.equal(canvas.height,120);
  assert.deepEqual(state.revoked,[]); assert.equal(state.loads,1); assert.equal(state.listeners.size,0);
});
