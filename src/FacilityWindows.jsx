import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CornersOut,Plus,Check} from '@phosphor-icons/react';
import LengthInput from './SketchLengthInput.jsx';
import {exteriorWindowWalls,windowWall,windowFloorHeight,placeWindow,WINDOW_LIMIT} from './facility-windows.mjs';
import {projectOnWall} from './facility-doorways.mjs';
import {formatDistance} from './facility-measurements.mjs';
import {unitFactor} from './facility-shape-edit.mjs';
import './facility-windows.css';

// A front elevation makes vertical changes possible without orbiting the map.
function WindowElevation({item,rise,units,onChange}) {
  const svg=useRef(null),drag=useRef(null),[preview,setPreview]=useState(null);
  const shown=preview || item,scale=Math.min(80/rise,170/item.width),y=n=>93-n*scale;
  const w=shown.width*scale,x=(232-w)/2,top=y(shown.sill+shown.height),bottom=y(shown.sill);
  function adjust(base,part,dz){
    const clamp=(n,min,max)=>Math.max(min,Math.min(max,n)),head=base.sill+base.height;
    if(part==='top')return {...base,height:clamp(base.height+dz,.2,rise-base.sill)};
    if(part==='sill'){const sill=clamp(base.sill+dz,0,head-.2);return {...base,sill,height:head-sill};}
    return {...base,sill:clamp(base.sill+dz,0,rise-base.height)};
  }
  function localY(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.current.getScreenCTM().inverse()).y;}
  function start(e,part){if(!e.isPrimary || e.button!==0)return;e.preventDefault();e.currentTarget.focus();svg.current.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,start:localY(e),base:item,part};}
  function next(e){const g=drag.current;return adjust(g.base,g.part,(g.start-localY(e))/scale);}
  function stop(e,accept){if(!drag.current || drag.current.id!==e.pointerId)return;const result=accept && next(e);drag.current=null;setPreview(null);if(result)onChange(result);}
  function keys(e,part){
    if(e.key==='Escape' && drag.current){e.preventDefault();e.stopPropagation();drag.current=null;setPreview(null);return;}
    const dir=e.key==='ArrowUp'?1:e.key==='ArrowDown'?-1:0;if(!dir)return;
    e.preventDefault();e.stopPropagation();onChange(adjust(item,part,dir*unitFactor(units)*(e.shiftKey?1:.1)));
  }
  const control=(part,label)=>({role:'button',tabIndex:0,'aria-label':label,onPointerDown:e=>start(e,part),onKeyDown:e=>keys(e,part)});
  return <div className="window-elevation"><div><strong>Wall elevation</strong><span>{formatDistance(shown.height,units)} high</span></div>
    <svg ref={svg} viewBox="0 0 232 103" aria-label="Window elevation editor" onPointerMove={e=>{if(drag.current?.id===e.pointerId)setPreview(next(e));}} onPointerUp={e=>stop(e,true)} onPointerCancel={e=>stop(e,false)} onLostPointerCapture={e=>stop(e,false)}>
      <path className="elevation-envelope" d={`M9 93V${y(rise)}H223V93Z`}/><path className="elevation-ground" d="M4 93H228"/>
      <g {...control('move','Raise or lower window')} className="elevation-pane"><rect x={x} y={top} width={w} height={bottom-top}/><path d={`M116 ${top}V${bottom} M${x} ${(top+bottom)/2}H${x+w}`}/></g>
      {[[top,'top','Resize window height'],[bottom,'sill','Adjust window sill']].map(([at,part,label])=><g key={part} {...control(part,label)} className="elevation-edge"><title>{label} · drag or use up/down arrows</title><rect x={part==='top'?x+w*.65-12:x+w*.35-12} y={at-8} width="24" height="16" fill="transparent"/><path d={`M${part==='top'?x+w*.65-6:x+w*.35-6} ${at}h12`}/></g>)}
    </svg><small>Drag the pane up or down. Drag its top or sill to resize.</small></div>;
}

export default function FacilityWindows({plan,building,floor,item,units,ready,dirty,disabled,placing,invalid,onStart,onPlace,onChange,onSave,onDiscard,onSelect,onRemove}) {
  const [wallIndex,setWallIndex]=useState(0),[entryError,setEntryError]=useState('');
  useEffect(()=>setEntryError(''),[item?.x,item?.y]);
  const walls=useMemo(()=>exteriorWindowWalls(building,floor),[building,floor]);
  const wall=item?windowWall(plan,item):null,rise=building?windowFloorHeight(building):0;
  const existing=(plan.windows || []).filter(w=>w.buildingId===building?.id && w.level===floor);
  const available=walls.length && rise>=.2 && (plan.windows || []).length<WINDOW_LIMIT;
  const choice=walls[Math.min(wallIndex,walls.length-1)];
  function update(next){setEntryError('');onChange(next);}
  function width(value){try{update(placeWindow(plan,wall,[item.x,item.y],{...item,width:value}));}catch{update({...item,width:value});}}
  function offset(value){
    if(!Number.isFinite(value)){setEntryError('Enter a distance along the wall.');return;}
    try{const [a,b]=wall.points,{length}=projectOnWall(a,wall);update(placeWindow(plan,wall,a.map((n,i)=>n+(b[i]-n)*value/length),item));}catch(e){setEntryError(e.message);}
  }
  return <section className="facility-doorways facility-windows" aria-label="Windows">
    <h3><CornersOut/>Windows</h3>
    {!item && <><p>{!building?'Add a building to place windows on its outside walls.':placing?'Click a highlighted outside wall.':'Click an outside wall, then drag the window or either end.'}</p>
      <button type="button" className="facility-primary" disabled={disabled || !available || !ready || placing} onClick={onStart}><Plus/>Place window</button>
      {building && <details><summary>Choose a wall by name</summary><label>Outside wall<select aria-label="Window outside wall" disabled={disabled || !available} value={Math.min(wallIndex,walls.length-1)} onChange={e=>setWallIndex(+e.target.value)}>{walls.map((w,i)=><option key={i} value={i}>{w.name} · {formatDistance(projectOnWall(w.points[0],w).length,units)}</option>)}</select></label>
        <button type="button" className="facility-secondary" disabled={disabled || !available} onClick={()=>onPlace(choice,choice.points[0].map((n,i)=>(n+choice.points[1][i])/2))}>Place on selected wall</button></details>}</>}
    {item && <form id="facility-window-form" onSubmit={e=>{if(invalid || entryError){e.preventDefault();return;}onSave(e);}} noValidate><p className="window-location">{wall?.name || 'Outside wall'} · Level {floor+1}</p>
      <p>Drag the center to move. Drag either end to change the width.</p>
      {!invalid && wall && [item.height,item.sill,item.width].every(Number.isFinite) && item.width>0 && <WindowElevation item={item} rise={rise} units={units} onChange={update}/>}
      <div className="facility-action-row"><button className="facility-primary" type="submit" disabled={!!(invalid || entryError) || !dirty}><Check/>Save window</button>
        {dirty?<button type="button" className="facility-secondary" onClick={()=>{setEntryError('');onDiscard();}}>Discard changes</button>:<button type="button" className="facility-secondary" disabled={!available || !ready} onClick={onStart}><Plus/>Place another window</button>}</div>
      <details><summary>Window measurements &amp; name</summary><label>Window name<input value={item.name} maxLength={100} onChange={e=>update({...item,name:e.target.value})}/></label>
        <div className="facility-field-pair"><LengthInput title="Window width" value={item.width} units={units} onChange={width}/><LengthInput title="Window height" value={item.height} units={units} onChange={height=>update({...item,height})}/></div>
        <div className="facility-field-pair"><LengthInput title="Sill above floor" value={item.sill} units={units} onChange={sill=>update({...item,sill})}/>{wall && <LengthInput title="Window center along wall" value={projectOnWall([item.x,item.y],wall).along} units={units} onChange={offset}/>}</div></details>
      {(invalid || entryError) && <p role="alert">{invalid || entryError}</p>}
      {existing.some(w=>w.id===item.id) && <button type="button" className="facility-delete" onClick={onRemove}>Remove window<small>Undo available</small></button>}</form>}
    {!!existing.length && <div className="facility-item-list compact">{existing.map(w=><button type="button" key={w.id} disabled={disabled || dirty} className={item?.id===w.id?'selected':''} onClick={()=>onSelect(w.id,'window')}><CornersOut/><span>{w.name}<small>{formatDistance(w.width,units)} wide</small></span></button>)}</div>}
  </section>;
}
