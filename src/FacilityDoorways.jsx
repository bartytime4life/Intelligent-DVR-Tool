import React,{useMemo,useState} from 'react';
import {DoorOpen,Plus,Check} from '@phosphor-icons/react';
import LengthInput from './SketchLengthInput.jsx';
import {doorwayWall,floorDoorwayWalls,placeDoorway,projectOnWall,DOORWAY_LIMIT} from './facility-doorways.mjs';
import {formatDistance} from './facility-measurements.mjs';

export default function FacilityDoorways({plan,building,floor,door,units,ready,dirty,disabled,placing,onStart,onPlace,onChange,onSave,onDiscard,onSelect,onRemove}) {
  const [listOpen,setListOpen]=useState(false),[wallIndex,setWallIndex]=useState(0),[error,setError]=useState('');
  const walls=useMemo(()=>listOpen && building?floorDoorwayWalls(plan,building.id,floor):[],[listOpen,plan.rooms,building?.id,floor]);
  const existing=(plan.doorways || []).filter(d=>d.buildingId===building?.id && d.level===floor);
  const names=ids=>ids.map(id=>plan.rooms.find(r=>r.id===id)?.name || 'Room').join(' ↔ ');
  const wall=useMemo(()=>door?doorwayWall(plan,door):null,[door,plan.rooms]);
  const count=plan.rooms.filter(r=>r.buildingId===building?.id && r.level===floor).length;
  const unavailable=!building || building.openFloors?.includes(floor) || count<2 || (plan.doorways || []).length>=DOORWAY_LIMIT;
  function change(key,value) {
    const next={...door,[key]:value};setError('');
    if(key==='width' && typeof value==='number' && wall) {
      try {onChange(placeDoorway(plan,wall,[door.x,door.y],next));return;}
      catch(e){setError(e.message);}
    }
    onChange(next);
  }
  function offset(value) {
    if(!Number.isFinite(value) || !wall){setError('Enter a valid distance along the wall.');return;}
    const [a,b]=wall.points,{length}=projectOnWall(a,wall);
    try{onChange(placeDoorway(plan,wall,a.map((n,i)=>n+(b[i]-n)*value/length),door));setError('');}
    catch(e){setError(e.message);}
  }
  return <section className="facility-doorways" aria-label="Doorways">
    <h3><DoorOpen/>Doorways</h3>
    {!door && <><p>{count<2?'Draw adjoining rooms to add a doorway between them.':placing?'Click a highlighted shared wall.':'Click a shared room wall, then drag the opening into place.'}</p>
      <button className="facility-primary" disabled={disabled || unavailable || !ready || placing} onClick={onStart}><Plus/>Place doorway</button>
      <details onToggle={e=>setListOpen(e.currentTarget.open)}><summary>Place by room pair</summary>
        {listOpen && (walls.length ? <><label>Shared wall<select aria-label="Doorway shared wall" disabled={disabled || unavailable} value={Math.min(wallIndex,walls.length-1)} onChange={e=>setWallIndex(+e.target.value)}>
          {walls.map((w,i)=><option value={i} key={i}>{names(w.roomIds)} · {formatDistance(projectOnWall(w.points[0],w).length,units)}</option>)}</select></label>
        <button className="facility-secondary" disabled={disabled || unavailable} onClick={()=>{const w=walls[Math.min(wallIndex,walls.length-1)];onPlace(w,w.points[0].map((n,i)=>(n+w.points[1][i])/2));}}>Place on this wall</button></> :
        <p>Rooms need to share a continuous wall with room for an opening.</p>)}</details></>}
    {door && <form onSubmit={onSave} noValidate>
      <p className="doorway-connection">{names(door.roomIds)}</p>
      <label>Doorway name<input value={door.name} maxLength={100} onChange={e=>change('name',e.target.value)}/></label>
      <div className="facility-field-pair"><LengthInput title="Doorway width" units={units} value={door.width} onChange={v=>change('width',v)}/>
        <LengthInput title="Doorway height" units={units} value={door.height} onChange={v=>change('height',v)}/></div>
      {wall && <LengthInput title="Distance along wall" units={units} value={projectOnWall([door.x,door.y],wall).along} onChange={offset}/>}
      <p>Drag the doorway handle along the wall. Arrow keys adjust its position. Planned open doorway.</p>
      {error && <p role="alert">{error}</p>}
      <div className="facility-action-row"><button className="facility-primary" type="submit" disabled={!!error}><Check/>Save doorway</button>
        {dirty && <button className="facility-secondary" type="button" onClick={()=>{setError('');onDiscard();}}>Discard doorway changes</button>}</div>
      {plan.doorways?.some(d=>d.id===door.id) && <button type="button" className="facility-delete" onClick={onRemove}>Remove doorway<small>Undo available</small></button>}
    </form>}
    {existing.length>0 && <div className="facility-item-list compact">{existing.map(d=><button key={d.id} className={door?.id===d.id?'selected':''} disabled={disabled || dirty} onClick={()=>onSelect(d.id,'doorway')}><DoorOpen/><span>{d.name}<small>{names(d.roomIds)}</small></span></button>)}</div>}
  </section>;
}
