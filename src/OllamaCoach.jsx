import React, { useEffect, useRef, useState } from 'react';
import { measuredSummary, requiredHumanCheck } from './ollama-scorecard.mjs';
import { readCheckedModels } from './ollama-check.mjs';
import OllamaCheck from './OllamaCheck.jsx';
import { receiptAdvice } from './lab-receipt.mjs';
import { discover, explain, onLocalDvr } from './ollama.mjs';
import { CHECK_SCRIPT, TRAINING_SCRIPT } from './training.mjs';

const prompts = script => script.map(({ prompt, seconds }) => ({ prompt, seconds }));
const setup = { stage: 'Before recording', calibrationPrompts: prompts(TRAINING_SCRIPT), freshCheckPrompts: prompts(CHECK_SCRIPT) };
// Keep only the picker while Train changes steps. Answers belong to one scorecard.
let picker = { names: [], selected: '', digests: {}, ranking: [] };

function discoveryMessage({ names, installed, unreadable }) {
  if (!installed) return 'Ollama is running. It reports no installed models. Use ollama list on this computer to check.';
  const count = names.length;
  const result = count ? `${count} local chat model${count === 1 ? '' : 's'} available.` : 'No compatible local chat model could be verified.';
  return unreadable ? `${result} Could not inspect ${unreadable} model(s). Try finding models again.` : result;
}

export default function OllamaCoach({ evidence = setup }) {
  const [choices, setChoices] = useState(() => picker);
  const [busy, setBusy] = useState('');
  const [checkingModels, setCheckingModels] = useState(false);
  const [status, setStatus] = useState('');
  const [answer, setAnswer] = useState(null);
  const controller = useRef(null);
  const key = JSON.stringify(evidence);
  const lab = evidence.stage === 'Training Lab receipt';
  useEffect(() => {
    setAnswer(null);
    setStatus('');
    setBusy('');
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [key]);

  function updatePicker(value) {
    picker = value;
    setChoices(value);
  }
  async function run(action) {
    if (controller.current) return;
    const job = new AbortController();
    controller.current = job;
    setBusy(action);
    setStatus('');
    setAnswer(null);
    try {
      if (action === 'scan') {
        const inventory = await discover(job.signal);
        if (job.signal.aborted) return;
        const names = inventory.names;
        updatePicker({ names, digests: inventory.digests, ranking: readCheckedModels(inventory.digests), selected: names.includes(choices.selected) ? choices.selected : '' });
        setStatus(discoveryMessage(inventory));
      } else {
        const qualified = selectedCheck && selectedCheck.passed === selectedCheck.total && ['assisted','extended'].includes(selectedCheck.profile);
        const profile = evidence.settings && qualified ? selectedCheck.profile : undefined;
        const result = await explain(choices.selected, evidence, job.signal, profile);
        if (!job.signal.aborted) setAnswer({ ...result, key });
      }
    } catch (error) {
      if (job.signal.aborted) return;
      if (action === 'scan') updatePicker({ names: [], digests: {}, ranking: [], selected: '' });
      const message = error.name === 'TimeoutError' ? 'Ollama took too long. Try again or choose a smaller local model.'
        : error instanceof TypeError ? 'Cannot reach Ollama on this PC. Start the Ollama app or service, then choose Find installed models again.' : error.message;
      setStatus(message);
      if (action === 'ask' && (lab || evidence.settings?.length === 2)) {
        setAnswer({ key, source: 'app', text: lab ? receiptAdvice(evidence) : measuredSummary(evidence) });
      }
    } finally {
      if (controller.current === job) {
        controller.current = null;
        setBusy('');
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy('');
    setStatus('Request cancelled.');
  }
  const humanCheck = requiredHumanCheck(evidence);
  if (humanCheck) return <section className="training-health training-coach" aria-label="Scorecard explanation">
    <p className="train-kicker">LOCAL MEASUREMENT</p><h3>Measured summary from the DVR</h3>
    <p>{humanCheck}</p><small>Calculated directly from this scorecard.</small>
  </section>;
  if (!onLocalDvr()) return <section className="training-health training-coach" aria-label="Local training assistant">
    <p className="train-kicker">OLLAMA · ON YOUR COMPUTER</p><h3>Use the assistant in the local DVR</h3>
    <p>Open Train from the installed Windows or Linux app to find your models. If you are reviewing a Training Lab run, take its JSON receipt with you.</p>
  </section>;
  const qualified = choices.ranking.filter(row => row.passed === row.total && (!row.holdout || row.holdout.passed === row.holdout.total));
  const recommended = qualified.find(row => row.holdout) ?? qualified[0];
  const selectedCheck = choices.ranking.find(row => row.model === choices.selected);
  return <section className="training-health training-coach" aria-label="Local training assistant">
    <p className="train-kicker">OPTIONAL · OLLAMA</p><h3>Training assistant</h3>
    <p>{lab ? 'Choose a local model to suggest what to review next. It receives only the sample counts, threshold and type of run.' : evidence === setup ? 'Get a walkthrough before connecting your camera. The assistant receives the recording prompts.' : 'Get help comparing the two settings. The assistant receives only the scorecard counts and thresholds.'}</p>
    {!lab && recommended && <p className="training-note">{recommended.holdout ? 'Passed screening and fresh cases on this PC:' : 'Fastest to pass both scorecard checks on this PC:'} <b>{recommended.model}</b> · {(recommended.meanMs / 1000).toFixed(1)} s average.</p>}
    {!lab && !recommended && choices.ranking.length > 0 && <p className="training-note">No model has passed all its completed scorecard checks. Use the DVR’s measured counts and confirmation step for your decision.</p>}
    {!lab && selectedCheck && <p className="training-note">Selected model passed {selectedCheck.passed} of {selectedCheck.total} generated checks with the {selectedCheck.profile ?? 'checked'} profile.{selectedCheck.holdout && ` Fresh cases: ${selectedCheck.holdout.passed}/${selectedCheck.holdout.total}.`}</p>}
    <div className="training-actions">
      <button className="button" disabled={checkingModels || !!busy} onClick={() => run('scan')}>{busy === 'scan' ? 'Checking installed models…' : 'Find installed models'}</button>
      {!!choices.names.length && <>
        <label>Local chat model <select value={choices.selected} disabled={checkingModels || !!busy} onChange={event => {
          updatePicker({ ...choices, selected: event.target.value }); setAnswer(null); setStatus('');
        }}><option value="" disabled>Choose a model…</option>{choices.names.map(name => <option key={name}>{name}</option>)}</select></label>
        <button className="button" disabled={checkingModels || !!busy || !choices.selected} onClick={() => run('ask')}>{busy === 'ask' ? 'Waiting for Ollama…' : evidence === setup ? 'Help me get started' : lab ? 'Suggest a review step' : 'Explain these results'}</button>
      </>}
      {busy && <button className="text-button" onClick={cancel}>Cancel request</button>}
    </div>
    <div role="status">{status}
      {answer?.key === key && <div className="training-coach-answer">
        <b>{answer.source === 'app' ? (lab ? 'Review step from the DVR' : 'Measured summary from the DVR') : ['checked','assisted','extended'].includes(answer.profile) ? 'Verified scorecard explanation' : 'Model suggestion'}</b><p>{answer.text}</p>
        {evidence === setup && <p className="training-note">During the fresh check, you confirm the recording conditions and choose which setting to use.</p>}
        {answer.source !== 'app' && <small>{answer.model} · Answer received in {(answer.elapsedMs / 1000).toFixed(1)} s{answer.truncated ? ' · Output limit reached' : ''}</small>}
      </div>}
    </div>
    {evidence === setup && choices.names.length > 0 && <OllamaCheck names={choices.names} selected={choices.selected} previous={choices.ranking} digests={choices.digests} onRank={ranking => updatePicker({ ...choices, ranking })} busy={checkingModels || !!busy} onBusy={setCheckingModels} />}
  </section>;
}
