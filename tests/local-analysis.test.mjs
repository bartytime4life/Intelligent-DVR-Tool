import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { activeJob, localAnalysisOrigin, openJobResult, boundedBody, analysisRequest } from '../src/local-analysis.mjs';
import { recognitionFixture } from './fixtures/recognition.mjs';

const bytes = Buffer.from('source bytes');
const sha = createHash('sha256').update(bytes).digest('hex');
const job = {id:'a'.repeat(32),state:'completed',recording:'test.webm'};
const serve = (bundle = recognitionFixture(sha), source = bytes) => async path => new Response(path.endsWith('/result') ? JSON.stringify(bundle) : source);

test('local service controls never connect from hosted origins', () => {
  assert.equal(localAnalysisOrigin({protocol:'http:', hostname:'127.0.0.1'}), true);
  for (const hostname of ['localhost.evil','example.com','0.0.0.0']) assert.equal(localAnalysisOrigin({protocol:'http:',hostname}), false);
  assert.equal(activeJob({state:'running'}), true);
  for (const state of ['failed','cancelled','completed']) assert.equal(activeJob({state}), false);
});
test('successful job opens existing parsed contract with exact source match', async () => {
  const result = await openJobResult(job, 'token', undefined, serve());
  assert.equal(result.bundle.receipt.source_sha256, sha);
  assert.equal(result.name, 'test.webm');
  assert.equal(result.bundle.events.length, 1);
});
test('mismatched source and mixed bundles never open', async () => {
  await assert.rejects(openJobResult(job, 'token', undefined, serve(recognitionFixture(sha), Buffer.from('wrong'))), /does not match/);
  const mixed = recognitionFixture(sha); mixed.trace.model_sha256 = 'f'.repeat(64);
  await assert.rejects(openJobResult(job, 'token', undefined, serve(mixed)), /provenance/);
});
test('failed and cancelled jobs cannot open results', async () => {
  for (const state of ['failed','cancelled','running']) await assert.rejects(openJobResult({...job,state},'token'), /no completed/);
});
test('bounded reading checks declared and streaming size', async () => {
  await assert.rejects(boundedBody(new Response('x',{headers:{'content-length':'1000'}}), 10), /size limit/);
  await assert.rejects(boundedBody(new Response('xxxxxxxxxxx'), 10), /size limit/);
});
test('bounded reading cancels rejected downloads and releases the stream lock', async () => {
  let cancelled = 0;
  const oversized = new Response(new ReadableStream({cancel() { cancelled++; }}), {headers:{'content-length':'1000'}});
  await assert.rejects(boundedBody(oversized, 10), /size limit/);
  assert.equal(cancelled, 1);
  const streamed = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(11)); },
    cancel() { cancelled++; throw Error('cleanup failed'); },
  }));
  await assert.rejects(boundedBody(streamed, 10), /size limit/);
  assert.equal(cancelled, 2);
  assert.equal(streamed.body.locked, false);
  const unreadable = new Response(new ReadableStream({start(controller) { controller.error(Error('read failed')); }}));
  await assert.rejects(boundedBody(unreadable, 10), /read failed/);
  assert.equal(unreadable.body.locked, false);
  await assert.rejects(boundedBody(new Response(null), 10), /no content/);
});
test('cancelling a pending bounded read stops it even when the fetcher ignores its signal', {timeout:1000}, async () => {
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({cancel() { cancelled = true; }}));
  const reading = boundedBody(response, 10, {signal:controller.signal});
  controller.abort();
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});
test('API keeps token in header, refuses redirects and surfaces actionable failure', async () => {
  await assert.rejects(analysisRequest('/jobs', {token:'secret', method:'POST', body:{recording:'id'}, fetcher:async (path, options) => {
    assert.equal(path, '/api/analysis/jobs'); assert.equal(options.headers['X-DVR-Token'],'secret');
    assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit');
    return new Response(JSON.stringify({error:{message:'Reconnect before retrying'}}), {status:403});
  }}), /Reconnect/);
});
test('abandoned result opening cannot publish', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(openJobResult(job, 'token', controller.signal, async () => assert.fail('Cancelled opening must not fetch')), /cancelled/);
});
test('cancelling job verification terminates its hashing worker', {timeout:1000}, async () => {
  const originalWorker = globalThis.Worker, controller = new AbortController(); let terminated = false;
  globalThis.Worker = class {
    postMessage() { queueMicrotask(() => controller.abort()); }
    terminate() { terminated = true; }
  };
  try {
    await assert.rejects(openJobResult(job, 'token', controller.signal, serve()), error => error.name === 'AbortError');
    assert.equal(terminated, true);
  } finally { globalThis.Worker = originalWorker; }
});

test('recording backend labels distinguish preference, verified execution and CPU fallback',async()=>{
  const {analysisBackendLabel}=await import('../src/local-analysis.mjs');
  assert.equal(analysisBackendLabel(null,'cuda-preferred'),'GPU first · CPU fallback');
  assert.equal(analysisBackendLabel({state:'running',backend:null},'cuda-preferred'),'Preparing analysis · runtime not confirmed');
  assert.equal(analysisBackendLabel({backend:'onnxruntime-cuda'}),'GPU · CUDA');
  assert.equal(analysisBackendLabel({backend:'opencv-cpu',acceleration_code:'GPU_SLOT_BUSY'}),'CPU · GPU worker in use');
  assert.equal(analysisBackendLabel({backend:'opencv-cpu',acceleration_code:'CUDA_START_FAILED_CPU_FALLBACK'}),'CPU · GPU could not start');
});
