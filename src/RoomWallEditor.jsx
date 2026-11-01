import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowClockwise, Check, Stack, X} from '@phosphor-icons/react';
import {applyWallEdit, prepareWallEdit, previewWallEdit, wallNeighbors} from './facility-room-walls.mjs';
import {formatArea, formatDistance} from './facility-measurements.mjs';
import {displayLength, unitFactor} from './facility-shape-edit.mjs';
import {RoomLabel, pathOf} from './RoomSketchCanvas.jsx';
import LengthInput from './SketchLengthInput.jsx';
import {backdropDismiss} from './dialog-dismiss.mjs';

const operations = [
  {id:'split', label:'Split room', help:'Place a dividing wall to make two rooms.'},
  {id:'move', label:'Move shared wall', help:'Give one room more space by moving the wall between them.'},
  {id:'merge', label:'Merge rooms', help:'Remove the dividing wall to join two rooms.'}
];

function defaultRoomName(others) {
  const used = new Set(others.map(room => room.name));
  let number = 1;
  while (used.has('Room ' + number)) number++;
  return 'Room ' + number;
}

function handlePoint(ring, axis, position) {
  const dim = axis === 'x' ? 0 : 1, cross = 1 - dim, cuts = [];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if ((a[dim] > position) === (b[dim] > position)) continue;
    cuts.push(a[cross] + (position-a[dim]) * (b[cross]-a[cross]) / (b[dim]-a[dim]));
  }
  cuts.sort((a,b) => a-b);
  let longest = 0, center;
  for (let i = 1; i < cuts.length; i += 2) {
    const length = cuts[i] - cuts[i-1];
    if (length > longest) { longest = length; center = (cuts[i] + cuts[i-1]) / 2; }
  }
  if (center === undefined) return null;
  return axis === 'x' ? [position, center] : [center, position];
}

function WallDiagram({edit, axis, position, onPosition, parts, names, units}) {
  const svg = useRef(null);
  const {w,h} = edit.frame.box, span = Math.max(w,h), pad = span * .085;
  const vertical = axis === 'x', length = vertical ? w : h, adjustable = edit.mode !== 'merge';
  const handle = adjustable && Number.isFinite(position) && handlePoint(edit.outline,axis,position);
  const unit = unitFactor(units), displayed = Number.isFinite(position) ? position : length / 2;
  function place(event) {
    const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.current.getScreenCTM().inverse());
    const value = vertical ? p.x : p.y, step = unit / 10;
    // Magnets for the midpoint and saved wall work in screen pixels at any zoom.
    const tolerance = 5 / svg.current.getScreenCTM().a;
    const magnet = [length/2, edit.originalPosition].filter(Number.isFinite).find(n => Math.abs(n-value) < tolerance);
    onPosition(Math.max(0,Math.min(length,magnet ?? Math.round(value/step)*step)));
  }
  function key(event) {
    const delta = {ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];
    if (!delta && !['Home','End'].includes(event.key)) return;
    event.preventDefault();
    let value = displayed + (delta || 0) * unit * (event.shiftKey ? 1 : .1);
    if (event.key === 'Home') value = 0;
    if (event.key === 'End') value = length;
    onPosition(Math.max(0,Math.min(length,value)));
  }
  const label = adjustable ? 'Wall position on the plan' : 'Merged room preview';
  return <div className="room-sketch-paper">
    <div className="room-paper-heading"><span>ROOM PLAN</span><span>{edit.neighbor ? 'Two adjoining rooms' : edit.room.name}</span></div>
    <svg ref={svg} className={'room-drawing wall-drawing' + (adjustable ? '' : ' is-merged')} viewBox={[-pad,-pad,w+2*pad,h+2*pad].join(' ')}
      role={adjustable?'slider':'img'} aria-label={label} tabIndex={adjustable?0:undefined} aria-describedby="wall-gesture"
      aria-valuemin={adjustable ? 0 : undefined} aria-valuemax={adjustable ? displayLength(length,units) : undefined}
      aria-valuenow={adjustable ? displayLength(displayed,units) : undefined} aria-valuetext={adjustable ? formatDistance(displayed,units) : undefined}
      onKeyDown={adjustable ? key : undefined}
      onPointerDown={event=>{if(adjustable && event.isPrimary && event.button===0){
        event.preventDefault();svg.current.focus({preventScroll:true});svg.current.setPointerCapture(event.pointerId);place(event);
      }}} onPointerMove={event=>{if(adjustable && event.isPrimary && svg.current.hasPointerCapture(event.pointerId))place(event);}}>
      <defs><clipPath id="wall-footprint"><path d={pathOf(edit.outline)}/></clipPath>
        <clipPath id="wall-original"><path d={pathOf(edit.original)}/></clipPath></defs>
      <path className="room-floor-shell" d={pathOf(edit.outline)}/>
      {parts.map((part,i)=><path key={i} className={'wall-result wall-part-'+i} d={pathOf(part.ring)}/>)}
      {edit.secondRing && <path className="wall-before" d={pathOf(edit.secondRing)} clipPath="url(#wall-original)"/>}
      {handle && <g><line className="wall-divider" clipPath="url(#wall-footprint)" x1={vertical?position:0} x2={vertical?position:w}
        y1={vertical?0:position} y2={vertical?h:position}/>
        <g transform={'translate('+handle.join(' ')+') rotate('+(vertical?0:90)+')'} className="wall-handle">
          <rect x={-span*.029} y={-span*.018} width={span*.058} height={span*.036} rx={span*.012}/>
          <path transform={'scale('+span*.0017+')'} d="m -6 -4 -4 4 4 4 M 6 -4 l 4 4 -4 4"/></g></g>}
      <g className="room-plan-labels">{parts.map((part,i)=><RoomLabel key={i} room={{ring:part.ring,name:names[i]}} scale={span} sizeRatio={.044}/>)}</g>
    </svg>
    <div className="room-paper-caption" id="wall-gesture">{adjustable ? 'Tap a position or drag the wall. Arrow keys make fine adjustments.' : 'The dashed line shows the wall to remove.'}</div>
  </div>;
}

function WallDraft({plan, room, neighbor, mode, defaultName, settings, units, change, onApply, error}) {
  const setup = useMemo(()=>{
    try {return {edit:prepareWallEdit(plan,room,mode,neighbor)};}
    catch (e) {return {error:e.message};}
  },[plan,room,neighbor,mode]);
  const {axis='x',offset=null,newName=defaultName} = settings;
  const {edit} = setup;
  const length = edit && (axis==='x' ? edit.frame.box.w : edit.frame.box.h);
  const position = offset ?? edit?.originalPosition ?? length / 2;
  const preview = useMemo(()=>{
    if (!edit) return {parts:[],error:setup.error};
    try {return {parts:previewWallEdit(edit,axis,position)};}
    catch(e){return {parts:[],error:e.message};}
  },[edit,setup.error,axis,position]);
  const names = [room.name,mode==='split' ? newName.trim() || 'New room' : neighbor?.name];
  const unchanged = mode==='move' && Math.abs(position-edit?.originalPosition)<1e-8;
  const canSave = edit && preview.parts.length && !unchanged && (mode!=='split' || newName.trim());
  function positionWall(value){change({offset:value});}
  return <>
    <div className="room-sketch-body wall-editor-body">
      {edit ? <WallDiagram edit={edit} axis={axis} position={position} onPosition={positionWall} parts={preview.parts} names={names} units={units}/> :
        <div className="wall-unavailable"><Stack/><strong>Wall preview unavailable</strong><span>{setup.error}</span></div>}
      <section className="room-layout-tools wall-measures" aria-label="Wall measurements">
        {mode==='split' && <label className="room-length">New room name<input maxLength={100} value={newName} onChange={e=>change({newName:e.target.value})}/></label>}
        {edit && mode!=='merge' && <>
          <LengthInput title={axis==='x'?'Distance from left':'Distance from top'} value={position} units={units} onChange={positionWall}/>
          <div className="wall-presets"><button onClick={()=>positionWall(length/2)}>Center wall</button>
            {mode==='split' && <button onClick={()=>change({axis:axis==='x'?'y':'x',offset:null})}><ArrowClockwise/>Turn 90°</button>}</div>
        </>}
        {preview.parts.length>0 && <div className="wall-areas"><h3>Preview areas</h3>
          {preview.parts.map((part,i)=><div key={i}><span><i className={'wall-chip wall-part-'+i}/>{names[i]}</span><strong>{formatArea(part.area,units)}</strong></div>)}</div>}
        {mode==='merge' && neighbor && <p>The combined room keeps the name <strong>{room.name}</strong>.</p>}
      </section>
    </div>
    <footer className="room-sketch-footer">
      {(error || (edit && preview.error)) && <p className="room-sketch-notice" role="alert">{error || preview.error}</p>}
      <div className="room-save-row"><small>{unchanged ? 'Move the wall to preview the change.' : 'Save applies this preview. Undo restores the previous rooms.'}</small>
        <button className="facility-primary" disabled={!canSave} onClick={()=>onApply(edit,preview.parts,newName)}><Check/>{
          {split:'Save split',move:'Save wall position',merge:'Save merged room'}[mode]}</button></div>
    </footer>
  </>;
}

export default function RoomWallEditor({plan, building, level, initialRoom, units, onUnits, onClose, commit}) {
  const dialog = useRef(null), [roomId,setRoomId] = useState(initialRoom.id), [mode,setMode] = useState('split');
  const [neighborId,setNeighborId] = useState(''), [drafts,setDrafts] = useState({}), [discard,setDiscard] = useState(false);
  const [error,setError] = useState('');
  const rooms = useMemo(()=>plan.rooms.filter(r=>r.buildingId===building.id && r.level===level),[plan,building.id,level]);
  const room = rooms.find(r=>r.id===roomId) || rooms[0];
  const neighbors = useMemo(()=>wallNeighbors(rooms,room),[rooms,room]);
  const neighbor = mode==='split' ? null : neighbors.find(r=>r.id===neighborId) || neighbors[0];
  useEffect(()=>{
    const el=dialog.current,previous=document.activeElement;el.showModal();
    return ()=>{el.close();if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  const draftKey = JSON.stringify([room.id,mode,neighbor?.id]);
  const defaultName = useMemo(()=>defaultRoomName(rooms),[rooms]);
  function change(patch) {
    setDrafts(current => ({...current,[draftKey]:{...current[draftKey],...patch}}));
    setError('');
  }
  function close(){if(Object.keys(drafts).length)setDiscard(true);else onClose();}
  function apply(edit,parts,name) {
    try {
      const next = applyWallEdit(plan,edit,parts,name);
      if (commit(next,{split:'Room split',move:'Shared wall moved',merge:'Rooms merged'}[mode]+' — Undo available')) onClose(room.id);
      else setError('These walls could not be saved. Check the floor geometry.');
    } catch(e){setError(e.message);}
  }
  const operation = operations.find(item=>item.id===mode);
  return <dialog ref={dialog} className="room-sketch-dialog wall-editor" aria-labelledby="wall-editor-title" {...backdropDismiss(close)}
    onCancel={e=>{e.preventDefault();if(discard)setDiscard(false);else close();}}>
    <header className="room-sketch-header"><div><span className="room-eyebrow"><Stack/>{building.name} / {level || building.base ? 'Level '+(level+1) : 'Ground floor'}</span>
      <h2 id="wall-editor-title">Edit room walls</h2><p>{operation.help}</p></div>
      <button className="icon-button" onClick={close} aria-label="Close wall editor"><X/></button></header>
    {discard && <div className="wall-confirm" role="alert"><strong>Discard this wall edit?</strong><button className="facility-secondary" autoFocus onClick={()=>setDiscard(false)}>Keep editing</button><button className="room-discard-action" onClick={()=>onClose()}>Discard edit</button></div>}
    <div className="wall-editor-scroll" hidden={discard}><div className="wall-controls">
      <div className="wall-modes" role="group" aria-label="Wall edit">{operations.map(item=><button key={item.id} aria-pressed={mode===item.id}
        onClick={()=>{setMode(item.id);setError('');}}>{item.label}</button>)}</div>
      <div className="wall-selects"><label>Room<select value={room.id} onChange={e=>{setRoomId(e.target.value);setNeighborId('');setError('');}}>
        {rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      {mode!=='split' && neighbors.length>0 && <label>Adjoining room<select value={neighbor.id} onChange={e=>{setNeighborId(e.target.value);setError('');}}>
        {neighbors.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
      <label>Units<select value={units} onChange={e=>onUnits(e.target.value)}><option value="metric">Meters</option><option value="imperial">Feet</option></select></label></div>
      </div>
      <WallDraft key={draftKey} plan={plan} room={room} neighbor={neighbor} mode={mode} defaultName={defaultName} settings={drafts[draftKey] || {}} units={units}
        change={change} onApply={apply} error={error}/>
    </div>
  </dialog>;
}
