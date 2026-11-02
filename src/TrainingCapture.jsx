import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle, Pause } from '@phosphor-icons/react';
import { webcamController, WEBCAM_KEY } from './live-feeds.mjs';
import { TRAINING_SCRIPT, scriptSeconds, scriptTimeline } from './training.mjs';
import { createTrainingTake, createPromptChime } from './training-capture.mjs';
import './training-capture.css';

function savedCamera() {
  try { return globalThis.localStorage?.getItem(WEBCAM_KEY) || ''; }
  catch { return ''; }
}

export default function CaptureSteps({ step, onStep, onClip, script = TRAINING_SCRIPT, guide = 'frame',
  preferredCameraKey = '', startLabel = 'Start guided recording',
  aim = 'Point the camera at the area you want to protect. Include the full area where people will move.' }) {
  const [camera, setCamera] = useState({ state: 'disconnected', message: 'Connect the camera to begin.' });
  const [light, setLight] = useState('');
  const [message, setMessage] = useState('');
  const [sound, setSound] = useState(false);
  const cues = useRef(null);
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  const video = useRef(null);
  const controller = useRef(null);
  const recording = useRef(false);
  const go = useRef(onStep);
  go.current = onStep;
  useEffect(() => {
    let mounted = true;
    const device = webcamController(navigator.mediaDevices, next => {
      if (!mounted) return;
      setCamera(next);
      if (recording.current && next.state !== 'live') {
        recording.current = false;
        setMessage('Camera frames were interrupted. Check the preview and start a new recording.');
        go.current('camera');
      }
    });
    controller.current = device;
    return () => { mounted = false; device.stop(); cues.current?.close(); cues.current = null; };
  }, []);
  useEffect(() => { if (video.current) video.current.srcObject = camera.stream || null; }, [camera.stream, step]);
  useEffect(() => {
    setLight('');
    if (camera.state !== 'live' || step !== 'camera') return;
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 18;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const timer = setInterval(() => {
      if (!video.current?.videoWidth || video.current.readyState < 2) return;
      context.drawImage(video.current, 0, 0, 32, 18);
      const data = context.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      const level = sum / (data.length / 4);
      setLight(level < 45 ? 'dark' : level > 215 ? 'bright' : 'ok');
    }, 1000);
    return () => clearInterval(timer);
  }, [camera.state, step]);
  const live = camera.state === 'live';
  const duration = scriptSeconds(script);

  function toggleSound(checked) {
    cues.current?.close();
    cues.current = null;
    setSound(false);
    if (!checked) return;
    const unavailable = () => setMessage('Sound cues are unavailable. Follow the prompts on screen.');
    try {
      const chime = createPromptChime(Audio);
      cues.current = chime;
      setSound(true);
      chime.enable().then(() => {
        if (cues.current === chime && document.visibilityState === 'visible') chime.ring();
      }).catch(() => {
        if (cues.current !== chime) return;
        chime.close(); cues.current = null; setSound(false); unavailable();
      });
    } catch { unavailable(); }
  }

  function backToCheck(reason) {
    recording.current = false;
    cues.current?.silence();
    setMessage(reason || '');
    onStep('camera');
  }

  return <section className={`training-panel training-capture training-take ${step === 'record' ? 'take-active' : ''}`}>
    <div className="training-stage">
      <video ref={video} autoPlay muted playsInline aria-label="Camera preview" />
      {!live && <div className="training-stage-empty"><Camera aria-hidden="true" size={40} /><p>{camera.message}</p></div>}
      {live && <div className={guide === 'face' ? 'training-face-guide' : step === 'camera' ? 'training-frame-guide' : ''} aria-hidden="true" />}
      {live && <span className="take-preview-tag">Camera preview · microphone off</span>}
    </div>
    {step === 'record' && live && <ScriptRunner script={script} stream={camera.stream} cues={cues.current} onCancel={() => backToCheck('')}
      onError={reason => { if (recording.current) backToCheck(reason); }}
      onClip={clip => {
        if (recording.current) { recording.current = false; onClip(clip); }
      }} />}
    {step === 'camera' && <aside className="training-checklist">
      <p className="eyebrow">BEFORE RECORDING</p><h2>Camera check</h2>
      <p className="take-aim">{aim}</p>
      <ol>
        <li className={live ? 'complete' : ''}>{live ? 'Your camera is connected.' : 'Connect the camera and allow video access in your browser.'}</li>
        <li className={live && light === 'ok' ? 'complete' : ''}>{!live || !light ? 'Lighting is checked when video starts.' : light === 'dark' ? 'It looks dark. Turn on a light or open the blinds.' : light === 'bright' ? 'It looks bright. Aim away from the window.' : 'Lighting looks usable.'}</li>
        <li>Follow {script.length} prompts over {duration} seconds. Keep this window in front.</li>
      </ol>
      {Audio && script.some(s => s.expect === 'absent') && <label className="take-sound">
        <input type="checkbox" checked={sound} onChange={e => toggleSound(e.target.checked)} />
        <span><b>Play prompt tones</b><small>One tone starts the next prompt. If you stepped out, return at the next cue. Two tones mark the finish.</small></span>
      </label>}
      {message && <p className="training-problem" role="alert">{message}</p>}
      <div className="training-actions">
        {live ? <button className="button amber" onClick={() => { setMessage(''); recording.current = true; onStep('record'); }}>{startLabel}</button>
          : <button className="button amber" disabled={camera.state === 'connecting'} onClick={() => controller.current?.connect(preferredCameraKey || savedCamera())}>Connect camera</button>}
        {(live || camera.state === 'connecting') && <button className="text-button" onClick={() => controller.current?.stop()}>{live ? 'Disconnect' : 'Cancel connection'}</button>}
      </div>
    </aside>}
  </section>;
}

function ScriptRunner({ script, stream, cues, onCancel, onClip, onError }) {
  const timeline = useMemo(() => scriptTimeline(script), [script]);
  const total = scriptSeconds(script);
  const [state, setState] = useState({ phase: 'countdown', elapsed: 0, countdown: 3 });
  const callbacks = useRef({ onClip, onError });
  callbacks.current = { onClip, onError };
  useEffect(() => {
    let mounted = true, lastPrompt = null;
    const take = createTrainingTake({ stream, seconds: total,
      onChange(newState) {
        setState(newState);
        if (cues && newState.phase === 'running') {
          const prompt = timeline.find(s => newState.elapsed >= s.start && newState.elapsed < s.end);
          if (prompt && prompt.id !== lastPrompt) { lastPrompt = prompt.id; cues.ring(); }
        }
      },
      async onComplete(clip) {
        if (cues && document.visibilityState === 'visible') await cues.ring(true);
        if (mounted) callbacks.current.onClip(clip);
      },
      onError: error => callbacks.current.onError(error) });
    const update = () => {
      const visible = document.visibilityState === 'visible';
      if (!visible) cues?.silence();
      take.update(visible);
    };
    document.addEventListener('visibilitychange', update);
    const interval = setInterval(update, 200);
    update();
    return () => {
      mounted = false; clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
      cues?.silence(); take.cancel();
    };
  }, [stream, timeline, total, cues]);
  const { phase, elapsed, countdown } = state;
  const current = timeline.find(s => elapsed >= s.start && elapsed < s.end) || timeline.at(-1);
  const index = timeline.indexOf(current);
  const next = timeline[index + 1];
  const running = phase === 'running';
  const prompt = phase === 'paused' ? 'Recording paused' : phase === 'finishing' ? 'Finishing the recording…' : current.prompt;
  const detail = phase === 'paused' ? 'Return to this window for a three-second countdown.' : current.detail;
  const guide = running ? `Prompt ${index + 1} of ${timeline.length}` : phase === 'resuming' ? 'Get ready to resume' : phase === 'countdown' ? 'Get ready' : '';
  const remaining = running ? Math.max(1, Math.ceil(current.end - elapsed)) : countdown;
  const announcement = [guide, prompt, phase !== 'finishing' && detail].filter(Boolean).join('. ');
  return <aside className="take-prompt-deck" aria-label="Recording instructions">
    <span className="take-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    <p className="eyebrow take-phase">{!running && phase === 'paused' ? <Pause size={15} aria-hidden="true" /> : running ? <i aria-hidden="true" /> : <CheckCircle size={15} aria-hidden="true" />}{guide || (phase === 'paused' ? 'Paused' : 'Script complete')}</p>
    <h2>{prompt}</h2>
    {phase !== 'finishing' && <p>{detail}</p>}
    {(running || phase === 'resuming' || phase === 'countdown') && <div className="take-counter" role="timer" aria-live="off"><strong>{remaining}</strong><span>{running ? 'seconds left in this prompt' : 'seconds to start'}</span></div>}
    <div className="take-progress" aria-hidden="true">{timeline.map((segment, i) => <span key={segment.id} className={i < index ? 'complete' : i === index ? 'active' : ''} style={{ flex: segment.seconds }} />)}</div>
    {running && next && <p className="take-next"><b>Up next</b> {next.prompt}</p>}
    <button className="text-button take-cancel" onClick={onCancel}>Cancel recording</button>
  </aside>;
}
