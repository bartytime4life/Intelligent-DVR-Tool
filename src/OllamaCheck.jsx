import React, { useEffect, useRef, useState } from 'react';
import { casesFor, checkModels, rankChecks, preferChecks, saveCheckedModels } from './ollama-check.mjs';
import { downloadBlob } from './clip-capture.mjs';

export default function OllamaCheck({ names, selected, digests, previous, busy, onBusy, onRank }) {
  const active = useRef(null);
  const [report, setReport] = useState({ rows: [] });
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('compare');
  const [started, setStarted] = useState(null);
  useEffect(() => () => active.current?.abort(), []);
  const needsRetry = names.filter(model => previous.some(r => r.model === model && r.passed < r.total));
  async function start(runMode) {
    if (active.current || busy) return;
    const job = new AbortController();
    active.current = job;
    onBusy(true);
    setMessage('');
    setReport({rows: []});
    setMode(runMode);
    setStarted(new Date().toISOString());
    try {
      let last;
      let targets = names;
      if (runMode === 'assisted') targets = needsRetry;
      if (['holdout','extended'].includes(runMode)) targets = [selected];
      const selectedProfile = previous.find(row => row.model === selected && row.passed === row.total)?.profile;
      await checkModels(targets, job.signal, progress => { last = progress; setReport(progress); }, runMode, selectedProfile);
      let complete = 'Check complete.';
      if (['checked', 'assisted', 'extended'].includes(runMode)) {
        let ranking = rankChecks(last.rows, digests, runMode);
        if (runMode !== 'checked') ranking = preferChecks(previous, ranking);
        onRank(ranking);
        if (!saveCheckedModels(ranking)) complete += ' Browser storage is unavailable. Export the results to keep them.';
      }
      if (runMode === 'holdout') {
        const passed = last.rows.filter(row => !row.error && !row.truncated).length;
        const total = casesFor('holdout').length;
        complete = `Fresh cases: ${passed} of ${total} passed.`;
        const ranking = previous.map(row => row.model === selected ? { ...row, holdout: { passed, total } } : row);
        onRank(ranking);
        if (!saveCheckedModels(ranking)) complete += ' Export the result to keep it.';
      }
      setMessage(complete);
    } catch (error) {
      setMessage(job.signal.aborted ? 'Stopped. Completed answers are available below.' : error.message);
    } finally {
      active.current = null;
      onBusy(false);
    }
  }
  const receipt = { schema: 'dvr-ollama-check/v1', started, mode, ollamaVersion: report.version, digests, cases: casesFor(mode), rows: report.rows };
  return <details className="training-catalog"><summary>Compare model settings</summary>
    <p>Check four counts and one decision on each of two generated scorecards, or compare free-text answers for manual review. Large models can take several minutes. The app runs one request at a time and releases the model after each answer.</p>
    <button className="button" disabled={busy || !names.length} onClick={() => start('compare')}>Compare free-text settings ({names.length} models)</button>
    <button className="button" disabled={busy || !names.length} onClick={() => start('checked')}>Test checked answers ({names.length} models)</button>
    {needsRetry.length > 0 && <button className="button" disabled={busy} onClick={() => start('assisted')}>Retest {needsRetry.length} models with count differences</button>}
    {needsRetry.includes(selected) && <button className="button" disabled={busy} onClick={() => start('extended')}>Test longer output for {selected}</button>}
    {selected && <button className="button" disabled={busy} onClick={() => start('holdout')}>Verify {selected} on two fresh cases</button>}
    {active.current && <button className="text-button" onClick={() => active.current.abort()}>Stop model check</button>}
    <p role="status">{active.current && report.model ? `Checking ${report.model} · ${report.profile} · ${report.id}. ` : ''}{message} {report.rows.length} completed requests.</p>
    {!active.current && ['checked','assisted','extended'].includes(mode) && report.rows.length > 0 && <table className="train-home-comparison">
      <caption>Generated scorecard checks on this PC</caption>
      <thead><tr><th>Model</th><th>Passed</th><th>Mean wait</th></tr></thead>
      <tbody>{rankChecks(report.rows, digests, mode).map(row => <tr key={row.model}><th>{row.model}</th><td>{row.passed}/{row.total}</td><td>{(row.meanMs / 1000).toFixed(1)} s</td></tr>)}</tbody>
    </table>}
    {!!report.rows.length && <>
      <button className="button" onClick={() => downloadBlob(new Blob([JSON.stringify(receipt,null,2)], {type:'application/json'}),'dvr-ollama-check.json')}>Export answers and timings</button>
      <details><summary>Review measured results</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(receipt,null,2)}</pre></details>
    </>}
  </details>;
}
