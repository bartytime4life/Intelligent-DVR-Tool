import React,{useState} from 'react';
import {Polygon,Path,Trash,Check} from '@phosphor-icons/react';
import {createFloorOpening,ceilingOpenings} from './facility.mjs';
import {stairRunFootprint} from './facility-stairs.mjs';
import ShapeDimensions from './ShapeDimensions.jsx';
import LineDimensions from './LineDimensions.jsx';
import './floor-geometry.css';

export default function FloorGeometry({plan,building,floor,selected,draft,onDraft,onSelect,commit,onDraw,disabled=false,ready,units='metric',pending=false,onPendingChange}) {
  const [error,setError]=useState('');
  if(!building)return null;
  const openings=(plan.openings || []).filter(o=>o.buildingId===building.id && o.level===floor);
  const paths=(plan.paths || []).filter(o=>o.buildingId===building.id && o.level===floor);
  const open=(building.openFloors || []).includes(floor);
  const ownDraft=['opening','path'].includes(selected.kind) && draft?.id===selected.id;
  const item=ownDraft && draft.buildingId===building.id && draft.level===floor ? draft : null;
  const ownDirty=item && JSON.stringify(item)!==JSON.stringify((plan[selected.kind==='opening'?'openings':'paths'] || []).find(o=>o.id===item.id));
  const locked=disabled && !ownDirty;
  const room=selected.kind==='room' && plan.rooms.find(r=>r.id===selected.id && r.buildingId===building.id && r.level===floor);
  const stair=selected.kind==='stair' && (plan.stairs || []).find(s=>s.id===selected.id && s.buildingId===building.id);
  function addOpening(footprint,level,name,removeRoom=false) {
    try {
      const opening=createFloorOpening(plan,building.id,level,footprint,name);
      const next={...plan,openings:[...(plan.openings || []),opening],...(removeRoom ? {rooms:plan.rooms.filter(r=>r.id!==room.id)} : {})};
      if(commit(next,'Floor opening saved; ceiling below updated — Undo available')) {onSelect(opening.id,'opening');setError('');}
    } catch(e){setError(e.message);}
  }
  function toggleFloor(){
    const openFloors=open ? (building.openFloors || []).filter(level=>level!==floor) : [...(building.openFloors || []),floor].sort((a,b)=>a-b);
    if(commit({...plan,buildings:plan.buildings.map(b=>b.id===building.id?{...b,openFloors}:b)},open?'Solid floor restored; partial openings retained':'Entire level opened; ceiling below updated'))setError('');
  }
  function save(e){e.preventDefault();const key=selected.kind==='opening'?'openings':'paths';if(commit({...plan,[key]:(plan[key] || []).map(o=>o.id===item.id?item:o)},'Floor geometry saved; ceiling below updated'))setError('');}
  function remove(){const key=selected.kind==='opening'?'openings':'paths';if(commit({...plan,[key]:(plan[key] || []).filter(o=>o.id!==item.id)},selected.kind==='opening'?'Opening closed with solid floor — Undo available':'Path removed — Undo available')){onSelect(building.id,'building');setError('');}}
  return <section className="facility-floor-geometry" aria-label="Floor surfaces and pathways">
    <h3>Floor surface · Level {floor+1}</h3>
    <label className="facility-checkbox"><input type="checkbox" checked={!open} disabled={disabled || pending} onChange={toggleFloor}/>Solid floor at this level</label>
    <p className="facility-caption">{open?'This whole level is open air. The floor slab and the ceiling beneath it are removed.':'Cut out an atrium, stairwell or other open area. The same cutout opens the ceiling of the level below.'} Partial cutouts stay saved when toggling the entire floor.</p>
    <div className="facility-action-row"><button className="facility-secondary" disabled={disabled || pending || !ready || open} onClick={()=>onDraw('opening')}><Polygon/>Draw floor opening</button><button className="facility-secondary" disabled={disabled || pending || !ready || open} onClick={()=>onDraw('floor-path')}><Path/>Draw floor pathway</button></div>
    {room && <button className="facility-secondary" disabled={disabled || pending || open} onClick={()=>addOpening(room.footprint,floor,room.name+' opening',true)}>Convert selected room to opening</button>}
    {stair && <button className="facility-secondary" disabled={disabled || pending || (building.openFloors || []).includes(stair.toLevel)} onClick={()=>addOpening(stairRunFootprint(stair,building),stair.toLevel,stair.name+' upper opening')}>Cut upper floor over stair run</button>}
    <p className="facility-caption">Pathways stay inside solid floor; openings cannot be crossed. Stair cutouts reserve the flight run and keep both landings. Verify headroom and guards on site.</p>
    <div className="facility-item-list compact">{[...openings.map(o=>({...o,kind:'opening'})),...paths.map(o=>({...o,kind:'path'}))].map(o=><button key={o.id} disabled={disabled || pending} className={selected.id===o.id?'selected':''} onClick={()=>onSelect(o.id,o.kind)}>{o.kind==='opening'?<Polygon/>:<Path/>}<span>{o.name}<small>{o.kind==='opening'?'Open to below':'Floor pathway'}</small></span></button>)}</div>
    {!!ceilingOpenings(plan,building.id,floor).length && <p className="facility-caption">Dashed boundaries show ceiling openings from the level above.</p>}
    {item && <form onSubmit={save}>
      <label className="facility-field"><span>{selected.kind==='opening'?'Opening name':'Pathway name'}</span><input aria-label={selected.kind==='opening'?'Opening name':'Pathway name'} required maxLength={100} value={item.name} onChange={e=>onDraft({...item,name:e.target.value})}/></label>
      {selected.kind==='opening'?<ShapeDimensions shape={item} onChange={onDraft} units={units}/>:<LineDimensions onDirtyChange={onPendingChange} points={item.points} onChange={points=>onDraft({...item,points})} units={units}/>}
      <button className="facility-primary" disabled={locked || pending} type="submit">Save {selected.kind==='opening'?'opening':'pathway'}<Check/></button>
      <button className="facility-delete" disabled={disabled || pending} type="button" onClick={remove}><Trash/>{selected.kind==='opening'?'Close opening with solid floor':'Remove pathway'}<small>Undo available</small></button>
    </form>}
    {error&&<p role="alert" className="error">{error}</p>}
  </section>;
}
