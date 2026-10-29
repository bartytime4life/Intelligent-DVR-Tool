import React,{useState} from 'react';
import {shapeBounds,resizeShape,moveShape,resizeEdge,unitFactor,unitLabel,displayLength} from './facility-shape-edit.mjs';
import {polygonMeasurements,formatArea,formatDistance} from './facility-measurements.mjs';
export default function ShapeDimensions({shape,onChange,units='metric',disabled=false}) {
  const [error,setError]=useState(''),[edge,setEdge]=useState(0);
  if(!shape?.footprint)return null;
  const bounds=shapeBounds(shape),measure=polygonMeasurements(shape.footprint,shape.holes || []), index=Math.min(edge,shape.footprint.length-2),a=shape.footprint[index],b=shape.footprint[index+1];
  const apply=fn=>{try{onChange(fn());setError('');}catch(e){setError(e.message);}};
  const field=(label,value,action,min)=> <label className="facility-field"><span>{label}<small>{unitLabel(units)}</small></span><input aria-label={label} disabled={disabled} type="number" step="any" min={min} value={displayLength(value,units)} onChange={e=>{if(e.target.value!=='')apply(()=>action(Number(e.target.value)*unitFactor(units)));}}/></label>;
  return <section className="facility-shape-dimensions" aria-label="Edit shape dimensions"><h3>Shape dimensions</h3>
    <div className="facility-field-pair">{field('Shape east-west span',bounds.width,v=>resizeShape(shape,'width',v),.01)}{field('Shape north-south span',bounds.depth,v=>resizeShape(shape,'depth',v),.01)}</div>
    <div className="facility-field-pair">{field('Shape center east',bounds.x,v=>moveShape(shape,'x',v))}{field('Shape center north',bounds.y,v=>moveShape(shape,'y',v))}</div>
    <p className="facility-caption">{formatArea(measure.area,units)} · boundary {formatDistance(measure.perimeter,units)}. Save to apply; containment and intersections are checked.</p>
    <details className="facility-advanced"><summary>Set an individual edge length</summary>
      <label className="facility-field"><span>Boundary edge</span><select aria-label="Boundary edge" value={index} onChange={e=>setEdge(Number(e.target.value))}>{shape.footprint.slice(1).map((_,i)=><option key={i} value={i}>Edge {i+1}</option>)}</select></label>
      {field('Boundary edge length',Math.hypot(b[0]-a[0],b[1]-a[1]),v=>resizeEdge(shape,index,v),.01)}
      <p className="facility-caption">Moves the end corner along this edge. Neighboring edges change too; review before saving.</p>
    </details>{error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
