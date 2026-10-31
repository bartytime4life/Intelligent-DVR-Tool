import React, {useEffect, useState} from 'react';
import {Plus, ArrowUpRight, Check, Trash} from '@phosphor-icons/react';
import {STAIR_REFERENCE, defaultStair, stairDimensions} from './facility-stairs.mjs';
import {polygonContains, ringsOverlap} from './facility.mjs';
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

export default function FacilityStairs({plan,building,floor=0,commit,selectedId,onSelect,disabled=false,onDirtyChange,units='metric'}) {
  const [draft,setDraft]=useState(null), [error,setError]=useState('');
  const saved=(plan.stairs || []).find(s=>s.id===selectedId);
  useEffect(()=>{setDraft(saved ? {...saved} : null);setError('');},[saved]);
  const dirty=!!(saved && draft && JSON.stringify(saved)!==JSON.stringify(draft));
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  const activeBuilding=plan.buildings.find(b=>b.id===(draft?.buildingId || building?.id));
  const numeric=draft && [draft.width,draft.tread,draft.risers,draft.landing,draft.fromLevel].every(v=>typeof v==='number' && Number.isFinite(v)) && draft.risers>=2;
  const dims=numeric && activeBuilding ? stairDimensions(draft,activeBuilding) : null;
  const stairs=(plan.stairs || []).filter(s=>s.buildingId===building?.id);
  function change(key,value){setDraft(d=>({...d,[key]:value}));setError('');}
  function add(){try{const stair=defaultStair(building,floor,footprint=>polygonContains(building.footprint,footprint) && !(building.holes || []).some(hole=>ringsOverlap(hole,footprint)));if(commit({...plan,stairs:[...(plan.stairs || []),stair]},'Stair added — review fit, upper opening and clearances'))onSelect?.(stair.id,'stair');}catch(e){setError(e.message);}}
  function save(e){e.preventDefault();if(!draft)return;if(commit({...plan,stairs:(plan.stairs || []).map(s=>s.id===draft.id ? draft : s)},'Stair dimensions saved — planning guidance only'))setError('');}
  function remove(){if(commit({...plan,stairs:(plan.stairs || []).filter(s=>s.id!==selectedId)},'Stair removed — floor openings stay explicit; Undo available')){setDraft(null);onSelect?.('','stair');}}
  return <section className="facility-stairs" aria-label="Stair planning">
    <div className="facility-stair-heading"><ArrowUpRight/><div><h3>Stairs between levels</h3><p>Dimension a straight flight from the modeled level rise.</p></div></div>
    <button className="facility-secondary" disabled={disabled || dirty || !building || building.floors<2 || (plan.stairs || []).length>=100} onClick={add}><Plus/>Add straight stair</button>
    {(!building || building.floors<2) && <p className="facility-caption">Add an upper level first, then reserve space for the stair and landings.</p>}
    <div className="facility-item-list compact">{stairs.map(stair=><button key={stair.id} disabled={disabled || dirty && stair.id!==selectedId} className={selectedId===stair.id ? 'selected' : ''} onClick={()=>onSelect?.(stair.id,'stair')}><ArrowUpRight/><span>{stair.name}<small>Level {stair.fromLevel+1} → {stair.toLevel+1}</small></span></button>)}</div>
    {draft && saved?.id===draft.id && <form noValidate className="facility-stair-form" onSubmit={save}>
      <label className="facility-field"><span>Stair name</span><input aria-label="Stair name" required maxLength={100} value={draft.name} onChange={e=>change('name',e.target.value)}/></label>
      <label className="facility-field"><span>Stair levels</span><select aria-label="Stair levels" value={draft.fromLevel} onChange={e=>{const fromLevel=Number(e.target.value);setDraft(d=>({...d,fromLevel,toLevel:fromLevel+1}));}}>{Array.from({length:Math.max(0,(activeBuilding?.floors || 1)-1)},(_,level)=><option key={level} value={level}>Level {level+1} → Level {level+2}</option>)}</select></label>
      {dims && <div className="facility-stair-summary" role="status"><strong>{formatDistance(dims.rise,units)} level rise</strong><span>{draft.risers} equal risers × {formatDistance(dims.riser,units)} ({(dims.riser/.0254).toFixed(2)} in)</span><span>{draft.risers-1} treads · {formatDistance(dims.run,units)} flight run</span><span>Clear reservation {formatDistance(dims.width,units)} × {formatDistance(dims.length,units)} including two landings</span></div>}
      <div className="facility-field-pair"><LengthField label="Stair clear width" value={draft.width} units={units} min={.3} max={30} onChange={value=>change('width',value)}/><LengthField label="Stair tread depth" value={draft.tread} units={units} min={.05} max={2} onChange={value=>change('tread',value)}/></div>
      <div className="facility-field-pair"><label className="facility-field"><span>Riser count</span><input aria-label="Stair riser count" type="number" min={2} max={100} step="1" required value={draft.risers} onChange={e=>change('risers',e.target.value==='' ? '' : Number(e.target.value))}/></label><LengthField label="Stair landing depth" units={units} value={draft.landing} min={.3} max={10} onChange={value=>change('landing',value)}/></div>
      <button type="button" className="facility-link" onClick={()=>change('risers',Math.min(100,Math.max(2,Math.ceil(((activeBuilding.height-(activeBuilding.base || 0))/activeBuilding.floors)/STAIR_REFERENCE.maxRiser))))}>Calculate risers using 7 in maximum</button>
      {dims && <LengthField label="Stair reservation length" units={units} value={dims.length} min={.65} max={218} onChange={value=>change('tread',typeof value==='number' ? (value-2*draft.landing)/(draft.risers-1) : '')}/>}
      <div className="facility-field-pair"><LengthField label="Stair east" units={units} value={draft.x} min={-2000} max={2000} onChange={value=>change('x',value)}/><LengthField label="Stair north" units={units} value={draft.y} min={-2000} max={2000} onChange={value=>change('y',value)}/></div>
      <label className="facility-field"><span>Direction uphill<small>° from north</small></span><input aria-label="Stair uphill bearing" type="number" required min={0} max={359.99} step="any" value={draft.bearing} onChange={e=>change('bearing',e.target.value==='' ? '' : Number(e.target.value))}/></label>
      {dims?.warnings.length>0 && <div className="facility-stair-warnings" role="status"><strong>Review against the reference</strong><ul>{dims.warnings.map(text=><li key={text}>{text}</li>)}</ul></div>}
      <button className="facility-primary" type="submit" disabled={disabled}>Save stair<Check/></button>
      {dirty && <div className="facility-unsaved"><span>Stair draft is unsaved</span><button type="button" onClick={()=>setDraft({...saved})}>Discard stair draft</button></div>}
      <button className="facility-delete" type="button" disabled={disabled} onClick={remove}><Trash/>Remove stair<small>Undo available</small></button>
    </form>}
    <details className="facility-stair-reference"><summary>Stair sizing reference and clearances</summary><p><a href={STAIR_REFERENCE.url} target="_blank" rel="noreferrer">{STAIR_REFERENCE.title}</a></p>
      <p>General defaults: 44 in clear width, 4–7 in risers, 11 in minimum tread, 80 in minimum headroom and 12 ft maximum rise per flight. Straight-run landing depth follows the stair width, with the general 48 in cap.</p>
      <p>The model reserves clear stair and landing space. Add wall, handrail, guard and door-swing space when sizing the stair room. Headroom and floor openings are not automatically verified.</p>
      <p>Create or draw an upper-floor opening separately, retaining a solid arrival landing. Review guards at open edges, support structure, fire/smoke separation, accessible routes and exit capacity against the locally adopted code and actual occupancy. This is a layout estimate, not a compliance or construction approval.</p>
    </details>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
