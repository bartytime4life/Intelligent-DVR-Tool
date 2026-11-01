import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ArrowClockwise, Plus, Minus, X, Stack, CornersOut} from '@phosphor-icons/react';
import {LIMITS} from './facility.mjs';
import {MAX_ROW,sketchFloor,freeAfterDrafts,sketchRooms} from './facility-room-sketch.mjs';
import LengthInput from './SketchLengthInput.jsx';
import {formatArea} from './facility-measurements.mjs';
import {backdropDismiss} from './dialog-dismiss.mjs';
import RoomSketchCanvas from './RoomSketchCanvas.jsx';
import RoomSketchReference,{useSketchReference} from './RoomSketchReference.jsx';
import './room-sketch.css';

const modes=[['single','One room'],['row','Room row'],['hall','Center hall']];
const plural=n=>n+' room'+(n===1?'':'s');
function LayoutIcon({mode}) {
  const rows=mode==='hall' ? [[3,6],[13,6]] : [[3,16]], cols=mode==='single'?1:3;
  return <svg viewBox="0 0 36 22" aria-hidden="true">{rows.flatMap(([y,h])=>Array.from({length:cols},(_,i)=><rect key={i+':'+y} x={2+i*32/cols} y={y} width={32/cols-1.4} height={h} rx="1"/>))}</svg>;
}

export default function RoomSketch({plan,building,level,units,onUnits,onSave,onClose,error}) {
  const dialog=useRef(null);
  const floor=useMemo(()=>sketchFloor(plan,building,level),[plan,building,level]);
  const [box,setBox]=useState(floor.frame.box),[mode,setMode]=useState('row'),[count,setCount]=useState(3);
  const [across,setAcross]=useState(false),[hall,setHall]=useState(1.8),[prefix,setPrefix]=useState('Room');
  const [snap,setSnap]=useState(true),[groups,setGroups]=useState([]),[drawing,setDrawing]=useState(false);
  const [liveBox,setLiveBox]=useState(null);
  const previewBox=drawing?liveBox:box;
  const [epoch,setEpoch]=useState(0),[changed,setChanged]=useState(false),[confirm,setConfirm]=useState(false);
  const refPlan=useSketchReference(floor.frame.box,()=>setChanged(true));
  useEffect(()=>{
    const el=dialog.current, previous=document.activeElement;el.showModal();
    return ()=>{el.close();if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  const staged=useMemo(()=>groups.flat(),[groups]);
  const vertices=useMemo(()=>[...floor.outer,...floor.blocked.flatMap(r=>r.ring),...staged.flatMap(r=>r.ring)],[floor,staged]);
  const available=useMemo(()=>{
    try{return {free:freeAfterDrafts(floor,staged)};}catch{return {error:'These outlines could not be combined. Remove the last group and try a smaller area.'};}
  },[floor,staged]);
  const usedNames=useMemo(()=>[...floor.blocked.filter(b=>b.kind==='room'),...staged].map(r=>r.name),[floor,staged]);
  const preview=useMemo(()=>{
    try {
      if (available.error) throw Error(available.error);
      if (previewBox && (![previewBox.w,previewBox.h].every(n=>Number.isFinite(n) && n>0))) throw Error('Give the area a positive width and depth.');
      if (previewBox && (previewBox.x+previewBox.w>floor.frame.box.w+1e-7 || previewBox.y+previewBox.h>floor.frame.box.h+1e-7)) throw Error('Use dimensions that fit inside the plan, or choose a new starting corner.');
      return sketchRooms({floor,free:available.free,box:previewBox,mode,count,across,hall,prefix,usedNames,capacity:LIMITS.rooms-plan.rooms.length-staged.length});
    } catch(e){return {rooms:[],error:e.message};}
  },[floor,available,previewBox,mode,count,across,hall,prefix,usedNames,plan.rooms.length,staged.length]);
  const {rooms}=preview,total=staged.length+rooms.length, area=staged.concat(rooms).reduce((sum,r)=>sum+r.area,0);
  const notice=preview.error || (preview.enclosed ? 'An area surrounds an opening or occupied space. Draw a smaller box along one side to include it.' :
    preview.skipped ? 'Some pieces are too small or complex to save. Only the highlighted rooms will be added.' :
    box && !rooms.length ? 'No free room space in this area. Draw somewhere else or clear the area.' : '');
  const canAdd=!refPlan.aligning && !refPlan.busy && !drawing && !preview.error && total>0 && (!box || rooms.length>0);
  function change(fn,value){setChanged(true);fn(value);}
  function resetArea(value){setLiveBox(null);setBox(value);setDrawing(false);setEpoch(n=>n+1);setChanged(true);}
  function keep(){setGroups(g=>[...g,rooms]);resetArea(null);}
  function close(){if(changed || drawing)setConfirm(true);else onClose();}
  const levelName=level===0 && !building.base ? 'Ground floor' : 'Level '+(level+1);
  return <dialog ref={dialog} aria-labelledby="room-sketch-title" className="room-sketch-dialog" {...backdropDismiss(close)}
    onCancel={e=>{e.preventDefault();if(confirm)setConfirm(false);else if(refPlan.aligning)refPlan.cancel();else if(drawing){setLiveBox(null);setDrawing(false);setEpoch(n=>n+1);}else close();}}>
    <header className="room-sketch-header"><div><span className="room-eyebrow"><Stack/> {building.name} <b> / </b> {levelName}</span>
      <h2 id="room-sketch-title">Room sketch</h2><p>Use the whole floor, or draw a box where you want rooms.</p></div>
      <button type="button" className="icon-button" aria-label="Close room sketch" onClick={close}><X/></button></header>
    <div className="room-sketch-body">
      <div className="room-board">
        {refPlan.aligning && <div className="room-align-instructions"><div aria-live="polite"><small>ALIGN IMAGE · {refPlan.marks.length+1} OF 4</small><strong>{refPlan.prompt}</strong></div>
          {refPlan.marks.length>0 && <button onClick={refPlan.back}>Back</button>}<button onClick={refPlan.cancel}>Cancel alignment</button></div>}
        <RoomSketchCanvas refPlan={refPlan} key={epoch} floor={floor} staged={staged} rooms={rooms} box={box && [box.w,box.h].every(n=>Number.isFinite(n) && n>0) && !preview.error ? box : null}
          units={units} snap={snap} vertices={vertices} onLive={setLiveBox} onBox={b=>change(setBox,b)} onDrawing={setDrawing}/>
        <div className="room-board-tools"><label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap to walls &amp; grid</label>
          <button disabled={refPlan.aligning} onClick={()=>resetArea(floor.frame.box)}><CornersOut/>Whole floor</button>
          {(box || drawing) && <button disabled={refPlan.aligning} onClick={()=>resetArea(null)}>Clear area</button>}</div>
        <RoomSketchReference refPlan={refPlan} disabled={drawing}/>
      </div>
      <fieldset disabled={refPlan.aligning} className="room-layout-tools" aria-label="Room layout options"><h3>Layout</h3>
        <div className="room-layouts">{modes.map(([key,title])=><button key={key} aria-pressed={mode===key} onClick={()=>change(setMode,key)}><LayoutIcon mode={key}/>{title}</button>)}</div>
        {mode!=='single' && <><div className="room-stepper"><span>{mode==='hall'?'Rooms per side':'Rooms in row'}</span><div>
          <button aria-label="Fewer rooms" disabled={count<=1} onClick={()=>change(setCount,count-1)}><Minus/></button><output aria-label="Room count">{count}</output>
          <button aria-label="More rooms" disabled={count>=MAX_ROW} onClick={()=>change(setCount,count+1)}><Plus/></button></div></div>
          <button className="room-turn" onClick={()=>change(setAcross,!across)}><ArrowClockwise/>Turn layout 90°</button></>}
        {mode==='hall' && <LengthInput title="Hall width" value={hall} units={units} onChange={v=>change(setHall,v)}/>}
        <details className="room-sketch-options"><summary>Dimensions &amp; names</summary>
          <label>Measurement units<select aria-label="Sketch units" value={units} onChange={e=>onUnits(e.target.value)}><option value="metric">Meters</option><option value="imperial">Feet</option></select></label>
          <div className="room-size-pair">{[['w','Area width'],['h','Area depth']].map(([key,title])=><LengthInput key={key} title={title} value={box?.[key] ?? ''} units={units} onChange={n=>change(setBox,{...(box || floor.frame.box),[key]:n})}/>)}</div>
          <label>Room name prefix<input maxLength={80} value={prefix} onChange={e=>change(setPrefix,e.target.value)} placeholder="Room"/></label>
        </details>
        <div className="room-batch"><button className="facility-secondary" disabled={!rooms.length || drawing} onClick={keep}><Plus/>Keep &amp; draw more</button>
          {groups.length>0 && <div><span>{plural(staged.length)} kept</span><button onClick={()=>{setGroups(g=>g.slice(0,-1));setChanged(true);}}>Remove last group</button></div>}</div>
      </fieldset>
    </div>
    <footer className="room-sketch-footer">
      {confirm ? <div className="room-discard" role="alert"><span>Discard this room sketch?</span><button className="facility-secondary" onClick={()=>setConfirm(false)} autoFocus>Keep editing</button><button className="room-discard-action" onClick={onClose}>Discard sketch</button></div> :
      <>{!drawing && (error || notice) && <p className="room-sketch-notice" role="status">{error || notice}</p>}
        <div className="room-save-row"><div aria-live="polite" aria-atomic="true"><strong>{plural(total)} proposed{total>0?' · '+formatArea(area,units):''}</strong><small>Confirm actual walls on site.</small></div>
          <button className="facility-primary" disabled={!canAdd} onClick={()=>onSave([...staged,...rooms])}><Plus/>{total?'Add '+plural(total):'Add rooms'}</button></div></>}
    </footer>
  </dialog>;
}
