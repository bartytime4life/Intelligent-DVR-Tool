import React,{useEffect,useRef,useState} from 'react';
import {ImageSquare, Crosshair} from '@phosphor-icons/react';
import {fitReference,matchReference,openReference} from './room-sketch-reference.mjs';

export function useSketchReference(bounds,onEdit) {
  const [image,setImage]=useState(null),[matrix,setMatrix]=useState(null),[marks,setMarks]=useState(null);
  const [opacity,setOpacity]=useState(.55),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const generation=useRef(0),url=useRef('');
  const fit=image ? fitReference(image,bounds) : null,aligning=marks!==null,source=aligning && marks.length<2;
  function release(){if(url.current){URL.revokeObjectURL(url.current);url.current='';}}
  useEffect(()=>()=>{generation.current++;release();},[]);
  async function load(file) {
    if (!file) return;
    const id=++generation.current;setBusy(true);setError('');
    try {
      const next=await openReference(file);
      if (generation.current!==id){URL.revokeObjectURL(next.url);return;}
      release();url.current=next.url;setImage(next);setMatrix(null);setMarks(null);onEdit();
    } catch(e){if(generation.current===id)setError(e.message);}
    finally{if(generation.current===id)setBusy(false);}
  }
  function remove(){generation.current++;release();setBusy(false);setImage(null);setMatrix(null);setMarks(null);setError('');}
  function align(){onEdit();setError('');setMarks([]);}
  function cancel(){setMarks(null);setError('');}
  function mark(p){
    if(!aligning || !fit)return;
    if(source && (p[0]<fit.x-1e-6 || p[1]<fit.y-1e-6 || p[0]>fit.x+fit.w+1e-6 || p[1]>fit.y+fit.h+1e-6)){
      setError('Choose a point inside the image.');return;
    }
    const next=[...marks,p],minSource=.01*Math.hypot(fit.w,fit.h),minTarget=.005*Math.hypot(bounds.w,bounds.h);
    if(marks.length===1 && Math.hypot(p[0]-marks[0][0],p[1]-marks[0][1])<minSource){setError('Choose a second landmark farther away.');return;}
    if(next.length===4){
      try{setMatrix(matchReference(next,minSource,minTarget));setMarks(null);}catch(e){setError(e.message);return;}
    }else setMarks(next);
    setError('');
  }
  const prompt=aligning ? ['Pick landmark A on the image.','Pick landmark B on the image.','Pick the same A on the building.','Pick the same B on the building.'][marks.length] : '';
  return {image,fit,matrix,marks,aligning,source,opacity,setOpacity,error,busy,load,remove,align,cancel,mark,prompt,
    back:()=>{setError('');setMarks(points=>points.slice(0,-1));}};
}

export default function RoomSketchReference({refPlan,disabled}) {
  const input=useRef(null), r=refPlan;
  return <div className="room-reference">
    <input hidden ref={input} type="file" accept="image/png,image/jpeg" aria-label="Local floor plan image" onChange={e=>{r.load(e.target.files?.[0]);e.target.value='';}}/>
    {!r.image ? <button disabled={r.busy || disabled} onClick={()=>input.current.click()}><ImageSquare/>{r.busy?'Opening image…':'Trace a floor plan image'}</button> :
      <><div className="room-ref-title"><ImageSquare/><strong>{r.image.name}</strong><button onClick={r.remove}>Remove image</button></div>
        {!r.aligning && <div className="room-ref-controls"><button disabled={disabled} onClick={r.align}><Crosshair/>{r.matrix?'Realign image':'Match two landmarks'}</button>
          <label>Opacity <input type="range" aria-label="Reference opacity" min="0" max="1" step=".05" value={r.opacity} onChange={e=>r.setOpacity(+e.target.value)}/></label></div>}
        <small>{r.matrix?'Manually aligned':'Fitted to view; scale and position are approximate'}. Image stays in this sketch only.</small></>}
    {r.error && <p role="alert">{r.error}</p>}
  </div>;
}
