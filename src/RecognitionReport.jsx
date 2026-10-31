import React, { useMemo, useRef, useState } from 'react';
import { validateReportRun, summarizeReport, reportCSV, reportHTML, comparisonCSV } from './recognition-report.mjs';
import { downloadBlob } from './clip-capture.mjs';

export default function RecognitionReport({ run, threshold, reviews, source, onSeek }) {
  const [focusBar, setFocusBar] = useState(0), timeline = useRef();
  const parsed = useMemo(() => { try { return { run:validateReportRun(run) }; } catch (error) { return {error:error.message}; } }, [run]);
  const value = useMemo(() => { if (parsed.error) return parsed;
    try { return { report:summarizeReport(parsed.run, {threshold,reviews,sourceMatched:Boolean(source),sourceName:source?.name}) }; }
    catch (error) { return {error:error.message}; } }, [parsed,threshold,reviews,source]);
  if (value.error) return <p className="recognition-error" role="alert">Report unavailable: {value.error}</p>;
  const r=value.report, prefix=`dvr-${r.source.sha256.slice(0,12)}`;
  const save=(text,type,name)=>downloadBlob(new Blob([text],{type}),name);
  const max=Math.max(1,...r.samples.map(s=>s.detections));
  // At most 100 timeline buttons, using the peak sample in each bounded bin.
  const width=Math.ceil(r.samples.length/100), bins=[];
  for(let i=0;i<r.samples.length;i+=width){let best=i;for(let j=i;j<Math.min(i+width,r.samples.length);j++)if(r.samples[j].detections>r.samples[best].detections)best=j;bins.push(best);}
  // One tab stop for the timeline; arrow keys, Home and End move between bars.
  const current=Math.min(focusBar,bins.length-1);
  const moveFocus=e=>{const next={ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:bins.length-1}[e.key];
    if(next===undefined)return; e.preventDefault(); const i=Math.max(0,Math.min(bins.length-1,next)); setFocusBar(i); timeline.current?.children[i]?.focus();};
  return <section className="recognition-report" aria-label="Recognition report">
    <div className="local-analysis-heading"><div><p className="eyebrow">EVIDENCE SUMMARY</p><h2>Recording report</h2></div><span>{r.analysis.state.toUpperCase()}</span></div>
    <div className="report-metrics"><div><strong>{r.summary.detections}</strong><span>Sampled detections</span></div><div><strong>{r.classes.length}</strong><span>Detected classes</span></div><div><strong>{r.summary.observations}</strong><span>Rule observations</span></div><div><strong>{r.summary.pending}</strong><span>Not yet reviewed</span></div></div>
    <p>Score ≥ {threshold.toFixed(2)} · repeated sightings count repeatedly. First and last times refer to analyzed samples, not arrivals or departures.</p>
    <p>Recording coverage: {r.coverage.label}. This does not establish continuous camera visibility or source authenticity.</p>
    <div className="report-timeline" role="toolbar" aria-label="Detection activity in sampled frames" ref={timeline} onKeyDown={moveFocus}>{bins.map((i,n)=><button key={i} tabIndex={n===current?0:-1} onFocus={()=>setFocusBar(n)} onClick={()=>onSeek(i)} aria-label={`Inspect sample ${i+1} at ${r.samples[i].seconds.toFixed(2)} seconds: ${r.samples[i].detections} detections`} title={`+${r.samples[i].seconds.toFixed(2)}s · ${r.samples[i].detections} detections`}><span style={{height:`${Math.max(4,r.samples[i].detections/max*100)}%`}} /></button>)}</div>
    <p className="hint">Select a bar to inspect its sampled frame. Long runs show the busiest sample in each group; this is not a continuous occupancy timeline.</p>
    <div className="report-table-wrap"><table><thead><tr><th>Class</th><th>Detections</th><th>Samples</th><th>Peak / sample</th><th>First → last (s)</th></tr></thead><tbody>{r.classes.map(c=><tr key={c.label}><td>{c.label}</td><td>{c.detections}</td><td>{c.samples}</td><td>{c.peak_in_sample}</td><td>{c.first_seconds.toFixed(2)} → {c.last_seconds.toFixed(2)}</td></tr>)}</tbody></table></div>
    {!r.classes.length && <p>No detections meet the report threshold. This does not establish an empty scene.</p>}
    <p>{r.summary.confirmed} confirmed · {r.summary.dismissed} dismissed. Review decisions and notes come from this browser’s Events queue.</p>
    {r.enhancement_comparison && <div aria-label="Sharpening report">
      <h3>Experimental sharpening comparison</h3>
      <p>Repeated detections at the same display threshold. More detections do not establish better accuracy. Rule observations above use original detections only.</p>
      <div className="report-table-wrap"><table><thead><tr><th>Class</th><th>Original detections</th><th>Sharpened detections</th></tr></thead><tbody>{r.enhancement_comparison.classes.map(c => <tr key={c.label}><td>{c.label}</td><td>{c.original}</td><td>{c.sharpened}</td></tr>)}</tbody></table></div>
    </div>}
    <div className="local-analysis-actions">
      <button className="button" onClick={()=>save(reportHTML(r),'text/html',`${prefix}-report.html`)}>Download printable report</button>
      <button className="button" onClick={()=>save(JSON.stringify(r,null,2),'application/json',`${prefix}-report.json`)}>Download report JSON</button>
      <button className="button" onClick={()=>save(reportCSV(r),'text/csv',`${prefix}-observations.csv`)}>Download observations CSV</button>
      {r.enhancement_comparison && <button className="button" onClick={()=>save(comparisonCSV(r),'text/csv',`${prefix}-sharpening.csv`)}>Download sharpening CSV</button>}
      <button className="button" onClick={()=>save(JSON.stringify({schema:'intelligent-dvr.recognition-review.v1',receipt:run.receipt,trace:run.trace}),'application/json',`${prefix}-recognition.json`)}>Save recognition results</button>
      {source && <a className="button" href={source.url} download={source.name}>Save analyzed recording</a>}
    </div><p className="hint">Reports contain source hashes and review notes, without video. The printable report opens offline and can be printed to PDF. Save recognition results plus the exact recording to reopen overlays later.</p>
  </section>;
}
