import React, { useEffect, useRef, useState } from 'react';
import { activeJob, analysisBackendLabel, analysisRequest, localAnalysisOrigin, openJobResult, importRecording, refused } from './local-analysis.mjs';
import { downloadBlob } from './clip-capture.mjs';
import { loopbackAddress } from './live-feeds.mjs';
import { analysisAnnouncement } from './status-announcements.mjs';
import { createReviewTransfer } from './review-transfer.mjs';
import { DEFAULT_RULES_KEY, TRAINING_SELECTION_EVENT, readTrainingSelection, resolveTrainingSelection } from './training.mjs';

export default function LocalAnalysis({ onResult, onBusy, clip, onClip, recorderBusy = false, currentRun = null }) {
  const [catalog, setCatalog] = useState(null), [job, setJob] = useState(null);
  const [recording, setRecording] = useState(''), [model, setModel] = useState(''), [rules, setRules] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [working, setWorking] = useState(false);
  const [connected, setConnected] = useState(false), [opening, setOpening] = useState(false);
  const [compareEnhancement, setCompareEnhancement] = useState(false);
  const [selectionChanged, setSelectionChanged] = useState(false);
  const explicitSelection = useRef(null), savedSelection = useRef(null);
  const token = useRef(''), version = useRef(0), opened = useRef(''), controller = useRef(null);
  const transfers = useRef(null);
  if (!transfers.current) transfers.current = createReviewTransfer();
  // Results open automatically when nothing is loaded, or for a job started here while the same review stayed loaded.
  // They never silently replace a different review.
  const autoOpen = useRef(''), runAtStart = useRef(null), runRef = useRef(currentRun); runRef.current = currentRun;
  const pollMisses = useRef(0);
  const resultHandler = useRef(onResult); resultHandler.current = onResult;
  const recorderActive = Boolean(recorderBusy || catalog?.recorder_active);
  const busy = Boolean(working || opening || activeJob(job) || recorderActive);
  const local = localAnalysisOrigin(globalThis.location), loopback = loopbackAddress(globalThis.location);
  useEffect(() => { onBusy(Boolean(working || opening || activeJob(job))); }, [working, opening, job, onBusy]);
  useEffect(() => () => { version.current++; controller.current?.abort(); transfers.current.cancel(); }, []);
  useEffect(() => {
    const changed = event => {
      if (event.type === TRAINING_SELECTION_EVENT || event.key === DEFAULT_RULES_KEY) setSelectionChanged(true);
    };
    window.addEventListener(TRAINING_SELECTION_EVENT, changed);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener(TRAINING_SELECTION_EVENT, changed);
      window.removeEventListener('storage', changed);
    };
  }, []);
  // Refresh a previously connected catalogue once an active operation finishes.
  // The operator's explicit choices still take precedence on this page.
  useEffect(() => {
    if (selectionChanged && connected && !busy) void connect({ selectionOnly: true });
  }, [selectionChanged, connected, busy]);
  // The session reports a recorder started elsewhere; a stop seen on this page clears that report.
  useEffect(() => { if (!recorderBusy) setCatalog(c => c?.recorder_active ? { ...c, recorder_active: false } : c); }, [recorderBusy]);

  // Status calls are small; a stalled one must surface instead of freezing progress. Starting copies and verifies files.
  async function request(path, options = {}, timeout = 10000) {
    const signal = AbortSignal.any([controller.current?.signal, AbortSignal.timeout(timeout)].filter(Boolean));
    const response = await analysisRequest(path, { token: token.current, ...options, signal });
    return response.json();
  }
  async function connect(options = {}) {
    if (!local) return;
    setSelectionChanged(false);
    const ticket = ++version.current;
    controller.current?.abort(); controller.current = new AbortController();
    setWorking(true); setConnected(false); setError(''); setMessage('Connecting to this computer…');
    try {
      const value = await request('/session');
      if (!Array.isArray(value.recordings) || !Array.isArray(value.models) || !Array.isArray(value.rules) || !value.token) throw Error('This app has no local analysis service. Open the configured local application.');
      if (ticket !== version.current) return;
      token.current = value.token; setCatalog(value); setConnected(true);
      // An automatic choice refresh must never open the training job's video.
      if (options.selectionOnly !== true) setJob(value.job);
      setRecording(previous => value.recordings.some(r => r.id === previous) ? previous : '');
      try { savedSelection.current = readTrainingSelection(globalThis.localStorage); }
      catch { savedSelection.current = null; }
      const choice = resolveTrainingSelection(value, savedSelection.current, explicitSelection.current);
      setModel(choice.modelId); setRules(choice.rulesId);
      setMessage(value.ready ? 'Choose a recording, model and rules. Analysis starts only when you press Analyze recording.' : 'Analysis or recording-validation dependencies are missing. Run the current installer or install the optional edge requirements, then reconnect.');
    } catch (err) { if (ticket === version.current) { setError(err.message); setMessage(''); } }
    finally { if (ticket === version.current) setWorking(false); }
  }
  function chooseModel(modelId) {
    const saved = savedSelection.current;
    const foreignSavedRule = saved?.modelId && saved.modelId !== modelId && saved.rulesId === rules;
    const explicit = { modelId, rulesId: foreignSavedRule ? '' : rules };
    const choice = resolveTrainingSelection(catalog, saved, explicit);
    explicitSelection.current = choice;
    setModel(choice.modelId); setRules(choice.rulesId);
  }
  function chooseRules(rulesId) {
    explicitSelection.current = { modelId: model, rulesId };
    setRules(rulesId);
  }
  async function start() {
    setWorking(true); setError(''); setMessage('Starting the selected recording…');
    opened.current = '';
    try {
      const next = await request('/jobs', { method: 'POST', body: { recording, model, rules,
        ...(compareEnhancement && catalog?.enhancement_comparisons?.includes('mild-unsharp-v1') ? {compare_enhancement:'mild-unsharp-v1'} : {}) } }, 120000);
      autoOpen.current = next.id; runAtStart.current = runRef.current; setJob(next);
    } catch (err) {
      setMessage('');
      if (refused(err)) { setError(err.message); return; }
      // A lost response is ambiguous: reconnect to the retained job before retrying.
      setConnected(false); setError(`${err.message} Reconnect to check whether the job started.`);
    } finally { setWorking(false); }
  }
  async function addRecording(file, captured = false) {
    if (!file || busy || !connected || !catalog?.recording_import?.enabled) return;
    const ticket = version.current;
    setWorking(true); setError(''); setMessage('Verifying and saving this recording on this computer…');
    try {
      const signal = AbortSignal.any([controller.current.signal, AbortSignal.timeout(35000)]);
      const result = await importRecording(file, token.current, signal);
      const value = await request('/session');
      if (ticket !== version.current) return;
      token.current = value.token; setCatalog(value); setJob(value.job); setRecording(result.recording.id);
      setMessage('Recording saved and selected. Choose rules, then press Analyze recording. No inference has started.');
      if (captured) onClip(null);
    } catch (err) { if (ticket === version.current) { setConnected(false); setMessage(''); setError(`${err.message} Reconnect and retry the same file if needed; saved imports are reused.`); } }
    finally { if (ticket === version.current) setWorking(false); }
  }
  async function cancel() {
    setWorking(true); setError('');
    try { setJob(await request(`/jobs/${job.id}/cancel`, { method: 'POST', body: {} })); }
    catch (err) {
      if (refused(err)) setError(err.message);
      else { setConnected(false); setError(`${err.message} Cancellation is unconfirmed. Reconnect to check the job.`); }
    }
    finally { setWorking(false); }
  }
  useEffect(() => {
    if (job?.state === 'failed') setMessage('Analysis stopped. Review the error, then explicitly start another recording.');
    else if (job?.state === 'cancelled') setMessage('Analysis cancelled. Your current review is preserved.');
    else if (activeJob(job)) setMessage('Processing on this computer. Your current review remains available below.');
  }, [job?.state]);
  useEffect(() => {
    if (!connected || working || !activeJob(job)) return;
    let disposed = false;
    const timeout = setTimeout(async () => {
      try { const next = await request(`/jobs/${job.id}`); pollMisses.current = 0; if (!disposed) setJob(next); }
      catch (err) {
        if (disposed) return;
        // Retry a slow status reply twice before reporting the connection as lost.
        if (!refused(err) && ++pollMisses.current < 3) { setJob(j => j && { ...j }); return; }
        pollMisses.current = 0; setConnected(false); setError(`${err.message} Reconnect to resume progress; do not start a duplicate job.`);
      }
    }, 500);
    return () => { disposed = true; clearTimeout(timeout); };
  }, [connected, job, working]);

  useEffect(() => {
    if (!connected || job?.state !== 'completed' || opened.current === job.id) return;
    if (runRef.current && (autoOpen.current !== job.id || runRef.current !== runAtStart.current)) {
      setMessage(`Analysis of ${job.recording} is complete. Choose Open results to review it; the review shown below stays open until then.`);
      return;
    }
    const ticket = version.current, reviewAtOpening = runRef.current;
    const operation = transfers.current.begin(controller.current?.signal, reason => {
      if (ticket !== version.current) return;
      setOpening(false);
      setMessage(reason?.name === 'TimeoutError'
        ? 'Opening timed out. Your current review is preserved. Refresh choices or choose Open results again when ready.'
        : 'Opening cancelled. Your current review is preserved. Refresh choices or choose Open results again when ready.');
    });
    if (!operation) return;
    opened.current = job.id;
    setOpening(true); setError(''); setMessage('Opening results and verifying the recording fingerprint…');
    openJobResult(job, token.current, operation.signal).then(value => {
      if (!transfers.current.isCurrent(operation) || ticket !== version.current) return;
      if (runRef.current !== reviewAtOpening) {
        setMessage('A different review was opened while these results were loading. Your newer review stays open. Choose Open results again to replace it when ready.');
        return;
      }
      // The job id lets Recognition ask this service for enrolled-people suggestions on these frames.
      resultHandler.current({ ...value, local: { job: job.id, token: token.current, people: catalog?.people || null } });
      setMessage('Analysis opened. Recording fingerprint matched; review the sampled detections below.');
    }).catch(err => {
      if (transfers.current.isCurrent(operation) && ticket === version.current) setError(`${err.message} Your previous review has been preserved. Use Open results again to retry.`);
    }).finally(() => {
      if (transfers.current.finish(operation) && ticket === version.current) setOpening(false);
    });
    return () => {
      if (transfers.current.finish(operation)) {
        operation.controller.abort(new DOMException('Result opening replaced', 'AbortError'));
        if (ticket === version.current) setOpening(false);
      }
    };
  }, [connected, job]);

  const compatible = catalog?.rules.find(r => r.id === rules)?.models.includes(model);
  return <section className="local-analysis" aria-label="Local recording analysis">
    <div className="local-analysis-heading"><div><p className="eyebrow">ANALYZE ON THIS COMPUTER</p><h2>Recording → recognition</h2></div>
      <span className="local-analysis-badge">{analysisBackendLabel(job, catalog?.backend)}</span></div>
    {!catalog && <p>Choose from your configured recordings folder. One bounded job runs at a time; footage and inference stay on this computer.</p>}
    {!local && <p>Analysis is available in the local application. This hosted preview can still open exported recognition results below.{loopback && <> <a href={loopback}>Open this page at 127.0.0.1</a></>}</p>}
    <div className="local-analysis-actions">
      <button className="button" disabled={!local || working || opening || (connected && Boolean(activeJob(job)))} onClick={connect}>{connected ? 'Refresh choices' : 'Connect local analysis'}</button>
      {opening && <button className="button" onClick={() => transfers.current.cancel()}>Cancel result opening</button>}
      {!catalog && <a href="https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-analysis-service.md" target="_blank" rel="noreferrer">Local setup guide</a>}
    </div>
    {clip && <div className="recording-import">
      <strong>Webcam clip ready</strong><p>{clip.name} · {(clip.blob.size/1024**2).toFixed(1)} MiB. Save or import before closing the page.</p>
      <div className="local-analysis-actions"><button className="button" onClick={() => downloadBlob(clip.blob, clip.name)}>Save clip</button>
        <button className="button amber" disabled={busy || !connected || !catalog?.recording_import?.enabled} onClick={() => addRecording(new File([clip.blob], clip.name, {type:clip.blob.type}), true)}>Import webcam clip</button>
        <button className="text-button" disabled={busy} onClick={() => onClip(null)}>Discard clip</button></div>
    </div>}
    {catalog && <>
      <div className="recording-import">
        {catalog.recording_import?.enabled ? <><label className="button">Import recording from this computer<input type="file" accept="video/*,.avi,.mkv" disabled={busy || !connected} aria-label="Import local recording" onChange={e => { const file=e.target.files?.[0]; e.target.value=''; void addRecording(file); }} /></label>
          <p>Copies your selected file to this local app’s recording folder. Up to 64 MiB per file; 20 imports / 512 MiB total. Originals stay unchanged. Saved imports remain until you move or delete them locally.</p></> :
          <p>Recording import is disabled. The local launcher’s <code>--allow-recording-import</code> option enables explicit same-computer file copies. You can still use the configured folder below.</p>}
      </div>
      <fieldset disabled={busy || !connected} className="local-analysis-fields">
        <label>Recording<select aria-label="Recording to analyze" value={recording} onChange={e => setRecording(e.target.value)}><option value="">Choose a recording…</option>{catalog.recordings.map(r => <option key={r.id} value={r.id}>{r.name} · {(r.bytes/1024**2).toFixed(1)} MiB</option>)}</select></label>
        <label>Model<select aria-label="Analysis model" value={model} onChange={e => chooseModel(e.target.value)}>{catalog.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Rules<select aria-label="Analysis rules" value={rules} onChange={e => chooseRules(e.target.value)}>{!rules && <option value="">Choose a compatible rule set</option>}{catalog.rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </fieldset>
      {catalog.enhancement_comparisons?.includes('mild-unsharp-v1') && <div className="recording-import">
        <label><input type="checkbox" checked={compareEnhancement} disabled={busy || !connected} onChange={e => setCompareEnhancement(e.target.checked)} /> Compare mild sharpening (experimental)</label>
        <p>Runs the same detector on original and sharpened samples. Extra processing shares the five-minute job limit. Original footage stays unchanged; rule observations use original detections. Detection accuracy is unqualified.</p>
      </div>}
      {!catalog.recordings.length && <p>No supported recordings found. Add an MP4/MOV, WebM/MKV or AVI file up to 512 MiB to the configured folder, then refresh choices.</p>}
      {catalog.rules.find(r => r.id === rules)?.summary.map((line, i) => <p className="local-analysis-rule" key={i}>{line}</p>)}
      {!catalog.rules.length ? <p className="recognition-error">No rule sets are configured. Add a rules file to the local application’s configuration, then refresh choices.</p>
        : !compatible && <p className="recognition-error">Choose rules whose labels are available in this model.</p>}
      {recorderActive && <p className="recognition-error">The LAN recorder is running. Stop it before analyzing a separate recording, then choose Refresh choices.</p>}
      <p className="local-analysis-limits">Up to 6,000 decoded frames · sample every 5 frames · 5-minute limit · 2 CPU threads. Reaching the frame cap produces a clearly marked partial result.</p>
      <p className="local-analysis-limits">{catalog.retention === 'private-local-last-job' ? 'The last analysis job and its verified recording snapshot stay on this computer across service restarts. Starting a new job replaces them.' : 'Results stay available until the service stops or a new job starts.'}</p>
      <div className="local-analysis-actions">
        <button className="button amber" disabled={busy || !connected || !catalog.ready || !recording || !compatible} onClick={start}>Analyze recording</button>
        {activeJob(job) && <button className="button" disabled={working || !connected} onClick={cancel}>Cancel analysis</button>}
        {job?.state === 'completed' && !busy && <button className="button" disabled={!connected} onClick={() => { opened.current = ''; autoOpen.current = job.id; runAtStart.current = runRef.current; setJob({...job}); }}>{opened.current === job.id ? 'Open results again' : 'Open results'}</button>}
      </div>
    </>}
    <p className="local-analysis-announcement" role="status" aria-live="polite" aria-atomic="true">{analysisAnnouncement(job, connected)}</p>
    {job && <div className="local-analysis-job">
      <p>{analysisBackendLabel(job, catalog?.backend)}</p>
      <strong>{job.recording}</strong><span>{job.phase} · {job.elapsed_seconds}s</span>
      {job.recovered && <p>Recovered from local storage after a service restart. No analysis was rerun.</p>}
      {job.compare_enhancement && <p>Original + mild sharpening comparison · original-only rule observations</p>}
      <p>{job.frames_analyzed} sampled frames · {job.frames_read} decoded / {job.max_frames} frame cap</p>
      {activeJob(job) && <progress aria-label="Analysis frame budget" value={job.frames_read} max={job.max_frames} />}
      {job.error && <p className={job.state === 'failed' ? 'recognition-error' : ''}>{job.error.message}</p>}
    </div>}
    {message && <p className="local-analysis-message">{message}</p>}
    {error && <p className="recognition-error" role="alert">{error}</p>}
    <p className="local-analysis-footnote">Existing reviews stay available until a new result passes validation. Closing this page does not cancel a job; reconnect to recover its status or cancel it.</p>
  </section>;
}
