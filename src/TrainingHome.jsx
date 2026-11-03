import TrainingAssistant from './TrainingAssistant.jsx';
import React from 'react';
import { Aperture, ArrowClockwise, ArrowRight, CheckCircle, CircleNotch, ClockCounterClockwise, LockSimple, SlidersHorizontal, UserFocus, WarningCircle } from '@phosphor-icons/react';
import { CHECK_SCRIPT, TRAINING_SCRIPT, percent, scriptSeconds } from './training.mjs';
import './training-home.css';

const verdicts = {
  improved: 'Candidate improved this check', unchanged: 'Both settings scored the same',
  worse: 'Current setting scored better', tradeoff: 'A trade-off on this check',
  insufficient: 'Too few checks to compare',
};

function outcomeLabel(entry) {
  if (!entry.check) return 'Single recording';
  return Object.hasOwn(verdicts, entry.check.verdict) ? verdicts[entry.check.verdict] : 'Check result unavailable';
}

function legacyFinding(entry) {
  return Number.isFinite(entry.detectionRate)
    ? `The detector found a person in ${percent(entry.detectionRate)} of checks where the prompt called for one.`
    : 'The session has no scored person-present checks.';
}

function dateLabel(at) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fraction(count, total) {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(count) || count < 0 || count > total) return 'No checks';
  return `${count} of ${total}`;
}

function ServiceReadiness({ service, onRetry }) {
  const ready = service.state === 'ready';
  const connecting = service.state === 'connecting';
  const StatusIcon = ready ? CheckCircle : connecting ? CircleNotch : WarningCircle;
  return <div className={`train-home-readiness ${ready ? 'is-ready' : connecting ? 'is-checking' : 'is-blocked'}`}>
    <div role="status"><StatusIcon size={19} aria-hidden="true" /><div>
      <strong>{ready ? 'This computer is ready' : connecting ? 'Checking this computer…' : 'Local setup needs attention'}</strong>
      {ready && !service.training?.enabled && <p>You can measure results. Enable training in the local launcher to save a rule.</p>}
      {!ready && !connecting && <p>{service.message}</p>}
    </div></div>
    {!ready && !connecting && <button className="text-button" onClick={onRetry}><ArrowClockwise aria-hidden="true" size={15} /> Check again</button>}
  </div>;
}

function CheckComparison({ check }) {
  if (!check?.baseline || !check.candidate) return null;
  return <table className="train-home-comparison">
    <caption>Detections on the second recording</caption>
    <thead><tr><th scope="col">Setting</th><th scope="col">Person expected</th><th scope="col">Room expected empty</th></tr></thead>
    <tbody>{[['Current', check.baseline], ['Candidate', check.candidate]].map(([name, metrics]) => <tr key={name}>
      <th scope="row">{name}</th><td>{fraction(metrics.found, metrics.presentChecks)}</td><td>{fraction(metrics.falseAlarms, metrics.emptyChecks)}</td>
    </tr>)}</tbody>
  </table>;
}

function SessionHistory({ history }) {
  if (!history.length) return null;
  return <section className="train-home-history training-history" aria-label="Past sessions">
    <div className="train-home-ledger-heading"><div><p className="train-kicker">SESSION LOG</p><h2>Past sessions</h2></div>
      <span>Latest {Math.min(history.length, 5)} of {history.length} saved</span></div>
    <ol>{history.slice(-5).reverse().map((entry, index) => <li key={`${entry.at}-${index}`}>
      <details>
        <summary><span className="train-history-date">{dateLabel(entry.at)}</span>
          <span>{outcomeLabel(entry)}</span>
          <span className="train-history-decision">{entry.applied ? 'Selected for Recognition' : 'Kept current setting'}</span>
        </summary>
        <div className="train-history-detail">
          {entry.check ? <CheckComparison check={entry.check} /> : <p>{legacyFinding(entry)} The detector flagged {entry.falseAlarms} empty-prompt {entry.falseAlarms === 1 ? 'check' : 'checks'}.</p>}
        </div>
      </details>
    </li>)}</ol>
  </section>;
}

export default function TrainingHome({ service, history, inUse, onStart, onEnroll, onRetry, children }) {
  const latest = history.at(-1);
  const ready = service.state === 'ready';
  return <section className="content-page training-page train-home" aria-label="Guided training">
    <header className="train-home-header">
      <div><p className="train-kicker">RECOGNITION WORKSPACE</p><h1>Train</h1>
        <p>Measure how your camera sees people and choose a setting for future recording analyses.</p></div>
      <span className="train-local"><LockSimple size={15} aria-hidden="true" /> On this computer</span>
    </header>
    <div className="train-home-deck">
      <section className="train-home-primary" aria-labelledby="train-detection-heading">
        <div className="train-home-primary-body">
          <p className="train-kicker"><Aperture size={19} aria-hidden="true" /> GUIDED SESSION</p>
          <h2 id="train-detection-heading">Improve detection</h2>
          <p>Walk through your camera’s view, try a setting, then check it on a fresh recording before you decide.</p>
          <ol className="train-home-recipe" aria-label="Detection session steps">
            <li><span>01</span><b>Record</b><small>{scriptSeconds(TRAINING_SCRIPT)} seconds</small></li>
            <li><span>02</span><b>Choose a setting</b><small>Review sampled frames</small></li>
            <li><span>03</span><b>Check it again</b><small>{scriptSeconds(CHECK_SCRIPT)} seconds</small></li>
          </ol>
          <button className="button amber train-home-launch" disabled={!ready} onClick={onStart}>
            Start session <ArrowRight size={17} weight="bold" aria-hidden="true" /></button>
          <details className="train-home-script"><summary>Preview the recording prompts</summary>
            <ol>{TRAINING_SCRIPT.map(item => <li key={item.id}><span>{item.prompt}</span><b>{item.seconds}s</b></li>)}</ol>
          </details>
        </div>
        <ServiceReadiness service={service} onRetry={onRetry} />
      </section>
      <section className="training-health train-home-record" aria-label="Last session and current selection">
        <p className="train-kicker"><ClockCounterClockwise size={18} aria-hidden="true" /> YOUR RESULTS</p>
        <h2>{latest ? 'Last session' : 'Your first baseline'}</h2>
        {latest ? <>
          <p className="train-record-date">{dateLabel(latest.at)}</p>
          <strong className="train-record-verdict">{outcomeLabel(latest)}</strong>
          {latest.check ? <CheckComparison check={latest.check} /> : <p>{legacyFinding(latest)}</p>}
        </> : <p>Your first session shows how often the detector finds a person during the prompts and what it flags while the room should be empty.</p>}
        <div className="train-rule-status"><SlidersHorizontal size={19} aria-hidden="true" /><div><span>Saved Recognition selection</span>
          <strong>{inUse?.name || (service.state === 'connecting' ? 'Checking selection…' : 'No saved selection available')}</strong></div></div>
      </section>
    </div>
    {service.people?.enabled && <section className="train-home-enroll" aria-label="Person enrollment">
      <span className="train-enroll-icon"><UserFocus size={29} aria-hidden="true" /></span>
      <div><p className="train-kicker">PERSON ENROLLMENT</p><h2>Build a personal baseline</h2>
        <p>With the person’s agreement, capture face views for possible-match suggestions. Review each suggestion in Recognition.</p></div>
      <button className="button" disabled={!ready} onClick={onEnroll}>Enroll a person</button>
    </section>}
    <TrainingAssistant />
    {children}
    <SessionHistory history={history} />
  </section>;
}
