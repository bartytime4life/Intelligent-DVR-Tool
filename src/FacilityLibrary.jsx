import React,{useEffect,useRef,useState} from 'react';
import {blankFacility,exampleFacility} from './facility.mjs';
import FacilitySwitcher from './FacilitySwitcher.jsx';
import {LIBRARY_KEY,addFacility,replaceActive,selectFacility,duplicateActive,removeFacility,parseFacilityFile,importFacilities,facilityFilename} from './facility-library.mjs';
import {createFacilitySave} from './facility-save.mjs';
import WorkspaceConflict from './WorkspaceConflict.jsx';

export function downloadFacilityData(data,filename) {
  const contents=typeof data==='string'?data:JSON.stringify(data);
  const url=URL.createObjectURL(new Blob([contents],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// onDirtyChange(true) while leaving would discard pending edits/drafts or memory-only (unsaved) facilities.
export default function FacilityLibrary({children,onDirtyChange}) {
  const dirtyRef=useRef(false);
  const [session]=useState(()=>{let storage;try{storage=window.localStorage;}catch{}return createFacilitySave(storage,{canResolve:()=>!dirtyRef.current});});
  const [state,setState]=useState(()=>session.snapshot()),[dirty,setDirty]=useState(false),[error,setError]=useState('');
  const {library,saved,pending,conflict}=state;
  const fileInput=useRef();dirtyRef.current=dirty;
  const active=library.facilities.find(f=>f.id===library.activeId);
  function save(next){
    session.update(next);setError('');void session.flush();return session.snapshot();
  }
  useEffect(()=>session.subscribe(()=>setState(session.snapshot())),[session]);
  useEffect(()=>{void session.flush();},[session]);
  useEffect(()=>{
    const external=e=>{if(e.storageArea===window.localStorage && (e.key===LIBRARY_KEY || e.key===null || e.key.startsWith(`${LIBRARY_KEY}.conflict-backup.`)))session.receive();};
    window.addEventListener('storage',external);return()=>window.removeEventListener('storage',external);
  },[session]);
  useEffect(()=>{const leave=e=>{if(dirty || !saved){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,saved]);
  const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
  useEffect(()=>{dirtyCallback.current?.(dirty || !saved);},[dirty,saved]);
  useEffect(()=>()=>dirtyCallback.current?.(false),[]);
  function mutate(fn){if(dirtyRef.current){setError('Save or discard your preview before changing facilities.');return false;}try{save(fn(session.snapshot().library));return true;}catch(e){setError(e.message);return false;}}
  function importText(text){
    if(dirtyRef.current)throw Error('Save or discard your preview before importing facilities.');
    const next=importFacilities(session.snapshot().library,parseFacilityFile(text));
    save(next);return true;
  }
  async function importFile(e){const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>4_000_000)throw Error('Facility backups must be smaller than 4 MB.');importText(await file.text());}catch(e){setError(e.message);}}
  const controls=<>
    <FacilitySwitcher facilities={library.facilities} activeId={library.activeId} disabled={dirty}
      savedState={saved?'Saved in this browser · export a backup':pending?'Saving in this browser…':'Memory only · export a backup'}
      onSwitch={id=>mutate(l=>selectFacility(l,id))}
      onCreate={name=>mutate(l=>addFacility(l,{...blankFacility(),name}))}
      onDuplicate={()=>mutate(duplicateActive)} onSample={()=>mutate(l=>addFacility(l,exampleFacility(),{rename:true}))}
      onRemove={()=>mutate(l=>removeFacility(l,l.activeId))}
      onExportActive={()=>{const current=session.snapshot().library.facilities.find(f=>f.id===session.snapshot().library.activeId);if(!dirty && current)downloadFacilityData(current.plan,facilityFilename(current.plan));}}
      onImport={()=>fileInput.current?.click()}
      onExportAll={()=>{if(!dirty)downloadFacilityData(session.snapshot().library,'dvr-facilities-backup.json');}}/>
    {(error || state.error) && !conflict && <div className="facility-library-error" role="alert"><p>{error || state.error}</p><button type="button" disabled={dirty} onClick={()=>{setError('');void session.flush();}}>Retry saving</button></div>}
    {conflict && <div className="facility-save-recovery">
      {dirty && <p role="status">Save or discard your preview before choosing a saved facility version. Downloads include applied plans.</p>}
      <WorkspaceConflict kind="facilities" localCount={library.facilities.length} disabled={dirty}
        conflict={{...conflict,remoteValue:conflict.remoteValue?.facilities}}
        exportLocal={()=>downloadFacilityData(session.snapshot().library,'dvr-facilities-this-tab.json')}
        exportRemote={()=>downloadFacilityData(conflict.remoteRaw ?? JSON.stringify(conflict.remoteValue),'dvr-facilities-other-tab.json')}/>
      {typeof session.loaded.recoveryRaw==='string' && <button type="button" onClick={()=>downloadFacilityData(session.loaded.recoveryRaw,'dvr-facilities-recovery.json')}>Download stored data</button>}
    </div>}
  </>;
  return <>{children({facilityId:`${active.id}:${state.adoption}`,initialPlan:active.plan,facilityControls:controls,persistencePending:pending,persistenceSaved:saved,onPersist:plan=>save(replaceActive(session.snapshot().library,plan)),onDraftChange:setDirty,onImportFacilities:importText,onOpenImport:()=>fileInput.current?.click()})}<input ref={fileInput} hidden type="file" accept=".json,application/json" aria-label="Import facility library" onChange={importFile}/></>;
}
