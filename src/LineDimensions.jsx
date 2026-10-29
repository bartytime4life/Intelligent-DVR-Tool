import React, {useEffect,useRef,useState} from 'react';
import {formatDistance} from './facility-measurements.mjs';
import {editableLineLength,lineInputValue,setLineSegmentLength,setLineVertex,validateEditableLine} from './facility-line-edit.mjs';

const display = (value,units) => Number(lineInputValue(value,units).toFixed(4));
const inputValues=(points,segment,vertex,units)=>{
  try {
    const clean=validateEditableLine(points),s=Math.min(segment,clean.length-2),v=Math.min(vertex,clean.length-1),a=clean[s],b=clean[s+1],p=clean[v];
    return {length:display(Math.hypot(b[0]-a[0],b[1]-a[1]),units),east:display(p[0],units),north:display(p[1],units)};
  } catch {return {length:'',east:'',north:''};}
};
const sameValue=(a,b)=>a!=='' && b!=='' ? Number(a)===Number(b) : a===b;
export default function LineDimensions({points,onChange,units='metric',disabled=false,onDirtyChange}) {
  const [segment,setSegment]=useState(0),[vertex,setVertex]=useState(0);
  const initial=useRef(inputValues(points,0,0,units));
  const [length,setLength]=useState(initial.current.length),[east,setEast]=useState(initial.current.east),[north,setNorth]=useState(initial.current.north);
  const [error,setError]=useState(''),[status,setStatus]=useState('');
  let clean=[], invalid='';
  try {clean=validateEditableLine(points);} catch(e) {invalid=e.message;}
  const currentSegment=Math.min(segment,Math.max(0,clean.length-2)),currentVertex=Math.min(vertex,Math.max(0,clean.length-1));
  const expected=inputValues(points,currentSegment,currentVertex,units);
  const dirty=!invalid && (!sameValue(length,expected.length) || !sameValue(east,expected.east) || !sameValue(north,expected.north));
  const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
  const resetInputs=()=>{setLength(expected.length);setEast(expected.east);setNorth(expected.north);setError('');setStatus('');};
  useEffect(resetInputs,[points,currentSegment,currentVertex,units,invalid]);
  useEffect(()=>{dirtyCallback.current?.(dirty);},[dirty]);
  useEffect(()=>()=>dirtyCallback.current?.(false),[]);
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
    <label className="facility-field"><span>Segment</span><select aria-label="Line segment" disabled={disabled || dirty} value={currentSegment} onChange={e=>setSegment(Number(e.target.value))}>
      {clean.slice(1).map((p,i)=><option key={i} value={i}>{i+1} → {i+2} · {formatDistance(Math.hypot(p[0]-clean[i][0],p[1]-clean[i][1]),units)}</option>)}
    </select></label>
    <div className="facility-field-pair"><label className="facility-field"><span>Segment length<small>{suffix}</small></span><input aria-label="Segment length" disabled={disabled} type="number" min="0.0001" step="any" value={length} onChange={e=>setLength(e.target.value)}/></label>
      <button type="button" className="facility-secondary" disabled={disabled} onClick={()=>apply('segment')}>Apply segment length</button></div>
    <p className="facility-caption">The segment keeps its direction. Its endpoint and every later vertex move together. Review the updated path before saving.</p>
    <details className="facility-advanced"><summary>Edit a line vertex</summary>
      <label className="facility-field"><span>Vertex</span><select aria-label="Line vertex" disabled={disabled || dirty} value={currentVertex} onChange={e=>setVertex(Number(e.target.value))}>{clean.map((_,i)=><option key={i} value={i}>Vertex {i+1}</option>)}</select></label>
      <div className="facility-field-pair"><label className="facility-field"><span>Vertex east<small>{suffix}</small></span><input aria-label="Vertex east" disabled={disabled} type="number" step="any" value={east} onChange={e=>setEast(e.target.value)}/></label>
        <label className="facility-field"><span>Vertex north<small>{suffix}</small></span><input aria-label="Vertex north" disabled={disabled} type="number" step="any" value={north} onChange={e=>setNorth(e.target.value)}/></label></div>
      <button type="button" className="facility-secondary" disabled={disabled} onClick={()=>apply('vertex')}>Apply vertex position</button>
    </details>
    {dirty && <button type="button" className="facility-link" onClick={resetInputs}>Discard line edits</button>}
    {error && <p className="error" role="alert">{error}</p>}{status && <p className="facility-caption" role="status">{status}</p>}
  </section>;
}
