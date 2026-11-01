import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, Camera, CheckCircle, Pause, Target, Trash, UserFocus, WarningCircle, X } from '@phosphor-icons/react';
import { webcamController, WEBCAM_KEY } from './live-feeds.mjs';
import { createClipRecorder } from './clip-capture.mjs';
import { activeJob, analysisRequest, importRecording, localAnalysisOrigin, openJobResult } from './local-analysis.mjs';
import { TRAINING_SCRIPT, scriptTimeline, scriptSeconds, labelFrames, evaluate, recommendThreshold, frameMoments,
  readHistory, appendHistory, readDefaultRules, writeDefaultRules, percent, plural, SENSITIVITY,
  ENROLL_SCRIPT, BASELINE_SCRIPT, CONSENT_TEXT, baselineText } from './training.mjs';
import './training.css';

const STEPS = [['camera', 'Camera check'], ['record', 'Guided recording'], ['analyze', 'Analysis'], ['results', 'Results'], ['done', 'Saved']];
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };
const memory = { getItem: () => null, setItem: () => { throw Error('unavailable'); } };
const store = () => storage() || memory;
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const thresholdOf = rule => Number((rule?.summary || []).map(s => /^person ≥ ([0-9.]+)/.exec(s)?.[1]).find(Boolean)) || 0.5;

export default function TrainingWorkspace({ onOpenRecognition }) {
  const [service, setService] = useState({ state: 'connecting', message: 'Checking this computer…' });
  const [history, setHistory] = useState(() => readHistory(store()));
  const [step, setStep] = useState(null);
  const [clip, setClip] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [saved, setSaved] = useState(null);
  const [people, setPeople] = useState([]), [personFlow, setPersonFlow] = useState(null);
  const local = localAnalysisOrigin(globalThis.location);

  async function loadPeople(value) {
    if (!value?.people?.enabled) { setPeople([]); return; }
    try { setPeople((await (await analysisRequest('/people', { token: value.token })).json()).people); }
    catch { setPeople([]); }
  }

  async function connect() {
    if (!local) { setService({ state: 'unavailable', message: 'Open the local Intelligent DVR app on this computer to train. On a Mac, double-click Start-Mac.command.' }); return; }
    setService({ state: 'connecting', message: 'Checking this computer…' });
    try {
      const response = await analysisRequest('/session', { signal: AbortSignal.timeout(10000) });
      // A static preview answers with its page instead of the service's JSON.
      const value = await response.json().catch(() => { throw Error('This page is not running the local analysis service. Start the app with Start-Mac.command (Mac) or the Linux/Windows launcher with analysis enabled.'); });
      if (!value.token || !Array.isArray(value.models) || !value.models.length) throw Error('The local app has no detection model configured.');
      const problems = [!value.ready && 'Analysis dependencies are missing; run the installer, then restart the app.',
        !value.recording_import?.enabled && 'Recording import is off; restart the app with recording import enabled.'].filter(Boolean);
      setService({ state: problems.length ? 'blocked' : 'ready', message: problems.join(' '), ...value });
      loadPeople(value);
    } catch (error) { setService({ state: 'unavailable', message: error.message }); }
  }
  useEffect(() => { connect(); }, []);

  if (personFlow) return <PersonSession service={service} flow={personFlow}
    onExit={() => { setPersonFlow(null); loadPeople(service); }} onChanged={() => loadPeople(service)} />;

  const last = history.at(-1);
  const inUse = service.rules?.find(r => r.id === readDefaultRules(store()));
  if (!step) return <section className="content-page training-page" aria-label="Guided training">
    <p className="eyebrow">GUIDED TRAINING · THIS COMPUTER</p>
    <h1>Train</h1>
    <p className="training-intro">Short guided sessions that help the DVR recognize what matters in your camera’s view. Each session records about a minute with on-screen prompts, checks what the detector saw and suggests a better setting. Video stays on this computer.</p>
    <div className="training-home">
      <section className="training-health" aria-label="Recognition health">
        <h2>Recognition health</h2>
        {last ? <dl>
          <div><dt>Found you when visible</dt><dd>{percent(last.detectionRate)}</dd></div>
          <div><dt>False alarms, empty room</dt><dd>{last.falseAlarms}</dd></div>
          <div><dt>Sensitivity in use</dt><dd>{inUse ? thresholdOf(inUse).toFixed(2) : last.applied ? last.threshold.toFixed(2) : 'Default'}</dd></div>
          <div><dt>Sessions</dt><dd>{history.length}</dd></div>
        </dl> : <p>No training sessions yet. Your first session sets a baseline for this camera and room.</p>}
        {last && <p className="training-note">Last session {new Date(last.at).toLocaleString()}. Results describe your sessions here, not certified accuracy.</p>}
      </section>
      <section className="training-choice" aria-label="Improve detection">
        <Target size={30} />
        <h2>Improve detection</h2>
        <p>Teach the DVR how people look in this room: in view, gone, far away and partly hidden. About two minutes.</p>
        <ServiceStatus service={service} onRetry={connect} />
        <button className="button amber" disabled={service.state !== 'ready'} onClick={() => { setClip(null); setOutcome(null); setSaved(null); setStep('camera'); }}>Start session</button>
      </section>
      {service.people?.enabled && <section className="training-choice" aria-label="Enroll a person">
        <UserFocus size={30} />
        <h2>Enroll a person</h2>
        <p>Set a baseline so Recognition can suggest “possible match” for someone who agrees. About one minute; the face template stays on this computer and can be deleted.</p>
        <button className="button amber" disabled={service.state !== 'ready'} onClick={() => setPersonFlow({ kind: 'enroll' })}>Enroll a person</button>
      </section>}
    </div>
    {service.people?.enabled && <section className="training-people" aria-label="Enrolled people">
      <h2>Enrolled people</h2>
      {people.length ? <ul>{people.map(p => <PersonRow key={p.id} person={p} service={service} disabled={service.state !== 'ready'}
        onCheck={() => setPersonFlow({ kind: 'baseline', person: p })} onDeleted={() => loadPeople(service)} />)}</ul>
        : <p>No one is enrolled. Enrollment needs the person’s agreement and about one minute in front of the camera.</p>}
    </section>}
    {history.length > 0 && <section className="training-history" aria-label="Past sessions">
      <h2>Past sessions</h2>
      <ol>{history.slice(-5).reverse().map(entry => <li key={entry.at}>
        <span>{new Date(entry.at).toLocaleDateString()}</span>
        <span>Found {percent(entry.detectionRate)}</span>
        <span>{entry.falseAlarms} false alarm{entry.falseAlarms === 1 ? '' : 's'}</span>
        <span>{entry.applied ? `Saved ${entry.threshold.toFixed(2)}` : 'Not applied'}</span>
      </li>)}</ol>
    </section>}
  </section>;

  const leave = () => { setStep(null); setHistory(readHistory(store())); };
  return <section className="content-page training-page" aria-label="Guided training session">
    <div className="training-session-head">
      <div><p className="eyebrow">IMPROVE DETECTION</p><h1>Training session</h1></div>
      <button className="text-button" onClick={leave}><X size={16} /> Exit session</button>
    </div>
    <ol className="training-steps">{STEPS.map(([id, label], i) => <li key={id} aria-current={step === id ? 'step' : undefined}
      className={STEPS.findIndex(s => s[0] === step) > i ? 'complete' : ''}><b>{i + 1}</b>{label}</li>)}</ol>
    {(step === 'camera' || step === 'record') && <CaptureSteps step={step} onStep={setStep} onClip={c => { setClip(c); setStep('analyze'); }} />}
    {step === 'analyze' && <AnalyzeStep service={service} clip={clip} onRetry={() => setStep('camera')}
      onDone={result => { setOutcome(result); setStep('results'); }} />}
    {step === 'results' && outcome && <ResultsStep service={service} outcome={outcome} onRetry={() => setStep('camera')}
      onSaved={(entry, rule) => { const result = appendHistory(store(), entry); setHistory(result.history); setSaved({ entry, rule, error: result.error }); setStep('done'); }} />}
    {step === 'done' && saved && <section className="training-panel training-done">
      <CheckCircle size={40} />
      <h2>{saved.rule ? 'Saved' : 'Session recorded'}</h2>
      <p>{saved.rule ? `New analyses in Recognition use “${saved.rule.name}” by default (sensitivity ${saved.entry.threshold.toFixed(2)}).` : 'Your current setting stays in use. This session is in your training history.'}</p>
      {saved.error && <p role="alert">{saved.error}</p>}
      <div className="training-actions">
        <button className="button amber" onClick={leave}>Back to Train</button>
        <button className="button" onClick={() => { setClip(null); setOutcome(null); setSaved(null); setStep('camera'); }}><ArrowClockwise size={16} /> Another session</button>
        <button className="text-button" onClick={onOpenRecognition}>Open Recognition</button>
      </div>
    </section>}
  </section>;
}

function ServiceStatus({ service, onRetry }) {
  if (service.state === 'ready') return <p className="training-ready"><CheckCircle size={16} /> This computer is ready{service.training?.enabled ? '' : ' (saving settings is off; results still show)'}.</p>;
  if (service.state === 'connecting') return <p className="training-ready">{service.message}</p>;
  return <div className="training-problem" role="alert"><WarningCircle size={18} /><p>{service.message}</p>
    <button className="text-button" onClick={onRetry}>Check again</button></div>;
}

// Camera check and recording share one stream; leaving either step stops the camera.
function CaptureSteps({ step, onStep, onClip, script = TRAINING_SCRIPT, guide = 'frame', startLabel = 'Start guided recording',
  aim = 'Point the camera at the area you want to protect. The full room view matters more than your face.' }) {
  const [camera, setCamera] = useState({ state: 'disconnected', message: 'Connect the camera to begin.' });
  const [light, setLight] = useState('');
  const video = useRef(null), controller = useRef(null);
  if (!controller.current) controller.current = webcamController(navigator.mediaDevices, setCamera);
  useEffect(() => () => controller.current.stop('No webcam connected'), []);
  useEffect(() => { if (video.current) video.current.srcObject = camera.stream || null; }, [camera.stream, step]);
  useEffect(() => {
    if (camera.state !== 'live' || step !== 'camera') return;
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 18;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const timer = setInterval(() => {
      if (!video.current?.videoWidth) return;
      context.drawImage(video.current, 0, 0, 32, 18);
      const data = context.getImageData(0, 0, 32, 18).data; let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      const level = sum / (data.length / 4);
      setLight(level < 45 ? 'dark' : level > 215 ? 'bright' : 'ok');
    }, 1000);
    return () => clearInterval(timer);
  }, [camera.state, step]);
  const live = camera.state === 'live';
  return <section className="training-panel training-capture">
    <div className="training-stage">
      <video ref={video} autoPlay muted playsInline aria-label="Camera preview" />
      {!live && <div className="training-stage-empty"><Camera size={42} /><p>{camera.message}</p></div>}
      {live && <div className={guide === 'face' ? 'training-face-guide' : step === 'camera' ? 'training-frame-guide' : ''} aria-hidden="true" />}
      {step === 'record' && live && <ScriptRunner script={script} stream={camera.stream} onCancel={() => onStep('camera')} onClip={onClip} />}
    </div>
    {step === 'camera' && <aside className="training-checklist">
      <h2>Camera check</h2>
      <ol>
        <li className={live ? 'complete' : ''}>Connect the camera. Your browser asks for permission; the microphone stays off.</li>
        <li className={live && light === 'ok' ? 'complete' : ''}>{!live || !light ? 'Lighting is checked once the camera is on.' : light === 'dark' ? 'It looks dark. Turn on a light or open blinds.' : light === 'bright' ? 'It looks very bright. Avoid pointing at a window.' : 'Lighting looks usable.'}</li>
        <li>{aim}</li>
        <li>For the next {scriptSeconds(script)} seconds you will follow prompts on this screen. Keep this window in front.</li>
      </ol>
      <div className="training-actions">
        {live ? <button className="button amber" onClick={() => onStep('record')}>{startLabel}</button>
          : <button className="button amber" disabled={camera.state === 'connecting'} onClick={() => controller.current.connect(store().getItem(WEBCAM_KEY) || '')}>Connect camera</button>}
        {live && <button className="text-button" onClick={() => controller.current.stop()}>Disconnect</button>}
      </div>
    </aside>}
  </section>;
}

function ScriptRunner({ script, stream, onCancel, onClip }) {
  const timeline = useMemo(() => scriptTimeline(script), [script]);
  const total = scriptSeconds(script);
  const [phase, setPhase] = useState({ kind: 'countdown', value: 3 });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef(null), active = useRef(0), running = useRef(false), last = useRef(0), cancelled = useRef(false);
  useEffect(() => {
    recorder.current = createClipRecorder({ onState: s => { if (s.state === 'error') setError(s.message); },
      onClip: c => { if (!cancelled.current) onClip(c); } });
    let countdown = 3, resumeIn = 0;
    const begin = () => {
      try { recorder.current.start(stream); } catch (e) { setError(e.message); return; }
      running.current = true; last.current = performance.now(); setPhase({ kind: 'running' });
    };
    const tick = setInterval(() => {
      const now = performance.now();
      if (countdown > 0) { if (document.visibilityState === 'hidden') return; countdown -= .25; setPhase({ kind: 'countdown', value: Math.ceil(countdown) }); if (countdown <= 0) begin(); return; }
      if (resumeIn > 0) { resumeIn -= .25; setPhase({ kind: 'resuming', value: Math.ceil(resumeIn) }); if (resumeIn <= 0) { recorder.current.resume(); running.current = true; last.current = now; setPhase({ kind: 'running' }); } return; }
      if (!running.current) return;
      active.current += (now - last.current) / 1000; last.current = now;
      setElapsed(active.current);
      if (active.current >= total) { running.current = false; setPhase({ kind: 'finishing' }); recorder.current.stop('Script complete'); }
    }, 250);
    const visibility = () => {
      if (document.visibilityState === 'hidden' && running.current) {
        active.current += (performance.now() - last.current) / 1000; running.current = false;
        recorder.current.pause(); setPhase({ kind: 'paused' });
      } else if (document.visibilityState === 'visible' && !running.current && countdown <= 0 && active.current < total && active.current > 0) {
        resumeIn = 3;
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', visibility); cancelled.current = true; recorder.current.stop('Left training'); };
  }, [stream]);
  const segment = timeline.find(s => elapsed >= s.start && elapsed < s.end) || timeline.at(-1);
  const next = timeline[timeline.indexOf(segment) + 1];
  return <div className="training-script" role="status" aria-live="polite">
    {phase.kind === 'countdown' && <div className="training-prompt"><p>Get ready. First:</p><strong>{timeline[0].prompt}</strong><span className="training-count">{phase.value}</span></div>}
    {phase.kind === 'paused' && <div className="training-prompt paused"><Pause size={34} /><strong>Paused</strong><p>Keep this window in front. Recording continues when you return.</p></div>}
    {phase.kind === 'resuming' && <div className="training-prompt"><p>Resuming: {segment.prompt}</p><span className="training-count">{phase.value}</span></div>}
    {phase.kind === 'running' && <div className="training-prompt"><p className="training-rec">● REC {clock(elapsed)} / {clock(total)}</p>
      <strong>{segment.prompt}</strong><p>{segment.detail}</p>
      <span className="training-count">{Math.max(1, Math.ceil(segment.end - elapsed))}</span>
      {next && <p className="training-next">Next: {next.prompt}</p>}</div>}
    {phase.kind === 'finishing' && <div className="training-prompt"><strong>Done. Saving the recording…</strong></div>}
    {error && <p role="alert">{error}</p>}
    <div className="training-segments" aria-hidden="true">{timeline.map(s => <span key={s.id} style={{ flex: s.seconds }}
      className={elapsed >= s.end ? 'complete' : s === segment && phase.kind === 'running' ? 'current' : ''}>
      <i style={{ width: `${s === segment ? Math.min(100, (elapsed - s.start) / s.seconds * 100) : elapsed >= s.end ? 100 : 0}%` }} /></span>)}</div>
    <button className="text-button training-cancel" onClick={onCancel}>Cancel recording</button>
  </div>;
}

function AnalyzeStep({ service, clip, onDone, onRetry }) {
  const [status, setStatus] = useState({ text: 'Saving the recording on this computer…', checked: 0 });
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); const token = service.token;
    (async () => {
      try {
        const file = new File([clip.blob], clip.name, { type: clip.blob.type });
        const imported = await importRecording(file, token, abort.signal);
        // Refresh choices: an earlier session may have saved a trained rule set since this page connected.
        const session = await (await analysisRequest('/session', { signal: abort.signal })).json();
        const model = session.models.find(m => m.profile.startsWith('opencv-zoo-yolox')) || session.models[0];
        const preferred = readDefaultRules(store());
        const compatible = session.rules.filter(r => r.models.includes(model.id));
        const rules = compatible.find(r => r.id === preferred) || compatible[0];
        if (!rules) throw Error('No rule set works with the configured model. Check the local catalog.');
        setStatus({ text: 'Analyzing what the camera saw…', checked: 0 });
        let job = await (await analysisRequest('/jobs', { token, method: 'POST', body: { recording: imported.recording.id, model: model.id, rules: rules.id }, signal: abort.signal })).json();
        while (activeJob(job)) {
          await new Promise(r => setTimeout(r, 700));
          job = await (await analysisRequest(`/jobs/${job.id}`, { token, signal: abort.signal })).json();
          setStatus({ text: job.phase === 'verifying' ? 'Checking the results…' : 'Analyzing what the camera saw…', checked: job.frames_analyzed || 0 });
        }
        if (job.state !== 'completed') throw Error(job.error?.message || 'Analysis did not finish. Try the session again.');
        const { bundle, file: source } = await openJobResult(job, token, abort.signal);
        const r = bundle.receipt;
        const labeled = labelFrames(bundle.trace.frames, { recordedSeconds: clip.elapsed, totalFrames: r.frames_read });
        onDone({ labeled, source, rules, current: thresholdOf(rules), frames: bundle.trace.frames.length });
      } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    })();
    return () => abort.abort();
  }, []);
  return <section className="training-panel training-analyze">
    {error ? <div className="training-problem" role="alert"><WarningCircle size={20} /><p>{error}</p><button className="button" onClick={onRetry}>Record again</button></div>
      : <><h2>{status.text}</h2><progress aria-label="Analysis in progress" /><p>{status.checked ? `${status.checked} moments checked so far. ` : ''}Detection runs on this computer’s processor. This usually takes under a minute.</p></>}
  </section>;
}

function ResultsStep({ service, outcome, onSaved, onRetry }) {
  const recommendation = useMemo(() => recommendThreshold(outcome.labeled, { current: outcome.current }), [outcome]);
  const [value, setValue] = useState(recommendation.threshold ?? outcome.current);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const chosen = evaluate(outcome.labeled, value), current = evaluate(outcome.labeled, outcome.current);
  const moments = frameMoments(outcome.labeled, value);
  const entry = applied => ({ at: new Date().toISOString(), kind: 'detection', threshold: value, applied,
    detectionRate: chosen.detectionRate, falseAlarms: chosen.falseAlarms, observations: chosen.observations, checks: chosen.presentChecks + chosen.emptyChecks });
  async function apply() {
    setSaving(true); setError('');
    try {
      const name = `Person · trained ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${value.toFixed(2)}`;
      const { rule } = await (await analysisRequest('/training/rules', { token: service.token, method: 'POST',
        body: { name, label: 'person', threshold: value, dwell: 1, max_gap: 2 } })).json();
      writeDefaultRules(store(), rule.id);
      onSaved({ ...entry(true), rulesId: rule.id }, rule);
    } catch (e) { setError(e.message); setSaving(false); }
  }
  if (recommendation.reason === 'not-seen') return <section className="training-panel">
    <div className="training-problem" role="alert"><WarningCircle size={22} /><div><h2>The detector didn’t see you clearly</h2>
      <p>Add light, move the camera so you are fully in view, then try again. Nothing was changed.</p></div></div>
    <div className="training-actions"><button className="button amber" onClick={onRetry}>Record again</button>
      <button className="text-button" onClick={() => onSaved(entry(false), null)}>Keep this session in history</button></div>
  </section>;
  return <section className="training-panel training-results">
    <h2>Found you in {percent(chosen.detectionRate)} of checks · {chosen.falseAlarms} false alarm{chosen.falseAlarms === 1 ? '' : 's'} with the room empty</h2>
    <p className="training-note">{outcome.frames} sampled moments, matched to the prompts. Moments right after each prompt change are skipped.</p>
    <ul className="training-segment-results">{chosen.segments.map(s => <li key={s.id} className={s.expect === 'absent' ? (s.hits ? 'warn' : 'good') : s.checks && s.hits / s.checks >= .8 ? 'good' : 'warn'}>
      <strong>{s.prompt}</strong>
      <span>{s.expect === 'absent' ? (s.hits ? `${s.hits} false alarm${s.hits === 1 ? '' : 's'} in ${s.checks} checks` : `No false alarms in ${s.checks} checks`)
        : s.checks ? `Found in ${s.hits} of ${s.checks} checks` : 'Not enough checks'}</span></li>)}</ul>
    <section className="training-sensitivity" aria-label="Sensitivity">
      <h3>Sensitivity</h3>
      <p>{recommendation.reason === 'ok' ? `Recommended ${recommendation.threshold.toFixed(2)}: the empty room never scored above ${recommendation.emptyMax.toFixed(2)}, so this leaves room for lighting changes.`
        : recommendation.reason === 'empty-room-busy' ? 'Something in the empty room looks like a person to the detector. Check the moments below; a zone that excludes it may help.'
        : 'The room was never empty in this session, so false alarms could not be checked.'}</p>
      <label>Detection threshold <output>{value.toFixed(2)}</output>
        <input type="range" min={SENSITIVITY.min} max={SENSITIVITY.max} step={SENSITIVITY.step} value={value} onChange={e => setValue(Number(e.target.value))} /></label>
      <div className="training-compare">
        <div><span>Current {outcome.current.toFixed(2)}</span><b>{percent(current.detectionRate)} found</b><small>{plural(current.falseAlarms, 'false alarm')} · {plural(current.observations, 'observation')}</small></div>
        <div className="chosen"><span>Chosen {value.toFixed(2)}</span><b>{percent(chosen.detectionRate)} found</b><small>{plural(chosen.falseAlarms, 'false alarm')} · {plural(chosen.observations, 'observation')}</small></div>
      </div>
      <p className="training-note">Lower finds more but risks false alarms; higher is stricter. Ideal for this session: one observation per visit.</p>
    </section>
    {moments.length > 0 && <Moments source={outcome.source} moments={moments} threshold={value} />}
    {error && <p role="alert">{error}</p>}
    <div className="training-actions">
      <button className="button amber" disabled={saving || !service.training?.enabled} onClick={apply}>{saving ? 'Saving…' : `Use ${value.toFixed(2)} from now on`}</button>
      <button className="button" onClick={() => onSaved(entry(false), null)}>Keep current setting</button>
      <button className="text-button" onClick={onRetry}>Record again</button>
    </div>
    {!service.training?.enabled && <p className="training-note">Saving settings is off. Restart the local app with training enabled (Start-Mac.command does this) to apply a setting.</p>}
  </section>;
}

// Stills come from the analyzed copy, drawn in this page only; nothing is uploaded or stored.
function Moments({ source, moments, threshold }) {
  const [stills, setStills] = useState({});
  useEffect(() => {
    let live = true; const url = URL.createObjectURL(source);
    const video = document.createElement('video'); video.muted = true; video.src = url; video.preload = 'auto';
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 135;
    (async () => {
      for (const m of moments) {
        // Recording time, not the analyzer's frame-rate-derived time, matches the browser's playback clock.
        const seeked = await Promise.race([new Promise((resolve, reject) => { video.onseeked = () => resolve(true); video.onerror = reject; video.currentTime = m.wall; }),
          new Promise(resolve => setTimeout(() => resolve(false), 3000))]).catch(() => false);
        if (!live) return;
        if (!seeked) continue;
        canvas.getContext('2d').drawImage(video, 0, 0, 240, 135);
        const image = canvas.toDataURL('image/jpeg', .7);
        setStills(s => ({ ...s, [m.wall]: image }));
      }
    })();
    return () => { live = false; URL.revokeObjectURL(url); video.removeAttribute('src'); };
  }, [source, moments.map(m => m.wall).join()]);
  return <section className="training-moments" aria-label="Moments to check">
    <h3>Moments worth a look at {threshold.toFixed(2)}</h3>
    <ul>{moments.map(m => <li key={`${m.kind}${m.wall}`}>
      {stills[m.wall] ? <img src={stills[m.wall]} alt="" /> : <span className="training-still-placeholder" />}
      <strong>{m.kind === 'false-alarm' ? 'False alarm' : 'Missed'}</strong>
      <span>{clock(m.wall)} · score {m.score.toFixed(2)}</span></li>)}</ul>
  </section>;
}

function PersonRow({ person, service, disabled, onCheck, onDeleted }) {
  const [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  async function remove() {
    setError('');
    try { await analysisRequest(`/people/${person.id}/delete`, { token: service.token, method: 'POST', body: {} }); onDeleted(); }
    catch (e) { setError(e.message); }
  }
  return <li>
    <div><strong>{person.name}</strong><span>Enrolled {new Date(person.created).toLocaleDateString()} · {plural(person.views, 'face view')}</span>
      <span>{baselineText(person.baseline)}</span></div>
    <div className="training-actions">
      {confirming ? <>
        <button className="button amber" onClick={remove}><Trash size={16} /> Delete {person.name}’s face template</button>
        <button className="text-button" onClick={() => setConfirming(false)}>Cancel</button>
      </> : <>
        <button className="button" disabled={disabled} onClick={onCheck}>Check baseline</button>
        <button className="text-button" onClick={() => setConfirming(true)}>Delete</button>
      </>}
    </div>
    {error && <p role="alert">{error}</p>}
  </li>;
}

// Enrollment: consent, a 20 s face capture, then an optional 12 s baseline check.
// A baseline check alone (from the people list) skips the first two.
function PersonSession({ service, flow, onExit, onChanged }) {
  const enrolling = flow.kind === 'enroll';
  const [stage, setStage] = useState(enrolling ? 'consent' : 'baseline');
  const [capture, setCapture] = useState('camera');
  const [name, setName] = useState(''), [agreed, setAgreed] = useState(false);
  const [person, setPerson] = useState(flow.person || null);
  const [status, setStatus] = useState(null), [error, setError] = useState('');
  const steps = enrolling ? [['consent', 'Consent'], ['enroll', 'Face capture'], ['baseline', 'Baseline check'], ['done', 'Done']]
    : [['baseline', 'Baseline check'], ['done', 'Done']];
  async function importClip(clip) {
    const file = new File([clip.blob], clip.name, { type: clip.blob.type });
    return (await importRecording(file, service.token)).recording.id;
  }
  async function finishEnroll(clip) {
    setStatus({ busy: true, text: 'Building the face template on this computer…' }); setError('');
    try {
      const recording = await importClip(clip);
      const result = await (await analysisRequest('/people', { token: service.token, method: 'POST',
        body: { name: name.trim(), consent: { confirmed: true, statement: service.people.statement }, recording } })).json();
      setPerson(result.person); onChanged();
      setStatus({ text: `${result.person.name} is enrolled with ${plural(result.person.views, 'clear face view')}.` });
      setStage('baseline'); setCapture('intro');
    } catch (e) { setStatus(null); setError(e.message); setCapture('camera'); }
  }
  async function finishBaseline(clip) {
    setStatus({ busy: true, text: 'Checking how well the template recognizes this person…' }); setError('');
    try {
      const recording = await importClip(clip);
      const result = await (await analysisRequest(`/people/${person.id}/verify`, { token: service.token, method: 'POST', body: { recording } })).json();
      setPerson(result.person); onChanged();
      setStatus({ text: baselineText(result.baseline), tip: result.tip, baseline: result.baseline }); setStage('done');
    } catch (e) { setStatus(null); setError(e.message); setCapture('camera'); }
  }
  const current = steps.findIndex(s => s[0] === stage);
  return <section className="content-page training-page" aria-label="Person enrollment">
    <div className="training-session-head">
      <div><p className="eyebrow">{enrolling ? 'ENROLL A PERSON' : 'BASELINE CHECK'}</p><h1>{person ? person.name : 'Enroll a person'}</h1></div>
      <button className="text-button" onClick={onExit}><X size={16} /> Exit</button>
    </div>
    <ol className="training-steps">{steps.map(([id, label], i) => <li key={id} aria-current={stage === id ? 'step' : undefined}
      className={current > i ? 'complete' : ''}><b>{i + 1}</b>{label}</li>)}</ol>
    {error && <div className="training-problem" role="alert"><WarningCircle size={18} /><p>{error}</p></div>}
    {stage === 'consent' && <section className="training-panel training-consent">
      <h2>Consent</h2>
      <label>Person’s name<input aria-label="Person’s name" value={name} maxLength={60} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <p>{CONSENT_TEXT}</p>
      <p className="training-note">Matches are suggestions for a person to confirm, not proof of identity. Laws in some places (for example Illinois BIPA, Texas CUBI and the GDPR) require written consent and a retention policy for face data; that responsibility stays with the operator.</p>
      <label className="training-check"><input type="checkbox" aria-label={`${name.trim() || 'This person'} is here and agrees to enrollment`} checked={agreed} onChange={e => setAgreed(e.target.checked)} />
        {name.trim() || 'This person'} is here and agrees to enrollment.</label>
      <div className="training-actions"><button className="button amber" disabled={!name.trim() || !agreed}
        onClick={() => { setStage('enroll'); setCapture('camera'); }}>Continue to face capture</button></div>
    </section>}
    {stage === 'enroll' && !status?.busy && <CaptureSteps step={capture} onStep={setCapture} onClip={finishEnroll}
      script={ENROLL_SCRIPT} guide="face" startLabel="Start face capture"
      aim={`Only ${name.trim()} should be in view. Sit close enough that the face fills the oval, with light in front.`} />}
    {stage === 'baseline' && capture === 'intro' && <section className="training-panel training-done">
      <CheckCircle size={40} /><h2>{status?.text}</h2>
      <p>A 12-second baseline check shows how well the DVR recognizes {person.name} in everyday views, and adds the views it matches.</p>
      <div className="training-actions">
        <button className="button amber" onClick={() => { setStatus(null); setCapture('camera'); }}>Run the baseline check</button>
        <button className="text-button" onClick={onExit}>Skip for now</button>
      </div>
    </section>}
    {stage === 'baseline' && capture !== 'intro' && !status?.busy && <CaptureSteps step={capture} onStep={setCapture} onClip={finishBaseline}
      script={BASELINE_SCRIPT} guide="frame" startLabel="Start baseline check"
      aim={`Point the camera where it usually watches. Only ${person.name} should be in view.`} />}
    {status?.busy && <section className="training-panel training-analyze"><h2>{status.text}</h2><progress aria-label="Processing" /></section>}
    {stage === 'done' && status && <section className="training-panel training-done">
      <CheckCircle size={40} /><h2>{status.text}</h2>
      {status.tip && <p>{status.tip}</p>}
      <p>{status.baseline?.other ? `${plural(status.baseline.other, 'view')} matched someone else; check that only ${person.name} was in view.` : 'Run another check any time from Train to measure and refine the template.'}</p>
      <div className="training-actions"><button className="button amber" onClick={onExit}>Back to Train</button></div>
    </section>}
  </section>;
}
