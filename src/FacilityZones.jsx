import React, {useEffect, useState} from 'react';
import {Polygon, Plus, ShieldWarning, Eye, DownloadSimple, Trash, Check} from '@phosphor-icons/react';
import {centroid} from './facility.mjs';
import {FACILITY_CLASSES, createFacilityZone, compileZoneRules} from './facility-zones.mjs';
import ShapeDimensions from './ShapeDimensions.jsx';
import './facility-planning.css';

export default function FacilityZones({plan,selectedId,onSelect,onDraw,commit,disabled=false,ready=false,building,floor=0,onDirtyChange,units='metric'}) {
  const [drafts,setDrafts]=useState({}), [error,setError]=useState('');
  const zones=plan.zones || [], saved=zones.find(z=>z.id===selectedId), draft=saved && (drafts[selectedId] || saved);
  const dirty=!!saved && JSON.stringify(draft)!==JSON.stringify(saved);
  const anyDirty=zones.some(z=>drafts[z.id] && JSON.stringify(drafts[z.id])!==JSON.stringify(z));
  useEffect(()=>{onDirtyChange?.(!!anyDirty);},[anyDirty,onDirtyChange]);
  useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
  useEffect(()=>{setDrafts({});setError('');},[plan]);
  function change(key,value) {setDrafts(previous=>({...previous,[selectedId]:{...draft,[key]:value}}));setError('');}
  function clearDraft() {setDrafts(previous=>{const next={...previous};delete next[selectedId];return next;});}
  function addRectangle() {
    const [x,y]=building ? centroid(building.footprint) : [0,0];
    const zone=createFacilityZone([[x-5,y-5],[x+5,y-5],[x+5,y+5],[x-5,y+5],[x-5,y-5]]);
    if (commit({...plan,zones:[...zones,zone]},'Restricted area added — Undo available')) onSelect(zone.id,'zone');
  }
  function save(e) {e.preventDefault();if(commit({...plan,zones:zones.map(z=>z.id===selectedId ? draft : z)},'Zone saved — detection requires image rules')){clearDraft();setError('');}}
  function region(key,value) {change('imageRegion',{...draft.imageRegion,[key]:value});}
  function exportRules() {
    try {
      const rules=compileZoneRules(saved,plan.cameras);
      const url=URL.createObjectURL(new Blob([JSON.stringify(rules,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=`dvr-zone-${saved.id}-rules.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setError('');
    } catch(e) {setError(e.message);}
  }
  return <section className="facility-zones" aria-label="Restricted zones and object rules">
    <div className="facility-action-row"><button type="button" disabled={disabled || anyDirty || !ready || zones.length>=500} className="facility-primary" onClick={onDraw}><Polygon/>Draw zone</button>
      <button type="button" disabled={disabled || anyDirty || zones.length>=500} className="facility-secondary" onClick={addRectangle}><Plus/>Add rectangular zone</button></div>
    <p className="facility-caption">Red areas restrict people. Amber areas flag model classes you do not expect. Map boundaries are planning geometry; connect a separate image region to create recording-analysis rules.</p>
    <div className="facility-item-list compact">{zones.map(z=><button key={z.id} disabled={disabled} className={selectedId===z.id ? 'selected' : ''} onClick={()=>onSelect(z.id,'zone')}>
      {z.type==='restricted' ? <ShieldWarning className="zone-restricted-icon"/> : <Eye className="zone-watch-icon"/>}<span>{z.name}<small>{z.type==='restricted' ? 'Restricted' : 'Unexpected classes'} · {z.enabled ? 'Enabled plan' : 'Disabled'}{drafts[z.id] ? ' · unsaved draft' : ''}</small></span></button>)}</div>
    {!zones.length && <p className="facility-caption">Draw an area around an entrance, storage space or clear walkway to get started.</p>}
    {draft && <form onSubmit={save} className="facility-zone-form">
      <label className="facility-field"><span>Zone name</span><input aria-label="Zone name" required maxLength={100} value={draft.name} onChange={e=>change('name',e.target.value)}/></label>
      <ShapeDimensions shape={draft} onChange={next=>setDrafts(previous=>({...previous,[selectedId]:next}))} units={units}/>
      <label className="facility-field"><span>Zone purpose</span><select aria-label="Zone purpose" value={draft.type} onChange={e=>change('type',e.target.value)}><option value="restricted">Restricted area · person present</option><option value="object_watch">Out-of-place classes · review required</option></select></label>
      <label className="facility-field"><span>Zone floor</span><select aria-label="Zone floor" value={draft.buildingId ? `${draft.buildingId}:${draft.level}` : 'outdoor'} onChange={e=>{
        const value=e.target.value;const next={...draft};delete next.buildingId;delete next.level;
        if(value!=='outdoor'){const [id,level]=value.split(':');next.buildingId=id;next.level=Number(level);}
        setDrafts(previous=>({...previous,[selectedId]:next}));
      }}><option value="outdoor">Outdoor / ground plan</option>{plan.buildings.flatMap(b=>Array.from({length:b.floors},(_,i)=><option value={`${b.id}:${i}`} key={`${b.id}:${i}`}>{b.name} · Level {i+1}</option>))}</select></label>
      {draft.buildingId && <p className="facility-caption">The polygon must fit inside the selected building, outside courtyards.</p>}
      <label className="facility-field"><span>Presence before review <small>seconds</small></span><input aria-label="Presence before review" type="number" min={0} max={3600} step="0.1" required value={draft.dwellSeconds} onChange={e=>change('dwellSeconds',e.target.value==='' ? '' : Number(e.target.value))}/></label>
      {draft.type==='object_watch' && <details className="facility-expected-classes" open><summary>Expected classes · {draft.expectedClasses.length} allowed</summary><p className="facility-caption">Choose everything normally allowed here. Other COCO80 classes become review candidates; unfamiliar objects outside those model classes cannot be detected by this rule.</p><div>{FACILITY_CLASSES.map(label=><label key={label}><input type="checkbox" checked={draft.expectedClasses.includes(label)} onChange={e=>change('expectedClasses',e.target.checked ? [...draft.expectedClasses,label] : draft.expectedClasses.filter(v=>v!==label))}/>{label}</label>)}</div></details>}
      <label className="facility-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e=>change('enabled',e.target.checked)}/>Enable in plan and rule export</label>
      <details className="facility-image-rule" open={!!draft.imageRegion}><summary>Camera image region for recognition</summary>
        <p className="facility-caption">Measure this rectangle in the matching camera image. It is separate from the map polygon; no automatic calibration is assumed.</p>
        <label className="facility-checkbox"><input type="checkbox" checked={!!draft.imageRegion} disabled={!plan.cameras.length} onChange={e=>change('imageRegion',e.target.checked ? {cameraId:plan.cameras[0]?.id,rect:[.1,.1,.8,.8],threshold:.7,maxGap:2} : undefined)}/>Configure image rectangle</label>
        {!plan.cameras.length && <p className="facility-caption">Place a planned camera first.</p>}
        {draft.imageRegion && <><label className="facility-field"><span>Matching planned camera</span><select aria-label="Zone image camera" value={draft.imageRegion.cameraId} onChange={e=>region('cameraId',e.target.value)}>{plan.cameras.map(c=><option key={c.id} value={c.id}>{c.name} · {c.id}</option>)}</select></label>
          <div className="facility-image-region-diagram" aria-label="Image rectangle preview"><svg viewBox="0 0 100 56.25" role="img"><title>Normalized camera image region, no footage</title><rect x="0" y="0" width="100" height="56.25" fill="#10242e"/>
            {draft.imageRegion.rect.every(Number.isFinite) && <rect x={draft.imageRegion.rect[0]*100} y={draft.imageRegion.rect[1]*56.25} width={Math.max(0,draft.imageRegion.rect[2]*100)} height={Math.max(0,draft.imageRegion.rect[3]*56.25)} fill={draft.type==='restricted' ? '#ef6d7b' : '#f7bb54'} fillOpacity=".22" stroke="currentColor" strokeWidth=".5"/>}</svg><small>Image coordinates · not a live feed</small></div>
          <div className="facility-field-pair">{['Left','Top','Width','Height'].map((label,i)=><label key={label} className="facility-field"><span>{label}<small>% image</small></span><input aria-label={`Image region ${label.toLowerCase()}`} type="number" min={i<2 ? 0 : .1} max={100} step=".1" required value={Number.isFinite(draft.imageRegion.rect[i]) ? Math.round(draft.imageRegion.rect[i]*1000)/10 : ''} onChange={e=>region('rect',draft.imageRegion.rect.map((v,j)=>j===i ? e.target.value==='' ? '' : Number(e.target.value)/100 : v))}/></label>)}</div>
          <div className="facility-field-pair"><label className="facility-field"><span>Confidence threshold</span><input aria-label="Zone confidence threshold" type="number" min={.1} max={1} step=".05" required value={draft.imageRegion.threshold} onChange={e=>region('threshold',e.target.value==='' ? '' : Number(e.target.value))}/></label>
            <label className="facility-field"><span>Maximum sample gap<small>seconds</small></span><input aria-label="Zone maximum sample gap" type="number" min={.1} max={60} step=".1" required value={draft.imageRegion.maxGap} onChange={e=>region('maxGap',e.target.value==='' ? '' : Number(e.target.value))}/></label></div>
          <p className="facility-caption">Export, then select this rules file when analyzing a recording from this camera. The analyzer checks class presence at detection-box centers. Dwell can combine different objects of the same class. This does not start monitoring or detect abandoned-object identity.</p></>}
      </details>
      <button type="submit" disabled={disabled} className="facility-primary">Save zone<Check/></button>
      {dirty && <div className="facility-unsaved"><span>Zone draft is unsaved</span><button type="button" onClick={clearDraft}>Discard zone draft</button></div>}
      <button type="button" disabled={disabled || dirty || !saved.enabled || !saved.imageRegion} className="facility-secondary" onClick={exportRules}><DownloadSimple/>Export recognition rules</button>
      <button type="button" disabled={disabled} className="facility-delete" onClick={()=>{if(commit({...plan,zones:zones.filter(z=>z.id!==selectedId)},'Zone removed — Undo available')){clearDraft();onSelect('','zone');}}}><Trash/>Remove zone<small>Undo available</small></button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
