import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowClockwise, Check, MapPin} from '@phosphor-icons/react';
import {Numeric} from './FacilityStarter.jsx';
import {SHAPES, shapeFootprint} from './facility-starter.mjs';
import {displayLength, enteredLength, localizeLengths, suggestBuildingOffset, translateShape, unitFactor, unitLabel} from './facility-shape-edit.mjs';
import {formatArea} from './facility-measurements.mjs';
import {polygonArea} from './facility.mjs';

const defaults = {shape:'Rectangle', width:32, depth:40, wing:8, angle:0, height:8, floors:1, position:null};
const icons = SHAPES.map(name => ({
  name, points:shapeFootprint(name, 32, 26, 7).map(([x,y]) => [x,-y].join(',')).join(' ')
}));

export default function BuildingShapePicker({open, onOpen, buildings, near, units, onUnits, disabled, ready, picking, onPick, onPreview, onDirtyChange, add}) {
  const [values,setValues] = useState(defaults), baseline = useRef(defaults);
  const {shape,width,depth,wing,angle,height,floors,position} = values;
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline.current);
  const unit = unitLabel(units), factor = unitFactor(units);
  const set = (key,value) => setValues(v => ({...v,[key]:value}));
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty,onDirtyChange]);

  const {preview,center,error} = useMemo(() => {
    try {
      const base = {footprint:shapeFootprint(shape,width,depth,wing,angle)};
      const center = position ?? suggestBuildingOffset(base,buildings,near);
      if (!center) throw Error('Choose a position in the coordinates below. There is no suggested space for this outline.');
      if (!center.every(Number.isFinite)) throw Error('Enter both position coordinates.');
      const outline = translateShape(base,...center);
      if (outline.footprint.some(p => p.some(n => Math.abs(n) > 2000))) throw Error('Keep the entire outline within 2,000 m of the site origin on both axes.');
      return {preview:{shape:outline,center,width,depth},center};
    } catch (e) { return {error:e.message,center:position ?? [0,0]}; }
  }, [shape,width,depth,wing,angle,position,buildings,near]);

  useEffect(() => {
    onPreview(open && !disabled ? preview ?? null : null);
    return () => onPreview(null);
  }, [open,disabled,preview,onPreview]);

  function addShape(e) {
    e.preventDefault();
    if (disabled || picking || !preview) return;
    if (add({...preview.shape,name:shape + ' building',height,floors})) {
      const next = {...values,position:null};
      baseline.current = next;
      setValues(next);
      onOpen(false);
    }
  }
  function distance(label,value,change,min,max) {
    return <Numeric label={label + ' (' + unit + ')'} value={displayLength(value,units)}
      min={Math.floor(min / factor * 1000)/1000} max={Math.ceil(max / factor * 1000)/1000}
      onChange={n=>change(n === '' ? '' : enteredLength(n,value,units))}/>;
  }
  return <section className="building-picker">
    <button type="button" className="building-picker-toggle" aria-expanded={open} disabled={disabled || picking}
      onClick={()=>onOpen(!open)}><span>Common building shapes</span><span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {!open && dirty && <p className="building-pending">Reopen to finish or discard your shape.</p>}
    {open && <form id="facility-new-building" onSubmit={addShape} onReset={e=>{e.preventDefault();setValues(baseline.current);}}><fieldset disabled={disabled || picking}>
      <legend>Choose a footprint</legend>
      <div className="building-shapes" role="group" aria-label="Building shape">{icons.map(icon =>
        <button type="button" key={icon.name} aria-pressed={shape===icon.name} onClick={()=>set('shape',icon.name)}>
          <svg aria-hidden="true" viewBox="-20 -17 40 34"><polygon points={icon.points}/></svg>
          <span>{icon.name}</span>{shape===icon.name && <Check className="building-shape-check" aria-hidden="true"/>}
        </button>)}</div>
      <div className="facility-field-pair">{distance('Shape width',width,v=>set('width',v),2,1000)}{distance('Shape depth',depth,v=>set('depth',v),2,1000)}</div>
      {['L wing','T wing','U wing','Cross'].includes(shape) && distance('Wing thickness',wing,v=>set('wing',v),1,499)}
      <button type="button" className="building-quarter-turn facility-link" onClick={()=>set('angle',((Number(angle) || 0) - 90) % 360)}>
        <ArrowClockwise aria-hidden="true"/>Rotate 90°</button>
      <details className="facility-advanced"><summary>Height, floors &amp; exact position</summary>
        <div className="facility-field-pair">{distance('Shape height',height,v=>set('height',v),1,150)}<Numeric label="Shape floors" value={floors} onChange={v=>set('floors',v)} min={1} max={40} step="1"/></div>
        <Numeric label="Shape rotation (degrees)" value={angle} onChange={v=>set('angle',v)} min={-360} max={360}/>
        <div className="facility-field-pair">{distance('Shape east',center[0],v=>set('position',[v,center[1]]),-2000,2000)}{distance('Shape north',center[1],v=>set('position',[center[0],v]),-2000,2000)}</div>
        <label className="facility-field"><span>Input units</span><select aria-label="Shape input units" value={units} onChange={e=>onUnits(e.target.value)}><option value="metric">Meters</option><option value="imperial">Feet</option></select></label>
        {position && <button type="button" className="facility-link" onClick={()=>set('position',null)}>Use suggested position</button>}
      </details>
      {error ? <p className="error" role="alert">{localizeLengths(error,units)}</p> :
        <p className="building-placement-note"><strong>{formatArea(polygonArea(preview.shape.footprint),units)} footprint</strong>
        {position ? 'Using your chosen position.' : buildings.length ? 'Space suggested beside your buildings.' : 'Centered at the site origin.'} Dimensions are editable estimates.</p>}
      <div className="facility-action-row"><button className="facility-secondary" type="button" disabled={!preview || !ready} onClick={e=>onPick(preview,point=>set('position',point),e.currentTarget)}><MapPin/>Pick on map</button></div>
    </fieldset></form>}
  </section>;
}
