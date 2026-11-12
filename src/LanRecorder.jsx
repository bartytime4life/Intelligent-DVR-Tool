import React, { useEffect, useRef, useState } from 'react';
import { analysisBackendLabel, localAnalysisOrigin, boundedBody, refused } from './local-analysis.mjs';
import { recorderSession, recorderRequest, openSegment, recorderMessage, TIMING_DRIFT_WARNING_SECONDS } from './lan-recorder.mjs';
import { saveObservationStills } from './local-images.mjs';
import { downloadBlob } from './clip-capture.mjs';
import { loopbackAddress } from './live-feeds.mjs';
import { recorderAnnouncement, analysisAnnouncement } from './status-announcements.mjs';
import { createReviewTransfer } from './review-transfer.mjs';

const mib = bytes => Number.isFinite(bytes) ? `${(bytes / 1024**2).toFixed(1)} MiB` : 'not available';

export default function LanRecorder({onResult, onBusy, blocked, onImport, onValidateImport, onStatus, reviewOpening, active = true}) {
  const [status, setStatus] = useState(null), [catalog, setCatalog] = useState(null);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [model, setModel] = useState(''), [rules, setRules] = useState('');
  const [error, setError] = useState(''), [working, setWorking] = useState(false), [connected, setConnected] = useState(false);
  const [transferring, setTransferring] = useState('');
  const token = useRef(''), lifetime = useRef(null), misses = useRef(0);
  const transfers = useRef(null);
  if (!transfers.current) transfers.current = createReviewTransfer();
  const [onlyObserved, setOnlyObserved] = useState(false), [handled, setHandled] = useState(() => new Set()), [notice, setNotice] = useState('');
  const local = localAnalysisOrigin(globalThis.location);
  useEffect(() => { lifetime.current = new AbortController(); return () => { lifetime.current.abort(); transfers.current.cancel(); }; }, []);
  useEffect(() => { if (!active) transfers.current.cancel(); }, [active]);
  useEffect(() => { onBusy(Boolean(working || transferring || status?.active || status?.state === 'stopping')); }, [working, transferring, status?.active, status?.state, onBusy]);
  // Losing contact does not stop the background recorder. Keep its last known
  // state visible across workspace switches until an explicit refresh confirms it.
  useEffect(() => { onStatus?.(status ? {
    active: connected && Boolean(status.active), name: status.name,
    unknown: !connected, lastKnownActive: Boolean(status.active), lastCheckedAt,
  } : null); }, [connected, status?.active, status?.name, lastCheckedAt, onStatus]);
  const acceptStatus = next => { setStatus(next); setLastCheckedAt(Date.now()); };
  const request = (path, body) => recorderRequest(path, {token: token.current, body,
    signal: AbortSignal.any([lifetime.current.signal, AbortSignal.timeout(15000)])});
  async function connect() {
    setWorking(true); setError('');
    try {
      const data = await (await recorderSession({signal: lifetime.current.signal})).json();
      token.current = data.token; setCatalog(data);
      setModel(v => data.models.some(m => m.id === v) ? v : data.models[0]?.id || '');
      setRules(v => data.rules.some(r => r.id === v) ? v : data.rules[0]?.id || '');
      acceptStatus(await (await request('/status')).json()); setConnected(true);
    } catch (err) { setConnected(false); setError(err.message); }
    finally { setWorking(false); }
  }
  useEffect(() => {
    const configured = () => { if (local) void connect(); };
    window.addEventListener('dvr-recorder-configured', configured);
    return () => window.removeEventListener('dvr-recorder-configured', configured);
  }, [local]);
  useEffect(() => {
    if (!connected || working) return;
    let disposed = false;
    const timer = setTimeout(async () => {
      try { const next = await (await request('/status')).json(); misses.current = 0; if (!disposed) acceptStatus(next); }
      catch (err) {
        if (disposed) return;
        if (!refused(err) && ++misses.current < 3) { setStatus(s => s && {...s}); return; }
        misses.current = 0; setConnected(false); setError(`Status unavailable; recording may still be running. ${err.message}`);
      }
    }, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [connected, status, working]);
  async function action(name) {
    setWorking(true); setError('');
    try { acceptStatus(await (await request('/' + name, name === 'start' ? {model, rules} : {})).json()); }
    catch (err) {
      if (refused(err)) setError(err.message);
      else { setConnected(false); setError(`${err.message} Refresh status to confirm whether the action completed.`); }
    }
    finally { setWorking(false); }
  }
  const markHandled = id => setHandled(previous => new Set(previous).add(id));
  function beginTransfer(message) {
    if (working) return null;
    const operation = transfers.current.begin(lifetime.current.signal, reason => {
      if (lifetime.current.signal.aborted) return;
      setTransferring('');
      setNotice(reason?.name === 'TimeoutError'
        ? 'Review transfer timed out. Your current review is preserved; nothing was sent to Events. Try again when ready.'
        : 'Review transfer cancelled. Your current review is preserved; nothing was sent to Events.');
    });
    if (operation) { setTransferring(message); setError(''); setNotice(''); }
    return operation;
  }
  function finishTransfer(operation) {
    if (transfers.current.finish(operation) && !lifetime.current.signal.aborted) setTransferring('');
  }
  async function open(row) {
    const operation = beginTransfer('Opening segment and verifying its recording…');
    if (!operation) return;
    const intent = reviewOpening.begin();
    try {
      const result = await openSegment(row, token.current, operation.signal);
      if (!transfers.current.isCurrent(operation)) return;
      if (!reviewOpening.isCurrent(intent) || onResult(result, intent) === false) {
        setNotice('A newer review was requested. Your newer review stays open. Choose Review segment again when ready.');
        return;
      }
      markHandled(row.id);
    } catch (err) { if (transfers.current.isCurrent(operation)) setError(`${err.message} Your current review is preserved.`); }
    finally { finishTransfer(operation); }
  }
  // Explicit per-segment hand-off: verify, keep stills, then queue the observations for human review.
  async function send(row) {
    const operation = beginTransfer('Preparing this segment’s observations for Events…');
    if (!operation) return;
    try {
      const {bundle, file} = await openSegment(row, token.current, operation.signal);
      if (!transfers.current.isCurrent(operation)) return;
      if (!bundle.events.length) { setNotice('This segment has no rule observations to send.'); markHandled(row.id); return; }
      if (onValidateImport?.(bundle.events) === false) return;
      await saveObservationStills(file, bundle, {signal:operation.signal});
      if (!transfers.current.isCurrent(operation)) return;
      if (onImport?.(bundle.events, false)) { markHandled(row.id); setNotice(`${bundle.events.length} observations from ${new Date(row.created_at * 1000).toLocaleTimeString()} sent to Events for review.`); }
    } catch (err) { if (transfers.current.isCurrent(operation)) setError(`${err.message} Nothing was sent; your current review is preserved.`); }
    finally { finishTransfer(operation); }
  }
  async function timing(row) {
    const operation = beginTransfer('Opening this segment’s timing receipt…');
    if (!operation) return;
    try {
      const response = await recorderRequest(`/segments/${row.id}/timing`, {token:token.current,signal:operation.signal});
      const blob = await boundedBody(response, 64 * 1024, {signal:operation.signal});
      if (transfers.current.isCurrent(operation)) downloadBlob(blob, `${row.source}-${row.id}-timing.json`);
    } catch (err) { if (transfers.current.isCurrent(operation)) setError(err.message); }
    finally { finishTransfer(operation); }
  }
  const compatible = catalog?.rules.find(r => r.id === rules)?.models.includes(model);
  return <section className="local-analysis lan-recorder" aria-label="LAN camera recorder">
    <p className="local-analysis-announcement" role="status" aria-live="polite" aria-atomic="true">{recorderAnnouncement(status, connected)}</p>
    <div className="local-analysis-heading"><div><p className="eyebrow">ONE AUTHORIZED LAN CAMERA</p><h2>Record & analyze</h2></div>
      <span className="local-analysis-badge">{connected ? status?.state.replaceAll('_', ' ') : status ? 'Status unknown · reconnect' : 'Status not connected'}</span></div>
    <p>Record bounded video-only segments and analyze them on this computer. Recording starts only when you press Start recording & analysis. It continues when you leave this page, until Stop or service shutdown.</p>
    <div className="local-analysis-actions"><button className="button" disabled={!local || working || Boolean(transferring)} onClick={connect}>{status ? 'Refresh recorder status' : 'Connect LAN recorder'}</button>
      <a href="https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/lan-recording.md" target="_blank" rel="noreferrer">LAN recording guide</a></div>
    {!local && <p>Use the configured local application on this computer for LAN recording.{loopbackAddress(globalThis.location) && <> <a href={loopbackAddress(globalThis.location)}>Open this page at 127.0.0.1</a></>}</p>}
    {status && <>
      <h3>{status.name}</h3>
      {!connected && <p className="recognition-error" role="status">Recording status is unknown. The details below were last checked{lastCheckedAt ? ` at ${new Date(lastCheckedAt).toLocaleTimeString()}` : ''}; recording may still be running. Refresh recorder status to confirm.</p>}
      <p>{status.limits.segment_seconds}s segments · up to 10 fps / 960px · retention {status.limits.retention_minutes} minutes / {status.limits.max_segments} segments / {status.limits.max_storage_mib} MiB. Oldest retained files, including pending work, can expire. Export evidence you need to keep.</p>
      <fieldset className="local-analysis-fields" disabled={working || Boolean(transferring) || !connected || status.active || blocked}>
        <label>Recorder model<select aria-label="Recorder model" value={model} onChange={e => setModel(e.target.value)}>{catalog?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Recorder rules<select aria-label="Recorder rules" value={rules} onChange={e => setRules(e.target.value)}>{catalog?.rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </fieldset>
      <div className="local-analysis-actions">
        <button className="button amber" disabled={working || Boolean(transferring) || !connected || status.active || status.state === 'stopping' || blocked || !catalog?.ready || !compatible} onClick={() => action('start')}>Start recording & analysis</button>
        <button className="button" disabled={working || !connected || (!status.active && status.state !== 'stopping')} onClick={() => action('stop')}>Stop recording & analysis</button>
      </div>
      {transferring && <div className="local-analysis-actions"><p role="status">{transferring}</p><button className="button" onClick={() => transfers.current.cancel()}>Cancel review transfer</button></div>}
      <div className="lan-recorder-facts">
        <span><strong>{status.counters.recorded}</strong> recorded · {status.counters.analyzed} analyzed</span>
        <span>{status.queue_depth} pending · oldest {status.oldest_pending_seconds}s</span>
        <span>{status.counters.dropped} dropped / failed · {status.counters.expired} expired{Number.isFinite(status.counters.expired_age) ? ` (${status.counters.expired_age} by age · ${status.counters.evicted_space ?? 0} for storage limit · ${status.counters.evicted_disk ?? 0} for free space)` : ''} · {status.counters.reconnects} retries</span>
        <span>{mib(status.storage_bytes)} retained · {mib(status.disk_free_bytes)} free</span>
        <span>Capture worker: {status.worker.cpu_seconds ?? '—'} CPU seconds · peak memory {mib(status.worker.peak_rss_bytes)}</span>
        <span>Last segment {status.seconds_since_completed_segment === null ? 'not completed this session' : `${status.seconds_since_completed_segment}s ago`} · retry in {status.retry_seconds}s</span>
        {status.supervisor && <span className={status.supervisor.alive ? '' : 'recognition-error'}>Supervisor {status.supervisor.alive ? `running · checked ${status.supervisor.last_tick_age_seconds ?? '—'}s ago` : 'stopped — restart the service'}</span>}
      </div>
      <p className="local-analysis-announcement" role="status" aria-live="polite" aria-atomic="true">{analysisAnnouncement(status.analysis_job, connected)}</p>
      {status.analysis_job && <p>{analysisBackendLabel(status.analysis_job, catalog?.backend)} · {status.analysis_job.frames_analyzed} samples analyzed</p>}
      {status.error && <p className="recognition-error" role="status">{recorderMessage(status.error)}</p>}
      <p className="local-analysis-footnote">This first recorder reconnects between segments and samples frames. Gaps are possible. Clip playback uses a nominal 10 fps; the timing download records local receive times. These are not camera timestamps, unique-person counts or verified recognition accuracy. Restart always leaves recording stopped.</p>
      {!!status.segments.length && (() => {
        const completed = status.segments.filter(row => row.state === 'completed'), unhandled = completed.filter(row => !handled.has(row.id)).length;
        const rows = onlyObserved ? status.segments.filter(row => row.observations > 0) : status.segments;
        return <>
          <div className="lan-segment-tools">
            <label className="checkbox-label"><input type="checkbox" checked={onlyObserved} onChange={e => setOnlyObserved(e.target.checked)} />Only segments with observations</label>
            {unhandled > 0 && <span className="lan-new-badge">{unhandled} completed not yet reviewed or sent</span>}
          </div>
          <div className="lan-segment-list" aria-label="Retained camera segments">{rows.map(row => {
            const drift = Number.isFinite(row.timing_drift_seconds) ? row.timing_drift_seconds : (row.missed_sample_slots ?? 0) * .1;
            return <div className={`lan-segment ${row.state === 'completed' && !handled.has(row.id) ? 'unhandled' : ''}`} key={row.id}>
              <div><strong>{new Date(row.created_at * 1000).toLocaleTimeString()} · {row.state} · {Number.isInteger(row.observations) ? `${row.observations} observation${row.observations === 1 ? '' : 's'}` : 'observations —'}</strong>
                <small>{row.frames ?? 0} frames · capture {row.capture_seconds ?? '—'}s · completion lag {row.completion_lag_seconds ?? '—'}s · analysis lag {row.analysis_lag_seconds ?? '—'}s · gap before {row.gap_before_seconds ?? '—'}s · missed sample slots {row.missed_sample_slots ?? 0}</small>
                {drift > TIMING_DRIFT_WARNING_SECONDS && <small className="recognition-error">Sampled times may lag real time by up to {drift.toFixed(1)}s; dwell results in this segment may be affected.</small>}
                {row.error && <small className="recognition-error">{recorderMessage(row.error)}{row.cause ? ` Cause: ${recorderMessage(row.cause)}` : ''}</small>}</div>
              {row.state === 'completed' && <div className="local-analysis-actions"><button className="button" disabled={working || Boolean(transferring) || !connected} onClick={() => open(row)}>Review segment</button>
                {onImport && row.observations !== 0 && <button className="button" disabled={working || Boolean(transferring) || !connected} onClick={() => send(row)}>Send to Events</button>}
                <button className="text-button" disabled={working || Boolean(transferring) || !connected} onClick={() => timing(row)}>Save timing</button></div>}
            </div>;
          })}{!rows.length && <p>No retained segments have observations yet.</p>}</div>
        </>;
      })()}
    </>}
    {notice && <p className="local-analysis-message" role="status">{notice}</p>}
    {error && <p className="recognition-error" role="alert">{error}</p>}
  </section>;
}
