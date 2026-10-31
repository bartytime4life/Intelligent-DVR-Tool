import React,{useEffect,useState} from 'react';
import {shapeBounds,resizeShape,moveShape,resizeEdge,rotateShape,unitLabel,displayLength,toMetres} from './facility-shape-edit.mjs';
import {polygonMeasurements,formatArea,formatDistance} from './facility-measurements.mjs';
// Text stays local until Enter or blur, so partial entries never reshape the draft.
function DimensionInput({label,unit,value,min,disabled,onApply,resetAfter=false}) {
  const shown=String(value),[text,setText]=useState(shown);
  useEffect(()=>setText(shown),[shown]);
  const apply=()=>{if(text.trim()!=='' && Number(text)===Number(shown))return;if(onApply(text) && resetAfter)setText(shown);};
  return <label className="facility-field"><span>{label}<small>{unit}</small></span><input aria-label={label} disabled={disabled} type="number" step="any" min={min} value={text}
    onChange={e=>setText(e.target.value)} onBlur={apply}
    onKeyDown={e=>{if(e.key==='Enter' && !(text.trim()!=='' && Number(text)===Number(shown))){e.preventDefault();apply();}else if(e.key==='Escape')setText(shown);}}/></label>;
}
export default function ShapeDimensions({shape,onChange,units='metric',disabled=false}) {
  const [error,setError]=useState(''),[edge,setEdge]=useState(0);
  if(!shape?.footprint)return null;
  const bounds=shapeBounds(shape),measure=polygonMeasurements(shape.footprint,shape.holes || []), index=Math.min(edge,shape.footprint.length-2),a=shape.footprint[index],b=shape.footprint[index+1];
  const apply=fn=>{try{onChange(fn());setError('');return true;}catch(e){setError(e.message);return false;}};
  const parse=text=>text.trim()==='' ? NaN : Number(text);
  const field=(label,value,action,min)=><DimensionInput label={label} unit={unitLabel(units)} disabled={disabled} min={min} value={displayLength(value,units)} onApply={text=>apply(()=>action(toMetres(parse(text),units)))}/>;
  return <section className="facility-shape-dimensions" aria-label="Edit shape dimensions"><h3>Shape dimensions</h3>
    <div className="facility-field-pair">{field('Shape east-west span',bounds.width,v=>resizeShape(shape,'width',v),.01)}{field('Shape north-south span',bounds.depth,v=>resizeShape(shape,'depth',v),.01)}</div>
    <div className="facility-field-pair">{field('Shape center east',bounds.x,v=>moveShape(shape,'x',v))}{field('Shape center north',bounds.y,v=>moveShape(shape,'y',v))}</div>
    <DimensionInput label="Rotate shape by" unit="° counter-clockwise" disabled={disabled} value={0} resetAfter onApply={text=>apply(()=>rotateShape(shape,parse(text)))}/>
    <p className="facility-caption">{formatArea(measure.area,units)} · boundary {formatDistance(measure.perimeter,units)}. Press Enter or leave a field to apply it; Save checks containment and intersections.{shape.floors!==undefined && ' Moving or rotating a building carries its rooms, floor items, indoor zones, labels and wall-mounted cameras.'}</p>
    <details className="facility-advanced"><summary>Set an individual edge length</summary>
      <label className="facility-field"><span>Boundary edge</span><select aria-label="Boundary edge" value={index} onChange={e=>setEdge(Number(e.target.value))}>{shape.footprint.slice(1).map((_,i)=><option key={i} value={i}>Edge {i+1}</option>)}</select></label>
      {field('Boundary edge length',Math.hypot(b[0]-a[0],b[1]-a[1]),v=>resizeEdge(shape,index,v),.01)}
      <p className="facility-caption">Moves the end corner along this edge. Neighboring edges change too; review before saving.</p>
    </details>{error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
