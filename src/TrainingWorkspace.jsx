import React, { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, CheckCircle, DownloadSimple, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { analysisRequest, importRecording, localAnalysisOrigin } from './local-analysis.mjs';
import { CHECK_SCRIPT, TRAINING_SCRIPT, evaluate, frameMoments, compareTrainingCheck, readHistory, appendHistory,
  readTrainingSelection, trainedPreferenceMatches, writeDefaultRules, plural, ENROLL_SCRIPT, BASELINE_SCRIPT, CONSENT_TEXT, baselineText } from './training.mjs';
import { checkContextError, makeTrainingReceipt } from './training-evidence.mjs';
import { downloadBlob } from './clip-capture.mjs';
import OllamaCoach from './OllamaCoach.jsx';
import CaptureSteps from './TrainingCapture.jsx';
import TrainingHome from './TrainingHome.jsx';
import TrainingScorecard from './TrainingScorecard.jsx';
import AnalyzeStep from './TrainingAnalyze.jsx';
import TrainingLibrary from './TrainingLibrary.jsx';
import { readTrainingLibrary, compatibleTrainingSessions, trainingSessionEvidence, withTrainingLibraryDecision,
  removeTrainingEvidence, compareTrainingLibrary, trainingLibraryReceipt, recommendCumulativeThreshold,
  trainingEvidenceAdditionError, reusedTrainingSource } from './training-library.mjs';
import { trainingHasPendingWork, personHasPendingWork } from './training-lifecycle.mjs';
import './training.css';

const STEPS = [['camera', 'Camera check'], ['record', 'Guided recording'], ['analyze', 'Analysis'], ['results', 'Compare'], ['check', 'Fresh check'], ['done', 'Decision']];
const storage = () => { try { return globalThis.localStorage; } catch { return null; } };
const memory = { getItem: () => null, setItem: () => { throw Error('unavailable'); } };
const store = () => storage() || memory;
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export default function TrainingWorkspace({ onOpenRecognition, onDirtyChange }) {
  const [service, setService] = useState({ state: 'connecting', message: 'Checking this computer…' });
  const [history, setHistory] = useState(() => readHistory(store()));
  const [library, setLibrary] = useState(() => readTrainingLibrary(store()));
  const [viewName, setViewName] = useState(() => readTrainingLibrary(store()).sessions.at(-1)?.view || 'My camera view');
  const [includeSession, setIncludeSession] = useState(false);
  const [step, setStep] = useState(null);
  const [clip, setClip] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [saved, setSaved] = useState(null);
  const [check, setCheck] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selection, setSelection] = useState({ modelId: '', rulesId: '' });
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [error, setError] = useState('');
  const [peopleError, setPeopleError] = useState('');
  const [people, setPeople] = useState([]), [personFlow, setPersonFlow] = useState(null);
  const [personPending, setPersonPending] = useState(false);
  const local = localAnalysisOrigin(globalThis.location);
  const pending = trainingHasPendingWork({ step, clip, outcome, check, saved, saving, includeSession, personPending });
  const dirtyHandler = useRef(onDirtyChange); dirtyHandler.current = onDirtyChange;
  useEffect(() => { onDirtyChange?.(pending); }, [pending, onDirtyChange]);
  useEffect(() => () => dirtyHandler.current?.(false), []);

  async function loadPeople(value) {
    setPeopleError('');
    if (!value?.people?.enabled) { setPeople([]); return; }
    try { setPeople((await (await analysisRequest('/people', { token: value.token })).json()).people); }
    catch { setPeopleError('Enrolled people could not be loaded. Check the connection and try again.'); }
  }

  async function connect() {
    if (!local) { setService({ state: 'unavailable', message: 'Open the installed local app on this computer to start a training session.' }); return; }
    setService({ state: 'connecting', message: 'Checking this computer…' });
    try {
      const response = await analysisRequest('/session', { signal: AbortSignal.timeout(10000) });
      // A static preview answers with its page instead of the service's JSON.
      const value = await response.json().catch(() => { throw Error('This preview needs the installed local app. Start it with analysis and recording import enabled, then check again.'); });
      if (!value.token || !Array.isArray(value.models) || !value.models.length) throw Error('The local app has no detection model configured.');
      const problems = [!value.ready && 'Analysis dependencies are missing; run the installer, then restart the app.',
        !value.recording_import?.enabled && 'Recording import is off; restart the app with recording import enabled.'].filter(Boolean);
      setService({ state: problems.length ? 'blocked' : 'ready', message: problems.join(' '), ...value });
      loadPeople(value);
    } catch (error) { setService({ state: 'unavailable', message: error.message }); }
  }
  useEffect(() => { connect(); }, []);

  const preference = readTrainingSelection(store());
  const inUse = service.state === 'ready' && preference && trainedPreferenceMatches(service, preference)
    ? service.rules.find(rule => rule.id === preference.rulesId) : null;
  function optionsForModel(modelId) {
    return (service.rules || []).filter(rule => rule.models.includes(modelId) &&
      (rule.training_reference === undefined || rule.training_reference.person_rules === 1));
  }
  function selectModel(modelId, desiredRule) {
    const eligible = optionsForModel(modelId);
    const automatic = eligible.filter(r => inUse || r.id !== preference?.rulesId);
    const reference = eligible.find(r => r.id === desiredRule) || automatic.find(r => r.training_reference?.whole_view) || automatic[0];
    setSelection({ modelId, rulesId: reference?.id || '' });
  }
  function reset(nextStep = null) {
    if (pending && !window.confirm('Discard this unfinished training session? Camera capture will stop and analysis cancellation will be requested. Unsaved recordings and results will be lost; saved rules and evidence stay available.')) return;
    setLibrary(readTrainingLibrary(store()));
    setIncludeSession(false);
    if (nextStep === 'camera') {
      const model = service.models?.find(m => inUse && m.id === preference?.modelId) ||
        service.models?.find(m => m.profile.startsWith('opencv-zoo-yolox')) || service.models?.[0];
      selectModel(model?.id || '', inUse?.id);
    }
    setPreview(null);
    setClip(null);
    setCheck(null);
    setOutcome(null);
    setSaved(null);
    setError('');
    setStep(nextStep);
  }

  function startCheck(value) {
    setError('');
    setClip(null);
    setCheck({ value, confirmed: false });
    setStep('check-camera');
  }

  function finishCheck(fresh) {
    const mismatch = checkContextError(outcome, fresh) ||
      (!fresh.timing.verified && `The fresh check needs reliable timing. ${fresh.timing.reason} Record the check again.`);
    setClip(null);
    if (mismatch) {
      setError(mismatch);
      setPreview(null);
      setCheck(null);
      setStep('results');
      return;
    }
    setCheck(previous => ({ value: previous.value, confirmed: false, context: fresh,
      result: compareTrainingCheck(fresh.labeled, outcome.current, previous.value) }));
    setStep('confirm');
  }

  async function saveDecision(value, apply) {
    if (saveLock.current) return;
    const checked = check?.confirmed === true;
    if (apply && (!checked || check.result.verdict !== 'improved' || check.value !== value ||
      value === outcome.current || !service.training?.enabled || !outcome.canApply)) {
      setError('Check this setting on a fresh recording before using it.');
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      await withTrainingLibraryDecision(store(), async ({ library: latest, saveEvidence }) => {
        if ((apply || includeSession) && latest.error) throw Error(latest.error);
        if (apply && reusedTrainingSource(latest.sessions, [outcome.sourceHash, check.context.sourceHash]))
          throw Error('One of these recordings is already in the saved evidence. Make new recordings before applying a setting.');
        const past = compatibleTrainingSessions(latest.sessions, viewName, outcome);
        const protection = compareTrainingLibrary(past, outcome.current, value, includeSession ? outcome : null);
        if (apply && protection.regressions) throw Error('This setting loses person finds or adds empty-room flags on saved evidence. Keep the current setting and record another session.');
        // Validate evidence before saving a rule. Storage failures are reported
        // separately so a successfully saved rule is never presented as lost.
        const evidence = includeSession ? trainingSessionEvidence(viewName, outcome, checked ? check : null) : null;
        if (evidence) {
          const problem = trainingEvidenceAdditionError(latest.sessions, evidence);
          if (problem) throw Error(problem);
        }
        let rule = null, selected = false;
        if (apply) {
          const currentSession = await (await analysisRequest('/session', { signal: AbortSignal.timeout(10000) })).json();
          const model = currentSession.models?.find(item => item.id === outcome.modelId);
          const reference = currentSession.rules?.find(item => item.id === outcome.rulesId);
          if (!currentSession.training?.enabled || model?.sha256 !== outcome.modelHash ||
              model.labels_sha256 !== outcome.labelHash || model.profile !== outcome.profile ||
              !reference?.sha256 || reference.sha256 !== outcome.ruleFileHash || !reference.models.includes(outcome.modelId)) {
            throw Error('The local detector, reference rule or saving permission has changed. Start a new session before using this setting.');
          }
          // Keep the original dwell and gap. Only a single whole-view person rule
          // can be tuned here, so a session cannot replace a set of zone rules.
          const { dwell, max_gap, rect } = outcome.rule;
          // Identical checked rule contents are reusable, including after a lost
          // response. Repeated sessions need not consume another catalog slot.
          const name = `Person · checked threshold ${value.toFixed(2)}`;
          const response = await analysisRequest('/training/rules', { token: currentSession.token, method: 'POST',
            body: { name, label: 'person', threshold: value, rect, dwell, max_gap } });
          ({ rule } = await response.json());
          selected = writeDefaultRules(store(), rule.id, outcome.modelId, { modelHash: outcome.modelHash,
            labelHash: outcome.labelHash, rulesHash: rule.sha256, profile: outcome.profile });
          setService(s => ({ ...s, rules: [...s.rules.filter(r => r.id !== rule.id), rule] }));
        }
        const threshold = selected ? value : outcome.current;
        const scored = checked ? (selected ? check.result.candidate : check.result.baseline) : evaluate(outcome.labeled, threshold);
        const counts = m => ({ found: m.found, presentChecks: m.presentChecks, falseAlarms: m.falseAlarms, emptyChecks: m.emptyChecks });
        const entry = { at: new Date().toISOString(), kind: 'detection', threshold, applied: selected,
          detectionRate: scored.detectionRate, ...counts(scored), checks: scored.presentChecks + scored.emptyChecks,
          ...(rule && { rulesId: rule.id }),
          ...(checked && { check: { value: check.value, verdict: check.result.verdict,
            baseline: counts(check.result.baseline), candidate: counts(check.result.candidate) } }) };
        const historyResult = appendHistory(store(), entry);
        if (!historyResult.error) setHistory(historyResult.history);
        const libraryResult = evidence ? saveEvidence(evidence) : latest;
        setLibrary(libraryResult);
        setSaved({ rule, selected, historySaved: !historyResult.error,
          evidenceSaved: !!evidence && !libraryResult.error, evidenceError: evidence ? libraryResult.error : '',
          evidenceCount: libraryResult.sessions.length });
        setStep('done');
      });
    } catch (e) {
      setError(e.message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function exportMeasurement() {
    try {
      const receipt = makeTrainingReceipt({ ...outcome, value: preview }, check?.confirmed ? check : null);
      const past = compatibleTrainingSessions(library.sessions, viewName, outcome);
      if (includeSession) {
        const recommendation = recommendCumulativeThreshold(outcome, past);
        receipt.calibration.recommended_threshold = recommendation.threshold;
        receipt.calibration.recommendation_reason = recommendation.reason;
        receipt.calibration.recommendation_basis = 'equally-weighted-confirmed-calibration-sessions';
      }
      receipt.combined_evidence = trainingLibraryReceipt(past, outcome.current,
        check?.value ?? preview ?? outcome.current, includeSession ? outcome : null);
      receipt.decision = saved ? {
        status: saved.selected ? 'selected-for-recognition' : saved.rule ? 'rule-saved-selection-unavailable' : 'kept-current',
        selected_threshold: saved.selected ? check.value : null,
        reference_threshold: outcome.current,
        history_saved_in_this_browser: saved.historySaved,
        combined_evidence_saved_in_this_browser: saved.evidenceSaved,
      } : { status: 'awaiting-decision' };
      const name = `training-${check?.confirmed ? 'check' : 'calibration'}-${outcome.sourceHash.slice(0, 12)}.json`;
      downloadBlob(new Blob([JSON.stringify(receipt, null, 2) + '\n'], { type: 'application/json' }), name);
    } catch (e) { setError(`Could not export the measurement. ${e.message}`); }
  }

  if (personFlow) return <PersonSession service={service} flow={personFlow} onPendingChange={setPersonPending}
    onExit={() => { setPersonFlow(null); loadPeople(service); }} onChanged={() => loadPeople(service)} />;

  if (!step) return <TrainingHome service={service} history={history}
    inUse={inUse}
    onStart={() => reset('camera')} onEnroll={() => setPersonFlow({ kind: 'enroll' })} onRetry={connect}>
    <TrainingLibrary library={library} busy={saving} onRemove={async source => {
      if (saveLock.current) return;
      saveLock.current = true; setSaving(true);
      try { setLibrary(await removeTrainingEvidence(store(), source)); }
      finally { saveLock.current = false; setSaving(false); }
    }} />
    {service.people?.enabled && <section className="training-people" aria-label="Enrolled people">
      <h2>Enrolled people</h2>
      {peopleError ? <div role="alert"><p>{peopleError}</p><button className="button" onClick={() => loadPeople(service)}>Try again</button></div>
        : people.length ? <ul>{people.map(p => <PersonRow key={p.id} person={p} service={service} disabled={service.state !== 'ready'}
          onCheck={() => setPersonFlow({ kind: 'baseline', person: p })} onDeleted={() => loadPeople(service)} />)}</ul>
        : <p>No one is enrolled. Enrollment starts with the person’s agreement.</p>}
    </section>}
  </TrainingHome>;

  const checking = step.startsWith('check-') || step === 'confirm';
  const activeStep = checking || (step === 'results' && check?.confirmed) ? 'check' : step;
  const stageIndex = STEPS.findIndex(([id]) => id === activeStep);
  const discardCheck = () => { setError(''); setPreview(null); setClip(null); setCheck(null); setStep('results'); };
  return <section className="content-page training-page" aria-label="Guided training session">
    <div className="training-session-head">
      <div><p className="eyebrow">PERSON DETECTION</p><h1>{checking ? 'Check the setting' : 'Training session'}</h1></div>
      <button className="text-button" disabled={saving} onClick={() => reset()}><X size={16} /> Exit session</button>
    </div>
    <ol className="training-steps" aria-label="Session progress">{STEPS.map(([id, label], i) => <li key={id}
      aria-current={activeStep === id ? 'step' : undefined} className={i < stageIndex ? 'complete' : ''}><b>{i + 1}</b>{label}</li>)}</ol>
    {step === 'camera' && <details className="training-catalog" open={!selection.rulesId || undefined}>
      <summary>Detector and reference rule</summary>
      <p>The first recording and the fresh check use the same detector and reference rule.</p>
      <label>Detector<select value={selection.modelId} onChange={e => selectModel(e.target.value)}>
        {service.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>Reference rule<select disabled={!optionsForModel(selection.modelId).length} value={selection.rulesId}
        onChange={e => setSelection(s => ({ ...s, rulesId: e.target.value }))}>
        {!selection.rulesId && <option value="">Choose a reference rule</option>}
        {optionsForModel(selection.modelId).map(r => <option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
    </details>}
    {step === 'camera' && <section className="training-panel training-view" aria-label="Training camera view">
      <h2>Build on the same camera view</h2>
      <label>Camera view name<input maxLength={64} list="training-view-names" value={viewName} onChange={e => setViewName(e.target.value)} /></label>
      <datalist id="training-view-names">{[...new Set(library.sessions.map(s => s.view))].map(view => <option key={view} value={view} />)}</datalist>
      <p>Reuse this name for the same camera position and view. Choose a new name after moving the camera. Confirmed sessions with matching detector and rule settings contribute together.</p>
      {library.error && <p role="alert">{library.error}</p>}
    </section>}
    {step === 'camera' && !selection.rulesId && <p role="alert">{optionsForModel(selection.modelId).length
      ? 'The saved detector or rule has changed. Choose a reference rule above to start a new calibration.'
      : 'This detector needs a rule set with one person rule. Choose another detector above or add a person rule to the local catalog.'}</p>}
    {(step === 'camera' || step === 'record') && selection.rulesId && viewName.trim() && <CaptureSteps step={step} onStep={setStep}
      onClip={c => { setClip(c); setStep('analyze'); }} />}
    {step === 'camera' && <OllamaCoach />}
    {step === 'analyze' && <AnalyzeStep selection={selection} clip={clip} script={TRAINING_SCRIPT}
      onSession={session => setService({ ...session, state: 'ready' })}
      onRetry={() => reset('camera')} onDone={result => { setOutcome(result); setClip(null); setStep('results'); }} />}
    {(step === 'check-camera' || step === 'check-record') && <>
      {step === 'check-camera' && <p className="training-intro">Keep the same camera and view. This 20-second recording checks the current setting and your chosen threshold of {check.value.toFixed(2)} side by side.</p>}
      <CaptureSteps key="fresh-check" step={step === 'check-camera' ? 'camera' : 'record'} script={CHECK_SCRIPT}
        preferredCameraKey={outcome.cameraKey} startLabel="Start check recording"
        aim="Use the same camera, framing and lighting as the first recording."
        onStep={next => setStep('check-' + next)} onClip={c => { setClip(c); setStep('check-analyze'); }} />
      {step === 'check-camera' && <button className="text-button" onClick={discardCheck}>Back to calibration</button>}
    </>}
    {step === 'check-analyze' && <AnalyzeStep selection={outcome} clip={clip} script={CHECK_SCRIPT}
      onSession={session => setService({ ...session, state: 'ready' })}
      onDone={finishCheck} onRetry={() => startCheck(check.value)} onBack={discardCheck} />}
    {step === 'confirm' && <ConfirmCheck source={check.context.source} onRetry={() => startCheck(check.value)}
      onConfirm={() => { setCheck(s => ({ ...s, confirmed: true })); setStep('results'); }} onBack={discardCheck} />}
    {step === 'results' && outcome && <><TrainingScorecard key={`${check?.context?.sourceHash || outcome.sourceHash}-${includeSession}`}
      service={service} outcome={outcome} check={check} onCheck={startCheck} onSave={saveDecision} onPreview={setPreview}
      pastSessions={compatibleTrainingSessions(library.sessions, viewName, outcome)} viewName={viewName}
      includeSession={includeSession} onInclude={setIncludeSession} libraryError={library.error}
      onRetry={() => reset('camera')} error={error} saving={saving}
      renderMoments={value => <MomentsForValue outcome={outcome} value={value} />} />
      <button className="text-button training-export" onClick={exportMeasurement}><DownloadSimple size={17} /> Download {check?.confirmed ? 'check comparison' : 'calibration summary'} (JSON)</button>
    </>}
    {step === 'done' && saved && <section className="training-panel training-done">
      <CheckCircle size={40} />
      <h2>{saved.selected ? 'New setting selected' : saved.rule ? 'Rule saved on this computer' : 'Current setting kept'}</h2>
      <p>{saved.selected ? `New Recognition analyses in this browser will preselect “${saved.rule.name}”.`
        : saved.rule ? `Your browser could not remember the selection. Choose “${saved.rule.name}” in Recognition to use it.`
        : 'You can return to Train to check another setting or room.'}</p>
      <p className="training-note" role={saved.historySaved ? undefined : 'alert'}>{saved.historySaved
        ? 'This browser saved the session summary in Past sessions.' : 'This browser could not save the session history. Download the measurement below to keep it.'}</p>
      {saved.evidenceSaved && <p>This session now contributes to “{viewName}”. {saved.evidenceCount} sessions are saved across your camera views. Start another session to build on matching evidence.</p>}
      {saved.evidenceError && <p role="alert">The setting decision was saved, but this session could not join the combined evidence: {saved.evidenceError}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="training-actions">
        <button className="button amber" onClick={() => reset()}>Back to Train</button>
        <button className="button" onClick={exportMeasurement}><DownloadSimple size={16} /> Download measurement (JSON)</button>
        <button className="text-button" onClick={onOpenRecognition}>Open Recognition</button>
      </div>
    </section>}
  </section>;
}

function ConfirmCheck({ source, onConfirm, onBack, onRetry }) {
  const [agreed, setAgreed] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => {
    const preview = URL.createObjectURL(source);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [source]);
  return <section className="training-panel training-check-confirm">
    <p className="eyebrow">FRESH RECORDING · 20 SECONDS</p>
    <h2>Did the recording match the prompts?</h2>
    <p>Check that a person was in view during the first prompt and the room was empty during the second. Your answer supplies the expected result.</p>
    <details><summary>Review the check recording</summary>{url && <video src={url} aria-label="Review your local check recording" controls playsInline preload="metadata" />}</details>
    <label className="training-check"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
      I followed both prompts with the same camera and view</label>
    <div className="training-actions">
      <button className="button amber" disabled={!agreed} onClick={onConfirm}>Compare settings</button>
      <button className="button" onClick={onRetry}><ArrowClockwise size={16} /> Record the check again</button>
      <button className="text-button" onClick={onBack}>Back to calibration</button>
    </div>
  </section>;
}

function MomentsForValue({ outcome, value }) {
  const moments = frameMoments(outcome.labeled, value);
  return moments.length ? <Moments source={outcome.source} moments={moments} threshold={value} />
    : <p className="training-note">All scored samples agreed with the first recording’s prompts at this threshold.</p>;
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
      <strong>{m.kind === 'false-alarm' ? 'Person flag during empty prompt' : 'No person flag during in-view prompt'}</strong>
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
function PersonSession({ service, flow, onExit, onChanged, onPendingChange }) {
  const enrolling = flow.kind === 'enroll';
  const [stage, setStage] = useState(enrolling ? 'consent' : 'baseline');
  const [capture, setCapture] = useState('camera');
  const [name, setName] = useState(''), [agreed, setAgreed] = useState(false);
  const [person, setPerson] = useState(flow.person || null);
  const [status, setStatus] = useState(null), [error, setError] = useState('');
  const pending = personHasPendingWork({ stage, capture, name, agreed, busy: status?.busy });
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const exit = () => {
    if (pending && !window.confirm('Leave this unfinished person session? Camera capture will stop and unsaved input will be lost. Templates already saved on this computer stay available; a submitted operation may still finish.')) return;
    onExit();
  };
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
      <button className="text-button" onClick={exit}><X size={16} /> Exit</button>
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
        <button className="text-button" onClick={exit}>Skip for now</button>
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
      <div className="training-actions"><button className="button amber" onClick={exit}>Back to Train</button></div>
    </section>}
  </section>;
}
