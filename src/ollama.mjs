import { allowedSteps, receiptAdvice } from './lab-receipt.mjs';
import { scoreFormat, scoreInstruction, verifiedSummary } from './ollama-scorecard.mjs';

const endpoint = 'http://127.0.0.1:11434/api/';
const localFormats = new Set(['gguf', 'safetensors']);

export function onLocalDvr() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname);
}

async function request(route, body, signal) {
  if (!onLocalDvr()) {
    throw new Error('Open Train in the local DVR application to use Ollama.');
  }
  const response = await fetch(endpoint + route, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(['chat', 'generate'].includes(route) ? 90000 : 8000)]),
    credentials: 'omit', redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error('Ollama refused this browser origin. Open the DVR at its 127.0.0.1 address and try again.');
    if (response.status === 404 && route === 'show') throw new Error('This model is no longer installed. Choose Find installed models to refresh the list.');
    throw new Error('Ollama could not complete this request (HTTP ' + response.status + ').');
  }
  return response.json();
}

export async function runtimeVersion(signal) {
  const result = await request('version', null, signal);
  return typeof result.version === 'string' ? result.version : null;
}

export async function modelResidency(model, signal) {
  const { models } = await request('ps', null, signal);
  const entry = models?.find(m => m.name === model || m.model === model);
  return entry ? { modelBytes: entry.size, gpuBytes: entry.size_vram, context: entry.context_length, digest: entry.digest } : null;
}

function isRemote(info) {
  return Boolean(info?.remote_host || info?.remote_model || /[-:]cloud$/i.test(info?.name || ''));
}

function supportsChat(info) {
  return !isRemote(info) && localFormats.has(info?.details?.format) &&
    Array.isArray(info.capabilities) && info.capabilities.includes('completion');
}

export async function discover(signal) {
  const scanSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  const { models } = await request('tags', null, scanSignal);
  if (!Array.isArray(models)) throw new Error('Ollama returned an unreadable model list. Run ollama list to check the local service.');
  const candidates = [...new Set(models.filter(entry => typeof entry?.name === 'string' && entry.name && !isRemote(entry)).map(entry => entry.name))];
  const names = [];
  let unreadable = 0;
  // Two metadata requests at a time. These checks do not load weights or run inference.
  let next = 0;
  async function inspect() {
    while (next < candidates.length) {
      scanSignal.throwIfAborted();
      const model = candidates[next++];
      try {
        if (supportsChat(await request('show', { model }, scanSignal))) names.push(model);
      } catch (error) {
        scanSignal.throwIfAborted();
        unreadable++;
      }
    }
  }
  await Promise.all([inspect(), inspect()]);
  const digests = Object.fromEntries(models.filter(m => names.includes(m?.name) && /^[0-9a-f]{64}$/i.test(m.digest)).map(m => [m.name, m.digest]));
  return { names: names.sort(), installed: models.length, unreadable, digests };
}

export async function explain(model, evidence, signal, profile = evidence.settings?.length === 2 ? 'checked' : 'standard') {
  const start = performance.now();
  const info = await request('show', { model }, signal);
  if (isRemote({ name: model }) || !supportsChat(info)) {
    throw new Error('This model is unavailable for local chat. Find installed models again and choose another.');
  }
  // Older Qwen3 manifests advertise thinking but omit the supported-values list.
  const levels = info.thinking?.values;
  const originalQwen3 = info.details.family === 'qwen3' || model.startsWith('qwen3:');
  const qwenToggle = !levels?.length && originalQwen3;
  const think = levels?.includes(false) || qwenToggle ? false : levels?.includes('low') ? 'low' : undefined;
  const assisted = profile === 'assisted' || profile === 'extended';
  const checked = (profile === 'checked' || assisted) && evidence.settings?.length === 2;
  let input = evidence;
  if (checked && assisted) {
    const [current, trial] = evidence.settings;
    const smallest = Math.min(current.presentChecks, current.emptyChecks, trial.presentChecks, trial.emptyChecks);
    input = { ...evidence, comparisonFacts: {
      smallestConditionSampleCount: smallest, coverageFloorMet: smallest >= 3,
      additionalPersonHitsAtTrial: trial.found - current.found,
      additionalEmptyRoomFlagsAtTrial: trial.falseAlarms - current.falseAlarms,
    } };
  }
  const lab = evidence.stage === 'Training Lab receipt';
  const format = lab ? { type: 'object', properties: { action: { type: 'string', enum: allowedSteps(evidence) } },
    required: ['action'], additionalProperties: false } : checked ? scoreFormat : undefined;
  const options = { num_ctx: 2048, num_predict: originalQwen3 || info.capabilities.includes('thinking') ? 1024 : 320, temperature: 0.2 };
  if (format || profile === 'concise') Object.assign(options, { num_predict: 192, temperature: 0, seed: 42 });
  if (profile === 'extended') Object.assign(options, { num_ctx: 4096, num_predict: 2048 });
  const body = {
    model, stream: false, keep_alive: 0,
    think: format && !levels?.length && info.details.family?.startsWith('qwen') ? false : think,
    format,
    options,
    messages: [
      { role: 'system', content: lab
        ? 'Choose the most useful next review action for this run. tp means matched boxes, fp means extra boxes and fn means missed labels. Synthetic results apply only to generated frames.'
        : checked ? scoreInstruction + (assisted
        ? ' For a confirmed fresh check with coverageFloorMet=false, choose repeat_check even if flags improved. With coverageFloorMet=true, more hits together with more flags is review_tradeoff. Use the signed differences.' : '') : [
        'You are helping someone use the Train screen. Respond directly in two or three short sentences.',
        evidence.stage === 'Before recording'
          ? 'Explain how to begin: at Camera check choose Connect camera and frame the area. Follow the prompts during recording. The DVR scores a second recording. The operator must confirm the prompt conditions and decide whether to apply a setting.'
          : 'Report the person-found counts and empty-room flags for both settings, then give one next step. If either condition has fewer than three samples, ask for another check. For a tradeoff keep the current setting and review. The operator decides whether to apply a setting.',
        'Use only the supplied facts.',
        originalQwen3 ? '/no_think' : '',
      ].filter(Boolean).join(' ') },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
  // These legacy Qwen3 templates force an opening <think> even when think=false.
  // For verified scorecards use the Qwen3 non-thinking assistant prefix.
  const legacyQwen = (format || evidence.stage === 'Before recording') && originalQwen3 && info.template?.trimEnd().endsWith('<think>\n{{ end }}\n{{- end }}');
  let result;
  if (legacyQwen) {
    const prompt = body.messages.map(m => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('') + '<|im_start|>assistant\n<think>\n\n</think>\n\n';
    result = await request('generate', { model, prompt, raw: true, stream: false, format,
      keep_alive: 0, options: body.options }, signal);
    // Raw generation can echo a reasoning segment ending in a closing tag.
    // Show only the final answer, and discard any truncated raw generation.
    const raw = typeof result.response === 'string' ? result.response : '';
    const closing = raw.lastIndexOf('</think>');
    const final = closing >= 0 ? raw.slice(closing + '</think>'.length) : raw;
    result.message = { content: result.done_reason === 'length' || final.includes('<think>') ? '' : final };
  } else {
    result = await request('chat', body, signal);
  }
  if (!result.done || typeof result.message?.content !== 'string' || !result.message.content.trim()) {
    if (result.done_reason === 'length') throw new Error('The model reached its output limit before giving a final answer. Choose another local model and try again.');
    throw new Error('Ollama did not return a usable explanation. Try again or choose a different local chat model.');
  }
  if (format && result.done_reason === 'length') throw Error('The model reached the output limit before completing the checked answer.');
  return { model, profile, options: body.options, think: legacyQwen ? 'Qwen3 non-thinking prefix' : body.think ?? 'model default',
    text: lab ? receiptAdvice(evidence, result.message.content) : checked ? verifiedSummary(result.message.content, evidence) : result.message.content.trim(), elapsedMs: performance.now() - start, truncated: result.done_reason === 'length',
    loadMs: Number.isFinite(result.load_duration) ? result.load_duration / 1e6 : null,
    tokensPerSecond: result.eval_duration > 0 && Number.isFinite(result.eval_count) ? result.eval_count * 1e9 / result.eval_duration : null };
}
