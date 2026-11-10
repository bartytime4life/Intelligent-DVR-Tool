import React, { useEffect, useRef, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { activeJob, analysisRequest, importRecording, openJobResult } from './local-analysis.mjs';
import { labelFrames } from './training.mjs';
import { trainingContext } from './training-evidence.mjs';
import { timedTrainingFrames } from './training-time.mjs';
import { analysisJSON, inspectTrainingStart, startTrainingAnalysis } from './training-analysis.mjs';
import { downloadBlob } from './clip-capture.mjs';

export default function AnalyzeStep({ clip, script, selection, onSession, onDone, onRetry, onBack, onOpenRecognition }) {
  const [status, setStatus] = useState({ text: 'Saving the recording on this computer…', checked: 0 });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [uncertainStart, setUncertainStart] = useState(null);
  const [checkingStart, setCheckingStart] = useState(false);
  const recovery = useRef(null), restarting = useRef(false);
  async function checkStart() {
    if (recovery.current) return;
    const controller = new AbortController(); recovery.current = controller;
    setCheckingStart(true);
    try {
      const inspected = await inspectTrainingStart({ signal: controller.signal });
      if (!controller.signal.aborted) setUncertainStart(inspected);
    } catch (error) {
      if (!controller.signal.aborted) setUncertainStart({ canRetry: false, error: error.message });
    } finally {
      if (recovery.current === controller) { recovery.current = null; if (!controller.signal.aborted) setCheckingStart(false); }
    }
  }
  useEffect(() => {
    restarting.current = false;
    const abort = new AbortController();
    let token;
    let ownedJob = null;
    const stopJob = job => analysisRequest(`/jobs/${job.id}/cancel`,
      { method: 'POST', body: {}, token, signal: AbortSignal.timeout(5000) }).catch(() => {});
    function request(path, options = {}, timeout = 15000) {
      return analysisJSON(path, { token, ...options, timeout, signal: abort.signal });
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
        let job = await startTrainingAnalysis({ recording: imported.recording.id, model: model.id, rules: rules.id }, { token });
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
      } catch (e) {
        if (!abort.signal.aborted) {
          if (e.startUnknown) setUncertainStart({ canRetry: false });
          setError(e.startUnknown ? 'The analysis start reply was lost or could not be verified. Analysis may already be running. Your recording is still available below.' : e.message);
        }
      }
    })();
    return () => { abort.abort(); recovery.current?.abort(); recovery.current = null; if (activeJob(ownedJob)) void stopJob(ownedJob); };
  }, [attempt]);
  return <section className="training-panel training-analyze">
    {error ? <div className="training-problem" role="alert"><WarningCircle size={20} /><div><p>{error}</p>
      {uncertainStart && <div>
        <p>{uncertainStart.error || (uncertainStart.job
          ? `The local app reports a ${uncertainStart.job.state} analysis. Its identity cannot establish whether it belongs to this training recording.`
          : uncertainStart.canRetry ? 'The local app reports no current analysis.' : 'Check the local analysis status before starting another run. A missing reply is not a cancellation receipt.')}</p>
        {uncertainStart.canRetry && uncertainStart.job && <p>Another run replaces the current analysis result. Open Recognition to inspect it before retrying.</p>}
        <div className="training-actions"><button className="button" disabled={checkingStart} onClick={checkStart}>{checkingStart ? 'Checking local analysis…' : 'Check local analysis status'}</button>
          {onOpenRecognition && <button className="text-button" onClick={onOpenRecognition}>Open Recognition</button>}</div>
      </div>}
      <div className="training-actions"><button className="button" onClick={() => downloadBlob(clip.blob, clip.name)}>Save training recording</button>
        {(!uncertainStart || uncertainStart.canRetry) && <button className="button" disabled={checkingStart} onClick={() => {
          if (restarting.current) return;
          restarting.current = true; setError(''); setUncertainStart(null); setCheckingStart(false); setAttempt(a => a + 1);
        }}>Retry this recording</button>}
        <button className="text-button" onClick={onRetry}>Record again</button>{onBack && <button className="text-button" onClick={onBack}>Back to calibration</button>}</div></div></div>
      : <><h2 role="status">{status.text}</h2><progress aria-label="Analysis in progress" />
        <p>{status.checked ? `${status.checked} sampled moments checked. ` : ''}Processing time depends on this computer.</p></>}
  </section>;
}
