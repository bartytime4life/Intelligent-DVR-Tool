import React, {useEffect,useState} from 'react';
import {formatDistance} from './facility-measurements.mjs';
import {editableLineLength,lineInputValue,setLineSegmentLength,setLineVertex,validateEditableLine} from './facility-line-edit.mjs';

const display = (value,units) => Number(lineInputValue(value,units).toFixed(4));
export default function LineDimensions({points,onChange,units='metric',disabled=false}) {
  const [segment,setSegment]=useState(0),[vertex,setVertex]=useState(0);
  const [length,setLength]=useState(''),[east,setEast]=useState(''),[north,setNorth]=useState('');
  const [error,setError]=useState(''),[status,setStatus]=useState('');
  let clean=[], invalid='';
  try {clean=validateEditableLine(points);} catch(e) {invalid=e.message;}
  const currentSegment=Math.min(segment,Math.max(0,clean.length-2)),currentVertex=Math.min(vertex,Math.max(0,clean.length-1));
  useEffect(()=>{
    if(invalid) return;
    const a=points[currentSegment],b=points[currentSegment+1],p=points[currentVertex];
    setLength(display(Math.hypot(b[0]-a[0],b[1]-a[1]),units));
    setEast(display(p[0],units));setNorth(display(p[1],units));setError('');setStatus('');
  },[points,currentSegment,currentVertex,units,invalid]);
  if(invalid) return <p className="facility-caption">{invalid}</p>;
  const suffix=units==='imperial' ? 'ft' : 'm';
  const parse=value=>typeof value==='number' ? value : value.trim()==='' ? NaN : Number(value);
  function apply(kind) {
    try {
      const next=kind==='segment' ? setLineSegmentLength(points,currentSegment,parse(length),units) : setLineVertex(points,currentVertex,parse(east),parse(north),units);
      if(onChange(next) === false) return;
      setError('');setStatus(kind==='segment' ? 'Segment updated; later segments keep their lengths.' : 'Vertex position updated.');
    } catch(e) {setError(e.message);setStatus('');}
  }
  return <section className="facility-line-dimensions" aria-label="Line measurements and editing">
    <p className="facility-caption"><strong>Total line length: {formatDistance(editableLineLength(points),units)}</strong> · {clean.length-1} segments</p>
    <label className="facility-field"><span>Segment</span><select aria-label="Line segment" disabled={disabled} value={currentSegment} onChange={e=>setSegment(Number(e.target.value))}>
      {clean.slice(1).map((p,i)=><option key={i} value={i}>{i+1} → {i+2} · {formatDistance(Math.hypot(p[0]-clean[i][0],p[1]-clean[i][1]),units)}</option>)}
    </select></label>
    <div className="facility-field-pair"><label className="facility-field"><span>Segment length<small>{suffix}</small></span><input aria-label="Segment length" disabled={disabled} type="number" min="0.0001" step="any" value={length} onChange={e=>setLength(e.target.value)}/></label>
      <button type="button" className="facility-secondary" disabled={disabled} onClick={()=>apply('segment')}>Apply segment length</button></div>
    <p className="facility-caption">The segment keeps its direction. Its endpoint and every later vertex move together. Review the updated path before saving.</p>
    <details className="facility-advanced"><summary>Edit a line vertex</summary>
      <label className="facility-field"><span>Vertex</span><select aria-label="Line vertex" disabled={disabled} value={currentVertex} onChange={e=>setVertex(Number(e.target.value))}>{clean.map((_,i)=><option key={i} value={i}>Vertex {i+1}</option>)}</select></label>
      <div className="facility-field-pair"><label className="facility-field"><span>Vertex east<small>{suffix}</small></span><input aria-label="Vertex east" disabled={disabled} type="number" step="any" value={east} onChange={e=>setEast(e.target.value)}/></label>
        <label className="facility-field"><span>Vertex north<small>{suffix}</small></span><input aria-label="Vertex north" disabled={disabled} type="number" step="any" value={north} onChange={e=>setNorth(e.target.value)}/></label></div>
      <button type="button" className="facility-secondary" disabled={disabled} onClick={()=>apply('vertex')}>Apply vertex position</button>
    </details>
    {error && <p className="error" role="alert">{error}</p>}{status && <p className="facility-caption" role="status">{status}</p>}
  </section>;
}
