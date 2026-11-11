import React, { useEffect, useRef, useState } from 'react';
import { analysisBackendLabel, localAnalysisOrigin, refused } from './local-analysis.mjs';
import { DEFAULT_LIBRARY_CONFIG, libraryRequest, libraryConfig, cameraConfig, openLibraryItem, libraryCoverage, storageSize } from './backup-library.mjs';
import { MAX_VIDEO_BYTES } from './recognition.mjs';
import { backupAnnouncement, analysisAnnouncement } from './status-announcements.mjs';
import { createReviewTransfer } from './review-transfer.mjs';
import './backup-library.css';

export default function BackupLibrary({onResult, onBusy, onStatus, blocked = false, reviewOpening, active = true, cameraSetupRequest = null}) {
  const [status, setStatus] = useState(null), [catalog, setCatalog] = useState(null), [config, setConfig] = useState({...DEFAULT_LIBRARY_CONFIG});
  const [connected, setConnected] = useState(false), [working, setWorking] = useState(false), [dirty, setDirty] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [pickerNote, setPickerNote] = useState('');
  const [analyze, setAnalyze] = useState(false), [model, setModel] = useState(''), [rules, setRules] = useState('');
  const [cameras, setCameras] = useState(null), [cameraError, setCameraError] = useState(''), [cameraMessage, setCameraMessage] = useState('');
  const [camera, setCamera] = useState({name:'',host:'',port:554,path:'',username:'',password:''}), [cameraWorking, setCameraWorking] = useState(false);
  const [recorderSource, setRecorderSource] = useState('');
  const token = useRef(''), lifetime = useRef(null), pending = useRef(false);
  const connectButton = useRef(), cameraSetupPanel = useRef(), cameraSetupForm = useRef();
  const setupFocus = useRef({request:null, phase:null});
  const transfers = useRef(null);
  if (!transfers.current) transfers.current = createReviewTransfer();
  const local = localAnalysisOrigin(globalThis.location);
  useEffect(() => {
    if (!cameraSetupRequest || !active || working || transferring) return;
    const progress = setupFocus.current;
    if (progress.request === cameraSetupRequest && progress.phase === 'form') return;
    const phase = connected && cameras ? 'form' : 'connect';
    if (progress.request === cameraSetupRequest && progress.phase === phase) return;
    if (cameraSetupPanel.current) cameraSetupPanel.current.open = true;
    const target = phase === 'form'
      ? cameras.enabled === false ? cameraSetupPanel.current : cameraSetupForm.current?.querySelector('input:not(:disabled)') || cameraSetupForm.current
      : local && !connectButton.current?.disabled ? connectButton.current : cameraSetupPanel.current;
    if (document.querySelector('dialog[open]')) return;
    target?.focus({preventScroll:true}); target?.scrollIntoView({block:'center'});
    if (document.activeElement === target) setupFocus.current = {request:cameraSetupRequest, phase};
  }, [cameraSetupRequest, active, working, transferring, connected, cameras, local]);
  useEffect(() => { lifetime.current = new AbortController(); return () => { lifetime.current.abort(); transfers.current.cancel(); }; }, []);
  useEffect(() => { if (!active) transfers.current.cancel(); }, [active]);
  // Copying alone does not reserve the analyzer. A disconnected status stays visible until refreshed.
  useEffect(() => { onBusy(Boolean(transferring || status?.analyzing)); }, [transferring, status?.analyzing, onBusy]);
  useEffect(() => { onStatus?.({active: Boolean(connected && status?.active), unknown: Boolean(status && !connected), error: Boolean(error || status?.error)}); }, [connected, status?.active, status?.error, error, onStatus]);
  const request = (path, body, setup = false) => libraryRequest(path, {token: token.current, body, setup, signal: lifetime.current.signal});
  const receivedStatus = next => { setStatus(next); setCheckedAt(Date.now()); };
  async function loadCameras() {
    setCameraError('');
    try {
      const data = await (await request('/cameras', undefined, true)).json(); setCameras(data);
      setRecorderSource(value => data.sources?.some(s => s.id === value) ? value : data.sources?.[0]?.id || '');
    }
    catch (err) { if (!lifetime.current.signal.aborted) setCameraError(err.message); }
  }
  async function connect() {
    if (!local || pending.current) return;
    pending.current = true; setWorking(true); setError('');
    try {
      const data = await (await request('/session')).json();
      if (!data.token || !Array.isArray(data.models) || !Array.isArray(data.rules)) throw Error('Open the configured local application on this computer, then reconnect.');
      token.current = data.token; setCatalog(data);
      if (data.analysis_enabled === false) setAnalyze(false);
      setModel(v => data.models.some(m => m.id === v) ? v : data.models[0]?.id || '');
      setRules(v => data.rules.some(r => r.id === v) ? v : data.rules[0]?.id || '');
      const next = await (await request('/status')).json();
      receivedStatus(next); if (next.config && !dirty) setConfig(next.config); setConnected(true);
      setMessage(next.active ? 'Backup is already running. Review its status below.' : 'Connected. Save your folders, then explicitly start backup.');
      await loadCameras();
    } catch (err) { if (!lifetime.current.signal.aborted) {setConnected(false); setError(`${err.message} Background backup may continue if it was already started.`);} }
    finally { pending.current = false; setWorking(false); }
  }
  useEffect(() => {
    if (!connected || working) return;
    let disposed = false;
    const timer = setTimeout(async () => {
      if (pending.current) { if (!disposed) setStatus(s => s && {...s}); return; }
      try { const next = await (await request('/status')).json(); if (!disposed) receivedStatus(next); }
      catch (err) { if (!disposed) {setConnected(false); setError(`Status unavailable. Background backup may continue. ${err.message} Reconnect before starting again.`);} }
    }, 2000);
    return () => {disposed = true; clearTimeout(timer);};
  }, [connected, status, working]);
  const edit = (key, value) => {setConfig(c => ({...c, [key]: value})); setDirty(true);};
  async function pickFolder(key) {
    setWorking(true); setError(''); setPickerNote(''); pending.current = true;
    setPickerNote('Folder chooser is open on this computer. Choose a folder or cancel it to continue.');
    try {
      const value = await (await libraryRequest('/pick-folder', {body:{}, token:token.current, signal:lifetime.current.signal, timeout:125000})).json();
      if (value.path) edit(key, value.path); setPickerNote('');
    }
    catch (err) { setPickerNote(`${err.message} You can type or paste the full folder path instead.`); }
    finally {pending.current = false; setWorking(false);}
  }
  async function act(action, body, success) {
    let payload = body;
    if (action === 'configure') {
      try {payload = libraryConfig(config);} catch (err) {setError(err.message); return;}
    }
    pending.current = true; setWorking(true); setError(''); setMessage('');
    try {
      const next = await (await request('/' + action, payload)).json(); receivedStatus(next);
      if (action === 'configure') {setDirty(false); if (next.config) setConfig(next.config);}
      setMessage(success);
    } catch (err) {
      if (!refused(err)) {setConnected(false); setError(`${err.message} Reconnect to confirm the action; background backup may continue.`);}
      else setError(err.message);
    } finally {pending.current = false; setWorking(false);}
  }
  async function open(item) {
    if (pending.current) return;
    const operation = transfers.current.begin(lifetime.current.signal, reason => {
      if (lifetime.current.signal.aborted) return;
      setTransferring(false);
      setMessage(reason?.name === 'TimeoutError' ? 'Opening timed out. Your current review is preserved. Try again when ready.' : 'Opening cancelled. Your current review is preserved.');
    });
    if (!operation) return;
    const intent = reviewOpening.begin();
    setTransferring(true); setError(''); setMessage('');
    try {
      const result = await openLibraryItem(item, token.current, operation.signal);
      if (!transfers.current.isCurrent(operation)) return;
      if (!reviewOpening.isCurrent(intent) || onResult(result, intent) === false) {
        setMessage('A newer review was requested. Your newer review stays open. Choose Review backup again when ready.');
        return;
      }
      setMessage(`Opened ${item.name}. Review its sampled frames below.`);
    } catch (err) {if (transfers.current.isCurrent(operation)) setError(`${err.message} Your current review is preserved.`);}
    finally {if (transfers.current.finish(operation) && !lifetime.current.signal.aborted) setTransferring(false);}
  }
  async function saveCamera(event) {
    event.preventDefault(); setCameraWorking(true); setCameraError(''); setCameraMessage('');
    try {
      const result = await (await request('/cameras', cameraConfig(camera), true)).json();
      setCamera(c => ({...c, password:''}));
      if (Array.isArray(result.sources)) {setCameras(result); setRecorderSource(value => value || result.sources[0]?.id || '');} else await loadCameras();
      setCameraMessage('Camera saved on this computer. Open Monitor and explicitly connect this source. Saving does not connect or record.');
    } catch (err) {setCamera(c => ({...c, password:''})); setCameraError(err.message);}
    finally {setCameraWorking(false);}
  }
  async function configureRecorder() {
    setCameraWorking(true); setCameraError(''); setCameraMessage('');
    try {
      await request('/recorder', {source:recorderSource}, true);
      window.dispatchEvent(new CustomEvent('dvr-recorder-configured'));
      setCameraMessage('LAN recorder source saved. Review its settings below, then explicitly press Start recording & analysis when ready.');
    } catch (err) {setCameraError(err.message);}
    finally {setCameraWorking(false);}
  }
  const compatible = Boolean(catalog?.rules.find(r => r.id === rules)?.models?.includes(model));
  const unavailable = !local || !connected || working;
  const stopping = status?.state === 'stopping';
  const items = Array.isArray(status?.items) ? status.items.slice(0,100) : [];
  const copying = status?.copying;
  const copyTotal = Number.isFinite(copying?.bytes) && copying.bytes > 0 ? copying.bytes : null;
  const copyDone = Number.isFinite(copying?.copied_bytes) ? Math.max(0, Math.min(copying.copied_bytes, copyTotal ?? Infinity)) : null;
  return <section className="local-analysis backup-library" aria-label="Existing DVR backup">
    <p className="local-analysis-announcement" role="status" aria-live="polite" aria-atomic="true">{backupAnnouncement(status, connected)}</p>
    <div className="local-analysis-heading"><div><p className="eyebrow">LOCAL BACKUP &amp; ANALYSIS</p><h2>Use my existing DVR</h2></div>
      <span className={`local-analysis-badge ${connected && status?.active ? 'backup-running' : !connected && status ? 'backup-stale' : ''}`}>{connected ? stopping ? 'Stopping backup' : status?.analyzing ? 'Analyzing locally' : status?.active ? 'Backup running' : 'Backup paused' : status ? 'Status unknown' : 'Not connected'}</span></div>
    <p className="backup-intro">Keep your OEM DVR software recording. Save another copy of its finished videos here, with optional analysis on this computer.</p>
    <ol className="backup-steps" aria-label="DVR companion setup"><li className={connected ? !status?.configured ? 'current' : 'complete' : ''}><span>1</span><strong>Choose folders</strong><small>Your DVR → your backup</small></li><li className={connected && status?.active ? 'current' : ''}><span>2</span><strong>Keep another copy</strong><small>Start when you are ready</small></li><li className={connected && status?.analyzing ? 'current' : ''}><span>3</span><strong>Analyze locally</strong><small>Optional · review every result</small></li></ol>
    <div className="local-analysis-actions"><button ref={connectButton} className="button" onClick={connect} disabled={!local || working || transferring}>{status ? 'Refresh backup connection' : 'Connect to this computer'}</button><span className="backup-local-note">Files and analysis stay on this computer.</span></div>
    {!connected && !status && <p className="backup-connection-hint">Start here: connect to the local app to unlock folder setup. Connecting checks availability; backup starts only when you choose Start backup.</p>}
    {!connected && status && <p className="backup-notice" role="status">Last checked {new Date(checkedAt).toLocaleTimeString()}. Saved-video details, storage and progress below are from that check. Backup may still be running. Refresh the connection to check its current state.</p>}
    {!local && <p>Open the installed local app at 127.0.0.1 to use local backup and camera setup.</p>}
    <fieldset className="backup-folder-fields" disabled={unavailable || transferring || status?.active || status?.analyzing || stopping}>
      <legend>1. Choose your folders</legend>
      <label>DVR source folder <small>Read only · finished recordings or OEM exports</small><span className="backup-path-input"><input value={config.source_folder} onChange={e => edit('source_folder',e.target.value)} placeholder="Full path to your DVR recordings" aria-label="DVR source folder" autoComplete="off" spellCheck="false" /><button type="button" className="button" onClick={() => pickFolder('source_folder')}>Choose source folder</button></span></label>
      <label>Separate backup folder <small>The additional copy is saved here</small><span className="backup-path-input"><input value={config.backup_folder} onChange={e => edit('backup_folder',e.target.value)} placeholder="Full path to a separate backup folder" aria-label="Backup folder" autoComplete="off" spellCheck="false" /><button type="button" className="button" onClick={() => pickFolder('backup_folder')}>Choose backup folder</button></span></label>
      <details className="backup-settings"><summary>Storage &amp; file settings</summary><div className="backup-settings-grid">
        <label>Storage budget (GiB)<input type="number" min="1" max="1000000" step="1" value={config.max_storage_gib} onChange={e => edit('max_storage_gib',e.target.value)} /></label>
        <label>Keep free on disk (GiB)<input type="number" min="1" max="1024" step="1" value={config.reserve_gib} onChange={e => edit('reserve_gib',e.target.value)} /></label>
        <label>Wait after file changes (seconds)<input type="number" min="30" max="3600" step="1" value={config.settle_seconds} onChange={e => edit('settle_seconds',e.target.value)} /></label>
      </div><label className="backup-checkbox"><input type="checkbox" checked={config.recursive} onChange={e => edit('recursive',e.target.checked)} />Include subfolders</label></details>
      <div className="local-analysis-actions"><button className="button" onClick={() => act('configure', null, 'Folders and storage settings saved. Press Start backup when you are ready.')}>Save settings</button>{dirty && <span className="backup-unsaved">Unsaved folder settings</span>}</div>
    </fieldset>
    {pickerNote && <p className="backup-notice" role="status">{pickerNote}</p>}
    <p className="backup-format-note">Finished MP4, MOV, M4V, AVI, MKV and WebM videos can be copied and analyzed. Common proprietary DVR and legacy video formats are copied as backup only; export a standard video from the OEM software for analysis. Files must stop changing before they are copied; quiet time cannot confirm a recording has finished.</p>
    <fieldset className="backup-analysis-fields" disabled={unavailable || transferring || status?.active || status?.analyzing || stopping}>
      <legend>2. Keep another copy · 3. Analyze locally</legend>
      <label className="backup-checkbox"><input type="checkbox" checked={analyze} disabled={catalog?.analysis_enabled === false} onChange={e => setAnalyze(e.target.checked)} />Analyze copied videos automatically</label>
      {catalog?.analysis_enabled === false && <p className="backup-notice">Copy-only mode: no recognition model is configured. You can save verified copies now. Prepare your existing approved model and restart the companion to enable analysis; no model is downloaded automatically.</p>}
      <span className="backup-local-note">Off by default. Selecting this starts local analysis when you start backup.</span>
      {analyze && <div className="backup-model-fields"><label>Backup analysis model<select value={model} onChange={e => setModel(e.target.value)}>{catalog?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Backup analysis rules<select value={rules} onChange={e => setRules(e.target.value)}>{catalog?.rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div>}
      {analyze && blocked && <p className="backup-notice">Another recording or analysis is using the analyzer. You can start backup with automatic analysis turned off.</p>}
      {analyze && catalog && (!catalog.ready || !compatible) && <p className="backup-notice">Choose a compatible model and rule set. The local analysis dependencies must be ready.</p>}
    </fieldset>
    <div className="local-analysis-actions backup-start-actions"><button className="button amber" disabled={unavailable || transferring || !status?.configured || dirty || status?.active || status?.analyzing || stopping || (analyze && (blocked || !catalog?.ready || !compatible))} onClick={() => act('start',{analyze,model,rules},analyze ? 'Backup started with local analysis enabled.' : 'Backup started. Finished videos will be copied; analysis is off.')}>Start backup</button><button className="button" disabled={unavailable || (!status?.active && !status?.analyzing)} onClick={() => act('stop',{},'Backup is stopping. Saved copies are preserved; restart stays paused.')}>Stop backup</button></div>
    {transferring && <div className="local-analysis-actions"><p role="status">Opening backup and verifying its recording…</p><button className="button" onClick={() => transfers.current.cancel()}>Cancel backup opening</button></div>}
    {message && <p className="local-analysis-message" role="status">{message}</p>}
    {error && <p className="recognition-error" role="alert">{error}</p>}
    {status?.error && <p className="recognition-error" role="alert">{status.error}</p>}
    {status && <>
      <p className="local-analysis-announcement" role="status" aria-live="polite" aria-atomic="true">{analysisAnnouncement(status.analysis_job, connected)}</p>
      {status.analysis_job && <p>{analysisBackendLabel(status.analysis_job, catalog?.backend)} · {status.analysis_job.frames_analyzed} samples analyzed</p>}
      <div className="backup-storage" aria-label="Backup storage status"><span><strong>{storageSize(status.storage_bytes)}</strong> saved / {status.config?.max_storage_gib ?? config.max_storage_gib} GiB budget</span><span><strong>{storageSize(status.disk_free_bytes)}</strong> disk free</span><span><strong>{status.waiting ?? 0}</strong> files waiting for quiet time</span><span><strong>{status.counters?.copied ?? 0}</strong> copied · {status.counters?.duplicates ?? 0} duplicates skipped</span></div>
      {copying && <div className="backup-copy-progress"><strong>{connected ? 'Saving another copy' : 'Last reported copy'}: {copying.name}</strong><span>{storageSize(copyDone)} of {storageSize(copyTotal)}{!connected && ' · progress unavailable'}</span>{connected && <progress aria-label={`Copy progress for ${copying.name}`} max={copyTotal ?? 1} value={copyTotal !== null && copyDone !== null ? copyDone : undefined} />}</div>}
      {status.scan_limited && <p className="backup-notice">The source scan is incomplete because of an entry/depth limit or an inaccessible folder. Choose a narrower source folder or check folder access.</p>}
      {!!status.unsupported?.length && <p className="backup-notice">Backup only: {status.unsupported.map(item => `${item.extension || 'no extension'} (${item.count})`).join(', ')}. These formats need an OEM standard-video export for analysis.</p>}
      <details className="backup-saved"><summary>Saved videos <span>{items.length ? `· latest ${items.length}` : '· no copies yet'}</span></summary>
        {!items.length && <p>No videos copied yet. Start backup after saving your folders; new files wait for the quiet time first.</p>}
        <div className="backup-list">{items.map(item => <article key={item.id} className={`backup-item backup-item-${item.state}`}><div><strong>{item.name}</strong><span className="backup-item-meta">{storageSize(item.bytes)} · {item.state === 'saved' ? 'Copy saved · not analyzed' : item.state}{Number.isFinite(item.observations) && item.state === 'completed' ? ` · ${item.observations} observations` : ''}</span>{item.copied_at && <small>Copied {new Date(typeof item.copied_at === 'number' ? item.copied_at * 1000 : item.copied_at).toLocaleString()}</small>}{item.state === 'completed' && <small>{libraryCoverage(item)}</small>}{item.analysis_eligible === false && <small>Copy saved; outside local analysis limits.</small>}{item.error && <small className="recognition-error">{item.error}</small>}</div><div className="local-analysis-actions">
          {item.state === 'completed' && <button className="button" disabled={unavailable || transferring || item.bytes > MAX_VIDEO_BYTES} onClick={() => open(item)}>Review backup</button>}
          {['failed','interrupted'].includes(item.state) && item.analysis_eligible !== false && <button className="button" disabled={unavailable || transferring || blocked} onClick={() => act('retry',{id:item.id},'Backup analysis queued again. The saved video is preserved.')}>Retry analysis</button>}
        </div></article>)}</div>
      </details>
    </>}
    <div className="backup-limits">
      <p className="local-analysis-footnote">Original videos stay untouched. No automatic deletion: copying pauses at the storage budget or free-space reserve.</p>
      <p className="local-analysis-footnote">A second folder on the same drive does not protect against drive failure. Backup remains paused after a service restart.</p>
      <p className="local-analysis-footnote">Files above 512 MiB are excluded from analysis. The per-file backup limit is {storageSize(status?.limits?.max_file_bytes ?? 64 * 1024 ** 3)}; larger files are not copied.</p>
      <p className="local-analysis-footnote">Each analysis is bounded to 6,000 decoded frames. Results describe the analyzed portion only.</p>
    </div>
    <details className="backup-camera-setup" ref={cameraSetupPanel} tabIndex={-1}><summary>Connect an IP camera or LAN DVR</summary>
      <p>Add an authorized standard RTSP channel using its documented address. Use Monitor to explicitly connect afterward. Saving a source does not start recording; the LAN recorder supports one configured source. Automatic discovery and ONVIF setup are not available.</p>
      {!connected && <p>Connect to this computer above to load or save camera sources.</p>}
      {cameras?.sources?.length > 0 && <p className="backup-existing-sources">Saved sources: {cameras.sources.map(s => s.name).join(', ')}.</p>}
      {cameras?.enabled === false && <p className="backup-notice">Camera setup is disabled in this local service. Existing sources remain available in Monitor.</p>}
      <form ref={cameraSetupForm} tabIndex={-1} onSubmit={saveCamera} autoComplete="off"><fieldset disabled={!connected || cameraWorking || cameras?.enabled === false} className="backup-camera-fields"><legend>Camera or DVR channel details</legend>
        <label>Name<input value={camera.name} onChange={e => setCamera(c => ({...c,name:e.target.value}))} placeholder="Front entrance" required /></label>
        <label>Private IPv4 address<input value={camera.host} onChange={e => setCamera(c => ({...c,host:e.target.value}))} placeholder="192.168.1.20" inputMode="decimal" required /></label>
        <label>RTSP port<input type="number" min="1" max="65535" value={camera.port} onChange={e => setCamera(c => ({...c,port:e.target.value}))} required /></label>
        <label className="backup-channel-path">Documented channel path<input value={camera.path} onChange={e => setCamera(c => ({...c,path:e.target.value}))} placeholder="Paste the /path from the device manual" spellCheck="false" required /></label>
        <label>Camera username<input value={camera.username} onChange={e => setCamera(c => ({...c,username:e.target.value}))} autoComplete="off" /></label>
        <label>Camera password<input type="password" value={camera.password} onChange={e => setCamera(c => ({...c,password:e.target.value}))} autoComplete="new-password" /></label>
        <button className="button" type="submit">{cameraWorking ? 'Saving camera…' : 'Save camera source'}</button>
      </fieldset></form>
      <p className="local-analysis-footnote">Credentials are stored privately by the local app. They are never saved in browser storage. Use the channel path supplied by the device manufacturer; paths are not guessed.</p>
      {cameraMessage && <p className="local-analysis-message" role="status">{cameraMessage}</p>}{cameraError && <p className="recognition-error" role="alert">{cameraError}</p>}
      {!!cameras?.sources?.length && <div className="backup-recorder-source"><label>Source for the one-camera LAN recorder<select value={recorderSource} onChange={e => setRecorderSource(e.target.value)} disabled={!connected || cameraWorking}>{cameras.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="button" onClick={configureRecorder} disabled={!connected || cameraWorking || !recorderSource}>Use for LAN recording</button><p>Sets the recorder source without connecting or recording. Start recording below when you are ready.</p></div>}
    </details>
  </section>;
}
