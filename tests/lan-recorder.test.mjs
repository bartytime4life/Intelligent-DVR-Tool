import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openSegment, recorderRequest, recorderSession} from '../src/lan-recorder.mjs';
import {recognitionFixture} from './fixtures/recognition.mjs';

const bytes = Buffer.from('controlled segment bytes');
const sha = createHash('sha256').update(bytes).digest('hex');
const row = {id:'a'.repeat(32), state:'completed', sha256:sha, source:'dock'};
const serve = (hash = sha, source = bytes) => async path => new Response(path.endsWith('/result') ? JSON.stringify(recognitionFixture(hash)) : source);

test('a stalled recorder session times out and a later explicit connection can succeed', {timeout:1000}, async () => {
  let cancelled = false;
  await assert.rejects(recorderSession({timeout:20, fetcher:async (path, options) => {
    assert.equal(path, '/api/analysis/session');
    assert.equal(options.method, 'GET');
    return new Promise((resolve, reject) => {
      // Keep the test alive and fail independently if cancellation does not arrive.
      const guard = setTimeout(() => reject(Error('Session remained stalled')), 500);
      options.signal.addEventListener('abort', () => {
        clearTimeout(guard); cancelled = true; reject(options.signal.reason);
      }, {once:true});
    });
  }}), /did not respond in time/);
  assert.equal(cancelled, true);
  const response = await recorderSession({fetcher:async () => new Response('{"token":"next-session"}')});
  assert.equal((await response.json()).token, 'next-session');
});

test('closing a recorder session preserves explicit cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(recorderSession({signal:controller.signal, fetcher:async (path, {signal}) => {
    assert.equal(signal.aborted, true);
    throw signal.reason;
  }}), error => error.name === 'AbortError');
});

test('retained segment uses existing review parser and exact source matching', async () => {
  const opened = await openSegment(row, 'token', undefined, serve());
  assert.equal(opened.bundle.receipt.source_sha256, sha);
  assert.equal(opened.file.size, bytes.length);
  assert.equal(opened.name, `dock-${row.id}.webm`);
});
test('changed source, changed result and incomplete segment cannot open', async () => {
  await assert.rejects(openSegment(row,'token',undefined,serve('f'.repeat(64))), /fingerprint changed/);
  await assert.rejects(openSegment(row,'token',undefined,serve(sha,Buffer.from('wrong'))), /does not match/);
  await assert.rejects(openSegment({...row,state:'queued'},'token'), /completed/);
  await assert.rejects(openSegment({...row,id:'../../private'},'token'), /completed/);
});
test('stop is explicit and API tokens stay out of URLs and bodies', async () => {
  await recorderRequest('/stop', {token:'private-token',body:{},fetcher:async (url,opts) => {
    assert.equal(url,'/api/recorder/stop'); assert.equal(opts.method,'POST');
    assert.equal(opts.body,'{}'); assert.equal(opts.redirect,'error'); assert.equal(opts.credentials,'omit');
    assert.equal(opts.headers['X-DVR-Token'],'private-token'); return new Response('{}');
  }});
});
test('status and storage failures remain actionable', async () => {
  await assert.rejects(recorderRequest('/status',{token:'x',fetcher:async()=>new Response(JSON.stringify({error:{message:'Check local storage'}}),{status:503})}), /Check local storage/);
});
test('cancelled opening never replaces the current review', async () => {
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(openSegment(row,'token',ctl.signal,async()=>assert.fail('Cancelled opening must not fetch')), /cancelled/);
});
test('cancelling segment verification terminates its hashing worker', {timeout:1000}, async () => {
  const originalWorker=globalThis.Worker, controller=new AbortController(); let terminated=false;
  globalThis.Worker=class {
    postMessage() { queueMicrotask(()=>controller.abort()); }
    terminate() { terminated=true; }
  };
  try {
    await assert.rejects(openSegment(row,'token',controller.signal,serve()),error=>error.name==='AbortError');
    assert.equal(terminated,true);
  } finally {globalThis.Worker=originalWorker;}
});

test('recorder codes are explained and unknown text is never echoed as an explanation', async () => {
  const {recorderMessage} = await import('../src/lan-recorder.mjs');
  assert.match(recorderMessage('INTEGRITY_FAILED'), /fingerprint/);
  assert.equal(recorderMessage('NEW_CODE'), 'Recorder reported NEW_CODE.');
  assert.equal(recorderMessage('<img src=x>'), 'Recorder reported an unknown problem.');
});
