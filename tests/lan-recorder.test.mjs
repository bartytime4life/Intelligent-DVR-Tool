import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openSegment, recorderRequest} from '../src/lan-recorder.mjs';
import {recognitionFixture} from './fixtures/recognition.mjs';

const bytes = Buffer.from('controlled segment bytes');
const sha = createHash('sha256').update(bytes).digest('hex');
const row = {id:'a'.repeat(32), state:'completed', sha256:sha, source:'dock'};
const serve = (hash = sha, source = bytes) => async path => new Response(path.endsWith('/result') ? JSON.stringify(recognitionFixture(hash)) : source);

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
  await assert.rejects(openSegment(row,'token',ctl.signal,serve()), /cancelled/);
});
