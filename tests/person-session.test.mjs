import test from 'node:test';
import assert from 'node:assert/strict';
import {submitPersonRecording, personWriteRefused} from '../src/person-session.mjs';
import {createReviewTransfer} from '../src/review-transfer.mjs';

const clip = {blob:new Blob(['generated person recording']), name:'generated.webm'};
const service = {token:'generated-token', people:{statement:'Generated test consent'}};
const recording = {recording:{id:'a'.repeat(32)}};

test('submitted server failures remain uncertain while native validation refusals allow retry', () => {
  for (const status of [400,404,409,413,415,422]) assert.equal(personWriteRefused({status}), true);
  for (const status of [403,408,500,502,503,504,undefined]) assert.equal(personWriteRefused({status}), false);
});

for (const person of [null, {id:'b'.repeat(16)}]) test(`leaving during import never submits ${person ? 'baseline refinement' : 'enrollment'}`, async () => {
  const controller = new AbortController(); let completeImport, writes = 0;
  const task = submitPersonRecording({clip, service, person, signal:controller.signal,
    importer:async (file, token, signal) => {
      assert.equal(file.name, clip.name); assert.equal(token, service.token); assert.equal(signal, controller.signal);
      return new Promise(resolve => {completeImport = resolve;});
    }, fetcher:async () => {writes++; assert.fail('An exited session must not change a face template');}});
  controller.abort(); completeImport(recording);
  await assert.rejects(task, error => error.name === 'AbortError');
  assert.equal(writes, 0);
});

test('an already submitted template operation cannot deliver stale results after leaving', async () => {
  const controller = new AbortController(); let completeReply, submitted = false;
  const task = submitPersonRecording({clip, service, name:' Generated Person ', signal:controller.signal,
    importer:async () => recording, onSubmit:() => {submitted = true;}, fetcher:async (path, options) => {
      assert.equal(path, '/api/analysis/people'); assert.equal(options.signal, controller.signal);
      assert.deepEqual(JSON.parse(options.body), {name:'Generated Person', consent:{confirmed:true,statement:service.people.statement}, recording:recording.recording.id});
      return {ok:true, json:() => new Promise(resolve => {completeReply = resolve;})};
    }});
  while (!completeReply) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(submitted, true);
  controller.abort(); completeReply({person:{id:'c'.repeat(32)}});
  await assert.rejects(task, error => error.name === 'AbortError');
});

test('baseline refinement uses only the selected person and retained recording', async () => {
  const result = {person:{id:'b'.repeat(16), name:'Generated Person', views:2}, baseline:{views:2}};
  assert.equal(await submitPersonRecording({clip, service, person:result.person, importer:async () => recording,
    fetcher:async (path, options) => {
      assert.equal(path, `/api/analysis/people/${result.person.id}/verify`);
      assert.deepEqual(JSON.parse(options.body), {recording:recording.recording.id});
      return {ok:true, json:async () => result};
    }}), result);
});

test('an incomplete or mismatched template reply cannot be accepted as a completed session', async () => {
  for (const result of [{}, {person:{id:'bad',name:'Generated Person',views:2}}, {person:{id:'c'.repeat(16),name:'Generated Person',views:2}}]) {
    await assert.rejects(submitPersonRecording({clip, service, person:{id:'b'.repeat(16)}, importer:async () => recording,
      fetcher:async () => ({ok:true, json:async () => result})}), /reply could not be verified/);
  }
});

test('a stalled import reaches its deadline before submitting any template operation', {timeout:1000}, async () => {
  const operations = createReviewTransfer({timeout:20}); let guard, reason, submitted = false;
  const operation = operations.begin(undefined, value => {reason = value;});
  try {
    await assert.rejects(submitPersonRecording({clip, service, signal:operation.signal,
      onSubmit:() => {submitted = true;}, importer:async (file, token, signal) => new Promise((resolve, reject) => {
        guard = setTimeout(() => reject(Error('Import remained stalled')), 500);
        signal.addEventListener('abort', () => reject(signal.reason), {once:true});
      }), fetcher:async () => assert.fail('A timed-out import must not submit a template')}), error => error.name === 'TimeoutError');
    assert.equal(reason.name, 'TimeoutError'); assert.equal(submitted, false);
    assert.ok(operations.begin());
  } finally {clearTimeout(guard); operations.cancel();}
});
