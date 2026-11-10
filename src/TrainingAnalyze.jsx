import React, { useEffect, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { activeJob, analysisRequest, importRecording, openJobResult } from './local-analysis.mjs';
import { labelFrames } from './training.mjs';
import { trainingContext } from './training-evidence.mjs';
import { timedTrainingFrames } from './training-time.mjs';

export default function AnalyzeStep({ clip, script, selection, onSession, onDone, onRetry, onBack }) {
  const [status, setStatus] = useState({ text: 'Saving the recording on this computer…', checked: 0 });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let token;
    let ownedJob = null;
    const stopJob = job => analysisRequest(`/jobs/${job.id}/cancel`,
      { method: 'POST', body: {}, token, signal: AbortSignal.timeout(5000) }).catch(() => {});
    function request(path, options = {}, timeout = 15000) {
      return analysisRequest(path, { token, ...options,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) }).then(response => response.json());
    }
    (async () => {
      try {
        const session = await request('/session');
        if (abort.signal.aborted) return;
        token = session.token;
        if (!token || !session.ready || !session.recording_import?.enabled) {
          throw Error('The local analysis service needs recording import and its detector dependencies. Restart it, then retry this recording.');
        }
        onSession(session);
        const model = session.models.find(m => m.id === selection.modelId);
        if (!model) throw Error('The original detector is no longer available. Start a new session.');
        const compatible = session.rules.filter(r => r.models.includes(model.id));
        const rules = compatible.find(r => r.id === selection.rulesId);
        if (!rules) throw Error('The local app needs a person rule for this detector. Check the model and rules in Recognition.');
        const file = new File([clip.blob], clip.name, { type: clip.blob.type });
        const imported = await importRecording(file, token, AbortSignal.any([abort.signal, AbortSignal.timeout(35000)]));
        if (abort.signal.aborted) return;
        setStatus({ text: 'Checking the recording with the local detector…', checked: 0 });
        // Obtain the ID even if the operator exits while the start is in
        // flight. Cancel only the job created by this capture.
        let job = await (await analysisRequest('/jobs', { token, method: 'POST', signal: AbortSignal.timeout(120000),
          body: { recording: imported.recording.id, model: model.id, rules: rules.id } })).json();
        ownedJob = job;
        if (abort.signal.aborted) { if (activeJob(job)) await stopJob(job); return; }
        while (activeJob(job)) {
          await new Promise(resolve => setTimeout(resolve, 700));
          if (abort.signal.aborted) return;
          job = await request(`/jobs/${job.id}`);
          ownedJob = job;
          setStatus({ text: job.phase === 'verifying' ? 'Verifying the recording and results…' : 'Checking the recording with the local detector…',
            checked: job.frames_analyzed || 0 });
        }
        if (job.state !== 'completed') throw Error(job.error?.message || 'Analysis did not finish. You can retry this recording.');
        const { bundle, file: source } = await openJobResult(job, token, AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]));
        const context = trainingContext(bundle, model, rules, clip);
        if (context.sourceHash !== imported.sha256) throw Error('The analyzed recording differs from the captured file. Record again.');
        const { frames, timing } = timedTrainingFrames(bundle.trace, clip.elapsed);
        const labeled = labelFrames(frames, { script });
        const applyReason = [context.applyReason, !timing.verified && timing.reason].filter(Boolean).join(' ');
        if (!abort.signal.aborted) onDone({ ...context, timing, canApply: context.canApply && timing.verified,
          applyReason, labeled, source, frames: frames.length });
      } catch (e) { if (!abort.signal.aborted) setError(e.message); }
    })();
    return () => { abort.abort(); if (activeJob(ownedJob)) void stopJob(ownedJob); };
  }, [attempt]);
  return <section className="training-panel training-analyze">
    {error ? <div className="training-problem" role="alert"><WarningCircle size={20} /><div><p>{error}</p>
      <div className="training-actions"><button className="button" onClick={() => { setError(''); setAttempt(a => a + 1); }}>Retry this recording</button>
        <button className="text-button" onClick={onRetry}>Record again</button>{onBack && <button className="text-button" onClick={onBack}>Back to calibration</button>}</div></div></div>
      : <><h2 role="status">{status.text}</h2><progress aria-label="Analysis in progress" />
        <p>{status.checked ? `${status.checked} sampled moments checked. ` : ''}Processing time depends on this computer.</p></>}
  </section>;
}
