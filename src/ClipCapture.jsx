import React, { useEffect, useRef, useState } from 'react';
import { createClipRecorder, downloadBlob } from './clip-capture.mjs';

export default function ClipCapture({ stream, clip, onClip, onReview, hidden, capturePending, onCaptureBusy }) {
  const [state, setState] = useState({ state: 'idle', message: '' });
  const alive = useRef(true), receive = useRef(onClip), capture = useRef();
  receive.current = onClip;
  if (!capture.current) capture.current = createClipRecorder({ onState: s => { onCaptureBusy(['recording','stopping'].includes(s.state)); if (alive.current) setState(s); }, onClip: c => receive.current(c) });
  useEffect(() => { alive.current = true; return () => { alive.current = false; capture.current.stop('Left Monitor'); }; }, []);
  useEffect(() => { if (!stream || hidden) capture.current.stop(hidden ? 'Page hidden' : 'Camera disconnected'); }, [stream, hidden]);
  const busy = ['recording', 'stopping'].includes(state.state);
  const idle = !stream && !clip && !busy;
  return <section className={`clip-capture ${idle ? 'clip-capture-idle' : ''}`} aria-label="Webcam clip capture">
    <div><strong>{state.state === 'recording' ? '● Recording webcam clip' : 'Capture a clip for recognition'}</strong>
      {idle ? <p>Connect your webcam to enable an optional local clip.</p> :
        <p>Video only · automatic stop requested at 60s · 64 MiB maximum. Clips stay in memory until you save or import them.</p>}</div>
    <div className="review-actions">
      {busy ? <button className="button amber" disabled={state.state === 'stopping'} onClick={() => capture.current.stop()}>Stop recording</button> :
        <button className="button" disabled={!stream || Boolean(clip) || capturePending} onClick={() => { try { capture.current.start(stream); } catch (error) { setState({ state: 'error', message: error.message }); } }}>Record webcam clip</button>}
      {clip && <><button className="button" onClick={() => downloadBlob(clip.blob, clip.name)}>Save clip</button>
        <button className="button amber" onClick={onReview}>Open clip in Recognition</button>
        <button className="text-button" onClick={() => onClip(null)}>Discard clip</button></>}
    </div>
    {state.message && <p role={state.state === 'error' ? 'alert' : 'status'}>{state.message}</p>}
    {clip && <p>{clip.name} · {(clip.blob.size / 1024**2).toFixed(1)} MiB · unsaved browser copy. Save or import before closing this page.</p>}
  </section>;
}
