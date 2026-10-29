import React, {useEffect, useState} from 'react';
import {Buildings, Plus, Copy, DownloadSimple, UploadSimple, MapPin, Polygon, Sparkle, FolderOpen} from '@phosphor-icons/react';
import './facility-library.css';

export default function FacilitySwitcher({facilities=[],activeId,onSwitch,onCreate,onDuplicate,onExportAll,onImport,onSample,disabled=false,savedState}) {
  const [creating,setCreating]=useState(false),[name,setName]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const active=facilities.find(f=>f.id===activeId), plan=active?.plan;
  useEffect(()=>{setCreating(false);setName('');setError('');},[activeId]);
  async function create(e) {
    e.preventDefault();
    const clean=name.trim();
    if(disabled || pending)return;
    if(!clean){setError('Give this facility a name.');return;}
    setPending(true);setError('');
    try {if(await onCreate?.(clean)!==false){setCreating(false);setName('');}}
    catch(e){setError(e.message || 'The facility could not be created.');}
    finally{setPending(false);}
  }
  return <section className="facility-switcher" aria-label="Your facilities">
    <div className="facility-switcher-heading"><span className="eyebrow">YOUR FACILITIES</span><span className="facility-library-count">{facilities.length}</span></div>
    <label className="facility-library-select"><Buildings aria-hidden="true" size={19}/><select aria-label="Saved facility" value={activeId || ''} disabled={disabled || pending || !facilities.length} onChange={e=>onSwitch?.(e.target.value)}>
      {!facilities.length && <option value="">No facilities yet</option>}
      {facilities.map(f=><option key={f.id} value={f.id}>{f.plan.name}</option>)}
    </select></label>
    {plan && <p className="facility-library-inventory">{plan.buildings.length} {plan.buildings.length===1?'building':'buildings'}<span aria-hidden="true">·</span>{plan.cameras.length} {plan.cameras.length===1?'camera':'cameras'}</p>}
    <div className="facility-library-actions"><button type="button" disabled={disabled || pending} onClick={()=>{setCreating(true);setError('');}}><Plus aria-hidden="true"/>New facility</button><button type="button" disabled={disabled || pending || !active} onClick={onDuplicate}><Copy aria-hidden="true"/>Duplicate facility</button></div>
    {creating && <form className="facility-create-form" onSubmit={create}>
      <label htmlFor="facility-new-name">New facility name</label><input id="facility-new-name" aria-label="New facility name" autoFocus required maxLength={100} autoComplete="off" placeholder="e.g. North campus" value={name} disabled={disabled || pending} onChange={e=>{setName(e.target.value);setError('');}}/>
      <div><button className="facility-primary" type="submit" disabled={disabled || pending || !name.trim()}>{pending?'Creating…':'Create blank facility'}</button><button type="button" className="facility-library-cancel" disabled={pending} onClick={()=>{setCreating(false);setName('');setError('');}}>Cancel</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>}
    <p className="facility-library-save" role="status"><span aria-hidden="true"/>{savedState || 'Not yet saved in this browser'}</p>
    <details className="facility-library-backups"><summary>Backup &amp; examples</summary><div>
      <button type="button" disabled={disabled || pending || !facilities.length} onClick={onExportAll}><DownloadSimple aria-hidden="true"/>Export all facilities</button>
      <button type="button" disabled={disabled || pending} onClick={onImport}><UploadSimple aria-hidden="true"/>Import facility file</button>
      <p>Keep a JSON backup to move between devices or restore after clearing browser data. Imports add facilities.</p>
      <button type="button" disabled={disabled || pending} onClick={onSample}><Sparkle aria-hidden="true"/>Open example facility</button><p>The example opens as a separate facility. Your saved sites stay intact.</p>
    </div></details>
  </section>;
}

export function FacilityEmptyState({onDraw,onImport,onLocate,disabled=false}) {
  return <div className="facility-empty-state"><section className="facility-empty-card" aria-label="Start a blank facility">
    <div className="facility-empty-mark" aria-hidden="true"><Buildings size={31}/><span/></div>
    <p className="facility-empty-eyebrow">A CLEAN START</p><h2>Your facility starts here</h2><p>Build your own map, or pick up where you left off with a saved file.</p>
    <div className="facility-empty-actions"><button type="button" className="facility-primary" disabled={disabled} onClick={onDraw}><Polygon aria-hidden="true"/>Draw first building</button><button type="button" className="facility-secondary" disabled={disabled} onClick={onImport}><FolderOpen aria-hidden="true"/>Import saved facility</button></div>
    <button type="button" className="facility-empty-location" disabled={disabled} onClick={onLocate}><MapPin aria-hidden="true"/>Set site location</button>
    <small>No buildings, cameras or example layouts are added automatically.</small>
  </section></div>;
}
