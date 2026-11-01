import React, { useMemo, useRef, useState } from 'react';
import { analyzeImage, compareImages, pixelRuler, FULL_FRAME } from './image-science.mjs';
import './facility-image-lab.css';

const MAX_FILE = 12 * 1024 * 1024;
const MAX_SIDE = 720;
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const pct = value => value.toFixed(1) + '%';
const sourceLabel = source => String(source || 'Local image').slice(0, 80);

function freezeElement(element, width, height, source) {
  if (!width || !height || width < 1 || height < 1 || width * height > 24_000_000) throw Error('Image is empty or exceeds the 24 MP input limit.');
  const factor = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * factor));
  canvas.height = Math.max(1, Math.round(height * factor));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw Error('This browser cannot read the local image canvas.');
  context.drawImage(element, 0, 0, canvas.width, canvas.height);
  // SecurityError on cross-origin canvas is intentional: never bypass browser image-origin policy.
  return {
    image: context.getImageData(0, 0, canvas.width, canvas.height),
    preview: canvas.toDataURL('image/jpeg', .88),
    source: sourceLabel(source),
    capturedAt: new Date().toISOString(),
    sampledWidth: canvas.width,
    sampledHeight: canvas.height,
    originalWidth: width,
    originalHeight: height
  };
}

function pointAt(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
}

export default function FacilityImageLab({ capture, connected = false, sourceName = '' }) {
  const fileInput = useRef(null), pointer = useRef(null);
  const [slot, setSlot] = useState('a');
  const [frames, setFrames] = useState({ a: null, b: null });
  const [region, setRegion] = useState(FULL_FRAME);
  const [ruler, setRuler] = useState(null);
  const [tool, setTool] = useState('region');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const selected = frames[slot] || frames.a || frames.b;
  const metrics = useMemo(() => selected ? analyzeImage(selected.image, region) : null, [selected, region]);
  const difference = useMemo(() => frames.a && frames.b ? compareImages(frames.a.image, frames.b.image, region) : null, [frames, region]);
  const rulerPixels = selected && ruler ? pixelRuler(ruler.from, ruler.to, selected.image.width, selected.image.height) : null;

  function putFrame(frame) {
    setFrames(previous => ({ ...previous, [slot]: frame }));
    setRegion(FULL_FRAME);
    setRuler(null);
    setError('');
  }
  function freezeCurrent() {
    if (!connected || !capture) return;
    try {
      const source = capture();
      putFrame(freezeElement(source.element, source.width, source.height, sourceName || 'Explicit local preview'));
    } catch (err) {
      setError(err.name === 'SecurityError' ? 'This source cannot be sampled because the browser prevents cross-origin pixel reads.' : err.message);
    }
  }
  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_FILE || file.size === 0) {
      setError('Choose a PNG, JPEG or WebP image no larger than 12 MiB.');
      return;
    }
    setBusy(true); setError('');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      putFrame(freezeElement(bitmap, bitmap.width, bitmap.height, file.name));
    } catch (err) {
      setError(err.message || 'This image could not be decoded for local analysis.');
    } finally {
      bitmap?.close();
      setBusy(false);
    }
  }
  function startPointer(event) {
    if (!selected || event.button > 0) return;
    const start = pointAt(event);
    pointer.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'ruler') setRuler({ from: start, to: start });
    else setRegion({ x: start.x, y: start.y, width: .001, height: .001 });
  }
  function movePointer(event) {
    if (!pointer.current) return;
    const at = pointAt(event), from = pointer.current;
    if (tool === 'ruler') setRuler({ from, to: at });
    else setRegion({ x: Math.min(from.x, at.x), y: Math.min(from.y, at.y), width: Math.max(.001, Math.abs(from.x - at.x)), height: Math.max(.001, Math.abs(from.y - at.y)) });
  }
  function stopPointer(event) {
    if (!pointer.current) return;
    const from = pointer.current, at = pointAt(event);
    if (tool === 'region' && Math.hypot((from.x - at.x) * 100, (from.y - at.y) * 100) < 1) setRegion(FULL_FRAME);
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function changeRegion(key, value) {
    const n = clamp(Number(value) / 100);
    setRegion(current => {
      const next = { ...current, [key]: n };
      if (key === 'x') next.width = Math.min(next.width, 1 - n);
      if (key === 'y') next.height = Math.min(next.height, 1 - n);
      if (key === 'width') next.width = Math.min(n, 1 - next.x);
      if (key === 'height') next.height = Math.min(n, 1 - next.y);
      return next;
    });
  }
  function exportData() {
    if (!selected || !metrics) return;
    const report = {
      schema: 'intelligent-dvr-image-diagnostics-v1',
      source: selected.source, capturedAt: selected.capturedAt,
      originalPixels: [selected.originalWidth, selected.originalHeight],
      sampledPixels: [selected.sampledWidth, selected.sampledHeight],
      frame: frames.a === selected ? 'A' : frames.b === selected ? 'B' : 'selected',
      region, metrics, difference, rulerPixels,
      caveat: 'Local downsampled 8-bit sRGB channel-weighted image metrics. Edge detail and pixel changes do not establish focus, identity, physical dimension, surveillance detection quality or motion.'
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = 'facility-image-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <details className="facility-image-lab" aria-label="Image diagnostics laboratory">
    <summary><span><strong>Image diagnostics</strong><small>Pixel science · capture, compare, inspect</small></span><span className="facility-lab-chip">LOCAL ONLY</span></summary>
    <div className="facility-lab-content">
      <p className="facility-lab-note">Freeze a connected preview or open a local image. Everything stays in this browser session; no image is uploaded, saved in the plan, or used for recognition.</p>
      <div className="facility-lab-controls" role="group" aria-label="Choose diagnostics frame">
        <button type="button" aria-pressed={slot === 'a'} onClick={() => setSlot('a')}>Frame A {frames.a ? '●' : '○'}</button>
        <button type="button" aria-pressed={slot === 'b'} onClick={() => setSlot('b')}>Frame B {frames.b ? '●' : '○'}</button>
      </div>
      <div className="facility-lab-actions">
        <button type="button" disabled={!connected || busy} onClick={freezeCurrent}>Freeze live frame into {slot.toUpperCase()}</button>
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Open local image</button>
        <input ref={fileInput} aria-label="Open image for diagnostics" className="facility-lab-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={importFile}/>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {selected ? <>
        <p className="facility-lab-source"><strong>{selected.source}</strong> · {selected.sampledWidth} × {selected.sampledHeight} analyzed pixels · {selected.capturedAt}</p>
        <div className="facility-lab-controls" role="group" aria-label="Image inspection tool">
          <button type="button" aria-pressed={tool === 'region'} onClick={() => setTool('region')}>Draw region</button>
          <button type="button" aria-pressed={tool === 'ruler'} onClick={() => setTool('ruler')}>Pixel ruler</button>
          <button type="button" onClick={() => { setRegion(FULL_FRAME); setRuler(null); }}>Full frame</button>
        </div>
        <div className="facility-lab-image-stage" style={{ aspectRatio: selected.sampledWidth + '/' + selected.sampledHeight }}
          onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={stopPointer}
          onPointerCancel={() => { pointer.current = null; }}
          role="img" aria-label="Frozen local image. Drag to draw a region or pixel ruler. Numeric region fields are available below.">
          <img alt={'Frozen inspection frame from ' + selected.source} src={selected.preview} draggable="false"/>
          {region !== FULL_FRAME && <div className="facility-lab-roi" style={{left:pct(region.x*100),top:pct(region.y*100),width:pct(region.width*100),height:pct(region.height*100)}} aria-hidden="true"/>}
          {ruler && <svg className="facility-lab-ruler" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1={ruler.from.x * 100} y1={ruler.from.y * 100} x2={ruler.to.x * 100} y2={ruler.to.y * 100}/></svg>}
        </div>
        <fieldset className="facility-lab-region-fields"><legend>Analysis region (% of image)</legend>
          {[[ 'x', 'Left'], ['y', 'Top'], ['width', 'Width'], ['height', 'Height']].map(([key, label]) =>
            <label key={key}>{label}<input type="number" aria-label={'Diagnostics region ' + label.toLowerCase()} min="0" max="100" step="1"
              value={Math.round(region[key] * 100)} onChange={e => changeRegion(key, e.target.value)}/></label>)}
        </fieldset>
        <div className="facility-lab-metrics" aria-label="Measured image statistics">
          <div><small>Mean luma</small><strong>{metrics.mean.toFixed(1)} <sub>/255</sub></strong></div>
          <div><small>P05–P95 luma</small><strong>{metrics.low}–{metrics.high}</strong></div>
          <div><small>Shadow clipping</small><strong>{pct(metrics.shadowPercent)}</strong></div>
          <div><small>Highlight clipping</small><strong>{pct(metrics.highlightPercent)}</strong></div>
          <div><small>Sobel edge energy</small><strong>{pct(metrics.sobel)}</strong></div>
          <div><small>Selected area</small><strong>{metrics.pixels.toLocaleString()} <sub>px</sub></strong></div>
        </div>
        <div className="facility-lab-histogram"><span>Luma distribution · 16 bins</span>
          <div role="img" aria-label="Sixteen histogram bins from shadow to highlight">{metrics.histogram.map((n, index) =>
            <i key={index} title={'Bin ' + index + ': ' + n + ' pixels'} style={{height: Math.max(2, n / Math.max(1, ...metrics.histogram) * 100) + '%'}}/>)}</div>
          <small>0 black <span>255 white</span></small>
        </div>
        {rulerPixels !== null && <p className="facility-lab-result">Pixel ruler: <strong>{rulerPixels.toFixed(1)} px</strong> in the sampled image. Not a real-world length.</p>}
        {frames.a && frames.b && <p className="facility-lab-result">Frame A ↔ B: {difference ? <>
          <strong>{difference.meanAbsoluteDifference.toFixed(1)}/255</strong> mean absolute luma change · <strong>{pct(difference.changedPercent)}</strong> of ROI pixels changed by ≥{difference.threshold}/255
        </> : <>Different sampled dimensions; pixel-aligned comparison is unavailable.</>}</p>}
        <div className="facility-lab-actions">
          <a href={selected.preview} download={'facility-frame-' + (slot.toUpperCase()) + '.jpg'}>Save frozen frame</a>
          <button type="button" onClick={exportData}>Export metrics JSON</button>
          <button type="button" onClick={() => {setFrames({a:null,b:null}); setRegion(FULL_FRAME); setRuler(null); setError('');}}>Clear frames</button>
        </div>
        <p className="facility-lab-note">Luma uses channel-weighted 8-bit sRGB, not a light meter. Sobel edge energy is a detail proxy—not optical focus. Two-frame differences also respond to camera movement, compression, and lighting; they do not prove person/object motion. Sampling is downscaled to 720 px on the longest side, with no physical calibration.</p>
      </> : <p className="facility-lab-empty">No frame selected. Choose Frame A or B, then freeze the preview or open a PNG, JPEG or WebP from this computer.</p>}
    </div>
  </details>;
}
