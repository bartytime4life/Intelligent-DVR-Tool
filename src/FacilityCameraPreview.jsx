import React, { useEffect, useRef, useState } from 'react';
import { VideoCamera, Crosshair, Compass, Plugs, Eye, EyeSlash } from '@phosphor-icons/react';
import { feedRequest, localFeedOrigin } from './live-feeds.mjs';
import { configuredFacilitySources, facilityPreviewController, plannedViewAngles } from './facility-camera-preview.mjs';
import './facility-camera-preview.css';
import FacilityImageLab from './FacilityImageLab.jsx';

export default function FacilityCameraPreview({ camera, onCenter, onAim, onCount }) {
  const [preview, setPreview] = useState({ state: 'disconnected', message: 'Connect a source to compare its image with this camera plan.' });
  const [kind, setKind] = useState('webcam'), [devices, setDevices] = useState([]), [device, setDevice] = useState('');
  const [catalog, setCatalog] = useState(null), [source, setSource] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [overlay, setOverlay] = useState(true);
  const [aspect, setAspect] = useState(16 / 9);
  const [observed, setObserved] = useState(null);
  const video = useRef(), networkImage = useRef(), alive = useRef(true), lookup = useRef(0), controller = useRef(null);
  if (!controller.current) controller.current = facilityPreviewController({ media: navigator.mediaDevices,
    onState: state => { if (alive.current) setPreview(state); } });
  const angles = plannedViewAngles(camera), local = localFeedOrigin(window.location);
  const active = ['connecting', 'live', 'interrupted'].includes(preview.state);
  const sources = configuredFacilitySources(catalog);
  useEffect(() => {onCount?.(preview.state === 'live' ? 1 : 0); return () => onCount?.(0);}, [preview.state, onCount]);
  useEffect(() => {
    alive.current = true;
    const hidden = () => { if (document.hidden) { lookup.current++; setLoading(false); void controller.current.stop('Preview stopped while this page was hidden.'); } };
    const leave = () => { void controller.current.stop(); };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leave);
    return () => { alive.current = false; lookup.current++; void controller.current.stop();
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leave); };
  }, []);
  useEffect(() => {
    lookup.current++; setLoading(false); setError(''); setAspect(16 / 9); setObserved(null);
    void controller.current.stop('Connect a source to compare its image with this camera plan.');
  }, [camera?.id]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = preview.stream || null;
    if (preview.stream) element.play().catch(() => { void controller.current.stop('Playback was blocked. Connect again to retry.'); });
    return () => { element.srcObject = null; };
  }, [preview.stream]);
  async function refresh() {
    const ticket = ++lookup.current; setLoading(true); setError('');
    try {
      if (kind === 'webcam') {
        if (!navigator.mediaDevices?.enumerateDevices) throw Error('Webcam access requires a supported browser on HTTPS or localhost.');
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        if (!alive.current || ticket !== lookup.current) return;
        setDevices(list); setDevice(value => list.some(d => d.deviceId === value) ? value : '');
        if (!list.length) setError('No webcam is visible. Attach one or check browser permissions.');
      } else {
        if (!local) throw Error('Open the installed local app at http://127.0.0.1 to preview a DVR channel.');
        const value = await (await feedRequest('/session', { signal: AbortSignal.timeout(4000) })).json();
        if (!alive.current || ticket !== lookup.current) return;
        setCatalog(value); const list = configuredFacilitySources(value);
        setSource(current => list.some(s => s.id === current) ? current : list[0]?.id || '');
        if (!list.length) setError('No local DVR channels are configured. Configure a channel in the local app first.');
      }
    } catch (err) { if (alive.current && ticket === lookup.current) setError(err.name === 'TimeoutError' ? 'Local service did not respond. Retry when it is running.' : err.message); }
    finally { if (alive.current && ticket === lookup.current) setLoading(false); }
  }
  async function connect() {
    setError('');
    if (document.hidden) { setError('Return to this page before connecting.'); return; }
    try {
      if (kind === 'webcam') await controller.current.connectWebcam(device, devices.find(d => d.deviceId === device)?.label || 'Browser default webcam');
      else {
        if (!local) throw Error('DVR preview requires the installed local app.');
        await controller.current.connectNetwork(catalog, source);
      }
    } catch (err) { setError(err.message); }
  }
  function dimensions(width, height) {
    if (width > 0 && height > 0) {
      setAspect(width / height);
      setObserved(previous => previous?.width === width && previous?.height === height ? previous : {width, height});
    }
  }
  function captureFrame() {
    if (preview.state !== 'live') throw Error('Connect and receive a camera frame before freezing it.');
    const element = preview.stream ? video.current : networkImage.current;
    const width = preview.stream ? element?.videoWidth : element?.naturalWidth;
    const height = preview.stream ? element?.videoHeight : element?.naturalHeight;
    if (!element || !width || !height) throw Error('No complete frame is available yet. Wait for the preview to render.');
    return { element, width, height };
  }
  const heading = value => `${Math.round(value)}°`;
  return <section className="facility-camera-preview" aria-label="Planned camera and source preview">
    <div className="facility-preview-title"><div><p className="eyebrow">CAMERA ALIGNMENT</p><h3>See what you’re aiming</h3></div>
      <button type="button" className="facility-preview-icon" aria-label={overlay ? 'Hide camera view guide' : 'Show camera view guide'} aria-pressed={overlay} onClick={() => setOverlay(v => !v)}>{overlay ? <Eye /> : <EyeSlash />}</button></div>
    <div className="facility-preview-frame" style={{ aspectRatio: aspect }}>
      {preview.stream && <video ref={video} muted playsInline autoPlay aria-label="Facility webcam preview" onLoadedMetadata={e => dimensions(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />}
      {preview.image && <img ref={networkImage} src={preview.image} alt={`Current preview of ${preview.sourceName}`} onLoad={e => dimensions(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} onError={() => { void controller.current.stop('This frame could not be displayed. Reconnect to retry.'); }} />}
      {!preview.stream && !preview.image && <div className="facility-preview-empty"><VideoCamera size={30}/><strong>{preview.state === 'connecting' ? 'Connecting…' : 'Source preview'}</strong><span>No camera connected</span></div>}
      {overlay && angles && <div className="facility-view-guide" aria-label="Uncalibrated planned field of view guide">
        <div className="facility-view-headings"><span>{heading(angles.left)}</span><strong>{heading(angles.center)} bearing</strong><span>{heading(angles.right)}</span></div>
        <div className="facility-view-reticle" aria-hidden="true"><i/><b/></div>
        <div className="facility-view-angle"><span>{angles.horizontal}° H × {angles.vertical}° V</span><span>↓ {angles.tilt}° tilt</span></div>
      </div>}
      <span className="facility-preview-mode">{preview.state === 'live' ? 'SOURCE RECEIVING' : 'PLANNING GUIDE'} · UNCALIBRATED</span>
    </div>
    <p className="facility-preview-binding">{preview.sourceName ? <><strong>{preview.sourceName}</strong> → {camera?.name}</> : <>Assign a real source to <strong>{camera?.name || 'this planned camera'}</strong>.</>}</p>
    {preview.state === 'live' && observed && <div className="facility-preview-resolution" role="status"><strong>Decoded preview: {observed.width} × {observed.height} px</strong>
      <small>{Number.isInteger(camera?.pixelsWide) ? (camera.pixelsWide === observed.width
        ? 'Horizontal preview width matches the entered plan value; optics and image quality are still unverified.'
        : `Planned width: ${camera.pixelsWide} px. Verify whether this source is a lower-resolution substream before using planning DORI estimates.`)
        : 'Enter horizontal resolution in the camera plan to compare it with this preview.'}</small>
      <small>A preview may be resized by the decoder; this is not a measurement of the camera sensor.</small>
    </div>}
    <div className="facility-preview-actions"><button type="button" onClick={onCenter} disabled={!onCenter}><Crosshair/>Center on map</button><button type="button" onClick={onAim} disabled={!onAim}><Compass/>Aim on map</button></div>
    <label className="facility-preview-source">Preview source<select aria-label="Facility preview source type" value={kind} disabled={active} onChange={e => {lookup.current++;setLoading(false);setKind(e.target.value);setError('');}}><option value="webcam">This computer’s webcam</option><option value="dvr">Configured local DVR</option></select></label>
    {kind === 'webcam' ? <label className="facility-preview-source">Webcam<select aria-label="Facility webcam" value={device} disabled={active} onChange={e => setDevice(e.target.value)}><option value="">Browser default</option>{devices.filter(d => d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Webcam ${i + 1}`}</option>)}</select></label> : <label className="facility-preview-source">DVR channel<select aria-label="Facility DVR channel" value={source} disabled={active} onChange={e => setSource(e.target.value)}><option value="">Load channels, then select…</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    <div className="facility-preview-actions"><button type="button" onClick={refresh} disabled={active || loading || (kind === 'dvr' && !local)}>{loading ? 'Loading…' : kind === 'webcam' ? 'Refresh webcams' : 'Load DVR channels'}</button>
      {active ? <button type="button" onClick={() => { void controller.current.stop(); }}>{preview.state === 'connecting' ? 'Cancel preview' : 'Disconnect preview'}</button> : <button type="button" className="facility-preview-connect" onClick={connect} disabled={loading || (kind === 'dvr' && (!local || !source || !catalog?.ready))}><Plugs/>Connect preview</button>}</div>
    <p className="facility-preview-status" role="status">{preview.message}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {kind === 'dvr' && catalog && !catalog.ready && <p className="facility-caption">The local preview service is not ready. Check its Python/OpenCV installation and reload channels.</p>}
    {kind === 'dvr' && !local && <p className="facility-caption">DVR channels are available in the installed app at 127.0.0.1.</p>}
    <FacilityImageLab connected={preview.state === 'live' && !!(preview.stream || preview.image)} capture={captureFrame} sourceName={preview.sourceName} />
    <p className="facility-preview-note">The guide uses planned angles, not measurements from the image. Verify the source, lens and orientation on site. Center and Aim adjust the map plan; they do not move a physical camera. Audio, continuous recording and live AI are off. The opt-in image laboratory freezes only the current visible frame in browser memory. Preview stops when you leave or change cameras.</p>
  </section>;
}
