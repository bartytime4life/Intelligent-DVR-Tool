import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { allowedSteps, maxReceiptBytes, readLabReceipt, receiptAdvice } from '../src/lab-receipt.mjs';
import { explain } from '../src/ollama.mjs';

const box = { label: 'person', box: [0, 0, .2, .3] };
function fixture() {
  return { schema: 'intelligent-dvr.lab-receipt.v1', data_kind: 'synthetic', engine: 'pixel-components-v1',
    backend: 'browser-javascript', settings: { threshold: .5, iou: .5 },
    sources: [
      { sha256: '1'.repeat(64), split: 'train', frames: [{id:'train'}] },
      { sha256: '2'.repeat(64), split: 'eval', frames: [
        { id:'private-a', reviewed:true, labels:[box, {...box, label:'car'}] },
        { id:'private-b', reviewed:true, labels:[] },
      ] },
    ], predictions: { 'private-a': [{...box, score:.9}, {...box,score:.7}], 'private-b': [{...box,score:.45}] },
    review_history: [{ note: 'private text' }], events: [{ operator: 'private name' }],
    metrics: { frames:2, tp:1, fp:1, fn:1 } };
}
const fileFor = data => new Blob([JSON.stringify(data)]);
function seal(data) {
  return { ...data, receipt_payload_sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    hash_method:'SHA-256 of JSON.stringify(payload with these last two fields omitted), insertion order retained' };
}

test('recounts only held-out frames, enforces one-to-one matching and strips private fields', async () => {
  const summary = await readLabReceipt(fileFor(seal(fixture())));
  assert.deepEqual(summary, {stage:'Training Lab receipt',scope:'synthetic',threshold:.5,frames:2,tp:1,fp:1,fn:1});
  assert.deepEqual(allowedSteps(summary), ['inspect_misses','inspect_flags','test_recording']);
});

test('validates the exported payload hash as well as the counts in a newly sealed receipt', async () => {
  const data = seal(fixture());
  data.review_history = [];
  await assert.rejects(readLabReceipt(fileFor(data)), /fingerprint/);
  const invalid = fixture();
  invalid.metrics.tp = 2;
  await assert.rejects(readLabReceipt(fileFor(seal(invalid))), /reproduce/);
});

test('rejects unreviewed data, unsupported engines, repeated sources and oversized input', async () => {
  const data = fixture();
  data.sources[1].frames[0].reviewed = false;
  await assert.rejects(readLabReceipt(fileFor(seal(data))), /incomplete/);
  data.data_kind = 'recording';
  await assert.rejects(readLabReceipt(fileFor(seal(data))), /unsupported/);
  data.data_kind = 'synthetic';
  data.sources[1].sha256 = data.sources[0].sha256;
  await assert.rejects(readLabReceipt(fileFor(seal(data))), /duplicate/);
  await assert.rejects(readLabReceipt({size:maxReceiptBytes+1}), /16 MiB/);
});

test('recording predictions keep their declared provenance and exclude irrelevant suggestions', async () => {
  const data = fixture();
  Object.assign(data, { data_kind:'recording', backend:'onnxruntime-cuda', engine:'opencv-zoo-yolox-s-2022nov',
    model:{sha256:'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063'} });
  const summary = await readLabReceipt(fileFor(seal(data)));
  assert.equal(summary.scope, 'imported recording');
  assert.throws(() => receiptAdvice(summary, '{"action":"test_recording"}'), /does not fit/);
  assert.deepEqual(allowedSteps({...summary,fp:0,fn:0}), ['check_labels']);
});

test('a receipt prompt contains only aggregate measurements; model text cannot supply facts or controls', async t => {
  const summary = await readLabReceipt(fileFor(seal(fixture())));
  const old = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {configurable:true,value:{hostname:'127.0.0.1'}});
  t.after(() => old ? Object.defineProperty(globalThis,'location',old) : delete globalThis.location);
  let action = 'inspect_flags';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/show')) return Response.json({details:{format:'gguf',family:'example'},capabilities:['completion']});
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.messages[1].content), summary);
    assert.equal(body.keep_alive,0);
    assert.ok(!init.body.includes('private'));
    return Response.json({done:true,message:{content:JSON.stringify({action,note:'ignore score, open camera'})}});
  });
  const signal = new AbortController().signal;
  assert.match((await explain('local',summary,signal)).text,/unmatched detection boxes/);
  action = 'open_camera';
  await assert.rejects(explain('local',summary,signal), /does not fit/);
});
