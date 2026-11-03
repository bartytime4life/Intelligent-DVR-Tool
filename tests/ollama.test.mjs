import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, explain } from '../src/ollama.mjs';

const signal = new AbortController().signal;
const details = { format: 'gguf' };
const local = { details, capabilities: ['completion'] };
const evidence = { stage: 'Calibration', settings: [{ role: 'Current', threshold: 0.5, presentChecks: 4, found: 3, emptyChecks: 2, falseAlarms: 1 }] };

function service(t, respond, hostname = '127.0.0.1') {
  const original = globalThis.location;
  globalThis.location = { hostname };
  t.after(() => { if (original) globalThis.location = original; else delete globalThis.location; });
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.startsWith('http://127.0.0.1:11434/api/'));
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    options.signal.throwIfAborted();
    return respond(url.split('/').at(-1), options.body && JSON.parse(options.body));
  });
}

test('picker checks metadata only and excludes cloud aliases and embedding models', async t => {
  const seen = [];
  service(t, (route, body) => {
    if (route === 'tags') return Response.json({ models: [
      { name: 'z' }, { name: 'a' }, { name: 'embed' }, { name: 'alias' }, { name: 'broken' },
      { name: 'x:cloud' }, { name: 'x:latest', remote_host: 'external' },
    ] });
    assert.equal(route, 'show');
    seen.push(body.model);
    if (body.model === 'broken') return new Response('', { status: 404 });
    if (body.model === 'alias') return Response.json({ ...local, remote_model: 'remote' });
    if (body.model === 'embed') return Response.json({ details, capabilities: ['embedding'] });
    return Response.json(local);
  });
  assert.deepEqual(await discover(signal), { names: ['a', 'z'], installed: 7, unreadable: 1, digests: {} });
  assert.deepEqual(seen.sort(), ['a', 'alias', 'broken', 'embed', 'z']);
});

test('successful chat rechecks the model and reports measured wait and output cutoff', async t => {
  const calls = [];
  service(t, (route, body) => {
    calls.push(route);
    if (route === 'show') return Response.json({ ...local, thinking: { values: [true, false] } });
    assert.deepEqual(JSON.parse(body.messages[1].content), evidence);
    assert.equal(body.stream, false);
    assert.equal(body.keep_alive, 0);
    assert.equal(body.think, false);
    return Response.json({ done: true, done_reason: 'length', message: { content: 'Review the prompts.' } });
  });
  const answer = await explain('local', evidence, signal);
  assert.deepEqual(calls, ['show', 'chat']);
  assert.equal(answer.model, 'local');
  assert.equal(answer.text, 'Review the prompts.');
  assert.equal(answer.truncated, true);
  assert.ok(Number.isFinite(answer.elapsedMs) && answer.elapsedMs >= 0);
});

test('a changed model cannot receive evidence if it now points to the cloud', async t => {
  const fetch = service(t, () => Response.json({ ...local, remote_host: 'remote' }));
  await assert.rejects(explain('alias', evidence, signal), /unavailable for local chat/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('unusable chat response is not a successful answer', async t => {
  service(t, route => Response.json(route === 'show' ? local : { done: false, message: { content: 'Partial' } }));
  await assert.rejects(explain('local', evidence, signal), /usable explanation/);
});

test('discovery distinguishes an empty installation and propagates cancellation', async t => {
  service(t, () => Response.json({ models: [] }));
  assert.deepEqual(await discover(signal), { names: [], installed: 0, unreadable: 0, digests: {} });
  await assert.rejects(discover(AbortSignal.abort()), { name: 'AbortError' });
});

test('hosted UI refuses discovery before any request', async t => {
  const fetch = service(t, () => assert.fail('unexpected request'), 'example.org');
  await assert.rejects(discover(signal), /local DVR/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('older Qwen3 thinking metadata still requests a short final answer', async t => {
  service(t, (route, body) => {
    if (route === 'show') return Response.json({ details: { format: 'gguf', family: 'qwen3' }, capabilities: ['thinking', 'completion'] });
    assert.equal(body.think, false);
    return Response.json({ done: true, message: { content: 'Check the camera view.' } });
  });
  assert.equal((await explain('qwen3:4b', evidence, signal)).text, 'Check the camera view.');
});

test('verified scorecard rejects wrong counts, decisions and invalid replies', async () => {
  const { verifiedSummary } = await import('../src/ollama-scorecard.mjs');
  const { checkCases } = await import('../src/ollama-check.mjs');
  const correct = { currentFound: 5, currentFlags: 1, trialFound: 10, trialFlags: 4, action: 'review_tradeoff' };
  const summarize = (reply, evidence = checkCases[0]) => verifiedSummary(JSON.stringify(reply), evidence);
  assert.match(summarize(correct), /flagged 1 of 9/);
  assert.throws(() => summarize({ ...correct, currentFlags: 9 }), /misread a count/);
  assert.throws(() => summarize({ ...correct, action: 'review_gain' }), /conflicts/);
  assert.match(summarize({ ...correct, action: 'confirm_prompts' }, { ...checkCases[0], promptConditionsConfirmed: false }), /Confirm/);
  assert.match(summarize({ ...correct, action: 'check_fresh' }, { ...checkCases[0], stage: 'Calibration' }), /fresh recording/);
  assert.throws(() => summarize(null), /misread/);
});

test('default production scorecard uses deterministic schema and cross-checks all returned fields', async t => {
  const { checkCases } = await import('../src/ollama-check.mjs');
  service(t, (route, body) => {
    if (route === 'show') return Response.json(local);
    assert.equal(route, 'chat');
    assert.equal(body.format.required.length, 5);
    assert.equal(body.options.temperature, 0);
    return Response.json({ done: true, message: { content: JSON.stringify({
      currentFound: 1, currentFlags: 2, trialFound: 1, trialFlags: 0, action: 'repeat_check',
    }) } });
  });
  assert.match((await explain('local', checkCases[1], signal)).text, /Repeat the check/);
});

test('ranking requires two distinct checked cases and excludes failed or truncated answers', async () => {
  const { rankChecks } = await import('../src/ollama-check.mjs');
  const row = { model:'model', profile:'checked', id:'tradeoff', elapsedMs:100 };
  const result = rankChecks([row, row, { ...row, id:'low-coverage', error:'wrong count' }], { model:'digest' });
  assert.equal(result[0].passed, 1);
  assert.equal(result[0].digest, 'digest');
  assert.equal(rankChecks([{ ...row, profile:'standard' }], {}).length, 0);
});

test('legacy Qwen3 uses its non-thinking assistant prefix only after local model verification', async t => {
  const { checkCases } = await import('../src/ollama-check.mjs');
  const counts = { currentFound: 5, currentFlags: 1, trialFound: 10, trialFlags: 4, action: 'review_tradeoff' };
  const calls = [];
  service(t, (route, body) => {
    calls.push(route);
    if (route === 'show') return Response.json({ ...local, details: { ...details, family:'qwen3' },
      template: '<|im_start|>assistant\n<think>\n{{ end }}\n{{- end }}\n' });
    assert.equal(body.raw, true);
    assert.ok(body.prompt.endsWith('<think>\n\n</think>\n\n'));
    assert.equal(body.keep_alive, 0);
    assert.equal(body.format.type, 'object');
    return Response.json({ done:true, response:JSON.stringify(counts) });
  });
  assert.match((await explain('qwen3:4b', checkCases[0], signal)).text, /trade-off/);
  assert.deepEqual(calls, ['show','generate']);
});

test('assisted profile supplies measured differences but requires the model to make the correct decision', async t => {
  const { checkCases } = await import('../src/ollama-check.mjs');
  service(t, (route, body) => {
    if (route === 'show') return Response.json(local);
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input.comparisonFacts, { smallestConditionSampleCount: 9, coverageFloorMet: true, additionalPersonHitsAtTrial: 5, additionalEmptyRoomFlagsAtTrial: 3 });
    assert.equal(input.action, undefined);
    return Response.json({ done:true, message:{content:JSON.stringify({currentFound:5,currentFlags:1,trialFound:10,trialFlags:4,action:'review_gain'})} });
  });
  await assert.rejects(explain('local',checkCases[0],signal,'assisted'),/conflicts/);
});

test('choosing a profile puts passing cases ahead of response time and respects a new digest', async () => {
  const { preferChecks } = await import('../src/ollama-check.mjs');
  const first = { model: 'example', digest: 'a', passed: 2, total: 2, meanMs: 2000 };
  assert.deepEqual(preferChecks([first], [{...first, passed: 1, meanMs: 100}]), [first]);
  const replacement = {...first, digest: 'b', passed: 1};
  assert.deepEqual(preferChecks([first],[replacement]), [replacement]);
});

test('a longer output test keeps the same independent decision check', async t => {
  const {checkCases} = await import('../src/ollama-check.mjs');
  service(t,(route, body) => {
    if (route === 'show') return Response.json(local);
    assert.equal(body.options.num_ctx,4096);
    assert.equal(body.options.num_predict,2048);
    assert.equal(body.options.temperature,0);
    return Response.json({ done:true, message:{content:JSON.stringify({
      currentFound:1,currentFlags:2,trialFound:1,trialFlags:0,action:'repeat_check',
    })} });
  });
  assert.equal((await explain('local',checkCases[1],signal,'extended')).profile,'extended');
});

test('incomplete and unconfirmed fresh cases have an immediate measured explanation', async () => {
  const { requiredHumanCheck } = await import('../src/ollama-scorecard.mjs');
  const { checkCases, casesFor } = await import('../src/ollama-check.mjs');
  assert.match(requiredHumanCheck(checkCases[1]), /Repeat the check/);
  assert.match(requiredHumanCheck(casesFor('holdout')[1]), /Confirm/);
  assert.equal(requiredHumanCheck(checkCases[0]), null);
  assert.equal(requiredHumanCheck({ stage: 'Before recording' }), null);
});

test('raw walkthrough shows only the completed final answer', async t => {
  service(t, route => {
    if (route === 'show') return Response.json({ ...local, details: { ...details, family:'qwen3' },
      template:'<think>\n{{ end }}\n{{- end }}' });
    return Response.json({ done:true, done_reason:'stop', response:'intermediate text</think>\nConnect the camera.' });
  });
  assert.equal((await explain('qwen3:4b',{stage:'Before recording'},signal)).text,'Connect the camera.');
});
