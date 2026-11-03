import React, { useRef, useState } from 'react';
import OllamaCoach from './OllamaCoach.jsx';
import { readLabReceipt } from './lab-receipt.mjs';

export default function TrainingAssistant() {
  const [receipt, setReceipt] = useState(null);
  const [status, setStatus] = useState('');
  const revision = useRef(0);
  async function load(file) {
    const current = ++revision.current;
    setReceipt(null);
    setStatus(file ? 'Checking the receipt and recounting matches…' : '');
    if (!file) return;
    try {
      const result = await readLabReceipt(file);
      if (revision.current !== current) return;
      setReceipt(result);
      setStatus('');
    } catch (error) {
      if (revision.current === current) setStatus(error.message);
    }
  }
  return <section className="training-assistant" aria-label="Training help and Lab receipts">
    <details className="training-panel">
      <summary>Review a Training Lab receipt</summary>
      <p>In the Training Lab, open Reports and export the run receipt as JSON. Choose it here to check the results on this computer.</p>
      <label>Run receipt <input type="file" accept=".json,application/json" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) load(file);
      }} /></label>
      <p role="status">{status}</p>
    </details>
    {receipt && <section className="training-health train-receipt" aria-label="Recounted evaluation results">
      <p className="train-kicker">{receipt.scope === 'synthetic' ? 'GENERATED TEST FOOTAGE' : 'IMPORTED RECORDING PREDICTIONS'}</p>
      <h3>Your held-out results</h3>
      <dl>{[['Reviewed frames', receipt.frames], ['Matched objects', receipt.tp],
        ['Extra boxes', receipt.fp], ['Missed labels', receipt.fn]].map(([label, count]) =>
          <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
      <p>Recounted from the labels and boxes in this file at threshold {receipt.threshold}.
        {' '}{receipt.scope === 'synthetic' ? 'These counts describe generated scenes.' : 'The file declares which detector ran. A person still needs to review the recording and labels.'}</p>
      <button className="text-button" onClick={() => load(null)}>Close receipt</button>
    </section>}
    <OllamaCoach evidence={receipt || undefined} />
  </section>;
}
