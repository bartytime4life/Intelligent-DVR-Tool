import React, {useRef} from 'react';
import {Plus, Stairs, ArrowClockwise, Check, Trash} from '@phosphor-icons/react';
import {STAIR_REFERENCE, stairDimensions, stairOnLevel} from './facility-stairs.mjs';
import {anchorStair,stairAnchors,stairDestination,turnStair,travelBearing,destinationLevels} from './facility-stair-placement.mjs';
import {displayLength, enteredLength} from './facility-shape-edit.mjs';
import './facility-stairs.css';

const formatDistance=(value,units)=>`${Number((value/(units==='imperial' ? .3048 : 1)).toFixed(3))} ${units==='imperial' ? 'ft' : 'm'}`;

function LengthField({label,value,onChange,units,min=.05,max=100,step='any'}) {
  const factor=units==='imperial' ? .3048 : 1, suffix=units==='imperial' ? 'ft' : 'm';
  // Only a changed number is converted, and stored to 0.1 mm, so feet display cannot drift the saved metres.
  // Limits round outward and snap, so the displayed minimum (0.984 ft) still means 0.3 m.
  const displayed=displayLength(value,units) ?? '', lo=Math.floor(min/factor*1e3)/1e3, hi=Math.ceil(max/factor*1e3)/1e3;
  function change(text){if(text==='')return onChange('');const n=Number(text);let metres=enteredLength(n,value,units);if(metres<min && n>=lo)metres=min;if(metres>max && n<=hi)metres=max;onChange(metres);}
  return <label className="facility-field"><span>{label}<small>{suffix}</small></span><input aria-label={`${label} (${suffix})`} type="number" min={lo} max={hi} step={step} required value={displayed} onChange={e=>change(e.target.value)}/></label>;
}

export function StairDestination({building,item,onChange,onMap=false}) {
  const levels=destinationLevels(building,item.fromLevel);
  return <label className="facility-field stair-destination"><span>{onMap?'Go to':'Destination floor'}</span><select aria-label={onMap?'Stair destination on map':'Stair destination'} disabled={!['tread','landing','risers','bearing','x','y'].every(k=>Number.isFinite(item[k]))} value={item.toLevel} onChange={e=>onChange(stairDestination(item,building,Number(e.target.value)))}>
    {!levels.includes(item.toLevel) && <option value={item.toLevel} disabled>Level {item.toLevel+1} · open floor</option>}
    {levels.map(n=><option key={n} value={n}>Level {n+1} · {n>item.fromLevel?'up':'down'}</option>)}</select></label>;
}

export default function FacilityStairs({plan,building,floor=0,item:draft,units,ready,disabled,dirty,issue,placing,onStart,onSuggest,onAddLevel,onChange,onSave,onDiscard,onSelect,onRemove}) {
  const fixedStart=useRef(null);
  const numeric=draft && ['width','tread','landing','risers','bearing','x','y'].every(k=>Number.isFinite(draft[k])) && draft.risers>=2;
  const dims=numeric ? stairDimensions(draft,building) : null;
  if(dims)fixedStart.current=stairAnchors(draft,building)[0];
  const saved=plan.stairs.some(s=>s.id===draft?.id);
  const stairs=plan.stairs.filter(s=>s.buildingId===building?.id && stairOnLevel(s,floor));
  const available=building && !building.openFloors?.includes(floor) && destinationLevels(building,floor).length>0 && plan.stairs.length<100;
  function change(key,value) {
    let next={...draft,[key]:value};
    if(['tread','risers','landing','bearing'].includes(key) && fixedStart.current && ['tread','risers','landing','bearing'].every(k=>Number.isFinite(next[k])))
      next=anchorStair(next,building,fixedStart.current);
    onChange(next);
  }
  return <section className="facility-stairs" aria-label="Stair planning">
    <div className="facility-stair-heading"><Stairs/><div><h3>Stairs</h3><p>Click a start landing, then choose its destination floor.</p></div></div>
    {!dirty && <div className="facility-action-row"><button type="button" className="facility-primary" disabled={disabled || !ready || !available || placing} onClick={onStart}><Plus/>{placing?'Click a start landing':'Place stairs'}</button>
      {available && <button type="button" className="facility-secondary" disabled={disabled || placing} onClick={onSuggest}>Suggest a position</button>}</div>}
    {!building ? <p className="facility-caption">Add a building to place stairs.</p> : building.floors===1 ? <div className="stair-next-level"><p>This building has one floor. Add a level for the stairs to reach.</p><button type="button" className="facility-secondary" disabled={disabled || dirty} onClick={onAddLevel}><Plus/>Add destination level</button></div>
      : !available && <p className="facility-caption">{plan.stairs.length>=100?'This plan has reached its 100-stair limit.':'Choose a start and destination with solid floor for both landings.'}</p>}
    {!!stairs.length && <div className="facility-item-list compact">{stairs.map(s=><button key={s.id} disabled={disabled || placing || dirty} className={draft?.id===s.id?'selected':''} onClick={()=>onSelect(s.id,'stair')}><Stairs/><span>{s.name}<small>Level {s.fromLevel+1} → Level {s.toLevel+1}</small></span></button>)}</div>}
    {draft && <form id="facility-stair-form" noValidate className="facility-stair-form" onSubmit={onSave}>
      <div className="stair-trip"><strong>From Level {draft.fromLevel+1}</strong><span aria-hidden="true">→</span><StairDestination building={building} item={draft} onChange={onChange}/></div>
      <p className="facility-caption">Drag <strong>Start</strong> to move the whole flight. Drag <strong>Turn</strong> to rotate around the start. Hold Shift to turn in 15° steps.</p>
      {dims && <button type="button" className="facility-secondary" onClick={()=>onChange(turnStair(draft,building,travelBearing(draft)+90))}><ArrowClockwise/>Turn 90°</button>}
      {issue && <p className="facility-stair-warnings" role="alert">{issue}</p>}
      {dims && <div className="facility-stair-summary"><strong>{formatDistance(dims.rise,units)} {draft.toLevel>draft.fromLevel?'up':'down'} · {formatDistance(dims.run,units)} run</strong><span>{draft.risers} equal risers × {formatDistance(dims.riser,units)} · two landings</span></div>}
      <details className="facility-stair-reference stair-exact"><summary>Stair dimensions &amp; position</summary>
      <label className="facility-field"><span>Stair name</span><input aria-label="Stair name" required maxLength={100} value={draft.name} onChange={e=>change('name',e.target.value)}/></label>
      <div className="facility-field-pair"><LengthField label="Stair clear width" value={draft.width} units={units} min={.3} max={30} onChange={value=>change('width',value)}/><LengthField label="Stair tread depth" value={draft.tread} units={units} min={.05} max={2} onChange={value=>change('tread',value)}/></div>
      <div className="facility-field-pair"><label className="facility-field"><span>Riser count</span><input aria-label="Stair riser count" type="number" min={2} max={100} step="1" required value={draft.risers} onChange={e=>change('risers',e.target.value==='' ? '' : Number(e.target.value))}/></label><LengthField label="Stair landing depth" units={units} value={draft.landing} min={.3} max={10} onChange={value=>change('landing',value)}/></div>
      <button type="button" className="facility-link" onClick={()=>change('risers',Math.min(100,Math.max(2,Math.ceil(stairDimensions(draft,building).rise/STAIR_REFERENCE.maxRiser))))}>Calculate risers using 7 in maximum</button>
      {dims && <LengthField label="Stair reservation length" units={units} value={dims.length} min={.65} max={218} onChange={value=>change('tread',typeof value==='number' ? (value-2*draft.landing)/(draft.risers-1) : '')}/>}
      <div className="facility-field-pair"><LengthField label="Stair east" units={units} value={draft.x} min={-2000} max={2000} onChange={value=>change('x',value)}/><LengthField label="Stair north" units={units} value={draft.y} min={-2000} max={2000} onChange={value=>change('y',value)}/></div>
      <label className="facility-field"><span>Direction uphill<small>° from north</small></span><input aria-label="Stair uphill bearing" type="number" required min={0} max={359.99} step="any" value={draft.bearing} onChange={e=>change('bearing',e.target.value==='' ? '' : Number(e.target.value))}/></label>
      </details>
      {dims?.warnings.length>0 && <div className="facility-stair-warnings" role="status"><strong>Review against the reference</strong><ul>{dims.warnings.map(text=><li key={text}>{text}</li>)}</ul></div>}
      <p className="facility-caption">Floor openings are edited separately. {Math.abs(draft.toLevel-draft.fromLevel)>1?'Plan a cutout on each crossed floor. ':''}Moving the stairs leaves existing openings in place.</p>
      {dirty && <div className="facility-action-row"><button className="facility-primary" type="submit" disabled={disabled || !!issue}><Check/>Save stair</button><button className="facility-secondary" type="button" onClick={onDiscard}>Discard stair draft</button></div>}
      {saved && !dirty && <button className="facility-delete" type="button" disabled={disabled} onClick={onRemove}><Trash/>Remove stair<small>Undo available</small></button>}
    </form>}
    <details className="facility-stair-reference"><summary>Stair sizing reference and clearances</summary><p><a href={STAIR_REFERENCE.url} target="_blank" rel="noreferrer">{STAIR_REFERENCE.title}</a></p>
      <p>General defaults: 44 in clear width, 4–7 in risers, 11 in minimum tread, 80 in minimum headroom and 12 ft maximum rise per flight. Straight-run landing depth follows the stair width, with the general 48 in cap.</p>
      <p>The model reserves clear stair and landing space. Add wall, handrail, guard and door-swing space when sizing the stair room. Headroom and floor openings are not automatically verified.</p>
      <p>Create or draw an upper-floor opening separately, retaining a solid arrival landing. Review guards at open edges, support structure, fire/smoke separation, accessible routes and exit capacity against the locally adopted code and actual occupancy. This is a layout estimate, not a compliance or construction approval.</p>
    </details>
  </section>;
}
