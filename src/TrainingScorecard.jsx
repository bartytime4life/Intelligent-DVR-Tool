import React, { useEffect, useMemo, useState } from 'react';
import { CaretDown, ChartBar, CheckCircle, FrameCorners, PersonSimple, SlidersHorizontal, VideoCamera } from '@phosphor-icons/react';
import { evaluate, frameMoments, recommendThreshold, SENSITIVITY } from './training.mjs';
import { compareTrainingLibrary, recommendCumulativeThreshold } from './training-library.mjs';
import './training-library.css';
import './training-scorecard.css';

const checkHeadings = {
  improved: 'Better on the fresh check',
  unchanged: 'Both settings gave the same counts',
  worse: 'The current setting did better',
  tradeoff: 'Each setting helped in a different way',
  insufficient: 'The fresh check needs more samples',
};

function calibrationAdvice(recommendation) {
  switch (recommendation.reason) {
    case 'not-seen':
      return 'The detector found too little person evidence during the in-view prompts. Check the framing and lighting before recording again.';
    case 'no-empty-check':
      return 'There were no usable samples during the empty-room prompt. Record another session to include that condition.';
    case 'empty-room-busy':
      return 'The detector gave a high person score during the empty-room prompt. Review that moment for a person, reflection or picture in view.';
    case 'keep-current':
      return 'The first recording gave no clear gain from a different threshold. You can check the current setting on a second recording.';
    default:
      return 'Try the suggested threshold on a new recording. Both settings will be scored against the same person-in-view and empty-room prompts.';
  }
}

function difference(before, after, word) {
  const change = after - before;
  if (change === 0) return 'Same count';
  return `${Math.abs(change)} ${change > 0 ? 'more' : 'fewer'} ${word}${Math.abs(change) === 1 ? '' : 's'}`;
}

function SampleCount({ label, threshold, hits, total, trial }) {
  return <div className={`train-score-count${trial ? ' is-trial' : ''}`}>
    <span>{label} <small>{threshold.toFixed(2)}</small></span>
    {total ? <>
      <strong>{hits} <small>of {total}</small></strong>
      <div className="train-score-bar" aria-hidden="true"><i style={{ width: `${100 * hits / total}%` }} /></div>
    </> : <strong className="train-score-no-samples">No samples</strong>}
  </div>;
}

function Measure({ title, Icon, baseline, candidate, field, totalField, preference, noun, referenceOnly }) {
  const before = baseline[field], after = candidate[field], total = baseline[totalField];
  const better = preference === 'More is better' ? after > before : after < before;
  const tone = !total || before === after ? '' : better ? ' improves' : ' declines';
  return <section className="train-score-measure" aria-label={title}>
    <div className="train-score-measure-title"><Icon size={21} aria-hidden="true" /><h3>{title}</h3></div>
    <div className="train-score-pair">
      <SampleCount label={referenceOnly ? 'Reference' : 'Current'} threshold={baseline.threshold} hits={before} total={total} />
      <SampleCount label="Trial" threshold={candidate.threshold} hits={after} total={candidate[totalField]} trial />
    </div>
    <p className={'train-score-delta' + tone}>{total ? difference(before, after, noun) : 'No comparison available'} <span>{preference}</span></p>
  </section>;
}

const NO_SESSIONS = [];
export default function TrainingScorecard({ outcome, service, onCheck, onSave, onRetry, saving, error, check, renderMoments, onPreview,
  pastSessions = NO_SESSIONS, viewName, includeSession, onInclude, libraryError }) {
  const recommendation = useMemo(() => includeSession ? recommendCumulativeThreshold(outcome, pastSessions)
    : recommendThreshold(outcome.labeled, { current: outcome.current }), [outcome, pastSessions, includeSession]);
  const [selection, setSelection] = useState(check?.value ?? recommendation.threshold ?? outcome.current);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  // Once a new recording has been scored, its two thresholds stay fixed.
  const fresh = check?.result;
  const value = fresh ? check.value : selection;
  useEffect(() => { onPreview?.(value); }, [value, onPreview]);
  const calibration = useMemo(() => evaluate(outcome.labeled, value), [outcome, value]);
  const original = useMemo(() => evaluate(outcome.labeled, outcome.current), [outcome]);
  const baseline = fresh?.baseline ?? original;
  const candidate = fresh?.candidate ?? calibration;
  const confirmed = check?.confirmed === true;
  const combined = compareTrainingLibrary(pastSessions, outcome.current, value, includeSession ? outcome : null);
  const canApply = outcome.canApply === true && confirmed && fresh?.verdict === 'improved' &&
    candidate.threshold === value && baseline.threshold === outcome.current && value !== outcome.current &&
    !combined.regressions && !libraryError;
  const moments = useMemo(() => frameMoments(outcome.labeled, value), [outcome, value]);
  const scored = candidate.presentChecks + candidate.emptyChecks;
  function preview(next) {
    setSelection(next);
    onPreview?.(next);
  }
  const title = fresh
    ? confirmed ? checkHeadings[fresh.verdict] : 'Confirm the recording conditions'
    : recommendation.reason === 'not-seen' ? 'Check the camera view' : 'Your first recording is scored';
  const explanation = !fresh ? calibrationAdvice(recommendation)
    : !confirmed ? 'A comparison needs confirmation that the person was visible and the room was empty at the prompted times.'
    : fresh.verdict === 'insufficient' ? 'Repeat the check with a clear view in each prompt. Each condition needs at least three scored samples.'
    : fresh.verdict === 'improved' ? 'The trial improved one or both counts on this recording. The table shows the effect of changing the person detection threshold.'
    : fresh.verdict === 'tradeoff' ? 'A gain on one prompt came with a loss on the other. Keep the current setting and review the first recording before tuning again.'
    : 'Keep the current setting and save this check in your training history.';

  return <section className="train-score" aria-label="Detection scorecard">
    <header className="train-score-head">
      <div className="train-score-icon" aria-hidden="true">{canApply ? <CheckCircle size={27} /> : <ChartBar size={27} />}</div>
      <div><p className="train-score-kicker">{fresh ? 'Fresh recording check' : 'Calibration recording'}</p>
        <h2>{title}</h2><p>{explanation}</p></div>
    </header>
    <div className="train-score-body">
      <div className="train-score-section-title"><h3>What the detector saw</h3><span>{scored} scored samples</span></div>
      <div className="train-score-grid">
        <Measure title="Person found during in-view prompts" Icon={PersonSimple} baseline={baseline} candidate={candidate}
          field="found" totalField="presentChecks" preference="More is better" noun="detection" referenceOnly={!outcome.canApply} />
        <Measure title="Person flags during empty-room prompts" Icon={FrameCorners} baseline={baseline} candidate={candidate}
          field="falseAlarms" totalField="emptyChecks" preference="Fewer is better" noun="flag" referenceOnly={!outcome.canApply} />
      </div>
      <p className="train-score-scope">{fresh
        ? `Both columns use the same fresh recording.${confirmed ? ' You confirmed the prompt conditions.' : ''}`
        : 'Both columns use the first recording. The prompts describe what was expected in each sampled frame.'}</p>
      {outcome.canApply !== true && <p className="train-score-help">This comparison uses whole-view person scores. {outcome.applyReason || 'This rule set requires manual configuration.'}</p>}
      {viewName && <section className="train-score-library" aria-label="Combined session results">
        <h3>Build on “{viewName}”</h3>
        <p>{pastSessions.length} earlier matching {pastSessions.length === 1 ? 'session' : 'sessions'} available. Other cameras, detector versions and rule settings stay separate.</p>
        <label className="training-check"><input type="checkbox" checked={!!includeSession} disabled={saving || !!fresh || !outcome.canApply || !!libraryError}
          onChange={e => onInclude(e.target.checked)} /> Add this session to the combined evidence. I followed all five prompts in this camera view.</label>
        {includeSession && <p>{pastSessions.length + 1} calibration {pastSessions.length ? 'sessions inform' : 'session informs'} the suggestion. Each session has equal weight; saved fresh checks are used only to look for regressions.</p>}
        {!!combined.recordings && <table><caption>Replay of saved evidence{includeSession ? ' and this calibration' : ''}</caption>
          <thead><tr><th scope="col">Setting</th><th scope="col">Person found</th><th scope="col">Empty-room flags</th></tr></thead>
          <tbody>{[['Current', combined.baseline], ['Trial', combined.candidate]].map(([label, m]) => <tr key={label}>
            <th scope="row">{label}</th><td>{m.found} / {m.presentChecks}</td><td>{m.falseAlarms} / {m.emptyChecks}</td>
          </tr>)}</tbody></table>}
        {combined.regressions > 0 && <p role="alert">This trial loses person finds or adds empty-room flags on {combined.regressions} earlier or calibration recordings. Keep the current setting and gather another session.</p>}
        <p className="training-note">Evidence stays in this browser. A new setting still needs an improved fresh check and cannot worsen either count on any saved recording. This tunes a rule threshold; it does not retrain detector weights.</p>
        {libraryError && <p role="alert">{libraryError}</p>}
      </section>}
      <div className="train-score-decision">
        <div className="train-score-actions">
          {!fresh && <button className="button amber" disabled={saving} onClick={() => onCheck(value)}><VideoCamera size={18} aria-hidden="true" />Check on a new recording</button>}
          {canApply && <button className="button amber" disabled={saving || !service.training?.enabled} onClick={() => onSave(value, true)}>
            <CheckCircle size={18} aria-hidden="true" />{saving ? 'Saving setting…' : `Use checked setting ${value.toFixed(2)}`}</button>}
          <button className={fresh && !canApply ? 'button amber' : 'button'} disabled={saving} onClick={() => onSave(outcome.current, false)}>Keep current setting</button>
          {fresh && (!confirmed || fresh.verdict === 'insufficient') && <button className="button" disabled={saving} onClick={() => onCheck(value)}>Repeat the fresh check</button>}
          <button className="text-button" disabled={saving} onClick={onRetry}>Record again</button>
        </div>
        {canApply && <p className="train-score-help">{service.training?.enabled
          ? 'Using the checked setting saves a whole-view person rule for future recording analyses in Recognition.'
          : 'To save this setting, enable training in the local service.'}</p>}
        {error && <p role="alert" className="train-score-error">{error}</p>}
      </div>

      <details className="train-score-detail">
        <summary><SlidersHorizontal size={18} aria-hidden="true" /><span>Advanced sensitivity</span><small>Trial {value.toFixed(2)}</small><CaretDown size={16} aria-hidden="true" /></summary>
        <div className="train-score-detail-body">
          {fresh ? <p>The trial threshold was fixed at {value.toFixed(2)} before the fresh check. Start another session to test a different setting.</p>
            : <>
              <label className="train-score-slider">Trial detection threshold <output>{value.toFixed(2)}</output>
                <input type="range" min={SENSITIVITY.min} max={SENSITIVITY.max} step={SENSITIVITY.step} value={value}
                  disabled={saving} onChange={e => preview(Number(e.target.value))} /></label>
              <p>Lower values admit weaker detections. Higher values require a stronger person signal.</p>
              {recommendation.threshold !== null && value !== recommendation.threshold &&
                <button className="text-button" disabled={saving} onClick={() => preview(recommendation.threshold)}>Reset to suggested {recommendation.threshold.toFixed(2)}</button>}
            </>}
        </div>
      </details>
      <details className="train-score-detail" onToggle={e => setEvidenceOpen(e.currentTarget.open)}>
        <summary><FrameCorners size={18} aria-hidden="true" /><span>Review the first recording</span><CaretDown size={16} aria-hidden="true" /></summary>
        <div className="train-score-detail-body">
          <p>At {value.toFixed(2)}, {calibration.presentChecks + calibration.emptyChecks} of {outcome.frames} sampled frames fell inside a scored prompt.
            {' '}{outcome.timing?.verified ? 'Decoded video timestamps aligned these samples to the recording clock.' : 'Prompt times are estimated from frame position and recording length.'}
            {' '}The first two seconds after each prompt change are excluded.</p>
          <ul className="train-score-prompts">{calibration.segments.map(s => <li key={s.id}>
            <span>{s.prompt}</span><strong>{!s.checks ? 'No samples' : `${s.hits} of ${s.checks} ${s.expect === 'absent' ? 'flagged' : 'found'}`}</strong>
          </li>)}</ul>
          {evidenceOpen && moments.length > 0 && renderMoments?.(value)}
        </div>
      </details>
    </div>
  </section>;
}
