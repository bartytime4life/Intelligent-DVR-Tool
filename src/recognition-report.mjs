import { parseRecognition, mergeRecognitionEvents } from './recognition.mjs';
import { comparisonSummary } from './enhancement.mjs';
import { coverageLabel } from './media-coverage.mjs';

export const validateReportRun = run => parseRecognition({ schema:'intelligent-dvr.recognition-review.v1', receipt:run.receipt, trace:run.trace });

export function recognitionReport(run, options) { return summarizeReport(validateReportRun(run), options); }

// Takes a run already returned by validateReportRun, so a threshold change does not revalidate the whole trace.
export function summarizeReport(parsed, { threshold = .5, reviews = [], sourceMatched = false, sourceName = '', generatedAt = new Date().toISOString() } = {}) {
  if (!Number.isFinite(threshold) || threshold < .1 || threshold > 1) throw Error('Report threshold must be 0.10–1.00.');
  const { receipt, trace } = parsed, classes = new Map();
  const samples = trace.frames.map(frame => {
    const counts = new Map();
    for (const d of frame.detections) {
      if (d.score < threshold) continue;
      counts.set(d.label, (counts.get(d.label) || 0) + 1);
      const c = classes.get(d.label) || { label:d.label, detections:0, samples:0, peak_in_sample:0, max_score:0, first_seconds:frame.seconds, last_seconds:frame.seconds };
      c.detections++; c.max_score = Math.max(c.max_score, d.score); c.last_seconds = frame.seconds;
      classes.set(d.label, c);
    }
    for (const [label, n] of counts) { const c=classes.get(label); c.samples++; c.peak_in_sample=Math.max(c.peak_in_sample,n); }
    return { frame_index:frame.frame_index, seconds:frame.seconds, detections:[...counts.values()].reduce((a,b)=>a+b,0), classes:[...counts].map(([label,count])=>({label,count})) };
  });
  const ids = new Set(parsed.events.map(e => e.id));
  const decisions = new Map(mergeRecognitionEvents(reviews.filter(e => ids.has(e.id)), parsed.events).map(e => [e.id,e]));
  const observations = receipt.events.map(e => {
    const review = decisions.get(`import-${e.id}`);
    return { id:e.id, seconds:e.seconds, label:e.label, rule:e.rule, score:e.score,
      status:review?.status || 'pending', note:typeof review?.note === 'string' ? review.note.slice(0,2000) : '' };
  });
  return {
    schema:'intelligent-dvr.recognition-report.v1', generated_at:generatedAt,
    source:{ name:sourceName || receipt.camera, camera:receipt.camera, sha256:receipt.source_sha256, fingerprint_matched:sourceMatched },
    analysis:{ state:receipt.state, profile:receipt.inference_profile,
      backend:['opencv-cpu','onnxruntime-cuda'].includes(receipt.runtime?.backend_id) ? receipt.runtime.backend_id : 'unspecified',
      model_sha256:receipt.model_sha256, labels_sha256:receipt.labels_sha256, rules_sha256:receipt.rules_sha256, rules_file_sha256:receipt.rules_file_sha256,
      decoded_frames:receipt.frames_read, sampled_frames:trace.frames.length, stride:receipt.stride, fps_metadata:receipt.fps_metadata,
      last_sample_seconds:trace.frames.at(-1).seconds, display_threshold:threshold },
    coverage:{label:coverageLabel(receipt), declaration:receipt.media_coverage || null},
    summary:{ detections:samples.reduce((n,s)=>n+s.detections,0), samples_with_detections:samples.filter(s=>s.detections>0).length,
      observations:observations.length, pending:observations.filter(e=>e.status==='pending').length,
      confirmed:observations.filter(e=>e.status==='confirmed').length, dismissed:observations.filter(e=>e.status==='dismissed').length },
    classes:[...classes.values()].sort((a,b)=>b.detections-a.detections || a.label.localeCompare(b.label)), samples, observations,
    ...(parsed.enhancement ? {enhancement_comparison:comparisonSummary(trace,threshold)} : {}),
    limits:[
      'Detections are repeated sampled observations, not unique people, objects, identities or tracks.',
      'Model scores are not calibrated probabilities. A missing detection does not establish absence.',
      'Report threshold filters detection summaries only; original rules and observations are unchanged.',
      'Frame times use container FPS and assume constant frame rate; variable-rate timing needs separate verification.',
      coverageLabel(receipt) + '. Sampled frames do not establish continuous coverage; inventory checks do not prove every byte intact or camera-source completeness.',
      'Source fingerprints establish byte correspondence, not authenticity. Reports and local decisions are unsigned; recognition accuracy remains unmeasured.',
    ],
  };
}

const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const csvCell = v => { let s=String(v ?? ''); if (/^[\s]*[=+\-@]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"'; };
export function reportCSV(report) {
  const rows = [['source_sha256','analysis_state','seconds','label','rule','model_score','review_status','review_note','recording_coverage_status','analysis_termination']];
  for (const e of report.observations) rows.push([report.source.sha256,report.analysis.state,e.seconds,e.label,e.rule,e.score,e.status,e.note,report.coverage.declaration?.status || 'legacy-unverified',report.coverage.declaration?.termination || 'unspecified']);
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

export function comparisonCSV(report) {
  const c=report.enhancement_comparison;
  if (!c) throw Error('This report has no sharpening comparison.');
  const rows=[['source_sha256','profile','implementation_sha256','frame_index','seconds','display_threshold','original_detections','sharpened_detections','original_processing_ms','enhanced_processing_ms','source_pixels_sha256','enhanced_pixels_sha256','qualification']];
  for (const s of c.samples) rows.push([report.source.sha256,c.declaration.profile,c.declaration.implementation_sha256,s.frame_index,s.seconds,report.analysis.display_threshold,s.original,s.sharpened,s.original_processing_ms,s.enhanced_processing_ms,s.source_pixels_sha256,s.enhanced_pixels_sha256,'unqualified']);
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

export function reportHTML(report) {
  const h=escapeHTML;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Intelligent DVR recognition report</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 24px;color:#152c35}h1{margin-bottom:4px}h2{margin-top:32px}code{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;border-bottom:1px solid #cdd8db;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#edf4f3}p,li,td{white-space:pre-wrap}.notice{padding:16px;background:#f4f0e5;border-left:4px solid #9c7427}.scroll{overflow:auto}@media print{body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}</style>
<h1>Recording recognition report</h1><p>Intelligent DVR · ${h(report.generated_at)}</p>
<p class="notice"><strong>${h(report.analysis.state.toUpperCase())} · ${report.source.fingerprint_matched ? 'Recording fingerprint matched' : 'Recording NOT matched'}</strong><br>Human review required. Sampled observations do not establish identity, intent or continuous coverage.</p>
<h2>Source and analysis</h2><p>${h(report.source.name)}<br>Source SHA-256: <code>${h(report.source.sha256)}</code><br>Model SHA-256: <code>${h(report.analysis.model_sha256)}</code><br>Rules SHA-256: <code>${h(report.analysis.rules_sha256)}</code><br>Rules file SHA-256: <code>${h(report.analysis.rules_file_sha256)}</code><br>Labels SHA-256: <code>${h(report.analysis.labels_sha256)}</code></p>
<p>${h(report.analysis.profile)} · ${h(report.analysis.backend)}<br>${report.analysis.sampled_frames} samples / ${report.analysis.decoded_frames} decoded frames · stride ${report.analysis.stride} · container FPS ${report.analysis.fps_metadata}<br>Last analyzed sample +${report.analysis.last_sample_seconds.toFixed(3)}s · display score ≥ ${report.analysis.display_threshold.toFixed(2)}</p>
<p>Recording coverage: ${h(report.coverage.label)}</p>
<h2>Sampled class inventory</h2><p>${report.summary.detections} detections across ${report.summary.samples_with_detections} samples. Repeated sightings are counted repeatedly.</p>
<div class="scroll"><table><thead><tr><th>Class</th><th>Detections</th><th>Samples</th><th>Peak / sample</th><th>First / last sample (s)</th><th>Max score</th></tr></thead><tbody>${report.classes.map(c=>`<tr><td>${h(c.label)}</td><td>${c.detections}</td><td>${c.samples}</td><td>${c.peak_in_sample}</td><td>${c.first_seconds.toFixed(3)} / ${c.last_seconds.toFixed(3)}</td><td>${c.max_score.toFixed(3)}</td></tr>`).join('')}</tbody></table></div>
<h2>Rule observations and decisions</h2><p>${report.summary.pending} not yet reviewed ·${report.summary.confirmed} confirmed · ${report.summary.dismissed} dismissed. Decisions reflect the current local review queue at export.</p>
<div class="scroll"><table><thead><tr><th>Time (s)</th><th>Class / rule</th><th>Score</th><th>Decision</th><th>Notes</th></tr></thead><tbody>${report.observations.map(e=>`<tr><td>${e.seconds.toFixed(3)}</td><td>${h(e.label)}<br>${h(e.rule)}</td><td>${e.score.toFixed(3)}</td><td>${h(e.status)}</td><td>${h(e.note)}</td></tr>`).join('')}</tbody></table></div>
${report.enhancement_comparison ? comparisonHTML(report.enhancement_comparison) : ''}
<h2>Interpretation limits</h2><ul>${report.limits.map(v=>`<li>${h(v)}</li>`).join('')}</ul></html>`;
}

function comparisonHTML(c) {
  const h=escapeHTML;
  return `<h2>Experimental sharpening comparison</h2><p>Original-only rule observations. Counts repeat across samples. More detections do not establish better accuracy. Qualification: unqualified.</p><p>Profile: ${h(c.declaration.profile)}<br>Parameters: ${h(JSON.stringify(c.declaration.parameters))}<br>Implementation SHA-256: <code>${h(c.declaration.implementation_sha256)}</code></p><table><thead><tr><th>Class</th><th>Original detections</th><th>Sharpened detections</th></tr></thead><tbody>${c.classes.map(row=>`<tr><td>${h(row.label)}</td><td>${row.original}</td><td>${row.sharpened}</td></tr>`).join('')}</tbody></table><p>Mean sampled-frame processing: original ${c.mean_original_processing_ms.toFixed(1)} ms; sharpened ${c.mean_enhanced_processing_ms.toFixed(1)} ms. Includes preprocessing and inference; excludes media reads, hashing and reporting. Original runs first; these are sequential measurements.</p>`;
}
