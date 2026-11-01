import React, { useEffect, useRef, useState } from 'react';
import { parseRecognition, frameSummary, canShowBoxes, matchRecording, MAX_REVIEW_BYTES } from './recognition.mjs';
import './recognition.css';
import LocalAnalysis from './LocalAnalysis.jsx';
import LanRecorder from './LanRecorder.jsx';
import RecognitionReport from './RecognitionReport.jsx';
import { coverageLabel } from './media-coverage.mjs';
import { saveObservationStills, grabFrame } from './local-images.mjs';

export default function RecognitionReview({ onImport, active = true, clip, onClip, reviews = [], evidence = null, onRecorderStatus, onZoneStill }) {
  const [run, setRun] = useState(null), [index, setIndex] = useState(0);
  const [source, setSource] = useState(null), [media, setMedia] = useState({});
  const [threshold, setThreshold] = useState(0.5), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [recorderBusy, setRecorderBusy] = useState(false);
  const [detectionInput, setDetectionInput] = useState('original');
  const [sending, setSending] = useState(false);
  const video = useRef(), generation = useRef(0), sourceGeneration = useRef(0);
  useEffect(() => () => { generation.current++; sourceGeneration.current++; }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);
  useEffect(() => {
    if (!active) { video.current?.pause(); setMedia({}); }
    else readMedia();
  }, [active]);
  const frame = run?.trace.frames[index];
  const summary = frame ? frameSummary(detectionInput === 'sharpened' && frame.comparison ? {...frame, detections:frame.comparison.detections} : frame, threshold) : null;
  const displayed = summary?.detections.slice(0, 200) || [];
  const boxesVisible = active && frame && canShowBoxes(frame, run.receipt.fps_metadata, { ...media, matched: Boolean(source) });

  async function loadRun(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const ticket = ++generation.current; sourceGeneration.current++;
    setError(''); setStatus('Reading recognition results…');
    try {
      if (file.size > MAX_REVIEW_BYTES) throw Error('Recognition results exceed 32 MiB. Split the recording before analysis.');
      const parsed = parseRecognition(JSON.parse(await file.text()));
      if (ticket !== generation.current) return;
      setRun(parsed); setDetectionInput('original'); setSource(null); setMedia({}); setIndex(0); setStatus('Results loaded. Choose the original recording to verify and view the detections.');
    } catch (err) { if (ticket === generation.current) { setError(err.message); setStatus(''); } }
  }
  async function loadVideo(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !run) return;
    const ticket = generation.current, sourceTicket = ++sourceGeneration.current;
    setSource(null); setMedia({}); setError(''); setStatus('Verifying recording fingerprint…');
    try {
      await matchRecording(file, run.receipt.source_sha256);
      if (ticket !== generation.current || sourceTicket !== sourceGeneration.current) return;
      setSource({ url: URL.createObjectURL(file), name: file.name });
      setStatus('Recording fingerprint matched. Review sampled frames and observations below.');
    } catch (err) {
      if (ticket === generation.current && sourceTicket === sourceGeneration.current) { setError(err.message); setStatus(''); }
    }
  }
  function openLocalResult({ bundle, file, name }) {
    generation.current++; sourceGeneration.current++;
    setRun(bundle); setDetectionInput('original'); setIndex(0); setSource({ url: URL.createObjectURL(file), name });
    setMedia({}); setError('');
    setStatus('Recording fingerprint matched. Analysis is ready for human review.');
  }
  // An Events observation opens its frame only in the run with the same source and model fingerprints.
  useEffect(() => {
    if (!evidence) return;
    const i = run && run.receipt.source_sha256 === evidence.sha && run.receipt.model_sha256 === evidence.model
      ? run.receipt.events.findIndex(e => e.id === evidence.sourceId) : -1;
    if (i < 0) {
      setStatus(`That observation (${evidence.time}) belongs to recording ${evidence.sha.slice(0, 12)}…. Open its results and original recording here to inspect the frame.`);
      return;
    }
    // A user may follow an Event before loading its matching run. Revisit the
    // pending deep link when the receipt or exact-source recording arrives.
    seek(run.eventFrames[i]);
    setStatus(source
      ? `Showing the source-matched sampled frame for the observation at ${evidence.time}.`
      : `The matching results contain the observation at ${evidence.time}. Match its original recording to verify the sampled frame.`);
  }, [evidence, run, source]);
  // Keep a small still per observation from the verified recording, then hand the observations to Events.
  async function sendToEvents() {
    const sent = run, from = source;
    setSending(true);
    try { if (from) await saveObservationStills(from.url, sent); }
    finally { setSending(false); }
    onImport(sent.events);
  }
  function readMedia() {
    const el = video.current;
    if (el) setMedia({ ready: el.readyState >= 2, paused: el.paused, seeking: el.seeking, seconds: el.currentTime, width: el.videoWidth, height: el.videoHeight });
  }
  function seek(i) {
    setIndex(i); setMedia({});
    const el = video.current;
    if (el) { el.pause(); el.currentTime = run.trace.frames[i].seconds; readMedia(); }
  }
  return <section className="content-page recognition-page" aria-label="Recording recognition review">
    <p className="eyebrow">LOCAL RECORDING · MODEL OBSERVATIONS</p>
    <h1>Recognition</h1>
    <p className="recognition-intro">See detected people and objects on the recording they came from. Inspect each sampled scene, then send observations for human review.</p>
    <LanRecorder onResult={openLocalResult} onBusy={setRecorderBusy} blocked={analysisBusy} onImport={onImport} onStatus={onRecorderStatus} />
    <LocalAnalysis onResult={openLocalResult} onBusy={setAnalysisBusy} clip={clip} onClip={onClip} recorderBusy={recorderBusy} currentRun={run} />
    <h2 className="recognition-import-heading">Or open previously exported results</h2>
    <div className="recognition-loaders">
      <label className="button">1. Open recognition results<input type="file" accept=".json,application/json" onChange={loadRun} disabled={analysisBusy} aria-label="Open recognition results" /></label>
      <label className={`button ${!run ? 'disabled' : ''}`}>2. Match original recording<input type="file" accept="video/*,.avi,.mkv" disabled={!run || analysisBusy} onChange={loadVideo} aria-label="Match original recording" /></label>
    </div>
    <ol className="recognition-progress" aria-label="Recording review progress">
      <li className={run ? 'complete' : 'current'}><span>1</span><div>Open results<small>{run ? `${run.trace.frames.length} samples loaded` : 'Analyzer review JSON'}</small></div></li>
      <li className={source ? 'complete' : run ? 'current' : ''}><span>2</span><div>Match recording<small>{source ? source.name : 'Verify original file'}</small></div></li>
      <li><span>3</span><div>Review observations<small>Inspect, then send to Events</small></div></li>
    </ol>
    <p className="recognition-status" role="status">{status || 'Video stays on this computer. Start a local analysis above or open an exported result.'}</p>
    {error && <p className="recognition-error" role="alert">{error}</p>}
    {!run && <div className="recognition-empty">
      <h2>Start with one approved recording</h2>
      <p>Connect to the local analysis service above, choose your recording, model and rules, then press Analyze recording. Completed results open here with their matching source.</p>
      <p>The result file contains sampled detections and rule observations. It contains no video. <a href="https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/recording-recognition.md" target="_blank" rel="noreferrer">Open the recording recognition guide</a> for the optional command-line workflow.</p>
    </div>}
    {run && <>
      <p className="recognition-session-note">Your loaded recording, sample position and display filter stay available while switching workspaces. Reloading or closing this page releases the recording.</p>
      <div className="recognition-facts">
        <span><strong>{run.receipt.camera}</strong> · {run.receipt.runtime?.backend_id === 'onnxruntime-cuda' ? 'CUDA analysis' : run.receipt.runtime?.backend_id === 'opencv-cpu' ? 'CPU analysis' : 'Backend unspecified'}</span>
        <span>{run.trace.frames.length.toLocaleString()} sampled frames · every {run.receipt.stride} source frames</span>
        <span className={run.receipt.state === 'partial' ? 'recognition-error' : ''}>{coverageLabel(run.receipt)}</span>
        <span>{source ? 'Result loaded · recording fingerprint matched' : 'Recording not matched'}</span>
      </div>
      {run.enhancement && <div className="recording-import" aria-label="Sharpening comparison">
        <label>Detection input <select aria-label="Detection input" value={detectionInput} onChange={e => setDetectionInput(e.target.value)}>
          <option value="original">Original</option><option value="sharpened">Mild sharpening (experimental)</option>
        </select></label>
        <p>The player shows original footage. Boxes and scene counts use the selected detector input. Rule observations and Events use original detections only. Sharpening is unqualified; additional detections may be false.</p>
        <p>Current sample at score ≥ {threshold.toFixed(2)}: original {frameSummary(frame,threshold).detections.length} · sharpened {frameSummary({...frame,detections:frame.comparison.detections},threshold).detections.length} detections.</p>
        <p>Sample processing: original {frame.comparison.original_processing_ms.toFixed(1)} ms · sharpened {frame.comparison.enhanced_processing_ms.toFixed(1)} ms. Includes preprocessing and inference; excludes media reads and pixel hashing.</p>
      </div>}
      <div className="recognition-layout">
        <div>
          <div className="recognition-stage" style={{ aspectRatio: `${frame.width}/${frame.height}` }}>
            {source ? <>
              <video key={source.url} ref={video} src={source.url} controls preload="metadata" playsInline
                onLoadedMetadata={() => seek(index)} onLoadedData={readMedia} onSeeked={readMedia} onSeeking={readMedia}
                onTimeUpdate={readMedia} onPlay={readMedia} onPause={readMedia} onEnded={readMedia}
                onError={() => { setMedia({}); setError('The browser cannot play this recording. Use a browser-compatible source and analyze it again; converted files have a different fingerprint.'); }} />
              {boxesVisible && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="recognition-boxes" aria-label="Detections on verified sampled frame">
                {displayed.map((d, i) => <rect key={i} x={d.box[0]*1000} y={d.box[1]*1000} width={d.box[2]*1000} height={d.box[3]*1000}><title>{d.label} · score {d.score.toFixed(2)}</title></rect>)}
              </svg>}
              {boxesVisible && <div className="recognition-box-labels" aria-hidden="true">{displayed.map((d, i) => <span key={i} style={{left:`${d.box[0]*100}%`, top:`${d.box[1]*100}%`}}>{d.label} {d.score.toFixed(2)}</span>)}</div>}
            </> : <p>Match the original recording to view this scene.</p>}
          </div>
          <p className="recognition-caption">{run.enhancement && `Original footage · ${detectionInput === 'sharpened' ? 'sharpened-input' : 'original-input'} detections. `}{source ? boxesVisible ? 'Boxes correspond to this paused, sampled frame.' : 'Boxes hidden. Select a sample to pause on its analyzed frame.' : 'No recording attached. Results alone are unverified metadata.'}</p>
          <div className="recognition-timeline">
            <button className="button" disabled={index === 0} onClick={() => seek(index-1)}>Previous sample</button>
            <label>Sample {index+1} of {run.trace.frames.length}<input aria-label="Analyzed sample" type="range" min="0" max={run.trace.frames.length-1} value={index} onChange={e => seek(Number(e.target.value))} /></label>
            <button className="button" disabled={index === run.trace.frames.length-1} onClick={() => seek(index+1)}>Next sample</button>
          </div>
          {onZoneStill && source && <button className="text-button recognition-zone-still" disabled={!media.ready || media.seeking} onClick={async () => {
            try { onZoneStill(await grabFrame(video.current), `${run.receipt.camera} · +${(media.seconds ?? 0).toFixed(2)}s`); } catch (err) { setError(err.message); }
          }}>Use this frame for zones</button>}
        </div>
        <aside className="recognition-scene">
          <p className="eyebrow">SAMPLED SCENE · +{frame.seconds.toFixed(3)}s</p>
          <h2>People & objects</h2>
          <label className="recognition-threshold">Display score ≥ {threshold.toFixed(2)}<input type="range" aria-label="Display score threshold" min="0.1" max="1" step="0.05" value={threshold} onChange={e => setThreshold(Number(e.target.value))} /></label>
          <p>This filter changes the display only. Recorded rules and observations stay unchanged.</p>
          {summary.counts.length ? <ul className="recognition-counts">{summary.counts.map(([label, n]) => <li key={label}><span>{label}</span><strong>{n}</strong></li>)}</ul> : <p>No detections meet this display threshold. This does not establish an empty scene.</p>}
          <p>Counts apply to this frame. They are not unique people, identities or tracked objects.</p>
          {summary.detections.length > 200 && <p>Showing the first 200 boxes and scores. Counts include all {summary.detections.length} detections above the display threshold.</p>}
          <div className="recognition-detections">{displayed.map((d, i) => <div key={i}><span>{d.label}</span><span>score {d.score.toFixed(2)}</span></div>)}</div>
        </aside>
      </div>
      <div className="recognition-observations">
        <h2>Rule observations <small>{run.events.length}</small></h2>
        <p>Presence and dwell follow the configured zones and class labels. They do not establish intent, an anomaly or continuity of the same person.</p>
        {run.events.length > 0 ? <>
          <button className="button amber" disabled={sending} onClick={sendToEvents}>{sending ? 'Saving stills…' : `Send ${run.events.length} observations to Events`}</button>
          {source && <p className="hint">Each observation keeps a small still from this verified recording in this browser. Stills are cleared with the queue and never uploaded.</p>}
          <div className="recognition-event-list">{run.receipt.events.map((e, i) => <button key={e.id} className="recognition-event" onClick={() => {setDetectionInput('original'); seek(run.eventFrames[i]);}}><span>+{e.seconds.toFixed(2)}s · {e.rule}</span><span>score {e.score.toFixed(2)} · View frame</span></button>)}</div>
        </> : <p>No configured rules emitted an observation in the analyzed portion. Inspect detections and rule settings before drawing conclusions.</p>}
      </div>
      <RecognitionReport run={run} threshold={threshold} reviews={reviews} source={source} onSeek={seek} />
      <details className="recognition-provenance"><summary>Provenance and limits</summary>
        <p>Source SHA-256: <code>{run.receipt.source_sha256}</code></p>
        <p>Model SHA-256: <code>{run.receipt.model_sha256}</code></p>
        <p>{coverageLabel(run.receipt)}. Inventory checks do not authenticate the recording or establish continuous camera visibility.</p>
        <p>Profile: {run.receipt.inference_profile}. Timing assumes constant frame rate ({run.receipt.fps_metadata.toFixed(3)} FPS).</p>
        <p>A matching recording fingerprint proves file correspondence, not authenticity or recognition accuracy. These results are unsigned. No live camera, identity tracking, learned scene interpretation or 100-camera acceptance is established.</p>
      </details>
    </>}
  </section>;
}
