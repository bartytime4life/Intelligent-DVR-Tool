import React, {useState} from 'react';
import {Plus, Copy, Stack} from '@phosphor-icons/react';
import {addBuildingLevel, copyRoomsToNextLevel, ceilingOpenings} from './facility.mjs';
import {formatDistance} from './facility-measurements.mjs';
import {localizeLengths} from './facility-shape-edit.mjs';
import './facility-planning.css';

export default function FacilityLevels({plan, building, floor, onFloor, commit, disabled=false, onSelect, units='metric'}) {
  const [error,setError] = useState('');
  if (!building) return <p className="facility-caption">Add a building to create its levels.</p>;
  const activeFloor=Math.max(0,Math.min(building.floors-1,Number.isInteger(floor) ? floor : 0));
  const base=building.base || 0, rise=(building.height-base)/building.floors;
  const rooms=plan.rooms.filter(r=>r.buildingId===building.id && r.level===activeFloor);
  const openings=(plan.openings || []).filter(o=>o.buildingId===building.id && o.level===activeFloor);
  const ceiling=ceilingOpenings(plan,building.id,activeFloor);
  function perform(copy) {
    try {
      const next=copy ? copyRoomsToNextLevel(plan,building.id,activeFloor) : addBuildingLevel(plan,building.id);
      if (commit(next,copy ? 'Rooms copied to the next level — Undo available' : 'Top level added — existing levels keep their elevations')) {
        onFloor(copy ? activeFloor+1 : building.floors);
        onSelect?.(building.id,'building'); setError('');
      }
    } catch(e) { setError(e.message); }
  }
  return <section className="facility-levels" aria-label="Building levels">
    <div className="facility-planning-heading"><Stack/><div><h3>{building.name}</h3><p>{building.floors} levels · {formatDistance(rise,units)} per level</p></div></div>
    <div className="facility-level-stack">{Array.from({length:building.floors},(_,i)=>building.floors-i-1).map(level=><button key={level} disabled={disabled} aria-pressed={activeFloor===level} onClick={()=>{onFloor(level);setError('');}}>
      <span>{level===0 ? 'Ground / lowest' : `Level ${level+1}`}</span><small>{formatDistance(base+level*rise,units)} · {plan.rooms.filter(r=>r.buildingId===building.id && r.level===level).length} rooms</small>
    </button>)}</div>
    <div className="facility-level-summary"><span><i className="floor-opening-key"/>{openings.length} floor openings</span><span>{(plan.paths || []).filter(p=>p.buildingId===building.id && p.level===activeFloor).length} pathways</span><span><i className="ceiling-opening-key"/>{ceiling.length} ceiling openings from above</span></div>
    <div className="facility-action-row"><button type="button" className="facility-secondary" disabled={disabled || building.floors>=40 || base+rise*(building.floors+1)>150} onClick={()=>perform(false)}><Plus/>Add top level</button>
      <button type="button" className="facility-secondary" disabled={disabled || !rooms.length} onClick={()=>perform(true)}><Copy/>Copy rooms upstairs</button></div>
    <p className="facility-caption">Add top level keeps the current floor spacing. Copy rooms adds the next level when needed and requires it to be empty. Stairs, openings and pathways are not copied. Both changes can be undone.</p>
    <p className="facility-caption">A floor opening on Level {activeFloor+1} also opens the ceiling of {activeFloor===0 ? 'the space beneath the lowest modeled floor' : `Level ${activeFloor}`}. Openings on other levels remain independent.</p>
    {error && <p className="error" role="alert">{localizeLengths(error,units)}</p>}
  </section>;
}
