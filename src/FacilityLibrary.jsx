import React,{useEffect,useRef,useState} from 'react';
import {blankFacility,exampleFacility} from './facility.mjs';
import FacilitySwitcher from './FacilitySwitcher.jsx';
import {LIBRARY_KEY,loadLibrary,persistLibrary,addFacility,replaceActive,selectFacility,duplicateActive,parseFacilityFile} from './facility-library.mjs';

export function downloadFacilityData(data,filename) {
  const contents=typeof data==='string'?data:JSON.stringify(data);
  const url=URL.createObjectURL(new Blob([contents],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function FacilityLibrary({children}) {
  const initial=useRef();
  if(!initial.current){let storage;try{storage=window.localStorage;}catch{}initial.current={...loadLibrary(storage),storage};}
  const [library,setLibrary]=useState(initial.current.library),[dirty,setDirty]=useState(false);
  const [error,setError]=useState(initial.current.error || ''),[saved,setSaved]=useState(!initial.current.blocked && initial.current.expectedRaw!==null);
  const libraryRef=useRef(library),expectedRaw=useRef(initial.current.expectedRaw),blocked=useRef(initial.current.blocked),mounted=useRef(false);
  const fileInput=useRef(),dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const active=library.facilities.find(f=>f.id===library.activeId);
  function save(next){
    libraryRef.current=next;setLibrary(next);
    if(blocked.current){setSaved(false);return {saved:false};}
    try{
      const result=persistLibrary(initial.current.storage,next,expectedRaw.current);
      expectedRaw.current=result.raw;libraryRef.current=result.library;setLibrary(result.library);setSaved(true);setError('');return {saved:true};
    }catch(e){if(e.code==='FACILITY_CONFLICT')blocked.current=true;setSaved(false);setError(e.message+' Your current facilities remain in memory. Export a backup before closing.');return {saved:false};}
  }
  useEffect(()=>{if(!mounted.current){mounted.current=true;if(!blocked.current && expectedRaw.current===null)save(libraryRef.current);}},[]);
  useEffect(()=>{
    const external=e=>{if(e.key===LIBRARY_KEY || e.key===null){blocked.current=true;setSaved(false);setError('Saved facilities changed in another tab. Export your current work, then reload to use the saved version. Automatic saving is paused to avoid overwriting it.');}};
    window.addEventListener('storage',external);return()=>window.removeEventListener('storage',external);
  },[]);
  useEffect(()=>{const leave=e=>{if(dirty || !saved){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty,saved]);
  function mutate(fn){if(dirtyRef.current){setError('Save or discard your preview before changing facilities.');return false;}try{save(fn(libraryRef.current));return true;}catch(e){setError(e.message);return false;}}
  function importText(text){
    if(dirtyRef.current)throw Error('Save or discard your preview before importing facilities.');
    const plans=parseFacilityFile(text);let next=libraryRef.current;
    for(const plan of plans)next=addFacility(next,plan);
    save(next);return true;
  }
  async function importFile(e){const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>4_000_000)throw Error('Facility backups must be smaller than 4 MB.');importText(await file.text());}catch(e){setError(e.message);}}
  const controls=<>
    <FacilitySwitcher facilities={library.facilities} activeId={library.activeId} disabled={dirty}
      savedState={saved?'Saved in this browser · export a backup':'Memory only · export a backup'}
      onSwitch={id=>mutate(l=>selectFacility(l,id))}
      onCreate={name=>mutate(l=>addFacility(l,{...blankFacility(),name}))}
      onDuplicate={()=>mutate(duplicateActive)} onSample={()=>mutate(l=>addFacility(l,exampleFacility()))}
      onImport={()=>fileInput.current?.click()}
      onExportAll={()=>{if(!dirty)downloadFacilityData(libraryRef.current,'dvr-facilities-backup.json');}}/>
    {error && <div className="facility-library-error" role="alert"><p>{error}</p>{!blocked.current && <button type="button" disabled={dirty} onClick={()=>save(libraryRef.current)}>Retry saving</button>}{blocked.current && typeof initial.current.recoveryRaw==='string' && <button type="button" onClick={()=>downloadFacilityData(initial.current.recoveryRaw,'dvr-facilities-recovery.json')}>Download stored data</button>}</div>}
  </>;
  return <>{children({facilityId:active.id,initialPlan:active.plan,facilityControls:controls,onPersist:plan=>save(replaceActive(libraryRef.current,plan)),onDraftChange:setDirty,onImportFacilities:importText,onOpenImport:()=>fileInput.current?.click()})}<input ref={fileInput} hidden type="file" accept=".json,application/json" aria-label="Import facility library" onChange={importFile}/></>;
}
