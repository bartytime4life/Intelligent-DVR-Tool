import { activeJob, analysisRequest } from './local-analysis.mjs';

// Bound both headers and JSON, including an implementation which ignores abort.
// Native writes may finish after the deadline; abort is never a refusal receipt.
export function analysisJSON(path, { timeout = 15000, signal: parent, ...options } = {}) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(timeout)].filter(Boolean));
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(async () => {
      signal.throwIfAborted();
      const response = await analysisRequest(path, { ...options, signal });
      const result = await response.json();
      signal.throwIfAborted();
      return result;
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

const jobStates = new Set(['running', 'completed', 'cancelled', 'failed']);
export function validTrainingJob(job) {
  return job && typeof job.id === 'string' && /^[a-f0-9]{32}$/.test(job.id) && jobStates.has(job.state);
}

export async function startTrainingAnalysis(body, { token, request = analysisJSON, timeout = 120000 } = {}) {
  try {
    const job = await request('/jobs', { token, method: 'POST', body, timeout });
    if (!validTrainingJob(job)) throw Error('The analysis start reply could not be verified.');
    return job;
  } catch (error) {
    // Only native validation/conflict refusals establish that no job started.
    // In particular, a 5xx or rejected session must not offer a blind retry.
    if (![400, 404, 409, 413, 415, 422].includes(error?.status)) error.startUnknown = true;
    throw error;
  }
}

export async function inspectTrainingStart({ signal, request = analysisJSON } = {}) {
  const session = await request('/session', { signal });
  if (!session || !Object.hasOwn(session, 'job') || (session.job !== null && !validTrainingJob(session.job)))
    throw Error('The local analysis status could not be verified. Keep this recording and check the local app.');
  // This job is read-only evidence of activity, never evidence of ownership.
  return { job: session.job, canRetry: !activeJob(session.job) };
}
