import React, { useEffect, useRef, useState } from 'react';
import { activeJob, analysisRequest, localAnalysisOrigin, openJobResult, importRecording } from './local-analysis.mjs';
import { downloadBlob } from './clip-capture.mjs';

export default function LocalAnalysis({ onResult, onBusy, clip, onClip }) {
  const [catalog, setCatalog] = useState(null), [job, setJob] = useState(null);
  const [recording, setRecording] = useState(''), [model, setModel] = useState(''), [rules, setRules] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [working, setWorking] = useState(false);
  const [connected, setConnected] = useState(false), [opening, setOpening] = useState(false);
  const token = useRef(''), version = useRef(0), opened = useRef(''), controller = useRef(null);
  const resultHandler = useRef(onResult); resultHandler.current = onResult;
  const busy = Boolean(working || opening || activeJob(job));
  const local = localAnalysisOrigin(globalThis.location);
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  useEffect(() => () => { version.current++; controller.current?.abort(); }, []);

  async function request(path, options = {}) {
    const response = await analysisRequest(path, { token: token.current, ...options, signal: controller.current?.signal });
    return response.json();
  }
  async function connect() {
    if (!local) return;
    const ticket = ++version.current;
    controller.current?.abort(); controller.current = new AbortController();
    setWorking(true); setConnected(false); setError(''); setMessage('Connecting to this computer…');
    try {
      const value = await request('/session');
      if (!Array.isArray(value.recordings) || !Array.isArray(value.models) || !Array.isArray(value.rules) || !value.token) throw Error('This app has no local analysis service. Open the configured local application.');
      if (ticket !== version.current) return;
      token.current = value.token; setCatalog(value); setConnected(true); setJob(value.job);
      setRecording(previous => value.recordings.some(r => r.id === previous) ? previous : '');
      setModel(previous => value.models.some(m => m.id === previous) ? previous : value.models[0]?.id || '');
      setRules(previous => value.rules.some(r => r.id === previous) ? previous : value.rules[0]?.id || '');
      setMessage(value.ready ? 'Choose a recording, model and rules. Analysis starts only when you press Analyze recording.' : 'CPU dependencies are missing. Install the optional edge requirements in the service environment, then reconnect.');
    } catch (err) { if (ticket === version.current) { setError(err.message); setMessage(''); } }
    finally { if (ticket === version.current) setWorking(false); }
  }
  async function start() {
    setWorking(true); setError(''); setMessage('Starting the selected recording…');
    opened.current = '';
    try { setJob(await request('/jobs', { method: 'POST', body: { recording, model, rules } })); }
    catch (err) {
      // A lost response is ambiguous: reconnect to the retained job before retrying.
      setConnected(false); setMessage(''); setError(`${err.message} Reconnect to check whether the job started.`);
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
    catch (err) { setConnected(false); setError(`${err.message} Cancellation is unconfirmed. Reconnect to check the job.`); }
    finally { setWorking(false); }
  }
  useEffect(() => {
    if (job?.state === 'failed') setMessage('Analysis stopped. Review the error, then explicitly start another recording.');
    else if (job?.state === 'cancelled') setMessage('Analysis cancelled. Your current review is preserved.');
    else if (activeJob(job)) setMessage('Processing on this computer. Your current review remains available below.');
  }, [job?.state]);
  useEffect(() => {
    if (!connected || !activeJob(job)) return;
    let disposed = false;
    const timeout = setTimeout(async () => {
      try { const next = await request(`/jobs/${job.id}`); if (!disposed) setJob(next); }
      catch (err) { if (!disposed) { setConnected(false); setError(`${err.message} Reconnect to resume progress; do not start a duplicate job.`); } }
    }, 500);
    return () => { disposed = true; clearTimeout(timeout); };
  }, [connected, job]);

  useEffect(() => {
    if (!connected || job?.state !== 'completed' || opened.current === job.id) return;
    opened.current = job.id;
    const ticket = version.current;
    let disposed = false;
    setOpening(true); setError(''); setMessage('Opening results and verifying the recording fingerprint…');
    openJobResult(job, token.current, controller.current?.signal).then(value => {
      if (disposed || ticket !== version.current) return;
      resultHandler.current(value);
      setMessage('Analysis opened. Recording fingerprint matched; review the sampled detections below.');
    }).catch(err => {
      if (!disposed && ticket === version.current) setError(`${err.message} Your previous review has been preserved. Use Open results again to retry.`);
    }).finally(() => { if (!disposed && ticket === version.current) setOpening(false); });
    return () => { disposed = true; };
  }, [connected, job]);

  const compatible = catalog?.rules.find(r => r.id === rules)?.models.includes(model);
  return <section className="local-analysis" aria-label="Local recording analysis">
    <div className="local-analysis-heading"><div><p className="eyebrow">ANALYZE ON THIS COMPUTER</p><h2>Recording → recognition</h2></div>
      <span className="local-analysis-badge">CPU · local files only</span></div>
    {!catalog && <p>Choose from your configured recordings folder. One bounded job runs at a time; footage and inference stay on this computer.</p>}
    {!local && <p>Analysis is available in the local application. This hosted preview can still open exported recognition results below.</p>}
    <div className="local-analysis-actions">
      <button className="button" disabled={!local || working || opening || (connected && Boolean(activeJob(job)))} onClick={connect}>{connected ? 'Refresh choices' : 'Connect local analysis'}</button>
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
        <label>Model<select aria-label="Analysis model" value={model} onChange={e => setModel(e.target.value)}>{catalog.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Rules<select aria-label="Analysis rules" value={rules} onChange={e => setRules(e.target.value)}>{catalog.rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </fieldset>
      {!catalog.recordings.length && <p>No supported recordings found. Add an MP4/MOV, WebM/MKV or AVI file up to 512 MiB to the configured folder, then refresh choices.</p>}
      {catalog.rules.find(r => r.id === rules)?.summary.map((line, i) => <p className="local-analysis-rule" key={i}>{line}</p>)}
      {!compatible && <p className="recognition-error">Choose rules whose labels are available in this model.</p>}
      <p className="local-analysis-limits">Up to 6,000 decoded frames · sample every 5 frames · 5-minute limit · 2 CPU threads. Reaching the frame cap produces a clearly marked partial result.</p>
      <p className="local-analysis-limits">{catalog.retention === 'private-local-last-job' ? 'The last analysis job and its verified recording snapshot stay on this computer across service restarts. Starting a new job replaces them.' : 'Results stay available until the service stops or a new job starts.'}</p>
      <div className="local-analysis-actions">
        <button className="button amber" disabled={busy || !connected || !catalog.ready || !recording || !compatible} onClick={start}>Analyze recording</button>
        {activeJob(job) && <button className="button" disabled={working || !connected} onClick={cancel}>Cancel analysis</button>}
        {job?.state === 'completed' && !busy && <button className="button" disabled={!connected} onClick={() => { opened.current = ''; setJob({...job}); }}>Open results again</button>}
      </div>
    </>}
    {job && <div className="local-analysis-job" aria-live="polite">
      <strong>{job.recording}</strong><span>{job.phase} · {job.elapsed_seconds}s</span>
      {job.recovered && <p>Recovered from local storage after a service restart. No analysis was rerun.</p>}
      <p>{job.frames_analyzed} sampled frames · {job.frames_read} decoded / {job.max_frames} frame cap</p>
      {activeJob(job) && <progress aria-label="Analysis frame budget" value={job.frames_read} max={job.max_frames} />}
      {job.error && <p className={job.state === 'failed' ? 'recognition-error' : ''}>{job.error.message}</p>}
    </div>}
    {message && <p className="local-analysis-message">{message}</p>}
    {error && <p className="recognition-error" role="alert">{error}</p>}
    <p className="local-analysis-footnote">Existing reviews stay available until a new result passes validation. Closing this page does not cancel a job; reconnect to recover its status or cancel it.</p>
  </section>;
}
