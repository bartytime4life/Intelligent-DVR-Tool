import React, {useRef, useState} from 'react';
import {FileText, FolderOpen} from '@phosphor-icons/react';
import {compareByteReceipts, readByteReceipt} from './acceptance-receipts.mjs';
import './acceptance-receipts.css';

export default function AcceptanceReceipts() {
  const [receipts,setReceipts] = useState({}), [busy,setBusy] = useState({}), [errors,setErrors] = useState({});
  const versions = useRef({current:0, earlier:0});
  async function open(event, slot) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const version = ++versions.current[slot];
    setBusy(value => ({...value,[slot]:true})); setErrors(value => ({...value,[slot]:''}));
    try {
      const receipt = await readByteReceipt(file);
      if (version === versions.current[slot]) setReceipts(value => ({...value,[slot]:receipt}));
    } catch (error) {
      if (version === versions.current[slot]) setErrors(value => ({...value,[slot]:`${error.message} Last loaded receipt kept.`}));
    } finally {
      if (version === versions.current[slot]) setBusy(value => ({...value,[slot]:false}));
    }
  }
  function clear() {
    versions.current.current++; versions.current.earlier++;
    setReceipts({}); setErrors({}); setBusy({});
  }
  const current = receipts.current, comparison = compareByteReceipts(receipts.earlier,current);
  return <details className="acceptance-receipts">
    <summary><FileText size={19} aria-hidden="true" />Check backup receipts<span>Read saved byte checks</span></summary>
    <div className="acceptance-receipts-body">
      <h3>What does your byte check establish?</h3>
      <p>Open the acceptance verifier’s JSON receipt. Add the earlier receipt to compare before and after. No video, model or camera is needed here.</p>
      <div className="acceptance-receipt-loaders">
        {[['current','Current byte-check receipt'],['earlier','Earlier receipt (optional)']].map(([slot,label]) => <div key={slot}>
          <label className="button"><FolderOpen size={16} aria-hidden="true" />{label}<input type="file" accept=".json,application/json" aria-label={label} disabled={busy[slot]} onChange={event => open(event,slot)} /></label>
          <p className="acceptance-receipt-selection" role="status">{busy[slot] ? 'Reading receipt…' : receipts[slot] ? `${receipts[slot].kind === 'generated' ? 'Generated input' : 'OEM-labeled input'} · ${receipts[slot].check === 'PASS' ? 'Byte check passed' : 'Byte check failed'}` : 'No receipt loaded'}</p>
          {errors[slot] && <p className="recognition-error" role="alert">{errors[slot]}</p>}
        </div>)}
      </div>
      {current && <>
        <div className="acceptance-result" role="status"><strong>{current.check === 'PASS' ? 'Receipt reports matching source and backup bytes' : 'Receipt reports a failed byte check'}</strong>
          <p>{current.check === 'FAIL' ? current.error.replaceAll('_',' ').toLowerCase() : `${current.bytes.toLocaleString()} bytes · ${current.kind === 'generated' ? 'Generated input only' : 'OEM label supplied by the operator'}`}</p>
        </div>
        <dl className="acceptance-decisions">
          <div><dt>Review correspondence</dt><dd>{current.review === 'MATCHED' ? 'Source-matched review reported' : 'Not checked'}</dd></div>
          <div><dt>Video coverage</dt><dd>{current.coverage === 'partial' ? 'Partial coverage reported' : current.coverage === 'completed' ? 'Completed coverage reported' : 'Not checked'}</dd></div>
          <div><dt>Analysis backend</dt><dd>{current.backend === 'onnxruntime-cuda' ? 'CUDA reported · execution needs separate evidence' : current.backend === 'opencv-cpu' ? 'CPU reported · CUDA not established' : 'Not checked'}</dd></div>
          <div><dt>Field compatibility and quality</dt><dd>Not established by these receipts</dd></div>
        </dl>
        <details className="acceptance-fingerprints"><summary>Receipt fingerprints and revision</summary><p>App revision: <code>{current.revision}</code></p>{current.source && <p>Source SHA-256: <code>{current.source}</code></p>}<p>Receipt SHA-256: <code>{current.documentHash}</code></p><p>Recorded time: {current.utc}</p></details>
      </>}
      {receipts.earlier && current && <div className={`acceptance-comparison acceptance-${comparison.state.toLowerCase()}`} role="status"><strong>{comparison.title}</strong>{comparison.state === 'MATCHED' && <p>{comparison.linked ? 'The current receipt also links this exact earlier receipt file.' : 'No earlier-receipt link was included. Use the verifier’s --previous option for that check.'}</p>}</div>}
      <p className="acceptance-privacy">Files are read only in this browser, never uploaded or saved here. Reloading clears them. Receipts are editable, unsigned records: this view does not rehash video, run inference, verify real hardware or authenticate the operator’s labels.</p>
      <div className="local-analysis-actions"><a href="https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/oem-field-acceptance.md" target="_blank" rel="noreferrer">How to create a byte-check receipt</a><button className="text-button" onClick={clear} disabled={!current && !receipts.earlier && !busy.current && !busy.earlier && !errors.current && !errors.earlier}>Clear loaded receipts</button></div>
    </div>
  </details>;
}
