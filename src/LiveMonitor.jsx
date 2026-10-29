import React, {useEffect, useRef, useState} from 'react';
import {Camera, Plus, Plug, PlugsConnected, X, ArrowClockwise, WarningCircle} from '@phosphor-icons/react';
import {feedRequest, localFeedOrigin, webcamController, visibleFeedTiles} from './live-feeds.mjs';
import './live-feeds.css';

const guide = 'https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-camera-feeds.md';
export default function LiveMonitor({queue, visibleTiles=4, onCount, pageHidden}) {
  const [webcam, setWebcam] = useState({state:'disconnected', message:'No webcam connected'});
  const [devices, setDevices] = useState([]), [device, setDevice] = useState('');
  const [catalog, setCatalog] = useState(null), [source, setSource] = useState('');
  const [feeds, setFeeds] = useState([]), [setup, setSetup] = useState(''), [error, setError] = useState('');
  const [working, setWorking] = useState(false), [selected, setSelected] = useState('webcam');
  const video = useRef(), dialog = useRef(), token = useRef(''), sessions = useRef(new Map());
  const generation = useRef(0), busy = useRef(false), alive = useRef(true);
  const controller = useRef(null);
  if (!controller.current) controller.current = webcamController(navigator.mediaDevices, state => { if (alive.current) setWebcam(state); });
  const local = localFeedOrigin(window.location);
  const webcamActive = ['connecting','live','interrupted'].includes(webcam.state);
  const networkActive = feeds.filter(f => ['connecting','live'].includes(f.state)).length;
  const active = networkActive + (webcamActive ? 1 : 0);
  const live = feeds.filter(f => f.state === 'live').length + (webcam.state === 'live' ? 1 : 0);
  function sync() { if (alive.current) setFeeds([...sessions.current.values()].map(({abort, ...s}) => s)); }
  async function disconnect(id) {
    const s = sessions.current.get(id);
    if (!s) return;
    s.abort?.abort(); if (s.image) URL.revokeObjectURL(s.image);
    sessions.current.delete(id); sync();
    try { await feedRequest(`/${id}/disconnect`, {token:s.token, body:{}, signal:AbortSignal.timeout(4000)}); }
    catch { if (alive.current) setError('Disconnect could not be confirmed. This preview will stop after its 15-second lease expires.'); }
  }
  function stopAll(message = 'Disconnected') {
    generation.current++; controller.current.stop(message);
    for (const id of [...sessions.current.keys()]) void disconnect(id);
    busy.current = false; if (alive.current) setWorking(false);
  }
  useEffect(() => {
    alive.current = true;
    const leave = () => stopAll('Preview stopped because this page closed.');
    window.addEventListener('pagehide', leave);
    return () => { alive.current = false; stopAll(); onCount(0); window.removeEventListener('pagehide', leave); };
  }, []);
  useEffect(() => { onCount(live); }, [live, onCount]);
  useEffect(() => { if (pageHidden) { stopAll('Preview stopped while the page was hidden. Connect again when ready.'); setSetup(''); } }, [pageHidden]);
  useEffect(() => {
    if (video.current) {
      video.current.srcObject = webcam.stream || null;
      if (webcam.stream) video.current.play().catch(() => controller.current.stop('Playback was blocked. Connect again to resume.'));
    }
  }, [webcam.stream, selected, visibleTiles]);
  useEffect(() => {
    if (!setup) return;
    const previous = document.activeElement; dialog.current.showModal();
    return () => previous?.focus();
  }, [setup]);
  useEffect(() => {
    let disposed = false, timer;
    async function poll() {
      // Sequential requests and no backlog. One retained frame per channel.
      for (const s of sessions.current.values()) {
        if (disposed || !['connecting','live'].includes(s.state)) continue;
        s.abort = new AbortController(); const deadline = setTimeout(() => s.abort.abort(), 4000);
        try {
          const next = await (await feedRequest(`/${s.id}`, {token:s.token, signal:s.abort.signal})).json();
          if (disposed || !sessions.current.has(s.id)) continue;
          Object.assign(s, next);
          if (s.state === 'live') {
            const response = await feedRequest(`/${s.id}/frame`, {token:s.token, signal:s.abort.signal});
            const blob = await response.blob();
            if (blob.size > 512 * 1024 || blob.type !== 'image/jpeg') throw Error('Unsupported preview frame. Reconnect the channel.');
            if (disposed || !sessions.current.has(s.id)) continue;
            const old = s.image; s.image = URL.createObjectURL(blob); if (old) URL.revokeObjectURL(old);
          } else if (s.image) { URL.revokeObjectURL(s.image); s.image = ''; }
        } catch (err) {
          if (!disposed && sessions.current.has(s.id)) {
            s.state = 'failed'; s.error = {message:'Preview connection was lost. Check the local service and reconnect. The camera lease expires within 15 seconds.'};
            if (s.image) URL.revokeObjectURL(s.image); s.image = '';
          }
        } finally { clearTimeout(deadline); }
        sync();
      }
      if (!disposed) timer = setTimeout(poll, 250);
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); for (const s of sessions.current.values()) s.abort?.abort(); };
  }, []);
  async function refreshDevices() {
    setError('');
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw Error('Open this app on HTTPS or localhost to use a webcam.');
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      setDevices(list); setDevice(d => list.some(v => v.deviceId === d) ? d : '');
      if (!list.length) setError('No webcam is visible. Attach a camera and check browser permissions.');
    } catch (err) { setError(err.message); }
  }
  async function refreshDvr() {
    if (busy.current) return;
    busy.current = true; setWorking(true); setError(''); const ticket = generation.current;
    try {
      const value = await (await feedRequest('/session', {signal:AbortSignal.timeout(4000)})).json();
      if (!value.token || !Array.isArray(value.sources)) throw Error('Open the local app with a DVR source configuration.');
      if (ticket !== generation.current || !alive.current) return;
      token.current = value.token; setCatalog(value); setSource(s => value.sources.some(v => v.id === s) ? s : value.sources[0]?.id || '');
    } catch (err) { if (ticket === generation.current && alive.current) setError(err.name === 'TimeoutError' ? 'Local service did not respond. Check it and retry.' : err.message); }
    finally { if (ticket === generation.current && alive.current) { setWorking(false); busy.current = false; } }
  }
  async function connectDvr() {
    if (busy.current || !source || active >= 4) return;
    busy.current = true; setWorking(true); setError(''); const ticket = generation.current, sessionToken = token.current;
    try {
      const state = await (await feedRequest('/connect', {token:sessionToken, body:{source}, signal:AbortSignal.timeout(4000)})).json();
      if (ticket !== generation.current || !alive.current) {
        await feedRequest(`/${state.id}/disconnect`, {token:sessionToken, body:{}, signal:AbortSignal.timeout(4000)}); return;
      }
      // A new explicit connection replaces terminal previews, never active ones.
      for (const [id, previous] of sessions.current) {
        if (!['connecting','live'].includes(previous.state)) {
          previous.abort?.abort(); if (previous.image) URL.revokeObjectURL(previous.image);
          sessions.current.delete(id);
        }
      }
      if (!webcamActive) controller.current.stop('No webcam connected');
      sessions.current.set(state.id, {...state, token:sessionToken, image:''}); sync(); setSelected(state.id); setSetup('');
    } catch (err) { if (ticket === generation.current && alive.current) setError(`${err.name === 'TimeoutError' ? 'The service did not respond.' : err.message} If a connection started, its lease expires within 15 seconds.`); }
    finally { if (ticket === generation.current && alive.current) { setWorking(false); busy.current = false; } }
  }
  function closeSetup() {
    generation.current++; busy.current = false; setWorking(false);
    if (webcam.state === 'connecting') controller.current.stop('Camera connection cancelled.');
    setSetup('');
  }
  function openSetup(kind = 'webcam') { setError(''); setSetup(kind); }
  const tiles = [
    ...(webcam.state !== 'disconnected' || webcam.message !== 'No webcam connected' ? [{id:'webcam', name:'This computer’s webcam', state:webcam.state, message:webcam.message}] : []),
    ...feeds,
  ];
  const displayed = visibleFeedTiles(tiles, selected, visibleTiles);
  const blanks = Math.max(0, Math.min(4, visibleTiles) - displayed.length);
  return <div className="live-monitor">
    <div className="live-heading"><div><p className="eyebrow">YOUR CAMERAS · LOCAL PREVIEW</p><h1>Monitor <span>{live} receiving</span></h1></div>
      <div className="review-actions"><button className="button" disabled={!active} onClick={() => stopAll()}>Disconnect all</button>
        <button className="button amber" onClick={() => openSetup()} disabled={active >= 4}><Plus />Connect source</button></div></div>
    <div className="live-boundary"><span className={`connection-dot ${live ? 'receiving' : ''}`} />
      <span>{live ? 'Receiving camera frames' : 'Connect a webcam or a local DVR channel'}</span><span className="live-scope">Preview only · audio off · no recording or live AI</span></div>
    {error && !setup && <p className="feed-error" role="alert"><WarningCircle />{error}</p>}
    <div className="monitor-layout">
      <section className={`camera-wall wall-${Math.min(4, visibleTiles)}`} aria-label="Camera wall">
        {displayed.map(t => <article key={t.id} className={`camera-tile live-tile ${selected === t.id ? 'selected' : ''}`} onClick={() => setSelected(t.id)} aria-label={`${t.name} preview`}>
          <div className="live-picture">
            {t.id === 'webcam' && webcam.stream && <video ref={video} autoPlay muted playsInline aria-label="Webcam video" />}
            {t.id !== 'webcam' && t.image && <img src={t.image} alt={`${t.name} current preview frame`} onError={() => {const s=sessions.current.get(t.id); if(s){s.state='failed';s.error={message:'The browser could not display this frame. Disconnect and retry.'};URL.revokeObjectURL(s.image);s.image='';sync();}}} />}
            {((t.id === 'webcam' && t.state !== 'live') || (t.id !== 'webcam' && !t.image)) && <div className="feed-placeholder"><Camera size={34}/><h3>{t.state === 'connecting' ? 'Connecting…' : t.state === 'failed' ? 'Connection needs attention' : 'Preview stopped'}</h3>
              <p>{t.message || t.error?.message || 'Waiting for the first frame from your DVR…'}</p></div>}
            <div className="live-tile-heading"><strong>{t.name}</strong><span className={`feed-status ${t.state}`}>{t.state === 'live' ? 'Receiving' : t.state}</span></div>
          </div>
          <div className="live-tile-controls"><span>{t.id === 'webcam' ? 'Webcam · video only' : 'DVR · sampled preview ≤ 4 fps'}</span>
            <button className="text-button" onClick={() => t.id === 'webcam' ? controller.current.stop() : disconnect(t.id)}>{t.state === 'connecting' ? 'Cancel' : t.id !== 'webcam' && ['failed','disconnected'].includes(t.state) ? 'Remove' : 'Disconnect'}</button>
            {t.id === 'webcam' && ['failed','disconnected'].includes(t.state) && <button className="text-button" onClick={() => openSetup()}>Reconnect</button>}</div>
        </article>)}
        {Array.from({length:blanks}, (_, i) => <article className="camera-tile empty-feed" key={`empty-${i}`}>
          <div className="empty-feed-number">{String(displayed.length+i+1).padStart(2,'0')} / SOURCE</div>
          <Camera size={38}/><h3>{!tiles.length && i === 0 ? 'Your cameras belong here' : 'No source connected'}</h3>
          <p>{!tiles.length && i === 0 ? 'Choose a webcam or an RTSP channel from your local DVR.' : 'This tile will show frames from a source you connect.'}</p>
          <button className="button" onClick={() => openSetup()} disabled={active >= 4}><Plus/>Connect source</button>
        </article>)}
      </section>{queue}
    </div>
    <section className="sources live-sources" aria-label="Camera sources"><div className="source-heading"><h2>Camera sources <span>{tiles.length}</span></h2><span>Up to 4 preview connections · disconnect on leaving Monitor</span></div>
      <div className="live-source-strip">{tiles.map(t => <button key={t.id} className={`live-source ${selected === t.id ? 'active' : ''}`} onClick={() => setSelected(t.id)} aria-pressed={selected === t.id}><Camera/><span>{t.name}<small>{t.state === 'live' ? 'Receiving frames' : t.state}</small></span></button>)}
        {!tiles.length && <p>No saved footage is being presented as a camera feed.</p>}
        <button className="text-button" onClick={() => openSetup('dvr')}><Plug/>Set up local DVR</button></div>
    </section>
    {setup && <dialog className="modal wide feed-dialog" ref={dialog} onCancel={e => {e.preventDefault(); closeSetup();}} onClick={e => {if(e.target===e.currentTarget)closeSetup();}}>
      <div className="modal-heading"><div><p className="eyebrow">EXPLICIT CONNECTION · LOCAL VIDEO</p><h2>Connect a camera source</h2></div><button className="icon-button" aria-label="Close connection setup" onClick={closeSetup}><X/></button></div>
      <div className="feed-kind"><button className={`button ${setup === 'webcam' ? 'active' : ''}`} onClick={() => {setError('');setSetup('webcam');}}><Camera/>This computer’s webcam</button><button className={`button ${setup === 'dvr' ? 'active' : ''}`} onClick={() => {setError('');setSetup('dvr');}}><Plug/>Local DVR / IP camera</button></div>
      {setup === 'webcam' ? <div className="feed-setup-body"><h3>Use a built-in or USB webcam</h3><p>Your browser will ask for camera permission. Video stays in this browser. The microphone stays off.</p>
        <label>Webcam<select aria-label="Webcam" value={device} onChange={e => setDevice(e.target.value)} disabled={webcamActive}><option value="">Browser default camera</option>{devices.filter(d=>d.deviceId).map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i+1}`}</option>)}</select></label>
        <button className="text-button" onClick={refreshDevices}><ArrowClockwise/>Refresh devices</button>
        <p className={webcam.state === 'failed' ? 'feed-error' : 'hint'} role="status">{webcam.message}</p>
        <div className="review-actions"><button className="button amber" disabled={webcamActive || active >= 4} onClick={async () => {setSelected('webcam');await controller.current.connect(device);}}>Connect webcam</button>
          {webcamActive && <button className="button" onClick={() => controller.current.stop('Camera connection cancelled.')}>{webcam.state === 'connecting' ? 'Cancel connection' : 'Disconnect webcam'}</button>}
          {webcam.state === 'live' && <button className="button" onClick={closeSetup}>View camera wall</button>}</div>
      </div> : <div className="feed-setup-body"><h3>Choose an RTSP channel on your LAN</h3><p>The local app bridges a configured DVR channel into this browser. Each channel has its own RTSP path. It connects only when you press Connect DVR channel.</p>
        {!local && <p className="feed-error">DVR access needs the local app at http://127.0.0.1. This hosted page cannot reach your DVR through the local service.</p>}
        <button className="button" disabled={!local || working} onClick={refreshDvr}><ArrowClockwise/>{catalog ? 'Refresh DVR sources' : 'Load configured DVR sources'}</button>
        {catalog && <><label>DVR channel<select aria-label="DVR channel" value={source} onChange={e=>setSource(e.target.value)} disabled={working}><option value="">Choose a channel…</option>{catalog.sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {!catalog.sources.length && <p>No DVR channels configured. Add the channel’s private IPv4 address, RTSP port, path and credentials to the local source file, then restart the local app.</p>}
          {!catalog.ready && <p className="feed-error">OpenCV is unavailable. Install the local edge requirements on Linux or Windows and restart the app.</p>}
          <button className="button amber" disabled={!source || working || !catalog.ready || active >= 4} onClick={connectDvr}><PlugsConnected/>{working ? 'Connecting…' : 'Connect DVR channel'}</button></>}
        <p className="hint">Use a read-only viewer account and a substream at or below 1080p. Credentials stay in the local source file; the browser receives channel names only.</p>
        <a href={guide} target="_blank" rel="noreferrer">DVR setup guide and supported connection format</a>
      </div>}
      {error && <p className="feed-error" role="alert">{error}</p>}
      <p className="feed-dialog-note">Previews stop when you leave Monitor, hide the page or disconnect. DVR previews also end after 15 minutes. Recording recognition remains in the Recognition workspace.</p>
    </dialog>}
  </div>;
}
